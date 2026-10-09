import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 这一层断言的是**用户看到的那句话**,所以 `t` 走真的 zh-CN 词典:「未上报」和「0.0%」在
 * 屏幕上必须长得不一样 —— 那正是这个面板存在的理由。
 */
const { messages } = await import("../src/renderer/shared/i18n.ts");

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key }),
}));

import type { ConversationMessage, SessionTurnUsage } from "@wordless/domain";
import type { SessionUsageSnapshot } from "@wordless/protocol";
import { TooltipProvider } from "@wordless/ui-kit";
import { TurnTokenUsageRow } from "../src/renderer/features/thread/TurnTokenUsageRow";
import { TurnUsageFooter } from "../src/renderer/features/thread/TurnUsageFooter";

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** 一轮用量:`primaryCallCount` / `toolCallCount` 是调用数,其余是合并后的量。 */
function turnUsage(parts: Partial<SessionTurnUsage> & { inputTokens: number }): SessionTurnUsage {
  const cacheReadTokens = parts.cacheReadTokens ?? 0;
  const cacheWriteTokens = parts.cacheWriteTokens ?? 0;
  const outputTokens = parts.outputTokens ?? 0;
  return {
    inputTokens: parts.inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: parts.totalTokens ?? parts.inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    totalCost: parts.totalCost ?? 0,
    primaryCallCount: parts.primaryCallCount ?? 1,
    toolCallCount: parts.toolCallCount ?? 0,
    ...(parts.cacheUsageReporting === undefined ? {} : { cacheUsageReporting: parts.cacheUsageReporting }),
    ...(parts.reportedPromptTokens === undefined ? {} : { reportedPromptTokens: parts.reportedPromptTokens }),
    ...(parts.cacheReadObservedCalls === undefined ? {} : { cacheReadObservedCalls: parts.cacheReadObservedCalls }),
    ...(parts.cacheReadObservedPromptTokens === undefined
      ? {}
      : { cacheReadObservedPromptTokens: parts.cacheReadObservedPromptTokens }),
    ...(parts.cacheReadObservedTokens === undefined ? {} : { cacheReadObservedTokens: parts.cacheReadObservedTokens }),
    ...(parts.cacheWriteObservedCalls === undefined ? {} : { cacheWriteObservedCalls: parts.cacheWriteObservedCalls }),
    ...(parts.cacheHitCalls === undefined ? {} : { cacheHitCalls: parts.cacheHitCalls }),
  };
}

describe("入口与图形(用户看得见的那部分)", () => {
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

  const render = async (u: SessionTurnUsage): Promise<void> => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TurnTokenUsageRow usage={u} />
        </TooltipProvider>,
      );
    });
  };

  it("入口只有图标,名字在 aria-label 与 tooltip 里", async () => {
    await render(turnUsage({ inputTokens: 100 }));
    const trigger = container.querySelector<HTMLButtonElement>('[data-turn-token-usage="trigger"]');
    expect(trigger).not.toBeNull();
    // 没有可见文字。
    expect((trigger?.textContent ?? "").trim()).toBe("");
    expect(trigger?.getAttribute("aria-label")).toBe(zh("turnUsageOpen"));

    await act(async () => {
      trigger?.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      trigger?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await vi.waitFor(() => {
      const tooltip = document.querySelector('[role="tooltip"]');
      expect(tooltip?.textContent).toContain(zh("turnUsageOpen"));
    });
  });

  it("长条按 token 比例分段,而且每段有真实颜色", async () => {
    // 输入 10K / 命中 30K / 写入 0 / 输出 40K。
    await render(
      turnUsage({
        inputTokens: 10_000,
        outputTokens: 40_000,
        cacheReadTokens: 30_000,
        cacheWriteTokens: 0,
      }),
    );
    const trigger = container.querySelector('[data-turn-token-usage="trigger"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const panel = document.querySelector<HTMLElement>('[data-turn-token-usage="panel"]') as HTMLElement;
    // 缓存写入是 0 ⇒ 不出段(0 段没有意义,还会撑开一个缝)。
    const segments = Array.from(panel.querySelectorAll<HTMLElement>("[data-token-segment]"));
    expect(segments.map((segment) => segment.getAttribute("data-token-segment"))).toEqual([
      "input",
      "cacheRead",
      "output",
    ]);

    const growth = segments.map((segment) => Number(getComputedStyle(segment).flexGrow));
    expect(growth).toEqual([10_000, 30_000, 40_000]);

    // 颜色必须是**真实**的:之前抄了参考实现的 CSS 变量,而本仓库没定义过它们,
    // 四段全透明,长条看起来就是"没分段"。
    for (const segment of segments) {
      const color = getComputedStyle(segment).backgroundColor;
      expect(color).not.toBe("rgba(0, 0, 0, 0)");
      expect(color).not.toBe("transparent");
    }
    const colors = new Set(segments.map((segment) => getComputedStyle(segment).backgroundColor));
    expect(colors.size).toBe(3);
  });

  it("大数用 M,不再一路挤在 K 里", async () => {
    await render(turnUsage({ inputTokens: 2_000_000, outputTokens: 400_000, totalTokens: 2_400_000 }));
    const trigger = container.querySelector('[data-turn-token-usage="trigger"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const panel = document.querySelector<HTMLElement>('[data-turn-token-usage="panel"]') as HTMLElement;
    expect(panel.textContent).toContain("2.4M");
    expect(panel.textContent).not.toContain("2400K");
    expect(panel.textContent).not.toContain("2000K");
  });
});

describe("会话总计(懒加载)", () => {
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

  const sessionSnapshot = (): SessionUsageSnapshot =>
    ({
      chat: {
        modelCalls: 4,
        primaryCalls: 3,
        delegatedCalls: 1,
        inputTokens: 1_000,
        outputTokens: 40,
        cacheReadTokens: 3_000,
        cacheWriteTokens: 0,
        totalTokens: 4_040,
        totalCost: 0.05,
        promptTokens: 4_000,
        cacheReadObservedCalls: 2,
        cacheWriteObservedCalls: 0,
        cacheReadObservedPromptTokens: 4_000,
        cacheReadObservedTokens: 3_000,
        cacheWriteObservedTokens: 0,
        cacheHitCalls: 2,
        tokenHitRate: 0.75,
        requestHitRate: 1,
        writeRate: null,
        readCallCoverage: 0.5,
        readTokenCoverage: 1,
        writeCallCoverage: 0,
        cacheWriteObservation: "read-only" as const,
        reportedPromptTokens: 0,
        reportedPromptCount: 0,
        reportedPromptDriftCount: 0,
        reportedPromptMaxDrift: 0,
      },
      image: { operations: 2, unmeteredOperations: 1, totalTokens: 9_000, totalCost: 0.5 },
      unmeasuredCalls: 3,
    }) as unknown as SessionUsageSnapshot;

  const render = async (load: () => Promise<SessionUsageSnapshot | null>): Promise<void> => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TurnTokenUsageRow loadSessionUsage={load} usage={turnUsage({ inputTokens: 100 })} />
        </TooltipProvider>,
      );
    });
  };

  const click = async (element: Element | null | undefined): Promise<void> => {
    await act(async () => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  };

  const panel = (): HTMLElement =>
    document.querySelector<HTMLElement>('[data-turn-token-usage="panel"]') as HTMLElement;

  it("默认显示本轮;切到会话总计才去读一次,再切回不重复读", async () => {
    const load = vi.fn(async () => sessionSnapshot());
    await render(load);
    await click(container.querySelector('[data-turn-token-usage="trigger"]'));
    expect(panel().textContent).toContain(zh("turnUsagePanelTitle"));
    expect(load).not.toHaveBeenCalled();

    await click(panel().querySelector('[data-usage-scope="session"]'));
    await vi.waitFor(() => expect(panel().textContent).toContain(zh("turnUsageSessionTitle")));
    expect(load).toHaveBeenCalledTimes(1);
    expect(panel().querySelector('[data-token-hit-rate]')?.getAttribute("data-token-hit-rate")).toBe("75.0%");
    expect(panel().textContent).toContain(zh("turnUsageCalls").replace("{count}", "4"));

    // 切回本轮:数字是本轮的,不是会话的。
    await click(panel().querySelector('[data-usage-scope="turn"]'));
    expect(panel().textContent).toContain(zh("turnUsagePanelTitle"));
    expect(panel().querySelector('[data-token-hit-rate]')?.getAttribute("data-token-hit-rate")).toBe("unreported");

    // 再切回会话总计:已经读过就不再读盘。
    await click(panel().querySelector('[data-usage-scope="session"]'));
    expect(panel().textContent).toContain(zh("turnUsageSessionTitle"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("会话总计交代「这个数不包括什么」:无用量的调用、以及不计入率的图片", async () => {
    await render(async () => sessionSnapshot());
    await click(container.querySelector('[data-turn-token-usage="trigger"]'));
    await click(panel().querySelector('[data-usage-scope="session"]'));
    await vi.waitFor(() => expect(panel().textContent).toContain(zh("turnUsageSessionTitle")));
    await click(
      Array.from(panel().querySelectorAll("button")).find(
        (button) => (button.textContent ?? "").trim() === zh("turnUsageMore"),
      ),
    );

    expect(panel().textContent).toContain(zh("turnUsageUnmeasuredCalls"));
    expect(panel().textContent).toContain(zh("turnUsageCount").replace("{count}", "3"));
    expect(panel().textContent).toContain(zh("turnUsageImageOperations"));
    expect(panel().textContent).toContain(
      zh("turnUsageImageOperationsValue")
        .replace("{count}", "2")
        .replace("{unmetered}", "1")
        .replace("{cost}", "$0.5000"),
    );
  });

  it("读不出来就说读不出来,不假装知道", async () => {
    await render(async () => null);
    await click(container.querySelector('[data-turn-token-usage="trigger"]'));
    await click(panel().querySelector('[data-usage-scope="session"]'));
    await vi.waitFor(() => expect(panel().textContent).toContain(zh("turnUsageSessionFailed")));
    expect(panel().querySelector('[data-token-hit-rate]')).toBeNull();
  });
});

describe("逐轮入口(一行助手回复底下)", () => {
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

  const renderRow = async (messages: readonly ConversationMessage[]): Promise<void> => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TurnUsageFooter messages={messages} />
        </TooltipProvider>,
      );
    });
  };

  const openPanel = async (): Promise<HTMLElement> => {
    const trigger = container.querySelector<HTMLButtonElement>('[data-turn-token-usage="trigger"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    return document.querySelector<HTMLElement>('[data-turn-token-usage="panel"]') as HTMLElement;
  };

  const assistant = (
    id: string,
    usage: Record<string, number | string> | undefined,
    blocks: ConversationMessage["blocks"] = [],
  ): ConversationMessage =>
    ({
      id,
      role: "assistant",
      timestamp: Number(id.replace(/\D/g, "")) || 1,
      blocks,
      ...(usage === undefined ? {} : { usage }),
    }) as unknown as ConversationMessage;

  it("一轮里的多次调用合成一个数,并且按 token 加权", async () => {
    // 一轮里模型被调了两次(工具循环转了一圈):大请求 90% 命中 + 小请求 0% 命中。
    // 面板必须按 token 加权得 89.1%,不能给出 (90% + 0%) / 2 = 45%。
    await renderRow([
      assistant("1", {
        inputTokens: 10_000,
        outputTokens: 20,
        cacheReadTokens: 90_000,
        cacheWriteTokens: 0,
        totalTokens: 100_020,
        totalCost: 0.02,
        cacheUsageReporting: "read-only",
      }),
      assistant("2", {
        inputTokens: 1_000,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1_005,
        totalCost: 0.001,
        cacheUsageReporting: "read-only",
      }),
    ]);
    const panel = await openPanel();

    expect(panel.querySelector('[data-token-hit-rate]')?.getAttribute("data-token-hit-rate")).toBe("89.1%");
    expect(panel.textContent).toContain(zh("turnUsageCalls").replace("{count}", "2"));
    expect(panel.textContent).not.toContain("45.0%");
  });

  it("子代理的用量挂在这一轮的工具块上,一起算并单独计数", async () => {
    await renderRow([
      assistant("1", {
        inputTokens: 1_000,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 1_010,
        totalCost: 0.002,
      }),
      assistant(
        "2",
        undefined,
        [
          {
            type: "tool",
            callId: "call_1",
            name: "task",
            state: "complete",
            usage: {
              inputTokens: 2_000,
              outputTokens: 30,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 2_030,
              totalCost: 0.004,
            },
          },
        ] as unknown as ConversationMessage["blocks"],
      ),
    ]);
    const panel = await openPanel();

    expect(panel.textContent).toContain(zh("turnUsageCalls").replace("{count}", "2"));
    expect(panel.textContent).toContain(zh("turnUsageDelegated").replace("{count}", "1"));
    expect(panel.textContent).toContain("$0.0060");
  });

  it("这一轮没有任何用量时不渲染入口", async () => {
    await renderRow([assistant("1", undefined)]);
    expect(container.querySelector('[data-turn-token-usage="trigger"]')).toBeNull();
  });
});

describe("本轮用量面板", () => {
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

  const render = async (usage?: SessionTurnUsage): Promise<void> => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TurnTokenUsageRow usage={usage} />
        </TooltipProvider>,
      );
    });
  };

  const openPanel = async (): Promise<HTMLElement> => {
    const trigger = container.querySelector<HTMLButtonElement>('[data-turn-token-usage="trigger"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const panel = document.querySelector<HTMLElement>('[data-turn-token-usage="panel"]');
    expect(panel).not.toBeNull();
    return panel as HTMLElement;
  };

  it("没有用量时什么都不渲染", async () => {
    await render(undefined);
    expect(container.querySelector('[data-turn-token-usage="trigger"]')).toBeNull();
  });

  it("命中率按 token 加权算,并把调用数与覆盖率说清楚", async () => {
    // 两次调用合并后:可观测 2 次,命中 90K + 0,分母 100K + 1K。
    await render(
      turnUsage({
        inputTokens: 10_000,
        outputTokens: 40,
        cacheReadTokens: 90_000,
        cacheWriteTokens: 0,
        totalCost: 0.0421,
        primaryCallCount: 2,
        cacheReadObservedCalls: 2,
        cacheReadObservedPromptTokens: 101_000,
        cacheReadObservedTokens: 90_000,
        cacheHitCalls: 1,
      }),
    );
    const panel = await openPanel();

    expect(panel.textContent).toContain(zh("turnUsagePanelTitle"));
    expect(panel.textContent).toContain(zh("turnUsageCalls").replace("{count}", "2"));
    // 加权:90000/101000 = 89.1%。**不是** (90% + 0%)/2 = 45%。
    const hitRate = panel.querySelector('[data-token-hit-rate]');
    expect(hitRate?.getAttribute("data-token-hit-rate")).toBe("89.1%");
    expect(hitRate?.textContent).toContain("89.1%");
    expect(panel.textContent).not.toContain("45.0%");
    expect(panel.textContent).toContain(zh("turnUsageCoverage").replace("{matched}", "2").replace("{total}", "2"));
    expect(panel.textContent).toContain(zh("turnTokenTotal"));
    expect(panel.textContent).toContain("$0.0421");
  });

  it("一次都没观测到缓存 → 「未上报」,绝不显示 0%", async () => {
    // 这条是这个面板存在的理由:provider 没上报时,0% 是个假数字。
    await render(turnUsage({ inputTokens: 5_000, outputTokens: 20, primaryCallCount: 2 }));
    const panel = await openPanel();

    const hitRate = panel.querySelector('[data-token-hit-rate]');
    expect(hitRate?.getAttribute("data-token-hit-rate")).toBe("unreported");
    expect(hitRate?.textContent).toContain(zh("turnUsageUnreported"));
    expect(panel.textContent).not.toContain("0.0%");
    expect(panel.textContent).toContain(zh("turnUsageCoverage").replace("{matched}", "0").replace("{total}", "2"));
  });

  it("上报了但确实没命中 → 显示 0.0%(与「未上报」是两件事)", async () => {
    await render(
      turnUsage({
        inputTokens: 5_000,
        outputTokens: 20,
        primaryCallCount: 1,
        cacheReadObservedCalls: 1,
        cacheReadObservedPromptTokens: 5_000,
        cacheHitCalls: 0,
      }),
    );
    const panel = await openPanel();

    const hitRate = panel.querySelector('[data-token-hit-rate]');
    expect(hitRate?.getAttribute("data-token-hit-rate")).toBe("0.0%");
    expect(hitRate?.textContent).toContain("0.0%");
    expect(hitRate?.textContent).not.toContain(zh("turnUsageUnreported"));
  });

  it("更多参数里说清覆盖率、只读的写入,以及自报与分量是否一致", async () => {
    await render(
      turnUsage({
        inputTokens: 5_000,
        outputTokens: 20,
        primaryCallCount: 1,
        cacheReadObservedCalls: 1,
        cacheReadObservedPromptTokens: 5_000,
        cacheReadObservedTokens: 4_000,
        cacheHitCalls: 1,
        // provider 自报与分量和不符 —— 面板要说出来,而不是静默 clamp。
        reportedPromptTokens: 5_100,
      }),
    );
    const panel = await openPanel();
    const more = Array.from(panel.querySelectorAll("button")).find(
      (button) => (button.textContent ?? "").trim() === zh("turnUsageMore"),
    );
    expect(more).not.toBeNull();
    await act(async () => {
      more?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(panel.querySelector('[data-token-read-coverage]')?.textContent).toContain("100.0%");
    // 只读上报:写入不是 0%,而是"未上报"。
    expect(panel.querySelector('[data-token-write-coverage]')?.textContent).toContain(
      zh("turnUsageWriteUnavailable"),
    );
    expect(panel.querySelector('[data-token-reconciliation]')?.getAttribute("data-token-reconciliation")).toBe("drift");
    expect(panel.textContent).toContain(
      zh("turnUsageReconciliationDrift").replace("{count}", "1").replace("{max}", "100"),
    );
  });

  it("委派(子代理)调用计入同一轮,并单独计数", async () => {
    await render(
      turnUsage({
        inputTokens: 1_000,
        outputTokens: 10,
        primaryCallCount: 1,
        toolCallCount: 1,
        totalCost: 0.01,
      }),
    );
    const panel = await openPanel();

    // 两个调用一起进总计,但"含 1 次委派"要说出来 —— 否则用户不知道这个数字从哪来。
    expect(panel.textContent).toContain(zh("turnUsageCalls").replace("{count}", "2"));
    expect(panel.textContent).toContain(zh("turnUsageDelegated").replace("{count}", "1"));
  });
});

describe("首 token 耗时与输出速度(This turn)", () => {
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

  /** 一条助手消息:带 usage 与调用计时(和 runtime 映射出来的形状一致)。 */
  const assistantMessage = (
    id: string,
    parts: {
      outputTokens: number;
      requestStartedAt?: number;
      firstTokenAt?: number;
      completedAt?: number;
      streamed?: boolean;
    },
  ): ConversationMessage =>
    ({
      id,
      role: "assistant",
      status: "complete",
      timestamp: 0,
      blocks: [{ type: "text", text: "ok" }],
      model: null,
      usage: turnUsage({ inputTokens: 10, outputTokens: parts.outputTokens, primaryCallCount: 1, toolCallCount: 0 }),
      ...(parts.streamed === undefined && parts.firstTokenAt === undefined
        ? {}
        : {
            timing: {
              requestStartedAt: parts.requestStartedAt ?? 0,
              ...(parts.firstTokenAt === undefined ? {} : { firstTokenAt: parts.firstTokenAt }),
              completedAt: parts.completedAt ?? 1_000,
              streamed: parts.streamed ?? parts.firstTokenAt !== undefined,
            },
          }),
    }) as ConversationMessage;

  const renderTurn = async (messages: ConversationMessage[]): Promise<void> => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <TurnUsageFooter messages={messages} />
        </TooltipProvider>,
      );
    });
    const trigger = container.querySelector('[data-turn-token-usage="trigger"]');
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  };

  const panel = (): HTMLElement =>
    document.querySelector<HTMLElement>('[data-turn-token-usage="panel"]') as HTMLElement;

  it("展示首 token 与输出速度,速度按生成窗口加权", async () => {
    // 第一次调用:TTFT 1200ms,生成窗口 1000ms 出 100 token(100 tok/s)。
    // 第二次调用:TTFT 300ms,生成窗口 2000ms 出 100 token(50 tok/s)。
    // 加权后 = 200 / 3s ≈ 66.7 tok/s —— 若对两次的速度取平均会得到 75。
    await renderTurn([
      assistantMessage("a1", { outputTokens: 100, requestStartedAt: 0, firstTokenAt: 1_200, completedAt: 2_200 }),
      assistantMessage("a2", { outputTokens: 100, requestStartedAt: 5_000, firstTokenAt: 5_300, completedAt: 7_300 }),
    ]);

    expect(panel().querySelector("[data-turn-latency]")?.getAttribute("data-turn-latency")).toBe("observed");
    // 首 token = 本轮第一次可观测调用的等待,不是平均。
    expect(panel().querySelector("[data-turn-first-token]")?.getAttribute("data-turn-first-token")).toBe("1200");
    expect(panel().textContent).toContain("1.2s");
    expect(panel().textContent).toContain("66.7 tok/s");
    expect(panel().textContent).not.toContain("75.0 tok/s");
  });

  it("没有观测到流式增量时显示「未采集」,而不是 0 或总时长", async () => {
    await renderTurn([
      assistantMessage("a1", { outputTokens: 50, requestStartedAt: 0, completedAt: 3_000, streamed: false }),
    ]);

    const block = panel().querySelector("[data-turn-latency]");
    expect(block?.getAttribute("data-turn-latency")).toBe("unobserved");
    expect(panel().querySelector("[data-turn-first-token]")?.getAttribute("data-turn-first-token")).toBe("unreported");
    expect(panel().querySelector("[data-turn-output-speed]")?.getAttribute("data-turn-output-speed")).toBe("unreported");
    expect(panel().textContent).toContain(zh("turnUsageLatencyUnavailable"));
    // 3s 是"整个调用时长",拿它当首 token 耗时就是骗人 —— 屏幕上不该出现它。
    expect(panel().textContent).not.toContain("3.0s");
    expect(panel().textContent).toContain(zh("turnUsageLatencyUnavailableHint"));
  });

  it("折叠里给出覆盖率与逐次调用(哪一次慢、哪一次没采集)", async () => {
    await renderTurn([
      assistantMessage("a1", { outputTokens: 10, requestStartedAt: 0, firstTokenAt: 900, completedAt: 1_400 }),
      assistantMessage("a2", { outputTokens: 10, requestStartedAt: 2_000, completedAt: 2_500, streamed: false }),
    ]);

    const more = Array.from(panel().querySelectorAll("button")).find(
      (button) => button.textContent === zh("turnUsageMore"),
    );
    await act(async () => {
      more?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(panel().querySelector("[data-turn-latency-coverage]")?.getAttribute("data-turn-latency-coverage")).toBe("1/2");
    expect(panel().textContent).toContain("覆盖 1/2 次调用");
    // 两次调用都列出来:没采集的那次也要留痕,否则用户会以为"只有一次调用"。
    expect(panel().querySelector("[data-turn-latency-call-count]")?.getAttribute("data-turn-latency-call-count")).toBe("2");
    const rows = Array.from(panel().querySelectorAll("[data-turn-latency-call-count] li"));
    expect(rows.length).toBe(2);
    expect(rows[1]?.textContent).toContain("—");
  });

  it("老记录(没有 timing)只降覆盖率,不显示 0", async () => {
    await renderTurn([assistantMessage("old", { outputTokens: 30 })]);

    expect(panel().querySelector("[data-turn-latency]")?.getAttribute("data-turn-latency")).toBe("unobserved");
    const more = Array.from(panel().querySelectorAll("button")).find(
      (button) => button.textContent === zh("turnUsageMore"),
    );
    await act(async () => {
      more?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(panel().textContent).toContain("覆盖 0/1 次调用");
    // 逐次明细里那一次也在(它交代了"这一次没采集"),只是数值不可得。
    expect(panel().querySelector("[data-turn-latency-call-count]")?.getAttribute("data-turn-latency-call-count")).toBe("1");
  });
});