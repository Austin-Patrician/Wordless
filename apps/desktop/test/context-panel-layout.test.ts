import assert from "node:assert/strict";
import test from "node:test";
import { mainWidthFromPointer, panelWidthFromPointer } from "../src/renderer/features/artifacts/context-panel-layout.ts";

/**
 * 那条拖拽分隔线。
 *
 * 它现在有**两个方向**:默认布局拖的是面板,铺满布局(设计画布)拖的是相邻的对话列。边界是
 * 同一条,而"从哪一侧量"正好相反 —— 写错了不会报错,只会让拖动"有点怪",所以钉在这里。
 */

test("默认布局:面板宽度从窗口右边量起", () => {
  assert.equal(panelWidthFromPointer({ clientX: 1200, min: 240, max: 760, viewportWidth: 1600 }), 400);
  // 拖到最左边就顶到上限,而不是把面板撑满整个窗口。
  assert.equal(panelWidthFromPointer({ clientX: 0, min: 240, max: 760, viewportWidth: 1600 }), 760);
  // 拖到最右边收敛到下限,而不是变成一个负宽度。
  assert.equal(panelWidthFromPointer({ clientX: 1600, min: 240, max: 760, viewportWidth: 1600 }), 240);
});

test("铺满布局:对话列的宽度从**左栏右边**量起,而不是从窗口左边", () => {
  // 左栏展开 240,指针在 700 → 对话列 460。
  assert.equal(mainWidthFromPointer({ clientX: 700, leftSidebarWidth: 240, min: 320, max: 720 }), 460);
  // 不减左栏的实现会答 700 —— 那时拖到最左边会让画布吃掉左栏的位置,看起来像手柄失灵。
  assert.equal(mainWidthFromPointer({ clientX: 240, leftSidebarWidth: 240, min: 320, max: 720 }), 320);
  // 左栏折叠时它变窄,量法仍然成立。
  assert.equal(mainWidthFromPointer({ clientX: 300, leftSidebarWidth: 64, min: 320, max: 720 }), 320);
  // 上限:对话列不该宽过画布。
  assert.equal(mainWidthFromPointer({ clientX: 1400, leftSidebarWidth: 64, min: 320, max: 720 }), 720);
});

test("非有限输入收敛到下限,而不是产出 NaN 宽度", () => {
  // NaN 会一路走到 style.width,而那样面板直接消失。
  assert.equal(panelWidthFromPointer({ clientX: Number.NaN, min: 240, max: 760, viewportWidth: 1600 }), 240);
  assert.equal(mainWidthFromPointer({ clientX: Number.NaN, leftSidebarWidth: 240, min: 320, max: 720 }), 320);
});
