import {
  unionRects,
  visibleFrameIds,
  worldRectToScreen,
  type Camera,
  type Rect,
  type Size,
} from "./camera.ts";
import { resolveFrameSurface, type FrameFailureReason, type FrameSurface } from "./frame-surface.ts";
import type { DesignFrameDto } from "@wordless/protocol";

/**
 * 帧 → 屏幕投影。
 *
 * 这是画布的核心投影:把清单里的帧、相机、以及"内容准备好了没有"合成一份渲染列表。
 * 纯函数,所以画布几何的正确性可以在没有浏览器的情况下断言 —— 组件层只负责把它画出来。
 *
 * **关键不变量**:`screenRect` 是位图贴图与将来原生视图**共用**的矩形。两者都从
 * `worldRectToScreen` 派生,所以不可能错位(参考实现是各自 `getBoundingClientRect()`,
 * 那正是错位的来源)。
 */

export interface DesignFrameView {
  id: string;
  title: string;
  /** 画布坐标下的矩形。 */
  worldRect: Rect;
  /** 屏幕坐标下的矩形,由相机派生。 */
  screenRect: Rect;
  surface: FrameSurface;
  /** 是否被选中 —— 浮层据此画手柄。 */
  selected: boolean;
}

export interface DesignFrameViewsInput {
  frames: readonly DesignFrameDto[];
  camera: Camera;
  viewport: Size;
  /** 焦点帧 id(可能不在当前视口内)。 */
  focusedFrameId: string | null;
  selectedFrameIds: ReadonlySet<string>;
  /** frameId → 位图 key。P2 阶段还没有光栅化,所以是空 Map。 */
  textures: ReadonlyMap<string, string>;
  /** frameId → 失败原因。 */
  failures: ReadonlyMap<string, FrameFailureReason>;
  /** frameId → dist 里是否有产物。 */
  artifactPresent: (frameId: string) => boolean;
  /** 视口外预渲染余量(屏幕像素)。 */
  marginPx: number;
}

/**
 * 投影出要渲染的帧。
 *
 * 顺序:先按视口裁剪(视口外的帧不占资源),再逐帧判定呈现方式。裁剪发生在
 * `resolveFrameSurface` **之前** —— 那是"视口外一律 hidden"这条规则的位置,也是它
 * 存在的理由:一张视口外的帧不需要位图、不需要状态机、不需要浮层。
 */
export function designFrameViews(input: DesignFrameViewsInput): DesignFrameView[] {
  const rects = input.frames.map((frame) => ({
    id: frame.id,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  }));
  const visible = new Set(visibleFrameIds(input.camera, rects, input.viewport, input.marginPx));
  if (visible.size === 0) return [];

  const views: DesignFrameView[] = [];
  for (const frame of input.frames) {
    if (!visible.has(frame.id)) continue;
    const worldRect: Rect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    const textureKey = input.textures.get(frame.id) ?? null;
    views.push({
      id: frame.id,
      title: frame.title,
      worldRect,
      screenRect: worldRectToScreen(input.camera, worldRect),
      surface: resolveFrameSurface({
        visible: true,
        zoom: input.camera.zoom,
        focused: input.focusedFrameId === frame.id,
        textureKey,
        rasterizing: false,
        artifactPresent: input.artifactPresent(frame.id),
        failure: failureOf(input.failures, frame.id),
      }),
      selected: input.selectedFrameIds.has(frame.id),
    });
  }
  return views;
}

function failureOf(
  failures: ReadonlyMap<string, FrameFailureReason>,
  frameId: string,
): { reason: FrameFailureReason } | null {
  const reason = failures.get(frameId);
  return reason === undefined ? null : { reason };
}

/** 全部帧的包围盒,用于"适配视口"。空设计返回 null。 */
export function designContentRect(frames: readonly DesignFrameDto[]): Rect | null {
  return unionRects(frames.map((frame) => ({ x: frame.x, y: frame.y, width: frame.width, height: frame.height })));
}

/**
 * 浮层元素的反向缩放系数。
 *
 * 手柄、标题、参考线按它反向缩放,于是在任何缩放下都是屏幕上的固定尺寸 ——
 * 这是"像 Figma"最直观的一条。
 */
export function designChromeScale(camera: Camera): number {
  return Math.min(1 / camera.zoom, 8);
}
