import assert from "node:assert/strict";
import test from "node:test";
import type { DesignFrameDto, DesignManifestDto } from "@wordless/protocol";
import { DESIGN_CANVAS_BUDGETS } from "../src/renderer/features/design/budgets.ts";
import {
  designChromeScale,
  designContentRect,
  designFrameViews,
  frameEntryViewport,
  mergeRefreshedManifest,
  placeFrameMenu,
  shouldFitOnOpen,
} from "../src/renderer/features/design/design-view.ts";

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

test("右键菜单放不下就翻到另一侧,而不是被挤窄", () => {
  /*
    用户报的:frame 靠近边缘时右键,「交给 agent 改这一帧」会**自动换行**成两行。

    原因是绝对定位元素不给宽度时的"收缩到适合":宽度不超过 `容器宽 - left`,于是贴着右边缘
    开出来的菜单比它该有的宽度更窄,里面的文字只好换行。挤窄是**界面**最不该做的一种适应 ——
    正确做法是保持本来的宽度,翻到指针的另一侧。
  */
  const menu = { height: 100, width: 180 };
  const bounds = { height: 600, width: 800 };

  // 地方够:就开在指针的右下。
  assert.deepEqual(placeFrameMenu({ anchor: { x: 100, y: 100 }, bounds, menu }), { left: 100, top: 100 });

  // 右边放不下:翻到指针左边,而且**宽度一分不让**。
  const flipRight = placeFrameMenu({ anchor: { x: 700, y: 100 }, bounds, menu });
  assert.equal(flipRight.left, 700 - 180);
  assert.ok(flipRight.left + menu.width <= bounds.width, "翻过去之后仍然整个在容器里");

  // 下边放不下:翻到指针上边。
  const flipDown = placeFrameMenu({ anchor: { x: 100, y: 560 }, bounds, menu });
  assert.equal(flipDown.top, 560 - 100);
  assert.ok(flipDown.top + menu.height <= bounds.height);
});

test("右边和下边同时放不下时两轴各自翻,互不影响", () => {
  const menu = { height: 100, width: 180 };
  const bounds = { height: 600, width: 800 };

  const corner = placeFrameMenu({ anchor: { x: 780, y: 590 }, bounds, menu });
  assert.equal(corner.left, 780 - 180);
  assert.equal(corner.top, 590 - 100);
});

test("菜单比容器还大时贴边,但绝不越界", () => {
  // 这条是兜底:真到这一步,翻到哪边都放不下 —— 那就贴边(越界会被别的工作区盖住,更糟)。
  const menu = { height: 900, width: 900 };
  const bounds = { height: 600, width: 800 };

  const placed = placeFrameMenu({ anchor: { x: 400, y: 300 }, bounds, menu });
  assert.equal(placed.left, 6);
  assert.equal(placed.top, 6);

  // 另一头同样贴边,而不是负数(负的会把菜单推到画布外面)。
  const nearOrigin = placeFrameMenu({ anchor: { x: 0, y: 0 }, bounds, menu });
  assert.equal(nearOrigin.left, 6);
  assert.equal(nearOrigin.top, 6);
});

test("打开一份设计时该适配一次,而同一份设计刷新时不该再抢视角", () => {
  /*
    两条边界都要有,而且方向相反:

    - **换设计要重做**:在旧设计里调过的视角对新设计没有意义,不重做就可能打开一份设计却看到
      一片空白(内容在视口外)。用户报的就是这个。
    - **同一份设计只做一次**:agent 一直在改磁盘,刷新引起的重渲染不该把用户调好的画面抢回去。
  */
  const base = { designPath: "/w/a.wdesign", fitted: null, frameCount: 2, nodesInitialized: true };

  assert.equal(shouldFitOnOpen(base), true, "第一次打开:适配");
  assert.equal(
    shouldFitOnOpen({ ...base, fitted: "/w/a.wdesign" }),
    false,
    "同一份设计再刷新:不抢视角",
  );
  assert.equal(
    shouldFitOnOpen({ ...base, fitted: "/w/b.wdesign" }),
    true,
    "换了一份设计:重新适配",
  );
});

test("节点还没量完尺寸时不适配 —— 那时算出来的是空内容", () => {
  // `fitView` 按节点的**测量**尺寸算。节点刚建出来时尺寸是 0,这时适配等于"什么都没发生" ——
  // 而它看起来和"没有适配"一模一样,所以这条必须单独钉住。
  assert.equal(
    shouldFitOnOpen({
      designPath: "/w/a.wdesign",
      fitted: null,
      frameCount: 2,
      nodesInitialized: false,
    }),
    false,
  );
});

test("一帧都没有就不适配", () => {
  assert.equal(
    shouldFitOnOpen({ designPath: "/w/a.wdesign", fitted: null, frameCount: 0, nodesInitialized: true }),
    false,
  );
});

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
    camera: { x: 0, y: 0, zoom: DESIGN_CANVAS_BUDGETS.liveZoom - DESIGN_CANVAS_BUDGETS.liveZoomTolerance * 2 },
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

function manifest(frames: DesignFrameDto[]): DesignManifestDto {
  return { version: 1, type: "wordless-design", canvas: { x: 0, y: 0, zoom: 1 }, mode: "static", style: null, frames };
}

test("刷新回来的清单不动用户拖过的位置", () => {
  // 画布上的 a 被用户从 0 拖到了 900;磁盘上它还在 0(拖拽还没提交,或者刚提交)。
  const current = manifest([frame("a", 900, 0)]);
  const next = manifest([frame("a", 0, 0), frame("b", 470, 0)]);

  const merged = mergeRefreshedManifest(current, next);

  // 新帧按磁盘落点加进来;
  assert.deepEqual(merged.frames.map((f) => [f.id, f.x]), [["a", 900], ["b", 470]]);
});

test("刷新回来的清单接管内容,但不接管布局", () => {
  // 标题与尺寸是**内容**,归帧文件 —— 刷新必须让它们进来。
  const current = manifest([{ ...frame("a", 900, 0), title: "旧", width: 390 }]);
  const next = manifest([{ ...frame("a", 0, 0), title: "新", width: 1440 }]);

  const merged = mergeRefreshedManifest(current, next);

  assert.deepEqual([merged.frames[0].title, merged.frames[0].width, merged.frames[0].x], ["新", 1440, 900]);
});

test("磁盘上删掉的帧从画布上消失", () => {
  const merged = mergeRefreshedManifest(manifest([frame("a", 0, 0), frame("b", 470, 0)]), manifest([frame("a", 0, 0)]));
  assert.deepEqual(merged.frames.map((f) => f.id), ["a"]);
});

test("进入一帧时相机推到 1:1 并居中 —— 那是活体唯一正确的缩放", () => {
  // 原生视图不能被 CSS 缩放,而设计稿不能重排,所以"能真的点进去"只在 1:1 成立。
  // 能断言的只有目标:动画时长不能拿来断言(§14.1 ③)。
  assert.deepEqual(frameEntryViewport({ ...frame("a", 0, 0), width: 390, height: 844 }), {
    x: 195,
    y: 422,
    // 与 `allowsLiveSurface` 同一个数字:进去看到的版面必须就是交互时看到的版面。
    zoom: DESIGN_CANVAS_BUDGETS.liveZoom,
  });
  // 尺寸不同的帧也要居中,而不是把左上角对到中心。
  assert.deepEqual(frameEntryViewport({ ...frame("b", 100, 50), width: 1440, height: 900 }), {
    x: 820,
    y: 500,
    zoom: DESIGN_CANVAS_BUDGETS.liveZoom,
  });
});
