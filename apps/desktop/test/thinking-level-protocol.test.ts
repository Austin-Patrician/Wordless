import assert from "node:assert/strict";
import test from "node:test";
import { SetSessionModelSchema, SetSessionThinkingLevelSchema, ThinkingLevelSchema } from "@wordless/protocol";
import { Value } from "typebox/value";

test("thinking level protocol accepts the unified AI depth values", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.equal(Value.Check(ThinkingLevelSchema, level), true);
    assert.equal(Value.Check(SetSessionThinkingLevelSchema, { sessionId: "session-1", level }), true);
  }
  assert.equal(Value.Check(ThinkingLevelSchema, "ultra"), false);
  assert.equal(Value.Check(SetSessionThinkingLevelSchema, { sessionId: "", level: "medium" }), false);
  assert.equal(Value.Check(SetSessionModelSchema, {
    sessionId: "session-1",
    model: { connectionId: "openai", modelId: "gpt-5" },
    thinkingLevel: "high",
  }), true);
});
