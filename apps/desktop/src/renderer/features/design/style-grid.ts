/**
 * 风格画廊的宫格几何:多少列、行多高、当前该渲染哪一段。
 *
 * 抽成纯函数,是因为这几个数字全是「差一格就错位」的算术:列数随宽度跳变、行高由列数反推、
 * 可见窗口又建立在行高之上。任何一处取整取错,表现都是滚动时卡片错列或闪空 —— 而那在浏览器
 * 里极难复现,只能靠肉眼看。
 *
 * 与参考实现同构(它把这几条单独抽出来时写的理由一样)。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 与宫格的 `gap-3` 一致。 */
export const STYLE_GRID_GAP = 12;
/** 卡片宽高比,与 `aspect-[4/3]` 一致。 */
const ASPECT = 4 / 3;
/** 再窄就看不清缩略图里的版式了,宁可少一列。 */
const MIN_CARD_WIDTH = 240;
/** 列数上限:卡片再小,这一屏的作用就只剩「花」而不是「看清楚」。 */
export const STYLE_GRID_MAX_COLUMNS = 3;
/** 视口上下各多渲染一行。 */
const OVERSCAN = 1;

export interface StyleGridMetrics {
  columns: number;
  /** 一整行的高度(卡片高 + 行距)。宽度未知时为 0,调用方据此退回「全量渲染」。 */
  rowHeight: number;
}

export function styleGridMetrics(width: number): StyleGridMetrics {
  if (!Number.isFinite(width) || width <= 0) return { columns: STYLE_GRID_MAX_COLUMNS, rowHeight: 0 };
  const columns = Math.min(
    STYLE_GRID_MAX_COLUMNS,
    Math.max(1, Math.floor((width + STYLE_GRID_GAP) / (MIN_CARD_WIDTH + STYLE_GRID_GAP))),
  );
  const card = (width - STYLE_GRID_GAP * (columns - 1)) / columns;
  return { columns, rowHeight: card / ASPECT + STYLE_GRID_GAP };
}

export interface StyleGridWindow {
  /** 左闭右开。 */
  start: number;
  end: number;
}

/**
 * 当前该渲染的条目区间。
 *
 * `scrolledPast` 是宫格顶部已经滚出视口上沿的距离(还没滚到时为 0)。
 *
 * 返回的区间**一定覆盖 `[start, end)` 的完整行** —— 否则一行的末尾会缺一块,看起来像加载
 * 失败而不是窗口化。
 */
export function styleGridWindow(input: {
  scrolledPast: number;
  viewportHeight: number;
  metrics: StyleGridMetrics;
  total: number;
}): StyleGridWindow {
  const { columns, rowHeight } = input.metrics;
  if (rowHeight <= 0 || columns <= 0) return { start: 0, end: input.total };

  const startRow = Math.max(0, Math.floor(Math.max(0, input.scrolledPast) / rowHeight) - OVERSCAN);
  const visibleRows = Math.ceil(Math.max(0, input.viewportHeight) / rowHeight) + OVERSCAN * 2;
  const start = Math.min(startRow * columns, input.total);
  const end = Math.min(input.total, (startRow + visibleRows) * columns);
  // 起止落在同一行时也要给出一整行,否则调用方会渲染出半个空行。
  return { start, end: Math.max(end, Math.min(input.total, start + columns)) };
}

/** 撑开空行时要补的上下留白(像素)。用 padding 而不是占位元素 —— 插占位会把卡片挤错列。 */
export function styleGridPadding(input: {
  window: StyleGridWindow;
  metrics: StyleGridMetrics;
  total: number;
}): { top: number; bottom: number } {
  const { columns, rowHeight } = input.metrics;
  if (rowHeight <= 0 || columns <= 0) return { top: 0, bottom: 0 };
  const rowCount = Math.ceil(input.total / columns);
  const leadingRows = Math.floor(input.window.start / columns);
  const trailingRows = Math.max(0, rowCount - Math.ceil(input.window.end / columns));
  return { top: leadingRows * rowHeight, bottom: trailingRows * rowHeight };
}
