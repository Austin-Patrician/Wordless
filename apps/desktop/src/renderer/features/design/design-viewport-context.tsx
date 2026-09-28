import { createContext, useContext, type ReactNode } from "react";
import type { FrameActivity } from "./frame-activity.ts";

/**
 * 画布视口的只读快照,供每个帧节点自取。
 *
 * 为什么走 context 而不是让画布把相机算进节点列表:节点列表一旦随相机变化,每次平移
 * 都会重建整张图 —— 与 React Flow 的内部 store 和 `ResizeObserver` 形成反馈环。所以
 * **节点列表只由清单派生**(只在清单变化时重建),相机经这里下发,节点自己算呈现方式。
 *
 * 值本身是每帧一次的普通对象:订阅发生在画布层(React Flow 的 store selector),而不是
 * 每个节点各自订阅一次。
 */

/**
 * 节点真正需要的东西,**不含相机平移**。
 *
 * 这是刻意的:平移时相机 `x`/`y` 每帧都在变,若把它下发下去,每个节点都会跟着重渲染 ——
 * 而平移只影响容器变换,节点内容一个像素都没动(那是 React Flow 用 CSS transform 做的)。
 * 所以这里只放**缩放**(它决定 chrome 反向缩放与是否够格给活体)与焦点帧。
 * 于是拖动画布时不产生任何节点重渲染,缩放时才产生 —— 而缩放本来就要重算这些。
 */
export interface DesignViewport {
  zoom: number;
  /** 焦点帧 id —— 唯一可能交给原生视图的那一帧。 */
  focusedFrameId: string | null;
  /** 浮层元素的反向缩放系数,见 `designChromeScale`。 */
  chromeScale: number;
  /**
   * frameId → agent 正在干什么(见 `frame-activity.ts`)。
   *
   * 走同一个 context 而不是塞进节点列表:活动态**与相机无关**,它是"哪一帧在被我改"。
   * 塞进节点列表会让每一次工具调用都重建整张图,而那正是上面那段注释警告的反馈环。
   * 代价是活动态一变、每个节点都重渲染一次 —— 帧只有几十个,而它一秒最多变几次。
   */
  activity: ReadonlyMap<string, FrameActivity>;
  /**
   * 画布容器在屏幕上的尺寸。
   *
   * 节点需要它来回答一个**用户看得见**的问题:"这一帧进了之后能不能交互"。原生视图放不下
   * 就不能给(见 `frameFitsInViewport`),而放不下时画布上必须说得出原因 —— 否则用户双击
   * 进入、页面却依然点不动,而界面上没有任何解释。
   */
  container: { width: number; height: number };
}

const DesignViewportContext = createContext<DesignViewport>({
  zoom: 1,
  focusedFrameId: null,
  chromeScale: 1,
  activity: new Map(),
  container: { height: 0, width: 0 },
});

export function DesignViewportProvider({
  value,
  children,
}: {
  value: DesignViewport;
  children: ReactNode;
}) {
  return <DesignViewportContext.Provider value={value}>{children}</DesignViewportContext.Provider>;
}

export function useDesignViewport(): DesignViewport {
  return useContext(DesignViewportContext);
}
