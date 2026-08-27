import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, RuntimeEventEnvelope } from "@wordless/protocol";
import { advanceAssistantRunPresentation, assistantRunActivityAt, assistantRunPresentationFromMessages, assistantToolActivity, createAssistantRunPresentation, isExpertMemberMessageEvent, isNewerRunEvent, mergeCompletedAssistantMessage, MODEL_RESPONSE_WAIT_DELAY_MS, runEventCursor, shouldRefreshSnapshotAfterEvent, shouldShowAssistantResponseError, shouldShowAssistantRunStatus } from "../src/renderer/features/thread/thread-run-state.ts";

function event(sequence: number, runId: string, payload: RuntimeEventEnvelope["event"]): RuntimeEventEnvelope {
  return { event: payload, eventId: `event-${sequence}`, protocolVersion: 10, runId, runtimeInstanceId: "test", sequence, sessionId: "session-1", timestamp: 1_700_000_000_000 };
}

function assistant(id: string, blocks: ConversationMessage["blocks"]): ConversationMessage {
  return { blocks, id, model: null, role: "assistant", status: "streaming", timestamp: 1_700_000_000_000 };
}

test("starts in thinking and changes to waiting after one second", () => {
  const startedAt = 1_000;
  assert.deepEqual(assistantRunActivityAt({ type: "thinking", since: startedAt }, startedAt), { type: "thinking", since: startedAt });
  assert.deepEqual(assistantRunActivityAt({ type: "thinking", since: startedAt }, startedAt + MODEL_RESPONSE_WAIT_DELAY_MS - 1), { type: "thinking", since: startedAt });
  assert.deepEqual(assistantRunActivityAt({ type: "thinking", since: startedAt }, startedAt + MODEL_RESPONSE_WAIT_DELAY_MS), { type: "waiting", since: startedAt });
});

test("binds a local run presentation to the real assistant message", () => {
  const started = createAssistantRunPresentation("user-1", 1_000);
  const running = advanceAssistantRunPresentation(started, event(1, "run-1", { type: "run.started", runId: "run-1" }));
  const bound = advanceAssistantRunPresentation(running, event(2, "run-1", { type: "message.started", message: assistant("assistant-1", []) }));

  assert.deepEqual(bound, { assistantMessageId: "assistant-1", activity: { type: "thinking", since: 1_700_000_000_000 }, runId: "run-1", startedAt: 1_000, userMessageId: "user-1" });
});

test("shows reconnecting as turn-level activity after the failed message is removed", () => {
  const stableMessage = assistant("assistant-1", [{ type: "text", text: "Completed tool call" }]);
  const reconnecting = {
    ...createAssistantRunPresentation("user-1", 1_000),
    assistantMessageId: "removed-failed-assistant",
    activity: {
      type: "reconnecting" as const,
      retry: {
        attempt: 2,
        maxRetries: 5,
        scheduledAt: 2_000,
        retryAt: 12_000,
        delayMs: 10_000,
        errorMessage: "Connection error.",
        failedMessageId: "removed-failed-assistant",
      },
    },
  };

  assert.equal(shouldShowAssistantRunStatus([stableMessage], reconnecting), true);
  assert.equal(shouldShowAssistantRunStatus([stableMessage], {
    ...reconnecting,
    activity: { type: "thinking", since: 2_000 },
  }), false);
});

test("shows only the terminal assistant error after retries are exhausted", () => {
  const retryError = {
    ...assistant("retry-error", []),
    status: "error" as const,
    errorMessage: "Server requested 120s retry delay (max: 60s). 524 status code (no body)",
  };
  const finalError = {
    ...assistant("final-error", []),
    status: "error" as const,
    errorMessage: "524 status code (no body)",
  };

  assert.equal(shouldShowAssistantResponseError([retryError, finalError], retryError.id), false);
  assert.equal(shouldShowAssistantResponseError([retryError, finalError], finalError.id), true);
  assert.equal(shouldShowAssistantResponseError([
    retryError,
    { ...assistant("success", [{ type: "text", text: "Recovered" }]), status: "complete" },
  ], retryError.id), false);
});

test("tracks response, tool, and user-interaction activity for the current assistant", () => {
  const started = { ...createAssistantRunPresentation("user-1", 1_000), assistantMessageId: "assistant-1", runId: "run-1" };
  const generating = advanceAssistantRunPresentation(started, event(1, "run-1", { type: "message.text.delta", messageId: "assistant-1", delta: "Hello" }));
  assert.deepEqual(generating?.activity, { type: "generating", since: 1_700_000_000_000 });

  const preparingCommand = advanceAssistantRunPresentation(generating, event(2, "run-1", { type: "tool.started", messageId: "assistant-1", callId: "call-1", name: "bash", input: { command: "npm test" } }));
  assert.deepEqual(preparingCommand?.activity, { type: "tool", tool: "command", phase: "preparing", since: 1_700_000_000_000 });

  const awaitingApproval = advanceAssistantRunPresentation(preparingCommand, event(3, "run-1", { type: "approval.requested", messageId: "assistant-1", approval: { approvalId: "approval-1", callId: "call-1", toolName: "bash", risk: "command", severity: "normal", summary: "Run tests", preview: { type: "command", command: "npm test", cwd: ".", timeoutSeconds: undefined }, matchedRules: [] } }));
  assert.deepEqual(awaitingApproval?.activity, { type: "awaiting-approval", since: 1_700_000_000_000 });

  const awaitingInput = advanceAssistantRunPresentation(awaitingApproval, event(4, "run-1", { type: "user-request.requested", messageId: "assistant-1", request: { requestId: "request-1", callId: "call-1", toolName: "request_user_input", title: "Need input", fields: [] } }));
  assert.deepEqual(awaitingInput?.activity, { type: "awaiting-user-input", since: 1_700_000_000_000 });
});

test("keeps tool completion feedback visible until the next assistant activity", () => {
  const started = { ...createAssistantRunPresentation("user-1", 1_000), assistantMessageId: "assistant-1", runId: "run-1" };
  const command = advanceAssistantRunPresentation(started, event(1, "run-1", { type: "tool.started", messageId: "assistant-1", callId: "call-1", name: "bash", input: { command: "npm test" } }));
  const completed = advanceAssistantRunPresentation(command, event(2, "run-1", { type: "tool.completed", messageId: "assistant-1", callId: "call-1", output: "ok", isError: false }));
  assert.deepEqual(completed?.activity, { type: "tool-result", tool: "command", outcome: "success", since: 1_700_000_000_000 });

  const generating = advanceAssistantRunPresentation(completed, event(3, "run-1", { type: "message.text.delta", messageId: "assistant-1", delta: "Done" }));
  assert.deepEqual(generating?.activity, { type: "generating", since: 1_700_000_000_000 });

  const failedCommand = advanceAssistantRunPresentation(generating, event(4, "run-1", { type: "tool.started", messageId: "assistant-1", callId: "call-2", name: "bash", input: { command: "exit 1" } }));
  const failed = advanceAssistantRunPresentation(failedCommand, event(5, "run-1", { type: "tool.completed", messageId: "assistant-1", callId: "call-2", output: "failed", isError: true }));
  assert.deepEqual(failed?.activity, { type: "tool-result", tool: "command", outcome: "failure", since: 1_700_000_000_000 });
});

test("restores an active tool status from a running snapshot", () => {
  const restored = assistantRunPresentationFromMessages([assistant("assistant-1", [{ type: "tool", callId: "call-1", name: "edit", state: "running" }])], 5_000);
  assert.deepEqual(restored, { assistantMessageId: "assistant-1", activity: { type: "tool", tool: "edit", phase: "running", since: 5_000 }, runId: null, startedAt: 5_000, userMessageId: null });
});

test("restores an approval request instead of treating the tool call as complete", () => {
  const restored = assistantRunPresentationFromMessages([assistant("assistant-1", [{
    type: "tool",
    callId: "call-1",
    name: "spreadsheet_edit",
    state: "awaiting-approval",
    approval: {
      approvalId: "approval-1",
      status: "required",
      risk: "file-write",
      severity: "normal",
      summary: "Update workbook",
      preview: { type: "diff", path: "workbook.xlsx", before: "Current workbook", after: "Updated workbook", truncated: false },
      matchedRules: [],
    },
  }])], 5_000);
  assert.deepEqual(restored.activity, { type: "awaiting-approval", since: 5_000 });
});

test("restores the latest completed tool result for an active session", () => {
  const restored = assistantRunPresentationFromMessages([assistant("assistant-1", [{ type: "tool", callId: "call-1", name: "bash", state: "error" }])], 5_000);
  assert.deepEqual(restored, { assistantMessageId: "assistant-1", activity: { type: "tool-result", tool: "command", outcome: "failure", since: 5_000 }, runId: null, startedAt: 5_000, userMessageId: null });
});

test("ignores events owned by another conversation turn", () => {
  const started = createAssistantRunPresentation("user-1", 1_000);
  const foreign = { ...event(1, "run-2", { type: "message.started", message: assistant("assistant-2", []) }), turnId: "turn:user-2" };
  assert.deepEqual(advanceAssistantRunPresentation(started, foreign), started);
});

test("ignores stale events and refreshes only after session idle", () => {
  const firstRun = event(3, "run-1", { type: "run.completed", runId: "run-1" });
  assert.equal(isNewerRunEvent(event(4, "run-1", { type: "session.idle" }), runEventCursor(firstRun)), true);
  assert.equal(isNewerRunEvent(event(3, "run-1", { type: "run.completed", runId: "run-1" }), runEventCursor(firstRun)), false);
  assert.equal(isNewerRunEvent(event(1, "run-2", { type: "run.started", runId: "run-2" }), runEventCursor(firstRun)), true);
  assert.equal(isNewerRunEvent(event(2, "run-2", { type: "message.completed", message: assistant("assistant-2", []) }), runEventCursor(firstRun)), false);
  assert.equal(shouldRefreshSnapshotAfterEvent(event(4, "run-1", { type: "message.completed", message: assistant("assistant-1", []) })), false);
  assert.equal(shouldRefreshSnapshotAfterEvent(event(5, "run-1", { type: "session.idle" })), true);
});

test("isolates member transcript events without hiding Team Lead tool updates", () => {
  const member = {
    memberId: "writer",
    taskId: "task-1",
    revision: 1,
  };
  assert.equal(isExpertMemberMessageEvent(event(1, "run-1", {
    type: "expert-member.message.started",
    ...member,
    message: assistant("member-message", []),
  })), true);
  assert.equal(isExpertMemberMessageEvent(event(2, "run-1", {
    type: "expert-member.message.text.delta",
    ...member,
    messageId: "member-message",
    delta: "Draft",
  })), true);
  assert.equal(isExpertMemberMessageEvent(event(3, "run-1", {
    type: "expert-member.message.reasoning.delta",
    ...member,
    messageId: "member-message",
    delta: "Reasoning",
  })), true);
  assert.equal(isExpertMemberMessageEvent(event(4, "run-1", {
    type: "expert-member.message.completed",
    ...member,
    message: { ...assistant("member-message", []), status: "complete" },
  })), true);
  assert.equal(isExpertMemberMessageEvent(event(5, "run-1", {
    type: "expert-member.tool.started",
    memberId: "writer",
    taskId: "task-1",
    messageId: "member-message",
    callId: "read-call",
    name: "read",
    input: { path: "draft.md" },
  })), true);
  assert.equal(isExpertMemberMessageEvent(event(6, "run-1", {
    type: "expert-member.tool.completed",
    memberId: "writer",
    taskId: "task-1",
    messageId: "member-message",
    callId: "read-call",
    output: "done",
    isError: false,
  })), true);
  assert.equal(isExpertMemberMessageEvent(event(7, "run-1", {
    type: "expert-member.approval.requested",
    memberId: "writer",
    taskId: "task-1",
    messageId: "member-message",
    approval: {
      approvalId: "approval-1",
      callId: "write-call",
      toolName: "write",
      input: { path: "draft.md" },
      risk: "file-write",
      severity: "normal",
      summary: "Write draft",
      preview: { kind: "file", path: "draft.md", operation: "write" },
      matchedRules: [],
    },
  })), true);
  assert.equal(isExpertMemberMessageEvent(event(8, "run-1", {
    type: "expert-member.approval.resolved",
    memberId: "writer",
    taskId: "task-1",
    messageId: "member-message",
    resolution: { approvalId: "approval-1", approved: true },
  })), true);

  assert.equal(isExpertMemberMessageEvent(event(9, "run-1", {
    type: "tool.updated",
    messageId: "lead-message",
    callId: "delegate-call",
    output: "Writer completed",
  })), false);
  assert.equal(isExpertMemberMessageEvent(event(10, "run-1", {
    type: "tool.completed",
    messageId: "lead-message",
    callId: "delegate-call",
    output: "Writer result",
    isError: false,
  })), false);
});

test("accepts a standalone context compaction as a new run", () => {
  const previousRun = event(8, "run-1", { type: "run.completed", runId: "run-1" });
  const compactionStarted = event(1, "run-2", { type: "context.compaction.started", trigger: "manual" });
  assert.equal(isNewerRunEvent(compactionStarted, runEventCursor(previousRun)), true);

  const compactionCursor = runEventCursor(compactionStarted);
  const compactionCompleted = event(2, "run-2", {
    type: "context.compaction.completed",
    compaction: { id: "compaction-1", model: { connectionId: "test", modelId: "test" }, summary: "summary", timestamp: 1_700_000_000_000, tokensAfter: 20, tokensBefore: 100, trigger: "manual" },
  });
  assert.equal(isNewerRunEvent(compactionCompleted, compactionCursor), true);
  assert.equal(isNewerRunEvent(event(3, "run-2", { type: "session.idle" }), runEventCursor(compactionCompleted)), true);
  assert.equal(isNewerRunEvent(event(2, "run-3", { type: "session.idle" }), compactionCursor), false);
});

test("completion keeps local tool details without replacing terminal state", () => {
  const source = {
    kind: "mcp" as const,
    connectorId: "connector-1",
    connectorName: "Web Search",
    toolName: "search",
    templateId: "web-search" as const,
    transport: "streamable-http" as const,
  };
  const previous = assistant("assistant-1", [{
    type: "tool",
    callId: "call-1",
    name: "read",
    input: { path: "README.md" },
    output: "local output",
    source,
    state: "running",
  }]);
  const completed = {
    ...assistant("assistant-1", [{
      type: "tool" as const,
      callId: "call-1",
      name: "read",
      state: "complete" as const,
    }]),
    status: "complete" as const,
  };

  const merged = mergeCompletedAssistantMessage(previous, completed);
  const tool = merged.blocks[0];
  assert.equal(tool?.type, "tool");
  if (tool?.type !== "tool") throw new Error("Expected a tool block");
  assert.equal(tool.state, "complete");
  assert.deepEqual(tool.input, { path: "README.md" });
  assert.equal(tool.output, "local output");
  assert.deepEqual(tool.source, source);
  assert.equal(assistantToolActivity(tool.name, tool.source), "connector");
});

test("does not replace a loaded tool output with a history preview", () => {
  const loaded = assistant("assistant-1", [{
    type: "tool",
    callId: "call-1",
    name: "read",
    output: "complete output",
    outputTruncated: false,
    state: "complete",
  }]);
  const preview = assistant("assistant-1", [{
    type: "tool",
    callId: "call-1",
    name: "read",
    output: "preview...",
    outputTruncated: true,
    state: "complete",
  }]);

  const tool = mergeCompletedAssistantMessage(loaded, preview).blocks[0];
  assert.equal(tool?.type, "tool");
  if (tool?.type !== "tool") throw new Error("Expected a tool block");
  assert.equal(tool.output, "complete output");
  assert.equal(tool.outputTruncated, false);
});
