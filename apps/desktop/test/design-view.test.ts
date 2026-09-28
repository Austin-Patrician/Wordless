import assert from "node:assert/strict";
import test from "node:test";
import type { DesignFrameDto } from "@wordless/protocol";
import { DESIGN_CANVAS_BUDGETS } from "../src/renderer/features/design/budgets.ts";
import { designChromeScale, designContentRect, designFrameViews } from "../src/renderer/features/design/design-view.ts";

function frame(id: string, x: number, y: number, width = 390, height = 844): DesignFrameDto {
  return { id, file: `frames/${id}.html`, x, y, width, height, title: id };
}

function project(overrides: Partial<Parameters<typeof designFrameViews>[0]> = {}) {
  return designFrameViews({
    frames: [frame("a", 0, 0), frame("b", 470, 0)],
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { width: 1200, height: 900 },
    focusedFrameId: null,
    selectedFrameIds: new Set<string>(),
    textures: new Map<string, string>(),
    failures: new Map(),
    artifactPresent: () => true,
    marginPx: DESIGN_CANVAS_BUDGETS.rasterMarginPx,
    ...overrides,
  });
}

test("屏幕矩形由相机派生,尺寸也按缩放走", () => {
  const views = project({ camera: { x: 100, y: 50, zoom: 2 } });
  const a = views.find((view) => view.id === "a");
  assert.deepEqual(a?.worldRect, { x: 0, y: 0, width: 390, height: 844 });
  assert.deepEqual(a?.screenRect, { x: 100, y: 50, width: 780, height: 1688 });
});

test("视口外的帧被裁掉", () => {
  const views = project({ frames: [frame("near", 0, 0), frame("far", 9000, 0)] });
  assert.deepEqual(views.map((view) => view.id), ["near"]);
});

test("余量让刚出视口的帧还留着 —— 快速平移不至于露白", () => {
  // 视口宽 1200,帧在 x=1300:无余量时在外面,有余量时进来。
  const frames = [frame("edge", 1300, 0)];
  assert.deepEqual(project({ frames, marginPx: 0 }).map((view) => view.id), []);
  assert.deepEqual(
    project({ frames, marginPx: DESIGN_CANVAS_BUDGETS.rasterMarginPx }).map((view) => view.id),
    ["edge"],
  );
});

test("没有位图时是占位态,而不是空白", () => {
  const views = project();
  for (const view of views) assert.equal(view.surface.kind, "placeholder");
  assert.deepEqual(views[0].surface, { kind: "placeholder", reason: "queued" });
});

test("产物缺失与失败各自成态", () => {
  const missing = project({ artifactPresent: () => false });
  assert.deepEqual(missing[0].surface, { kind: "placeholder", reason: "absent" });

  const failed = project({ failures: new Map([["a", "load-failed"]]) });
  assert.deepEqual(failed.find((view) => view.id === "a")?.surface, { kind: "failed", reason: "load-failed" });
});

test("有位图时贴图,聚焦且缩放够时交给活体", () => {
  const textures = new Map([["a", "tex-a"], ["b", "tex-b"]]);
  const views = project({ textures });
  assert.deepEqual(views.find((view) => view.id === "a")?.surface, { kind: "texture", textureKey: "tex-a" });

  const focused = project({ textures, focusedFrameId: "a" });
  assert.deepEqual(focused.find((view) => view.id === "a")?.surface, { kind: "live", textureKey: "tex-a" });
  // 其余帧仍是位图 —— 活体只有一个。
  assert.deepEqual(focused.find((view) => view.id === "b")?.surface, { kind: "texture", textureKey: "tex-b" });
});

test("缩放不够时即便聚焦也不给活体", () => {
  const views = project({
    textures: new Map([["a", "tex-a"]]),
    focusedFrameId: "a",
    camera: { x: 0, y: 0, zoom: DESIGN_CANVAS_BUDGETS.liveZoomThreshold - 0.01 },
  });
  assert.equal(views.find((view) => view.id === "a")?.surface.kind, "texture");
});

test("选中状态透传,供浮层画手柄", () => {
  const views = project({ selectedFrameIds: new Set(["b"]) });
  assert.equal(views.find((view) => view.id === "a")?.selected, false);
  assert.equal(views.find((view) => view.id === "b")?.selected, true);
});

test("标题透传", () => {
  const views = project({ frames: [{ ...frame("a", 0, 0), title: "首页" }] });
  assert.equal(views[0].title, "首页");
});

test("空设计不产出任何视图", () => {
  assert.deepEqual(project({ frames: [] }), []);
});

test("内容包围盒能包住全部帧,空设计为 null", () => {
  assert.equal(designContentRect([]), null);
  assert.deepEqual(designContentRect([frame("a", 0, 0), frame("b", 470, -100, 100, 100)]), {
    x: 0,
    y: -100,
    width: 570,
    height: 944,
  });
});

test("浮层反向缩放与相机缩放互逆,且有上限", () => {
  assert.equal(designChromeScale({ x: 0, y: 0, zoom: 1 }), 1);
  assert.equal(designChromeScale({ x: 0, y: 0, zoom: 2 }), 0.5);
  assert.equal(designChromeScale({ x: 0, y: 0, zoom: 0.5 }), 2);
  assert.equal(designChromeScale({ x: 0, y: 0, zoom: 0.01 }), 8);
});
