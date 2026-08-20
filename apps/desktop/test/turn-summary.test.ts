import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@wordless/protocol";
import { buildSessionTurnSummary, sessionTurnSummaryEquals } from "../src/renderer/features/thread/turn-summary.ts";

function message(id: string, role: ConversationMessage["role"], text: string, outputTokens?: number): ConversationMessage {
  return {
    blocks: text ? [{ type: "text", text }] : [],
    id,
    model: null,
    role,
    status: "complete",
    timestamp: 1,
    usage: outputTokens === undefined ? undefined : {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens: 5,
      outputTokens,
      totalCost: 0,
      totalTokens: outputTokens + 5,
    },
  };
}

test("builds excerpts from the user message and prefers assistant output tokens", () => {
  const summary = buildSessionTurnSummary({
    messageId: "user-1",
    messages: [message("user-1", "user", "First request"), message("assistant-1", "assistant", "short", 4_000)],
    ordinal: 0,
    timestamp: 10,
    turnId: "turn:user-1",
  });
  assert.equal(summary.excerpt, "First request");
  assert.equal(summary.tokens, 4_005);
  assert.equal(sessionTurnSummaryEquals(summary, { ...summary }), true);
});
