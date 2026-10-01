import { OcrEngine, type OcrResult } from "@ocr-web/core";
import {
  OCR_BRIDGE_KEY,
  type OcrFailureCode,
  type OcrRunnerPage,
  type OcrRunnerRequest,
  type OcrRunnerResult,
  type WordlessOcrBridge,
} from "./ocr-bridge";

/**
 * OCR 运行器页面。
 *
 * 跑在一个隐藏窗口里,由主进程喂图片字节、收回文字。几处刻意的选择:
 *
 * - **引擎保持热**:`@ocr-web/core` 建引擎要加载 21.5MB 的 ONNX 并编译 wasm,是一次性的
 *   大开销。open-vetta 的 runner 每次会话新建窗口、`finally` 里 dispose 引擎 —— 于是**每次
 *   OCR 都冷启动**。这里相反:引擎建好就留着,只在一个**空闲计时**到了之后才卸(见 IDLE_MS),
 *   窗口本身也由宿主池复用。
 * - **线程数看 `crossOriginIsolated`**:多线程 WASM 需要 SharedArrayBuffer,而那要求页面处于
 *   跨源隔离状态(响应头带 COOP/COEP)。协议那边已经带上了,但**这里不假设它一定生效** ——
 *   拿不到隔离就退回单线程,并在 engine 串里如实标注。
 * - **不写文件**:运行器只返回文字。落盘、缓存、去重全在主进程(`ocr-service`),因为那里才
 *   知道会话与工作区的边界。
 */

const MODELS_BASE = "wordless-ocr://assets/models/";
const ORT_BASE = "wordless-ocr://assets/ort/";
const DETECTION_URL = `${MODELS_BASE}ppocrv5_det.onnx`;
const RECOGNITION_URL = `${MODELS_BASE}ppocrv5_rec.onnx`;
const DICTIONARY_URL = `${MODELS_BASE}ppocrv5_dict.txt`;

/** 空闲多久卸载引擎。5 分钟:一次会话里连着贴几张图不会反复冷启动,长时间不用则把内存还回去。 */
const IDLE_MS = 5 * 60_000;

const logElement = document.getElementById("log");
function log(line: string): void {
  if (logElement) logElement.textContent = `${logElement.textContent ?? ""}${line}\n`;
  // 走 Electron 的 console-message 监听,宿主按需决定要不要镜像到 stderr。
  console.log(`[ocr] ${line}`);
}

const bridge = (globalThis as unknown as Record<string, unknown>)[OCR_BRIDGE_KEY] as WordlessOcrBridge | undefined;

let engine: OcrEngine | null = null;
let enginePromise: Promise<{ engine: OcrEngine; loadMs: number }> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function threads(): number {
  // 隔离状态拿不到 SharedArrayBuffer,多线程只会失败(或静默退化成单线程)。
  return typeof SharedArrayBuffer === "function" && globalThis.crossOriginIsolated ? 2 : 1;
}

function engineLabel(): string {
  return `wordless-ocr/ppocrv5+ort-web-1.25.1+wasm${threads()}`;
}

function scheduleIdleDispose(): void {
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    void disposeEngine("idle");
  }, IDLE_MS);
}

async function disposeEngine(reason: string): Promise<void> {
  const current = engine;
  engine = null;
  enginePromise = null;
  if (!current) return;
  log(`disposing engine (${reason})`);
  await current.dispose().catch(() => undefined);
}

function engineFor(): Promise<{ engine: OcrEngine; loadMs: number }> {
  if (engine) return Promise.resolve({ engine, loadMs: 0 });
  if (enginePromise) return enginePromise;
  const startedAt = performance.now();
  log(`loading models (threads=${threads()}, isolated=${globalThis.crossOriginIsolated === true})`);
  enginePromise = OcrEngine.create({
    models: { detection: DETECTION_URL, recognition: RECOGNITION_URL },
    dictionary: DICTIONARY_URL,
    runtime: "wasm",
    wasmPaths: ORT_BASE,
    numThreads: threads(),
    onProgress: ({ loaded, total, file }) => log(`load ${file}: ${(loaded / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`),
  })
    .then((created) => {
      engine = created;
      const loadMs = Math.round(performance.now() - startedAt);
      log(`engine ready in ${loadMs}ms`);
      return { engine: created, loadMs };
    })
    .catch((cause: unknown) => {
      enginePromise = null;
      throw cause;
    });
  return enginePromise;
}

/**
 * 把 CTC 的平均 logit 粗映射到 0..1。
 *
 * 上游文档说 logit > 0 大致等于"可信",这里线性拉伸到 [0,1] —— 只用于相对比较,别卡阈值。
 */
function confidenceOf(lines: OcrResult["lines"]): number {
  if (lines.length === 0) return 0;
  const mean = lines.reduce((total, line) => total + line.confidence, 0) / lines.length;
  return Math.max(0, Math.min(1, (mean + 2) / 4));
}

async function canvasOf(image: { mimeType: string; bytes: ArrayBuffer }): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(new Blob([image.bytes], { type: image.mimeType }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Failed to obtain a 2D context");
  // 先铺白底:PNG 的透明区域在 OCR 里会被当成黑色,识别率会掉。
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/** 把任意异常归到失败分类上。资产的 404 与"引擎崩了"必须分开报。 */
function classify(cause: unknown): { code: OcrFailureCode; message: string } {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/fetch|404|Failed to load|net::|ERR_FILE_NOT_FOUND/i.test(message)) return { code: "assets-missing", message };
  if (/onnx|wasm|inference session|WebAssembly/i.test(message)) return { code: "engine-init-failed", message };
  return { code: "pipeline-error", message };
}

async function run(request: OcrRunnerRequest): Promise<void> {
  const startedAt = performance.now();
  let loadMs = 0;
  const pages: OcrRunnerPage[] = [];
  try {
    bridge?.reportProgress(request.sessionId, { page: 0, total: request.images.length, phase: "load" });
    const loaded = await engineFor();
    loadMs = loaded.loadMs;

    for (const [index, image] of request.images.entries()) {
      bridge?.reportProgress(request.sessionId, { page: index + 1, total: request.images.length, phase: "ocr" });
      let canvas: HTMLCanvasElement;
      try {
        canvas = await canvasOf(image);
      } catch (cause) {
        const { message } = classify(cause);
        throw Object.assign(new Error(`Cannot decode ${image.name}: ${message}`), { ocrCode: "decode-failed" });
      }
      const recognizedAt = performance.now();
      const result = await loaded.engine.recognize(canvas);
      pages.push({
        name: image.name,
        text: result.fullText.trim(),
        // 逐行只在用户要的时候回:`text` 档位下多出来的行信息对模型是噪声。
        lines: request.granularity === "line" ? result.lines.map((line) => ({ text: line.text, confidence: line.confidence })) : [],
        lineCount: result.lines.length,
        width: canvas.width,
        height: canvas.height,
        confidence: confidenceOf(result.lines),
        durationMs: Math.round(performance.now() - recognizedAt),
      });
      log(`${image.name}: ${result.lines.length} lines, ${result.fullText.trim().length} chars`);
      canvas.width = 0;
      canvas.height = 0;
    }

    bridge?.reportProgress(request.sessionId, { page: request.images.length, total: request.images.length, phase: "done" });
    const payload: OcrRunnerResult = {
      engine: engineLabel(),
      pages,
      totalDurationMs: Math.round(performance.now() - startedAt),
      loadMs,
    };
    bridge?.reportDone(request.sessionId, payload);
  } catch (cause) {
    const explicit = (cause as { ocrCode?: OcrFailureCode }).ocrCode;
    const { code, message } = classify(cause);
    log(`error: ${message}`);
    bridge?.reportError(request.sessionId, explicit ?? code, message);
  } finally {
    // 引擎**不**在这里 dispose:下一次识别应当复用。空闲计时负责回收。
    scheduleIdleDispose();
  }
}

function main(): void {
  const sessionId = new URL(globalThis.location.href).searchParams.get("sessionId");
  if (!sessionId) {
    log("missing sessionId");
    return;
  }
  if (!bridge) {
    log("wordlessOcr bridge is not exposed by the preload script");
    return;
  }
  bridge.onStart((request) => {
    void run(request);
  });
  bridge.notifyReady(sessionId);
  log(`ready: ${sessionId}`);
}

main();
