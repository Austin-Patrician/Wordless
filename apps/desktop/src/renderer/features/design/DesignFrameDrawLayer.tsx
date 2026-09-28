import { useRef, useState } from "react";
import { useStoreApi } from "@xyflow/react";
import { screenPointToWorld, type Camera } from "./camera.ts";

/**
 * 画框工具:在画布上拖出一个矩形,松手就建一帧。
 *
 * 参考实现的底栏第三项就是它("frame"),而它的手感要点只有一条:**拖的时候看到的就是将得到
 * 的东西**。所以这里画的是一层跟随指针的虚框,而不是"点了之后按默认尺寸建一个"——后者用户
 * 无法决定新画面多大,而那正是他按下这个工具时想做的那件事。
 *
 * 三处刻意的选择:
 *
 * 1. **整层只在画框工具激活时存在。** 它覆盖在画布之上,所以只要它在,指针事件就到不了画布;
 *    常驻会让选择、框选、平移全部失效。于是工具的"关"就是这一层的"不在"(见 `DesignTool`)。
 * 2. **相机是现读的,不是订阅的**(`useStoreApi().getState()`)。订阅整个 transform 会让
 *    每次平移重渲染这层;而这里只在指针事件发生的那一刻需要它。
 * 3. **屏幕 → 画布要走 `screenPointToWorld`**,与位图、活体视图同一个变换。自己再算一遍
 *    缩放就是第二份几何,而两份几何迟早错开。
 */

export interface FrameDrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 拖得比这个还小就当成"误触",不建帧 —— 一个 3×4 的画框在画布上几乎看不见。 */
const MIN_DRAW_SIZE = 24;

export function DesignFrameDrawLayer({
  containerRef,
  onCreate,
}: {
  containerRef: { readonly current: HTMLElement | null };
  /** 松手时给出画布坐标下的矩形。 */
  onCreate: (rect: FrameDrawRect) => void;
}) {
  const store = useStoreApi();
  const [ghost, setGhost] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  /** 指针位置 → 容器内的屏幕坐标。事件给的是窗口坐标,而相机按容器算。 */
  const toLocal = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    const from = start.current;
    start.current = null;
    setGhost(null);
    if (from === null) return;

    const to = toLocal(event);
    const camera: Camera = (() => {
      const [x, y, zoom] = store.getState().transform;
      return { x, y, zoom };
    })();
    const a = screenPointToWorld(camera, from);
    const b = screenPointToWorld(camera, to);
    const rect: FrameDrawRect = {
      height: Math.abs(b.y - a.y),
      width: Math.abs(b.x - a.x),
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
    };
    if (rect.width < MIN_DRAW_SIZE || rect.height < MIN_DRAW_SIZE) return;
    onCreate(rect);
  };

  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      onPointerDown={(event) => {
        // 只认左键。中键/右键在这个工具下仍然是平移,不然用户没法一边画一边挪画布。
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const local = toLocal(event);
        start.current = local;
        setGhost({ height: 0, left: local.x, top: local.y, width: 0 });
      }}
      onPointerMove={(event) => {
        const from = start.current;
        if (from === null) return;
        const local = toLocal(event);
        setGhost({
          height: Math.abs(local.y - from.y),
          left: Math.min(local.x, from.x),
          top: Math.min(local.y, from.y),
          width: Math.abs(local.x - from.x),
        });
      }}
      onPointerUp={finish}
    >
      {ghost === null ? null : (
        <div
          className="pointer-events-none absolute rounded-[3px] border border-[#3f6bd6] bg-[#3f6bd6]/10"
          style={{ height: ghost.height, left: ghost.left, top: ghost.top, width: ghost.width }}
        />
      )}
    </div>
  );
}
