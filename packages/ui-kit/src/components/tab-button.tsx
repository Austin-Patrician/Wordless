import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * 下划线式的页内 tab。**同一页里几组互斥内容之间的切换**用它,不要用它做应用级导航
 * (那是左侧栏那套)。
 *
 * 从 `AutomationView` 里提出来:那份实现是页面内部的局部组件,而知识库页要的是同一个东西 ——
 * 两份各写一遍,迟早会在"选中态用什么颜色""要不要带下划线"上漂开。
 *
 * 注意它**只负责长相与点击**:当前是哪个 tab 由调用方持有(和 `AutomationView` 一样是本地
 * `useState`)。刻意不做成受控的 `Tabs` 容器 —— 那两个页面的 tab 都要和各自工具栏联动
 * (搜索框的作用域、按钮的显隐都跟着 tab 走),包一层容器反而要把它拆回来。
 */
export function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "border-b-2 px-4 pb-2 text-[13px] font-semibold transition-colors",
        active
          ? "border-[#252624] text-[#252624] dark:border-foreground dark:text-foreground"
          : "border-transparent text-[#888881] hover:text-[#4a4a45] dark:text-muted-foreground dark:hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
