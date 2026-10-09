import type { DesktopWindowControl } from "@wordless/protocol";

/**
 * 窗口按钮的图标种类。图标本身是组件(在 `DesktopChrome` 里映射),这里只给"画哪一个"——
 * 这样这份判断可以脱开浏览器被测(`test/window-controls.test.ts`)。
 */
export type WindowControlIcon = "minimize" | "maximize" | "restore" | "close";

export type WindowControl = {
  /** 回到主进程执行的动作。 */
  action: DesktopWindowControl;
  icon: WindowControlIcon;
  /** 无障碍标签与悬停提示。 */
  label: string;
};

/**
 * 三个窗口按钮的**动作、图标与标签**。
 *
 * 只有中间那个跟着状态变:窗口最大化时它显示"还原"并自报 Restore,否则显示"最大化"。
 * 动作始终是同一个 `toggle-maximize` —— 变的只是图标与标签,点击语义不变。
 *
 * 为什么要这么较真:这是**我们自己画的**那组按钮(Linux),系统不会替我们兜底。原生窗口按钮
 * 都按这条规则切换(macOS 的绿灯变双箭头、Windows/GNOME 的中间键变"还原"),一个永远显示
 * "最大化"的按钮会让用户看不出当前状态,也会让读屏软件念出一句说不清的话。
 */
export function windowControls(maximized: boolean): WindowControl[] {
  return [
    { action: "minimize", icon: "minimize", label: "Minimize" },
    {
      action: "toggle-maximize",
      icon: maximized ? "restore" : "maximize",
      label: maximized ? "Restore" : "Maximize",
    },
    { action: "close", icon: "close", label: "Close" },
  ];
}
