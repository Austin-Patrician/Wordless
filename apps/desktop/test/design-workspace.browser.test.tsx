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
vi.mock("../src/renderer/features/design/DesignCanvas.tsx", () => ({
  DesignCanvas: ({ designPath }: { designPath: string }) => <div data-testid="canvas">{designPath}</div>,
}));

import type { DesignSummaryDto } from "@wordless/protocol";
import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import { DesignWorkspace } from "../src/renderer/features/design/DesignWorkspace";

function summary(path: string): DesignSummaryDto {
  return { id: path, path, name: path, mode: "built", style: null, frameCount: 1 };
}

let listDesigns: ReturnType<typeof vi.fn>;
let openDesign: ReturnType<typeof vi.fn>;

const CLIENT = {
  listDesigns: (...args: unknown[]) => listDesigns(...args),
  openDesign: (...args: unknown[]) => openDesign(...args),
} as unknown as DesktopBridge;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("design workspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listDesigns = vi.fn(async () => [] as DesignSummaryDto[]);
    openDesign = vi.fn(async ({ path }: { path: string }) => ({
      summary: summary(path),
      manifest: { version: 1, type: "wordless-design", canvas: { x: 0, y: 0, zoom: 1 }, mode: "built", style: null, frames: [] },
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

  async function render(props: { running?: boolean; sessionId?: string } = {}): Promise<void> {
    await act(async () => {
      root.render(<DesignWorkspace running={props.running ?? false} sessionId={props.sessionId ?? "s1"} />);
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

    expect(openDesign).toHaveBeenCalledWith({ path: "/w/meadow.wdesign" });
    expect(container.querySelector('[data-testid="canvas"]')?.textContent).toBe("/w/meadow.wdesign");
  });

  it("does not poll once a design is on screen", async () => {
    vi.useFakeTimers();
    listDesigns.mockResolvedValue([summary("/w/meadow.wdesign")]);
    await render({ running: true });
    const callsAfterLoad = listDesigns.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // 已经打开的设计不会被换掉:用户可能正在看别的设计,或者在画布上拖着帧。
    expect(listDesigns.mock.calls.length).toBe(callsAfterLoad);
  });
});
