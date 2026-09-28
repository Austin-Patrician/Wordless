import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_CANVAS_BUDGETS } from "../src/renderer/features/design/budgets.ts";
import {
  frameSurfaceHasBacking,
  frameSurfaceIsLive,
  frameSurfaceIsVisible,
  resolveFrameSurface,
  type FrameSurfaceInput,
} from "../src/renderer/features/design/frame-surface.ts";

function input(overrides: Partial<FrameSurfaceInput> = {}): FrameSurfaceInput {
  return {
    visible: true,
    zoom: 1,
    focused: false,
    textureKey: null,
    rasterizing: false,
    artifactPresent: true,
    failure: null,
    ...overrides,
  };
}

test("视口外一律 hidden,连失败也不渲染", () => {
  // 不渲染的东西没有视觉状态。失败照常从 design_status 的 issues 报出去 —— 那是
  // 另一条通道,不该靠"在视口外画一个错误态"来传达。
  assert.deepEqual(resolveFrameSurface(input({ visible: false })), { kind: "hidden" });
  assert.deepEqual(
    resolveFrameSurface(input({ visible: false, failure: { reason: "load-failed" }, artifactPresent: false })),
    { kind: "hidden" },
  );
});

test("失败必须看得见,而不是空白", () => {
  // 参考实现吃过这个亏:出问题的帧直接不上画布,用户盯着空白,agent 拿不到任何信号。
  const surface = resolveFrameSurface(input({ failure: { reason: "raster-timeout" } }));
  assert.deepEqual(surface, { kind: "failed", reason: "raster-timeout" });
  // 失败优先于"没有产物"和"有位图":坏就是坏。
  assert.equal(resolveFrameSurface(input({ failure: { reason: "load-failed" }, artifactPresent: false })).kind, "failed");
  assert.equal(resolveFrameSurface(input({ failure: { reason: "load-failed" }, textureKey: "t" })).kind, "failed");
});

test("失败带上细节时细节被保留", () => {
  const surface = resolveFrameSurface(input({ failure: { reason: "build-failed", detail: "tsc: 3 errors" } }));
  assert.deepEqual(surface, { kind: "failed", reason: "build-failed", detail: "tsc: 3 errors" });
});

test("dist 里没有产物时是占位卡,不是空白", () => {
  assert.deepEqual(resolveFrameSurface(input({ artifactPresent: false })), {
    kind: "placeholder",
    reason: "absent",
  });
  // 即便有位图残留,产物没了也不该继续贴。
  assert.deepEqual(resolveFrameSurface(input({ artifactPresent: false, textureKey: "stale" })), {
    kind: "placeholder",
    reason: "absent",
  });
});

test("活体需要同时满足:聚焦、缩放够、有位图", () => {
  const live = { focused: true, zoom: 1, textureKey: "t" };
  assert.deepEqual(resolveFrameSurface(input(live)), { kind: "live", textureKey: "t" });

  // 没聚焦 → 位图。
  assert.deepEqual(resolveFrameSurface(input({ ...live, focused: false })), { kind: "texture", textureKey: "t" });

  // 缩放不够 → 位图。原生视图只能整数矩形定位且不能被 CSS 缩放,非 1:1 下强行显示
  // 会得到重排后的错误版面。
  assert.deepEqual(
    resolveFrameSurface(input({ ...live, zoom: DESIGN_CANVAS_BUDGETS.liveZoomThreshold - 0.01 })),
    { kind: "texture", textureKey: "t" },
  );
});

test("没有底图就不上活体,避免切换瞬间闪白", () => {
  // 聚焦且缩放够,但位图还没到 —— 这时应当继续占位,而不是先架一个空的原生视图。
  assert.deepEqual(resolveFrameSurface(input({ focused: true, zoom: 1, textureKey: null, rasterizing: true })), {
    kind: "placeholder",
    reason: "rasterizing",
  });
  assert.deepEqual(resolveFrameSurface(input({ focused: true, zoom: 1, textureKey: null })), {
    kind: "placeholder",
    reason: "queued",
  });
});

test("重新光栅时旧位图继续用,不退回骨架态", () => {
  // 换缩放档会触发重新光栅,此时旧位图比骨架态好。
  assert.deepEqual(resolveFrameSurface(input({ textureKey: "old", rasterizing: true })), {
    kind: "texture",
    textureKey: "old",
  });
  assert.deepEqual(resolveFrameSurface(input({ textureKey: "old", rasterizing: true, focused: true, zoom: 1 })), {
    kind: "live",
    textureKey: "old",
  });
});

test("占位区分排队与进行中", () => {
  assert.deepEqual(resolveFrameSurface(input({ rasterizing: true })), {
    kind: "placeholder",
    reason: "rasterizing",
  });
  assert.deepEqual(resolveFrameSurface(input()), { kind: "placeholder", reason: "queued" });
});

test("辅助判定与 kind 一致", () => {
  const hidden = resolveFrameSurface(input({ visible: false }));
  const placeholder = resolveFrameSurface(input());
  const texture = resolveFrameSurface(input({ textureKey: "t" }));
  const live = resolveFrameSurface(input({ focused: true, zoom: 1, textureKey: "t" }));

  assert.equal(frameSurfaceIsVisible(hidden), false);
  assert.equal(frameSurfaceIsVisible(placeholder), true);

  assert.equal(frameSurfaceIsLive(live), true);
  assert.equal(frameSurfaceIsLive(texture), false);

  // 活体是位图之上的一层,底下的位图仍在 —— 两者都算"有内容可贴"。
  assert.equal(frameSurfaceHasBacking(live), true);
  assert.equal(frameSurfaceHasBacking(texture), true);
  assert.equal(frameSurfaceHasBacking(placeholder), false);
  assert.equal(frameSurfaceHasBacking(hidden), false);
});
