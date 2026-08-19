import { act, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useSyncExternalStore, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type {
  ConversationMessage,
  RuntimeEventEnvelope,
  SessionHistoryPage,
  SessionSnapshot,
  SessionViewSnapshot,
} from "@wordless/protocol";
import type { RuntimeClient } from "../src/renderer/bridge/runtime-client";
import {
  ThreadSessionStore,
  type ThreadTimelineDescriptor,
} from "../src/renderer/features/thread/thread-session-store";
import { ThreadViewportStore } from "../src/renderer/features/thread/thread-viewport-store";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function message(id: string, role: ConversationMessage["role"], text: string, timestamp: number): ConversationMessage {
  return { blocks: text ? [{ type: "text", text }] : [], id, model: null, role, status: "complete", timestamp };
}

function turn(id: string, timestamp: number, assistantText = `answer ${id}`): SessionHistoryPage["items"][number] {
  return {
    type: "turn",
    turn: {
      anchorMessageId: `${id}-user`,
      id,
      messages: [message(`${id}-user`, "user", `prompt ${id}`, timestamp), message(`${id}-assistant`, "assistant", assistantText, timestamp + 1)],
      timestamp,
    },
  };
}

function view(items: SessionHistoryPage["items"]): SessionViewSnapshot {
  return {
    extensions: [],
    history: { hasMoreAfter: false, hasMoreBefore: false, items, revision: "1" },
    isCompacting: false,
    isRunning: false,
    session: { id: "session" } as SessionViewSnapshot["session"],
    toolApprovalMode: "manual",
    turnSummaries: [],
  };
}

function runtimeHarness(initial: SessionViewSnapshot, older?: SessionHistoryPage) {
  const listeners = new Set<(event: RuntimeEventEnvelope) => void>();
  const snapshot: SessionSnapshot = {
    contextCompactions: [], extensions: [], isCompacting: false, isRunning: false,
    messages: initial.history.items.flatMap((item) => item.type === "turn" ? item.turn.messages : []),
    session: initial.session, toolApprovalMode: "manual",
  };
  const client = {
    getExpertMemberHistory: async () => ({ hasMoreAfter: false, hasMoreBefore: false, items: [], revision: "member" }),
    getExpertMemberLiveState: async () => null,
    getSessionHistoryPage: async () => older ?? initial.history,
    getSessionSnapshot: async () => snapshot,
    getSessionView: async () => initial,
    subscribe: (listener: (event: RuntimeEventEnvelope) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RuntimeClient;
  const store = new ThreadSessionStore(client, "session", (key) => key);
  let sequence = 0;
  return {
    emit(event: RuntimeEventEnvelope["event"], turnId = "turn-39") {
      sequence += 1;
      const envelope: RuntimeEventEnvelope = {
        event, eventId: `event-${sequence}`, protocolVersion: 1, runId: "run", runtimeInstanceId: "runtime",
        sequence, sessionId: "session", timestamp: sequence, turnId,
      };
      for (const listener of listeners) listener(envelope);
    },
    store,
  };
}

function Row({ descriptor, store }: { descriptor: ThreadTimelineDescriptor; store: ThreadSessionStore }) {
  const row = useSyncExternalStore(
    useCallback((listener) => store.subscribeRow(descriptor.key, listener), [descriptor.key, store]),
    useCallback(() => store.getRowSnapshot(descriptor.key), [descriptor.key, store]),
    useCallback(() => store.getRowSnapshot(descriptor.key), [descriptor.key, store]),
  );
  return (
    <div data-row-key={descriptor.key} style={{ minHeight: 36, overflowWrap: "anywhere", padding: 4 }}>
      {row.messages.length === 0 ? "pending" : row.messages.flatMap((item) => item.blocks).map((block) => {
        if (block.type === "text" || block.type === "reasoning") return block.text;
        if (block.type === "tool") return block.output ?? block.name;
        return "";
      }).join("")}
    </div>
  );
}

type BrowserHarnessHandle = {
  jump: () => void;
  scrollTo: (index: number) => void;
  scrollToTop: () => void;
};

type BrowserVirtuosoContext = {
  store: ThreadSessionStore;
  viewport: ThreadViewportStore;
};

const BROWSER_INITIAL_BOTTOM_LOCATION = {
  align: "end" as const,
  index: "LAST" as const,
};

function browserItemContent(
  _index: number,
  descriptor: ThreadTimelineDescriptor,
  context: BrowserVirtuosoContext,
) {
  return <Row descriptor={descriptor} store={context.store} />;
}

function browserItemKey(_index: number, descriptor: ThreadTimelineDescriptor) {
  return descriptor.key;
}

function BrowserJump({ onJump, viewport }: { onJump: () => void; viewport: ThreadViewportStore }) {
  const visible = useSyncExternalStore(
    viewport.subscribe,
    useCallback(() => viewport.getSnapshot().showJumpToLatest, [viewport]),
    useCallback(() => viewport.getSnapshot().showJumpToLatest, [viewport]),
  );
  return visible ? <button data-jump onClick={onJump}>latest</button> : null;
}

const BrowserHarness = forwardRef<BrowserHarnessHandle, { store: ThreadSessionStore; viewport: ThreadViewportStore }>(
  function BrowserHarness({ store, viewport }, ref) {
    const timeline = useSyncExternalStore(store.subscribeTimeline, store.getTimelineSnapshot, store.getTimelineSnapshot);
    const virtuoso = useRef<VirtuosoHandle>(null);
    const jump = useCallback(() => {
      viewport.resumeFollowing();
      virtuoso.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
    }, [viewport]);
    const context = useMemo<BrowserVirtuosoContext>(() => ({ store, viewport }), [store, viewport]);
    const atBottomChanged = useCallback((value: boolean) => viewport.setAtBottom(value), [viewport]);
    const followMode = useSyncExternalStore(
      viewport.subscribe,
      useCallback(() => viewport.getSnapshot().followMode, [viewport]),
      useCallback(() => viewport.getSnapshot().followMode, [viewport]),
    );
    useEffect(
      () => store.subscribeTailGrowth(() => {
        if (viewport.shouldFollowTailGrowth())
          virtuoso.current?.autoscrollToBottom();
      }),
      [store, viewport],
    );
    useImperativeHandle(ref, () => ({
      jump,
      scrollTo: (index) => virtuoso.current?.scrollToIndex({ index, align: "start" }),
      scrollToTop: () => virtuoso.current?.scrollTo({ top: 0 }),
    }), [jump]);
    return (
      <div style={{ height: 420, position: "relative", width: 600 }}>
        <Virtuoso
          atBottomStateChange={atBottomChanged}
          computeItemKey={browserItemKey}
          context={context}
          data={timeline.items}
          firstItemIndex={timeline.firstItemIndex}
          followOutput={followMode === "following" ? "auto" : false}
          initialTopMostItemIndex={BROWSER_INITIAL_BOTTOM_LOCATION}
          itemContent={browserItemContent}
          ref={virtuoso}
          style={{ height: "100%", width: "100%" }}
        />
        <BrowserJump onJump={jump} viewport={viewport} />
      </div>
    );
  },
);

const roots: Root[] = [];
const disposables: Array<() => void> = [];

beforeEach(() => { document.body.innerHTML = "<div id='root' style='width:600px;height:420px'></div>"; });
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const dispose of disposables.splice(0)) dispose();
  document.body.innerHTML = "";
});

async function frame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function settle(): Promise<void> {
  await frame();
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  await frame();
}

async function waitForSelector<T extends Element>(selector: string): Promise<T> {
  let element: T | null = null;
  await act(async () => {
    const deadline = performance.now() + 2_000;
    while (!(element = document.querySelector<T>(selector)) && performance.now() < deadline)
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
  });
  if (!element) throw new Error(`Timed out waiting for ${selector}`);
  return element;
}

async function mount(store: ThreadSessionStore, viewport: ThreadViewportStore) {
  const handle = { current: null as BrowserHarnessHandle | null };
  const root = createRoot(document.querySelector("#root")!);
  roots.push(root);
  disposables.push(() => store.dispose(), () => viewport.dispose());
  await act(async () => {
    root.render(<BrowserHarness ref={handle} store={store} viewport={viewport} />);
    await settle();
  });
  if (!document.querySelector("#root")?.innerHTML)
    throw new Error("Browser harness root did not render");
  return handle;
}

describe("Thread Virtuoso streaming architecture", () => {
  it("streams 5,000 deltas without remounting completed rows or changing timeline data", async () => {
    const initial = view(Array.from({ length: 40 }, (_, index) => turn(`turn-${index}`, index * 10)));
    const runtime = runtimeHarness(initial);
    await runtime.store.start();
    const timeline = runtime.store.getTimelineSnapshot();
    const viewport = new ThreadViewportStore();
    const handle = await mount(runtime.store, viewport);
    await act(async () => {
      viewport.pauseFollowing();
      await settle();
    });
    await act(async () => {
      handle.current?.scrollTo(2);
      await settle();
    });
    const historical = await waitForSelector('[data-row-key="assistant:turn-1"]');
    await act(async () => {
      for (let index = 0; index < 5_000; index += 1)
        runtime.emit({ type: "message.text.delta", messageId: "turn-1-assistant", delta: "x" }, "turn-1");
      await frame();
    });
    expect(runtime.store.getTimelineSnapshot()).toBe(timeline);
    expect(document.querySelector('[data-row-key="assistant:turn-1"]')).toBe(historical);
    expect(document.body.textContent).toContain("x".repeat(100));
  });

  it("keeps the assistant placeholder DOM node when the response starts", async () => {
    const runtime = runtimeHarness(view(
      Array.from({ length: 12 }, (_, index) => turn(`identity-${index}`, index * 10)),
    ));
    await runtime.store.start({
      message: message("pending-user", "user", "prompt", 1_000),
      submission: { submittedAt: 1_000 } as never,
    });
    const viewport = new ThreadViewportStore();
    await mount(runtime.store, viewport);
    const key = "assistant:turn:pending-user";
    const placeholder = await waitForSelector(`[data-row-key="${key}"]`);
    const historical = await waitForSelector('[data-row-key="assistant:identity-11"]');
    await act(async () => {
      runtime.emit({ type: "message.started", message: { ...message("streaming", "assistant", "", 1_001), status: "streaming" } }, "turn:pending-user");
      runtime.emit({ type: "message.text.delta", messageId: "streaming", delta: "response" }, "turn:pending-user");
      await frame();
    });
    expect(document.querySelector(`[data-row-key="${key}"]`)).toBe(placeholder);
    expect(document.querySelector('[data-row-key="assistant:identity-11"]')).toBe(historical);
    await act(async () => {
      runtime.emit({
        type: "message.completed",
        message: message("streaming", "assistant", "response", 1_001),
      }, "turn:pending-user");
      runtime.emit({ type: "session.idle" }, "turn:pending-user");
      await settle();
    });
    expect(document.querySelector(`[data-row-key="${key}"]`)).toBe(placeholder);
    expect(document.querySelector('[data-row-key="assistant:identity-11"]')).toBe(historical);
  });

  it("pauses follow on user intent and restores it only through the latest action", async () => {
    const runtime = runtimeHarness(view(Array.from({ length: 80 }, (_, index) => turn(`turn-${index}`, index * 10))));
    await runtime.store.start();
    const viewport = new ThreadViewportStore();
    const handle = await mount(runtime.store, viewport);
    await act(async () => {
      viewport.markUserScrollIntent();
      viewport.setAtBottom(false);
      await frame();
    });
    expect(document.querySelector("[data-jump]")).not.toBeNull();
    await act(async () => { handle.current?.jump(); await frame(); });
    expect(viewport.getSnapshot().followMode).toBe("following");
    expect(document.querySelector("[data-jump]")).toBeNull();
  });

  it("reaches the actual tail when jumping from a deep historical position", async () => {
    const runtime = runtimeHarness(view(Array.from({ length: 240 }, (_, index) => turn(
      `jump-${index}`,
      index * 10,
      `answer ${index} ${"dynamic streamed content ".repeat(index % 9 === 0 ? 80 : 3)}`,
    ))));
    await runtime.store.start();
    const viewport = new ThreadViewportStore();
    const handle = await mount(runtime.store, viewport);
    await act(async () => {
      viewport.pauseFollowing();
      await settle();
      handle.current?.scrollToTop();
      await settle();
    });
    await act(async () => {
      handle.current?.jump();
      await settle();
    });
    const latest = await waitForSelector<HTMLElement>('[data-row-key="assistant:jump-239"]');
    expect(latest.getBoundingClientRect().bottom).toBeLessThanOrEqual(421);
  });

  it("follows multi-frame height growth without flashing the latest button", async () => {
    const runtime = runtimeHarness(view(Array.from({ length: 24 }, (_, index) => turn(`grow-${index}`, index * 10))));
    await runtime.store.start();
    const viewport = new ThreadViewportStore();
    await mount(runtime.store, viewport);
    const latestRow = await waitForSelector<HTMLElement>('[data-row-key="assistant:grow-23"]');
    const jumpVisibility: boolean[] = [];
    const unsubscribeViewport = viewport.subscribe(() => {
      jumpVisibility.push(viewport.getSnapshot().showJumpToLatest);
    });

    for (let batch = 0; batch < 12; batch += 1) {
      await act(async () => {
        runtime.emit({
          type: "message.text.delta",
          messageId: "grow-23-assistant",
          delta: " streamed content".repeat(24),
        }, "grow-23");
        await settle();
      });
    }
    await act(settle);

    expect(viewport.getSnapshot().followMode).toBe("following");
    expect(jumpVisibility).not.toContain(true);
    expect(document.querySelector("[data-jump]")).toBeNull();
    expect(document.querySelector('[data-row-key="assistant:grow-23"]')).toBe(latestRow);
    expect(latestRow.getBoundingClientRect().bottom).toBeLessThanOrEqual(421);
    unsubscribeViewport();
  });

  it("preserves rows across prepend, compaction, interleaved member events, and a 1.8 MB tool result", async () => {
    const latest = view(Array.from({ length: 24 }, (_, index) => turn(`latest-${index}`, 1_000 + index * 10)));
    latest.history.hasMoreBefore = true;
    latest.history.nextBeforeCursor = "older";
    const older: SessionHistoryPage = {
      hasMoreAfter: false, hasMoreBefore: false,
      items: Array.from({ length: 24 }, (_, index) => turn(`older-${index}`, index * 10)), revision: "older",
    };
    const runtime = runtimeHarness(latest, older);
    await runtime.store.start();
    const viewport = new ThreadViewportStore();
    const handle = await mount(runtime.store, viewport);
    await act(async () => {
      viewport.pauseFollowing();
      await settle();
    });
    await act(async () => {
      handle.current?.scrollTo(10);
      await settle();
    });
    expect(viewport.getSnapshot().followMode).toBe("paused");
    const retainedKey = runtime.store.getTimelineSnapshot().items[10]!.key;
    const retained = await waitForSelector<HTMLElement>(`[data-row-key="${retainedKey}"]`);
    const retainedTop = retained.getBoundingClientRect().top;
    await act(async () => { await runtime.store.loadOlder(); await settle(); });
    expect(document.querySelector(`[data-row-key="${retainedKey}"]`)).toBe(retained);
    expect(Math.abs(retained.getBoundingClientRect().top - retainedTop)).toBeLessThan(2);
    const searchIndex = runtime.store.getTimelineSnapshot().items.findIndex((item) => item.key === "assistant:older-10");
    await act(async () => {
      handle.current?.scrollTo(searchIndex);
      await settle();
    });
    const searchTarget = await waitForSelector<HTMLElement>('[data-row-key="assistant:older-10"]');
    expect(searchTarget.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(searchTarget.getBoundingClientRect().top).toBeLessThan(420);
    await act(async () => {
      viewport.resumeFollowing();
      handle.current?.scrollTo(runtime.store.getTimelineSnapshot().items.length - 1);
      runtime.emit({ type: "expert-member.message.text.delta", memberId: "writer", taskId: "task", messageId: "member", delta: "member", revision: 1 }, "latest-23");
      runtime.emit({ type: "context.compaction.completed", compaction: { id: "compact", timestamp: 2_000, summary: "summary", trigger: "automatic" } }, "latest-23");
      runtime.emit({ type: "tool.started", messageId: "latest-23-assistant", callId: "large", name: "large_tool", input: {} }, "latest-23");
      runtime.emit({ type: "tool.completed", messageId: "latest-23-assistant", callId: "large", output: "z".repeat(1_800_000), isError: false }, "latest-23");
      await frame();
    });
    expect(runtime.store.getMetadataSnapshot().needsRehydrate).toBe(false);
    expect(runtime.store.getTool("large")?.output?.length).toBe(1_800_000);
    expect(viewport.getSnapshot().showJumpToLatest).toBe(false);
  });
});
