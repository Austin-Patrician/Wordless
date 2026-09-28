import assert from "node:assert/strict";
import test from "node:test";
import type { DesignFrameDto } from "@wordless/protocol";
import { DESIGN_CANVAS_BUDGETS } from "../src/renderer/features/design/budgets.ts";
import {
  frameFitsInViewport,
  liveFrameTarget,
  type LiveFrameTargetInput,
} from "../src/renderer/features/design/live-frame.ts";

function frame(id: string, x = 0, y = 0): DesignFrameDto {
  return { id, file: `frames/${id}.html`, x, y, width: 390, height: 844, title: id };
}

/**
 * 容器给得**足够大**,好让下面每条用例只考它自己那一件事 —— 放不放得下由
 * `frameFitsInViewport` 的用例专门覆盖(它是一条独立的正确性条件)。
 */
function input(overrides: Partial<LiveFrameTargetInput> = {}): LiveFrameTargetInput {
  return {
    frames: [frame("a")],
    camera: { x: 0, y: 0, zoom: 1 },
    enteredFrameId: "a",
    containerRect: { height: 4_000, left: 100, top: 50, width: 4_000 },
    occluded: false,
    hasTexture: true,
    dragging: false,
    ...overrides,
  };
}

test("条件齐备时给出窗口坐标下的矩形", () => {
  // 缩放取 1:1 —— 那是活体唯一成立的一档(见上一条)。
  const target = liveFrameTarget(input({ camera: { x: 10, y: 20, zoom: DESIGN_CANVAS_BUDGETS.liveZoom } }));
  assert.deepEqual(target, {
    frameId: "a",
    // 画布坐标 (0,0) → 屏幕 (10,20) → 窗口 (110,70);1:1 下尺寸就是声明尺寸。
    bounds: { x: 110, y: 70, width: 390, height: 844 },
  });
});

test("没有进入的帧就没有活体", () => {
  assert.equal(liveFrameTarget(input({ enteredFrameId: null })), null);
});

test("缩放不是 1:1 时不给活体 —— 这是个正确性问题", () => {
  // 宿主只做 `setBounds`、不做缩放补偿,所以非 1:1 时原生视图的视口不等于帧的声明尺寸,
  // 页面会按小视口**重排**。0.9 是这条的分界线:以前它被判为够格,而那时画布上是错的版面。
  const outside = DESIGN_CANVAS_BUDGETS.liveZoomTolerance * 2;
  assert.equal(liveFrameTarget(input({ camera: { x: 0, y: 0, zoom: DESIGN_CANVAS_BUDGETS.liveZoom - outside } })), null);
  assert.equal(liveFrameTarget(input({ camera: { x: 0, y: 0, zoom: DESIGN_CANVAS_BUDGETS.liveZoom + outside } })), null);
  assert.equal(liveFrameTarget(input({ camera: { x: 0, y: 0, zoom: 0.9 } })), null);
  assert.notEqual(liveFrameTarget(input({ camera: { x: 0, y: 0, zoom: DESIGN_CANVAS_BUDGETS.liveZoom } })), null);
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
  assert.equal(liveFrameTarget(input({ enteredFrameId: "ghost" })), null);
});

test("矩形与位图贴图同源 —— 同一个变换函数派生", () => {
  // 这是最关键的一条不变量:两者都走 `worldRectToScreen`,所以结构上不可能错位。
  // 若哪天有人给活体单独算了一遍几何,这条会失败。
  const camera = { x: -120, y: 40, zoom: DESIGN_CANVAS_BUDGETS.liveZoom };
  // 位置取"整帧落在容器里"的一处 —— 这条考的是坐标怎么来的,不是放不放得下
  // (后者由 `frameFitsInViewport` 的用例专门考)。
  const frames = [frame("a", 470, 100)];
  const target = liveFrameTarget(input({ camera, frames, containerRect: { height: 4_000, left: 0, top: 0, width: 4_000 } }));
  // 与 `designFrameViews` 里的 `screenRect` 用同一个函数、同一组入参。
  const screen = ((0 + 470) * camera.zoom) + camera.x;
  assert.equal(target?.bounds.x, screen);
  assert.equal(target?.bounds.y, (100 * camera.zoom) + camera.y);
  assert.equal(target?.bounds.width, 390 * camera.zoom);
  assert.equal(target?.bounds.height, 844 * camera.zoom);
});

test("容器偏移原样加在屏幕坐标上", () => {
  const target = liveFrameTarget(input({ containerRect: { height: 4_000, left: 32, top: 96, width: 4_000 } }));
  const noOffset = liveFrameTarget(input({ containerRect: { height: 4_000, left: 0, top: 0, width: 4_000 } }));
  assert.equal(target?.bounds.x, (noOffset?.bounds.x ?? 0) + 32);
  assert.equal(target?.bounds.y, (noOffset?.bounds.y ?? 0) + 96);
  // 尺寸不受容器位置影响。
  assert.equal(target?.bounds.width, noOffset?.bounds.width);
});

test("拖拽或缩放中一律交还给位图 —— 否则同一帧会出现两次", () => {
  // 拖拽移动的是 DOM 节点,而清单(活体矩形唯一的来源)要等拖拽结束才提交。于是原生视图
  // 停在原地、位图跟着手走 —— 画布上两个相同的画面,一个跟手一个不动。
  assert.equal(liveFrameTarget(input({ dragging: true })), null);
});

test("帧比面板还大时不给活体 —— 原生视图不被 CSS 裁剪", () => {
  // 面板 400 宽,一帧在 1:1 下 390 —— 放得下。
  const tight = { height: 900, left: 0, top: 0, width: 400 };
  assert.notEqual(liveFrameTarget(input({ containerRect: tight })), null);

  // 面板窄到 300:放不下了,而原生视图**不会被面板裁掉** —— 它会盖到对话区和左侧栏上面。
  // 裁小更糟(页面会按小视口重排,那是错的版面),所以唯一正确的做法是不给。
  assert.equal(liveFrameTarget(input({ containerRect: { ...tight, width: 300 } })), null);
});

test("偏出容器一半的帧也不给活体", () => {
  const container = { height: 900, left: 0, top: 0, width: 400 };
  // 位置也要在容器内:偏出去一半的原生视图同样会盖到面板外面。
  assert.equal(liveFrameTarget(input({ camera: { x: -20, y: 0, zoom: 1 }, containerRect: container })), null);
  assert.notEqual(liveFrameTarget(input({ camera: { x: 5, y: 5, zoom: 1 }, containerRect: container })), null);
});

test("frameFitsInViewport 按屏幕尺寸判,而且容得下亚像素误差", () => {
  const size = { height: 844, width: 390, x: 0, y: 0 };
  const container = { height: 900, width: 400 };

  assert.equal(frameFitsInViewport({ camera: { x: 0, y: 0, zoom: 1 }, container, frame: size }), true);
  assert.equal(frameFitsInViewport({ camera: { x: 0, y: 0, zoom: 1.1 }, container, frame: size }), false);
  // **位置和尺寸一起算**:只把相机的偏移当成屏幕位置是错的,那样"帧在画布原点"才碰巧对,
  // 而一平移画布相机就变成负数、活体会整片消失。这一条钉的就是那个错误。
  // 相机往右下偏一点:屏幕位置跟着走,但整帧仍然在容器内。
  assert.equal(frameFitsInViewport({ camera: { x: 5, y: 5, zoom: 1 }, container, frame: size }), true);
  // 帧自己在画布上右移 50,而相机左移 50 —— 屏幕上是 0,所以放得下。这条钉的是"位置参与了
  // 计算":只看相机的实现会答错。
  assert.equal(
    frameFitsInViewport({ camera: { x: -50, y: 0, zoom: 1 }, container, frame: { ...size, x: 50 } }),
    true,
  );
  // 相机再往左偏 60,屏幕位置变成 -60 —— 左边缘露在容器外面,那就是溢出面板。
  assert.equal(
    frameFitsInViewport({ camera: { x: -110, y: 0, zoom: 1 }, container, frame: { ...size, x: 50 } }),
    false,
  );
  // 缩放是浮点的:差 0.4px 不该让活体闪掉。
  assert.equal(
    frameFitsInViewport({ camera: { x: 0, y: 0, zoom: 1 }, container: { height: 899.6, width: 399.7 }, frame: size }),
    true,
  );
});