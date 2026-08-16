import assert from "node:assert/strict";
import test from "node:test";
import type { SubagentTask } from "@wordless/agent-extension-sdk";
import {
  connectorPoliciesForExpertMember,
  delegatedTaskModelReference,
  delegatedTaskThinkingLevelRequest,
  resolveDelegatedTaskModel,
} from "../src/subagent-runner.ts";
import type { ModelCapabilities } from "@wordless/domain";
import type { Api, Model } from "@wordless/ai";

const parent = { connectionId: "composer", modelId: "selected-model" };

test("expert members inherit the Composer model when no override is configured", () => {
  const task: SubagentTask = {
    kind: "expert-member",
    id: "task",
    memberId: "writer",
    prompt: "Draft",
    cwd: "C:\\workspace",
  };
  assert.deepEqual(delegatedTaskModelReference(task, parent), parent);
});

test("expert members can override the Composer model", () => {
  const task: SubagentTask = {
    kind: "expert-member",
    id: "task",
    memberId: "writer",
    prompt: "Draft",
    cwd: "C:\\workspace",
  };
  const override = { connectionId: "specialist", modelId: "writer-model" };
  assert.deepEqual(delegatedTaskModelReference(task, parent, override), override);
});

test("expert member model failures fall back to the Composer model", () => {
  const task: SubagentTask = {
    kind: "expert-member",
    id: "task",
    memberId: "writer",
    prompt: "Draft",
    cwd: "C:\\workspace",
  };
  const override = { connectionId: "missing", modelId: "writer-model" };
  const model = { reasoning: true } as Model<Api>;
  const capabilities = { supportsToolUse: true } as ModelCapabilities;
  const resolution = resolveDelegatedTaskModel(
    task,
    parent,
    override,
    (reference) => {
      if (reference.connectionId === "missing") throw new Error("Unavailable");
      return model;
    },
    () => capabilities,
  );
  assert.deepEqual(resolution.reference, parent);
  assert.equal(resolution.fallbackReason, "unavailable");
});

test("expert member models without tool support fall back to Composer", () => {
  const task: SubagentTask = {
    kind: "expert-member",
    id: "task",
    memberId: "writer",
    prompt: "Draft",
    cwd: "C:\\workspace",
  };
  const override = { connectionId: "specialist", modelId: "text-only" };
  const model = { reasoning: false } as Model<Api>;
  const resolution = resolveDelegatedTaskModel(
    task,
    parent,
    override,
    () => model,
    (reference) =>
      ({ supportsToolUse: reference.connectionId === "composer" } as ModelCapabilities),
  );
  assert.deepEqual(resolution.reference, parent);
  assert.equal(resolution.fallbackReason, "tools-unsupported");
});

test("expert member thinking depth inherits Composer unless overridden", () => {
  assert.equal(delegatedTaskThinkingLevelRequest(undefined, "high"), "high");
  assert.equal(delegatedTaskThinkingLevelRequest("low", "high"), "low");
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
