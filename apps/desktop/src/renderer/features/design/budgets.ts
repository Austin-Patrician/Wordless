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
  /**
   * 用户能把一帧缩到多小。
   *
   * 不是为了"防呆",是为了让**版面还有意义**:390 宽是手机帧,再小一倍就没法评审了,
   * 而一个被误拖成 4×4 的帧在画布上几乎看不见,用户找不回它。也谈不上性能 ——
   * 光栅化本来就有更小的下限。
   */
  frameMinWidth: 80,
  frameMinHeight: 80,
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
   * 位图解码后的总像素预算,约束浏览器真实的 RGBA 内存(32Mi px ≈ 128MB)。
   *
   * **它才是真正会触发的那条**:JPEG 的字节比像素低一个量级,390×844 的帧 2 倍下只有
   * 17.9KB,所以 64MB 的字节预算要 3600 多帧才咬人 —— 等于永不触发。
   *
   * 实测边界(390×844 / 2 倍 = 1.32M px):装得下 **25 帧**,第 26 帧开始淘汰。所以
   * **4–7 帧的普通设计碰不到它**(工作区里最大的设计是 7 帧 = 9.2M px = 35MB 解码内存);
   * 它挡的是 40 帧那类设计(52.7M px = 201MB,不挡会全留在渲染进程里)。
   *
   * 代价说清楚:超过 25 帧之后被淘汰的帧平移回来要重新光栅(约 150ms/帧,期间是占位)。
   * 这是"上限 vs 反复重光栅"的取舍,不是白拿的。
   */
  texturePixelBudget: 32 * 1024 * 1024,
  /**
   * 活体只在 **1:1** 出现,这是容差。
   *
   * 这条以前是"缩放 ≥ 0.75",那是个**错的**门槛,而且错得不明显:宿主只把矩形交给原生视图
   * (`setBounds`),**不做任何缩放补偿** —— 于是 0.75–1.0 之间,一个 390 宽的帧被塞进 312
   * 宽的视口,页面**按小视口重排**,画布上看到的是错的版面。它既不像崩溃也不像空白,最容易
   * 被当成"这个设计本来就长这样"。
   *
   * 只有 1:1 时原生视图的视口恰好等于帧的声明尺寸,版面才是设计稿的版面。差 2% 不该让活体
   * 闪掉(缩放是浮点的),所以留一点容差。
   */
  liveZoomTolerance: 0.02,
  /**
   * 1:1 —— 活体唯一正确的缩放。
   *
   * 单独写出来,是因为它同时是**进入一帧时的相机目标**(`frameEntryViewport`):进去看到的
   * 版面,必须就是交互时看到的那个版面,两者不能各写一个数字。
   */
  liveZoom: 1,
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
  return (
    Number.isFinite(zoom) && Math.abs(zoom - DESIGN_CANVAS_BUDGETS.liveZoom) <= DESIGN_CANVAS_BUDGETS.liveZoomTolerance
  );
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
