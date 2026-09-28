import { allowsLiveSurface } from "./budgets.ts";
import type { FrameFailureReason } from "./frame-surface.ts";

/**
 * 一帧的生命周期状态机。
 *
 * 参考实现用 `mounted` / `raster` / `paintTick` 加一个兜底计时器拼出隐式状态,于是
 * 出现"遮罩本该让位时松手事件落空,这一次拖拽再也结束不了"这类问题 —— 状态是**推断**
 * 出来的,不是**声明**的。
 *
 * 这里的纪律:
 *
 * 1. **每条异步边都有终点** —— 光栅化要么 `raster-done` 要么 `raster-failed`(超时
 *    只是后者的一个 reason),不存在停在中间态。
 * 2. **意料之外的事件一律 no-op** —— 这条同时是**竞态保护**:一个迟到的
 *    `raster-done` 落在已经 `artifact-lost` 的帧上,绝不能把已删除的帧复活。
 * 3. **重新光栅不打断既有呈现** —— `ready`/`live` 收到新的 `raster-done` 只换
 *    textureKey,不退回中间态(换缩放档时旧位图比骨架态好)。
 *
 * ## 调用方契约(不遵守会变成重试风暴)
 *
 * `artifact-found` 是**变化**事件:产物由无到有才派发一次,**不是**每次观察到产物
 * 存在就派发。因为 `failed` 收到它会自动重试 —— 若调用方幂等派发,就会
 * `failed → registering → failed → …` 空转。机器内部只能挡住同阶段的重复派发
 * (`registering` 收到第二个 `artifact-found` 是 no-op),挡不住跨阶段的循环。
 *
 * 本文件不 import React、不 import Electron。
 */

export type FrameState =
  /** dist 里没有产物 → 占位卡。 */
  | { phase: "absent" }
  /** 产物已发现,排队等光栅槽。 */
  | { phase: "registering" }
  /** 已拿到槽,光栅进行中。 */
  | { phase: "rasterizing"; startedAt: number }
  /** 有位图,可贴。 */
  | { phase: "ready"; textureKey: string }
  /** 原生视图接管,位图留作底。 */
  | { phase: "live"; textureKey: string }
  /** 可见的失败态,可重试。 */
  | { phase: "failed"; reason: FrameFailureReason; detail?: string };

export type FrameEvent =
  | { type: "artifact-found" }
  | { type: "artifact-lost" }
  | { type: "slot-acquired"; startedAt: number }
  | { type: "raster-done"; textureKey: string }
  | { type: "raster-failed"; reason: FrameFailureReason; detail?: string }
  | { type: "focus-changed"; focused: boolean; zoom: number }
  | { type: "retry" };

export const INITIAL_FRAME_STATE: FrameState = { phase: "absent" };

/**
 * 转移表(未列出的组合一律 no-op):
 *
 * | 当前 | 事件 | 结果 |
 * | --- | --- | --- |
 * | 任意 | `artifact-lost` | `absent` —— 产物消失,任何状态都必须让位 |
 * | `absent` | `artifact-found` | `registering` |
 * | `failed` | `artifact-found` | `registering` —— 产物回来了就重试 |
 * | `registering` | `slot-acquired` | `rasterizing` |
 * | `registering` / `rasterizing` | `raster-failed` | `failed` |
 * | `rasterizing` | `raster-done` | `ready` |
 * | `ready` / `live` | `raster-done` | 同相,换 textureKey |
 * | `ready` | `focus-changed` 且聚焦且缩放够 | `live` |
 * | `ready` | `focus-changed` 否则 | `ready` |
 * | `live` | `focus-changed` 且仍聚焦且缩放够 | `live` |
 * | `live` | `focus-changed` 否则 | `ready` |
 * | `failed` | `retry` | `registering` |
 */
export function reduceFrame(state: FrameState, event: FrameEvent): FrameState {
  // 产物消失优先于一切:任何状态都要让位,否则会贴着一张已删除帧的位图。
  if (event.type === "artifact-lost") {
    return state.phase === "absent" ? state : INITIAL_FRAME_STATE;
  }

  switch (state.phase) {
    case "absent":
      return event.type === "artifact-found" ? { phase: "registering" } : state;

    case "registering":
      if (event.type === "slot-acquired") return { phase: "rasterizing", startedAt: event.startedAt };
      if (event.type === "raster-failed") return failureState(event.reason, event.detail);
      return state;

    case "rasterizing":
      if (event.type === "raster-done") return { phase: "ready", textureKey: event.textureKey };
      if (event.type === "raster-failed") return failureState(event.reason, event.detail);
      return state;

    case "ready":
      if (event.type === "raster-done") {
        return state.textureKey === event.textureKey ? state : { phase: "ready", textureKey: event.textureKey };
      }
      if (event.type === "focus-changed") {
        return event.focused && allowsLiveSurface(event.zoom)
          ? { phase: "live", textureKey: state.textureKey }
          : state;
      }
      return state;

    case "live":
      if (event.type === "raster-done") {
        return state.textureKey === event.textureKey ? state : { phase: "live", textureKey: event.textureKey };
      }
      if (event.type === "focus-changed") {
        return event.focused && allowsLiveSurface(event.zoom)
          ? state
          : { phase: "ready", textureKey: state.textureKey };
      }
      return state;

    case "failed":
      // 产物「由无到有」是真正的新信息(例如重新构建完成),自动重试 —— 否则用户得
      // 手动点重试才知道可以了。
      if (event.type === "retry" || event.type === "artifact-found") return { phase: "registering" };
      return state;
  }
}

function failureState(reason: FrameFailureReason, detail: string | undefined): FrameState {
  return detail === undefined ? { phase: "failed", reason } : { phase: "failed", reason, detail };
}

/** 这一帧是否在等光栅槽 —— 调用方据此决定要不要入队。 */
export function frameStateNeedsRaster(state: FrameState): boolean {
  return state.phase === "registering";
}

/** 这一帧当前的位图 key,没有则为 null。 */
export function frameStateTextureKey(state: FrameState): string | null {
  return state.phase === "ready" || state.phase === "live" ? state.textureKey : null;
}

/** 这一帧此刻是否应由原生视图承担 —— 调用方据此 attach / detach。 */
export function frameStateIsLive(state: FrameState): boolean {
  return state.phase === "live";
}

/** 这一帧此刻是否需要占据屏幕。 */
export function frameStateIsVisible(state: FrameState): boolean {
  return state.phase !== "absent";
}
