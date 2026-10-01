import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

/**
 * `prepare-ocr-assets.mjs` 的行为。
 *
 * 这个脚本守着两件**出错就很难发现**的事:资产必须真的与锁里的字节一致,以及一次失败的
 * 构建不能留下"看起来可用"的半棵树。所以测试用一份**小号的锁**跑完整流程(`--lock` /
 * `--resources` 是为此留的注入点),而不是每次真去下 21MB 模型。
 *
 * 小号锁里的 `runtimeFiles` 是空的:wasm 来自已安装的 onnxruntime-web,而真实文件的体积
 * 与校验和已经在正式锁里钉住了 —— 这里测的是**流程**,不是那 12.8MB。
 */

const execFile = promisify(execFileCallback);
const script = resolve(import.meta.dirname, "../scripts/prepare-ocr-assets.mjs");
const desktopRoot = resolve(import.meta.dirname, "..");

let sandbox = "";
let lockPath = "";
let resourcesPath = "";
let fromPath = "";

const MODEL_NAME = "ppocrv5_det.onnx";
const MODEL_BYTES = Buffer.from("fake-onnx-model-bytes");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 锁里那两个包版本必须与**实际安装的**一致,否则脚本会(正确地)拒绝 —— 测试自己读一下。 */
async function installedVersions(): Promise<{ runtime: string; wrapper: string }> {
  const runtime = JSON.parse(await readFile(resolve(desktopRoot, "../../node_modules/onnxruntime-web/package.json"), "utf8"));
  const wrapper = JSON.parse(await readFile(resolve(desktopRoot, "../../node_modules/@ocr-web/core/package.json"), "utf8"));
  return { runtime: runtime.version, wrapper: wrapper.version };
}

async function writeLock(overrides: { sha256?: string; size?: number; modelSet?: string } = {}): Promise<void> {
  const { runtime, wrapper } = await installedVersions();
  await writeFile(lockPath, JSON.stringify({
    engine: `ocr-web@${wrapper}`,
    onnxruntimeWeb: runtime,
    // `modelSet` 变了 = 标记对不上 = 一定会真的重跑一遍(而不是短路跳过)。
    modelSet: overrides.modelSet ?? "ppocrv5",
    mirror: "https://example.invalid/models/",
    mirrorEnv: "WORDLESS_OCR_MIRROR",
    files: {
      [MODEL_NAME]: {
        size: overrides.size ?? MODEL_BYTES.byteLength,
        sha256: overrides.sha256 ?? sha256(MODEL_BYTES),
      },
    },
    runtimeFiles: {},
  }), "utf8");
}

async function writeNotice(): Promise<void> {
  await mkdir(join(resourcesPath, "third-party-notices"), { recursive: true });
  await writeFile(
    join(resourcesPath, "third-party-notices", "OCR-NOTICE.txt"),
    "PP-OCRv5 from PaddleOCR (Apache-2.0); ocr-web and onnxruntime-web are MIT.\n",
    "utf8",
  );
}

/** 跑脚本,拿到退出码与输出 —— 失败是**结果**,不是异常。 */
async function run(options: { env?: Record<string, string>; from?: string } = {}): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [
      script,
      "--lock", lockPath,
      "--resources", resourcesPath,
      ...(options.from ? ["--from", options.from] : []),
    ], { env: { ...process.env, ...options.env }, maxBuffer: 4 * 1024 * 1024 });
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/** 清掉已准备好的状态:标记在的话,脚本会短路,失败路径根本走不到。 */
async function reset(): Promise<void> {
  await rm(join(resourcesPath, "ocr"), { recursive: true, force: true });
}

async function marker(): Promise<string> {
  return (await readFile(join(resourcesPath, "ocr/.wordless-ocr-version"), "utf8").catch(() => "")).trim();
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "wordless-ocr-assets-test-"));
  lockPath = join(sandbox, "ocr.lock.json");
  resourcesPath = join(sandbox, "resources");
  fromPath = join(sandbox, "from");
  await mkdir(fromPath, { recursive: true });
  await mkdir(resourcesPath, { recursive: true });
  await writeNotice();
  await writeLock();
  await writeFile(join(fromPath, MODEL_NAME), MODEL_BYTES);
});

after(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("prepare-ocr-assets", () => {
  it("离线目录准备成功:落盘 + 写标记", async () => {
    const result = await run({ from: fromPath });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(await readFile(join(resourcesPath, "ocr/models", MODEL_NAME)), MODEL_BYTES);
    assert.match(await marker(), /^ppocrv5:ocr-web@/);
  });

  it("已准备好时短路,不再重写", async () => {
    const result = await run({ from: fromPath });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /already prepared/);
  });

  it("字节对不上就拒绝:校验和不匹配", async () => {
    await reset();
    await writeLock();
    await writeLock({ sha256: "0".repeat(64) });
    const result = await run({ from: fromPath });
    assert.equal(result.code, 1);
    assert.match(result.output, /SHA-256 mismatch/);
    await writeLock();
  });

  it("体积对不上就拒绝", async () => {
    await reset();
    await writeLock();
    await writeLock({ size: MODEL_BYTES.byteLength + 1 });
    const result = await run({ from: fromPath });
    assert.equal(result.code, 1);
    assert.match(result.output, /expected \d+/);
    await writeLock();
  });

  it("失败的构建不会破坏已准备好的资产(标记也不被改写)", async () => {
    // 先准备一份好的,再让下一次准备必然失败(modelSet 变了 → 不会短路)。
    await reset();
    assert.equal((await run({ from: fromPath })).code, 0);
    const preparedMarker = await marker();
    await writeLock({ sha256: "0".repeat(64), modelSet: "ppocrv5-next" });
    const failed = await run({ from: fromPath });
    assert.equal(failed.code, 1);
    assert.deepEqual(
      await readFile(join(resourcesPath, "ocr/models", MODEL_NAME)),
      MODEL_BYTES,
      "上一次成功的资产必须原样保留",
    );
    // 标记可以留着,但它必须**仍然描述磁盘上那批文件**(旧的、校验过的)。危险的是相反方向:
    // 标记声称有更新的资产、磁盘上却没有。
    assert.equal(await marker(), preparedMarker, "标记不该被失败的构建改写");
    assert.match(preparedMarker, /^ppocrv5:/);
    await writeLock();
  });

  it("WORDLESS_SKIP_OCR=1 软跳过:写 MISSING 并正常退出", async () => {
    await reset();
    const result = await run({ env: { WORDLESS_SKIP_OCR: "1" } });
    assert.equal(result.code, 0, result.output);
    assert.equal(await marker(), "skipped");
    assert.match(await readFile(join(resourcesPath, "ocr/MISSING"), "utf8"), /WORDLESS_SKIP_OCR/);
  });

  it("许可通知缺字段时拒绝准备", async () => {
    await reset();
    // 每个用例自己把锁写成它需要的状态:上一个用例可能在校验失败处就中止了,没走到恢复那行。
    await writeLock();
    await writeFile(join(resourcesPath, "third-party-notices", "OCR-NOTICE.txt"), "no license line here\n", "utf8");
    const result = await run({ from: fromPath });
    assert.equal(result.code, 1);
    assert.match(result.output, /OCR notice is missing/);
    await writeNotice();
  });
});
