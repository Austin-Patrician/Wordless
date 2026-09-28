import { createContext, useContext, type ReactNode } from "react";

/**
 * 画布上**能做的编辑动作**,供每个帧节点自己发起。
 *
 * 为什么走 context 而不是塞进节点 data:节点 data 由 `toFlowNode` 在同步节点时整体重建,
 * 把回调放进去等于让"一份稳定的能力"跟着"一份频繁变化的数据"一起重建 —— 每个节点的 memo
 * 都会失效。动作是**稳定的**,数据是**易变的**,分开放。
 *
 * 与 `design-viewport-context` 分开也是同一个理由:那个是"现在长什么样",这个是"能改什么"。
 */export interface DesignEditor {
  /**
   * 改一帧的标题或声明尺寸。
   *
   * 落在**帧源码**里(写 `@frame` 注释),与拖拽落在清单里恰好相反 —— 见
   * `DesignHandlers.updateFrameMeta`。
   */
  commitMeta(frameId: string, patch: { title?: string; width?: number; height?: number }): void;
  /**
   * 在这帧上报的位置开右键菜单。
   *
   * 节点**不自己画菜单**:它的祖先带着画布的缩放变换,菜单放进去位置会偏、尺寸会被缩放,
   * 连关闭遮罩都只覆盖节点那么大。所以节点只上报指针的窗口坐标,由画布换算成容器坐标并渲染
   * (见 `DesignFrameContextMenu`)。
   */
  openFrameMenu(frameId: string, at: { clientX: number; clientY: number }): void;
  /**
   * 把这一帧作为引用交给对话。
   *
   * 落在**输入框**里而不是直接发出去:用户还能补一句"把这个的按钮改成方的"。这与画布上
   * 其它动作不同 —— 那些改画布,这个开一轮对话。
   */
  attachFrame(frameId: string): void;
  /**
   * 删掉一帧。
   *
   * 这是画布上唯一会**丢东西**的动作,所以它只从右键菜单来 —— 不给快捷键,也不做任何隐式
   * 删除(比如"删掉最后一帧就顺手删设计")。
   */
  removeFrame(frameId: string): void;
}

const DesignEditorContext = createContext<DesignEditor>({
  attachFrame: () => {},
  commitMeta: () => {},
  openFrameMenu: () => {},
  removeFrame: () => {},
});

export function DesignEditorProvider({ value, children }: { value: DesignEditor; children: ReactNode }) {
  return <DesignEditorContext.Provider value={value}>{children}</DesignEditorContext.Provider>;
}

export function useDesignEditor(): DesignEditor {
  return useContext(DesignEditorContext);
}
