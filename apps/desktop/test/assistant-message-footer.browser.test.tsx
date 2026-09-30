import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@wordless/ui-kit";

/**
 * 助手回复底部的操作行。
 *
 * 这一条锁的是用户报的问题:**复制与用量详情是每条回复都有的**,曾经因为共用一个
 * `showFooter = !isRunning && isLastMessage`,它们退化成"只有最新那条消息底下才有"。
 *
 * 重做则相反:只有最新一轮传进来 —— 这里用"传了就有、没传就没有"来表达,所以组件测试能直接
 * 断言这条差别。
 */

const { messages } = await import("../src/renderer/shared/i18n.ts");

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key }),
}));

import { AssistantMessageFooter } from "../src/renderer/features/thread/AssistantMessageFooter";

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("助手回复底部的操作行", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (
    props: Partial<Parameters<typeof AssistantMessageFooter>[0]> = {},
  ): Promise<void> => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <AssistantMessageFooter
            copyText="hello"
            hasPendingInteraction={false}
            isStreaming={false}
            isTurnRunning={false}
            messageCount={1}
            timestamp={1_700_000_000_000}
            usage={<span data-footer-item="usage" />}
            {...props}
          />
        </TooltipProvider>,
      );
    });
  };

  const has = (item: string): boolean => container.querySelector(`[data-footer-item="${item}"]`) !== null;

  it("答完的一条回复:复制与用量详情都在", async () => {
    await render();
    const copy = container.querySelector(`button[aria-label="${zh("threadCopyResponse")}"]`);
    expect(copy).not.toBeNull();
    expect(has("usage")).toBe(true);
    // 时间戳也是这条回复自己的属性。
    expect(container.textContent ?? "").not.toBe("");
  });

  it("没传重做就不显示重做(中间的回复就是这样),传了才显示(最新一轮)", async () => {
    await render();
    expect(has("retry")).toBe(false);

    await render({ retry: <span data-footer-item="retry" /> });
    expect(has("retry")).toBe(true);
    // 复制与用量详情在两种情况下都在。
    expect(container.querySelector(`button[aria-label="${zh("threadCopyResponse")}"]`)).not.toBeNull();
    expect(has("usage")).toBe(true);
  });

  it("正在生成的那一轮不显示(哪怕消息都已 complete)", async () => {
    await render({ isTurnRunning: true });
    expect(container.textContent).toBe("");
  });

  it("还在流 / 有待处理交互 / 还没有消息时不显示", async () => {
    await render({ isStreaming: true });
    expect(container.textContent).toBe("");
    await render({ hasPendingInteraction: true });
    expect(container.textContent).toBe("");
    await render({ messageCount: 0 });
    expect(container.textContent).toBe("");
  });

  it("复制按钮按 aria-label 找得到(读屏器与测试都靠它)", async () => {
    await render({ retry: <span data-footer-item="retry" /> });
    // 一次渲染里只有一个复制按钮 —— 多个回复各自一个,但都在各自的 footer 里。
    expect(container.querySelectorAll(`button[aria-label="${zh("threadCopyResponse")}"]`).length).toBe(1);
  });
});
