import { allowsLiveSurface } from "./budgets.ts";

/**
 * 一帧在画布上应该呈现成什么。
 *
 * 与 `browser-bounds.ts` 的 `resolveVisibility` 同一范式:**纯函数**,因为这里错了
 * 画布就白 —— 那种缺陷只有靠可断言的规则表才能挡住,靠散在组件里的 if 挡不住。
 *
 * 本文件不 import React、不 import Electron。
 */

export type FrameFailureReason = "raster-timeout" | "load-failed" | "dist-missing" | "build-failed";

export type FrameSurface =
  /** 视口外:不渲染,不占资源。 */
  | { kind: "hidden" }
  /** 还没到位:占位卡,不是空白。 */
  | { kind: "placeholder"; reason: "absent" | "queued" | "rasterizing" }
  /** 坏了:**可见的**错误态,不是空白。 */
  | { kind: "failed"; reason: FrameFailureReason; detail?: string }
  /** 有位图,可贴。 */
  | { kind: "texture"; textureKey: string }
  /** 原生视图接管。位图留作底,避免切换时闪白。 */
  | { kind: "live"; textureKey: string };

export interface FrameSurfaceInput {
  /** 相机视口裁剪的结果(见 `visibleFrameIds`)。 */
  visible: boolean;
  /** 当前缩放。是否够格给活体由 `allowsLiveSurface` 判定,调用方不预先算。 */
  zoom: number;
  /** 这一帧是不是焦点帧。 */
  focused: boolean;
  /** 位图是否就绪。 */
  textureKey: string | null;
  /** 光栅化是否在排队或进行中。 */
  rasterizing: boolean;
  /** `dist/` 里是否有这一帧的产物。 */
  artifactPresent: boolean;
  /** 上一次失败;成功后必须被清空,否则会一直盖着。 */
  failure: { reason: FrameFailureReason; detail?: string } | null;
}

/**
 * 规则表(顺序即优先级):
 *
 * 1. 视口外            → hidden。**先于失败**:不渲染的东西没有视觉状态,失败照常从
 *                        `design_status` 的 issues 报出去,那是另一条通道。
 * 2. 有失败            → failed。**失败必须看得见** —— 参考实现吃过这个亏:漏声明的
 *                        帧直接不上画布,用户盯着空白,agent 拿不到信号,于是开始盲猜。
 * 3. dist 里没产物      → placeholder absent。
 * 4. 聚焦 ∧ 缩放够 ∧ 有位图 → live。**要求有位图**:没有底图就上原生视图会在切换瞬间
 *                        闪白。
 * 5. 有位图            → texture。**先于 rasterizing**:重新光栅(换缩放档)时旧位图
 *                        比骨架态好,不该退回占位。
 * 6. 光栅中            → placeholder rasterizing。
 * 7. 其余              → placeholder queued。
 */
export function resolveFrameSurface(input: FrameSurfaceInput): FrameSurface {
  if (!input.visible) return { kind: "hidden" };
  if (input.failure) {
    return input.failure.detail === undefined
      ? { kind: "failed", reason: input.failure.reason }
      : { kind: "failed", reason: input.failure.reason, detail: input.failure.detail };
  }
  if (!input.artifactPresent) return { kind: "placeholder", reason: "absent" };
  const textureKey = input.textureKey;
  if (input.focused && allowsLiveSurface(input.zoom) && textureKey !== null) {
    return { kind: "live", textureKey };
  }
  if (textureKey !== null) return { kind: "texture", textureKey };
  if (input.rasterizing) return { kind: "placeholder", reason: "rasterizing" };
  return { kind: "placeholder", reason: "queued" };
}

/** 这一帧是否需要占用屏幕(浮层与命中测试据此跳过视口外的帧)。 */
export function frameSurfaceIsVisible(surface: FrameSurface): boolean {
  return surface.kind !== "hidden";
}

/** 这一帧此刻是否由原生视图承担。 */
export function frameSurfaceIsLive(surface: FrameSurface): boolean {
  return surface.kind === "live";
}

/**
 * 这一帧是否有可贴的内容。
 *
 * `texture` 与 `live` 都算 —— 活体是位图之上的一层,位图仍在底下。
 */
export function frameSurfaceHasBacking(surface: FrameSurface): boolean {
  return surface.kind === "texture" || surface.kind === "live";
}
