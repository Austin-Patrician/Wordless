import type { ContextPanelView } from "./context-panel-types";
import type { WorkbenchMainView } from "./sidebar-nav";

/**
 * 打开一个会话时,界面该切到哪儿。
 *
 * **抽成纯函数的理由**:这个判断原本散在 `WorkbenchShell` 的一个三元表达式里,而它正是
 * 出过错的地方 —— 「点会话」被同时赋予了「打开对话」和「打开画布」两个意思,于是 ui-preview
 * 会话一点开就只剩画布,对话没有任何入口回去(见 docs/architecture/design-canvas.md §14.11)。
 * 这种错误在组件里既看不见也测不到;变成一张纯映射表之后,它就是可断言的事实。
 *
 * 本文件不 import React。
 */

export interface SessionOpenTarget {
  /** 主区域显示什么。 */
  mainView: WorkbenchMainView;
  /**
   * 需要**同时**调出来的上下文面板。`null` = 不动面板。
   *
   * 为什么用"并排"而不是"替换":会话就是对话 —— 产物是这一轮工作的结果,不是它的替代品。
   * 把产物做成主视图,就意味着 agent 干活的时候你看不见它在干什么。
   */
  contextView: ContextPanelView | null;
}

export function resolveSessionOpenTarget(workbenchId: string | null | undefined): SessionOpenTarget {
  // 媒体画室保持原样:它的画布是整屏的,且有自己的"回到素材库"回路。
  if (workbenchId === "media-canvas") return { mainView: "media", contextView: null };

  // **UI 设计会话打开的是对话,画布并排在右侧。**
  // 曾经这里返回 `mainView: "ui-preview"` —— 那会让主区域只渲染画布、`ThreadView` 根本
  // 不挂载,而画布上没有任何回到对话的入口。
  if (workbenchId === "ui-preview") return { mainView: "thread", contextView: "design" };

  return { mainView: "thread", contextView: null };
}
