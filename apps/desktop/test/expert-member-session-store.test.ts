import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationMessage,
  RuntimeEventEnvelope,
  SessionHistoryPage,
} from "@wordless/protocol";
import type { RuntimeClient } from "../src/renderer/bridge/runtime-client.ts";
import { ExpertMemberSessionStore } from "../src/renderer/features/thread/expert-member-session-store.ts";
import type { AnimationFrameScheduler } from "../src/renderer/features/thread/thread-viewport-store.ts";

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

function assistant(id: string, timestamp = 2): ConversationMessage {
  return { blocks: [], id, model: null, role: "assistant", status: "streaming", timestamp };
}

function page(
  id: string,
  timestamp: number,
  options: { hasMoreBefore?: boolean; nextBeforeCursor?: string } = {},
): SessionHistoryPage {
  return {
    hasMoreAfter: false,
    hasMoreBefore: options.hasMoreBefore ?? false,
    items: [{
      type: "turn",
      turn: {
        anchorMessageId: `${id}-user`,
        id,
        messages: [
          { blocks: [{ type: "text", text: id }], id: `${id}-user`, model: null, role: "user", status: "complete", timestamp },
          { ...assistant(`${id}-assistant`, timestamp + 1), status: "complete" },
        ],
        timestamp,
      },
    }],
    nextBeforeCursor: options.nextBeforeCursor,
    revision: id,
  };
}

function envelope(sequence: number, event: RuntimeEventEnvelope["event"]): RuntimeEventEnvelope {
  return {
    event,
    eventId: `member-event-${sequence}`,
    protocolVersion: 1,
    runId: "run",
    runtimeInstanceId: "runtime",
    sequence,
    sessionId: "session",
    timestamp: sequence,
    turnId: "turn:user",
  };
}

function harness(historyPages: SessionHistoryPage[] = [{ ...page("empty", 1), items: [] }]) {
  let historyCall = 0;
  const client = {
    getExpertMemberHistory: async () => historyPages[Math.min(historyCall++, historyPages.length - 1)]!,
    getExpertMemberLiveState: async () => null,
    getExpertMemberToolOutput: async () => "full output",
  } as unknown as RuntimeClient;
  const frames = new TestFrames();
  const store = new ExpertMemberSessionStore(client, "session", "writer", 1, frames);
  return { frames, store };
}

test("batches member deltas into one immutable row update per frame", async () => {
  const { frames, store } = harness();
  await store.start();
  store.acceptEnvelope(envelope(1, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: assistant("member-message"),
    revision: 1,
  }));
  const timeline = store.getTimelineSnapshot();
  const key = timeline.items[0]!.key;
  let notifications = 0;
  let tailGrowthNotifications = 0;
  store.subscribeRow(key, () => { notifications += 1; });
  store.subscribeTailGrowth(() => { tailGrowthNotifications += 1; });
  store.acceptEnvelope(envelope(2, { type: "expert-member.message.text.delta", memberId: "writer", taskId: "task", messageId: "member-message", delta: "a", revision: 2 }));
  store.acceptEnvelope(envelope(3, { type: "expert-member.message.text.delta", memberId: "writer", taskId: "task", messageId: "member-message", delta: "b", revision: 3 }));
  frames.flush();
  assert.equal(store.getTimelineSnapshot(), timeline);
  assert.equal(notifications, 1);
  assert.equal(tailGrowthNotifications, 1);
  assert.equal((store.getRowSnapshot(key).messages[0]!.blocks[0] as { text: string }).text, "ab");
  store.acceptEnvelope(envelope(4, { type: "expert-member.message.text.delta", memberId: "writer", taskId: "task", messageId: "member-message", delta: "stale", revision: 2 }));
  frames.flush();
  assert.equal((store.getRowSnapshot(key).messages[0]!.blocks[0] as { text: string }).text, "ab");
  store.dispose();
});

test("keeps the tool name and indexed output across member tool completion", async () => {
  const { store } = harness();
  await store.start();
  store.acceptEnvelope(envelope(1, { type: "expert-member.message.started", memberId: "writer", taskId: "task", message: assistant("member-message"), revision: 1 }));
  store.acceptEnvelope(envelope(2, { type: "expert-member.tool.started", memberId: "writer", taskId: "task", messageId: "member-message", callId: "call", name: "web_search", input: {} }));
  store.acceptEnvelope(envelope(3, { type: "expert-member.tool.completed", memberId: "writer", taskId: "task", messageId: "member-message", callId: "call", output: "preview", isError: false }));
  assert.equal(store.getMetadataSnapshot().activity.type, "tool-result");
  if (store.getMetadataSnapshot().activity.type === "tool-result")
    assert.equal(store.getMetadataSnapshot().activity.tool, "search");
  await store.loadToolOutput("call");
  const row = store.getRowSnapshot(store.getTimelineSnapshot().items[0]!.key);
  const tool = row.messages[0]!.blocks.find((block) => block.type === "tool");
  assert.equal(tool?.output, "full output");
  assert.equal(tool?.outputTruncated, false);
  store.dispose();
});

test("routes tool events to the task row when the event message id is not mapped", async () => {
  const { frames, store } = harness();
  await store.start();
  store.acceptEnvelope(envelope(1, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: assistant("live-message"),
    revision: 1,
  }));
  store.acceptEnvelope(envelope(2, {
    type: "expert-member.tool.started",
    memberId: "writer",
    taskId: "task",
    messageId: "driver-message-id-not-mapped",
    callId: "call",
    name: "bash",
    input: { command: "echo ok" },
  }));
  store.acceptEnvelope(envelope(3, {
    type: "expert-member.tool.updated",
    memberId: "writer",
    taskId: "task",
    messageId: "driver-message-id-not-mapped",
    callId: "call",
    output: "ok",
  }));
  store.acceptEnvelope(envelope(4, {
    type: "expert-member.tool.completed",
    memberId: "writer",
    taskId: "task",
    messageId: "driver-message-id-not-mapped",
    callId: "call",
    output: "ok",
    isError: false,
  }));
  frames.flush();
  const row = store.getRowSnapshot("assistant:member:task");
  assert.equal(store.getTimelineSnapshot().items.filter((item) => item.key.includes("unknown")).length, 0);
  assert.equal(row.messages.length, 1);
  const tool = row.messages[0]!.blocks.find((block) => block.type === "tool");
  assert.equal(tool?.state, "complete");
  assert.equal(tool?.output, "ok");
  store.dispose();
});

test("history refresh cannot downgrade a completed live tool", async () => {
  const empty = { ...page("empty", 1), items: [] };
  const stale: SessionHistoryPage = {
    hasMoreAfter: false,
    hasMoreBefore: false,
    revision: "stale",
    items: [{
      type: "turn",
      turn: {
        id: "turn:task",
        anchorMessageId: "task",
        timestamp: 1,
        messages: [
          { blocks: [{ type: "text", text: "work" }], id: "task", model: null, role: "user", status: "complete", timestamp: 1 },
          {
            ...assistant("journal-message"),
            status: "complete",
            blocks: [{ type: "tool", callId: "call", name: "bash", input: { command: "echo ok" }, state: "pending" }],
          },
        ],
      },
    }],
  };
  const { store } = harness([empty, stale]);
  await store.start();
  store.acceptEnvelope(envelope(1, {
    type: "expert-member.message.completed",
    memberId: "writer",
    taskId: "task",
    message: {
      ...assistant("live-message"),
      status: "complete",
      blocks: [{ type: "tool", callId: "call", name: "bash", input: { command: "echo ok" }, output: "ok", state: "complete" }],
    },
    revision: 1,
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const row = store.getRowSnapshot("assistant:member:task");
  const tool = row.messages[0]!.blocks.find((block) => block.type === "tool");
  assert.equal(tool?.state, "complete");
  assert.equal(tool?.output, "ok");
  store.dispose();
});

test("groups all assistant messages from one delegated task into one turn row", async () => {
  const { frames, store } = harness();
  await store.start();
  store.acceptEnvelope(envelope(1, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: assistant("first-message"),
    revision: 1,
  }));
  store.acceptEnvelope(envelope(2, {
    type: "expert-member.message.text.delta",
    memberId: "writer",
    taskId: "task",
    messageId: "first-message",
    delta: "first",
    revision: 2,
  }));
  frames.flush();
  store.acceptEnvelope(envelope(3, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: assistant("second-message", 3),
    revision: 3,
  }));
  store.acceptEnvelope(envelope(4, {
    type: "expert-member.message.text.delta",
    memberId: "writer",
    taskId: "task",
    messageId: "second-message",
    delta: "second",
    revision: 4,
  }));
  frames.flush();

  const timeline = store.getTimelineSnapshot();
  assert.equal(timeline.items.filter((item) => item.type === "assistant").length, 1);
  const row = store.getRowSnapshot(timeline.items[0]!.key);
  assert.deepEqual(row.messages.map((message) => message.id), ["first-message", "second-message"]);
  assert.deepEqual(
    row.messages.map((message) => (message.blocks[0] as { text: string }).text),
    ["first", "second"],
  );
  store.dispose();
});

test("reconciles live and persisted member messages by task turn", async () => {
  const empty = { ...page("empty", 1), items: [] };
  const persisted: SessionHistoryPage = {
    hasMoreAfter: false,
    hasMoreBefore: false,
    items: [{
      type: "turn",
      turn: {
        id: "turn:task",
        anchorMessageId: "task",
        timestamp: 1,
        messages: [
          { blocks: [{ type: "text", text: "Perform the delegated work." }], id: "task", model: null, role: "user", status: "complete", timestamp: 1 },
          { ...assistant("journal-entry-id", 2), blocks: [{ type: "text", text: "final answer" }], status: "complete" },
        ],
      },
    }],
    revision: "persisted",
  };
  const { store } = harness([empty, persisted]);
  await store.start();
  store.acceptEnvelope(envelope(1, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: assistant("ephemeral-driver-id"),
    revision: 1,
  }));
  store.acceptEnvelope(envelope(2, {
    type: "expert-member.message.completed",
    memberId: "writer",
    taskId: "task",
    message: { ...assistant("ephemeral-driver-id"), blocks: [{ type: "text", text: "final answer" }], status: "complete" },
    revision: 2,
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  const timeline = store.getTimelineSnapshot();
  assert.deepEqual(timeline.items.map((item) => item.key), ["user:turn:task", "assistant:member:task"]);
  const row = store.getRowSnapshot("assistant:member:task");
  assert.deepEqual(row.messages.map((message) => message.id), ["ephemeral-driver-id"]);
  assert.equal(row.messages[0]?.blocks[0]?.type, "text");
  assert.equal((row.messages[0]?.blocks[0] as { text: string }).text, "final answer");
  store.dispose();
});

test("keeps the lead task before a live member response after history reconciliation", async () => {
  const empty = { ...page("empty", 1), items: [] };
  const persisted: SessionHistoryPage = {
    hasMoreAfter: false,
    hasMoreBefore: false,
    items: [{
      type: "turn",
      turn: {
        id: "turn:task",
        anchorMessageId: "task",
        timestamp: 2,
        messages: [
          { blocks: [{ type: "text", text: "Lead task" }], id: "task", model: null, role: "user", status: "complete", timestamp: 2 },
          { ...assistant("journal-entry-id", 2), blocks: [{ type: "text", text: "Member response" }], status: "complete" },
        ],
      },
    }],
    revision: "persisted",
  };
  const { store } = harness([empty, persisted]);
  await store.start();
  store.acceptEnvelope(envelope(1, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: assistant("ephemeral-driver-id", 2),
    revision: 1,
  }));
  store.acceptEnvelope(envelope(2, {
    type: "expert-member.message.completed",
    memberId: "writer",
    taskId: "task",
    message: { ...assistant("ephemeral-driver-id", 2), blocks: [{ type: "text", text: "Member response" }], status: "complete" },
    revision: 2,
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  const timeline = store.getTimelineSnapshot();
  assert.deepEqual(timeline.items.map((item) => item.key), ["user:turn:task", "assistant:member:task"]);
  assert.equal(timeline.items[0]?.type, "user");
  assert.equal(timeline.items[1]?.type, "assistant");
  store.dispose();
});

test("coalesces member tool output into one immutable row update per frame", async () => {
  const { frames, store } = harness();
  await store.start();
  store.acceptEnvelope(envelope(1, { type: "expert-member.message.started", memberId: "writer", taskId: "task", message: assistant("member-message"), revision: 1 }));
  store.acceptEnvelope(envelope(2, { type: "expert-member.tool.started", memberId: "writer", taskId: "task", messageId: "member-message", callId: "call", name: "bash", input: {} }));
  const key = store.getTimelineSnapshot().items[0]!.key;
  let notifications = 0;
  store.subscribeRow(key, () => { notifications += 1; });
  for (let sequence = 3; sequence <= 1_002; sequence += 1)
    store.acceptEnvelope(envelope(sequence, { type: "expert-member.tool.updated", memberId: "writer", taskId: "task", messageId: "member-message", callId: "call", output: "x" }));
  frames.flush();
  assert.equal(notifications, 1);
  const tool = store.getRowSnapshot(key).messages[0]!.blocks.find((block) => block.type === "tool");
  assert.equal(tool?.output?.length, 1_000);
  store.dispose();
});

test("prepends older member history while preserving chronological descriptors", async () => {
  const latest = page("latest", 20, { hasMoreBefore: true, nextBeforeCursor: "older" });
  const older = page("older", 10);
  const { store } = harness([latest, older]);
  await store.start();
  await store.loadOlder();
  assert.deepEqual(
    store.getTimelineSnapshot().items.map((item) => item.key),
    ["user:older", "assistant:older", "user:latest", "assistant:latest"],
  );
  store.dispose();
});

test("a persisted refresh cannot replace a newer completed live member message", async () => {
  const empty = { ...page("empty", 1), items: [] };
  const stale: SessionHistoryPage = {
    hasMoreAfter: false,
    hasMoreBefore: false,
    items: [{
      type: "turn",
      turn: {
        anchorMessageId: "lead",
        id: "task",
        messages: [
          { blocks: [{ type: "text", text: "delegated" }], id: "lead", model: null, role: "user", status: "complete", timestamp: 1 },
          { blocks: [{ type: "text", text: "stale" }], id: "member-message", model: null, role: "assistant", status: "complete", timestamp: 2 },
        ],
        timestamp: 1,
      },
    }],
    revision: "stale",
  };
  const { store } = harness([empty, stale]);
  await store.start();
  store.acceptEnvelope(envelope(1, {
    type: "expert-member.message.started",
    memberId: "writer",
    taskId: "task",
    message: assistant("member-message"),
    revision: 1,
  }));
  store.acceptEnvelope(envelope(2, {
    type: "expert-member.message.completed",
    memberId: "writer",
    taskId: "task",
    message: { ...assistant("member-message"), blocks: [{ type: "text", text: "live final" }], status: "complete" },
    revision: 2,
  }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const assistantRow = store.getTimelineSnapshot().items.find((item) => item.type === "assistant");
  assert.ok(assistantRow);
  const text = store.getRowSnapshot(assistantRow.key).messages
    .flatMap((item) => item.blocks)
    .find((block) => block.type === "text");
  assert.equal(text?.text, "live final");
  store.dispose();
});
