import assert from "node:assert/strict";
import test from "node:test";
import { AutomationTaskInputSchema } from "@wordless/protocol";
import { Value } from "typebox/value";

const input = {
  name: "Daily digest",
  prompt: "Summarize today's news.",
  entryId: "general-work",
  workspaceId: null,
  accessLevel: "full",
  toolApprovalMode: "bypass",
  model: { connectionId: "openai", modelId: "gpt-5" },
  thinkingLevel: "medium",
  skillIds: [],
  connectorIds: [],
  schedule: { kind: "recurring", cadence: "daily", time: "09:00" },
  activeFrom: null,
  activeUntil: null,
  enabled: true,
} as const;

test("automation input requires a valid tool approval mode", () => {
  assert.equal(Value.Check(AutomationTaskInputSchema, input), true);
  assert.equal(
    Value.Check(AutomationTaskInputSchema, {
      ...input,
      toolApprovalMode: "unsupported",
    }),
    false,
  );
  const { toolApprovalMode: _toolApprovalMode, ...withoutApprovalMode } = input;
  assert.equal(Value.Check(AutomationTaskInputSchema, withoutApprovalMode), false);
});
