import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { OcrService } from "../src/main/ocr/ocr-service.ts";
import type { OcrRunnerOutcome, OcrRunnerPort } from "../src/main/ocr/ocr-runner.ts";

/**
 * OCR 服务。
 *
 * 这里测的是**"要不要真的去识别"**:资产在不在、这份字节是不是已经识别过。运行器本身(隐藏
 * 窗口 + wasm)不在这条测试里 —— 用一个假端口替掉,于是"缓存有没有生效""失败会不会短路"
 * 这些判断可以确定性地测。
 */

let sandbox = "";
let assetsRoot = "";
let cacheRoot = "";
let calls: Array<{ images: Array<{ name: string }>; granularity?: string }> = [];

const runner: OcrRunnerPort = {
  async recognize(images, options): Promise<OcrRunnerOutcome> {
    calls.push({ images: images.map((image) => ({ name: image.name })), ...(options.granularity === undefined ? {} : { granularity: options.granularity }) });
    if (options.signal.aborted) return { ok: false, code: "cancelled", message: "Cancelled" };
    return {
      ok: true,
      result: {
        engine: "wordless-ocr/ppocrv5+ort-web-1.25.1+wasm1",
        loadMs: 800,
        totalDurationMs: 900,
        pages: images.map((image) => ({
          name: image.name,
          text: `text of ${image.name}`,
          lineCount: 1,
          width: 100,
          height: 50,
          confidence: 0.9,
          durationMs: 100,
        })),
      },
    };
  },
};

async function prepareAssets(marker = "ppocrv5:ocr-web@0.2.1:1.25.1"): Promise<void> {
  await rm(assetsRoot, { recursive: true, force: true });
  await mkdir(join(assetsRoot, "models"), { recursive: true });
  await mkdir(join(assetsRoot, "ort"), { recursive: true });
  for (const relative of ["models/ppocrv5_det.onnx", "models/ppocrv5_rec.onnx", "models/ppocrv5_dict.txt", "ort/ort-wasm-simd-threaded.jsep.wasm"]) {
    await writeFile(join(assetsRoot, relative), "x");
  }
  await writeFile(join(assetsRoot, ".wordless-ocr-version"), `${marker}\n`, "utf8");
}

function service(options: { maxBytesPerImage?: number; readOptions?: () => { cache: boolean; granularity: "text" | "line" } } = {}): OcrService {
  return new OcrService({ assetsRoot, cacheRoot, runner, ...options });
}

const signal = new AbortController().signal;

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "wordless-ocr-service-"));
  assetsRoot = join(sandbox, "resources/ocr");
  cacheRoot = join(sandbox, "ocr-cache");
  await prepareAssets();
  await writeFile(join(sandbox, "shot.png"), Buffer.from("fake-png-bytes"));
});

after(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

beforeEach(async () => {
  calls = [];
  await rm(cacheRoot, { recursive: true, force: true });
});

describe("OcrService.status", () => {
  it("标记为 skipped 时说未就绪(这是正常状态,不是错误)", async () => {
    await prepareAssets("skipped");
    const status = await service().status();
    assert.equal(status.available, false);
    assert.match(status.detail, /not bundled/);
    await prepareAssets();
  });

  it("资产缺一个文件时也说未就绪,并指出缺的是哪个", async () => {
    await prepareAssets();
    await rm(join(assetsRoot, "models/ppocrv5_rec.onnx"));
    const status = await service().status();
    assert.equal(status.available, false);
    assert.match(status.detail, /ppocrv5_rec\.onnx/);
    await prepareAssets();
  });

  it("就绪时给出模型集", async () => {
    await prepareAssets();
    const status = await service().status();
    assert.equal(status.available, true);
    assert.equal(status.modelSet, "ppocrv5");
  });
});

describe("OcrService.recognize", () => {
  it("第一次识别走运行器,第二次同样字节直接命中缓存", async () => {
    const image = { path: join(sandbox, "shot.png"), name: "shot.png", mimeType: "image/png" };
    const first = await service().recognize([image], { signal });
    assert.equal(first.ok, true);
    assert.equal(calls.length, 1);
    if (first.ok) {
      assert.equal(first.recognition.cached, false);
      assert.equal(first.recognition.pages[0]?.text, "text of shot.png");
      assert.equal(first.recognition.pages[0]?.path, image.path);
    }

    // **这是这条测试的重点**:附件每轮都会重新水合,没有缓存就会把同一张图反复 OCR。
    const second = await service().recognize([image], { signal });
    assert.equal(second.ok, true);
    assert.equal(calls.length, 1, "第二次不该再起运行器");
    if (second.ok) assert.equal(second.recognition.cached, true);
  });

  it("换一份字节就要重新识别(缓存键是内容,不是路径)", async () => {
    const image = { path: join(sandbox, "shot.png"), name: "shot.png", mimeType: "image/png" };
    await service().recognize([image], { signal });
    await writeFile(image.path, Buffer.from("different-bytes"));
    const second = await service().recognize([image], { signal });
    assert.equal(second.ok, true);
    assert.equal(calls.length, 2);
  });

  it("资产未就绪时直接返回 assets-missing,不碰运行器", async () => {
    await prepareAssets("skipped");
    const outcome = await service().recognize(
      [{ path: join(sandbox, "shot.png"), name: "shot.png", mimeType: "image/png" }],
      { signal },
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "assets-missing");
    assert.equal(calls.length, 0);
    await prepareAssets();
  });

  it("图太大就拒绝,并说清上限", async () => {
    const outcome = await service({ maxBytesPerImage: 4 }).recognize(
      [{ path: join(sandbox, "shot.png"), name: "shot.png", mimeType: "image/png" }],
      { signal },
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.message, /larger than/);
    assert.equal(calls.length, 0);
  });

  it("读不到的文件如实报错,不静默跳过", async () => {
    const outcome = await service().recognize(
      [{ path: join(sandbox, "missing.png"), name: "missing.png", mimeType: "image/png" }],
      { signal },
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(outcome.message, /Cannot read/);
  });
});

describe("OcrService 的选项(缓存开关与粒度)", () => {
  it("关掉缓存:同一张图会重新识别,而且不落盘", async () => {
    const image = { path: join(sandbox, "shot.png"), name: "shot.png", mimeType: "image/png" };
    const disabled = () => service({ readOptions: () => ({ cache: false, granularity: "text" }) });
    await disabled().recognize([image], { signal });
    const second = await disabled().recognize([image], { signal });

    assert.equal(calls.length, 2, "关掉缓存就该每次都真识别");
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.recognition.cached, false);
    // 也不该写缓存文件 —— "关掉"的意思就是别落盘。
    const entries = await readdir(cacheRoot).catch(() => []);
    assert.deepEqual(entries, []);
  });

  it("粒度从偏好透传给运行器", async () => {
    const image = { path: join(sandbox, "shot.png"), name: "shot.png", mimeType: "image/png" };
    await service({ readOptions: () => ({ cache: true, granularity: "line" }) }).recognize([image], { signal });
    assert.equal(calls.at(-1)?.granularity, "line");
  });

  it("调用方显式给的粒度优先于偏好", async () => {
    const image = { path: join(sandbox, "shot.png"), name: "shot.png", mimeType: "image/png" };
    await service({ readOptions: () => ({ cache: true, granularity: "line" }) }).recognize([image], { signal, granularity: "text" });
    assert.equal(calls.at(-1)?.granularity, "text");
  });
});
