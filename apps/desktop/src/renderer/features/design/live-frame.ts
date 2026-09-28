import { allowsLiveSurface } from "./budgets.ts";
import { worldRectToScreen, type Camera, type Rect } from "./camera.ts";
import type { DesignFrameDto } from "@wordless/protocol";

/**
 * 当前该不该有活体帧,以及它在窗口里的矩形。
 *
 * 纯函数,与 `resolveFrameSurface` 的 `live` 分支**同一组条件** —— 两份判定同源,
 * 不会出现"状态机说活体、宿主却没收到"这种不一致。
 *
 * 矩形由 `worldRectToScreen` 派生,与位图贴图**共用同一个变换**。这是整个方案里最关键的一条
 * 不变量:参考实现是位图与活体各自 `getBoundingClientRect()`,那正是两者错位的来源;
 * 这里它们在结构上不可能错位。
 */

export interface LiveFrameTarget {
  frameId: string;
  /** **窗口坐标**下的矩形 —— 原生视图要的就是这个,不是画布坐标。 */
  bounds: Rect;
}

export interface LiveFrameTargetInput {
  frames: readonly DesignFrameDto[];
  camera: Camera;
  focusedFrameId: string | null;
  /** 画布容器在窗口里的位置。屏幕矩形要加上它才是窗口坐标。 */
  containerRect: { left: number; top: number } | null;
  /** 有已声明的浮层压在上面(设置对话框、菜单…)。 */
  occluded: boolean;
  /** 位图是否已就绪。**没有底图就不上活体** —— 否则切换瞬间会闪白。 */
  hasTexture: boolean;
}

/**
 * 条件全部满足才给出目标,否则 `null`(交还给位图)。
 *
 * | 条件 | 为什么 |
 * | --- | --- |
 * | 有焦点帧且在清单里 | 活体是"编辑中的那一帧" |
 * | `allowsLiveSurface(zoom)` | 原生视图不能被 CSS 缩放,非 1:1 下会得到重排后的错误版面 |
 * | 位图已就绪 | 没有底图时上活体会闪白 |
 * | 未被遮挡 | 原生视图永远盖在 DOM 之上,不摘掉的话浮层点不到 |
 * | 容器有几何 | 没有几何就没有可用的窗口坐标 |
 *
 * 与 `resolveFrameSurface` 一样,**视口内**不是这里的判断:`focusedFrameId` 非空即意味着
 * 那一帧是用户正在看的。
 */
export function liveFrameTarget(input: LiveFrameTargetInput): LiveFrameTarget | null {
  const frameId = input.focusedFrameId;
  if (frameId === null) return null;
  if (input.occluded) return null;
  if (!input.hasTexture) return null;
  if (!allowsLiveSurface(input.camera.zoom)) return null;
  if (input.containerRect === null) return null;

  const frame = input.frames.find((candidate) => candidate.id === frameId);
  if (frame === undefined) return null;

  const screen = worldRectToScreen(input.camera, {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  });
  return {
    frameId,
    bounds: {
      x: input.containerRect.left + screen.x,
      y: input.containerRect.top + screen.y,
      width: screen.width,
      height: screen.height,
    },
  };
}
