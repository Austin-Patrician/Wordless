import { BrowserWindow } from "electron";
import { imagePixelSize, rasterCaptureParams } from "./raster-port.ts";
import type {
  OffscreenEvaluatePort,
  OffscreenEvaluateRequest,
  OffscreenEvaluateResult,
  RasterPort,
  RasterRequest,
  RasterResult,
} from "./raster-port.ts";

/**
 * 光栅化设计帧:一个离屏窗口装一帧,截一张图。
 *
 * 窗口仍然用 `webPreferences.offscreen`(不占屏幕、不抢焦点),但**取图不再走 `paint`
 * 事件** —— 那条路的位图被钉在 1 倍,而且实测过 `stopPainting()` 会让下一次复用的截图变成
 * 一张**空位图**(见 `release()`)。现在走 CDP 的 `Page.captureScreenshot`:倍率确定、
 * 编码格式可选(PNG 给导出、JPEG 给画布),也不再需要出帧/停帧那套状态机。
 *
 * ## 设备像素比:走 CDP 的 `clip.scale`
 *
 * 这里曾经写着"按 1 倍光栅,因为离屏渲染没有 per-window 设备像素比"。实测下来那不是
 * "做不到",而是**一开始就选错了取图方式**:
 *
 * | 取图方式 | 390×844 的页面得到 | 能否指定倍率 |
 * |---|---|---|
 * | 离屏 `paint` 位图 | 390×844 | ❌ 与 DPR 无关,永远 1 倍 |
 * | `webContents.capturePage()` | 780×1688 | ❌ 跟着**显示器**走(Retina 就是 2 倍) |
 * | **CDP `Page.captureScreenshot` + `clip.scale`** | 1→390×844 · 2→780×1688 · 3→1170×2532 | ✅ **确定性** |
 *
 * `clip.scale` 的字节数随像素数增长(6KB→15KB→28KB)= **真的重新光栅,不是放大**。
 * `Emulation.setDeviceMetricsOverride` 也不改布局(`innerWidth` 始终 390),但导出用不着它 ——
 * `clip.scale` 更直接。
 *
 * **窗口尺寸仍然是帧的声明尺寸,不乘倍率。** 倍数只能来自 `clip.scale`:改窗口尺寸会让页面
 * 按新视口**重排**,导出的图比页面大一圈、周边留白(`handlers.ts` 里踩过)。
 *
 * 于是 `RasterRequest.pixelRatio`(画布的缩放档位)真的生效了:2 倍档位贴的就是 2 倍图。
 *
 * ## 复用
 *
 * 离屏窗口**复用**,不是每帧一个:每个窗口是一个真实渲染进程,一帧一个的话打开 40 帧的
 * 设计会反复起停 40 个进程。取用是"有空闲就拿来用,没有就新建",上限由调用方(池)的
 * 并发数决定。
 */

/** CDP 协议版本。与 `browser-cdp.ts` 用同一版。 */
const CDP_PROTOCOL_VERSION = "1.3";

/** 加载完成之后再多等一会儿,让字体、图片、布局落定。 */
const SETTLE_MS = 60;

export interface ElectronOffscreenRasterOptions {
  /** 同时允许存在的离屏窗口上限。超过时等待空闲窗口。 */
  maxWindows?: number;
}

export class ElectronOffscreenRaster implements RasterPort, OffscreenEvaluatePort {
  private readonly idle: BrowserWindow[] = [];
  private readonly maxWindows: number;
  private live = 0;
  private disposed = false;

  constructor(options: ElectronOffscreenRasterOptions = {}) {
    this.maxWindows = Math.max(1, Math.floor(options.maxWindows ?? 2));
  }

  async capture(request: RasterRequest, signal: AbortSignal): Promise<RasterResult> {
    if (signal.aborted) return { ok: false, key: request.key, code: "cancelled" };

    const window = await this.acquire(signal);
    if (window === null) return { ok: false, key: request.key, code: "cancelled" };

    let handedBack = false;
    const onAbort = () => {
      if (handedBack) return;
      handedBack = true;
      // 取消时直接销毁:这个窗口的页面可能已经卡住,回收它会把卡顿带给下一个请求。
      this.destroyWindow(window);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      if (!(await this.loadFrame(window, request, signal))) {
        return { ok: false, key: request.key, code: "load-failed" };
      }
      const bytes = await this.captureScreenshot(window, request, signal);
      if (bytes === null) return { ok: false, key: request.key, code: "capture-failed" };
      // 尺寸**读回来**,不靠 width × scale 算:算出来的值一旦与编码器差一个像素,
      // 画布上就会半像素错位(位图被贴进一个尺寸不符的槽)。
      const size = imagePixelSize(bytes);
      if (size === null) return { ok: false, key: request.key, code: "capture-failed" };
      return { ok: true, key: request.key, bytes, width: size.width, height: size.height };
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (!handedBack) {
        handedBack = true;
        this.release(window);
      }
    }
  }

  /**
   * 在离屏视图里跑一段表达式。
   *
   * 与 `capture` 共用同一套窗口生命周期 —— 复用是这里的重点:每个离屏窗口是一个真实
   * 渲染进程,为探针另起一套生命周期会翻倍。
   */
  async evaluate(request: OffscreenEvaluateRequest, signal: AbortSignal): Promise<OffscreenEvaluateResult> {
    if (signal.aborted) return { ok: false, code: "evaluate-failed" };

    const window = await this.acquire(signal);
    if (window === null) return { ok: false, code: "evaluate-failed" };

    let handedBack = false;
    const onAbort = () => {
      if (handedBack) return;
      handedBack = true;
      this.destroyWindow(window);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      const contents = window.webContents;
      if (contents.isDestroyed()) return { ok: false, code: "load-failed" };
      window.setContentSize(Math.round(request.width), Math.round(request.height));

      const loaded = waitForLoad(contents);
      await contents.loadURL(request.url).catch(() => undefined);
      const loadedOk = await loaded;
      if (!loadedOk || signal.aborted) return { ok: false, code: "load-failed" };

      // 与截图同一个理由:加载完成不等于画完,而布局探针量的正是画完之后的几何。
      await delay(SETTLE_MS);
      if (signal.aborted) return { ok: false, code: "evaluate-failed" };

      try {
        const value = await contents.executeJavaScript(request.expression, true);
        return { ok: true, value };
      } catch {
        return { ok: false, code: "evaluate-failed" };
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (!handedBack) {
        handedBack = true;
        this.release(window);
      }
    }
  }

  /** 关掉所有空闲窗口。应用退出或设计全部关闭时调用。 */
  dispose(): void {
    this.disposed = true;
    for (const window of this.idle.splice(0)) this.destroyWindow(window);
  }

  private async acquire(signal: AbortSignal): Promise<BrowserWindow | null> {
    for (;;) {
      if (this.disposed || signal.aborted) return null;
      const reused = this.idle.pop();
      if (reused !== undefined) {
        if (!reused.isDestroyed()) return reused;
        this.live = Math.max(0, this.live - 1);
        continue;
      }
      if (this.live < this.maxWindows) {
        this.live += 1;
        return this.createWindow();
      }
      // 没有空闲窗口且已达上限:等一个被归还。池的并发数通常不会超过这里的上限,
      // 所以这条路径只在配置不一致时走到。
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        // 设计帧是用户与 agent 写的 HTML:与浏览器面板的访客同级,按最不可信的面处理。
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // 刻意不给 preload:页面脚本永远够不到 `window.wordless`。
      },
    });
    // 不允许开新窗口:这是离屏视图,没有窗口可开。
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    return window;
  }

  /** 把页面装进这个窗口,并等它排完版。 */
  private async loadFrame(window: BrowserWindow, request: RasterRequest, signal: AbortSignal): Promise<boolean> {
    const contents = window.webContents;
    if (contents.isDestroyed()) return false;

    // **窗口尺寸就是帧的声明尺寸,不乘倍率。** 倍率走 CDP 的 `clip.scale`;改窗口尺寸会让
    // 页面按新视口重排,导出的图比页面大一圈(见类文档)。
    window.setContentSize(Math.round(request.width), Math.round(request.height));

    const loaded = waitForLoad(contents);
    await contents.loadURL(request.url).catch(() => undefined);
    const loadedOk = await loaded;
    if (!loadedOk || signal.aborted) return false;

    // 加载完成不等于画完:字体、图片、布局还要落定。CDP 的截图取的是"当前帧"。
    await delay(SETTLE_MS);
    return !signal.aborted;
  }

  /**
   * 取一帧,按 `pixelRatio` 出图。
   *
   * 失败一律返回 null(由调用方归成 `capture-failed`),而不是抛:一次截图的失败不该让
   * 池里的那一批整体炸掉。
   */
  private async captureScreenshot(
    window: BrowserWindow,
    request: RasterRequest,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer> | null> {
    const inspector = window.webContents.debugger;
    try {
      if (!inspector.isAttached()) inspector.attach(CDP_PROTOCOL_VERSION);
    } catch {
      // 有别的调试器挂着(理论上不该发生 —— 这些窗口是我们自己的)。照实失败。
      return null;
    }

    const params = rasterCaptureParams(request);
    try {
      const result = (await inspector.sendCommand("Page.captureScreenshot", {
        format: params.format,
        ...(params.quality === undefined ? {} : { quality: params.quality }),
        clip: params.clip,
        // 只要视口那一块:设计帧本来就是一个固定尺寸的画板。
        captureBeyondViewport: false,
      })) as { data: string };
      if (signal.aborted) return null;
      return new Uint8Array(Buffer.from(result.data, "base64")) as Uint8Array<ArrayBuffer>;
    } catch {
      return null;
    }
  }

  private release(window: BrowserWindow): void {
    if (this.disposed || window.isDestroyed()) {
      this.destroyWindow(window);
      return;
    }

    /**
    /**
     * 归还就是放回空闲列表 —— **不做任何"暂停"动作**。
     *
     * 这里曾经调 `stopPainting()`(理由是"页面有动画的话白占 CPU"),而它会让**下一次**
     * 复用该窗口的截图变成一张**空位图**:实测 ① 3610 → ② 3610 → ③ 停过之后 **0** → ④ 3610。
     * 因为 `release()` 每次都会停,于是**每一次**复用窗口的截图都失败 —— 画布整片占位卡、
     * agent 拿不到像素。取图改走 CDP 之后,出帧/停帧这套状态机整个不需要了。
     *
     * 窗口在 `dispose()` 与 `destroyWindow()` 里照常销毁 —— 该省的地方省在那里。
     */
    this.idle.push(window);
  }

  private destroyWindow(window: BrowserWindow): void {
    this.live = Math.max(0, this.live - 1);
    if (window.isDestroyed()) return;
    // 调试器随窗口一起消失;显式解开是为了在销毁前就把通道放掉。
    try {
      if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    } catch {
      // 窗口已经开始销毁了,那就算了。
    }
    window.destroy();
  }
}

function waitForLoad(contents: Electron.WebContents): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const done = (value: boolean) => {
      contents.off("did-finish-load", onFinish);
      contents.off("did-fail-load", onFail);
      resolve(value);
    };
    const onFinish = () => done(true);
    const onFail = () => done(false);
    contents.once("did-finish-load", onFinish);
    contents.once("did-fail-load", onFail);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
