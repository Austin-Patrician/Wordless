/**
 * 预览台的多页堆叠几何。
 *
 * **平移/缩放不在这里**:它和编辑态画布共用同一套相机(滚轮平移、绕光标缩放、rAF 折叠),
 * 两处各写一遍手势逻辑必然漂开。这里只剩纯几何 —— 页面怎么在世界坐标里摆。
 *
 * 世界坐标 = `mockup-layout.ts` 的 layout unit;屏幕坐标 = 世界坐标 × zoom + 平移量。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface MockupSize {
  width: number;
  height: number;
}

export interface MockupPageBox extends MockupSize {
  left: number;
  top: number;
}

/**
 * 缩放按钮跳的档位。
 *
 * 离散档位而不是"每次 ×1.25":连续乘法会让缩放比停在 128%、160% 这类数字上,而用户想回到
 * 100% 就得来回点;档位也保证"放大再缩小"能原路回到起点。
 */
export const MOCKUP_ZOOM_STEPS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * 上一档 / 下一档。已经在两端时**原样返回**(而不是夹到端点):按钮于是可以不靠外部状态判断
 * 自己该不该置灰,而"再点也没用"这件事在视觉上表现为数字不动,比按钮突然变灰更好懂。
 */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (!Number.isFinite(zoom)) return 1;
  // 容差:档位值是精确的,而从档位缩放过(滚轮)之后 zoom 只近似等于档位。
  const epsilon = 1e-6;
  if (direction === 1) return MOCKUP_ZOOM_STEPS.find((step) => step > zoom + epsilon) ?? zoom;
  return [...MOCKUP_ZOOM_STEPS].reverse().find((step) => step < zoom - epsilon) ?? zoom;
}

/** 保持缩放比,把内容重新摆到容器中央(「实际大小」按钮用)。 */
export function centerMockupViewport(world: MockupSize, viewport: MockupSize, zoom: number): { x: number; y: number; zoom: number } {
  return {
    zoom,
    x: (viewport.width - world.width * zoom) / 2,
    y: (viewport.height - world.height * zoom) / 2,
  };
}

/**
 * 多页竖向堆叠,逐页水平居中 —— 最后一页画框数常常更少、因而更窄,左对齐会让整叠图看着
 * 像歪了。
 */
export function stackMockupPages(sizes: readonly MockupSize[], gap: number): { world: MockupSize; boxes: MockupPageBox[] } {
  if (sizes.length === 0) return { world: { width: 0, height: 0 }, boxes: [] };
  const width = Math.max(...sizes.map((size) => size.width));
  const boxes: MockupPageBox[] = [];
  let top = 0;
  for (const size of sizes) {
    boxes.push({ left: (width - size.width) / 2, top, width: size.width, height: size.height });
    top += size.height + gap;
  }
  return { world: { width, height: Math.max(0, top - gap) }, boxes };
}
