import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, SessionHistoryPage } from "@wordless/protocol";
import { dataIndexFromReportedIndex, firstItemIndexAfterPrepend, threadTimelineItemCount } from "../src/renderer/features/thread/thread-virtual-list.ts";

function message(id: string, role: ConversationMessage["role"]): ConversationMessage {
  return { blocks: [{ type: "text", text: id }], id, model: null, role, status: "complete", timestamp: 1 };
}

test("converts a Virtuoso reported index back to the data index", () => {
  assert.equal(dataIndexFromReportedIndex(99_978, 99_976), 2);
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
