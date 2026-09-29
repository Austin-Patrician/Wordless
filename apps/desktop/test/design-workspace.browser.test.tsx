import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ t: (key: string): string => key }),
}));

/**
 * 假运行时。
 *
 * **`runtimeRootPath` 才是设计工具写进去的根**(`create-runtime.ts` 用它构造
 * `designToolsFor`),所以它也是画布必须读的那个。两个会话的根**相同** —— 那正是"切换
 * 会话却重新加载不了设计"之所以会发生的原因(根没变)。
 *
 * 另外:这两个会话**都没有关联工作区**。UI 设计会话不需要工作区,而没有工作区时
 * `workspace?.rootPath` 是 `undefined` —— 依赖它的版本会直接返回、从不扫描任何目录,
 * 画布于是永远停在"正在生成设计…"(用户实际踩到的就是这个)。
 */
const SESSIONS = [
  { id: "s1", runtimeRootPath: "/w", workbenchId: "ui-preview" },
  { id: "s2", runtimeRootPath: "/w", workbenchId: "ui-preview" },
];

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot: { sessions: SESSIONS, workspaces: [] } }),
  useRuntimeClient: () => CLIENT,
}));

// 画布本体(React Flow)在这个测试里没有意义,换成一个可辨认的标记。
// 活动态走 `data-activity` 而不是文本:下面几条断言量的是 `textContent`,而它必须恰好
// 是设计路径。
vi.mock("../src/renderer/features/design/DesignCanvas.tsx", () => ({
  DesignCanvas: ({
    designPath,
    activity,
    onAttachFrame,
  }: {
    designPath: string;
    activity?: ReadonlyMap<string, string>;
    onAttachFrame?: (frameId: string) => void;
  }) => (
    <>
    <AttachProbe onAttachFrame={onAttachFrame} />
    <div
      data-activity={[...(activity ?? new Map<string, string>())].map(([id, kind]) => `${id}:${kind}`).join(",")}
      data-testid="canvas"
    >
      {designPath}
    </div>
    </>
  ),
}));

/*
  把画布的入口暴露成一个可点的按钮 —— "引用这一帧 → 变成哪条路径"要端到端验一次。
  挂在画布那个 div **外面**:它的 textContent 有几条断言要求**恰好**是设计路径。
*/
function AttachProbe({ onAttachFrame }: { onAttachFrame?: (frameId: string) => void }) {
  return (
    <button onClick={() => onAttachFrame?.("index")} type="button">
      attach
    </button>
  );
}

import type { DesignSummaryDto, RuntimeEvent, RuntimeEventEnvelope } from "@wordless/protocol";
import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import { DesignWorkspace } from "../src/renderer/features/design/DesignWorkspace";

function summary(path: string): DesignSummaryDto {
  return { id: path, path, name: path, mode: "built", style: null, frameCount: 1 };
}

function openedWithFrame(path: string) {
  return {
    summary: summary(path),
    manifest: {
      version: 1 as const,
      type: "wordless-design" as const,
      canvas: { x: 0, y: 0, zoom: 1 },
      mode: "built" as const,
      style: null,
      frames: [
        { file: "frames/index.html", height: 844, id: "index", title: "首页", width: 390, x: 0, y: 0 },
      ],
    },
    repaired: false,
    frameUrls: {},
  };
}

function opened(path: string) {
  return {
    summary: summary(path),
    manifest: { version: 1 as const, type: "wordless-design" as const, canvas: { x: 0, y: 0, zoom: 1 }, mode: "built" as const, style: null, frames: [] },
    repaired: false,
    frameUrls: {},
  };
}

let listDesigns: ReturnType<typeof vi.fn>;
let openDesign: ReturnType<typeof vi.fn>;
let refreshDesign: ReturnType<typeof vi.fn>;
/** 活动态的事件流:测试自己往里塞工具调用。 */
let emit: (envelope: { sessionId?: string; event: RuntimeEvent }) => void;

const CLIENT = {
  listDesigns: (...args: unknown[]) => listDesigns(...args),
  openDesign: (...args: unknown[]) => openDesign(...args),
  refreshDesign: (...args: unknown[]) => refreshDesign(...args),
  subscribe: (listener: (envelope: RuntimeEventEnvelope) => void) => {
    emit = (envelope) =>
      listener({
        protocolVersion: 1,
        runtimeInstanceId: "r",
        eventId: "e",
        sessionId: "s1",
        sequence: 0,
        timestamp: 0,
        ...envelope,
      } as RuntimeEventEnvelope);
    return () => {};
  },
} as unknown as DesktopBridge;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("design workspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listDesigns = vi.fn(async () => [] as DesignSummaryDto[]);
    openDesign = vi.fn(async ({ path }: { path: string }) => opened(path));
    // 默认"源变了,这一次真的做了事" —— 于是画布拿到 `opened`。
    refreshDesign = vi.fn(async ({ path }: { path: string }) => ({
      revision: "rev-1",
      changed: true,
      applied: true,
      opened: opened(path),
      build: null,
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(
    props: { running?: boolean; sessionId?: string; onAttachFile?: (reference: unknown) => void } = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <DesignWorkspace
          onAttachFile={props.onAttachFile}
          running={props.running ?? false}
          sessionId={props.sessionId ?? "s1"}
        />,
      );
    });
  }

  const text = (): string => container.textContent ?? "";

  it("tells the user the design is being generated while the agent is still running", async () => {
    await render({ running: true });

    // 以前这里说的是"这个工作区里还没有设计" —— 对一次正在输出的会话,那句话读起来像故障。
    expect(text()).toContain("designGenerating");
    expect(text()).not.toContain("designEmpty");
  });

  it("says the run produced no design once the agent has stopped", async () => {
    await render({ running: false });

    expect(text()).toContain("designEmpty");
    expect(text()).not.toContain("designGenerating");
  });

  it("looks where the design tools actually write, in a session with no workspace", async () => {
    await render({ sessionId: "s1" });

    // 这里曾经是 `workspace?.rootPath` —— 没有工作区的会话拿到 undefined,于是它从不扫描
    // 任何目录,画布永远停在"正在生成设计…",而 frames 与 dist 就在这个根里。
    expect(listDesigns).toHaveBeenCalledWith({ root: "/w" });
  });

  it("reloads when the selected session changes, even when the root is the same", async () => {
    await render({ sessionId: "s1" });
    expect(listDesigns).toHaveBeenCalledTimes(1);

    await render({ sessionId: "s2" });

    // 只依赖工作区根的版本在这里什么都不会做 —— 两个会话的根是同一个,画布会一直显示
    // 上一个会话的设计(或者它那份空态)。
    expect(listDesigns).toHaveBeenCalledTimes(2);
  });

  it("picks up a design that appears while the panel is open", async () => {
    vi.useFakeTimers();
    await render({ running: true });
    expect(container.querySelector('[data-testid="canvas"]')).toBeNull();

    // agent 在画布开着的时候建出了设计。
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // 打开走的是 `refreshDesign` —— 它比 `openDesign` 多做一件必须做的事:**补齐样式表**。
    // `built` 下 `dist/theme.css` 只能由构建产出,而 agent 刚建出来的包从来没构建过。
    expect(refreshDesign).toHaveBeenCalledWith({ path: "/w/meadow.wdesign" });
    expect(container.querySelector('[data-testid="canvas"]')?.textContent).toBe("/w/meadow.wdesign");
  });

  it("falls back to openDesign when the refresh had nothing to do", async () => {
    vi.useFakeTimers();
    // 被限流、或者源没变 —— 那一次不返回 `opened`(它没做事)。画布仍然必须拿到清单。
    refreshDesign.mockResolvedValue({ revision: "rev-1", changed: false, applied: false, opened: null, build: null });
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    await render({ running: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(openDesign).toHaveBeenCalledWith({ path: "/w/meadow.wdesign" });
    expect(container.querySelector('[data-testid="canvas"]')?.textContent).toBe("/w/meadow.wdesign");
  });

  it("把一帧交给对话时,给的是**工作区相对**的帧文件路径", async () => {
    /*
      端到端验一次这条换算:会话的根是 `/w`,设计包在 `/w/meadow.wdesign` —— 而 agent 的文件
      工具以工作区根为基准。基准弄错时输入框里那个引用长得一模一样,agent 却读不到那个文件。
    */
    const onAttachFile = vi.fn();
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    // 打开走的是 `refreshDesign`(它比 `openDesign` 多保证样式表是编好的),所以这里也要带帧。
    refreshDesign.mockResolvedValue({
      revision: "rev-1",
      changed: true,
      applied: true,
      opened: openedWithFrame("/w/meadow.wdesign"),
      build: null,
    });
    // 初次加载就走的是 `listDesigns → refreshDesign → openDesign`,不需要推进轮询 ——
    // 那条链是 promise,`act` 会把它排干。
    await render({ onAttachFile, running: true });
    await act(async () => {});

    const attach = Array.from(container.querySelectorAll("button")).find(
      (button) => (button.textContent ?? "") === "attach",
    );
    await act(async () => {
      attach?.click();
    });

    expect(onAttachFile).toHaveBeenCalledWith({
      kind: "file",
      name: "首页",
      path: "meadow.wdesign/frames/index.html",
    });
  });

  it("hands the agent's live activity for this design down to the canvas", async () => {
    vi.useFakeTimers();
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    await render({ running: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    // 会话流里的工具调用 → 画布上那一帧。这条通道**不需要新的 IPC**:主进程不必知道
    // 画布在看哪一帧,而事件流渲染层本来就在收。
    await act(async () => {
      emit({
        event: {
          type: "tool.started",
          messageId: "m",
          callId: "c1",
          name: "edit",
          input: { path: "meadow.wdesign/frames/login.html" },
        },
      });
    });

    const canvas = container.querySelector('[data-testid="canvas"]');
    expect(canvas?.getAttribute("data-activity")).toBe("login:modifying");
  });

  it("keeps the open design in sync while the run is on, and stops when it ends", async () => {
    vi.useFakeTimers();
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    await render({ running: true });
    const listCallsAfterLoad = listDesigns.mock.calls.length;
    const refreshCallsAfterLoad = refreshDesign.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // **心跳。** 位图是磁盘的快照,而 agent 还在往这个目录里写帧:新帧、改过的帧、以及它们
    // 新用到的工具类,在刷新之前都不存在于画布上。没有这条,画布会停在打开那一刻 ——
    // 而它看起来完全正常,所以这只能靠"又去问了没有"来钉。
    expect(refreshDesign.mock.calls.length).toBeGreaterThan(refreshCallsAfterLoad);

    // 但**不再重新列举设计**:已经打开的那份不会被换掉(用户可能正在看别的设计,或者在
    // 画布上拖着帧)。
    expect(listDesigns.mock.calls.length).toBe(listCallsAfterLoad);

    // 一轮跑完之后磁盘不会再自己变 —— 继续每秒问一次是纯浪费。
    await render({ running: false });
    const refreshCallsAfterStop = refreshDesign.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refreshDesign.mock.calls.length).toBe(refreshCallsAfterStop);
  });
  it("样式没编出来时,画布上说出来 —— 而且缺编译器运行时与普通失败分开说", async () => {
    /**
     * 这两条断言的是**用户看得见**这件事。原来构建失败在界面上完全不可见:画布只是"看着没有
     * 样式",而唯一会给解释的是模型,它给的解释是错的(实测:"你这台机器的安装损坏或被拦截",
     * 见 §14.23)。"这不代表设计写得不对"这半句必须有 —— 不然用户会去改设计稿。
     */
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    refreshDesign.mockResolvedValue({
      revision: "rev-1",
      changed: true,
      applied: true,
      opened: opened("/w/meadow.wdesign"),
      build: { ok: false, code: "runtime-missing", detail: "missing the Tailwind compiler runtime" },
    });
    await render({ running: true });

    expect(text()).toContain("designBuildRuntimeMissing");
    // 原因要一起显示:只说"没编译成功"的话,没人知道下一步该做什么。
    expect(text()).toContain("missing the Tailwind compiler runtime");
  });

  it("普通构建失败用普通措辞,而且构建成功时警示自己消失", async () => {
    // 靠 agent 运行时的轮询推进第二次刷新(与上一条"画布开着时出现新设计"同一个手法)。
    vi.useFakeTimers();
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    refreshDesign.mockResolvedValue({
      revision: "rev-1",
      changed: true,
      applied: true,
      opened: opened("/w/meadow.wdesign"),
      build: { ok: false, code: "exit-nonzero", detail: "The build exited with code 1." },
    });
    await render({ running: true });
    expect(text()).toContain("designBuildFailed");
    expect(text()).not.toContain("designBuildRuntimeMissing");

    // 下一次轮询里编出来了 —— 警示必须消失,否则它会一直挂在那里骗人。
    refreshDesign.mockResolvedValue({
      revision: "rev-2",
      changed: true,
      applied: true,
      opened: opened("/w/meadow.wdesign"),
      build: { ok: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(text()).not.toContain("designBuildFailed");
  });
});
