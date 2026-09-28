import assert from "node:assert/strict";
import test from "node:test";
import {
  STYLE_GRID_GAP,
  STYLE_GRID_MAX_COLUMNS,
  styleGridMetrics,
  styleGridPadding,
  styleGridWindow,
} from "../src/renderer/features/design/style-grid.ts";

test("宽度未知时退回全量渲染,而不是算出 0 列", () => {
  // 第一帧还没量出宽度。这时若算出 0 列,画廊会先空一屏。
  assert.deepEqual(styleGridMetrics(0), { columns: STYLE_GRID_MAX_COLUMNS, rowHeight: 0 });
  assert.deepEqual(styleGridMetrics(Number.NaN), { columns: STYLE_GRID_MAX_COLUMNS, rowHeight: 0 });
});

test("列数随宽度跳变,且不超过上限", () => {
  // 阈值由 MIN_CARD_WIDTH(240)+ gap(12)决定:2 列要 2*240 + 12 = 492,3 列要 3*240 + 24 = 744。
  assert.equal(styleGridMetrics(200).columns, 1);
  assert.equal(styleGridMetrics(491).columns, 1);
  assert.equal(styleGridMetrics(492).columns, 2);
  assert.equal(styleGridMetrics(743).columns, 2);
  assert.equal(styleGridMetrics(744).columns, 3);
  // 再宽也只有 3 列 —— 卡片再小,这一屏的作用就只剩「花」而不是「看清楚」。
  assert.equal(styleGridMetrics(4000).columns, STYLE_GRID_MAX_COLUMNS);
});

test("行高由列数反推,且包含行距", () => {
  const metrics = styleGridMetrics(760);
  const card = (760 - STYLE_GRID_GAP * (metrics.columns - 1)) / metrics.columns;
  // aspect-[4/3]:高 = 宽 / (4/3)
  assert.equal(metrics.rowHeight, card / (4 / 3) + STYLE_GRID_GAP);
});

test("窗口跟着滚动位置走,并带上下一行", () => {
  const metrics = { columns: 3, rowHeight: 100 };
  const atTop = styleGridWindow({ scrolledPast: 0, viewportHeight: 400, metrics, total: 30 });
  assert.equal(atTop.start, 0);
  // 视口 400 高 = 4 行,上下各多一行 → 6 行 = 18 条。
  assert.equal(atTop.end, 18);

  const scrolled = styleGridWindow({ scrolledPast: 500, viewportHeight: 400, metrics, total: 30 });
  assert.ok(scrolled.start > 0);
  assert.ok(scrolled.end > scrolled.start);
});

test("窗口覆盖完整行,不会缺一块", () => {
  // 缺半行看起来像加载失败,而不是窗口化。
  const metrics = { columns: 3, rowHeight: 100 };
  const window = styleGridWindow({ scrolledPast: 250, viewportHeight: 100, metrics, total: 30 });
  assert.equal(window.start % 3, 0);
  assert.equal(window.end % 3, 0);
});

test("窗口不会越过总数", () => {
  const metrics = { columns: 3, rowHeight: 100 };
  const window = styleGridWindow({ scrolledPast: 100_000, viewportHeight: 400, metrics, total: 4 });
  assert.ok(window.start <= 4);
  assert.equal(window.end, 4);
});

test("行高未知时整份渲染 —— 这一帧算不出窗口,宁可多画也不能留白", () => {
  const metrics = styleGridMetrics(0);
  const window = styleGridWindow({ scrolledPast: 300, viewportHeight: 400, metrics, total: 9 });
  assert.deepEqual(window, { start: 0, end: 9 });
});

test("负的滚动位置(还没滚到)按 0 处理", () => {
  const metrics = { columns: 3, rowHeight: 100 };
  const window = styleGridWindow({ scrolledPast: -500, viewportHeight: 400, metrics, total: 30 });
  assert.equal(window.start, 0);
});

test("撑开的留白与窗口一致,加起来等于全量高度", () => {
  const metrics = { columns: 3, rowHeight: 100 };
  const total = 30;
  const rowCount = Math.ceil(total / metrics.columns);
  const window = { start: 6, end: 18 };
  const padding = styleGridPadding({ window, metrics, total });
  assert.equal(padding.top, 2 * 100);
  assert.equal(padding.bottom, (rowCount - 6) * 100);
  // 渲染出来的那一段 + 上下留白 = 全量高度。
  assert.equal(padding.top + padding.bottom + ((window.end - window.start) / metrics.columns) * 100, rowCount * 100);
});

test("行高未知时不留白", () => {
  const padding = styleGridPadding({
    window: { start: 0, end: 3 },
    metrics: styleGridMetrics(0),
    total: 9,
  });
  assert.deepEqual(padding, { top: 0, bottom: 0 });
});
