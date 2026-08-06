import assert from "node:assert/strict";
import test from "node:test";
import type { ContextCompactionRecord } from "@wordless/domain";
import type { ConversationMessage, SessionHistoryPage } from "@wordless/protocol";
import { completeContextCompaction } from "../src/renderer/features/thread/context-compaction-state.ts";
import { createThreadTimeline, dataIndexFromReportedIndex, firstItemIndexAfterPrepend, threadTimelineItemCount } from "../src/renderer/features/thread/thread-virtual-list.ts";
import { createAssistantRunPresentation } from "../src/renderer/features/thread/thread-run-state.ts";

function message(id: string, role: ConversationMessage["role"]): ConversationMessage {
  return { blocks: [{ type: "text", text: id }], id, model: null, role, status: "complete", timestamp: 1 };
}

function compaction(timestamp: number): ContextCompactionRecord {
  return {
    id: `compaction-${timestamp}`,
    model: { modelId: "test-model", providerId: "test-provider" },
    summary: "summary",
    timestamp,
    tokensAfter: 1_000,
    tokensBefore: 86_500,
    trigger: "automatic",
  };
}

test("converts a Virtuoso reported index back to the data index", () => {
  assert.equal(dataIndexFromReportedIndex(99_978, 99_976), 2);
});

test("keeps the pending and streaming assistant item on the same turn key", () => {
  const user = message("user", "user");
  const pending = createThreadTimeline([user], [], createAssistantRunPresentation(user.id, 1));
  assert.equal(pending[1]?.type, "assistant-run");
  assert.equal(pending[1]?.type === "assistant-run" ? pending[1].turnId : null, "turn:user");

  const streaming = createThreadTimeline([user, message("assistant", "assistant")], [], createAssistantRunPresentation(user.id, 1));
  assert.equal(streaming[1]?.type, "messages");
  assert.equal(streaming[1]?.type === "messages" ? streaming[1].turnId : null, "turn:user");
});

test("places the pending assistant after automatic compaction for the active turn", () => {
  const user = message("user", "user");
  const timeline = createThreadTimeline([user], [compaction(2)], createAssistantRunPresentation(user.id, 1));

  assert.deepEqual(timeline.map((item) => item.type), ["messages", "compaction", "assistant-run"]);
  assert.equal(timeline[2]?.timestamp, 3);
});

test("places an overflow compaction before the recovered response", () => {
  const user = { ...message("user", "user"), timestamp: 1 };
  const failed = { ...message("overflow-attempt", "assistant"), timestamp: 2 };
  const recovered = { ...message("recovered-response", "assistant"), timestamp: 4 };
  const overflowCompaction = { ...compaction(3), trigger: "overflow" as const };
  const completed = completeContextCompaction(
    [user, failed, recovered],
    [],
    overflowCompaction,
    failed.id,
  );

  const timeline = createThreadTimeline(completed.messages, completed.contextCompactions);

  assert.deepEqual(timeline.map((item) => item.type), ["messages", "compaction", "messages"]);
  assert.deepEqual(completed.messages.map((item) => item.id), ["user", "recovered-response"]);
});

test("counts rendered timeline items for a history page", () => {
  const page: SessionHistoryPage = {
    hasMoreAfter: true,
    hasMoreBefore: false,
    items: [{
      type: "turn",
      turn: {
        id: "turn:user",
        anchorMessageId: "user",
        messages: [message("user", "user"), message("assistant", "assistant")],
        timestamp: 1,
      },
    }],
    revision: "1",
  };

  assert.equal(threadTimelineItemCount(page), 2);
  assert.equal(firstItemIndexAfterPrepend(100_000, threadTimelineItemCount(page)), 99_998);
});
