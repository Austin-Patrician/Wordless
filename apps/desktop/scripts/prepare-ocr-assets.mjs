import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renameDirectory } from "./rename-directory.mjs";
import { promisify } from "node:util";

/**
 * 打包期把**文字识别(OCR)的资产**放进 `resources/ocr/`。
 *
 * 为什么是内置而不是"用户按需装":OCR 的价值前提是"任何模型开箱可用" —— 挂在一个要联网、
 * 要几百 MB 的安装上,等于让"贴一张截图"时灵时不灵(方案评审的结论,见
 * `docs/architecture/ocr.md`)。所以它和 shell / Node / Python 一样属于**宿主能力**。
 *
 * 资产分两类,来源刻意不同:
 * - **ONNX 模型**(PP-OCRv5 det/rec + 字典,21.5MB):打包期从镜像下载,按 SHA256 锁定。
 *   模型是"数据",没有版本耦合问题,可以按校验和拉。
 * - **onnxruntime-web 的 wasm 与 JS 胶水**(12.8MB):**从 node_modules 里拷**,不下载。
 *   JS 胶水与 wasm 必须同版本,分头从网上拉两个版本是最典型的运行时崩法 —— 所以这里连
 *   版本号都对不上就直接报错。
 *
 * 三条纪律(与 `prepare-python-runtime.mjs` 一致):
 * - **软依赖**:拿不到就写 `skipped` 标记然后正常退出。没有 OCR 资产,应用照常工作,
 *   只是非多模态模型看不了图片(界面会如实说"未就绪")。
 * - **只在打包期联网**:运行时一个请求都不发,全部走本地文件。
 * - **不原地写应用包**:资产随包发布,运行期只读。
 */

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

/** 目录 → 带尾斜杠的 file URL(相对解析要靠它)。 */
function directoryUrl(path) {
  return pathToFileURL(path.endsWith("/") ? path : `${path}/`);
}

// `--lock` / `--resources` 是给测试与离线构建用的注入点:测试要能拿一份小号的锁与临时目录
// 跑完整流程,而不是每次真的去下 21MB 模型。
const lock = JSON.parse(await readFile(
  option("lock", "") ? pathToFileURL(option("lock", "")) : new URL("ocr.lock.json", import.meta.url),
  "utf8",
));
const require = createRequire(import.meta.url);

/**
 * 定位一个已安装包的根目录。
 *
 * **不能**直接 `require.resolve("<pkg>/package.json")`:不少新包在 `exports` 里关掉了这个
 * 子路径。也不能假设 `apps/desktop/node_modules/...`:npm workspace 会把依赖提升到仓库根。
 * 所以先解析包的入口,再往上找到最近的 package.json。
 */
function packageRoot(specifier) {
  let directory = dirname(require.resolve(specifier));
  for (;;) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate the package root of ${specifier}`);
    directory = parent;
  }
}
const resources = option("resources", "")
  ? directoryUrl(option("resources", ""))
  : new URL("../resources/", import.meta.url);
const execFile = promisify(execFileCallback);

const fromDirectory = option("from", "");
const skip = process.env.WORDLESS_SKIP_OCR === "1";
const mirror = process.env[lock.mirrorEnv] || lock.mirror;

const modelsDirectory = new URL("ocr/models/", resources);
const ortDirectory = new URL("ocr/ort/", resources);
const versionFile = new URL("ocr/.wordless-ocr-version", resources);
const missingFile = new URL("ocr/MISSING", resources);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function sizeOf(target) {
  try {
    return (await stat(target)).size;
  } catch {
    return -1;
  }
}

async function markSkipped(reason) {
  await mkdir(new URL("ocr/", resources), { recursive: true });
  await writeFile(versionFile, "skipped", "utf8");
  await writeFile(missingFile, `${reason}\n`, "utf8");
  console.log(`Skipping bundled OCR assets: ${reason}`);
  console.log("The app still works; models that cannot view images will say so instead of guessing.");
}

/**
 * 已准备好的判定:标记匹配 **且** 每个文件大小对得上。
 *
 * 只认标记是不够的(文件可能被清掉),每次构建都算 SHA 又太慢 —— 大小 + 标记足够,
 * 真正下载时才算 SHA。
 */
async function alreadyPrepared() {
  const marker = `${lock.modelSet}:${lock.engine}:${lock.onnxruntimeWeb}`;
  const current = (await readFile(versionFile, "utf8").catch(() => "")).trim();
  if (current !== marker) return false;
  for (const [name, meta] of Object.entries(lock.files)) {
    if ((await sizeOf(new URL(`ocr/models/${name}`, resources))) !== meta.size) return false;
  }
  for (const [name, size] of Object.entries(lock.runtimeFiles)) {
    if ((await sizeOf(new URL(`ocr/ort/${name}`, resources))) !== size) return false;
  }
  return true;
}

async function downloadTo(url, destination) {
  const curl = process.platform === "win32" ? "curl.exe" : "curl";
  try {
    console.log(`Downloading ${url} with resume support...`);
    await execFile(curl, [
      "--http1.1",
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry", "5",
      "--retry-all-errors",
      "--retry-delay", "2",
      "--connect-timeout", "15",
      "--speed-time", "30",
      "--speed-limit", "1024",
      "--continue-at", "-",
      "--output", destination,
      url,
    ], { maxBuffer: 1024 * 1024 });
    return;
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  console.log("curl is unavailable; downloading with Node fetch...");
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

/** 从已安装的 onnxruntime-web 里取 wasm/胶水到暂存区 —— 版本必须与锁一致。 */
async function stageRuntimeFiles(staging) {
  const runtimeRoot = packageRoot("onnxruntime-web");
  const installed = JSON.parse(await readFile(join(runtimeRoot, "package.json"), "utf8")).version;
  if (installed !== lock.onnxruntimeWeb) {
    throw new Error(
      `onnxruntime-web ${installed} is installed but the OCR lock pins ${lock.onnxruntimeWeb}: ` +
        "the JS glue and the wasm must be the same version.",
    );
  }
  // 推理封装也要对版本:锁里写的 engine 是"@ocr-web/core@<版本>"。
  const wrapperVersion = JSON.parse(await readFile(join(packageRoot("@ocr-web/core"), "package.json"), "utf8")).version;
  if (lock.engine !== `ocr-web@${wrapperVersion}`) {
    throw new Error(`@ocr-web/core ${wrapperVersion} is installed but the OCR lock pins ${lock.engine}`);
  }
  await mkdir(join(staging, "ort"), { recursive: true });
  for (const [name, size] of Object.entries(lock.runtimeFiles)) {
    const bytes = await readFile(join(runtimeRoot, "dist", name));
    if (bytes.byteLength !== size) {
      throw new Error(`onnxruntime-web dist/${name} is ${bytes.byteLength} bytes, expected ${size}`);
    }
    await writeFile(join(staging, "ort", name), bytes);
  }
  return installed;
}

if (await alreadyPrepared()) {
  console.log(`Bundled OCR assets (${lock.modelSet}) already prepared.`);
  process.exit(0);
}

if (skip) {
  await markSkipped("WORDLESS_SKIP_OCR=1");
  process.exit(0);
}

// 同 prepare-python-runtime.mjs:中转目录跟着目标走,不用 `tmpdir()` ——
// Windows 上跨卷 `rename` 会 EXDEV(工作区在 D:、TEMP 在 C:)。
//
// 也不能放进 `resources/ocr/` 里:electron-builder 是**整目录**拷 `resources/ocr` 的,
// 一次崩溃留下的中转会被原样打进包里。
const staging = join(fileURLToPath(resources), `.build-staging-ocr-${Date.now()}`);
await mkdir(staging, { recursive: true });
try {
  let installed;
  try {
    installed = await stageRuntimeFiles(staging);
  } catch (cause) {
    if (cause?.code === "ENOENT" || /Cannot find module/.test(cause?.message ?? "")) {
      await markSkipped("onnxruntime-web is not installed (run npm ci first)");
      process.exit(0);
    }
    throw cause;
  }

  // **先在暂存区把每个字节核完,最后才落盘。** 边下边写会让一次失败的构建留下半棵树:
  // 文件在、但内容没核过 —— 而"文件在"正是最容易被人当成"可用"的状态。
  await mkdir(join(staging, "models"), { recursive: true });
  for (const [name, meta] of Object.entries(lock.files)) {
    const staged = join(staging, "models", name);
    if (fromDirectory) await writeFile(staged, await readFile(join(fromDirectory, name)));
    else await downloadTo(`${mirror}${name}`, staged);
    const bytes = await readFile(staged);
    if (bytes.byteLength !== meta.size) {
      throw new Error(`${name} is ${bytes.byteLength} bytes, expected ${meta.size}`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== meta.sha256) {
      throw new Error(`SHA-256 mismatch for ${name}: got ${digest}, expected ${meta.sha256}`);
    }
  }

  // 许可与来源必须可查:模型来自 PaddleOCR 的 PP-OCRv5,转换与运行时都是 MIT。
  //
  // **先校验、最后才写标记**:反过来的话,一次失败的构建会留下"已准备好"的状态,
  // 下一次构建直接短路跳过 —— 错误就永远看不见了。
  const notice = await readFile(new URL("third-party-notices/OCR-NOTICE.txt", resources), "utf8");
  for (const required of ["PP-OCRv5", "PaddleOCR", "Apache-2.0", "MIT"]) {
    if (!notice.includes(required)) throw new Error(`OCR notice is missing "${required}"`);
  }

  await rm(modelsDirectory, { recursive: true, force: true });
  await rm(ortDirectory, { recursive: true, force: true });
  await mkdir(new URL("ocr/", resources), { recursive: true });
  await renameDirectory(join(staging, "models"), fileURLToPath(modelsDirectory));
  await renameDirectory(join(staging, "ort"), fileURLToPath(ortDirectory));
  await rm(missingFile, { force: true });
  await writeFile(versionFile, `${lock.modelSet}:${lock.engine}:${lock.onnxruntimeWeb}\n`, "utf8");
  console.log(`Prepared OCR assets (${lock.modelSet}) with onnxruntime-web ${installed} from ${fromDirectory ? "a local directory" : mirror}.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
