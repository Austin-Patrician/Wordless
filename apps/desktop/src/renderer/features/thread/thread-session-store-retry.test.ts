import { describe, expect, it } from "vitest";
import type {
  ConversationMessage,
  RuntimeEventEnvelope,
  SessionHistoryPage,
  SessionSnapshot,
  SessionViewSnapshot,
} from "@wordless/protocol";
import type { RuntimeClient } from "../../bridge/runtime-client.ts";
import { ThreadSessionStore } from "./thread-session-store.ts";
import { shouldShowAssistantRunStatus } from "./thread-run-state.ts";
import type { AnimationFrameScheduler } from "./thread-viewport-store.ts";

class TestFrames implements AnimationFrameScheduler {
  private callbacks = new Map<number, FrameRequestCallback>();
  private next = 1;
  cancel = (handle: number) => {
    this.callbacks.delete(handle);
  };
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

function user(id: string, timestamp = 1): ConversationMessage {
  return {
    blocks: [{ type: "text", text: id }],
    id,
    model: null,
    role: "user",
    status: "complete",
    timestamp,
  };
}

function assistant(id: string, timestamp = 2, text = "answer"): ConversationMessage {
  return {
    blocks: [{ type: "text", text }],
    id,
    model: null,
    role: "assistant",
    status: "complete",
    timestamp,
  };
}

function turnView(
  versions: { active: number; total: number } | undefined,
  assistantMessage: ConversationMessage = assistant("assistant-1"),
): SessionViewSnapshot {
  const page: SessionHistoryPage = {
    hasMoreAfter: false,
    hasMoreBefore: false,
    items: [
      {
        type: "turn",
        turn: {
          anchorMessageId: "user-1",
          id: "turn:user-1",
          messages: [user("user-1"), assistantMessage],
          timestamp: 1,
          ...(versions ? { versions } : {}),
        },
      },
    ],
    revision: "1:1",
  };
  return {
    extensions: [],
    history: page,
    isCompacting: false,
    isRunning: false,
    session: { id: "session" } as SessionViewSnapshot["session"],
    toolApprovalMode: "manual",
    turnSummaries: [],
  };
}

function snapshot(messages: ConversationMessage[]): SessionSnapshot {
  return {
    contextCompactions: [],
    extensions: [],
    isCompacting: false,
    isRunning: false,
    messages,
    session: { id: "session" } as SessionSnapshot["session"],
    toolApprovalMode: "manual",
  };
}

function harness(options: {
  snapshot: SessionSnapshot;
  view: SessionViewSnapshot;
}) {
  const client = {
    getSessionSnapshot: async () => options.snapshot,
    getSessionView: async () => options.view,
  } as unknown as RuntimeClient;
  let listener: ((event: RuntimeEventEnvelope) => void) | undefined;
  const store = new ThreadSessionStore(
    client,
    "session",
    (key) => key,
    new TestFrames(),
    (next) => {
      listener = next;
      return () => {};
    },
  );
  return {
    store,
    /** Delivers a runtime event through the store's subscription, as Runtime does. */
    emit: (event: RuntimeEventEnvelope) => listener?.(event),
  };
}

const envelope = (
  event: RuntimeEventEnvelope["event"],
  runId?: string,
  sequence = 1,
): RuntimeEventEnvelope => ({
  event,
  eventId: `event-${Math.random()}`,
  protocolVersion: 1 as RuntimeEventEnvelope["protocolVersion"],
  runtimeInstanceId: "runtime",
  ...(runId === undefined ? {} : { runId }),
  // 序号必须**递增**:同一个 (runId, sequence) 会被 store 当成重复事件丢掉。
  sequence,
  sessionId: "session",
  timestamp: 1,
});

it("切走再切回、然后这一轮结束:**不能**把正开着的会话挂起(界面会停在 Loading session)", async () => {
  // 真实踩到:一轮还在跑时切到别的会话(视图卸载 → 记下"跑完就释放"),再切回来
  // (`start()` 因为**已经订阅着**而早退,于是那条撤销被漏掉),等这一轮结束时 store 被挂起,
  // `session` 置空 —— 界面显示 "Loading session",而且不切走就回不来。
  const { store, emit } = harness({
    snapshot: snapshot([user("user-1"), assistant("assistant-1")]),
    view: turnView(undefined),
  });
  await store.start();
  emit(envelope({ type: "run.started", runId: "run-1" }, "run-1"));
  expect(store.getMetadataSnapshot().isRunning).toBe(true);

  // 切走:视图卸载。跑着呢,所以只是记下"跑完就释放"。
  store.release();
  // 切回来:视图重新挂载。**这一句必须把那个标记撤掉**(即使 store 已经装载过)。
  await store.start();

  // 这一轮结束。事件要带**同一个 runId**:不带的话 store 会当成别的运行的事件丢掉,
  // 于是这条用例会变成"什么都没发生也通过"(写这条时真的踩到了)。
  emit(envelope({ type: "session.idle" }, "run-1", 2));
  expect(store.getMetadataSnapshot().isRunning).toBe(false);
  await Promise.resolve();
  await Promise.resolve();
  expect(store.getMetadataSnapshot().session).not.toBeNull();
  store.dispose();
});

it("surfaces retry versions of a turn on the assistant row", async () => {
  const { store } = harness({
    snapshot: snapshot([user("user-1"), assistant("assistant-2")]),
    view: turnView({ active: 2, total: 2 }, assistant("assistant-2")),
  });
  await store.start();
  expect(store.getRowSnapshot("assistant:turn:user-1").versions).toEqual({
    active: 2,
    total: 2,
  });
  store.dispose();
});

it("leaves versions empty for a turn that was never retried", async () => {
  const { store } = harness({
    snapshot: snapshot([user("user-1"), assistant("assistant-1")]),
    view: turnView(undefined),
  });
  await store.start();
  expect(store.getRowSnapshot("assistant:turn:user-1").versions).toBeNull();
  store.dispose();
});

it("replaces the previous version as soon as the retry starts", async () => {
  const { store } = harness({
    snapshot: snapshot([user("user-1"), assistant("assistant-1")]),
    view: turnView(undefined, assistant("assistant-1")),
  });
  await store.start();
  store.beginTurnRetry("turn:user-1");
  const row = store.getRowSnapshot("assistant:turn:user-1");
  // Like a normal pending turn: no response yet, but a run status is shown.
  expect(row.messages).toEqual([]);
  expect(row.presentation?.activity.type).toBe("thinking");
  expect(store.getMessage("assistant-1")).toBeUndefined();
  store.dispose();
});

it("keeps no run status after a retried response settles", async () => {
  const frames = new TestFrames();
  const client = {
    getSessionSnapshot: async () =>
      snapshot([user("user-1"), assistant("assistant-2")]),
    getSessionView: async () =>
      turnView({ active: 2, total: 2 }, assistant("assistant-2")),
  } as unknown as RuntimeClient;
  let listener: ((event: RuntimeEventEnvelope) => void) | undefined;
  const store = new ThreadSessionStore(
    client,
    "session",
    (key) => key,
    frames,
    (next) => {
      listener = next;
      return () => {};
    },
  );
  await store.start();
  const envelope = (
    sequence: number,
    event: RuntimeEventEnvelope["event"],
  ): RuntimeEventEnvelope => ({
    event,
    eventId: `event-${sequence}`,
    protocolVersion: 1,
    runId: "run-retry",
    runtimeInstanceId: "runtime",
    sequence,
    sessionId: "session",
    timestamp: sequence,
    turnId: "turn:user-1",
  });

  store.beginTurnRetry("turn:user-1");
  listener?.(envelope(1, { runId: "run-retry", type: "run.started" }));
  listener?.(
    envelope(2, {
      message: { ...assistant("assistant-2", 3, ""), status: "streaming" },
      type: "message.started",
    }),
  );
  listener?.(
    envelope(3, {
      delta: "regenerated answer",
      messageId: "assistant-2",
      type: "message.text.delta",
    }),
  );
  frames.flush();
  // The seeded status advances exactly like a normal turn's.
  expect(
    store.getRowSnapshot("assistant:turn:user-1").presentation?.activity.type,
  ).toBe("generating");
  listener?.(
    envelope(4, {
      message: assistant("assistant-2", 3, "regenerated answer"),
      type: "message.completed",
    }),
  );
  await Promise.resolve();
  listener?.(envelope(5, { type: "session.idle" }));
  const row = store.getRowSnapshot("assistant:turn:user-1");
  expect(
    row.messages.map((message) => message.id),
  ).toEqual(["assistant-2"]);
  expect(shouldShowAssistantRunStatus(row.messages, row.presentation)).toBe(
    false,
  );

  // The reload that follows a settled retry must not resurrect the status.
  await store.reload();
  const reloaded = store.getRowSnapshot("assistant:turn:user-1");
  expect(
    shouldShowAssistantRunStatus(reloaded.messages, reloaded.presentation),
  ).toBe(false);
  store.dispose();
});

it("reload drops the message that left the session branch", async () => {
  const { store } = harness({
    snapshot: snapshot([user("user-1"), assistant("assistant-1")]),
    view: turnView(undefined, assistant("assistant-1")),
  });
  await store.start();
  expect(store.getMessage("assistant-1")?.id).toBe("assistant-1");

  // The retry moved the session branch: only the regenerated response remains.
  const { store: retried } = harness({
    snapshot: snapshot([user("user-1"), assistant("assistant-2")]),
    view: turnView({ active: 2, total: 2 }, assistant("assistant-2")),
  });
  await retried.start();
  await retried.reload();
  const row = retried.getRowSnapshot("assistant:turn:user-1");
  expect(row.messages.map((message) => message.id)).toEqual(["assistant-2"]);
  expect(row.versions).toEqual({ active: 2, total: 2 });
  retried.dispose();
  store.dispose();
});
