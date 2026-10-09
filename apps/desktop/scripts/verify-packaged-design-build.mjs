#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 发布探针:**在刚打好的安装包里真的编译一次样式**。
 *
 * ## 为什么必须有它
 *
 * 这个链路坏过一次,而且是"整条链路都坏、却没有任何检查发现"的那种坏:被 external 的
 * `@tailwindcss/node` / `tailwindcss` / `lightningcss` 没被打进安装包,于是安装版上每一份设计
 * 的 `dist/theme.css` 都生不出来 —— 画布是无样式的裸结构,截图失真,agent 只能自己猜原因。
 * 而 `npm run check`、host 测试、浏览器测试**全绿**:它们要么在仓库里跑(旁边就是
 * `apps/desktop/node_modules`),要么根本不碰打包产物。
 *
 * `verify-packaged-fff.mjs` / `verify-packaged-icon.mjs` / `verify-renderer-build.mjs` 守着别的
 * 三样,这一样之前没人守。
 *
 * ## 为什么必须把安装包复制到仓库外再跑
 *
 * **这是这个探针最容易写错的地方。** 解包目录在仓库里(`release/win-unpacked`),脚本向上解析
 * 依赖时会摸到仓库自己的 `node_modules/@tailwindcss/node` —— 于是探针**在没修好时也是绿的**。
 * 实测过:同一份缺运行时的安装包,在仓库内跑得到 `exit=0` 和 7222 字节产物,复制到仓库外
 * 立刻变成 `exit=1: Tailwind is not part of this build`。
 *
 * 所以第 2 步不只是"复制文件",它**是探针的语义**:复制完先断言上溯路径上没有 `node_modules`,
 * 有就直接失败并说明理由。少了这一步,这个文件就是一个会骗人的绿灯。
 *
 * 用法:`node scripts/verify-packaged-design-build.mjs <解包目录>`
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releasesDirectory = join(appRoot, "release");

/**
 * 定位解包目录。
 *
 * 给了参数就用它;没给(或给的那份还没打出来)就在 `release/` 下找 —— 各平台的输出目录名不同
 * (`win-unpacked` / `mac` / `mac-arm64` / `linux-unpacked`),让脚本去认比让 `dist:*` 各写一份
 * 字符串靠谱:写错了会得到一个"找不到可执行文件"的误报。
 */
function resolveUnpackedDirectory() {
  const requested = process.argv[2];
  if (requested !== undefined) return resolve(requested);
  if (!existsSync(releasesDirectory)) fail("还没有 release/ 目录 —— 先跑一次 dist:win / dist:mac / dist:linux");
  const candidates = readdirSync(releasesDirectory)
    .map((name) => join(releasesDirectory, name))
    .filter((path) => {
      if (!statSync(path).isDirectory()) return false;
      return existsSync(join(path, "Wordless.exe")) || existsSync(join(path, "wordless")) || readdirSync(path).some((name) => name.endsWith(".app"));
    });
  if (candidates.length !== 1) {
    fail(
      `在 release/ 下找到 ${String(candidates.length)} 个像打包产物的目录` +
        `(${candidates.join(", ") || "无"}),请显式传一个路径。`,
    );
  }
  return candidates[0];
}

const unpackedDirectory = resolveUnpackedDirectory();

/** 设计包里的令牌与帧:只用到 `bg-surface` / `text-primary`,断言产物里必须有它们。 */
const THEME_CSS = `@theme static {
	--color-primary: #7c3aed;
	--color-surface: #fef9ff;
}
`;

const FRAME_HTML = `<!doctype html>
<!-- @frame {"width":390,"height":240,"title":"探针"} -->
<html lang="zh-CN">
<head><meta charset="utf-8" /><link rel="stylesheet" href="../theme.css" /></head>
<body class="bg-surface text-primary"><p class="p-4">probe</p></body>
</html>
`;

const MANIFEST = {
  version: 1,
  type: "wordless-design",
  mode: "built",
  build: { recipe: "tailwind" },
  style: null,
  defaultFrameSize: { width: 390, height: 240 },
  frames: [{ id: "index", file: "frames/index.html", x: 0, y: 0, width: 390, height: 240, title: "探针" }],
};

function fail(message) {
  process.stderr.write(`verify-packaged-design-build: ${message}\n`);
  process.exit(1);
}

/**
 * 在解包目录里找到可执行文件(Win/Linux 在根,Mac 在 .app 里),以及它旁边的 app.asar。
 *
 * 顺带给出**这个平台**在 `asarUnpack` 里应该出现的那几个原生包名:`.node` 不能从 asar 里加载,
 * 所以"装了但没解出来"必须在打包期就红。原生包名按平台带后缀(Windows 是 `-msvc`,Linux 是 `-gnu`),
 * 所以这份清单只能跟着布局一起走 —— 早先它硬编码在 `.exe` 分支里,Linux 包会整段跳过这项检查。
 */
function locateApplication(directory) {
  const windows = join(directory, "Wordless.exe");
  if (existsSync(windows)) {
    return {
      executable: windows,
      asar: join(directory, "resources", "app.asar"),
      nativePackages: ["@tailwindcss/oxide-win32-x64-msvc", "lightningcss-win32-x64-msvc"],
    };
  }
  const bundle = readdirSync(directory).find((name) => name.endsWith(".app"));
  if (bundle !== undefined) {
    const macRoot = join(directory, bundle, "Contents");
    // macOS 不在这里断言:darwin 的原生包名带架构后缀(`-arm64` / `-x64`),而 `.app` 目录名不保证
    // 能反推出架构。macOS 侧由 `dist:mac` 里那次真实的编译探针兜底。
    return { executable: join(macRoot, "MacOS", "Wordless"), asar: join(macRoot, "Resources", "app.asar"), nativePackages: [] };
  }
  const linux = join(directory, "wordless");
  if (existsSync(linux)) {
    return {
      executable: linux,
      asar: join(directory, "resources", "app.asar"),
      nativePackages: [`@tailwindcss/oxide-linux-${process.arch}-gnu`, `lightningcss-linux-${process.arch}-gnu`],
    };
  }
  fail(`${directory} 里找不到可执行文件(Windows/Linux/macOS 三种布局都试过了)`);
}

/** 列出某个 `node_modules` 目录下的包名(认 `@scope/name` 两层)。 */
function listPackagesUnder(nodeModulesDirectory) {
  if (!existsSync(nodeModulesDirectory)) return [];
  const names = [];
  for (const entry of readdirSync(nodeModulesDirectory)) {
    if (entry.startsWith("@")) {
      const scope = join(nodeModulesDirectory, entry);
      for (const inner of readdirSync(scope)) names.push(`${entry}/${inner}`);
      continue;
    }
    names.push(entry);
  }
  return names;
}

/**
 * 断言**上溯路径解析不到那份编译器** —— 有的话这个探针会在没修好时也绿。
 *
 * 判据要精确到"能不能解析到 `@tailwindcss/node`",而不是"上溯有没有 `node_modules`":
 * 用户机器上随便哪个目录都可能有一个无关的 `node_modules`,拿它当理由把探针拦下来,只会让人
 * 去关掉这条检查。真正要拦的是:有人把临时目录设在仓库里(或 TMPDIR 指到仓库里),于是复制出来
 * 的安装包旁边就是 `apps/desktop/node_modules/@tailwindcss/node` —— 实测过那种情况,同一份缺
 * 运行时的安装包会跑出 exit=0 和 7222 字节产物。
 */
function assertCompilerUnreachable(startPath) {
  const packages = ["@tailwindcss/node", "tailwindcss", "lightningcss"];
  let current = resolve(startPath);
  for (;;) {
    for (const name of packages) {
      const candidate = join(current, "node_modules", ...name.split("/"), "package.json");
      if (existsSync(candidate)) {
        fail(
          `这个探针在这里不成立:从安装包位置向上能解析到 ${name}(${candidate})—— 那是仓库自己装的` +
            "那份,于是缺了运行时的安装包也会跑通(实测过)。把安装包复制到仓库外的临时目录再跑。",
        );
      }
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function run(executable, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const tail = (text, limit = 2_000) => (text.length <= limit ? text : `…${text.slice(-limit)}`);

async function main() {
  const { executable, asar, nativePackages } = locateApplication(unpackedDirectory);
  if (!existsSync(asar)) fail(`${asar} 不存在`);
  process.stdout.write(`verify-packaged-design-build: ${executable}\n`);

  /**
   * ① 先查文件清单:缺包时得到的是"哪个包不在",而不是子进程里那句间接的错误。
   *
   * **两处都要查。** `asarUnpack` 的语义是把文件**移出** asar 放进 `app.asar.unpacked`,所以
   * 只读 asar 清单会把已经装好的包报成缺失(我第一版探针就是这么写的,于是修好之后它仍然红)。
   */
  const { listPackage } = await import("@electron/asar");
  const entries = listPackage(asar).map((entry) => entry.split("\\").join("/"));
  const present = new Set();
  for (const entry of entries) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(entry);
    if (match !== null) present.add(match[1]);
  }
  for (const name of listPackagesUnder(join(dirname(asar), "app.asar.unpacked", "node_modules"))) present.add(name);

  if (!entries.some((entry) => entry.endsWith("dist/electron/design-build.mjs"))) {
    fail("app.asar 里没有 dist/electron/design-build.mjs —— 没构建 electron 产物就打不出可用的包");
  }
  for (const name of ["@tailwindcss/node", "@tailwindcss/oxide", "tailwindcss", "lightningcss"]) {
    if (!present.has(name)) {
      fail(
        `安装包里没有 ${name}(asar 与 app.asar.unpacked 都查过了)。它被 external 了` +
          "(见 scripts/external-packages.mjs),所以必须随包发布:加进 apps/desktop/package.json 的 dependencies。",
      );
    }
  }
  // 平台原生包必须解出来:`.node` 不能从 asar 里加载。清单跟着布局走(见 locateApplication)。
  if (nativePackages.length > 0) {
    const unpacked = new Set(listPackagesUnder(join(dirname(asar), "app.asar.unpacked", "node_modules")));
    for (const name of nativePackages) {
      if (!unpacked.has(name)) fail(`${name} 不在 app.asar.unpacked 里 —— 原生 .node 不能从 asar 里加载`);
    }
  }

  // ② 复制到仓库外。这一步就是探针的语义,见文件头。
  const workDirectory = await mkdtemp(join(tmpdir(), "wordless-design-build-"));
  try {
    const copy = join(workDirectory, "app");
    await cp(unpackedDirectory, copy, { recursive: true });
    assertCompilerUnreachable(copy);

    const { executable: copiedExecutable, asar: copiedAsar } = locateApplication(copy);
    // 脚本路径给**相对于可执行文件所在目录**的那一份,并把 cwd 也设在那里 —— 与安装版启动
    // 子进程的方式一致(见 `build-recipes.ts` 的 argv)。用错基准会得到一句 MODULE_NOT_FOUND。
    const applicationDirectory = dirname(copiedExecutable);
    const relativeAsar = copiedAsar.slice(applicationDirectory.length + 1);

    // ③ 一份最小设计包:一帧、两个令牌、两个工具类。
    const designPath = join(workDirectory, "probe.wdesign");
    const stagingPath = join(workDirectory, "staging");
    mkdirSync(join(designPath, "frames"), { recursive: true });
    mkdirSync(stagingPath, { recursive: true });
    writeFileSync(join(designPath, "design.json"), JSON.stringify(MANIFEST, null, "\t"));
    writeFileSync(join(designPath, "theme.css"), THEME_CSS);
    writeFileSync(join(designPath, "frames", "index.html"), FRAME_HTML);

    // ④ 用安装包自己的运行时跑它自己包里的构建脚本 —— 安装版上那条真实的路。
    const result = await run(
      copiedExecutable,
      [`${relativeAsar}/dist/electron/design-build.mjs`, designPath, stagingPath],
      applicationDirectory,
    );
    if (result.code !== 0) {
      fail(
        `安装包里的构建脚本退出码 ${String(result.code)}。\n--- stdout ---\n${tail(result.stdout)}\n--- stderr ---\n${tail(result.stderr)}`,
      );
    }

    // ⑤ 产物必须真的来自编译器,而不是源文件的原样拷贝(那正是失败时的样子)。
    const compiled = readFileSync(join(stagingPath, "theme.css"), "utf8");
    for (const [label, needle] of [
      ["Tailwind 版本头", "tailwindcss v"],
      ["工具类 .bg-surface", ".bg-surface"],
      ["工具类 .p-4", ".p-4"],
      ["令牌变量 --color-surface", "--color-surface"],
    ]) {
      if (!compiled.includes(needle)) fail(`产物里没有 ${label},说明编译没真的发生`);
    }
    if (compiled.length <= THEME_CSS.length) fail("产物不比源文件大,说明只是把源 theme.css 拷了过去");

    process.stdout.write(
      `verify-packaged-design-build: ok —— 编译出 ${String(compiled.length)} 字节,` +
        `源 ${String(THEME_CSS.length)} 字节。\n${tail(result.stdout, 400)}`,
    );
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

await main();
