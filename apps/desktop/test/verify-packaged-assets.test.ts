import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

/**
 * `verify-packaged-assets.mjs` 的行为。
 *
 * 它存在的理由是一个**绿但残缺**的构建:`electron-builder.yml` 里内置 Python / OCR 资产 /
 * OCR 运行器都是 `extraResources`,而它们在仓库里是 gitignore 的构建产物 —— `from` 指不到
 * 东西时 electron-builder 只是跳过,构建照样成功。macOS 的 CI 任务就这么漏跑过
 * `prepare:python` / `prepare:ocr` / `build:ocr-runner`(见 2026-10 的那次复盘)。
 *
 * 所以这里钉的是两件事:**残缺必须红**(而且要点名缺了哪一项),以及**完整不许误报**。
 * 夹具是合成的最小目录树(几百字节),不碰真实产物。
 */

const execFile = promisify(execFileCallback);
const script = resolve(import.meta.dirname, "../scripts/verify-packaged-assets.mjs");

let sandbox = "";

async function run(...args: string[]): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [script, ...args], { cwd: sandbox });
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/** 一个 mac 形状的包:`<root>/Wordless.app/Contents/Resources/…` */
async function makeMacApp(root: string, options: { python?: boolean; pythonShellOnly?: boolean; ocr?: boolean; runner?: boolean; skipMarker?: string; bytecodeCache?: boolean } = {}): Promise<void> {
  const resources = join(root, "Wordless.app", "Contents", "Resources");
  if (options.python !== false) {
    const interpreter = join(resources, "python", "mac-arm64", "bin", "python3");
    await mkdir(join(resources, "python", "mac-arm64", "bin"), { recursive: true });
    if (!options.pythonShellOnly) await writeFile(interpreter, "#!/bin/sh\nexit 0\n");
    if (options.skipMarker) await writeFile(join(resources, "python", "mac-arm64", "MISSING"), options.skipMarker);
    if (options.bytecodeCache) {
      await mkdir(join(resources, "python", "mac-arm64", "lib", "__pycache__"), { recursive: true });
      await writeFile(join(resources, "python", "mac-arm64", "lib", "__pycache__", "os.cpython-312.pyc"), "pyc");
    }
  }
  if (options.ocr !== false) {
    await mkdir(join(resources, "ocr", "models"), { recursive: true });
    await mkdir(join(resources, "ocr", "ort"), { recursive: true });
    await writeFile(join(resources, "ocr", "models", "ppocrv5_det.onnx"), "model");
    await writeFile(join(resources, "ocr", "ort", "ort-wasm-simd-threaded.wasm"), "wasm");
  }
  if (options.runner !== false) {
    await mkdir(join(resources, "ocr-runner"), { recursive: true });
    await writeFile(join(resources, "ocr-runner", "index.html"), "<!doctype html>");
  }
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "wordless-verify-assets-"));
});

after(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("verify-packaged-assets", () => {
  it("完整的 mac 包通过", async () => {
    const root = join(sandbox, "mac-arm64");
    await makeMacApp(root);
    const { code, output } = await run(root);
    assert.equal(code, 0, output);
    assert.match(output, /Verified packaged host assets for .*mac-arm64/);
    assert.match(output, /python\/mac-arm64/);
  });

  it("完整的 Windows 包通过(布局不同:`Wordless.exe` + `resources/`)", async () => {
    const root = join(sandbox, "win-unpacked");
    const resources = join(root, "resources");
    await mkdir(join(resources, "python", "win-x64"), { recursive: true });
    await writeFile(join(resources, "python", "win-x64", "python.exe"), "MZ");
    await mkdir(join(resources, "ocr", "models"), { recursive: true });
    await mkdir(join(resources, "ocr", "ort"), { recursive: true });
    await writeFile(join(resources, "ocr", "models", "ppocrv5_det.onnx"), "model");
    await writeFile(join(resources, "ocr", "ort", "ort-wasm-simd-threaded.wasm"), "wasm");
    await mkdir(join(resources, "ocr-runner"), { recursive: true });
    await writeFile(join(resources, "ocr-runner", "index.html"), "<!doctype html>");
    await writeFile(join(root, "Wordless.exe"), "MZ");
    const { code, output } = await run(root);
    assert.equal(code, 0, output);
    assert.match(output, /python\/win-x64/);
  });

  it("缺 OCR 资产 → 红,并点名是哪一项", async () => {
    const root = join(sandbox, "mac-no-ocr");
    await makeMacApp(root, { ocr: false });
    const { code, output } = await run(root);
    assert.equal(code, 1, output);
    assert.match(output, /FAIL {2}OCR 资产/);
    assert.match(output, /incomplete for .*mac-no-ocr: OCR 资产/);
  });

  it("漏跑 build:ocr-runner → 红", async () => {
    const root = join(sandbox, "mac-no-runner");
    await makeMacApp(root, { runner: false });
    const { code, output } = await run(root);
    assert.equal(code, 1, output);
    assert.match(output, /OCR 运行器/);
  });

  it("python/ 是个空壳(rm 完 rename 失败留下的那种)→ 红", async () => {
    const root = join(sandbox, "mac-empty-python");
    await makeMacApp(root, { pythonShellOnly: true });
    const { code, output } = await run(root);
    assert.equal(code, 1, output);
    assert.match(output, /内置 Python/);
    assert.match(output, /没有任何解释器/);
  });

  it("被显式跳过(WORDLESS_SKIP_*)也红 —— 发布产物不该是跳过的", async () => {
    const root = join(sandbox, "mac-skipped");
    await makeMacApp(root, { skipMarker: "WORDLESS_SKIP_PYTHON=1" });
    const { code, output } = await run(root);
    assert.equal(code, 1, output);
    assert.match(output, /被显式跳过/);
  });

  it("包里漏进了 __pycache__ → 红(打包时该被 filter 排掉)", async () => {
    const root = join(sandbox, "mac-with-bytecode");
    await makeMacApp(root, { bytecodeCache: true });
    const { code, output } = await run(root);
    assert.equal(code, 1, output);
    assert.match(output, /Python 字节码缓存/);
    assert.match(output, /1 个 __pycache__ 目录 \/ 1 个 \.pyc/);
  });

  it("目录里没有 app → 红(路径写错不该静默通过)", async () => {
    const root = join(sandbox, "not-an-app");
    await mkdir(root, { recursive: true });
    const { code, output } = await run(root);
    assert.equal(code, 1, output);
    assert.match(output, /No unpacked Wordless application found/);
  });

  it("不带路径 = 校验 release/ 下每一个 app(本地 dist:mac 的用法)", async () => {
    // 沙箱里就是"release/"的样子:一个完整的 app + 一个历史遗留的空目录。
    const complete = join(sandbox, "release", "mac-arm64");
    await makeMacApp(complete);
    await mkdir(join(sandbox, "release", "mac-universal"), { recursive: true });
    const { code, output } = await run("--release", join(sandbox, "release"));
    assert.equal(code, 0, output);
    assert.match(output, /Verified packaged host assets for release\/mac-arm64/);
    // 空目录被跳过,没有被当成失败
    assert.doesNotMatch(output, /mac-universal/);
  });

  it("release/ 里一个 app 都没有 → 红(不能空跑当通过)", async () => {
    const empty = join(sandbox, "empty-release");
    await mkdir(join(empty, "release", "mac-arm64"), { recursive: true });
    const { code, output } = await run("--release", join(empty, "release"));
    assert.equal(code, 1, output);
    assert.match(output, /No packaged Wordless application found under release\//);
  });
});
