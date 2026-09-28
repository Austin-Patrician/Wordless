import { useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Node,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { Maximize2, Minus, Plus } from "lucide-react";
import "@xyflow/react/dist/style.css";
import type { DesignManifestDto } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { designChromeScale } from "./design-view.ts";
import { DesignViewportProvider } from "./design-viewport-context.tsx";
import { DesignFrameNode, type DesignFrameNodeData } from "./DesignFrameNode.tsx";
import { useDesignTextures } from "./use-design-textures.ts";
import { DesignLiveFrameLayer } from "./DesignLiveFrameLayer.tsx";

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
 */

const nodeTypes = { designFrame: DesignFrameNode };
const SNAP_GRID: [number, number] = [8, 8];

export interface DesignCanvasProps {
  manifest: DesignManifestDto;
  /** 设计包路径,光栅化请求要用。 */
  designPath: string;
  /** 桥。位图由主进程的离屏视图产出。 */
  client: DesktopBridge;
  focusedFrameId: string | null;
  onSelectionChange: (frameIds: string[]) => void;
  /** 拖拽结束时提交一次几何;拖拽途中不调用。 */
  onCommitFrameGeometry: (frameId: string, geometry: { x: number; y: number; width: number; height: number }) => void;
}

export function DesignCanvas(props: DesignCanvasProps) {
  return (
    <ReactFlowProvider>
      <DesignCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function DesignCanvasInner({ client, designPath, manifest, focusedFrameId, onSelectionChange, onCommitFrameGeometry }: DesignCanvasProps) {
  const { setNodes, fitView } = useReactFlow();
  // 活体视图要的是窗口坐标,而相机给的是画布坐标 —— 这个容器的位置就是两者之差。
  const containerRef = useRef<HTMLDivElement>(null);
  // 只订阅缩放:平移不影响任何节点内容,订阅整个 transform 会让每次平移都重渲染全部节点。
  const zoom = useStore((state) => state.transform[2]);

  const viewport = useMemo(
    () => ({ zoom, focusedFrameId, chromeScale: designChromeScale({ x: 0, y: 0, zoom }) }),
    [focusedFrameId, zoom],
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

  const { textures, revision } = useDesignTextures({ client, designPath, frames: manifest.frames, zoom });

  const framesRef = useRef(manifest.frames);
  framesRef.current = manifest.frames;
  const texturesRef = useRef(textures);
  texturesRef.current = textures;

  useEffect(() => {
    // 单向同步一次。触发条件只有两个:清单变了,或一批位图到货了 ——
    // 相机与选择都不在这里。
    setNodes(framesRef.current.map((frame) => toFlowNode(frame, texturesRef.current.get(frame.id) ?? null)));
  }, [manifestKey, revision, setNodes]);

  // 首次有帧时把内容装进视口。之后不再自动适配 —— 用户自己调过视口后不该被抢走。
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || manifest.frames.length === 0) return;
    fittedRef.current = true;
    void fitView({ padding: 0.12, maxZoom: 1, duration: 0 });
  }, [fitView, manifest.frames.length]);

  const handleSelectionChange = useMemo(
    () => (params: OnSelectionChangeParams) => onSelectionChange(params.nodes.map((node) => node.id)),
    [onSelectionChange],
  );

  const focusedHasTexture = focusedFrameId !== null && textures.has(focusedFrameId);

  return (
    <DesignViewportProvider value={viewport}>
      <div className="h-full w-full" ref={containerRef}>
      <DesignLiveFrameLayer
        bridge={client}
        containerRef={containerRef}
        designPath={designPath}
        focusedFrameId={focusedFrameId}
        frames={manifest.frames}
        hasTexture={focusedHasTexture}
      />
      <ReactFlow
        className="design-canvas"
        defaultNodes={[]}
        defaultEdges={[]}
        nodeTypes={nodeTypes}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        selectionOnDrag
        panOnScroll
        panOnDrag={[1, 2]}
        zoomOnScroll
        snapToGrid
        snapGrid={SNAP_GRID}
        minZoom={0.05}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        onSelectionChange={handleSelectionChange}
        onNodeDragStop={(_event, node) => {
          onCommitFrameGeometry(node.id, {
            x: node.position.x,
            y: node.position.y,
            width: Number(node.style?.width ?? 0),
            height: Number(node.style?.height ?? 0),
          });
        }}
      >
        <Background color="#e6e7e3" gap={24} variant={BackgroundVariant.Dots} />
        <Panel position="bottom-left">
          <DesignZoomControls />
        </Panel>
      </ReactFlow>
      </div>
    </DesignViewportProvider>
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

/**
 * 缩放条。
 *
 * 挂在 React Flow 的 `Panel` 里而不是画布外面:它要读视口的 store,而 `useStore` 只在
 * `ReactFlowProvider` 内部可用 —— 这也是缩放百分比能做到"只让这一个组件重渲染"的原因。
 */
function DesignZoomControls() {
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const percent = Math.round(zoom * 100);

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-[#e2e4e6] bg-white/95 p-0.5 text-[#55575b] shadow-sm backdrop-blur dark:border-[#3b3e41] dark:bg-[#202225]/95 dark:text-[#d2d5d8]">
      <ZoomButton label="缩小" onClick={() => void zoomOut()}>
        <Minus className="size-3.5" />
      </ZoomButton>
      <button
        className="h-6 min-w-[44px] rounded-[5px] px-1.5 text-[11px] tabular-nums hover:bg-[#f2f3f2] dark:hover:bg-[#2a2c2f]"
        onClick={() => void zoomTo(1, { duration: 180 })}
        title="重置为 100%"
        type="button"
      >
        {percent}%
      </button>
      <ZoomButton label="放大" onClick={() => void zoomIn()}>
        <Plus className="size-3.5" />
      </ZoomButton>
      <span className="mx-0.5 h-4 w-px bg-[#e6e7e3] dark:bg-[#3b3e41]" />
      <ZoomButton label="适配内容" onClick={() => void fitView({ padding: 0.12, maxZoom: 1, duration: 240 })}>
        <Maximize2 className="size-3.5" />
      </ZoomButton>
    </div>
  );
}

function ZoomButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-[5px] hover:bg-[#f2f3f2] dark:hover:bg-[#2a2c2f]"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
