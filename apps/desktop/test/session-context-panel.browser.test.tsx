import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionContextPanel } from "../src/renderer/features/artifacts/SessionContextPanel";
import type { ContextPanelTab } from "../src/renderer/features/workbench/context-panel-types";

/**
 * 那条拖拽分隔线的**分派**。
 *
 * 几何算对了由 `context-panel-layout.test.ts` 保证,但从"拖手柄"到"改哪一侧"这一跳没有覆盖:
 * `fill` 布局(设计画布)下拖的是**相邻的对话列**,而面板自己是 `flex-1` —— 如果这半段被改回
 * 去改面板宽度,界面上几乎看不出来(改了 flex-1 的宽度没有效果),测试却全绿。
 *
 * 这个文件就是为那一条存在。
 */

function DesignTab({ className }: { className?: string }) {
  return <span className={className} />;
}

const TABS: ContextPanelTab[] = [{ id: "design", icon: DesignTab, label: "设计画布" }];

describe("session context panel resize", () => {
  let container: HTMLDivElement;
  let root: Root;

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  async function render(props: {
    layout?: "fixed" | "fill";
    onMainWidthChange?: (width: number) => void;
    showTabStrip?: boolean;
    showFooter?: boolean;
    /**
     * `fixed` 布局下面板宽度还要被"剩下的宽度"夹住(`min(width, availableWidth)`),而那是
     * 相对测试视口算的。所以固定布局那条用例把它调成 0,让断言不依赖视口大小。
     */
    reserves?: { leftSidebarWidth: number; minimumMainWidth: number };
  }): Promise<void> {
    const reserves = props.reserves ?? { leftSidebarWidth: 240, minimumMainWidth: 320 };
    await act(async () => {
      root.render(
        <SessionContextPanel
          collapsed={false}
          fullscreen={false}
          layout={props.layout ?? "fixed"}
          leftSidebarWidth={reserves.leftSidebarWidth}
          mainWidth={420}
          minimumMainWidth={reserves.minimumMainWidth}
          onFullscreen={() => {}}
          onMainWidthChange={props.onMainWidthChange}
          onToggle={() => {}}
          onViewChange={() => {}}
          renderContent={() => null}
          showFooter={props.showFooter ?? false}
          showTabStrip={props.showTabStrip}
          tabs={TABS}
          view="design"
        />,
      );
    });
  }

  /** 手柄是那个 `aria-label="Resize context panel"` 的按钮;拖拽监听挂在 window 上。 */
  async function dragTo(clientX: number): Promise<void> {
    const handle = container.querySelector<HTMLElement>('[aria-label="Resize context panel"]');
    expect(handle).not.toBeNull();
    await act(async () => {
      handle?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX }));
    });
  }

  it("页签行与页脚都可以不渲染 —— 都让给内容", async () => {
    /*
      调用方(WorkbenchShell)对铺满型工作台同时关掉这两处:页签行是唯一那个标签,而页脚只是
      把它再写一遍。两处占的都是**画布的高度**,而它们一个信息量都没有。

      注意页脚那一半是**调用方**的决定(见 WorkbenchShell 的 `showFooter`),这个文件只能验
      面板在收到那两个标志时的行为。
    */
    await render({ showFooter: false, showTabStrip: false });
    expect(container.textContent).not.toContain("设计画布");
    // 但头部还在:全屏与折叠两个按钮是那两行给不了的。
    expect(container.querySelector('[aria-label="全屏"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="收起右栏"]')).not.toBeNull();

    // 打开时它照常渲染 —— 别的工作台那行还有内容可读。
    await render({ showFooter: true, showTabStrip: true });
    expect(container.textContent).toContain("设计画布");
  });

  it("fill 布局:拖手柄改的是相邻的对话列,不是面板自己", async () => {
    const onMainWidthChange = vi.fn();
    await render({ layout: "fill", onMainWidthChange });

    await dragTo(700);

    // 240 是左栏宽度 —— 不减它的话拖到最左边会让画布吃掉左栏的位置。
    expect(onMainWidthChange).toHaveBeenCalledWith(460);

    // 而面板自己**不设宽**:它是 flex-1,写一个宽度没有效果,还会掩盖这条分派写错。
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.style.width).toBe("");
  });

  it("fill 布局下面板吃掉剩余宽度 —— 这是画布能变宽的前提", async () => {
    await render({ layout: "fill" });

    const aside = container.querySelector("aside") as HTMLElement;
    // `flex-1` 而不是 `shrink-0` + 固定宽度:这一条错了,画布就还是窄的。
    expect(aside.className).toContain("flex-1");
    expect(aside.className).not.toContain("shrink-0");
  });

  it("fixed 布局:拖手柄改的是面板自己,而且不碰对话列", async () => {
    const onMainWidthChange = vi.fn();
    await render({
      layout: "fixed",
      onMainWidthChange,
      reserves: { leftSidebarWidth: 0, minimumMainWidth: 0 },
    });

    await dragTo(700);

    // 这一侧是"从窗口右边量"。期望值按同一个公式算,**不写死数字** —— 测试视口的宽度不由
    // 这个用例决定,写死只会得到一条随环境漂移的断言。方向写反(从左边量)会让它失败。
    const aside = container.querySelector("aside") as HTMLElement;
    const expected = Math.min(760, Math.max(240, window.innerWidth - 700));
    expect(aside.style.width).toBe(`${expected}px`);
    // 而相邻的对话列一动没动 —— 这正是两个方向的区别。
    expect(onMainWidthChange).not.toHaveBeenCalled();
  });
});
