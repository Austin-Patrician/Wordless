import { OcrEngine } from "@ocr-web/core";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * 端到端:**用真的 PP-OCRv5 模型 + 真的 onnxruntime-web 认一张我们自己画的图**。
 *
 * 为什么值得付这个代价(加载 21.5MB 模型 + 12.8MB wasm,冷启动几秒):这是唯一能证明
 * "内置的这套资产 + 这一版运行时"真的出字的验证。假引擎的测试只能证明我们的代码把参数
 * 传对了,证明不了资产能用 —— 而资产版本错配正是这条路上最典型的崩法。
 *
 * 资产由 `vitest.thread-browser.config.ts` 里的 `serveOcrAssets` 挂在 `/ocr/*` 上(同一套
 * 文件、同样的 `wasmPaths` 机制,只是把 `wordless-ocr://` 换成 http)。
 */

const DETECTION = "/ocr/models/ppocrv5_det.onnx";
const RECOGNITION = "/ocr/models/ppocrv5_rec.onnx";
const DICTIONARY = "/ocr/models/ppocrv5_dict.txt";
const ORT = "/ocr/ort/";

/** 冷启动很慢:加载 + 编译 wasm。超时给足,别让它变成一个"随机失败"的测试。 */
const COLD_TIMEOUT_MS = 120_000;

function drawText(lines: string[]): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 260;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  // 用无衬线大字:PP-OCRv5 是给印刷体/截图训练的,小字或手写体会掉识别率,那是模型能力问题,
  // 不是这条测试要验的东西。
  context.font = "bold 64px sans-serif";
  lines.forEach((line, index) => {
    context.fillText(line, 40, 100 + index * 90);
  });
  return canvas;
}

describe("OCR 引擎(真模型)", () => {
  let engine: OcrEngine;
  let loadMs = 0;

  beforeAll(async () => {
    const startedAt = performance.now();
    engine = await OcrEngine.create({
      models: { detection: DETECTION, recognition: RECOGNITION },
      dictionary: DICTIONARY,
      runtime: "wasm",
      wasmPaths: ORT,
      // vitest 的 dev server 不发 COOP/COEP,所以这里拿不到 SharedArrayBuffer —— 与
      // 运行器页面里 `crossOriginIsolated ? 2 : 1` 的退化路径一致。
      numThreads: 1,
    });
    loadMs = Math.round(performance.now() - startedAt);
  }, COLD_TIMEOUT_MS);

  it("识别一张自己画的图,并报出冷/热耗时", { timeout: COLD_TIMEOUT_MS }, async () => {
    const canvas = drawText(["Wordless OCR", "settings environment"]);

    const coldStartedAt = performance.now();
    const cold = await engine.recognize(canvas);
    const coldMs = Math.round(performance.now() - coldStartedAt);

    const warmStartedAt = performance.now();
    const warm = await engine.recognize(canvas);
    const warmMs = Math.round(performance.now() - warmStartedAt);

    // 打印出来是为了让"这套资产到底多快"有据可查 —— 数字会进 docs/architecture/ocr.md。
    console.log(`[ocr] load=${loadMs}ms cold=${coldMs}ms warm=${warmMs}ms lines=${cold.lines.length} text=${JSON.stringify(cold.fullText)}`);

    // 断言放宽:OCR 会在标点、大小写上出错,但**词**必须出来 —— 出不来就说明资产/运行时不对。
    const text = cold.fullText.toLowerCase();
    expect(text).toContain("wordless");
    expect(text).toContain("ocr");
    expect(text).toContain("environment");
    expect(cold.lines.length).toBeGreaterThan(0);
    // 热态必须更快:引擎没被重建(这条同时钉住"引擎保持热"这个设计)。
    expect(warm.durationMs).toBeLessThanOrEqual(cold.durationMs + 5);
    expect(loadMs).toBeGreaterThan(0);
  });
});
