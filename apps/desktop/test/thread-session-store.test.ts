import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationMessage,
  RuntimeEventEnvelope,
  SessionHistoryPage,
  SessionSnapshot,
  SessionViewSnapshot,
} from "@wordless/protocol";
import type { RuntimeClient } from "../src/renderer/bridge/runtime-client.ts";
import { ThreadSessionStore } from "../src/renderer/features/thread/thread-session-store.ts";
import type { AnimationFrameScheduler } from "../src/renderer/features/thread/thread-viewport-store.ts";
import {
  disposeThreadSessionStores,
  getThreadSessionStore,
} from "../src/renderer/features/thread/thread-session-store-registry.ts";

class TestFrames implements AnimationFrameScheduler {
  private callbacks = new Map<number, FrameRequestCallback>();
  private next = 1;

  cancel = (handle: number) => { this.callbacks.delete(handle); };
  request = (callback: FrameRequestCallback) => {
    const handle = this.next++;
    this.callbacks.set(handle, callback);
    return handle;
  };

  flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback(0);
  }
}

function message(id: string, role: ConversationMessage["role"], text: string): ConversationMessage {
  return {
    blocks: [{ type: "text", text }],
    id,
    model: null,
    role,
    status: "complete",
    timestamp: role === "user" ? 1 : 2,
  };
}

function view(isRunning = false): SessionViewSnapshot {
  return {
    extensions: [],
    history: {
      hasMoreAfter: false,
      hasMoreBefore: false,
      items: [{
        type: "turn",
        turn: {
          anchorMessageId: "user",
          id: "turn:user",
          messages: [message("user", "user", "prompt"), message("assistant", "assistant", "")],
          timestamp: 1,
        },
      }],
      revision: "1",
    },
    isCompacting: false,
    isRunning,
    session: { id: "session" } as SessionViewSnapshot["session"],
    toolApprovalMode: "manual",
    turnSummaries: [],
  };
}

function fullSnapshot(): SessionSnapshot {
  return {
    contextCompactions: [],
    extensions: [],
    isCompacting: false,
    isRunning: false,
    messages: [message("user", "user", "prompt"), message("assistant", "assistant", "recovered")],
    session: { id: "session" } as SessionSnapshot["session"],
    toolApprovalMode: "manual",
  };
}

function envelope(sequence: number, event: RuntimeEventEnvelope["event"]): RuntimeEventEnvelope {
  return {
    event,
    eventId: `event-${sequence}`,
    protocolVersion: 1,
    runId: "run",
    runtimeInstanceId: "runtime",
    sequence,
    sessionId: "session",
    timestamp: sequence,
    turnId: "turn:user",
  };
}

function registryHarness() {
  const listeners = new Set<(event: RuntimeEventEnvelope) => void>();
  const client = {
    getSessionSnapshot: async () => fullSnapshot(),
    getSessionView: async () => view(),
    subscribe: (listener: (event: RuntimeEventEnvelope) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RuntimeClient;
  return { client, frames: new TestFrames(), listeners };
}

function harness(overrides: Partial<RuntimeClient> = {}) {
  const listeners = new Set<(event: RuntimeEventEnvelope) => void>();
  const client = {
    getSessionSnapshot: async () => fullSnapshot(),
    getSessionView: async () => view(),
    subscribe: (listener: (event: RuntimeEventEnvelope) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides,
  } as unknown as RuntimeClient;
  const frames = new TestFrames();
  const store = new ThreadSessionStore(client, "session", (key) => key, frames);
  return {
    emit: (event: RuntimeEventEnvelope) => { for (const listener of listeners) listener(event); },
    frames,
    store,
  };
}

test("publishes loading independently from ordinary metadata", async () => {
  const { store } = harness();
  let loadingNotifications = 0;
  let metadataNotifications = 0;
  store.subscribeLoading(() => { loadingNotifications += 1; });
  store.subscribeMetadata(() => { metadataNotifications += 1; });

  await store.start();
  assert.equal(store.getLoadingSnapshot(), false);
  assert.equal(loadingNotifications, 1);

  store.patchToolApprovalMode("auto");
  assert.equal(loadingNotifications, 1);
  assert.equal(metadataNotifications, 2);
  store.dispose();
});

test("keeps timeline references stable and publishes one row update for 5,000 deltas", async () => {
  const { emit, frames, store } = harness();
  await store.start();
  const timeline = store.getTimelineSnapshot();
  const descriptors = timeline.items;
  let rowNotifications = 0;
  let tailGrowthNotifications = 0;
  let timelineNotifications = 0;
  store.subscribeRow("assistant:turn:user", () => { rowNotifications += 1; });
  store.subscribeTailGrowth(() => { tailGrowthNotifications += 1; });
  store.subscribeTimeline(() => { timelineNotifications += 1; });
  let historyNotifications = 0;
  store.subscribeHistory(() => { historyNotifications += 1; });

  for (let sequence = 1; sequence <= 5_000; sequence += 1)
    emit(envelope(sequence, { type: "message.text.delta", messageId: "assistant", delta: "x" }));
  frames.flush();

  assert.equal(store.getTimelineSnapshot(), timeline);
  assert.equal(store.getTimelineSnapshot().items, descriptors);
  assert.equal(timelineNotifications, 0);
  assert.equal(historyNotifications, 0);
  assert.equal(rowNotifications, 1);
  assert.equal(tailGrowthNotifications, 1);
  assert.equal(store.getRowSnapshot("assistant:turn:user").messages[0]?.blocks[0]?.type, "text");
  assert.equal((store.getRowSnapshot("assistant:turn:user").messages[0]?.blocks[0] as { text: string }).text.length, 5_000);
  store.dispose();
});

test("promotes a pending assistant row without an intermediate empty-row update", async () => {
  const pendingView = view(true);
  const pendingTurn = pendingView.history.items[0];
  if (pendingTurn?.type === "turn") pendingTurn.turn.messages = [message("user", "user", "prompt")];
  const { emit, frames, store } = harness({ getSessionView: async () => pendingView });
  await store.start();
  const timeline = store.getTimelineSnapshot();
  let rowNotifications = 0;
  store.subscribeRow("assistant:turn:user", () => { rowNotifications += 1; });

  emit(envelope(1, {
    type: "message.started",
    message: { ...message("streaming-assistant", "assistant", ""), status: "streaming" },
  }));

  assert.equal(store.getTimelineSnapshot(), timeline);
  assert.equal(rowNotifications, 1);
  assert.equal(store.getRowSnapshot("assistant:turn:user").messages[0]?.id, "streaming-assistant");
  assert.equal(store.getRowSnapshot("assistant:turn:user").presentation?.assistantMessageId, "streaming-assistant");

  emit(envelope(2, { type: "message.text.delta", messageId: "streaming-assistant", delta: "first" }));
  frames.flush();
  assert.equal(rowNotifications, 2);
  assert.equal((store.getMessage("streaming-assistant")?.blocks[0] as { text: string }).text, "first");
  store.dispose();
});

test("publishes one final assistant row snapshot for each terminal runtime event", async () => {
  const { emit, store } = harness({ getSessionView: async () => view(true) });
  await store.start();
  let rowNotifications = 0;
  store.subscribeRow("assistant:turn:user", () => { rowNotifications += 1; });

  emit(envelope(1, {
    type: "message.completed",
    message: { ...message("assistant", "assistant", "final"), status: "complete" },
  }));
  assert.equal(rowNotifications, 1);
  assert.equal(
    (store.getRowSnapshot("assistant:turn:user").messages[0]?.blocks[0] as { text: string }).text,
    "final",
  );

  emit(envelope(2, { type: "session.idle" }));
  assert.equal(rowNotifications, 2);
  assert.equal(store.getRowSnapshot("assistant:turn:user").presentation, null);
  store.dispose();
});

test("projects reconnecting onto the event turn after removing a failed assistant message", async () => {
  const { emit, store } = harness({ getSessionView: async () => view(false) });
  await store.start();

  emit(envelope(1, {
    type: "message.started",
    message: { ...message("failed-assistant", "assistant", ""), status: "streaming" },
  }));
  emit(envelope(2, {
    type: "model.retry.scheduled",
    retry: {
      attempt: 2,
      maxRetries: 5,
      scheduledAt: 2_000,
      retryAt: 12_000,
      delayMs: 10_000,
      errorMessage: "Connection error.",
      failedMessageId: "failed-assistant",
    },
  }));

  const row = store.getRowSnapshot("assistant:turn:user");
  assert.deepEqual(row.messages.map((candidate) => candidate.id), ["assistant"]);
  assert.equal(row.presentation?.assistantMessageId, "assistant");
  assert.equal(row.presentation?.activity.type, "reconnecting");
  assert.equal(store.getMetadataSnapshot().modelRetry?.attempt, 2);
  store.dispose();
});

test("advances the main cursor across interleaved expert member events", async () => {
  const { emit, frames, store } = harness();
  await store.start();
  emit(envelope(1, { type: "message.text.delta", messageId: "assistant", delta: "a" }));
  emit(envelope(2, {
    type: "expert-member.message.text.delta",
    memberId: "writer",
    taskId: "task",
    messageId: "member-message",
    delta: "member",
    revision: 1,
  }));
  emit(envelope(3, { type: "message.text.delta", messageId: "assistant", delta: "b" }));
  frames.flush();
  assert.equal(store.getMetadataSnapshot().needsRehydrate, false);
  store.dispose();
});

test("keeps unseen expert members live-only until their conversation is opened", async () => {
  let historyCalls = 0;
  let liveCalls = 0;
  const { emit, store } = harness({
    getExpertMemberHistory: async () => {
      historyCalls += 1;
      return { hasMoreAfter: false, hasMoreBefore: false, items: [], revision: "member" };
    },
    getExpertMemberLiveState: async () => {
      liveCalls += 1;
      return null;
    },
  });
  await store.start();
  emit(envelope(1, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: { ...message("member-message", "assistant", ""), status: "streaming" },
    revision: 1,
  }));
  emit(envelope(2, {
    type: "expert-member.message.completed",
    memberId: "writer",
    taskId: "task",
    message: { ...message("member-message", "assistant", "live"), status: "complete" },
    revision: 2,
  }));
  assert.equal(historyCalls, 0);
  assert.equal(liveCalls, 0);

  await store.getExpertMemberStore("writer").start();
  assert.equal(historyCalls, 1);
  assert.equal(liveCalls, 1);
  assert.ok(store.getExpertMemberStore("writer").getTimelineSnapshot().items.length > 0);
  store.dispose();
});

test("keeps a running session live until the run finishes, then releases it", async () => {
  // 视图卸载时那一轮还在跑:立刻挂起会把在途助手消息的正文一起丢掉 —— journal 里只有
  // **已完成**的消息,`.text.delta` 本身不落盘,所以切回来会空到 `message.completed`。
  const { emit, frames, store } = harness();
  await store.start();
  emit(envelope(1, { type: "run.started", runId: "run" }));
  emit(envelope(2, {
    type: "message.started",
    message: { ...message("streaming-assistant", "assistant", ""), status: "streaming" },
  }));
  emit(envelope(3, { type: "message.text.delta", messageId: "streaming-assistant", delta: "写到一半" }));
  frames.flush();

  const text = () => {
    const block = store.getMessage("streaming-assistant")?.blocks[0];
    return block?.type === "text" ? block.text : null;
  };
  assert.equal(store.getMetadataSnapshot().isRunning, true);
  assert.equal(text(), "写到一半");

  store.release();

  // 卸载之后到的增量仍然落进投影 —— 这正是"运行中先不挂起"换来的东西。
  emit(envelope(4, { type: "message.text.delta", messageId: "streaming-assistant", delta: "，还有下半句" }));
  frames.flush();
  assert.equal(text(), "写到一半，还有下半句");

  // 这一轮结束,这时才真的释放。
  emit(envelope(5, { type: "session.idle" }));
  await Promise.resolve();
  assert.equal(store.getMetadataSnapshot().isRunning, false);
  assert.equal(store.getMessageCount(), 0);
});

test("releases an idle session as soon as the view goes away", async () => {
  const { store } = harness();
  await store.start();
  // 注意别在这里发 `message.started` —— 它自己就会把会话标成"在跑"(`isRunning: true`),
  // 于是走的是上面那条"等跑完再释放"的路。空闲这件事只能用"没有任何运行事件"来表达。
  assert.equal(store.getMetadataSnapshot().isRunning, false);
  assert.ok(store.getMessageCount() > 0);

  // 没有在跑的东西就直接释放,不必等到某个事件到来。
  store.release();
  assert.equal(store.getMessageCount(), 0);
});

test("drops a page that arrives after the view was released and reopened", async () => {
  // 卸载瞬间在途的分页请求,可能在重新打开并把新投影装好之后才回来。它属于**上一份**投影,
  // 混进去就是两份历史拼在一起。
  let releasePage: ((page: SessionHistoryPage) => void) | null = null;
  const withMore = {
    ...view(),
    history: { ...view().history, hasMoreBefore: true, nextBeforeCursor: "0" },
  };
  const { store } = harness({
    getSessionHistoryPage: async () =>
      await new Promise<SessionHistoryPage>((resolve) => {
        releasePage = resolve;
      }),
    getSessionView: async () => withMore,
  });
  await store.start();
  const before = store.getMessageCount();

  const pending = store.loadOlder();
  await Promise.resolve();
  store.release();
  await store.start();
  assert.equal(store.getMessageCount(), before);

  releasePage?.({
    hasMoreAfter: false,
    hasMoreBefore: false,
    items: [{
      type: "turn",
      turn: {
        anchorMessageId: "older",
        id: "turn:older",
        messages: [message("older", "user", "更早的一句")],
        timestamp: 0,
      },
    }],
    revision: "0",
  });
  assert.equal(await pending, 0, "这一页该被丢掉");
  assert.equal(store.getMessageCount(), before, "旧页不能混进新投影");
});

test("never evicts a cached store that still has subscribers", async () => {
  // 有订阅 = 要么正被挂载的视图用着(ThreadView 的 effect 只依赖 store 实例,不会重跑),
  // 要么正在跑一轮。被淘汰的 store 会 `dispose()` —— 那两种情况都无法自愈。
  const { listeners, frames, client } = registryHarness();
  const live = getThreadSessionStore(client, "session-live", (key) => key, frames);
  await live.start();

  for (let index = 0; index < 40; index += 1)
    getThreadSessionStore(client, `session-${index}`, (key) => key, frames);

  // 视图卸载,再打开:必须还能重新水合(被淘汰过的 store 会直接早退,永远空着)。
  live.suspend();
  await live.start();
  assert.ok(live.getMessageCount() > 0, "有订阅的 store 不该被淘汰");
  assert.equal(listeners.size > 0, true);
  disposeThreadSessionStores(client);
});

test("evicts an idle store once newer sessions take the slots", async () => {
  const { frames, client } = registryHarness();
  const idle = getThreadSessionStore(client, "session-idle", (key) => key, frames);
  await idle.start();
  idle.suspend();

  for (let index = 0; index < 40; index += 1)
    getThreadSessionStore(client, `session-${index}`, (key) => key, frames);

  // 没人订阅的旧 store 该让位 —— 否则缓存会一直涨到退出。
  await idle.start();
  assert.equal(idle.getMessageCount(), 0);
  disposeThreadSessionStores(client);
});

test("releases a hidden session projection and hydrates it when reopened", async () => {
  const listeners = new Set<(event: RuntimeEventEnvelope) => void>();
  const client = {
    getSessionSnapshot: async () => fullSnapshot(),
    getSessionView: async () => view(),
    subscribe: (listener: (event: RuntimeEventEnvelope) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RuntimeClient;
  const frames = new TestFrames();
  const emit = (event: RuntimeEventEnvelope) => {
    for (const listener of listeners) listener(event);
  };
  const storeA = getThreadSessionStore(client, "session-a", (key) => key, frames);
  await storeA.start();
  emit({ ...envelope(1, {
    type: "message.started",
    message: { ...message("streaming-assistant", "assistant", ""), status: "streaming" },
  }), sessionId: "session-a" });
  emit({ ...envelope(2, { type: "message.text.delta", messageId: "streaming-assistant", delta: "before switch" }), sessionId: "session-a" });
  frames.flush();

  const storeB = getThreadSessionStore(client, "session-b", (key) => key, frames);
  await storeB.start();
  storeA.suspend();
  emit({ ...envelope(3, { type: "message.text.delta", messageId: "streaming-assistant", delta: " and after switch" }), sessionId: "session-a" });
  frames.flush();

  assert.equal(storeA.getMessageCount(), 0);
  await storeA.start();
  assert.equal(storeA.getMessage("assistant")?.id, "assistant");
  storeA.dispose();
  storeB.dispose();
});

test("suspending an active store cancels hydration from the old view", async () => {
  let resolveView: ((value: SessionViewSnapshot) => void) | undefined;
  const { store } = harness({
    getSessionView: () => new Promise<SessionViewSnapshot>((resolve) => {
      resolveView = resolve;
    }),
  });
  const loading = store.start();
  store.suspend();
  resolveView?.(view());
  await loading;
  assert.equal(store.getMessageCount(), 0);
  store.dispose();
});

test("marks a real gap and recovers atomically only after idle", async () => {
  const { emit, store } = harness();
  await store.start();
  emit(envelope(1, { type: "run.started", runId: "run" }));
  emit(envelope(3, { type: "message.text.delta", messageId: "assistant", delta: "live" }));
  assert.equal(store.getMetadataSnapshot().needsRehydrate, true);
  assert.notEqual((store.getRowSnapshot("assistant:turn:user").messages[0]?.blocks[0] as { text: string }).text, "recovered");
  emit(envelope(4, { type: "session.idle" }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.getMetadataSnapshot().needsRehydrate, false);
  assert.equal((store.getRowSnapshot("assistant:turn:user").messages[0]?.blocks[0] as { text: string }).text, "recovered");
  store.dispose();
});

test("updates approval, user request, and expert task blocks through their indexes", async () => {
  const { emit, store } = harness();
  await store.start();
  emit(envelope(1, { type: "tool.started", messageId: "assistant", callId: "delegate", name: "delegate_task", input: {} }));
  emit(envelope(2, {
    type: "tool.completed",
    messageId: "assistant",
    callId: "delegate",
    output: "queued",
    details: { tasks: [{ id: "task-1", status: "queued" }] },
    isError: false,
  }));
  emit(envelope(3, {
    type: "approval.requested",
    messageId: "assistant",
    approval: {
      approvalId: "approval-1",
      callId: "delegate",
      toolName: "delegate_task",
      input: {},
      risk: "high",
      severity: "high",
      summary: "Approve",
      preview: { kind: "command", command: "test" },
      matchedRules: [],
    } as never,
  }));
  emit(envelope(4, {
    type: "approval.resolved",
    messageId: "assistant",
    resolution: { approvalId: "approval-1", approved: true },
  }));
  assert.equal(store.getTool("delegate")?.approval?.status, "approved");

  emit(envelope(5, {
    type: "user-request.requested",
    messageId: "assistant",
    request: {
      requestId: "request-1",
      callId: "delegate",
      toolName: "delegate_task",
      title: "Choose",
      fields: [],
    },
  }));
  emit(envelope(6, {
    type: "user-request.resolved",
    messageId: "assistant",
    resolution: { requestId: "request-1", status: "submitted", answers: {} },
  }));
  assert.equal(store.getTool("delegate")?.userRequest?.resolution?.status, "submitted");

  emit(envelope(7, {
    type: "extension.event",
    event: {
      extensionId: "wordless.expert-team",
      type: "state.changed",
      payload: {
        extensionId: "wordless.expert-team",
        updatedAt: 7,
        state: { taskRuns: { "task-1": { status: "running" } } },
      },
    },
  }));
  const tasks = (store.getTool("delegate")?.details as { tasks: Array<{ id: string; status: string }> }).tasks;
  assert.equal(tasks[0]?.status, "running");
  store.dispose();
});

test("coalesces streamed tool output into one row publication per frame", async () => {
  const { emit, frames, store } = harness();
  await store.start();
  emit(envelope(1, { type: "tool.started", messageId: "assistant", callId: "stream", name: "bash", input: {} }));
  let rowNotifications = 0;
  store.subscribeRow("assistant:turn:user", () => { rowNotifications += 1; });
  for (let sequence = 2; sequence <= 1_001; sequence += 1)
    emit(envelope(sequence, { type: "tool.updated", messageId: "assistant", callId: "stream", output: "x" }));
  frames.flush();
  assert.equal(rowNotifications, 1);
  assert.equal(store.getTool("stream")?.output?.length, 1_000);
  store.dispose();
});

test("keeps aggregate selectors stable outside their own mutation domain", async () => {
  const { emit, store } = harness();
  await store.start();
  const messages = store.getMessages();
  const users = store.getUserMessages();
  const delegates = store.getToolsByName("delegate_expert");
  store.patchToolApprovalMode("auto");
  assert.equal(store.getMessages(), messages);
  assert.equal(store.getUserMessages(), users);
  assert.equal(store.getToolsByName("delegate_expert"), delegates);

  emit(envelope(1, { type: "tool.started", messageId: "assistant", callId: "delegate", name: "delegate_expert", input: {} }));
  assert.notEqual(store.getMessages(), messages);
  assert.equal(store.getUserMessages(), users);
  assert.notEqual(store.getToolsByName("delegate_expert"), delegates);
  assert.equal(store.getToolsByName("delegate_expert").length, 1);
  store.dispose();
});

test("deduplicates event ids within one runtime instance", async () => {
  const { emit, frames, store } = harness();
  await store.start();
  const duplicate = envelope(1, { type: "message.text.delta", messageId: "assistant", delta: "once" });
  emit(duplicate);
  emit(duplicate);
  frames.flush();
  assert.equal((store.getMessage("assistant")?.blocks[0] as { text: string }).text, "once");
  store.dispose();
});

test("runtime instance changes cancel old deltas and reset event-id deduplication", async () => {
  let resolveRestart!: (value: SessionViewSnapshot) => void;
  let viewCalls = 0;
  const restartView = new Promise<SessionViewSnapshot>((resolve) => { resolveRestart = resolve; });
  const { emit, frames, store } = harness({
    getSessionView: async () => ++viewCalls === 1 ? view() : restartView,
  });
  await store.start();
  emit(envelope(1, { type: "message.text.delta", messageId: "assistant", delta: "discarded" }));
  emit({
    ...envelope(1, { type: "message.text.delta", messageId: "assistant", delta: "new" }),
    runtimeInstanceId: "runtime-2",
  });
  resolveRestart(view());
  await new Promise<void>((resolve) => setImmediate(resolve));
  frames.flush();
  assert.equal((store.getMessage("assistant")?.blocks[0] as { text: string }).text, "new");
  store.dispose();
});

test("a new run invalidates an in-flight idle recovery", async () => {
  let resolveSnapshot!: (value: SessionSnapshot) => void;
  let resolveRecoveryView!: (value: SessionViewSnapshot) => void;
  let viewCalls = 0;
  const recoverySnapshot = new Promise<SessionSnapshot>((resolve) => { resolveSnapshot = resolve; });
  const recoveryView = new Promise<SessionViewSnapshot>((resolve) => { resolveRecoveryView = resolve; });
  const { emit, store } = harness({
    getSessionSnapshot: async () => recoverySnapshot,
    getSessionView: async () => ++viewCalls === 1 ? view() : recoveryView,
  });
  await store.start();
  emit(envelope(1, { type: "run.started", runId: "run" }));
  emit(envelope(3, { type: "message.text.delta", messageId: "assistant", delta: "live" }));
  emit(envelope(4, { type: "session.idle" }));
  emit({
    ...envelope(1, { type: "run.started", runId: "run-2" }),
    eventId: "run-2-event-1",
    runId: "run-2",
  });
  resolveSnapshot(fullSnapshot());
  resolveRecoveryView(view());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.getMetadataSnapshot().isRunning, true);
  assert.equal(store.getMetadataSnapshot().needsRehydrate, true);
  assert.notEqual((store.getMessage("assistant")?.blocks[0] as { text: string }).text, "recovered");
  store.dispose();
});

test("around-page and compaction merges retain newer live message content", async () => {
  const aroundPage = {
    hasMoreAfter: false,
    hasMoreBefore: false,
    items: [
      {
        type: "turn" as const,
        turn: {
          anchorMessageId: "user",
          id: "turn:user",
          messages: [message("user", "user", "prompt"), message("assistant", "assistant", "stale")],
          timestamp: 1,
        },
      },
      {
        type: "compaction" as const,
        compaction: { id: "compaction-1", summary: "summary", timestamp: 5, trigger: "automatic" as const },
      },
      {
        type: "turn" as const,
        turn: {
          anchorMessageId: "target-user",
          id: "target",
          messages: [message("target-user", "user", "target"), message("target-assistant", "assistant", "answer")],
          timestamp: 10,
        },
      },
    ],
    revision: "around",
  };
  const { emit, frames, store } = harness({
    getSessionHistoryPage: async () => aroundPage,
  });
  await store.start();
  emit(envelope(1, { type: "message.text.delta", messageId: "assistant", delta: "live" }));
  frames.flush();
  await store.ensureTurnLoaded("target");
  assert.equal((store.getMessage("assistant")?.blocks[0] as { text: string }).text, "live");
  assert.ok(store.getTimelineSnapshot().items.some((item) => item.key === "compaction:compaction-1"));
  assert.ok(store.getTimelineSnapshot().items.some((item) => item.key === "assistant:target"));
  store.dispose();
});

function emptyView(): SessionViewSnapshot {
  return {
    extensions: [],
    history: {
      hasMoreAfter: false,
      hasMoreBefore: false,
      items: [],
      revision: "0",
    },
    isCompacting: false,
    isRunning: false,
    session: { id: "session" } as SessionViewSnapshot["session"],
    toolApprovalMode: "manual",
    turnSummaries: [],
  };
}

function pendingTurn(id: string, text: string, submittedAt: number) {
  return {
    submission: { messageId: id, submittedAt },
    message: { ...message(id, "user", text), timestamp: submittedAt },
  };
}

test("creates turn summaries from live user messages without a pending turn", async () => {
  const { emit, store } = harness({ getSessionView: async () => emptyView() });
  await store.start();
  emit({
    ...envelope(1, { type: "message.started", message: message("user-1", "user", "First request") }),
    turnId: "turn:user-1",
  });
  emit({
    ...envelope(2, { type: "message.started", message: message("user-2", "user", "Second request") }),
    turnId: "turn:user-2",
  });
  assert.equal(store.getHistorySnapshot().turnSummaries.length, 2);
  assert.deepEqual(store.getHistorySnapshot().turnSummaries.map((item) => item.turnId), ["turn:user-1", "turn:user-2"]);
  store.dispose();
});

test("appends live turn summaries so the density rail can appear without reopening", async () => {
  const { store } = harness({ getSessionView: async () => emptyView() });
  await store.start();
  assert.equal(store.getHistorySnapshot().turnSummaries.length, 0);

  store.addPendingTurn(pendingTurn("user-1", "First request", 10));
  assert.equal(store.getHistorySnapshot().turnSummaries.length, 1);
  assert.equal(store.getHistorySnapshot().turnSummaries[0]?.turnId, "turn:user-1");
  assert.equal(store.getHistorySnapshot().turnSummaries[0]?.excerpt, "First request");

  store.addPendingTurn(pendingTurn("user-2", "Second request", 20));
  assert.equal(store.getHistorySnapshot().turnSummaries.length, 2);
  assert.deepEqual(store.getHistorySnapshot().turnSummaries.map((item) => item.turnId), ["turn:user-1", "turn:user-2"]);
  store.dispose();
});

test("patches turn summary tokens on completion without duplicating the turn", async () => {
  const { emit, store } = harness({ getSessionView: async () => emptyView() });
  await store.start();
  store.addPendingTurn(pendingTurn("user-1", "First request", 10));
  emit({
    ...envelope(1, {
      type: "message.started",
      message: { ...message("assistant-1", "assistant", ""), status: "streaming" },
    }),
    turnId: "turn:user-1",
  });
  emit({
    ...envelope(2, {
      type: "message.completed",
      message: {
        ...message("assistant-1", "assistant", "done"),
        status: "complete",
        usage: { inputTokens: 5, outputTokens: 4_000, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 4_005, totalCost: 0 },
      },
    }),
    turnId: "turn:user-1",
  });

  assert.equal(store.getHistorySnapshot().turnSummaries.length, 1);
  assert.ok((store.getHistorySnapshot().turnSummaries[0]?.tokens ?? 0) >= 4_000);
  store.dispose();
});

test("updates context usage from a live runtime event", async () => {
  const { emit, store } = harness();
  await store.start();
  emit(envelope(1, {
    type: "context.usage.updated",
    contextUsage: {
      categories: { systemPrompt: 100, toolsAndSubagents: 200, conversation: 300, connectors: 0, skills: 0 },
      contextWindow: 10_000,
      source: "provider",
      usedTokens: 600,
    },
  }));

  assert.equal(store.getMetadataSnapshot().contextUsage?.usedTokens, 600);
  assert.equal(store.getMetadataSnapshot().contextUsage?.source, "provider");
  store.dispose();
});

test("drops a pending turn summary when the prompt fails", async () => {
  const { store } = harness({ getSessionView: async () => emptyView() });
  await store.start();
  store.addPendingTurn(pendingTurn("user-1", "First request", 10));
  store.addPendingTurn(pendingTurn("user-2", "Second request", 20));
  store.removePendingTurn("user-2");
  assert.equal(store.getHistorySnapshot().turnSummaries.length, 1);
  assert.equal(store.getHistorySnapshot().turnSummaries[0]?.turnId, "turn:user-1");
  store.dispose();
});

test("keeps server turn summaries for unloaded history and appends a live pending turn", async () => {
  const turnSummaries = Array.from({ length: 10 }, (_, ordinal) => ({
    excerpt: `Turn ${ordinal}`,
    messageId: `user-${ordinal}`,
    ordinal,
    timestamp: ordinal,
    tokens: 12,
    turnId: `turn:user-${ordinal}`,
  }));
  const historical = view();
  historical.turnSummaries = turnSummaries;
  const loaded = historical.history.items[0];
  if (loaded?.type === "turn") {
    loaded.turn.id = "turn:user-9";
    loaded.turn.anchorMessageId = "user-9";
    loaded.turn.messages = [message("user-9", "user", "prompt"), message("assistant-9", "assistant", "")];
  }
  const { store } = harness({ getSessionView: async () => historical });
  await store.start();
  assert.equal(store.getHistorySnapshot().turnSummaries.length, 10);
  assert.equal(store.getHistorySnapshot().turnSummaries[0]?.turnId, "turn:user-0");

  store.addPendingTurn(pendingTurn("live-user", "Follow up", 100));
  assert.equal(store.getHistorySnapshot().turnSummaries.length, 11);
  assert.deepEqual(
    store.getHistorySnapshot().turnSummaries.slice(0, 10).map((item) => item.turnId),
    turnSummaries.map((item) => item.turnId),
  );
  assert.equal(store.getHistorySnapshot().turnSummaries[10]?.turnId, "turn:live-user");
  store.dispose();
});
