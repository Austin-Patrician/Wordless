import { layoutMockup, mockupPixelSize, mockupRenderScale } from "./mockup-layout.ts";
import type { MockupLayout, MockupOptions, MockupRect, MockupShot } from "./mockup-types.ts";

/**
 * 把选中的几帧合成一张图。
 *
 * **预览与导出用的是同一个渲染器** —— 预览只是拿更小的 `scale` 回调它。这是整套东西里
 * 最要紧的一条纪律:预览看起来什么样,导出就该是什么样,而"两处各画一遍"是这类功能最
 * 常见的漂开方式。
 *
 * 本文件不 import React、不 import Electron(它只碰 canvas 2D 上下文)。
 */

/** 水印文字。烧进位图里,所以刻意不走 i18n。 */
const BRAND_NAME = "Wordless";
const BRAND_TAGLINE = "Designed with Wordless";

function roundRectPath(g: CanvasRenderingContext2D, rect: MockupRect, radius: number): void {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  g.beginPath();
  g.moveTo(rect.x + r, rect.y);
  g.arcTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height, r);
  g.arcTo(rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height, r);
  g.arcTo(rect.x, rect.y + rect.height, rect.x, rect.y, r);
  g.arcTo(rect.x, rect.y, rect.x + rect.width, rect.y, r);
  g.closePath();
}

/** 向外扩:外壳画在截图**外面**,所以不盖住任何一个界面像素。 */
function outset(rect: MockupRect, by: number): MockupRect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 };
}

/**
 * 能在任何用户选的背景上读得出来的水印墨色。认不出的颜色写法退回浅色(与默认深色底一致)。
 */
export function mockupBrandInk(options: Pick<MockupOptions, "background" | "transparent">): {
  primary: string;
  secondary: string;
} {
  const light = { primary: "#ffffff", secondary: "rgba(255, 255, 255, 0.55)" };
  const dark = { primary: "#111114", secondary: "rgba(17, 17, 20, 0.55)" };
  // 透明导出通常会被贴到浅色文档上,所以用深色墨。
  if (options.transparent) return dark;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(options.background.trim());
  if (!hex) return light;
  const digits = hex[1].length === 3 ? [...hex[1]].map((char) => char + char).join("") : hex[1];
  const value = Number.parseInt(digits, 16);
  const luminance =
    (0.2126 * ((value >> 16) & 0xff) + 0.7152 * ((value >> 8) & 0xff) + 0.0722 * (value & 0xff)) / 255;
  return luminance > 0.55 ? dark : light;
}

/**
 * 画一张合成图。
 *
 * **设备外壳**:边框是画在截图**下面**的一个圆角矩形,并按边框宽度向外扩 —— 于是内外两个
 * 圆角同心,而且没有一个界面像素被盖住。这一点是照着参考实现抄的,理由很实在:直接描边
 * 会吃掉最外圈像素,而设计稿的边距通常很紧。
 */
export function renderMockup(
  g: CanvasRenderingContext2D,
  shots: readonly MockupShot[],
  options: MockupOptions,
  layout: MockupLayout,
  scale: number,
): void {
  g.save();
  g.clearRect(0, 0, layout.width * scale, layout.height * scale);
  g.scale(scale, scale);

  if (!options.transparent) {
    g.fillStyle = options.background;
    g.fillRect(0, 0, layout.width, layout.height);
  }

  if (layout.brand && options.brand) drawBrand(g, layout.brand, mockupBrandInk(options));

  const border = Math.max(0, options.borderWidth);
  shots.forEach((shot, index) => {
    const rect = layout.rects[index];
    if (rect === undefined) return;
    const shell = outset(rect, border);

    if (options.shadow) {
      g.save();
      // 阴影挂在**最外轮廓**上;柔度跟着尺寸走,于是手机稿和桌面稿读起来是同一种质感。
      g.shadowColor = "rgba(0, 0, 0, 0.45)";
      g.shadowBlur = shell.height * 0.06;
      g.shadowOffsetY = shell.height * 0.02;
      g.fillStyle = border > 0 ? options.borderColor : "#000000";
      roundRectPath(g, shell, options.radius + border);
      g.fill();
      g.restore();
    }

    if (border > 0) {
      g.fillStyle = options.borderColor;
      roundRectPath(g, shell, options.radius + border);
      g.fill();
    }

    g.save();
    roundRectPath(g, rect, options.radius);
    g.clip();
    if (shot.image) {
      g.drawImage(shot.image, rect.x, rect.y, rect.width, rect.height);
    } else {
      // 抓图在途中或失败:**占住这一格**,这样它一到就不会让整张图重排。
      // (有任何一格为空时,导出按钮是禁用的。)
      g.fillStyle = "#8a8a8f";
      g.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    g.restore();
  });

  g.restore();
}

function drawBrand(
  g: CanvasRenderingContext2D,
  brand: NonNullable<MockupLayout["brand"]>,
  ink: { primary: string; secondary: string },
): void {
  const size = brand.logo;
  const textX = brand.x + size * 1.24;
  g.save();
  g.textBaseline = "alphabetic";
  g.fillStyle = ink.primary;
  g.font = `600 ${size * 0.46}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.fillText(BRAND_NAME, textX, brand.y + size * 0.44);
  g.fillStyle = ink.secondary;
  g.font = `400 ${size * 0.28}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.fillText(BRAND_TAGLINE, textX, brand.y + size * 0.82);
  g.restore();
}

/** 合成到一张离屏画布 —— 所有导出格式的共同根。 */
export function renderMockupToCanvas(
  shots: readonly MockupShot[],
  options: MockupOptions,
  /** 这一页留几格;末页不满时靠它保住与其他页一致的宽度,见 `mockup-layout.ts`。 */
  slots: number = shots.length,
): HTMLCanvasElement {
  const layout = layoutMockup(shots, options, slots);
  const scale = mockupRenderScale(layout, options);
  const size = mockupPixelSize(layout, options);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  renderMockup(g, shots, options, layout, scale);
  return canvas;
}

/**
 * 长图:把多页竖着拼成一张。页宽不一致时(末页画框少)居中,空出来的地方补背景色;
 * 透明导出则继续留空 —— 与单页导出的背景规则保持一致。
 */
export function stitchMockupPages(
  pages: readonly HTMLCanvasElement[],
  options: Pick<MockupOptions, "background" | "transparent">,
): HTMLCanvasElement {
  if (pages.length === 1) return pages[0]!;
  const width = Math.max(1, ...pages.map((page) => page.width));
  const height = Math.max(
    1,
    pages.reduce((sum, page) => sum + page.height, 0),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  if (!options.transparent) {
    g.fillStyle = options.background;
    g.fillRect(0, 0, width, height);
  }
  let top = 0;
  for (const page of pages) {
    g.drawImage(page, Math.round((width - page.width) / 2), top);
    top += page.height;
  }
  return canvas;
}

/**
 * JPEG 没有 alpha,而 Chromium 会把透明像素编码成**黑色** —— 所以先压到白底上。
 * 白底也正是透明导出通常最终会落到的地方。
 */
export function mockupCanvasToJpegDataUrl(canvas: HTMLCanvasElement): string {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const g = flat.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, flat.width, flat.height);
  g.drawImage(canvas, 0, 0);
  return flat.toDataURL("image/jpeg", 0.94);
}

/**
 * JPEG 字节,供 PDF 嵌入(`DCTDecode` 要的就是已编码的 JPEG)。
 *
 * 与 `mockupCanvasToJpegDataUrl` 同一条规则:先压白。区别只在出口是字节还是 data URL ——
 * PDF 要字节,预览/下载要 URL。
 */
export async function mockupCanvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  const g = flat.getContext("2d");
  if (!g) throw new Error("2D canvas context unavailable");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, flat.width, flat.height);
  g.drawImage(canvas, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => flat.toBlob(resolve, "image/jpeg", 0.92));
  if (blob === null) throw new Error("Canvas encoding failed");
  return new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
}

/** PNG 直接取,不需要压白 —— alpha 是 PNG 的一部分。 */
export async function mockupCanvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (blob === null) throw new Error("Canvas encoding failed");
  // 显式要求 `ArrayBuffer` 背书:`Blob` 的构造不接受可能是 `SharedArrayBuffer` 的视图,
  // 而这份字节最终要过 IPC 交给主进程(与 `DesignFs#readBytes` 同一条理由)。
  return new Uint8Array(await blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
}
