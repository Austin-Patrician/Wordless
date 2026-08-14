import assert from "node:assert/strict";
import test from "node:test";
import type { SubagentTask } from "@wordless/agent-extension-sdk";
import {
  connectorPoliciesForExpertMember,
  delegatedTaskModelReference,
} from "../src/subagent-runner.ts";

const parent = { connectionId: "composer", modelId: "selected-model" };

test("expert members always inherit the Composer model", () => {
  const task: SubagentTask = {
    kind: "expert-member",
    id: "task",
    memberId: "writer",
    prompt: "Draft",
    cwd: "C:\\workspace",
  };
  assert.deepEqual(delegatedTaskModelReference(task, parent), parent);
});

test("builtin subagents retain role model overrides and parent fallback", () => {
  const override = { connectionId: "roles", modelId: "worker-model" };
  const configured: SubagentTask = {
    kind: "builtin-subagent",
    id: "configured",
    role: "worker",
    prompt: "Implement",
    cwd: "C:\\workspace",
    model: override,
  };
  const inherited: SubagentTask = {
    ...configured,
    id: "inherited",
    model: null,
  };
  assert.deepEqual(delegatedTaskModelReference(configured, parent), override);
  assert.deepEqual(delegatedTaskModelReference(inherited, parent), parent);
});

test("research experts keep only their non-destructive connector tools", () => {
  const readOnly = {
    agentToolName: "mcp_web_search",
    connectorId: "web",
    connectorName: "Web",
    toolName: "search",
    readOnly: true,
    destructive: false,
  };
  const approvalRequired = {
    ...readOnly,
    agentToolName: "mcp_web_fetch",
    toolName: "fetch",
    readOnly: false,
    destructive: null,
  };
  const destructive = {
    ...readOnly,
    agentToolName: "mcp_web_delete",
    toolName: "delete",
    readOnly: false,
    destructive: true,
  };
  const unrelated = {
    ...readOnly,
    agentToolName: "mcp_github_search",
    connectorId: "github",
  };

  assert.deepEqual(
    connectorPoliciesForExpertMember(
      { connectorIds: ["web"], executionProfile: "research" },
      [readOnly, approvalRequired, destructive, unrelated],
    ).map((policy) => policy.agentToolName),
    ["mcp_web_search", "mcp_web_fetch"],
  );
});
