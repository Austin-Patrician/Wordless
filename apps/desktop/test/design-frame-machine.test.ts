import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_CANVAS_BUDGETS } from "../src/renderer/features/design/budgets.ts";
import {
  INITIAL_FRAME_STATE,
  frameStateIsLive,
  frameStateIsVisible,
  frameStateNeedsRaster,
  frameStateTextureKey,
  reduceFrame,
  type FrameEvent,
  type FrameState,
} from "../src/renderer/features/design/frame-machine.ts";

/** 走完"发现产物 → 拿到槽 → 光栅完成"到达 ready。 */
function atReady(textureKey = "tex-1"): FrameState {
  let state = reduceFrame(INITIAL_FRAME_STATE, { type: "artifact-found" });
  state = reduceFrame(state, { type: "slot-acquired", startedAt: 1000 });
  return reduceFrame(state, { type: "raster-done", textureKey });
}

const ALL_PHASES: FrameState[] = [
  { phase: "absent" },
  { phase: "registering" },
  { phase: "rasterizing", startedAt: 0 },
  { phase: "ready", textureKey: "t" },
  { phase: "live", textureKey: "t" },
  { phase: "failed", reason: "load-failed" },
];

test("顺利路径:发现产物 → 排队 → 光栅 → ready", () => {
  let state = INITIAL_FRAME_STATE;
  assert.equal(frameStateNeedsRaster(state), false);

  state = reduceFrame(state, { type: "artifact-found" });
  assert.deepEqual(state, { phase: "registering" });
  // 只有 registering 需要入队,别处入队会导致重复光栅。
  assert.equal(frameStateNeedsRaster(state), true);

  state = reduceFrame(state, { type: "slot-acquired", startedAt: 42 });
  assert.deepEqual(state, { phase: "rasterizing", startedAt: 42 });
  assert.equal(frameStateNeedsRaster(state), false);

  state = reduceFrame(state, { type: "raster-done", textureKey: "tex-1" });
  assert.deepEqual(state, { phase: "ready", textureKey: "tex-1" });
  assert.equal(frameStateTextureKey(state), "tex-1");
  assert.equal(frameStateIsLive(state), false);
});

test("聚焦且缩放够才进 live,缩放不够退回 ready", () => {
  const ready = atReady();
  const live = reduceFrame(ready, { type: "focus-changed", focused: true, zoom: 1 });
  assert.deepEqual(live, { phase: "live", textureKey: "tex-1" });
  assert.equal(frameStateIsLive(live), true);
  // 位图仍在手上 —— 活体只是它上面的一层。
  assert.equal(frameStateTextureKey(live), "tex-1");

  // 缩小看全局 → 交还位图。
  const zoomedOut = reduceFrame(live, {
    type: "focus-changed",
    focused: true,
    zoom: DESIGN_CANVAS_BUDGETS.liveZoomThreshold - 0.01,
  });
  assert.deepEqual(zoomedOut, { phase: "ready", textureKey: "tex-1" });

  // 失焦 → 交还位图。
  assert.deepEqual(reduceFrame(live, { type: "focus-changed", focused: false, zoom: 1 }), {
    phase: "ready",
    textureKey: "tex-1",
  });
});

test("非聚焦帧不会因为缩放够就变成 live", () => {
  assert.deepEqual(reduceFrame(atReady(), { type: "focus-changed", focused: false, zoom: 4 }), {
    phase: "ready",
    textureKey: "tex-1",
  });
});

test("重新光栅不打断既有呈现,只换 textureKey", () => {
  // 换缩放档会重新光栅;退回骨架态会让画面闪一下,这是不该有的。
  assert.deepEqual(reduceFrame(atReady("old"), { type: "raster-done", textureKey: "new" }), {
    phase: "ready",
    textureKey: "new",
  });

  // live 期间重新光栅后仍然必须是 live,否则原生视图会被拆掉再接上。
  const live = reduceFrame(atReady("old"), { type: "focus-changed", focused: true, zoom: 1 });
  assert.deepEqual(reduceFrame(live, { type: "raster-done", textureKey: "new" }), {
    phase: "live",
    textureKey: "new",
  });
});

test("同样的 textureKey 不产生新对象", () => {
  // 身份不变是渲染预算:每秒都可能来的重复回调不该触发重渲染。
  const ready = atReady("same");
  assert.equal(reduceFrame(ready, { type: "raster-done", textureKey: "same" }), ready);
  const live = reduceFrame(ready, { type: "focus-changed", focused: true, zoom: 1 });
  assert.equal(reduceFrame(live, { type: "raster-done", textureKey: "same" }), live);
});

test("产物消失时任何状态都让位", () => {
  for (const phase of ALL_PHASES) {
    assert.deepEqual(
      reduceFrame(phase, { type: "artifact-lost" }),
      INITIAL_FRAME_STATE,
      `从 ${phase.phase} 收到 artifact-lost 后应回到 absent`,
    );
  }
  // 已经在 absent 时返回同一个对象,避免无意义的重渲染。
  assert.equal(reduceFrame(INITIAL_FRAME_STATE, { type: "artifact-lost" }), INITIAL_FRAME_STATE);
});

test("迟到的光栅回调不会复活已删除的帧", () => {
  // 这是真实的竞态:光栅是异步的,产物可能在回调到达前就被删了。
  // 若接受这个回调,画布上会贴着一张已删除帧的位图。
  let state: FrameState = reduceFrame(INITIAL_FRAME_STATE, { type: "artifact-found" });
  state = reduceFrame(state, { type: "slot-acquired", startedAt: 0 });
  state = reduceFrame(state, { type: "artifact-lost" });
  assert.deepEqual(state, { phase: "absent" });

  assert.deepEqual(reduceFrame(state, { type: "raster-done", textureKey: "late" }), { phase: "absent" });
  assert.deepEqual(reduceFrame(state, { type: "raster-failed", reason: "load-failed" }), { phase: "absent" });
  assert.deepEqual(reduceFrame(state, { type: "slot-acquired", startedAt: 0 }), { phase: "absent" });
});

test("光栅失败与超时都落到 failed,且带原因", () => {
  const registering = reduceFrame(INITIAL_FRAME_STATE, { type: "artifact-found" });
  assert.deepEqual(reduceFrame(registering, { type: "raster-failed", reason: "load-failed" }), {
    phase: "failed",
    reason: "load-failed",
  });

  const rasterizing = reduceFrame(registering, { type: "slot-acquired", startedAt: 0 });
  assert.deepEqual(reduceFrame(rasterizing, { type: "raster-failed", reason: "raster-timeout", detail: "5s" }), {
    phase: "failed",
    reason: "raster-timeout",
    detail: "5s",
  });
});

test("failed 可以重试,产物回来了也会自动重试", () => {
  const failed: FrameState = { phase: "failed", reason: "raster-timeout" };
  assert.deepEqual(reduceFrame(failed, { type: "retry" }), { phase: "registering" });
  // 产物重新出现(例如重新构建完成)时不必等用户点重试。
  assert.deepEqual(reduceFrame(failed, { type: "artifact-found" }), { phase: "registering" });
});

test("意料之外的事件一律 no-op", () => {
  // 不变量:每条异步边都有终点,不接受会让状态机漂移的事件。
  const ready = atReady();
  const noOps: FrameEvent[] = [
    { type: "slot-acquired", startedAt: 1 },
    { type: "artifact-found" },
    { type: "retry" },
    { type: "focus-changed", focused: false, zoom: 1 },
  ];
  for (const event of noOps) {
    assert.equal(reduceFrame(ready, event), ready, `ready 收到 ${event.type} 应当不变`);
  }

  const live = reduceFrame(ready, { type: "focus-changed", focused: true, zoom: 1 });
  assert.equal(reduceFrame(live, { type: "slot-acquired", startedAt: 1 }), live);
  assert.equal(reduceFrame(live, { type: "artifact-found" }), live);
  assert.equal(reduceFrame(live, { type: "retry" }), live);

  const rasterizing: FrameState = { phase: "rasterizing", startedAt: 0 };
  assert.equal(reduceFrame(rasterizing, { type: "artifact-found" }), rasterizing);

  // 这是重试风暴的内部防线:`failed` 收到 artifact-found 会重试,所以同一个阶段的
  // 第二次 artifact-found 必须是 no-op。跨阶段的循环只能靠调用方契约挡住
  // (见 frame-machine.ts 的「调用方契约」),这里钉住机器这一侧。
  const registering = reduceFrame(INITIAL_FRAME_STATE, { type: "artifact-found" });
  assert.equal(reduceFrame(registering, { type: "artifact-found" }), registering);
  assert.equal(reduceFrame(rasterizing, { type: "retry" }), rasterizing);

  const failed: FrameState = { phase: "failed", reason: "load-failed" };
  assert.equal(reduceFrame(failed, { type: "raster-done", textureKey: "x" }), failed);
  assert.equal(reduceFrame(failed, { type: "focus-changed", focused: true, zoom: 1 }), failed);
});

test("辅助判定与阶段一致", () => {
  assert.equal(frameStateIsVisible({ phase: "absent" }), false);
  assert.equal(frameStateIsVisible({ phase: "registering" }), true);
  assert.equal(frameStateTextureKey({ phase: "rasterizing", startedAt: 0 }), null);
  assert.equal(frameStateTextureKey({ phase: "failed", reason: "load-failed" }), null);
  assert.equal(frameStateIsLive({ phase: "ready", textureKey: "t" }), false);
});
