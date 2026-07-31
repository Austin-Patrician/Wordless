import assert from "node:assert/strict";
import test from "node:test";
import { ToolApprovalModeSchema } from "@wordless/protocol";
import { Value } from "typebox/value";

test("tool approval protocol accepts all supported modes", () => {
  assert.equal(Value.Check(ToolApprovalModeSchema, "manual"), true);
  assert.equal(Value.Check(ToolApprovalModeSchema, "auto"), true);
  assert.equal(Value.Check(ToolApprovalModeSchema, "bypass"), true);
  assert.equal(Value.Check(ToolApprovalModeSchema, "unrestricted"), false);
});
