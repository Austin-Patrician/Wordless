/**
 * 原生视图的几何归一化与可见性判定。
 *
 * **从 `browser/browser-bounds.ts` 提取到这里**:P4 的设计活体视图需要同一套东西
 * (原生视图的几何归一化与可见性规则),而这是第二个消费者 —— 提取的时机到了。
 * 提取而不是复制,是因为下面注释里那三个坑对**任何一个原生视图**都成立,而踩中它们的
 * 表现是"看起来像界面坏了"而不是抛错,最难查。
 *
 * 位置在 `main/platform/`:与浏览器面板、设计画布都无关的、主进程侧的通用几何工具。
 *
 * 本文件不 import Electron。
 */

export type ViewRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Normalizes a renderer-reported rect into something `View.setBounds` accepts.
 *
 * Three failure modes this guards against, each of which shows up as a visible
 * defect rather than a thrown error:
 *
 * 1. `getBoundingClientRect` hands back fractional device pixels. Truncating
 *    them leaves a hairline of the page behind the view showing along one edge,
 *    so we round instead of flooring.
 * 2. During mount, teardown and hidden-tab renders React can briefly report
 *    negative or `NaN` geometry. `setBounds` throws on `NaN`, so every field is
 *    coerced and clamped.
 * 3. Sub-pixel jitter from `ResizeObserver` would otherwise cause a bounds call
 *    per frame, and each call forces the compositor to reposition a native
 *    surface. Callers pair this with `sameBounds` to drop no-op updates.
 */
export function normalizeBounds(rect: ViewRect): ViewRect {
  return {
    x: safeCoordinate(rect.x),
    y: safeCoordinate(rect.y),
    width: safeLength(rect.width),
    height: safeLength(rect.height),
  };
}

export function sameBounds(a: ViewRect, b: ViewRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** True when the rect cannot be displayed, so the view should be hidden instead. */
export function isDegenerateBounds(rect: ViewRect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

export type VisibilityIntent = "attach" | "detach";

/**
 * Single rule for whether the native view belongs on the window.
 *
 * Kept pure and separate from the services because it is the one place a bug
 * silently blanks a panel: a collapsing sidebar animates the placeholder
 * through zero width, and if that detaches the view without a matching
 * re-attach the page disappears until the user switches tabs. Both inputs are
 * explicit here so that case is testable rather than emergent.
 *
 * 设计画布复用同一条规则:缩放离开 1:1、帧被移出视口、或位图还没
 * 到位时,活体视图都该 `detach` —— 而"移出视口"与"宽度穿过 0"是同一类瞬时状态。
 */
export function resolveVisibility(input: {
  /** The panel asked for the view to be on screen. */
  requested: boolean;
  /** Last placeholder geometry reported by the renderer, if any. */
  bounds: ViewRect | null;
  /**
   * The page failed to load. The native view has nothing to show, and leaving
   * it mounted would hide the DOM error message behind a native surface, so a
   * failure detaches rather than keeps the view up.
   */
  loadFailed?: boolean;
}): VisibilityIntent {
  if (!input.requested) return "detach";
  if (input.loadFailed) return "detach";
  if (!input.bounds) return "detach";
  return isDegenerateBounds(input.bounds) ? "detach" : "attach";
}

function safeCoordinate(value: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function safeLength(value: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}
