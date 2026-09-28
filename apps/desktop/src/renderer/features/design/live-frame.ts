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

/** 画布容器在窗口里的位置与尺寸。 */
export interface ContainerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 一帧**整帧**落在容器里吗 —— 屏幕上(而不是画布坐标下)。
 *
 * ## 为什么这是一条正确性条件,而不是"看起来更好的条件"
 *
 * 原生视图**不会被任何 CSS 裁剪**。它按窗口坐标定位,于是当一帧比它所在的画布面板还大时,
 * 多出来的部分会**压在对话区和左侧栏上面** —— 实测就是这样:把画布放大,画面就溢出右侧栏。
 * 面板那边的 DOM 是 `overflow-hidden` 的,所以溢出只可能来自这一层。
 *
 * 而且没有别的修法:把原生视图裁小会让页面**按小视口重排**(那是错的版面,而 §6.4 整节都在
 * 讲原生视图不能被缩放/重排),所以"裁一半"不是选项。**唯一正确的做法是它放不下时就不给。**
 * 那时帧仍以位图呈现 —— 位图在 DOM 里,裁剪是正确的。
 *
 * 位置也要在容器内:一个偏出去一半的帧,它的原生视图同样会盖到面板外面。
 */
export function frameFitsInViewport(input: {
  /** 帧在**画布坐标**下的矩形。位置和尺寸都要 —— 屏幕位置是两者与相机一起算出来的。 */
  frame: Rect;
  camera: Camera;
  container: { width: number; height: number };
  /** 亚像素误差:缩放是浮点的,差 0.4px 不该让活体闪掉。 */
  epsilon?: number;
}): boolean {
  const epsilon = input.epsilon ?? 0.5;
  // 与活体矩形**同一个函数**:容不容易错位,取决于这里有没有另算一遍几何。
  const screen = worldRectToScreen(input.camera, input.frame);
  return (
    screen.x >= -epsilon &&
    screen.y >= -epsilon &&
    screen.x + screen.width <= input.container.width + epsilon &&
    screen.y + screen.height <= input.container.height + epsilon
  );
}

export interface LiveFrameTargetInput {
  frames: readonly DesignFrameDto[];
  camera: Camera;
  /**
   * **用户"进入"的那一帧** —— 不是"被选中的那一帧"。
   *
   * 这个区分是原生视图逼出来的,而参考实现不需要它:它的活体是 DOM 里的 iframe,四角手柄
   * 可以画在 iframe 之上。原生视图永远盖在所有 DOM 之上,所以进了活体就点不到手柄 ——
   * 于是"选中"必须保持可布局的那一态,"进入"才是可交互的那一态。
   */
  enteredFrameId: string | null;
  /** 画布容器在窗口里的位置与尺寸。 */
  containerRect: ContainerRect | null;
  /** 有已声明的浮层压在上面(设置对话框、菜单…)。 */
  occluded: boolean;
  /** 位图是否已就绪。**没有底图就不上活体** —— 否则切换瞬间会闪白。 */
  hasTexture: boolean;
  /**
   * 正在拖拽或缩放。**这时必须交还给位图。**
   *
   * 拖拽期间移动的是 DOM 节点,而清单(活体矩形唯一的来源)要等拖拽结束才提交 —— 于是原生
   * 视图停在原地、位图跟着手走:**同一帧在画布上出现两次**,一个跟手一个不动。实测就是这样
   * (参考实现没这个问题:它的活体在节点里面,跟着节点一起动)。
   */
  dragging: boolean;
}

/**
 * 条件全部满足才给出目标,否则 `null`(交还给位图)。
 *
 * | 条件 | 为什么 |
 * | --- | --- |
 * | 进入了一帧且在清单里 | 活体是"你进去看的那一帧" |
 * | `allowsLiveSurface(zoom)` | 原生视图不能被 CSS 缩放,非 1:1 下会得到重排后的错误版面 |
 * | 位图已就绪 | 没有底图时上活体会闪白 |
 * | 未被遮挡 | 原生视图永远盖在 DOM 之上,不摘掉的话浮层点不到 |
 * | 容器有几何 | 没有几何就没有可用的窗口坐标 |
 * | **不在拖拽或缩放中** | 拖拽期间清单还没提交,原生视图不跟手 —— 同一帧会出现两次 |
 * | **整帧放得下** | 原生视图不被 CSS 裁剪,放不下就是溢出面板(`frameFitsInViewport`) |
 *
 * 与 `resolveFrameSurface` 一样,**视口内**不是这里的判断:`enteredFrameId` 非空即意味着
 * 那一帧是用户进去看的。
 */
export function liveFrameTarget(input: LiveFrameTargetInput): LiveFrameTarget | null {
  const frameId = input.enteredFrameId;
  if (frameId === null) return null;
  // 拖拽/缩放中一律交还给位图:那是两条真实可见的错(残影、溢出),不是观感问题。
  if (input.dragging) return null;
  if (input.occluded) return null;
  if (!input.hasTexture) return null;
  if (!allowsLiveSurface(input.camera.zoom)) return null;
  if (input.containerRect === null) return null;

  const frame = input.frames.find((candidate) => candidate.id === frameId);
  if (frame === undefined) return null;

  // 放不下就不给 —— 原生视图不被裁剪,给出去就是溢出画布面板。
  const frameRect: Rect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  if (!frameFitsInViewport({ frame: frameRect, camera: input.camera, container: input.containerRect })) return null;

  const screen = worldRectToScreen(input.camera, frameRect);
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
