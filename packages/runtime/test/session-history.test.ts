import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@wordless/domain";
import { createSessionHistoryPage, createSessionHistoryProjection, searchSessionHistoryMessages } from "../src/session-history.ts";

function user(id: string, timestamp: number, text: string): ConversationMessage {
  return { id, role: "user", status: "complete", blocks: [{ type: "text", text }], model: null, timestamp };
}

function assistant(id: string, timestamp: number, text: string): ConversationMessage {
  return {
    id,
    role: "assistant",
    status: "complete",
    blocks: [{ type: "text", text }],
    model: { connectionId: "test", modelId: "test" },
    timestamp,
    usage: { inputTokens: 1, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 13, totalCost: 0 },
  };
}

test("pages complete conversation turns from newest to oldest", () => {
  const projection = createSessionHistoryProjection([
    user("u1", 1, "first"),
    assistant("a1", 2, "first result"),
    user("u2", 3, "second"),
    assistant("a2", 4, "second result"),
    user("u3", 5, "third"),
    assistant("a3", 6, "third result"),
  ], []);

  const latest = createSessionHistoryPage(projection, "revision", { limit: 2 });

  assert.equal(latest.items.length, 2);
  assert.equal(latest.hasMoreBefore, true);
  assert.equal(latest.hasMoreAfter, false);
  assert.equal(latest.nextBeforeCursor, "1");
  assert.deepEqual(latest.items.map((item) => item.type === "turn" ? item.turn.messages.map((message) => message.id) : []), [["u2", "a2"], ["u3", "a3"]]);

  const older = createSessionHistoryPage(projection, "revision", { before: latest.nextBeforeCursor, limit: 2 });
  assert.equal(older.hasMoreBefore, false);
  assert.deepEqual(older.items.map((item) => item.type === "turn" ? item.turn.messages.map((message) => message.id) : []), [["u1", "a1"]]);
});

test("loads an exact turn neighborhood and supports forward paging", () => {
  const projection = createSessionHistoryProjection([
    user("u1", 1, "first"), assistant("a1", 2, "one"),
    user("u2", 3, "second"), assistant("a2", 4, "two"),
    user("u3", 5, "third"), assistant("a3", 6, "three"),
    user("u4", 7, "fourth"), assistant("a4", 8, "four"),
  ], []);

  const around = createSessionHistoryPage(projection, "revision", { aroundTurnId: "turn:u2", limit: 2 });
  assert.deepEqual(around.items.map((item) => item.type === "turn" ? item.turn.id : "compaction"), ["turn:u1", "turn:u2"]);
  assert.equal(around.nextAfterCursor, "2");

  const newer = createSessionHistoryPage(projection, "revision", { after: around.nextAfterCursor, limit: 2 });
  assert.deepEqual(newer.items.map((item) => item.type === "turn" ? item.turn.id : "compaction"), ["turn:u3", "turn:u4"]);
  assert.equal(newer.hasMoreAfter, false);
});

test("history pages preview oversized tool output while retaining the complete output", () => {
  const output = "x".repeat(5_000);
  const projection = createSessionHistoryProjection([
    user("u1", 1, "inspect output"),
    {
      id: "a1",
      role: "assistant",
      status: "complete",
      blocks: [{ type: "tool", callId: "tool-1", name: "bash", state: "complete", output }],
      model: { connectionId: "test", modelId: "test" },
      timestamp: 2,
    },
  ], []);

  const page = createSessionHistoryPage(projection, "revision");
  const turn = page.items.find((item) => item.type === "turn");
  const message = turn?.type === "turn" ? turn.turn.messages[1] : undefined;
  const block = message?.blocks[0];

  assert.equal(block?.type, "tool");
  if (block?.type !== "tool") return;
  assert.equal(block.outputTruncated, true);
  assert.ok((block.output?.length ?? 0) < output.length);
  assert.equal(projection.toolOutputs.get("tool-1"), output);
});

test("searches visible message text and references without exposing reasoning or tool output", () => {
  const projection = createSessionHistoryProjection([
    user("u1", 1, "Discuss the component search experience"),
    {
      id: "a1",
      role: "assistant",
      status: "complete",
      blocks: [
        { type: "reasoning", text: "The hidden implementation uses an internal-only token" },
        { type: "tool", callId: "tool-1", name: "search", state: "complete", output: "The secret-tool-output value" },
        { type: "workspace-reference", id: "ref-1", name: "ConversationSearchDialog.tsx", path: "src/ConversationSearchDialog.tsx", kind: "file" },
      ],
      model: { connectionId: "test", modelId: "test" },
      timestamp: 2,
    },
    user("u2", 3, "Search should locate a concrete message"),
  ], []);

  const textSearch = searchSessionHistoryMessages(projection, { query: "SEARCH" });
  assert.equal(textSearch.total, 3);
  assert.deepEqual(textSearch.results.map((result) => result.messageId), ["u2", "a1", "u1"]);
  assert.equal(textSearch.results[0]?.turnId, "turn:u2");
  assert.ok(textSearch.results[0]?.snippet.includes("Search"));

  const referenceSearch = searchSessionHistoryMessages(projection, { query: "dialog", role: "assistant" });
  assert.equal(referenceSearch.total, 1);
  assert.equal(referenceSearch.results[0]?.messageId, "a1");
  assert.equal(referenceSearch.results[0]?.turnId, "turn:u1");

  assert.equal(searchSessionHistoryMessages(projection, { query: "internal-only" }).total, 0);
  assert.equal(searchSessionHistoryMessages(projection, { query: "secret-tool-output" }).total, 0);
});

test("reports a complete count while limiting returned message search results", () => {
  const projection = createSessionHistoryProjection([
    user("u1", 1, "needle one"),
    user("u2", 2, "needle two"),
    user("u3", 3, "needle three"),
  ], []);

  const response = searchSessionHistoryMessages(projection, { query: "needle", limit: 2 });
  assert.equal(response.total, 3);
  assert.equal(response.truncated, true);
  assert.deepEqual(response.results.map((result) => result.messageId), ["u3", "u2"]);
});
