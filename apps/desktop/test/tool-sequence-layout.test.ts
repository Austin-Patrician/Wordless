import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@wordless/protocol";
import { assistantToolSequenceContinuations } from "../src/renderer/features/thread/tool-sequence-layout.ts";

function assistant(id: string, blocks: ConversationMessage["blocks"], overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { blocks, id, model: null, role: "assistant", status: "complete", timestamp: 1, ...overrides };
}

function tool(callId: string, name: string): ConversationMessage["blocks"][number] {
  return { callId, name, state: "complete", type: "tool" };
}

test("continues a tool sequence across assistant messages", () => {
  const messages = [
    assistant("bash-message", [tool("bash-1", "bash")]),
    assistant("read-message", [tool("read-1", "read")]),
  ];

  assert.deepEqual(assistantToolSequenceContinuations(messages), [false, true]);
});

test("does not join tools separated by visible text or reasoning", () => {
  const messages = [
    assistant("bash-message", [tool("bash-1", "bash"), { type: "text", text: "Next I will inspect the file." }]),
    assistant("read-message", [tool("read-1", "read")]),
    assistant("reasoning-message", [{ type: "reasoning", text: "Checking another path" }, tool("read-2", "read")]),
  ];

  assert.deepEqual(assistantToolSequenceContinuations(messages), [false, false, false]);
});

test("does not join across an assistant response error", () => {
  const messages = [
    assistant("failed-message", [tool("bash-1", "bash")], { errorMessage: "Command failed", status: "error" }),
    assistant("read-message", [tool("read-1", "read")]),
  ];

  assert.deepEqual(assistantToolSequenceContinuations(messages), [false, false]);
});

test("ignores empty text around consecutive tools", () => {
  const messages = [
    assistant("bash-message", [{ type: "text", text: "  " }, tool("bash-1", "bash"), { type: "text", text: "\n" }]),
    assistant("read-message", [{ type: "text", text: "" }, tool("read-1", "read")]),
  ];

  assert.deepEqual(assistantToolSequenceContinuations(messages), [false, true]);
});
