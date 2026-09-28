import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesignFrameDto, RuntimeEvent, RuntimeEventEnvelope } from "@wordless/protocol";
import type { DesktopBridge } from "../src/bridge/desktop-bridge";
import {
  MIN_ACTIVITY_MS,
  UPDATED_ACTIVITY_MS,
} from "../src/renderer/features/design/frame-activity";
import { useDesignActivity } from "../src/renderer/features/design/use-design-activity";

/**
 * 活动态投影的**接线**部分(纯判断见 `design-frame-activity.test.ts`)。
 *
 * 数据来源是渲染层已经在收的运行时事件流,所以这里要钉的是:事件进来之后,哪一帧被点亮、
 * 什么时候落定、以及"收场事件全丢了"时的兜底。用探针组件直接跑 hook —— 不必把画布拖进来。
 */

function frame(id: string): DesignFrameDto {
  return { id, file: `frames/${id}.html`, x: 0, y: 0, width: 390, height: 844, title: id };
}

const FRAMES = [frame("index"), frame("login")];
const DESIGN_PATH = "/w/meadow.wdesign";

function text(activity: ReadonlyMap<string, string>): string {
  return [...activity].map(([id, kind]) => `${id}:${kind}`).sort().join(",");
}

function Probe({
  client,
  sessionId = "s1",
  onActivity,
}: {
  client: DesktopBridge;
  sessionId?: string;
  onActivity?: (activity: ReadonlyMap<string, string>) => void;
}): null {
  const activity = useDesignActivity({
    client,
    sessionId,
    designPath: DESIGN_PATH,
    frames: FRAMES,
  });
  onActivity?.(activity);
  return null;
}

describe("design activity", () => {
  let container: HTMLDivElement;
  let root: Root;
  let emit: (envelope: Partial<RuntimeEventEnvelope> & { event: RuntimeEvent }) => void;
  let current: () => ReadonlyMap<string, string>;

  const CLIENT = {
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

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    current = () => new Map();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function render(): Promise<void> {
    await act(async () => {
      root.render(<Probe client={CLIENT} onActivity={(activity) => (current = () => activity)} />);
    });
  }

  function toolStarted(callId: string, name: string, path: string): void {
    act(() => emit({ event: { type: "tool.started", messageId: "m", callId, name, input: { path } } }));
  }

  function toolCompleted(callId: string, isError = false): void {
    act(() => emit({ event: { type: "tool.completed", messageId: "m", callId, output: "", isError } }));
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("agent 改某一帧时,那一帧亮起来", async () => {
    await render();
    expect(text(current())).toBe("");

    // `edit` 是"修改",而路径指着 login —— 只有它该亮。
    toolStarted("c1", "edit", "meadow.wdesign/frames/login.html");
    expect(text(current())).toBe("login:modifying");
  });

  it("读一帧之后直接落下,不翻成「已更新」", async () => {
    await render();
    toolStarted("c1", "read", "meadow.wdesign/frames/index.html");
    expect(text(current())).toBe("index:reading");

    // 读没有改动任何东西。翻成"已更新"会让人以为它改过。
    toolCompleted("c1");
    await advance(MIN_ACTIVITY_MS + 100);
    expect(text(current())).toBe("");
  });

  it("改完之后先亮「已更新」再落定", async () => {
    await render();
    toolStarted("c1", "edit", "meadow.wdesign/frames/index.html");
    toolCompleted("c1");

    // 活干得比人眼快 —— 但状态已经亮着了,不会一闪而过。
    expect(text(current())).toBe("index:modifying");

    await advance(MIN_ACTIVITY_MS);
    expect(text(current())).toBe("index:updated");

    await advance(UPDATED_ACTIVITY_MS);
    expect(text(current())).toBe("");
  });

  it("出错的调用不留痕迹", async () => {
    await render();
    toolStarted("c1", "write", "meadow.wdesign/frames/index.html");
    toolCompleted("c1", true);

    // 写失败了,什么都没变。留下"已更新"是在说一件没发生的事。
    await advance(MIN_ACTIVITY_MS + 1_000);
    expect(text(current())).toBe("");
  });

  it("改共享件点亮全部帧", async () => {
    await render();
    toolStarted("c1", "edit", "meadow.wdesign/theme.css");
    expect(text(current())).toBe("index:modifying,login:modifying");
  });

  it("一轮结束把在途的全部清掉 —— 这是收场事件丢了时的兜底", async () => {
    await render();
    // 只来了 start,`tool.completed` 永远没来。
    toolStarted("c1", "write", "meadow.wdesign/frames/index.html");
    expect(text(current())).not.toBe("");

    act(() => emit({ event: { type: "session.idle" } }));
    // 永远挂着的状态比没有状态更糟。
    expect(text(current())).toBe("");
  });

  it("别的会话的事件不点亮这一块画布", async () => {
    await render();
    act(() => {
      emit({
        sessionId: "other",
        event: { type: "tool.started", messageId: "m", callId: "c1", name: "edit", input: { path: "meadow.wdesign/frames/index.html" } },
      });
    });
    expect(text(current())).toBe("");
  });

  it("认不出的工具与包外的路径都不点亮", async () => {
    await render();
    toolStarted("c1", "bash", "meadow.wdesign/frames/index.html");
    toolStarted("c2", "edit", "src/app.tsx");
    expect(text(current())).toBe("");
  });
});
