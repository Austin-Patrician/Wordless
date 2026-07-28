import assert from "node:assert/strict";
import test from "node:test";
import { createPendingThreadTurn } from "../src/renderer/features/thread/pending-thread-turn.ts";

test("projects a submitted prompt into an immediately renderable user message", () => {
  const turn = createPendingThreadTurn(
    [
      { type: "skill-reference", skillId: "skill-1", name: "Review", source: "wordless" },
      { type: "text", text: "Review this file" },
      { type: "workspace-reference", path: "src/app.ts", name: "app.ts", kind: "file" },
    ],
    [{ path: "src/app.ts", name: "app.ts" }],
    { messageId: "message-1", submittedAt: 123 },
  );

  assert.equal(turn.message.id, "message-1");
  assert.equal(turn.message.timestamp, 123);
  assert.equal(turn.message.role, "user");
  assert.deepEqual(turn.message.blocks.map((block) => block.type), ["skill-reference", "text", "workspace-reference", "attachment"]);
});
