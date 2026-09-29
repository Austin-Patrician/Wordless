import type { Rect } from "./camera.ts";

/**
 * 「我的设计」那张封面的几何。
 *
 * 封面是**这份设计的样子**:几帧横排、缩到一张固定比例的图里。与导出的合成图共用同一套想法
 * (归一化到最高的那一帧、按比例缩放、居中),但刻意**不复用** `mockup-layout` —— 那边有设备
 * 外壳、圆角、投影、水印,是一张"交付图";封面只是索引里的一格,画得越简单越不容易出错。
 *
 * 纯函数:不碰 canvas、不碰 DOM,于是"每一帧画在哪"可以在没有浏览器的地方断言。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 封面画布的固定尺寸。4:3 与卡片上那个格子一致。 */
export const COVER_BOX = { height: 360, width: 480 } as const;
/** 帧与帧之间的间距(封面画布上的像素)。 */
const COVER_GAP = 14;
/** 四周留白。 */
const COVER_PADDING = 18;

/**
 * 一帧**最多**参与封面。
 *
 * 一份设计可能有几十帧,而封面在列表里只有两百多像素宽 —— 全画进去等于每一帧都小于一粒米。
 * 取前几帧:它们按清单顺序,也就是用户在画布上从左到右看到的顺序。
 */
export const COVER_MAX_FRAMES = 3;

export interface CoverLayout {
  /** 这一行整体缩放了多少(内容尺寸 × 它 = 封面上的像素)。 */
  scale: number;
  /** 每一帧在封面画布上的矩形,顺序与输入一致。 */
  rects: Rect[];
}

/**
 * 把若干帧摆进一张固定尺寸的封面里。
 *
 * 按**最高那一帧**归一化(与导出那条路同一个理由):被缩小的帧会丢细节,而细节正是"这是哪份
 * 设计"的全部依据。所以整体缩放取"装得下"的那个值,而不是逐帧各自缩。
 *
 * 空输入(还在加载、或者一份没有任何帧的设计)返回 `scale: 1` 与空矩形 —— 调用方据此直接
 * 放弃,而不是画一张空图。
 */
export function coverLayout(
  sizes: readonly { height: number; width: number }[],
  box: { height: number; width: number } = COVER_BOX,
): CoverLayout {
  const usable = {
    height: Math.max(1, box.height - COVER_PADDING * 2),
    width: Math.max(1, box.width - COVER_PADDING * 2),
  };
  const valid = sizes.filter((size) => Number.isFinite(size.height) && size.height > 0 && size.width > 0);
  if (valid.length === 0) return { rects: [], scale: 1 };

  const tallest = Math.max(...valid.map((size) => size.height));
  // 归一化之后每一帧的宽度(高度都等于 tallest)。
  const normalized = valid.map((size) => (size.width / size.height) * tallest);
  const rowWidth =
    normalized.reduce((sum, width) => sum + width, 0) + COVER_GAP * Math.max(0, valid.length - 1);
  const scale = Math.min(1, usable.height / tallest, usable.width / rowWidth);

  const frameWidth = normalized.map((width) => width * scale);
  const frameHeight = tallest * scale;
  const totalWidth = frameWidth.reduce((sum, width) => sum + width, 0) + COVER_GAP * (valid.length - 1) * scale;
  const top = (box.height - frameHeight) / 2;
  let left = (box.width - totalWidth) / 2;

  const rects: Rect[] = [];
  for (const width of frameWidth) {
    rects.push({ height: frameHeight, width, x: left, y: top });
    left += width + COVER_GAP * scale;
  }
  return { rects, scale };
}

/**
 * 真画一张封面。**只做绘制,不做算术** —— 几何全在上面那个纯函数里。
 *
 * 返回 `null` 表示"没有可画的东西"(一帧都没有、或者画布拿不到 2D 上下文),调用方据此跳过
 * 写入缓存 —— 一张空封面比没有封面更糟:它会让卡片看起来像"这份设计是空的"。
 */
export function drawCover(
  sources: readonly { image: CanvasImageSource; size: { height: number; width: number } }[],
  box: { height: number; width: number } = COVER_BOX,
): HTMLCanvasElement | null {
  const capped = sources.slice(0, COVER_MAX_FRAMES);
  const layout = coverLayout(
    capped.map((source) => source.size),
    box,
  );
  if (layout.rects.length === 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const context = canvas.getContext("2d");
  if (context === null) return null;

  // 底色:设计自己的主色由调用方给不了(那是卡片那侧的事),这里只用一个中性底 ——
  // 封面是要展示"内容长什么样",底色不该抢戏。
  context.fillStyle = "#f2f3f0";
  context.fillRect(0, 0, box.width, box.height);

  capped.forEach((source, index) => {
    const rect = layout.rects[index];
    if (rect === undefined) return;
    context.drawImage(source.image, rect.x, rect.y, rect.width, rect.height);
  });

  return canvas;
}
