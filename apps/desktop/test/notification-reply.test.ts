import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage } from "@wordless/domain";
import { lastAssistantText } from "../src/main/notifications/reply.ts";

/** The rules for turning a session into the `{{reply}}` value. */

function message(role: "user" | "assistant", blocks: Array<Record<string, unknown>>): ConversationMessage {
  return { id: "m", role, status: "complete", blocks, model: null, timestamp: 0 } as unknown as ConversationMessage;
}

test("the last assistant text is the answer", () => {
  const messages = [
    message("user", [{ type: "text", text: "do the thing" }]),
    message("assistant", [{ type: "text", text: "first attempt" }]),
    message("user", [{ type: "text", text: "no, differently" }]),
    message("assistant", [{ type: "text", text: "final answer" }]),
  ];
  assert.equal(lastAssistantText(messages), "final answer");
});

test("reasoning and tool blocks are left out", () => {
  const messages = [
    message("assistant", [
      { type: "reasoning", text: "thinking about it" },
      { type: "tool", name: "bash" },
      { type: "text", text: "done" },
    ]),
  ];
  assert.equal(lastAssistantText(messages), "done");
});

test("an assistant turn with nothing to say reports nothing", () => {
  // Reaching further back would report an earlier turn as if it were the answer.
  const messages = [message("assistant", [{ type: "text", text: "the answer" }]), message("assistant", [{ type: "tool", name: "bash" }])];
  assert.equal(lastAssistantText(messages), undefined);
  assert.equal(lastAssistantText([]), undefined);
  assert.equal(lastAssistantText([message("user", [{ type: "text", text: "hi" }])]), undefined);
  assert.equal(lastAssistantText([message("assistant", [{ type: "text", text: "   " }])]), undefined);
});
