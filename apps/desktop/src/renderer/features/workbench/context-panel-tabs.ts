import type { ContextPanelView } from "./context-panel-types";

/**
 * 面板上**由中央追加**的那两个页签。
 *
 * 它们不是各工作台注册的:翻译一个选区是全局能力,浏览器是"这里放得下一块可预览的面"
 * 的地方就给的。这条判断原本散在 `WorkbenchShell` 里的一串展开表达式里 —— 而它正是
 * 用户报"右侧栏太乱"的地方:
 *
 * - **铺满型工作台**(设计画布)只留它自己注册的页签。画布是无限的,并排放两三个页签意味着
 *   画布只能用掉面板的一部分,而用户来看的就是画布。
 * - 浏览器只在"确实会有一张页面要看"的工作台上出现。设计会话**不在此列** —— 它的面板
 *   就是画布本身。
 *
 * 抽成纯函数是为了它能被断言:三个集合之间的关系(谁铺满、谁能放浏览器、谁只拿翻译)
 * 散在 JSX 里既看不见也测不到。
 */

/** 铺满整块面板的工作台:页签只来自注册表,不追加任何共享页签。 */
export const CONTEXT_PANEL_EXCLUSIVE_WORKBENCH_IDS: ReadonlySet<string> = new Set(["ui-preview"]);

/**
 * 面板上放得下浏览器的工作台。
 *
 * `conversation` 是因为 agent 可能自己去开一个页面;`code` 是因为正在开发的页面在那里验证。
 * **不含 `ui-preview`**:设计会话的面板就是画布。
 */
export const BROWSER_CONTEXT_PANEL_WORKBENCH_IDS: ReadonlySet<string> = new Set(["conversation", "code"]);

/**
 * "画布为主"的布局这一次该不该生效 —— 也就是**对话列该撑满还是定宽**。
 *
 * 三个条件缺一不可,而第三个是踩过的:
 *
 * - `exclusive` —— 只有画布工作台有这套布局
 * - `panelOpen` —— **面板关着就没有画布可言,对话必须回到 `flex-1`**。漏掉它的那一版把
 *   对话列无条件设成固定宽,于是用户折叠画布之后对话仍是 420、右边留一整片空背景,看起来
 *   像"折叠没生效、还留了个画布占位"。
 * - `!fullscreen` —— 全屏时主区整个让给画布(主区被 `hidden`),这一列不再参与分配。
 */
export function mainColumnFills(input: {
  exclusive: boolean;
  panelOpen: boolean;
  panelFullscreen: boolean;
}): boolean {
  return !(input.exclusive && input.panelOpen && !input.panelFullscreen);
}

/**
 * 这块面板要追加哪些共享页签,按显示顺序。
 *
 * 铺满型工作台返回空数组 —— 这是一个**判断**,不是"少写一行"。
 */
export function sharedContextPanelViews(workbenchId: string | null | undefined): ContextPanelView[] {
  if (workbenchId != null && CONTEXT_PANEL_EXCLUSIVE_WORKBENCH_IDS.has(workbenchId)) return [];
  const views: ContextPanelView[] = ["translation"];
  if (workbenchId != null && BROWSER_CONTEXT_PANEL_WORKBENCH_IDS.has(workbenchId)) views.push("browser");
  return views;
}
