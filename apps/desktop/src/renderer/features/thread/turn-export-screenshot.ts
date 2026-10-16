/**
 * 长图捕获。
 *
 * **为什么不用 Electron 的 `capturePage`**:它只能截视口,而长图要的是整棵节点的完整
 * 高度;滚动拼接会闪烁,且排版随滚动变化。所以在渲染进程内用 `@zumer/snapdom` 把预览
 * 节点光栅化——它克隆节点、内联计算样式与字体,再经 SVG 光栅化。
 *
 * `lazy` 动态 import:导出是低频动作,不值得让它进主包。
 *
 * 捕获是低频但有代价的动作,它的失败方式("小时代(fs)崩溃")很难从外部重现,所以
 * 签名刻意窄:输入一个节点,输出字节加一个"退化计数"。调用方(面板)负责把计数说出来。
 */
export interface TurnCaptureResult {
  bytes: Uint8Array;
  /**
   * 没能内联的外链图片数——图里它们是占位框,得说出来,不能静默。
   */
  blockedImages: number;
}

export type CaptureTurnPreview = (element: HTMLElement) => Promise<TurnCaptureResult>;

export async function captureTurnPreview(element: HTMLElement): Promise<TurnCaptureResult> {
  const { snapdom } = await import("@zumer/snapdom");
  const capture = await snapdom(element, { scale: 2, format: "png" });
  const blob = await capture.toBlob({ format: "png" });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    blockedImages: capture.warnings.filter((warning) => warning.code === "image-fallback").length,
  };
}