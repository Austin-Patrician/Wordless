import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage, MessageToolBlock } from "@wordless/domain";
import { TooltipProvider } from "@wordless/ui-kit";

/**
 * 「用户在助手回话之前点了停止」留下的那一条。
 *
 * 宿主**照常把它写进 journal**(`message_end` 就是落盘的时刻,abort 也走它),内容是空的;
 * 所以这里守的是**展示层**的决定:一个空壳不许冒充一条回复。
 *
 * 三种形态必须分得清 —— 判宽了会把"取消之前已经干过的事"从界面上抹掉:
 * 1. 真的什么都没有 → 一句「已停止」+ 重做,不摆操作行;
 * 2. 吐了一部分正文 / 起过工具 → 照常渲染(操作行也在);
 * 3. 还在等第一个 token → 那是**运行状态**,不是"已停止"。
 */

const { messages } = await import("../src/renderer/shared/i18n.ts");

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    knowledge: { enabled: false, processingModel: null, autoProcessMinutes: 0, maxFilesPerRound: 0 },
    t: (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key,
  }),
}));

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: null }),
  useRuntimeClient: () => ({ getSessionUsage: async () => null }),
}));

const { AssistantMessageBody } = await import(
  "../src/renderer/features/thread/ThreadView.tsx"
);
const { createAssistantRunPresentation } = await import(
  "../src/renderer/features/thread/thread-run-state.ts"
);

const zh = (key: string): string =>
  (messages["zh-CN"] as Record<string, string>)[key] ?? key;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function assistantMessage(
  blocks: ConversationMessage["blocks"],
  patch: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    blocks,
    id: "assistant-1",
    model: null,
    role: "assistant",
    status: "aborted",
    timestamp: Date.UTC(2024, 4, 1, 9, 30, 0),
    ...patch,
  };
}

const toolBlock: MessageToolBlock = {
  callId: "call-1",
  name: "read",
  state: "complete",
  type: "tool",
};

/**
 * 「发送后立刻取消」时宿主真正写下的那一条(`createFailureMessage`)。
 *
 * **必须按真实形状造**:它有 `errorMessage`(内容是 "Request was aborted." 这种给模型看的
 * 话),而错误行只对 `status === "error"` 显示 —— 第一版判据把 errorMessage 一律当成
 * "有话说",于是线上看到的是一个只有头像、底下什么都没有的空壳(用户实测报过)。
 */
const abortedMessage = (
  blocks: ConversationMessage["blocks"] = [{ type: "text", text: "" }],
): ConversationMessage =>
  assistantMessage(blocks, { errorMessage: "Request was aborted." });

describe("助手行:没有产生任何内容的那一轮", () => {
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

  const render = (
    messagesInRow: ConversationMessage[],
    options: {
      runPresentation?: ReturnType<typeof createAssistantRunPresentation> | null;
      turnUserMessageId?: string;
      withRetry?: boolean;
      showTurnTail?: boolean;
    } = {},
  ) => {
    const noop = async () => undefined;
    act(() => {
      root.render(
        <TooltipProvider>
          <AssistantMessageBody
            assistantIdentity={undefined}
            canPlan={false}
            hasStructuredPlan={false}
            isTurnRunning={options.runPresentation !== null && options.runPresentation !== undefined}
            messages={messagesInRow}
            onHandoffClarification={noop}
            onLoadToolOutput={noop}
            onResolveApproval={() => undefined}
            onResolveClarificationQuestion={noop}
            onResolvePlanResult={noop}
            onResolveUserRequest={() => undefined}
            planMode="off"
            runPresentation={options.runPresentation ?? null}
            showTurnTail={options.showTurnTail ?? true}
            turnUserMessageId={options.turnUserMessageId ?? "user-1"}
            turnVersions={null}
            {...(options.withRetry === true
              ? { onRetryTurn: noop, onSelectTurnVersion: noop }
              : {})}
            workbenchId="conversation"
          />
        </TooltipProvider>,
      );
    });
  };

  const byLabel = (label: string): HTMLElement | null =>
    [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === label,
    ) ?? null;

  it("空壳不留:一句「已停止」+ 重做,而不是一条带操作行的回复", () => {
    render([abortedMessage()], { withRetry: true });

    // 先钉"那一排动作不该出现"—— 这是用户看见的那条空壳:复制会复制空串、用量是 0、
    // 归档点了没反应、导出是禁用的。判据变回"只要有消息就给操作行",这几条就会红。
    expect(byLabel(zh("threadCopyResponse"))).toBeNull();
    expect(byLabel(zh("turnUsageOpen"))).toBeNull();
    expect(byLabel(zh("threadExportTurn"))).toBeNull();
    expect(byLabel(zh("knowledgeFileAnswer"))).toBeNull();

    const stopped = document.querySelector("[data-thread-stopped-turn]");
    expect(stopped?.textContent).toBe(zh("assistantStoppedWithoutReply"));

    // 但**重做**必须留着:误按停止之后,这是唯一不用重新打字的出路。
    expect(byLabel(zh("threadRetryResponse"))).not.toBeNull();
    // 时间戳是这一轮的事实,留着。
    expect(container.textContent).toContain(
      new Date(Date.UTC(2024, 4, 1, 9, 30, 0)).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
  });

  it("吐了一部分正文:照常渲染,别把已经生成的东西藏起来", () => {
    render([assistantMessage([{ type: "text", text: "我先看了一眼前面的代码" }])], {
      withRetry: true,
    });

    expect(document.querySelector("[data-thread-stopped-turn]")).toBeNull();
    expect(container.textContent).toContain("我先看了一眼前面的代码");
    // 有正文就有操作行 —— 它是这条回复自己的属性(与「已停止」那一行相反)。
    expect(byLabel(zh("threadCopyResponse"))).not.toBeNull();
  });

  it("起过工具再取消:工具块仍在,行不能消失", () => {
    render([abortedMessage([toolBlock])]);

    expect(document.querySelector("[data-thread-stopped-turn]")).toBeNull();
    // 工具行的标题文字里带工具名(工作台渲染器负责画它)。
    expect(container.textContent).toContain("read");
  });

  it("还在等第一个 token:那是运行状态,不是「已停止」", () => {
    render([assistantMessage([{ type: "text", text: "" }], { status: "streaming" })], {
      // `message.started` 已经告诉过这一行"等在产出的消息是哪条",运行状态才挂得住。
      runPresentation: {
        ...createAssistantRunPresentation("user-1", Date.now()),
        assistantMessageId: "assistant-1",
      },
    });

    expect(document.querySelector("[data-thread-stopped-turn]")).toBeNull();
    expect(container.textContent).toContain(zh("assistantThinking"));
  });

  it("**真的失败**了(不是取消):错误行照旧,不能被「已停止」顶掉", () => {
    render([
      assistantMessage([{ type: "text", text: "" }], {
        errorMessage: "模型响应失败",
        status: "error",
      }),
    ]);

    expect(document.querySelector("[data-thread-stopped-turn]")).toBeNull();
    // 失败那一条的错误行由 `AssistantResponseError` 负责,它只认 `status === "error"`。
    expect(container.textContent).toContain("模型响应失败");
  });

  it("连一条消息都没留下:整行不渲染(不留一个只有头像的空壳)", () => {
    render([], { runPresentation: null });

    expect(container.innerHTML).toBe("");
  });

  it("还没有消息、但还在跑:显示运行状态(不是空行,也不是「已停止」)", () => {
    render([], {
      runPresentation: createAssistantRunPresentation("user-1", Date.now()),
    });

    expect(document.querySelector("[data-thread-stopped-turn]")).toBeNull();
    expect(container.textContent).toContain(zh("assistantThinking"));
  });
});