/**
 * 画布相机 —— 几何的**唯一权威**。
 *
 * 所有矩形都从这一个变换派生:位图贴图的矩形、原生视图的矩形、点击落点、拖拽落点、
 * 视口裁剪。参考实现里这些是各自 `getBoundingClientRect()` 分别测出来的,那正是位图
 * 与活体错位的来源;这里它们走同一组纯函数,**结构上不可能错位**。
 *
 * 约定:world 层用 `transform: translate(x, y) scale(zoom)` 且 `transformOrigin: 0 0`,
 * 于是
 *
 *     screen = world * zoom + (x, y)
 *
 * 本文件不 import React、不 import Electron。
 */

export type Camera = { x: number; y: number; zoom: number };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** 带 id 的矩形,用于视口裁剪。 */
export type FrameRect = Rect & { id: string };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;

/** 缩放到合法区间。非有限值回落到 1,避免一个 NaN 让整块画布失效。 */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** world 点 → 屏幕点。 */
export function worldPointToScreen(camera: Camera, point: Point): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

/** 屏幕点 → world 点(点击落点、拖拽新建)。 */
export function screenPointToWorld(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

/** world 矩形 → 屏幕矩形。位图贴图与原生视图**共用这一个**。 */
export function worldRectToScreen(camera: Camera, rect: Rect): Rect {
  const origin = worldPointToScreen(camera, { x: rect.x, y: rect.y });
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

/** 屏幕矩形 → world 矩形。 */
export function screenRectToWorld(camera: Camera, rect: Rect): Rect {
  const origin = screenPointToWorld(camera, { x: rect.x, y: rect.y });
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width / camera.zoom,
    height: rect.height / camera.zoom,
  };
}

/**
 * 以锚点为中心缩放,锚点在屏幕上保持不动。
 *
 * 锚点通常是光标位置 —— 滚轮缩放时内容不该从光标下跑掉。实现直接建立在
 * `screenPointToWorld` 上:先求出锚点下的 world 点,再解出让该点落回锚点的相机位置。
 * 这样它与上面两个变换函数**永远互逆**,不会各自演化出偏差。
 */
export function zoomAround(camera: Camera, nextZoom: number, anchor: Point): Camera {
  const zoom = clampZoom(nextZoom);
  const world = screenPointToWorld(camera, anchor);
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
}

/**
 * 反向缩放系数:手柄、标题、参考线按它反向缩放,于是在**任何缩放下都是屏幕上的
 * 固定尺寸**。
 *
 * 上限 8 —— 缩到很小时 chrome 不该比内容还大。非有限 zoom 回落到 1。
 */
export function inverseScale(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1;
  return Math.min(1 / zoom, 8);
}

export interface FitCameraOptions {
  /**
   * 缩放上限。默认 1:把内容铺满视口即可,**不放大** —— 一个 390×844 的帧被拉到
   * 满屏会失去"这是手机屏"的判断依据。
   */
  maxZoom?: number;
  /** 四周留白比例(0.08 = 每侧 8%)。 */
  paddingRatio?: number;
}

/** 把内容居中并适配视口。 */
export function fitCamera(content: Rect, viewport: Size, options: FitCameraOptions = {}): Camera {
  const maxZoom = options.maxZoom ?? 1;
  const paddingRatio = options.paddingRatio ?? 0;
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: 0, y: 0, zoom: clampZoom(maxZoom) };
  }
  const usableWidth = viewport.width * (1 - paddingRatio * 2);
  const usableHeight = viewport.height * (1 - paddingRatio * 2);
  const zoom = clampZoom(Math.min(usableWidth / content.width, usableHeight / content.height, maxZoom));
  return {
    zoom,
    x: (viewport.width - content.width * zoom) / 2 - content.x * zoom,
    y: (viewport.height - content.height * zoom) / 2 - content.y * zoom,
  };
}

/** 两个矩形是否相交(边贴边不算)。 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 把一组矩形并成能包住它们的最小矩形;空数组返回 null。 */
export function unionRects(rects: readonly Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 视口裁剪:返回需要渲染的帧 id。
 *
 * 余量按**屏幕像素**给(不是画布单位)—— 快速平移时下一屏的内容提前就位,不至于露白;
 * 缩小到很小时余量换算成画布单位会变得很大,所以它跟着屏幕走才符合直觉。
 */
export function visibleFrameIds(
  camera: Camera,
  frames: readonly FrameRect[],
  viewport: Size,
  marginPx: number,
): string[] {
  const margin = Number.isFinite(marginPx) && marginPx > 0 ? marginPx : 0;
  const visible = screenRectToWorld(camera, {
    x: -margin,
    y: -margin,
    width: viewport.width + margin * 2,
    height: viewport.height + margin * 2,
  });
  return frames.filter((frame) => rectsIntersect(frame, visible)).map((frame) => frame.id);
}

/**
 * 位图按哪个缩放档光栅:取**不超过**当前 zoom 的最大档。
 *
 * 取"不超过"而不是"最接近"是有意的 —— 位图只会被放大显示,放大是模糊的、可接受的;
 * 若取到高于当前 zoom 的档,位图会被缩小显示,那会丢掉细节且浪费内存。
 * 低于最小档时返回最小档(内容小到看不清,模糊无所谓)。
 */
export function zoomBucket(zoom: number, buckets: readonly number[]): number {
  const sorted = [...buckets].filter((bucket) => Number.isFinite(bucket) && bucket > 0).sort((a, b) => a - b);
  const smallest = sorted[0];
  if (smallest === undefined) return 1;
  if (!Number.isFinite(zoom)) return smallest;
  let best = smallest;
  for (const bucket of sorted) {
    if (bucket <= zoom) best = bucket;
  }
  return best;
}

/** 网格吸附。平移与拖拽共用,`enabled` 为假或网格非法时原样返回。 */
export function snapToGrid(value: number, grid: number, enabled: boolean): number {
  if (!enabled || !Number.isFinite(grid) || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}
