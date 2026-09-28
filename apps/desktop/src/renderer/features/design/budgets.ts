/**
 * 渲染层侧的设计画布预算。
 *
 * 集中、声明式、每条都有测试 —— 而不是散落在各处的魔法数。画布的性能与稳定性
 * 最终就落在这些数字上,所以它们必须是可审查、可断言的对象,而不是顺手写下的常量。
 *
 * **只管渲染进程占用的资源**(位图与 LRU)。离屏视图与子进程那几项在主进程侧:
 * 见 `main/design/raster-budgets.ts`,那里写了为什么分开。
 *
 * 这里只有数字与最简的派生函数,**不 import React、不 import Electron**。
 */

export const DESIGN_CANVAS_BUDGETS = {
  /**
   * 活体原生视图上限。
   *
   * 这是**架构上限,不是节流结果** —— 对比参考实现(open-vetta)的 N 个活 iframe
   * 撑爆 tile 显存。原生视图无法被 CSS 缩放(`setBounds` 是整数屏幕矩形,
   * `setZoomFactor` 会重排布局),所以 1:1 之外本来也不该有活体。
   */
  maxLiveViews: 1,
  /** 位图缓存条数上限(LRU)。 */
  maxTextures: 64,
  /** 单张位图最长边(设备像素)。超过则等比缩小后再光栅化。 */
  textureMaxEdge: 2048,
  /**
   * 位图按设备像素比光栅的**上限**。
   *
   * 参考实现记过一次完整决策:曾经写死 1 倍,理由是「100% 缩放下就是 1:1」—— 漏掉了
   * `devicePixelRatio`:Retina 上 100% 已是 2 倍,而旁边活体是矢量渲染怎么放大都锐利,
   * 两态一对比非常刺眼。上限 2 是成本与观感的平衡点(位图用 JPEG 编码,同像素数下
   * 字符串小一个量级)。
   */
  texturePixelRatioCap: 2,
  /** 位图总字节预算。超出则按 LRU 淘汰。 */
  textureByteBudget: 64 * 1024 * 1024,
  /**
   * 低于此缩放不给活体:缩小看全局时位图足够。
   *
   * 这不是性能妥协而是**正确性要求** —— 原生视图只能整数矩形定位且不能被 CSS 缩放,
   * 在非 1:1 缩放下强行显示会得到重排后的错误版面。
   */
  liveZoomThreshold: 0.75,
  /** 视口外预光栅余量(屏幕像素),让快速平移不至于露白。 */
  rasterMarginPx: 400,
  /** 位图缩放档位。光栅化取「不超过当前 zoom 的最大档」。 */
  zoomBuckets: [0.25, 0.5, 1, 2],
} as const;

/**
 * 当前缩放是否允许出现活体视图。
 *
 * 判定只写在这里:调用方传 zoom,不传预先算好的布尔值 —— 否则这条规则会在每个
 * 调用点各写一遍,然后悄悄漂开。
 */
export function allowsLiveSurface(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= DESIGN_CANVAS_BUDGETS.liveZoomThreshold;
}

/**
 * 位图实际按多少倍设备像素光栅。
 *
 * 非有限或非正的输入回落到 1:这个值会直接乘进位图尺寸,`NaN` 会让整条光栅链路失效,
 * 而它来自 `window.devicePixelRatio`,在某些嵌入环境里确实可能异常。
 */
export function texturePixelRatio(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, DESIGN_CANVAS_BUDGETS.texturePixelRatioCap);
}
