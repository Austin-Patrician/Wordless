import type { MockupLayout, MockupOptions, MockupShot } from "./mockup-types.ts";

/**
 * 合成几何 —— **预览与导出共用这一份**,于是两者不可能漂开。
 *
 * 一切都在 layout unit 里(用户调圆角/边框时说的那个单位)。真实像素 = unit × `scale` × `fit`。
 *
 * 画框排成**一行**,按最高那个画框的高度归一化。取最高而不是固定值,是为了**永不缩小**:
 * 一被缩小就丢细节,而细节正是导出图的全部价值。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 间距,按归一化高度的比例。 */
const GAP_RATIO = 0.06;
const PADDING_RATIO = 0.1;
/** 品牌块高度,同样相对归一化高度。 */
const BRAND_LOGO_RATIO = 0.09;
const BRAND_GAP_RATIO = 0.06;
/** 每边的硬上限;再大 Chromium 的画布就开始不可靠。 */
const MAX_OUTPUT_PX = 8000;

/**
 * @param slots 这一行留几个位置。默认就是画框数;分页时传每页的固定格数 —— **末页画框
 *   不满也照样占满宽度**,多页叠起来才不会一页宽一页窄。空位按本页画框的平均宽度计价:
 *   同一份设计稿里画框尺寸通常一致,这就等于「少的那几格」。
 */
export function layoutMockup(
  shots: readonly MockupShot[],
  options: MockupOptions,
  slots: number = shots.length,
): MockupLayout {
  if (shots.length === 0) return { width: 0, height: 0, rects: [], brand: null, fit: 1 };

  const normalizedHeight = Math.max(...shots.map((shot) => shot.cssHeight));
  const gap = normalizedHeight * GAP_RATIO;
  const padding = normalizedHeight * PADDING_RATIO;
  const border = Math.max(0, options.borderWidth);

  const widths = shots.map((shot) => (shot.cssWidth / shot.cssHeight) * normalizedHeight);
  const columns = Math.max(shots.length, Math.floor(slots));
  const emptyWidth = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  const rowWidth =
    widths.reduce((sum, width) => sum + width + 2 * border, 0) +
    (columns - shots.length) * (emptyWidth + 2 * border) +
    gap * (columns - 1);

  const logo = normalizedHeight * BRAND_LOGO_RATIO;
  const brandHeight = options.brand ? logo + normalizedHeight * BRAND_GAP_RATIO : 0;

  const width = rowWidth + padding * 2;
  const height = normalizedHeight + 2 * border + brandHeight + padding * 2;

  const rects: MockupLayout["rects"] = [];
  let cursor = padding + border;
  const top = padding + brandHeight + border;
  for (const shotWidth of widths) {
    rects.push({ x: cursor, y: top, width: shotWidth, height: normalizedHeight });
    cursor += shotWidth + 2 * border + gap;
  }

  const fit = Math.min(1, MAX_OUTPUT_PX / (width * options.scale), MAX_OUTPUT_PX / (height * options.scale));

  return {
    width,
    height,
    rects,
    brand: options.brand ? { x: padding, y: padding, logo } : null,
    fit,
  };
}

/** 导出时的最终倍率:`scale`(用户选的)× `fit`(超上限时的让步)。 */
export function mockupRenderScale(layout: MockupLayout, options: MockupOptions): number {
  return options.scale * layout.fit;
}

/** 交给 `canvas.width/height` 的整数像素尺寸。 */
export function mockupPixelSize(layout: MockupLayout, options: MockupOptions): { width: number; height: number } {
  const scale = mockupRenderScale(layout, options);
  return {
    width: Math.max(1, Math.round(layout.width * scale)),
    height: Math.max(1, Math.round(layout.height * scale)),
  };
}
