import {
  unionRects,
  visibleFrameIds,
  worldRectToScreen,
  type Camera,
  type Rect,
  type Size,
} from "./camera.ts";
import { resolveFrameSurface, type FrameFailureReason, type FrameSurface } from "./frame-surface.ts";
import type { DesignFrameDto, DesignManifestDto } from "@wordless/protocol";
import { DESIGN_CANVAS_BUDGETS } from "./budgets.ts";

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
 * 把刷新回来的清单接上,但**不接管布局**。
 *
 * 两个来源各自拥有什么,在 §6.1 里定过:内容(有哪些帧、标题、尺寸)归帧文件,
 * 布局(画布上的 `x`/`y`)归清单、而用户是在画布上拖的。
 *
 * 所以刷新只做两件事:新出现的帧按磁盘落点加进来,清单里已经删掉的帧消失。**已经在画布上
 * 的帧保留它当前的 `x`/`y`** —— 直接用磁盘值覆盖会在用户正拖着帧的时候把它抢回去,而刷新
 * 是每秒都在跑的。那不是一个理论上的竞态:拖一次帧要几秒,而心跳的间隔是 1 秒。
 *
 * 抽成纯函数是因为这里错了**看不出来**:帧会"自己跳回原位",而它发生在一个每秒运行的
 * 定时器里,没人能稳定复现。
 */
export function mergeRefreshedManifest(current: DesignManifestDto, next: DesignManifestDto): DesignManifestDto {
  const placed = new Map(current.frames.map((frame) => [frame.id, frame]));
  return {
    ...next,
    frames: next.frames.map((frame) => {
      const existing = placed.get(frame.id);
      return existing === undefined ? frame : { ...frame, x: existing.x, y: existing.y };
    }),
  };
}

/**
 * 双击"进入"一帧时的相机目标:居中 + **1:1**。
 *
 * 为什么必须是 1:1:原生视图**不能被 CSS 缩放** —— `setZoomFactor` 是页面缩放、会重排布局,
 * 而设计稿在固定声明尺寸下不能重排(390 宽的帧当成 780 宽渲染,版面就错了)。所以"能真的点
 * 进去、页面按设计的样子跑"这件事,只在 1:1 下成立(见 `budgets.ts` 的 `liveZoomTolerance`
 * 与 `live-frame.ts`)。进入 = 把相机推到那个唯一的正确位置。
 *
 * 抽成纯函数是因为动画时长不能拿来断言(§14.1 ③):能断言的只有"目标是什么"。
 */
export function frameEntryViewport(frame: DesignFrameDto): { x: number; y: number; zoom: number } {
  return {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
    // 与 `allowsLiveSurface` 用同一个数字:进去看到的版面,就是交互时看到的版面。
    zoom: DESIGN_CANVAS_BUDGETS.liveZoom,
  };
}

/**
 * 浮层元素的反向缩放系数。
 *
 * 手柄、标题、参考线按它反向缩放,于是在任何缩放下都是屏幕上的固定尺寸 ——
 * 这是"像 Figma"最直观的一条。
 */
/**
 * 这一刻该不该把内容装进视口。
 *
 * 三条判断,每一条都对应一次真实的误判:
 *
 * 1. **一份设计只自动适应一次**(按路径记)。用户拖过视口之后再刷新(agent 一直在改磁盘)
 *    不该把画面抢回去;而**换了一份设计**是新的一次上下文 —— 在旧设计里调过的视角对新设计
 *    没有意义,不重新适应的话打开一份设计可能看到的是一片空白(内容在视口外)。
 * 2. **节点量完尺寸之前不适配**。`fitView` 是按节点的测量尺寸算的,而节点刚建出来时尺寸是
 *    0:这时适配算出来的是"空内容",视觉上就是"什么都没发生" —— 打开会话没有自动适应,这是
 *    最像的原因。
 * 3. 一帧都没有就什么都不做(空画布的"适应"是没有意义的,而且会把相机推到 0 附近)。
 */
export function shouldFitOnOpen(input: {
  /** 这次要适配的是哪份设计(设计包路径)。 */
  designPath: string;
  /** 已经为哪份设计适配过;`null` = 还没适配过。 */
  fitted: string | null;
  frameCount: number;
  /** React Flow 量完节点尺寸了吗。 */
  nodesInitialized: boolean;
}): boolean {
  if (input.frameCount === 0) return false;
  if (!input.nodesInitialized) return false;
  return input.fitted !== input.designPath;
}

/**
 * 右键菜单摆在哪。
 *
 * ## 为什么必须"翻边",而不是"挤窄"
 *
 * 绝对定位的元素如果不给宽度,它的宽度是**收缩到适合**(shrink-to-fit):不超过
 * `容器宽 - left`。于是菜单开在靠近右边缘时会比"它本来该有的宽度"更窄,而里面的文字就**换行**
 * —— 一行的「交给 agent 改这一帧」变成两行。用户报的就是这个。
 *
 * 靠"挤窄"适应边缘这件事本身就不该做:菜单是**界面**,换行只让它变难读。正确做法是保持它
 * 本来的宽度,放不下就**翻到指针的另一侧**(贴着左边/上边),实在连翻都放不下才贴边。
 *
 * 两处判断都留了 `margin`:菜单贴着边界会看起来像被裁掉了。
 */
export function placeFrameMenu(input: {
  /** 指针在容器内的坐标。 */
  anchor: { x: number; y: number };
  /** 菜单量出来的尺寸。 */
  menu: { width: number; height: number };
  /** 容器尺寸。菜单不能跑到容器外面去(容器不裁剪,跑出去就压到对话区上了)。 */
  bounds: { width: number; height: number };
  /** 与容器边缘的间隙。 */
  margin?: number;
}): { left: number; top: number } {
  const margin = input.margin ?? 6;
  const maxLeft = input.bounds.width - input.menu.width - margin;
  const maxTop = input.bounds.height - input.menu.height - margin;

  // 默认开在指针的右下;右下放不下就翻到左上;翻过去也放不下(菜单比容器还大)就贴边。
  const left =
    input.anchor.x + input.menu.width + margin <= input.bounds.width
      ? input.anchor.x
      : Math.max(margin, Math.min(input.anchor.x - input.menu.width, maxLeft));
  const top =
    input.anchor.y + input.menu.height + margin <= input.bounds.height
      ? input.anchor.y
      : Math.max(margin, Math.min(input.anchor.y - input.menu.height, maxTop));

  return { left, top };
}

export function designChromeScale(camera: Camera): number {
  return Math.min(1 / camera.zoom, 8);
}
