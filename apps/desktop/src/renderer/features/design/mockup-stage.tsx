import { useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { fitCamera, zoomAround, type Camera, type Size } from "./camera.ts";
import { suppressNativeDragImage } from "./drag-image.ts";
import { MOCKUP_RAIL_FRAME_MIME } from "./mockup-attach.ts";
import { layoutMockup } from "./mockup-layout.ts";
import { renderMockup } from "./mockup-render.ts";
import { centerMockupViewport, stackMockupPages, stepZoom } from "./mockup-view.ts";
import type { MockupLayout, MockupOptions, MockupShot } from "./mockup-types.ts";

/** 页与页之间的竖直间距(layout unit)。 */
const PAGE_GAP = 24;
/** 适应时的四周留白。 */
const FIT = { maxZoom: 1, paddingRatio: 0.06 } as const;

/**
 * 预览台:把每页的合成结果画到 `<canvas>` 上,竖着堆叠,一块**可平移可缩放**的画布。
 *
 * 四件事值得先说清:
 *
 * 1. **用的是导出那一个渲染器**(`renderMockup`),预览只是把它画在 1 倍上 —— 所以"预览看起来
 *    什么样,导出就是什么样"在代码上是**同一个函数调用**,而不是两处长得像的绘制。
 * 2. **手势与几何复用编辑态画布那一套纯函数**(`camera.ts` 的 `zoomAround`/`fitCamera`、
 *    `mockup-view.ts` 的 `stackMockupPages`/`centerMockupViewport`)。两处各写一遍手势逻辑必然
 *    漂开,而漂开的表现是"缩放的锚点偶尔不对"这类说不清的东西。
 * 3. **一页一张画布**,不是一帧一张:整页一起画才只算一次版面。逐帧各画一整页的后果是同一批
 *    画框在预览里**重复出现**,而且看起来像是多画了几帧。
 * 4. **打开就适应**。第一次拿到预览台的尺寸时把内容铺满(不放大),并且在用户**自己动过手
 *    之前**一直跟着尺寸走 —— 弹窗刚打开时尺寸往往还要落定一次,只适应一次会停在错的比例上。
 *
 * 一处有意的偏差:缩放档固定画在 1 倍上(参考实现按 `devicePixelRatio` 提倍率)。放大到 2 倍
 * 以上时预览会比导出软一点,而代价是每跨一个档就要把整页重画一遍 —— 那是用户拖着滚轮时最
 * 不该做的事。
 */
export function MockupStage({
  brandLogo,
  onDropRailFrame,
  onSelect,
  onSwap,
  options,
  pages,
  selectedFrameId,
  slots,
}: {
  /** 水印左边的品牌标;还没加载好时是 `null`(只画字,版面位置照旧占着)。 */
  brandLogo: CanvasImageSource | null;
  /** 从左侧画框列表拖进来一帧。 */
  onDropRailFrame?: (frameId: string) => void;
  onSelect: (frameId: string | null) => void;
  /** 把 `from` 拖到 `to` 上 = **两者互换**(Figma 式),见 `mockup-attach.ts`。 */
  onSwap: (from: number, to: number) => void;
  options: MockupOptions;
  /** 每页的 shots —— 分页结果由调用方给(预览、导出、页码文案必须看到同一份)。 */
  pages: readonly (readonly MockupShot[])[];
  selectedFrameId: string | null;
  /** 每页留几格:末页不满也占满宽度,多页叠起来才等宽。 */
  slots: number;
}) {
  const { t } = usePreferences();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ height: 0, width: 0 });
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [autoFit, setAutoFit] = useState(true);
  const [panning, setPanning] = useState(false);
  /**
   * 正有一帧从左侧列表拖到预览台上。
   *
   * 这是**唯一**的落点反馈:原生拖影被去掉了(见 `drag-image.ts`),所以"会落在哪"这件事
   * 必须由这里说 —— 而且是画在弹窗内的,飘不出去。
   */
  const [dropHint, setDropHint] = useState(false);
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const dragFrom = useRef<number | null>(null);
  /** 已经为哪一块世界适应过。空串 = 还没适应过。 */
  const fittedWorldRef = useRef("");

  /**
   * 每页的版面几何。**绘制与命中区共用这一份** —— 于是"图上画的那一帧"与"能点中的那一块"
   * 结构上不可能错位。
   */
  const layouts = useMemo(
    () => pages.map((pageShots) => layoutMockup(pageShots, options, slots)),
    [options, pages, slots],
  );
  const stack = useMemo(
    () => stackMockupPages(layouts.map((layout) => ({ height: layout.height, width: layout.width })), PAGE_GAP),
    [layouts],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const observer = new ResizeObserver(() =>
      setSize({ height: stage.clientHeight, width: stage.clientWidth }),
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  /**
   * 镜头。
   *
   * - 用户还没动过手:**尺寸或版面一变就重新适应**。弹窗刚打开时尺寸往往要落定一次,只适应
   *   一次会停在错的比例上 —— 而"打开就想看到全貌"是这个弹窗的第一条要求。
   * - 用户动过手(平移/缩放/实际大小):只有版面真的换了尺寸才重新**居中**,并保留他选的缩放。
   *   平移量不保留:内容一换尺寸,原来那个平移量指向的已经不是同一块地方了。
   */
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0 || stack.world.width <= 0) return;
    const key = `${stack.world.width}x${stack.world.height}`;
    const worldChanged = fittedWorldRef.current !== key;
    if (!autoFit && !worldChanged) return;
    fittedWorldRef.current = key;
    const content = { height: stack.world.height, width: stack.world.width, x: 0, y: 0 };
    setCamera((current) =>
      autoFit ? fitCamera(content, size, FIT) : centerMockupViewport(stack.world, size, current.zoom),
    );
  }, [autoFit, size, stack.world.height, stack.world.width]);

  /**
   * 滚轮缩放,锚在光标上。
   *
   * 监听器是**原生注册**的:React 把 `onWheel` 挂成被动监听,里面 `preventDefault()` 不生效 ——
   * 于是缩放会连带滚动外层,两个动作互相打架。
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const bounds = stage.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      setAutoFit(false);
      setCamera((current) => zoomAround(current, current.zoom * Math.exp(-event.deltaY * 0.0015), anchor));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const endPan = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const content = { height: stack.world.height, width: stack.world.width, x: 0, y: 0 };
  /** 缩放按钮绕**视口中心**缩放:按钮不在光标下,没有比中心更合理的锚点。 */
  const zoomBy = (direction: 1 | -1): void => {
    const anchor = { x: size.width / 2, y: size.height / 2 };
    setAutoFit(false);
    setCamera((current) => zoomAround(current, stepZoom(current.zoom, direction), anchor));
  };
  const fitNow = (): void => {
    // 点「适应」= 重新交给自动模式:之后视口再变也继续跟着,直到用户又自己动手。
    setAutoFit(true);
    setCamera(() => fitCamera(content, size, FIT));
  };

  return (
    <div
      className={`relative min-h-0 min-w-0 flex-1 select-none overflow-hidden bg-muted/30 ${
        panning ? "cursor-grabbing" : "cursor-grab"
      }`}
      data-mockup-stage
      onDragLeave={(event) => {
        // 在子元素之间移动也会触发 `dragleave`:真出去了才算出去了。
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropHint(false);
      }}
      onDragOver={(event) => {
        // 只有从左侧列表拖过来的画框才接;内部换位那条拖拽由画框自己处理。
        if (!event.dataTransfer.types.includes(MOCKUP_RAIL_FRAME_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropHint(true);
      }}
      onDrop={(event) => {
        setDropHint(false);
        const frameId = event.dataTransfer.getData(MOCKUP_RAIL_FRAME_MIME);
        if (frameId === "") return;
        event.preventDefault();
        onDropRailFrame?.(frameId);
      }}
      onPointerCancel={endPan}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.button !== 1) return;
        /**
         * 左键落在**画框**上是"选它 / 拖它换位",不拖背景 —— 两件事共用同一个左键,靠它分开。
         * 中键在哪儿都是平移,所以拖不动的地方永远有一个出口。
         *
         * 判据只有画框那一块(而不是整个页面):页面里除了截图还有边距、水印和画框之间的空隙,
         * 那些地方看起来就是背景,在那儿拖不动会像"拖拽坏了"。
         */
        if (event.button === 0 && (event.target as HTMLElement).closest("[data-mockup-shot]") !== null) return;
        panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        /**
         * 捕获是**尽力而为**:没有活动指针时(合成事件、指针已经抬起)它会抛 `NotFoundError`,
         * 而那不是错误状态 —— 拿不到捕获的后果只是"光标离开预览台就不再跟着拖",拖拽本身照旧。
         */
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // 拿不到就拿不到,拖动继续。
        }
        setAutoFit(false);
        setPanning(true);
        onSelect(null);
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        if (pan === null || pan.pointerId !== event.pointerId) return;
        const dx = event.clientX - pan.x;
        const dy = event.clientY - pan.y;
        pan.x = event.clientX;
        pan.y = event.clientY;
        setCamera((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      }}
      onPointerUp={endPan}
      ref={stageRef}
    >
      {/**
       * 空态**留在预览台里面**。
       *
       * 不是为了少一个分支:预览台是"从左侧把画框拖进来"的落点,如果没画框时它整块不存在,
       * 那第一帧就**只能点不能拖** —— 而用户会先去试拖。所以落点从一开始就在,提示语浮在
       * 它上面(而且不吃指针事件,拖过来的东西照样能落下去)。
       */}
      {pages.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center">
          <p className="text-[12px] text-foreground">{t("mockupEmptyTitle")}</p>
          <p className="max-w-[320px] text-[11px] leading-5 text-muted-foreground">{t("mockupEmptyDesc")}</p>
        </div>
      ) : null}

      {/* 世界层:内容按 `stackMockupPages` 摆,缩放与平移是**一个** transform。 */}
      <div
        className="absolute left-0 top-0"
        data-mockup-world
        style={{
          height: stack.world.height,
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          transformOrigin: "0 0",
          width: stack.world.width,
        }}
      >
        {pages.map((pageShots, pageIndex) => {
          const layout = layouts[pageIndex];
          const box = stack.boxes[pageIndex];
          if (layout === undefined || box === undefined) return null;
          const base = pages.slice(0, pageIndex).reduce((sum, page) => sum + page.length, 0);
          return (
            <div
              className="absolute"
              data-mockup-page
              key={pageShots[0]?.frameId ?? pageIndex}
              style={{ height: box.height, left: box.left, top: box.top, width: box.width }}
            >
              {pages.length > 1 ? (
                <span className="absolute left-0 top-0 -translate-y-full pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {pageIndex + 1} / {pages.length}
                </span>
              ) : null}
              <MockupPageCanvas brandLogo={brandLogo} layout={layout} options={options} shots={pageShots} />
              {pageShots.map((shot, indexInPage) => {
                const rect = layout.rects[indexInPage];
                if (rect === undefined) return null;
                const globalIndex = base + indexInPage;
                return (
                  <button
                    aria-label={shot.title}
                    className={`absolute cursor-grab ${
                      selectedFrameId === shot.frameId
                        ? "outline outline-2 outline-[#4f7df3]"
                        : "outline-none hover:outline hover:outline-1 hover:outline-[#4f7df3]/50"
                    }`}
                    data-mockup-shot
                    draggable
                    key={shot.frameId}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(shot.frameId);
                    }}
                    onDragEnd={() => {
                      dragFrom.current = null;
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDragStart={(event) => {
                      dragFrom.current = globalIndex;
                      suppressNativeDragImage(event.dataTransfer);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      // 换位这条拖拽自己吃掉事件,别让它掉进"从左侧列表拖进来"那条分支。
                      event.stopPropagation();
                      const from = dragFrom.current;
                      dragFrom.current = null;
                      if (from !== null) onSwap(from, globalIndex);
                    }}
                    style={{ height: rect.height, left: rect.x, top: rect.y, width: rect.width }}
                    title={shot.title}
                    type="button"
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/**
       * 落点提示:拖着一帧进来时,预览台整块变成虚线框(松手就加入)。
       *
       * `pointer-events-none`:它盖着预览台,但它自己不能成为落点 —— 那样 `dragleave` 会在
       * 提示和预览台之间来回触发,框一闪一闪。
       */}
      {dropHint ? (
        <div
          className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-[#4f7df3]/70 bg-[#4f7df3]/5"
          data-mockup-drop-hint
        >
          <span className="rounded-md bg-card/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
            {t("mockupDropHint")}
          </span>
        </div>
      ) : null}

      {/**
       * 缩放条:浮在预览台**左下角**,不占一行高度。
       *
       * 它是内容之外的一层界面(所以不在世界层里,不随缩放放大),`data-mockup-overlay` 同时
       * 声明了这件事:指针事件不该漏给下面的画布。
       */}
      <div
        className={`absolute bottom-3 left-3 items-center gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-md backdrop-blur-md ${
          pages.length === 0 ? "hidden" : "flex"
        }`}
        data-mockup-overlay
        onPointerDown={(event) => event.stopPropagation()}
      >
        <StageButton label={t("mockupViewZoomOut")} onClick={() => zoomBy(-1)}>
          −
        </StageButton>
        <span className="min-w-11 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {Math.round(camera.zoom * 100)}%
        </span>
        <StageButton label={t("mockupViewZoomIn")} onClick={() => zoomBy(1)}>
          +
        </StageButton>
        <StageButton label={t("mockupViewFit")} onClick={fitNow}>
          {t("mockupViewFit")}
        </StageButton>
        <StageButton
          label={t("mockupViewActual")}
          onClick={() => {
            setAutoFit(false);
            setCamera(() => centerMockupViewport(stack.world, size, 1));
          }}
        >
          {t("mockupViewActual")}
        </StageButton>
      </div>
    </div>
  );
}

/**
 * 一页的位图。整页一起画:一页里的几帧共享一次版面计算,逐帧分开画会各自再算一遍。
 *
 * 画布元素给**显式**的 CSS 尺寸(而不是靠 `width: 100%`):命中区按同一份 `layout.rects`
 * 定位,两者要对上同一个像素坐标系。
 */
function MockupPageCanvas({
  brandLogo,
  layout,
  options,
  shots,
}: {
  brandLogo: CanvasImageSource | null;
  layout: MockupLayout;
  options: MockupOptions;
  shots: readonly MockupShot[];
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    // 预览画在 1 倍上,由世界层的 transform 缩放 —— 版面尺寸与导出完全一致,差的只是倍率。
    canvas.width = Math.max(1, Math.round(layout.width));
    canvas.height = Math.max(1, Math.round(layout.height));
    const g = canvas.getContext("2d");
    if (g === null) return;
    renderMockup(g, shots, options, layout, 1, brandLogo);
  }, [brandLogo, layout, options, shots]);

  return <canvas className="block" ref={ref} style={{ height: layout.height, width: layout.width }} />;
}

function StageButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="rounded-md px-2 py-1 text-[11px] text-muted-foreground tabular-nums hover:bg-muted"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
