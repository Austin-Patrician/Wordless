import assert from "node:assert/strict";
import test from "node:test";
import { FRAME_GAP, autoPlacement, reconcileFrames } from "../src/main/design/reconcile.ts";
import type { DesignFrameEntry } from "../src/main/design/manifest.ts";

function entry(id: string, x: number, y: number, width = 390, height = 844): DesignFrameEntry {
  return { id, file: `frames/${id}.html`, x, y, width, height, title: id };
}

function disk(id: string, width: number | null = null, height: number | null = null) {
  return { id, file: `frames/${id}.html`, parsed: { width, height, title: id } };
}

test("自动布局把新帧放在最右帧右边、与最上帧对齐", () => {
  assert.deepEqual(autoPlacement([]), { x: 0, y: 0 });
  const placed = [entry("a", 0, 0), entry("b", 470, 0)];
  assert.deepEqual(autoPlacement(placed), { x: 470 + 390 + FRAME_GAP, y: 0 });
  // y 取最上而不是最下:新帧落在同一行的顶部,不会掉到某帧下方去。
  const staggered = [entry("a", 0, 300), entry("b", 470, -50)];
  assert.deepEqual(autoPlacement(staggered), { x: 470 + 390 + FRAME_GAP, y: -50 });
});

test("用户拖拽新建的落点优先于自动布局", () => {
  const result = reconcileFrames({
    onDisk: [disk("a"), disk("dragged")],
    inManifest: [entry("a", 0, 0)],
    pendingPlacements: new Map([["dragged", { x: 900, y: 120 }]]),
  });
  const dragged = result.frames.find((frame) => frame.id === "dragged");
  assert.deepEqual({ x: dragged?.x, y: dragged?.y }, { x: 900, y: 120 });
  assert.equal(result.changed, true);
});

test("没有落点的新帧走自动布局", () => {
  // 两帧都显式声明尺寸,否则会拿兜底的 1440 宽,间距就不再是这里的关注点。
  const result = reconcileFrames({
    onDisk: [disk("a", 390, 844), disk("b", 390, 844)],
    inManifest: [entry("a", 0, 0)],
  });
  assert.deepEqual(result.frames.map((frame) => frame.id), ["a", "b"]);
  assert.equal(result.frames[1].x, 390 + FRAME_GAP);
});

test("位置归清单,标题与尺寸归声明", () => {
  const result = reconcileFrames({
    onDisk: [{ id: "a", file: "frames/a.html", parsed: { width: 428, height: 926, title: "新标题" } }],
    inManifest: [{ ...entry("a", 1234, 567, 390, 844), title: "旧标题" }],
  });
  assert.deepEqual(result.frames[0], {
    id: "a",
    file: "frames/a.html",
    x: 1234,
    y: 567,
    width: 428,
    height: 926,
    title: "新标题",
  });
  assert.equal(result.changed, true);
});

test("什么都没变时不报告变更,并复用原对象", () => {
  const existing = entry("a", 0, 0);
  const result = reconcileFrames({
    onDisk: [{ id: "a", file: "frames/a.html", parsed: { width: 390, height: 844, title: "a" } }],
    inManifest: [existing],
  });
  assert.equal(result.changed, false);
  // 身份不变是渲染预算:每秒都可能跑一次的对账不该让画布重渲染。
  assert.equal(result.frames[0], existing);
});

test("磁盘上消失的帧被丢弃并报告变更", () => {
  const result = reconcileFrames({ onDisk: [disk("a")], inManifest: [entry("a", 0, 0), entry("b", 470, 0)] });
  assert.deepEqual(result.frames.map((frame) => frame.id), ["a"]);
  assert.equal(result.changed, true);
});

test("漏声明的帧仍然进结果集", () => {
  const result = reconcileFrames({ onDisk: [disk("a", 390, 844), disk("blank")], inManifest: [] });
  assert.equal(result.frames.length, 2);
  assert.deepEqual({ width: result.frames[1].width, height: result.frames[1].height }, { width: 390, height: 844 });
});

test("对账是幂等的", () => {
  const first = reconcileFrames({ onDisk: [disk("a", 390, 844), disk("b", 390, 844)], inManifest: [] });
  const second = reconcileFrames({
    onDisk: [disk("a", 390, 844), disk("b", 390, 844)],
    inManifest: first.frames,
  });
  assert.deepEqual(second.frames, first.frames);
  assert.equal(second.changed, false);
});
