import { BrowserWindow, type NativeImage } from "electron";
import { encodeRasterImage } from "./raster-port.ts";
import type {
  OffscreenEvaluatePort,
  OffscreenEvaluateRequest,
  OffscreenEvaluateResult,
  RasterPort,
  RasterRequest,
  RasterResult,
} from "./raster-port.ts";

/**
 * 用 Electron 内置离屏渲染光栅化设计帧。
 *
 * 这是 P3 相对参考实现最大的性能杠杆:参考实现要宿主提供一个离屏截图服务,而 Electron
 * 自带 —— `webPreferences.offscreen` + `paint` 事件直接给出 `NativeImage`。
 *
 * 三个关键性质(官方文档):
 *
 * 1. **事件驱动,不是轮询** —— "when there is nothing happening on a webpage, no frames
 *    are generated"。空闲帧零成本。
 * 2. **只传脏矩形** —— 增量更新。
 * 3. `useSharedTexture` 可走 GPU 共享纹理,但**需要原生模块**,所以这里走默认的 CPU
 *    共享位图。GPU 路径留作后续开关,不在这一阶段承诺。
 *
 * ## 设备像素比:当前按 1 倍光栅
 *
 * `RasterRequest.pixelRatio` 会被接收但不生效。原因是 Electron 的离屏渲染**没有直接的
 * per-window 设备像素比**:`webContents.setZoomFactor` 会**重排布局**,而设计稿在固定
 * 声明尺寸下不能重排(390 宽的帧被当成 780 宽渲染,版面就错了)。
 *
 * 正确的路径是 CDP 的 `Emulation.setDeviceMetricsOverride({ deviceScaleFactor })`,它只改
 * 设备度量、不改布局。我没有在不运行 Electron 的情况下验证过它,所以**没有把它写进来** ——
 * 写一个未经验证的路径比暂时按 1 倍更糟。表现是 Retina 上 100% 缩放时位图略软;
 * 帧在画布上被放大时更明显。
 *
 * ## 复用
 *
 * 离屏窗口**复用**,不是每帧一个:每个窗口是一个真实渲染进程,一帧一个的话打开 40 帧的
 * 设计会反复起停 40 个进程。取用是"有空闲就拿来用,没有就新建",上限由调用方(池)的
 * 并发数决定。
 */

/** JPEG 质量。UI 截图里有大片纯色与文字,质量低了文字边缘会糊。 */
const JPEG_QUALITY = 90;

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
      const image = await this.loadAndPaint(window, request, signal);
      if (image === null) return { ok: false, key: request.key, code: "load-failed" };
      const bytes = encodeRasterImage(image, request.format, JPEG_QUALITY);
      if (bytes.byteLength === 0) return { ok: false, key: request.key, code: "capture-failed" };
      const size = image.getSize();
      return {
        ok: true,
        key: request.key,
        bytes: Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>,
        width: size.width,
        height: size.height,
      };
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

  private async loadAndPaint(
    window: BrowserWindow,
    request: RasterRequest,
    signal: AbortSignal,
  ): Promise<NativeImage | null> {
    const contents = window.webContents;
    if (contents.isDestroyed()) return null;

    window.setContentSize(Math.round(request.width), Math.round(request.height));

    const loaded = waitForLoad(contents);
    await contents.loadURL(request.url).catch(() => undefined);
    const loadedOk = await loaded;
    if (!loadedOk || signal.aborted) return null;

    // 加载完成不等于画完:字体、图片、布局还要落定。等一小会儿再取下一帧。
    await delay(SETTLE_MS);
    if (signal.aborted) return null;

    return await waitForPaint(contents, signal);
  }

  private release(window: BrowserWindow): void {
    if (this.disposed || window.isDestroyed()) {
      this.destroyWindow(window);
      return;
    }

    /**
     * **这里刻意不调 `stopPainting()`。**
     *
     * 原来的理由是"页面若有动画,继续画下去只是白白占 CPU"。但代价是致命的:
     * `stopPainting()` 会让**下一次**复用该窗口的截图画出一张**空位图**,而空位图在
     * 调用方那里只能表示成 `capture-failed` —— 而 `release()` 每次都会停,于是**每一次**
     * 复用窗口的截图都失败。
     *
     * 实测(同一窗口、同一页面、每次重新 load 之后取一帧):
     *
     * ```
     * ① 首次              jpegBytes=3610
     * ② 再取(未停)        jpegBytes=3610
     * ③ stopPainting 后复用 jpegBytes=0     ← 空图
     * ④ 再复用            jpegBytes=3610
     * ```
     *
     * 设计帧是静态文档,离屏渲染又是事件驱动的("nothing happening → no frames"),所以那点
     * CPU 节省本来就是理论上的;而一张空图换来的是画布整片占位卡、agent 拿不到像素、
     * 转而反复跑布局探针。**宁可多出几帧,也不要一张空图。**
     *
     * 窗口在 `dispose()` 与 `destroyWindow()` 里照常销毁 —— 该省的地方省在那里。
     */
    this.idle.push(window);
  }

  private destroyWindow(window: BrowserWindow): void {
    this.live = Math.max(0, this.live - 1);
    if (window.isDestroyed()) return;
    try {
      window.webContents.stopPainting();
    } catch {
      // 已经停了就算了。
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

/**
 * 等下一帧**有效**的位图。
 *
 * 必须在加载完成**之后**挂监听:离屏视图在导航开始时就会出一帧(白底),那是空页面,
 * 拿它当结果会得到一张白图。
 *
 * **空位图不算一帧。** `paint` 事件把位图交给我们就叫"到达",但"到达"不等于"有效" ——
 * 空图会让调用方把它记成一次失败(`toJPEG` 返回 0 字节 → `capture-failed`),或者更糟,
 * 被当成一张真图贴到画布上。所以这里跳过空图继续等,由调用方的超时来兜底。
 */
function waitForPaint(contents: Electron.WebContents, signal: AbortSignal): Promise<NativeImage | null> {
  return new Promise<NativeImage | null>((resolve) => {
    let settled = false;
    const finish = (value: NativeImage | null) => {
      if (settled) return;
      settled = true;
      contents.off("paint", onPaint);
      contents.off("destroyed", onDestroyed);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onPaint = (_event: unknown, _dirty: unknown, image: NativeImage) => {
      if (image.isEmpty()) return; // 空图:继续等下一帧。
      finish(image);
    };
    const onDestroyed = () => finish(null);
    const onAbort = () => finish(null);

    contents.on("paint", onPaint);
    contents.once("destroyed", onDestroyed);
    signal.addEventListener("abort", onAbort, { once: true });
    // 让已经暂停出帧的视图重新开始,否则这一帧永远不来。
    try {
      contents.startPainting();
      contents.invalidate();
    } catch {
      finish(null);
    }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
