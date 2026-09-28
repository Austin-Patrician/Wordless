/**
 * 导出渲染图(我们把几张帧合成一张带设备外壳的图)的数据模型。
 *
 * 与参考实现逐条对应 —— 保真度就活在这些常量与规则里,所以这里刻意保持同形,只在
 * 命名与注释上按本仓库的习惯来。
 *
 * 单位说明:**layout unit**。用户调圆角/边框时说的就是它,真实像素 = unit × scale × fit。
 * 它和 CSS 像素不是一回事:一帧的声明尺寸经归一化之后才是 layout unit。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 一张导出图里排几个画框;超出的排到下一页。 */
export type MockupFramesPerPage = 1 | 2 | 3 | 4;

export const MOCKUP_FRAMES_PER_PAGE: readonly MockupFramesPerPage[] = [1, 2, 3, 4];

/** 用户可见的导出设置。长度都是 layout unit。 */
export interface MockupOptions {
  /** 屏幕圆角。设备外壳的外圆角 = 它 + `borderWidth`,所以两者同心。 */
  radius: number;
  /** 外壳厚度,**画在截图外面**,所以不盖住任何一个界面像素。 */
  borderWidth: number;
  borderColor: string;
  background: string;
  /** 透明底导出;此时 `background` 被忽略。 */
  transparent: boolean;
  shadow: boolean;
  /** 打上 Wordless 水印。 */
  brand: boolean;
  scale: 1 | 2;
  perPage: MockupFramesPerPage;
}

/** 一帧,已备好合成:清单尺寸用于布局,位图用于绘制。 */
export interface MockupShot {
  frameId: string;
  title: string;
  /** 清单里的尺寸(CSS 像素)。**布局按它归一化,不按位图尺寸** —— 位图可能更大。 */
  cssWidth: number;
  cssHeight: number;
  /** 抓图在途中或失败时为 null —— 但那一格**照样占位**。 */
  image: CanvasImageSource | null;
}

export interface MockupRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MockupLayout {
  /** 画布尺寸(layout unit);真实像素要乘 `scale × fit`。 */
  width: number;
  height: number;
  /** 截图的矩形(边框在这些矩形**外面**),按加入顺序。 */
  rects: MockupRect[];
  brand: { x: number; y: number; logo: number } | null;
  /** 超出像素上限时额外施加的缩小比例。 */
  fit: number;
}
