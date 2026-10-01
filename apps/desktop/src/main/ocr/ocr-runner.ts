import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import { randomUUID } from "node:crypto";
import { OCR_CHANNELS, type OcrFailureCode, type OcrGranularity, type OcrProgressEvent, type OcrRunnerImage, type OcrRunnerResult } from "../../ocr-runner/ocr-bridge";

/**
 * OCR 运行器的宿主:一个隐藏窗口 + 一次一个任务。
 *
 * 与 `design/electron-offscreen-raster.ts` 同源(同样是常驻窗口 + 空闲回收),差别在**任务
 * 模型**:光栅化是"装一帧、截一张、扔页面",OCR 是"窗口常驻、引擎常热、反复识别"。
 *
 * 三条纪律:
 * - **一次一个任务**。OCR 吃 CPU 与内存,并发只会互相拖慢(wasm 自己已经在吃多核)。
 * - **失败是返回值,不是异常**(`{ ok: false, code }`)。缺资产、超时、取消都是正常结局。
 * - **超时/取消就销毁窗口**。卡死的引擎不可信,留着只会让下一次也卡在同一处。
 *
 * 渲染器 → 主进程的消息走 `ipcMain`(而不是 `webContents.on`):四个监听器在构造时注册一次、
 * `dispose()` 时摘掉,并且**按 sender 过滤** —— 别的窗口(或页面里的第三方脚本)不该能冒充
 * 运行器交结果。
 */

export interface OcrRunnerImageInput {
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export type OcrRunnerOutcome =
  | { ok: true; result: OcrRunnerResult }
  | { ok: false; code: OcrFailureCode; message: string };

export interface OcrRunnerRequestOptions {
  signal: AbortSignal;
  onProgress?: (event: OcrProgressEvent) => void;
  /** 省略 = `text`。 */
  granularity?: OcrGranularity;
}

export interface OcrRunnerPort {
  recognize(images: OcrRunnerImageInput[], options: OcrRunnerRequestOptions): Promise<OcrRunnerOutcome>;
}

export interface ElectronOcrRunnerOptions {
  /** 运行器页面地址(`wordless-ocr://runner/index.html`)。 */
  entryUrl: string;
  /** 运行器 preload 的绝对路径。 */
  preload: string;
  /** 空闲多久销毁窗口(连同引擎)。省略 = 5 分钟;`0` = 不销毁(只给测试用)。 */
  idleMs?: number;
  /** 单次任务的墙钟上限。默认 60 秒:一张 A4 扫描件在单线程 wasm 上也可能要十几秒。 */
  timeoutMs?: number;
  /** 等页面 ready 的上限。默认 15 秒(页面加载不出来时不能无限等)。 */
  readyTimeoutMs?: number;
}

const DEFAULT_IDLE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_READY_TIMEOUT_MS = 15_000;

interface PendingTask {
  sessionId: string;
  onProgress?: (event: OcrProgressEvent) => void;
  signal: AbortSignal;
  settle: (outcome: OcrRunnerOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort: () => void;
}

export class ElectronOcrRunner implements OcrRunnerPort {
  private window: BrowserWindow | null = null;
  private readyResolve: ((ready: boolean) => void) | undefined;
  private pending: PendingTask | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** 任务串行:上一个跑完才轮到下一个。 */
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly options: ElectronOcrRunnerOptions;
  private readonly listeners: Array<{ channel: string; listener: Parameters<typeof ipcMain.on>[1] }> = [];

  constructor(options: ElectronOcrRunnerOptions) {
    this.options = options;
    this.listen(OCR_CHANNELS.ready, (event, sessionId: string) => {
      if (!this.fromRunner(event)) return;
      void sessionId;
      this.readyResolve?.(true);
    });
    this.listen(OCR_CHANNELS.progress, (event, sessionId: string, progress: OcrProgressEvent) => {
      if (!this.fromRunner(event)) return;
      if (this.pending?.sessionId !== sessionId) return;
      this.pending.onProgress?.(progress);
    });
    this.listen(OCR_CHANNELS.done, (event, sessionId: string, result: OcrRunnerResult) => {
      if (!this.fromRunner(event)) return;
      if (this.pending?.sessionId !== sessionId) return;
      this.pending.settle({ ok: true, result });
    });
    this.listen(OCR_CHANNELS.error, (event, sessionId: string, code: OcrFailureCode, message: string) => {
      if (!this.fromRunner(event)) return;
      if (this.pending?.sessionId !== sessionId) return;
      this.pending.settle({ ok: false, code, message });
    });
  }

  recognize(images: OcrRunnerImageInput[], options: OcrRunnerRequestOptions): Promise<OcrRunnerOutcome> {
    if (this.disposed) return Promise.resolve({ ok: false, code: "pipeline-error", message: "OCR runner is disposed" });
    const task = this.queue.then(() => this.runOnce(images, options));
    // 队列不因为一次失败而断掉:下一个任务照跑。
    this.queue = task.catch(() => undefined);
    return task;
  }

  dispose(): void {
    this.disposed = true;
    for (const { channel, listener } of this.listeners) ipcMain.removeListener(channel, listener);
    this.listeners.length = 0;
    this.destroyWindow();
  }

  private listen(channel: string, listener: Parameters<typeof ipcMain.on>[1]): void {
    ipcMain.on(channel, listener);
    this.listeners.push({ channel, listener });
  }

  private fromRunner(event: IpcMainEvent): boolean {
    const window = this.window;
    return window !== null && !window.isDestroyed() && event.sender === window.webContents;
  }

  private async runOnce(images: OcrRunnerImageInput[], options: OcrRunnerRequestOptions): Promise<OcrRunnerOutcome> {
    if (options.signal.aborted) return { ok: false, code: "cancelled", message: "Cancelled before the request started" };
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }

    const window = await this.ensureWindow();
    if (window === null || window.isDestroyed()) {
      return { ok: false, code: "engine-init-failed", message: "The OCR runner window could not be created" };
    }

    const sessionId = `ocr-${process.pid}-${randomUUID()}`;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise<OcrRunnerOutcome>((resolve) => {
      const settle = (outcome: OcrRunnerOutcome): void => {
        const pending = this.pending;
        if (pending === null || pending.sessionId !== sessionId) return;
        clearTimeout(pending.timer);
        pending.signal.removeEventListener("abort", pending.onAbort);
        this.pending = null;
        this.scheduleIdle();
        resolve(outcome);
      };

      const onAbort = (): void => {
        // 卡在识别里的窗口不会自己恢复:销毁它,下一次任务会拿到一个干净的窗口。
        this.destroyWindow();
        settle({ ok: false, code: "cancelled", message: "Cancelled" });
      };

      const timer = setTimeout(() => {
        this.destroyWindow();
        settle({ ok: false, code: "timeout", message: `OCR timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      this.pending = { sessionId, onProgress: options.onProgress, signal: options.signal, settle, timer, onAbort };
      options.signal.addEventListener("abort", onAbort, { once: true });

      // 图片字节走结构化克隆(会拷一份):`webContents.postMessage` 的 transfer 列表只接受
      // MessagePort,不接受 ArrayBuffer。几 MB 的拷贝相对一次识别(百毫秒起)可以忽略。
      window.webContents.postMessage(OCR_CHANNELS.start, {
        sessionId,
        images: images as OcrRunnerImage[],
        granularity: options.granularity ?? "text",
      });
    });
  }

  private async ensureWindow(): Promise<BrowserWindow | null> {
    // 已经起来的窗口当初就是等到 ready 才返回的,不必再等一次。
    if (this.window !== null && !this.window.isDestroyed()) return this.window;

    const window = new BrowserWindow({
      show: false,
      width: 512,
      height: 512,
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // 页面来自我们自己的协议,不需要为了 CORS 关掉它(open-vetta 的 file:// 才需要)。
        webSecurity: true,
        // 隐藏窗口默认会被降频,而这里跑的是真活:降频会让一次识别慢好几倍。
        backgroundThrottling: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    // 运行器页面里的 `[ocr] …` 日志默认**看不到**:它在隐藏窗口的控制台里。排查时把
    // `WORDLESS_OCR_DEBUG=1` 打开就镜像到 stderr —— 模型加载、识别耗时、失败原因都在那几行里。
    if (process.env.WORDLESS_OCR_DEBUG === "1") {
      window.webContents.on("console-message", (_event, _level, message) => console.error(`[ocr-runner] ${message}`));
    }
    this.window = window;
    window.on("closed", () => {
      if (this.window === window) {
        this.window = null;
        this.readyResolve?.(false);
        this.readyResolve = undefined;
      }
    });

    const loaded = window.webContents.loadURL(`${this.options.entryUrl}?sessionId=boot`).then(
      () => true,
      () => false,
    );
    const ready = new Promise<boolean>((resolve) => {
      this.readyResolve = resolve;
      setTimeout(() => resolve(false), this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS);
    });
    const [loadedOk, readyOk] = await Promise.all([loaded, ready]);
    this.readyResolve = undefined;
    if (!loadedOk || !readyOk) {
      // 页面没起来(运行器 bundle 没打出来、资产缺失、preload 没挂上):如实失败,别假装。
      this.destroyWindow();
      return null;
    }
    return this.window;
  }

  private scheduleIdle(): void {
    const idleMs = this.options.idleMs ?? DEFAULT_IDLE_MS;
    if (idleMs <= 0) return;
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.destroyWindow();
    }, idleMs);
  }

  private destroyWindow(): void {
    const window = this.window;
    this.window = null;
    this.readyResolve?.(false);
    this.readyResolve = undefined;
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (window === null || window.isDestroyed()) return;
    window.destroy();
  }
}
