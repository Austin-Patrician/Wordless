import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Node,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DesignManifestDto, DesignOpenedDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { arrangeFrames, type ArrangeMode } from "./arrange.ts";
import {
  DesignArrangeToolbar,
  DesignCanvasActions,
  DesignControlBar,
  type DesignTool,
} from "./DesignControlBar.tsx";
import { DesignEditorProvider, type DesignEditor } from "./design-editor-context.tsx";
import { DesignFrameContextMenu } from "./DesignFrameContextMenu.tsx";
import { DesignFrameDrawLayer } from "./DesignFrameDrawLayer.tsx";
import { designChromeScale, frameEntryViewport } from "./design-view.ts";
import { DesignStyleDialog } from "./DesignStyleDialog.tsx";
import { DesignViewportProvider } from "./design-viewport-context.tsx";
import { DesignFrameNode, type DesignFrameNodeData } from "./DesignFrameNode.tsx";
import { useDesignTextures } from "./use-design-textures.ts";
import { DesignLiveFrameLayer } from "./DesignLiveFrameLayer.tsx";
import type { FrameActivity } from "./frame-activity.ts";

/**
 * 设计画布。
 *
 * React Flow 负责视口、选择、框选、多选拖拽、缩放 —— 不重复实现画布内核。本组件只做
 * 它不做的事:
 *
 * 1. **单向同步清单 → 节点**,且只在清单变化时同步一次(拖拽/选择/平移都不触发)
 * 2. 把缩放经 context 下发(平移不下发,见 `design-viewport-context.tsx`)
 * 3. 把拖拽结束转成一次几何提交(拖拽途中不回写)
 *
 * 三处刻意的选择:
 *
 * - **非受控**(`defaultNodes`):拖拽与选择是 React Flow 的瞬时状态,受控的话每个
 *   pointermove 都要经 React 回写,那是参考实现记过的反馈环。
 * - **不给 `onNodesChange`**:非受控模式下它由 React Flow 内部消化;给一个空实现会让
 *   节点拖不动(那正是"受控但没应用变更"的典型症状)。
 * - **不往节点里塞 `selected`**:选择由 React Flow 管,它通过 `NodeProps` 把 `selected`
 *   交给节点组件;写进节点数据反而与库的内部状态成为两份真相。
 *
 * 这个文件只负责**接线**:几何来自相机、内容来自位图与活体、编辑动作经两个 context 下发,
 * 而工具条、绘制层、菜单、对话框各自住在自己的文件里。所有回调都来自上层 —— 画布不碰磁盘、
 * 不开对话、不选目录。
 */

const nodeTypes = { designFrame: DesignFrameNode };
const SNAP_GRID: [number, number] = [8, 8];

export interface DesignCanvasProps {
  manifest: DesignManifestDto;
  /** 设计包路径,光栅化请求要用。 */
  designPath: string;
  /** 桥。位图由主进程的离屏视图产出。 */
  client: DesktopBridge;
  /**
   * 用户**进入**看的那一帧(双击进入),不是被选中的那一帧。
   *
   * 两者必须分开,而且是原生视图逼出来的:原生视图永远盖在所有 DOM 之上,所以"进入"之后
   * 四角手柄就点不到了(见 §15 风险 1)。于是选中保持可布局、进入才是可交互 —— 参考实现是
   * DOM 里的 iframe,手柄能画在上面,所以它不需要这个区分。
   */
  enteredFrameId: string | null;
  /** 进入或退出一帧(退出时给 null)。 */
  onEnterFrame: (frameId: string | null) => void;
  /** 用户**在画布上画出**一个画框时回调。矩形是画布坐标。 */
  onCreateFrameAt: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** 删掉一帧(只从右键菜单来)。 */
  onDeleteFrame: (frameId: string) => void;
  /** 把某一帧交给对话(作为输入框里的引用)。 */
  onAttachFrame: (frameId: string) => void;
  /**
   * 一套设计体系应用完了。
   *
   * 带上 `framesNeedRestyle`:设计**不能**靠换令牌机械改风格,所以已有帧要由 agent 按新规范
   * 重设 —— 上层必须知道这件事才能告诉用户(否则他会以为风格没生效)。
   */
  onApplyStyle: (result: {
    framesNeedRestyle: boolean;
    opened: DesignOpenedDto;
    styleName: string;
  }) => void;
  /** 导出渲染图 / 素材。落点由上层选,画布不碰磁盘。 */
  onExport: (what: "frames" | "assets") => void;
  /** 导出中 —— 两个按钮一起禁用,避免连点出两批文件。 */
  exporting: boolean;
  /** 手动刷新:让画布跟上磁盘(心跳只在 agent 在跑时开)。 */
  onRefresh: () => void;
  refreshing: boolean;
  /** frameId → agent 正在干什么。空 Map 表示什么都没在跑。 */
  activity: ReadonlyMap<string, FrameActivity>;
  /**
   * 源指纹。它是"磁盘变了"的唯一信号 —— 变了就让这一代位图全部作废、重新光栅。
   *
   * 与 `manifest` 分开传是有意的:清单管**有哪些帧、在哪**,指纹管**这些帧现在长什么样**。
   * 一帧改了内容而位置没变时,清单是同一个清单,而位图必须重取。
   */
  sourceRevision: string;
  onSelectionChange: (frameIds: string[]) => void;
  /** 拖拽结束时提交一次几何;拖拽途中不调用。 */
  onCommitFrameGeometry: (frameId: string, geometry: { x: number; y: number; width: number; height: number }) => void;
  /**
   * 一次提交**多帧**的位置(对齐、分布)。
   *
   * 与 `onCommitFrameGeometry` 分开,而不是循环调用它:多选的对齐必须落成**一次修订** ——
   * 逐帧提交会让中途状态被看到,也让"撤销一次对齐"变成撤销 N 次(§6.1 对多选拖拽定的同一条
   * 纪律,对齐是同一件事)。
   */
  onCommitFrameMoves: (moves: readonly { frameId: string; x: number; y: number }[]) => void;
  /**
   * 提交标题或声明尺寸(重命名、缩放)。
   *
   * 与上面的几何分开:位置进清单,而这两个写回**帧源码**。接口分得开,调用方就不可能
   * 把两件落在不同地方的事混成一件。
   */
  onCommitFrameMeta: (frameId: string, patch: { title?: string; width?: number; height?: number }) => void;
}

export function DesignCanvas(props: DesignCanvasProps) {
  return (
    <ReactFlowProvider>
      <DesignCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function DesignCanvasInner({
  client,
  designPath,
  manifest,
  activity,
  enteredFrameId,
  onEnterFrame,
  onCreateFrameAt,
  onDeleteFrame,
  onAttachFrame,
  onApplyStyle,
  onExport,
  exporting,
  onRefresh,
  refreshing,
  sourceRevision,
  onSelectionChange,
  onCommitFrameGeometry,
  onCommitFrameMoves,
  onCommitFrameMeta,
}: DesignCanvasProps) {
  const { setCenter, setNodes, fitView } = useReactFlow();
  // 活体视图要的是窗口坐标,而相机给的是画布坐标 —— 这个容器的位置就是两者之差。
  const containerRef = useRef<HTMLDivElement>(null);
  // 只订阅缩放:平移不影响任何节点内容,订阅整个 transform 会让每次平移重渲染全部节点。
  const zoom = useStore((state) => state.transform[2]);

  /**
   * 现在拿的是哪一件工具。
   *
   * `select` = 左键拖出选框、帧可以拖;`hand` = 左键拖就是平移画布;`frame` = 在画布上拖出
   * 一个画框(见 `DesignFrameDrawLayer`)。这不是换一套手势内核 —— React Flow 早就有前两个
   * 模式,只是以前写死成"选中",用户没法切。
   */
  const [tool, setTool] = useState<DesignTool>("select");
  /** 选中的帧 id。对齐/分布按它算包围盒,所以画布自己要留着。 */
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  /** 设计体系对话框开着吗。它盖在画布上,所以由画布自己持有这个状态。 */
  const [stylesOpen, setStylesOpen] = useState(false);

  /**
   * 容器的尺寸。面板可以被拉宽、可以全屏,而"整帧放不放得下"直接取决于它 —— 于是它是
   * 节点要读的一份事实,不是画布内部的一个数字。
   *
   * 用 ResizeObserver 而不是读一次 `getBoundingClientRect()`:读一次会让全屏之后尺寸永远
   * 停在旧值上,而全屏正是"放不下"的**解法**。
   */
  const [containerSize, setContainerSize] = useState({ height: 0, width: 0 });
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const update = (): void =>
      setContainerSize((current) => {
        const next = { height: element.clientHeight, width: element.clientWidth };
        return current.height === next.height && current.width === next.width ? current : next;
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /**
   * 拖拽或缩放中。**这时不给活体。**
   *
   * 拖拽移动的是 DOM 节点,而清单要等拖拽结束才提交 —— 活体矩形唯一的来源正是清单,于是
   * 原生视图停在原地、位图跟着手走:同一帧在画布上出现两次。实测到的"残影 + 两个相同的
   * 画面"就是这条。缩放同理,它要等 `onResizeEnd` 才写回帧源码。
   */
  const [dragging, setDragging] = useState(false);

  /**
   * 右键菜单的落点:容器内的屏幕坐标 + 是哪一帧。
   *
   * **换算在这里做**,因为只有画布知道容器在哪(见 `DesignFrameContextMenu` 的说明)。
   */
  const [frameMenu, setFrameMenu] = useState<{ frameId: string; x: number; y: number } | null>(null);

  const viewport = useMemo(
    () => ({
      zoom,
      focusedFrameId: enteredFrameId,
      chromeScale: designChromeScale({ x: 0, y: 0, zoom }),
      activity,
      container: containerSize,
    }),
    [activity, containerSize, enteredFrameId, zoom],
  );

  /** 稳定的能力对象:节点按帧拿它发起编辑,而它不会因为清单变化而重建。 */
  const editor = useMemo<DesignEditor>(
    () => ({
      attachFrame: onAttachFrame,
      commitMeta: onCommitFrameMeta,
      openFrameMenu: (frameId, at) => {
        const bounds = containerRef.current?.getBoundingClientRect();
        setFrameMenu({ frameId, x: at.clientX - (bounds?.left ?? 0), y: at.clientY - (bounds?.top ?? 0) });
      },
      removeFrame: onDeleteFrame,
    }),
    [onAttachFrame, onCommitFrameMeta, onDeleteFrame],
  );

  /**
   * 清单指纹。
   *
   * 用**内容**而不是 `manifest.frames` 的引用当依赖:每次 `openDesign` 都会产生一个新
   * 数组,按引用同步会在每次刷新时把用户拖到一半的位置重置掉。
   */
  const manifestKey = useMemo(
    () =>
      manifest.frames
        .map((frame) => `${frame.id}:${frame.x}:${frame.y}:${frame.width}:${frame.height}:${frame.title}`)
        .join("|"),
    [manifest.frames],
  );

  const { textures, revision } = useDesignTextures({
    client,
    designPath,
    frames: manifest.frames,
    sourceRevision,
    zoom,
  });

  const framesRef = useRef(manifest.frames);
  framesRef.current = manifest.frames;
  /** 与 `framesRef` 同一个理由:让"对齐"这个回调保持稳定,不因选择变化而重建。 */
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const texturesRef = useRef(textures);
  texturesRef.current = textures;

  /** 菜单里那一帧的标题 —— 重命名时用它当初值,而不是从空白开始打。 */
  const menuFrame =
    frameMenu === null ? undefined : framesRef.current.find((frame) => frame.id === frameMenu.frameId);

  useEffect(() => {
    // 单向同步一次。触发条件只有两个:清单变了,或一批位图到货了 ——
    // 相机与选择都不在这里。
    //
    // 源指纹**不进这个依赖**:它一变,位图要先重新光栅,而这里要的是"新位图到了再贴"。
    // 靠 `revision`(缓存到货计数)驱动,顺序就自然对了。
    setNodes(framesRef.current.map((frame) => toFlowNode(frame, texturesRef.current.get(frame.id) ?? null)));
  }, [manifestKey, revision, setNodes]);

  // 首次有帧时把内容装进视口。之后不再自动适配 —— 用户自己调过视口后不该被抢走。
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || manifest.frames.length === 0) return;
    fittedRef.current = true;
    void fitView({ maxZoom: 1, padding: 0.12, duration: 0 });
  }, [fitView, manifest.frames.length]);

  const handleSelectionChange = useMemo(
    () => (params: OnSelectionChangeParams) => {
      const ids = params.nodes.map((node) => node.id);
      setSelectedIds(ids);
      onSelectionChange(ids);
    },
    [onSelectionChange],
  );

  /**
   * 对齐/分布。
   *
   * 结果直接走**已经存在**的几何提交(`onCommitFrameMoves` 背后是 `moveDesignFrames`) ——
   * 这是这一层里唯一不需要新 IPC 的编辑动作,所以它先落地。
   */
  const handleArrange = useMemo(
    () => (mode: ArrangeMode) => {
      const placements = arrangeFrames({
        frames: framesRef.current,
        mode,
        selectedFrameIds: selectedIdsRef.current,
      });
      // 空结果**不发 IPC**:一次"本来就对齐"的点击不该让清单白写一遍、画布白刷新一遍。
      if (placements.length === 0) return;
      onCommitFrameMoves(placements);
    },
    [onCommitFrameMoves],
  );

  /**
   * 右键一帧:先把它**单独**选中。
   *
   * 不做这一步的话,右键一个没选中的帧再点"删除",删掉的是上一次选中的那一帧 —— 而画布上
   * 消失的是另一块画板。这类"删错对象"必须在结构上避免,不能靠用户看仔细。
   */
  const handleNodeContextMenuSelect = useMemo(
    () => (_event: React.MouseEvent, node: { id: string }) => {
      setNodes((current) => current.map((candidate) => ({ ...candidate, selected: candidate.id === node.id })));
    },
    [setNodes],
  );

  /**
   * 双击进入一帧。
   *
   * 这是"页面交互在一个画布内"的入口:把相机推到 1:1 并只选中这一帧,于是它成为焦点帧、
   * 原生视图接管,而**页面是真的能点的**(滚动、悬停、链接、表单都是真的)。没有这个动作,
   * 用户在画布上永远只能看到位图 —— 位图看起来很"像"设计,但点不动。
   *
   * 选中走 React Flow 自己的节点状态,而不是只上报给上层:两边各存一份"谁被选中"是这类
   * 交互最容易漂开的地方(节点高亮与焦点帧会对不上)。
   */
  const handleNodeDoubleClick = useMemo(
    () => (_event: React.MouseEvent, node: { id: string }) => {
      const frame = framesRef.current.find((candidate) => candidate.id === node.id);
      if (frame === undefined) return;
      const target = frameEntryViewport(frame);
      void setCenter(target.x, target.y, { duration: 240, zoom: target.zoom });
      setNodes((current) => current.map((candidate) => ({ ...candidate, selected: candidate.id === node.id })));
      onEnterFrame(node.id);
    },
    [onEnterFrame, setCenter, setNodes],
  );

  const focusedHasTexture = enteredFrameId !== null && textures.has(enteredFrameId);

  return (
    <DesignEditorProvider value={editor}>
    <DesignViewportProvider value={viewport}>
      <div className="h-full w-full" ref={containerRef}>
      {/*
        画框工具激活时这一层盖住画布 —— 指针事件于是到不了选择、框选、平移。工具的"关"就是
        这一层"不在",没有第二条开关要维护。
      */}
      {tool === "frame" ? (
        <DesignFrameDrawLayer
          containerRef={containerRef}
          onCreate={(rect) => {
            onCreateFrameAt(rect);
            // 画完回到选择工具:下一件事一定是调整刚画出来的那一帧(参考实现同样如此)。
            setTool("select");
          }}
        />
      ) : null}
      <DesignLiveFrameLayer
        bridge={client}
        containerRef={containerRef}
        designPath={designPath}
        dragging={dragging}
        enteredFrameId={enteredFrameId}
        frames={manifest.frames}
        hasTexture={focusedHasTexture}
      />
      <ReactFlow
        className="design-canvas"
        defaultNodes={[]}
        defaultEdges={[]}
        nodeTypes={nodeTypes}
        nodesDraggable={tool === "select"}
        nodesConnectable={false}
        elementsSelectable
        selectionOnDrag={tool === "select"}
        panOnScroll
        // 拖手工具 = 左键也平移。选中工具下左键留给选框与拖帧,平移交给中键/右键。
        panOnDrag={tool === "hand" ? true : [1, 2]}
        zoomOnScroll
        snapToGrid
        snapGrid={SNAP_GRID}
        minZoom={0.05}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        onNodeContextMenu={handleNodeContextMenuSelect}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={() => setDragging(true)}
        onNodeDragStop={(_event, node) => {
          setDragging(false);
          onCommitFrameGeometry(node.id, {
            x: node.position.x,
            y: node.position.y,
            width: Number(node.style?.width ?? 0),
            height: Number(node.style?.height ?? 0),
          });
        }}
        onPaneClick={() => onEnterFrame(null)}
        onSelectionChange={handleSelectionChange}
      >
        {/*
          方格网格,不是点阵。

          参考实现的底纹是两条 linear-gradient 画的**方格**(1px 线、14px 一格、前景色 3%),
          而点阵在同样的间距下显得稀疏又毛躁 —— 方格给的是可对齐的参照,点阵给的只是纹理。
          对齐参考线与间距手柄长在方格上才有意义,所以底纹先对。

          颜色用低透明度的中灰而不是某个主题色:它在浅色与深色主题下都读得出是"格",而写死
          一个浅灰在深色主题里会亮得刺眼(原来那版 `#e6e7e3` 就是这个问题)。
        */}
        <Background color="#8a8f941f" gap={14} variant={BackgroundVariant.Lines} />
        <DesignArrangeToolbar onArrange={handleArrange} selectedCount={selectedIds.length} />
        <DesignCanvasActions busy={exporting} onExport={onExport} onRefresh={onRefresh} refreshing={refreshing} />
        <DesignControlBar
          onOpenStyles={() => setStylesOpen(true)}
          onToolChange={setTool}
          stylesOpen={stylesOpen}
          tool={tool}
        />
      </ReactFlow>
      {stylesOpen ? (
        <DesignStyleDialog
          bridge={client}
          designPath={designPath}
          frameCount={manifest.frames.length}
          onApplied={onApplyStyle}
          onClose={() => setStylesOpen(false)}
        />
      ) : null}
      {/*
        菜单住在画布层,不在帧节点里 —— 节点的祖先带着缩放变换,放进去位置与尺寸都会错。
      */}
      {frameMenu === null ? null : (
        <DesignFrameContextMenu
          anchor={frameMenu}
          frameTitle={menuFrame?.title ?? frameMenu.frameId}
          onAttach={() => onAttachFrame(frameMenu.frameId)}
          onClose={() => setFrameMenu(null)}
          onDelete={() => onDeleteFrame(frameMenu.frameId)}
          onRename={(title) => onCommitFrameMeta(frameMenu.frameId, { title })}
        />
      )}
      </div>
    </DesignViewportProvider>
    </DesignEditorProvider>
  );
}

function toFlowNode(frame: DesignManifestDto["frames"][number], textureKey: string | null): Node<DesignFrameNodeData> {
  return {
    id: frame.id,
    type: "designFrame",
    position: { x: frame.x, y: frame.y },
    // 尺寸走 `style`:v12 里节点上的 `width`/`height` 是"测量结果"字段,由 React Flow
    // 自己写,受控设置会被它覆盖。
    style: { width: frame.width, height: frame.height },
    data: { frame, textureKey },
  };
}
