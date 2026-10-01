import { useEffect, useRef, useState } from "react";
import { useStore } from "@xyflow/react";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import type { DesignFrameDto } from "@wordless/protocol";
import { browserOcclusion } from "../browser/occlusion";
import type { Camera } from "./camera.ts";
import { liveFrameTarget } from "./live-frame.ts";

let mountedLayers = 0;

/**
 * 把焦点帧交给主进程的原生视图,并在不该有活体时交还给位图。
 *
 * 三件事:
 *
 * 1. **订阅完整相机**。这里必须订阅 `x`/`y`/`zoom`,因为活体视图的矩形随平移一起动。
 *    代价只有这一个组件重渲染(它不渲染任何东西),而不是全部节点 —— 画布本身的节点
 *    仍然只订阅缩放。
 * 2. **rAF 合并上报**。平移时每帧都会重算,但 IPC 一次就够;不合并的话拖动一次画布会
 *    发出上百次请求,每次都要主进程重定位一个原生面。
 * 3. **复用既有的遮挡协调器**。用 `browserOcclusion` 而不是新建一个:它是**全应用**的
 *    "原生视图被挡住了"协调器,设置对话框、菜单这些已经声明过遮挡的浮层于是**自动**对
 *    设计画布生效,不用再逐个接线。
 */
export function DesignLiveFrameLayer({
  bridge,
  containerRef,
  designPath,
  frames,
  enteredFrameId,
  hasTexture,
  dragging,
}: {
  bridge: DesktopBridge;
  containerRef: { readonly current: HTMLElement | null };
  designPath: string;
  frames: readonly DesignFrameDto[];
  enteredFrameId: string | null;
  hasTexture: boolean;
  dragging: boolean;
}) {
  const transform = useStore((state) => state.transform);
  const [occluded, setOccluded] = useState(() => browserOcclusion.occluded);

  useEffect(() => browserOcclusion.subscribe(setOccluded), []);

  /**
   * 卸载时要用**当下**的设计路径,而卸载清理只依赖 `[bridge]`(否则换设计时清理会先跑一遍,
   * 把新设计的活体一起交还)。所以路径走 latest-ref,和 `DesignWorkspace` 里那个同一个理由。
   */
  const designPathRef = useRef(designPath);
  useEffect(() => {
    designPathRef.current = designPath;
  }, [designPath]);

  const camera: Camera = { x: transform[0], y: transform[1], zoom: transform[2] };
  const containerRect = containerRef.current?.getBoundingClientRect() ?? null;

  const target = liveFrameTarget({
    frames,
    camera,
    enteredFrameId,
    // 尺寸一起给:活体**放不放得下**要按它判,而那是一条正确性条件(见 `live-frame.ts`)。
    containerRect:
      containerRect === null
        ? null
        : {
            height: containerRect.height,
            left: containerRect.left,
            top: containerRect.top,
            width: containerRect.width,
          },
    occluded,
    hasTexture,
    dragging,
  });

  // 目标变了才上报。`bounds` 在平移时每帧都变,所以下面的键包含它。
  const key =
    target === null
      ? "none"
      : `${designPath}:${target.frameId}:${target.bounds.x}:${target.bounds.y}:${target.bounds.width}:${target.bounds.height}`;
  const lastReported = useRef<string | null>(null);

  useEffect(() => {
    if (lastReported.current === key) return;
    lastReported.current = key;
    // rAF 合并:拖动一次画布只发一次请求,而不是每帧一次。
    const frame = window.requestAnimationFrame(() => {
      void bridge
        .setDesignLiveFrame({
          path: designPath,
          frameId: target?.frameId ?? null,
          bounds: target?.bounds ?? null,
        })
        // 主进程拒了(加载失败、没有窗口)不是致命错误:帧以位图呈现,仍然可用。
        .catch(() => undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bridge, designPath, key, target]);

  // 组件卸载(切走工作区、预览关闭)时把活体交还,否则原生视图会留在窗口上。
  useEffect(() => {
    mountedLayers += 1;
    return () => {
      mountedLayers = Math.max(0, mountedLayers - 1);
      // 还有别的层挂在同一份设计上时什么都不做:旧写法在这里无条件上报 `frameId: null`,
      // 而剩下那一层不会重发它的目标(键没变),于是活体白白消失到下次相机移动。
      if (mountedLayers !== 0) return;
      const path = designPathRef.current;
      queueMicrotask(() => {
        if (mountedLayers !== 0) return;
        // 两条都发:第一条保证视图**摘下来**(即使释放那条 IPC 失败也不会留下一块浮在
        // 界面上的原生视图),第二条把离屏窗口和活体一起销毁,把内存还给系统。
        void bridge
          .setDesignLiveFrame({ path, frameId: null, bounds: null })
          .catch(() => undefined);
        void Promise.resolve(bridge.disposeDesignResources?.()).catch(() => undefined);
      });
    };
  }, [bridge]);

  return null;
}
