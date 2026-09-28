import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitCamera,
  inverseScale,
  rectsIntersect,
  screenPointToWorld,
  screenRectToWorld,
  snapToGrid,
  unionRects,
  visibleFrameIds,
  worldPointToScreen,
  worldRectToScreen,
  zoomAround,
  zoomBucket,
  type Camera,
} from "../src/renderer/features/design/camera.ts";

/** 浮点比较:这些函数会被反复复合,直接相等会在噪声上失败。 */
function closeTo(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} !== ${expected}`);
}

const CAMERA: Camera = { x: 100, y: 50, zoom: 1.5 };

test("点变换与其逆互为反函数", () => {
  const point = { x: 321.5, y: -78.25 };
  const screen = worldPointToScreen(CAMERA, point);
  const back = screenPointToWorld(CAMERA, screen);
  closeTo(back.x, point.x);
  closeTo(back.y, point.y);
});

test("矩形变换与其逆互为反函数", () => {
  const rect = { x: -40, y: 12, width: 390, height: 844 };
  const screen = worldRectToScreen(CAMERA, rect);
  // 尺寸也要按 zoom 缩放,不只是原点 —— 漏掉这一点会让位图尺寸错。
  closeTo(screen.width, 390 * 1.5);
  closeTo(screen.height, 844 * 1.5);
  const back = screenRectToWorld(CAMERA, screen);
  closeTo(back.x, rect.x);
  closeTo(back.y, rect.y);
  closeTo(back.width, rect.width);
  closeTo(back.height, rect.height);
});

test("缩放围绕锚点,锚点在屏幕上不动", () => {
  // 滚轮缩放时内容不该从光标下跑掉 —— 这是最常见的"缩放手感不对"。
  const anchor = { x: 300, y: 200 };
  const before = screenPointToWorld(CAMERA, anchor);
  const zoomed = zoomAround(CAMERA, 3, anchor);
  const after = worldPointToScreen(zoomed, before);
  closeTo(after.x, anchor.x);
  closeTo(after.y, anchor.y);
});

test("缩放围绕锚点在缩小方向同样成立", () => {
  const anchor = { x: 12, y: 640 };
  const before = screenPointToWorld(CAMERA, anchor);
  const zoomed = zoomAround(CAMERA, 0.4, anchor);
  const after = worldPointToScreen(zoomed, before);
  closeTo(after.x, anchor.x);
  closeTo(after.y, anchor.y);
});

test("缩放的输入被夹到合法区间", () => {
  assert.equal(zoomAround(CAMERA, 99, { x: 0, y: 0 }).zoom, MAX_ZOOM);
  assert.equal(zoomAround(CAMERA, 0.0001, { x: 0, y: 0 }).zoom, MIN_ZOOM);
  // 非有限输入统一回落到中性的 1,否则相机会带着 NaN 传播到所有矩形。
  // 注意不是夹到 MAX_ZOOM:Infinity 夹到上限看着"合理",但那样 NaN 与 Infinity
  // 就有两种行为,而两者都只是坏输入。
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(clampZoom(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampZoom(Number.NEGATIVE_INFINITY), 1);
});

test("反向缩放让 chrome 在任何缩放下保持屏幕尺寸,且有上限", () => {
  assert.equal(inverseScale(1), 1);
  closeTo(inverseScale(2), 0.5);
  closeTo(inverseScale(0.5), 2);
  // 缩到很小时 chrome 不该比内容还大。
  assert.equal(inverseScale(0.01), 8);
  assert.equal(inverseScale(0), 1);
  assert.equal(inverseScale(Number.NaN), 1);
});

test("适配视口会把内容居中", () => {
  const content = { x: 0, y: 0, width: 1000, height: 500 };
  const camera = fitCamera(content, { width: 800, height: 600 });
  closeTo(camera.zoom, 0.8);
  const screen = worldRectToScreen(camera, content);
  // 内容在视口里居中:左右留白相等,上下留白相等。
  closeTo(screen.x, 0);
  closeTo(screen.x + screen.width, 800);
  closeTo(screen.y, 100);
  closeTo(screen.y + screen.height, 500);
});

test("适配视口不会把小内容放大", () => {
  // 一个 390×844 的帧被拉到满屏会失去"这是手机屏"的判断依据。
  const camera = fitCamera({ x: 0, y: 0, width: 100, height: 100 }, { width: 800, height: 600 });
  assert.equal(camera.zoom, 1);
  // 显式放开上限时才允许放大。
  const magnified = fitCamera({ x: 0, y: 0, width: 100, height: 100 }, { width: 800, height: 600 }, { maxZoom: 4 });
  assert.equal(magnified.zoom, 4);
});

test("适配视口的留白按比例收缩可用区域", () => {
  const content = { x: 0, y: 0, width: 800, height: 600 };
  const camera = fitCamera(content, { width: 800, height: 600 }, { paddingRatio: 0.1 });
  closeTo(camera.zoom, 0.8);
});

test("退化输入不会产出 NaN 相机", () => {
  const zero = fitCamera({ x: 0, y: 0, width: 0, height: 0 }, { width: 800, height: 600 });
  assert.deepEqual(zero, { x: 0, y: 0, zoom: 1 });
  const noViewport = fitCamera({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 });
  assert.ok(Number.isFinite(noViewport.x) && Number.isFinite(noViewport.y) && Number.isFinite(noViewport.zoom));
});

test("矩形相交判定:贴边不算相交", () => {
  const base = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(rectsIntersect(base, { x: 50, y: 50, width: 100, height: 100 }), true);
  // 贴边不算 —— 否则视口边缘的帧会白白进入渲染集合。
  assert.equal(rectsIntersect(base, { x: 100, y: 0, width: 100, height: 100 }), false);
  assert.equal(rectsIntersect(base, { x: 0, y: 100, width: 100, height: 100 }), false);
  assert.equal(rectsIntersect(base, { x: 200, y: 0, width: 10, height: 10 }), false);
  // 完全包含也算相交。
  assert.equal(rectsIntersect(base, { x: 10, y: 10, width: 10, height: 10 }), true);
});

test("合并矩形能包住全部,空集返回 null", () => {
  assert.equal(unionRects([]), null);
  const union = unionRects([
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 100, y: -20, width: 10, height: 10 },
  ]);
  assert.deepEqual(union, { x: 0, y: -20, width: 110, height: 30 });
});

test("视口裁剪只留下可见的帧", () => {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };
  const viewport = { width: 800, height: 600 };
  const frames = [
    { id: "near", x: 0, y: 0, width: 100, height: 100 },
    { id: "edge", x: 1000, y: 0, width: 100, height: 100 },
    { id: "far", x: 5000, y: 0, width: 100, height: 100 },
  ];
  assert.deepEqual(visibleFrameIds(camera, frames, viewport, 0), ["near"]);
  // 余量按屏幕像素给:快速平移时下一屏的内容提前就位,不至于露白。
  assert.deepEqual(visibleFrameIds(camera, frames, viewport, 400), ["near", "edge"]);
});

test("视口裁剪的余量随缩放换算,不随缩放放大", () => {
  // 余量是屏幕像素,放大后对应的画布范围应当变小。
  const frames = [{ id: "a", x: 900, y: 0, width: 100, height: 100 }];
  const viewport = { width: 800, height: 600 };
  const zoomedOut = visibleFrameIds({ x: 0, y: 0, zoom: 0.5 }, frames, viewport, 0);
  const zoomedIn = visibleFrameIds({ x: 0, y: 0, zoom: 2 }, frames, viewport, 0);
  assert.deepEqual(zoomedOut, ["a"]);
  assert.deepEqual(zoomedIn, []);
});

test("位图档位取不超过当前缩放的最大档", () => {
  const buckets = [0.25, 0.5, 1, 2];
  assert.equal(zoomBucket(0.25, buckets), 0.25);
  assert.equal(zoomBucket(0.3, buckets), 0.25);
  assert.equal(zoomBucket(0.5, buckets), 0.5);
  assert.equal(zoomBucket(0.99, buckets), 0.5);
  assert.equal(zoomBucket(1, buckets), 1);
  assert.equal(zoomBucket(3, buckets), 2);
  // 低于最小档时用最小档:内容小到看不清,模糊无所谓。
  assert.equal(zoomBucket(0.01, buckets), 0.25);
});

test("位图档位对乱序与非法输入是稳的", () => {
  assert.equal(zoomBucket(0.7, [1, 0.25, 2, 0.5]), 0.5);
  assert.equal(zoomBucket(1, [1, 0.5]), 1);
  // 没有合法档位时回落到 1,而不是返回 undefined 让位图尺寸变成 NaN。
  assert.equal(zoomBucket(1, []), 1);
  assert.equal(zoomBucket(1, [0, -1, Number.NaN]), 1);
  assert.equal(zoomBucket(Number.NaN, [0.5, 1]), 0.5);
});

test("网格吸附在关闭或网格非法时原样返回", () => {
  assert.equal(snapToGrid(37, 10, true), 40);
  assert.equal(snapToGrid(34, 10, true), 30);
  assert.equal(snapToGrid(-34, 10, true), -30);
  assert.equal(snapToGrid(37, 10, false), 37);
  assert.equal(snapToGrid(37, 0, true), 37);
  assert.equal(snapToGrid(37, Number.NaN, true), 37);
});
