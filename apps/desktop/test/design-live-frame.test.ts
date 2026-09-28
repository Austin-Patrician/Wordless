import assert from "node:assert/strict";
import test from "node:test";
import type { DesignFrameDto } from "@wordless/protocol";
import { DESIGN_CANVAS_BUDGETS } from "../src/renderer/features/design/budgets.ts";
import { liveFrameTarget, type LiveFrameTargetInput } from "../src/renderer/features/design/live-frame.ts";

function frame(id: string, x = 0, y = 0): DesignFrameDto {
  return { id, file: `frames/${id}.html`, x, y, width: 390, height: 844, title: id };
}

function input(overrides: Partial<LiveFrameTargetInput> = {}): LiveFrameTargetInput {
  return {
    frames: [frame("a")],
    camera: { x: 0, y: 0, zoom: 1 },
    focusedFrameId: "a",
    containerRect: { left: 100, top: 50 },
    occluded: false,
    hasTexture: true,
    ...overrides,
  };
}

test("条件齐备时给出窗口坐标下的矩形", () => {
  const target = liveFrameTarget(input({ camera: { x: 10, y: 20, zoom: 2 } }));
  assert.deepEqual(target, {
    frameId: "a",
    // 画布坐标 (0,0) → 屏幕 (10,20) → 窗口 (110,70);尺寸按 2 倍缩放。
    bounds: { x: 110, y: 70, width: 780, height: 1688 },
  });
});

test("没有焦点帧就没有活体", () => {
  assert.equal(liveFrameTarget(input({ focusedFrameId: null })), null);
});

test("缩放不够时不给活体", () => {
  // 原生视图不能被 CSS 缩放:`setZoomFactor` 会重排布局,而设计稿在固定尺寸下不能重排。
  assert.equal(liveFrameTarget(input({ camera: { x: 0, y: 0, zoom: DESIGN_CANVAS_BUDGETS.liveZoomThreshold - 0.01 } })), null);
  assert.notEqual(liveFrameTarget(input({ camera: { x: 0, y: 0, zoom: DESIGN_CANVAS_BUDGETS.liveZoomThreshold } })), null);
});

test("没有位图时不给活体,避免切换瞬间闪白", () => {
  assert.equal(liveFrameTarget(input({ hasTexture: false })), null);
});

test("被浮层遮挡时让位", () => {
  // 原生视图永远盖在 DOM 之上:不摘掉的话设置对话框和菜单都点不到。
  assert.equal(liveFrameTarget(input({ occluded: true })), null);
});

test("容器没有几何时给不出窗口坐标", () => {
  assert.equal(liveFrameTarget(input({ containerRect: null })), null);
});

test("焦点帧不在清单里(刚被删掉)时不给活体", () => {
  assert.equal(liveFrameTarget(input({ focusedFrameId: "ghost" })), null);
});

test("矩形与位图贴图同源 —— 同一个变换函数派生", () => {
  // 这是最关键的一条不变量:两者都走 `worldRectToScreen`,所以结构上不可能错位。
  // 若哪天有人给活体单独算了一遍几何,这条会失败。
  const camera = { x: -120, y: 40, zoom: 0.75 };
  const frames = [frame("a", 470, -100)];
  const target = liveFrameTarget(input({ camera, frames, containerRect: { left: 0, top: 0 } }));
  // 与 `designFrameViews` 里的 `screenRect` 用同一个函数、同一组入参。
  const screen = ((0 + 470) * 0.75) + -120;
  assert.equal(target?.bounds.x, screen);
  assert.equal(target?.bounds.y, (-100 * 0.75) + 40);
  assert.equal(target?.bounds.width, 390 * 0.75);
  assert.equal(target?.bounds.height, 844 * 0.75);
});

test("容器偏移原样加在屏幕坐标上", () => {
  const target = liveFrameTarget(input({ containerRect: { left: 32, top: 96 } }));
  const noOffset = liveFrameTarget(input({ containerRect: { left: 0, top: 0 } }));
  assert.equal(target?.bounds.x, (noOffset?.bounds.x ?? 0) + 32);
  assert.equal(target?.bounds.y, (noOffset?.bounds.y ?? 0) + 96);
  // 尺寸不受容器位置影响。
  assert.equal(target?.bounds.width, noOffset?.bounds.width);
});
