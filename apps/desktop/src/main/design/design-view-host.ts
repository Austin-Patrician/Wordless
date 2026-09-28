import { WebContentsView, type BrowserWindow } from "electron";
import { isDegenerateBounds, normalizeBounds, resolveVisibility, sameBounds, type ViewRect } from "../platform/view-bounds.ts";

/**
 * 设计画布的活体视图宿主。
 *
 * ## 为什么至多一个
 *
 * 原生视图**不能被 CSS 缩放**:`setBounds` 是整数屏幕矩形,而 `setZoomFactor` 是页面缩放、
 * 会**重排布局** —— 设计稿在固定声明尺寸下不能重排(390 宽的帧当成 780 宽渲染,版面就错了)。
 *
 * 所以活体只在 **1:1** 时出现,而 1:1 时用户能同时编辑的也只有一个帧。于是"至多一个"不是
 * 性能妥协,而是**正确性要求**;这个接口的形状就是它的表达:没有 id 参数,因为不存在"第二个"。
 *
 * 与参考实现的 N 个活 iframe 相比,这里的上限是 **1**,而且是架构决定的,不是运行期节流出来的。
 *
 * ## 与浏览器面板共享的部分
 *
 * `normalizeBounds` / `sameBounds` / `resolveVisibility` 直接复用 `platform/view-bounds.ts`:
 * 那三个坑(小数设备像素、挂载期的 NaN、ResizeObserver 亚像素抖动)对任何原生视图都成立,
 * 而踩中它们表现出来是"界面坏了"而不是抛错。
 */

export interface DesignViewHost {
  /** 是否已有活体视图。 */
  readonly active: boolean;
  /**
   * 把活体视图切到这一帧。同一 id 复用已有视图(不重新导航)。
   *
   * 返回是否成功:创建或加载失败时返回 false,调用方据此把帧退回位图。
   */
  focus(input: { id: string; url: string; bounds?: ViewRect | null }): Promise<boolean>;
  setBounds(rect: ViewRect): void;
  /**
   * 交还给位图:视图从窗口摘掉,但**页面保留**(滚动位置、动画状态都在),
   * 于是再次聚焦同一帧是瞬时的。
   */
  blur(): void;
  dispose(): void;
}

export class WebContentsViewDesignHost implements DesignViewHost {
  private readonly windowProvider: () => BrowserWindow | undefined;
  private view: WebContentsView | null = null;
  private viewId: string | null = null;
  private attached = false;
  private focused = false;
  private loadFailed = false;
  private bounds: ViewRect | null = null;

  constructor(windowProvider: () => BrowserWindow | undefined) {
    this.windowProvider = windowProvider;
  }

  get active(): boolean {
    return this.view !== null;
  }

  async focus(input: { id: string; url: string; bounds?: ViewRect | null }): Promise<boolean> {
    // 几何随 focus 一起给,而不是"先设 bounds 再 focus":focus 会为**新视图**重置几何,
    // 先设的那份会被丢掉,于是第一次 attach 没有几何、视图挂上去是空白。
    const requested = input.bounds === undefined || input.bounds === null ? null : normalizeBounds(input.bounds);

    if (this.view !== null && this.viewId === input.id && !this.view.webContents.isDestroyed()) {
      this.focused = true;
      if (requested !== null) this.bounds = requested;
      this.applyVisibility();
      return true;
    }

    this.destroyView();
    const view = this.createView();
    this.view = view;
    this.viewId = input.id;
    this.focused = true;
    this.loadFailed = false;
    this.bounds = requested;

    view.webContents.once("did-fail-load", () => {
      // 只在还是这个视图时标记:否则一个迟到的失败会挂到新视图上。
      if (this.view !== view) return;
      this.loadFailed = true;
      this.applyVisibility();
    });

    try {
      await view.webContents.loadURL(input.url);
    } catch {
      if (this.view === view) this.loadFailed = true;
      this.applyVisibility();
      return false;
    }
    this.applyVisibility();
    return !this.loadFailed;
  }

  setBounds(rect: ViewRect): void {
    const next = normalizeBounds(rect);
    const previous = this.bounds;
    // 几何先记下来再判定:渲染层的首次布局可能早于视图创建,那时也要能记住它。
    this.bounds = next;
    if (previous !== null && sameBounds(previous, next)) return;
    this.applyVisibility();
  }

  blur(): void {
    this.focused = false;
    this.applyVisibility();
  }

  dispose(): void {
    this.destroyView();
    this.bounds = null;
  }

  /** 唯一的可见性判定入口 —— 规则本身是共享的纯函数。 */
  private applyVisibility(): void {
    const view = this.view;
    if (view === null) return;
    const intent = resolveVisibility({ requested: this.focused, bounds: this.bounds, loadFailed: this.loadFailed });
    if (intent === "attach") this.attach(view);
    else this.detach(view);
  }

  private attach(view: WebContentsView): void {
    const window = this.windowProvider();
    if (!window || window.isDestroyed()) return;
    if (this.attached) return;
    window.contentView.addChildView(view);
    this.attached = true;
    const rect = this.bounds;
    // 没有可用几何就挂上去会渲染出空白,而且看起来像功能坏了;保留目标尺寸,等下一次上报。
    if (rect !== null && !isDegenerateBounds(rect)) view.setBounds(rect);
  }

  private detach(view: WebContentsView): void {
    if (!this.attached) return;
    this.attached = false;
    const window = this.windowProvider();
    if (!window || window.isDestroyed()) return;
    // `removeChildView` 不销毁页面:这是 blur 能瞬时恢复的原因。
    window.contentView.removeChildView(view);
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        // 设计帧是用户与 agent 写的,与浏览器面板的访客同级,按最不可信的面处理。
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // 刻意不给 preload:页面脚本够不到 `window.wordless`。
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    return view;
  }

  private destroyView(): void {
    const view = this.view;
    this.view = null;
    this.viewId = null;
    this.focused = false;
    this.loadFailed = false;
    if (view === null) return;
    this.detach(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}
