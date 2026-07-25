import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@wordless/protocol";
import { buildConversationDensity, buildConversationTurns, densityThickness, estimateMessageTokens } from "../src/renderer/features/thread/conversation-density.ts";

function message(id: string, role: ConversationMessage["role"], text: string, outputTokens?: number): ConversationMessage {
  return {
    blocks: text ? [{ type: "text", text }] : [],
    id,
    model: null,
    role,
    status: "complete",
    timestamp: 1_700_000_000_000,
    usage: outputTokens === undefined ? undefined : { inputTokens: 5, outputTokens, totalCost: 0, totalTokens: outputTokens + 5 },
  };
}

test("groups a user message with consecutive assistant messages into one turn", () => {
  const turns = buildConversationTurns([
    message("user-1", "user", "Review this change"),
    message("assistant-1", "assistant", "I will inspect it"),
    message("assistant-2", "assistant", "The change is safe"),
    message("user-2", "user", "Now summarize it"),
  ]);

  assert.deepEqual(turns, [
    { id: "turn:user-1", messageIds: ["user-1", "assistant-1", "assistant-2"], userMessageId: "user-1" },
    { id: "turn:user-2", messageIds: ["user-2"], userMessageId: "user-2" },
  ]);
});

test("prefers assistant output tokens and falls back to visible message text", () => {
  assert.equal(estimateMessageTokens(message("assistant", "assistant", "short", 321)), 321);
  assert.ok(estimateMessageTokens(message("user", "user", "A longer fallback message")) > 1);
});

test("builds user navigation entries and bounds density thickness", () => {
  const density = buildConversationDensity([
    message("user-1", "user", "First request"),
    message("assistant-1", "assistant", "First answer", 4_000),
    message("user-2", "user", "Second request"),
  ]);

  assert.deepEqual(density.navigatorItems.map((item) => item.messageId), ["user-1", "user-2"]);
  assert.equal(density.items.length, 2);
  assert.deepEqual(density.items[0]?.messageIds, ["user-1", "assistant-1"]);
  assert.ok((density.items[0]?.tokens ?? 0) > 4_000);
  assert.equal(densityThickness(1), 1.3);
  assert.equal(densityThickness(1_000_000), 2.5);
});
