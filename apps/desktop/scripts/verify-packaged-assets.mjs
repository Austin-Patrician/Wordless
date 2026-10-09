import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 打包后的**宿主能力资产**校验:内置 Python、OCR 模型/wasm、OCR 运行器页面。
 *
 * 为什么需要它:`electron-builder.yml` 里这三样都是 `extraResources`,而它们在仓库里是
 * **gitignore 的构建产物**(只有 `.gitkeep` 被跟踪)。`from` 指不到东西时 electron-builder
 * 是**宽容的** —— 拷不到就跳过,构建照样绿。于是"这个平台忘了跑 prepare 脚本"会一路绿到
 * 用户手上:包能装、能开,只是没有内置 Python、文字识别永远回 `assets-missing`。
 *
 * 2026-10 的 macOS CI 就是这样:任务里手写的步骤只跑了 officecli + renderer + electron,
 * 漏了 `prepare:python` / `prepare:ocr` / `build:ocr-runner`(而 `build:desktop` 三个都有)。
 * 这条校验就是把那种"绿但不完整"变成红。
 *
 * 用法:
 * - `node scripts/verify-packaged-assets.mjs release/mac-arm64` —— 校验**指定**的那一个。
 *   路径写错就是错(CI 用这个:你刚打完哪一个,自己清楚)。
 * - `node scripts/verify-packaged-assets.mjs [--release <dir>]` —— 校验 `<dir>`(默认 `release/`)
 *   下**每一个**打好的 app。
 *   本地 `dist:mac` 用这个:输出目录叫 `mac-arm64` 还是 `mac` 取决于宿主架构,写死路径会错。
 *   这一模式下**没有 app 的目录会被跳过**(`release/` 里会攒下历史产物),但一个都没有就是错。
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** `--release` 是给测试留的注入点:扫模式默认看 `<appRoot>/release`,测试不该去动真产物。 */
const requestedRoots = [];
let releaseRoot = join(appRoot, "release");
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--release" && args[index + 1]) {
    releaseRoot = resolve(args[index + 1]);
    index += 1;
  } else {
    requestedRoots.push(args[index]);
  }
}

/**
 * 解包目录 → 资产所在的那棵树。三种布局各认各的入口文件:
 * - macOS:`<root>/Wordless.app/Contents/Resources`
 * - Windows:`<root>/Wordless.exe` + `<root>/resources`
 * - Linux:`<root>/wordless` + `<root>/resources`
 *
 * Linux 的可执行文件是**小写**的(electron-builder 在 Linux 的默认 `executableName` 就是
 * productName 小写),名字在 `electron-builder.yml` 的 `linux.executableName` 里显式钉住了 ——
 * 大小写写错在 mac/Windows 上看不出来,在 Linux 上就是"找不到 app"。
 */
const LINUX_EXECUTABLE = "wordless";

function resourcesAt(root, requested) {
  const macApp = join(root, "Wordless.app", "Contents", "Resources");
  if (existsSync(macApp)) return { resources: macApp, label: requested };
  if (existsSync(join(root, "Wordless.exe"))) return { resources: join(root, "resources"), label: requested };
  if (existsSync(join(root, LINUX_EXECUTABLE))) return { resources: join(root, "resources"), label: requested };
  return undefined;
}

function targets() {
  if (requestedRoots.length > 0) {
    return requestedRoots.map((requested) => {
      const found = resourcesAt(resolve(appRoot, requested), requested);
      if (!found) throw new Error(`No unpacked Wordless application found under ${requested}`);
      return found;
    });
  }
  if (!existsSync(releaseRoot)) throw new Error(`No ${releaseRoot} directory — build something first`);
  return readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resourcesAt(join(releaseRoot, entry.name), `release/${entry.name}`))
    .filter((found) => found !== undefined);
}

function filesUnder(directory) {
  if (!existsSync(directory)) return 0;
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    total += entry.isDirectory() ? filesUnder(child) : 1;
  }
  return total;
}

/**
 * 内置 Python:认**解释器存在**而不是"目录在"。空目录是这里最可能出现的坏状态 ——
 * prepare 脚本先 `rm` 旧树、后 `rename` 新树,中间失败就会留下一个空壳。
 */
function bundledPython(resources) {
  const root = join(resources, "python");
  if (!existsSync(root)) return { ok: false, detail: "python/ 不存在(没跑 prepare:python?)" };
  const interpreters = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      key: entry.name,
      interpreter: join(root, entry.name, "bin", "python3"),
      windows: join(root, entry.name, "python.exe"),
    }))
    .filter((candidate) => existsSync(candidate.interpreter) || existsSync(candidate.windows));
  if (interpreters.length === 0) return { ok: false, detail: "python/ 下没有任何解释器(空壳目录?)" };
  const skipped = interpreters.filter((candidate) => existsSync(join(root, candidate.key, "MISSING")));
  if (skipped.length === interpreters.length) {
    return { ok: false, detail: `内置 Python 被显式跳过(${skipped.map((c) => c.key).join(", ")}/MISSING)` };
  }
  return { ok: true, detail: interpreters.map((candidate) => `python/${candidate.key}`).join(", ") };
}

/**
 * OCR:模型和 wasm 分别来自镜像与 `onnxruntime-web`,少任何一半运行器都起不来。
 */
function ocrAssets(resources) {
  const models = filesUnder(join(resources, "ocr", "models"));
  const runtime = filesUnder(join(resources, "ocr", "ort"));
  if (existsSync(join(resources, "ocr", "MISSING"))) {
    return { ok: false, detail: "OCR 资产被显式跳过(ocr/MISSING)" };
  }
  if (models === 0 || runtime === 0) {
    return { ok: false, detail: `OCR 资产不全(models=${models} 个文件, ort=${runtime} 个文件)` };
  }
  return { ok: true, detail: `${models} 个模型文件 + ${runtime} 个运行时文件` };
}

/**
 * `__pycache__` 是运行时产物,不该进包(electron-builder.yml 里用 filter 排掉了)。
 * 它一旦漏回来,包会凭空涨几十上百 MB,而且"本地打的包"和"CI 打的包"大小对不上。
 */
function bytecodeCache(resources) {
  const root = join(resources, "python");
  if (!existsSync(root)) return { ok: true, detail: "没有内置 Python,跳过" };
  let caches = 0;
  let bytecode = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__pycache__") caches += 1;
        walk(child);
      } else if (entry.name.endsWith(".pyc")) {
        bytecode += 1;
      }
    }
  };
  walk(root);
  if (caches > 0 || bytecode > 0) {
    return { ok: false, detail: `包里有 ${caches} 个 __pycache__ 目录 / ${bytecode} 个 .pyc(打包时应被 filter 排掉)` };
  }
  return { ok: true, detail: "没有 __pycache__ / .pyc" };
}

function ocrRunner(resources) {
  const page = join(resources, "ocr-runner", "index.html");
  if (!existsSync(page) || statSync(page).size === 0) {
    return { ok: false, detail: "ocr-runner/index.html 不存在或为空(没跑 build:ocr-runner?)" };
  }
  return { ok: true, detail: `index.html ${statSync(page).size} 字节` };
}

const found = targets();
if (found.length === 0) throw new Error("No packaged Wordless application found under release/");

for (const { resources, label } of found) {
  const checks = [
    ["内置 Python", bundledPython(resources)],
    ["OCR 资产", ocrAssets(resources)],
    ["OCR 运行器", ocrRunner(resources)],
    ["Python 字节码缓存", bytecodeCache(resources)],
  ];
  const failed = checks.filter(([, result]) => !result.ok);
  for (const [name, result] of checks) {
    console.log(`${result.ok ? "ok" : "FAIL"}  ${name}: ${result.detail}`);
  }
  if (failed.length > 0) {
    throw new Error(
      `Packaged host assets are incomplete for ${label}: ${failed.map(([name]) => name).join(", ")}. ` +
        "跑 `npm run build:desktop`(而不是手写 prepare/renderer/electron 三步)再打包。",
    );
  }
  console.log(`Verified packaged host assets for ${label}.`);
}
