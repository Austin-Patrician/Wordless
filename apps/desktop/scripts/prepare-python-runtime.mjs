import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { renameDirectory } from "./rename-directory.mjs";

/**
 * 打包期把一份**可重定位的 CPython** 放进 `resources/python/<platform>-<arch>/`。
 *
 * 为什么是打包期下载、而不是把运行时提交进仓库:python-build-standalone 的产物是平台+架构专属的二进制,
 * 全平台一起存进仓库会让仓库膨胀到不可维护(OfficeCLI 的资产是同样的取舍)。
 *
 * 为什么是 python-build-standalone:它是全网唯一"解压即用 + 可重定位 + 自带 pip"的 CPython 发行。
 * python.org 的官方产物在 mac/Linux 上只有源码(要现场编译)或需要 root 的 `.pkg`(不可重定位),
 * 两条路对普通用户都是死路 —— 详见 open-vetta 的 ADR-0011,我们在 host-environment.md 里抄了这条结论。
 *
 * 三条纪律:
 * - **软依赖**:拿不到就写一个 `skipped` 标记然后正常退出。没有内置 Python,应用照常工作(用户自己装的
 *   Python 仍然会被探测到),只是"普通用户零安装"这条体验没了。构建不该因为一个可选资产而断。
 * - **只在打包期下载**:运行时不做任何网络请求。用户机器上只是"首启从应用包里拷一份出来"。
 * - **不原地写应用包**:副本落在用户目录(见 host-environment-service 的 seed)。macOS 上改应用包内容会
 *   破坏代码签名,Windows 上 Program Files 也不可写。
 */

const lock = JSON.parse(await readFile(new URL("python.lock.json", import.meta.url), "utf8"));
const resources = new URL("../resources/", import.meta.url);
const args = process.argv.slice(2);
const execFile = promisify(execFileCallback);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const platform = option("platform", process.platform);
const arch = option("arch", process.arch);
const platformName = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
const key = `${platformName}-${arch}`;
const fromArchive = option("from", "");
const skip = process.env.WORDLESS_SKIP_PYTHON === "1";

const directory = new URL(`python/${key}/`, resources);
const versionFile = new URL(`python/${key}/.wordless-python-version`, resources);
const interpreterName = platform === "win32" ? "python.exe" : join("bin", "python3");
const interpreter = new URL(`python/${key}/${interpreterName}`, resources);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function markSkipped(reason) {
  await mkdir(directory, { recursive: true });
  await writeFile(versionFile, "skipped", "utf8");
  await writeFile(new URL(`python/${key}/MISSING`, resources), `${reason}\n`, "utf8");
  console.log(`Skipping bundled Python for ${key}: ${reason}`);
  console.log("The app still works; users without their own Python will not have one.");
}

const locked = lock.platforms[key];
if (!locked) {
  // 没有锁定资产 = 这个平台我们不内置(例如 win-arm64)。不是错误。
  await markSkipped(`no locked asset for ${key}`);
  process.exit(0);
}

const preparedVersion = `${lock.release}:${lock.pythonVersion}:${locked.asset}`;
const currentVersion = (await readFile(versionFile, "utf8").catch(() => "")).trim();
if (currentVersion === preparedVersion && (await exists(interpreter))) {
  console.log(`Bundled Python ${lock.pythonVersion} already prepared for ${key}.`);
  process.exit(0);
}

if (skip) {
  await markSkipped("WORDLESS_SKIP_PYTHON=1");
  process.exit(0);
}

const url = `${lock.repository}/releases/download/${lock.release}/${locked.asset}`;

async function downloadTo(destination) {
  const curl = platform === "win32" ? "curl.exe" : "curl";
  try {
    console.log(`Downloading ${locked.asset} with resume support...`);
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

// 中转目录必须和目标**在同一个卷**上。
//
// Windows 上 `rename` 落到 MoveFileEx(带 MOVEFILE_REPLACE_EXISTING、不带
// MOVEFILE_COPY_ALLOWED),跨卷直接返回 ERROR_NOT_SAME_DEVICE → Node 报 `EXDEV`。
// GitHub 的 windows runner 恰好是这种布局:工作区在 `D:`、`TEMP` 在 `C:`,于是
// `tmpdir()` 里的解压结果搬不到 `resources/` 下(2026-10 的 Windows 构建就是这么挂的)。
//
// 所以中转放在 `resources/` 下 —— 和 prepare-officecli-assets.mjs 同一个理由,
// 顺便也不再往 runner 那块较小的 C: 卷上写 68MB。
const staging = join(fileURLToPath(resources), `.build-staging-python-${key}-${Date.now()}`);
await mkdir(staging, { recursive: true });
try {
  const archive = fromArchive
    ? fromArchive
    : join(staging, locked.asset);
  if (!fromArchive) await downloadTo(archive);

  const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
  if (digest !== locked.sha256) {
    throw new Error(`SHA-256 mismatch for ${locked.asset}: got ${digest}, expected ${locked.sha256}`);
  }

  // 解压交给系统 tar:macOS/Linux 自带,Windows 10 1803+ 自带 bsdtar(gzip 通吃)。
  await execFile("tar", ["-xzf", archive, "-C", staging], { maxBuffer: 1024 * 1024 });
  const extracted = join(staging, "python");
  if (!(await exists(join(extracted, interpreterName)))) {
    throw new Error(`Extracted archive does not contain ${interpreterName}`);
  }

  await rm(directory, { recursive: true, force: true });
  // 只建**父目录**:目标目录本身必须不存在 —— Windows 的 rename 不能覆盖已存在的目录
  // (先 mkdir 再 rename 上去必然 EPERM,详见 rename-directory.mjs)。
  await mkdir(new URL("python/", resources), { recursive: true });
  // 顶层 `python/` 目录去掉,让落盘结构就是 `<dir>/bin/python3`(与 POSIX 约定一致)。
  await renameDirectory(extracted, fileURLToPath(directory));
  if (platform !== "win32") await chmod(interpreter, 0o755);

  // 解压出来的东西**当场跑一次**:宁可在这里失败,也不要让用户拿到一棵跑不起来的树。
  // `URL.pathname` 在 Windows 上会带一个前导斜杠(`/D:/…/python.exe`),那不是合法的
  // 可执行路径 —— 转原生路径必须用 fileURLToPath。
  const { stdout } = await execFile(fileURLToPath(interpreter), ["--version"], { timeout: 30_000 });
  if (!stdout.includes(lock.pythonVersion)) {
    throw new Error(`Bundled Python reported "${stdout.trim()}", expected ${lock.pythonVersion}`);
  }
  await rm(new URL(`python/${key}/MISSING`, resources), { force: true });
  await writeFile(versionFile, `${preparedVersion}\n`, "utf8");
  console.log(`Prepared Python ${lock.pythonVersion} (${stdout.trim()}) for ${key}.`);

  const notice = await readFile(new URL("third-party-notices/PYTHON-NOTICE.txt", resources), "utf8");
  if (!notice.includes("PSF-2.0") || !notice.includes("python-build-standalone")) {
    throw new Error("Python notice is missing the license or source line");
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
