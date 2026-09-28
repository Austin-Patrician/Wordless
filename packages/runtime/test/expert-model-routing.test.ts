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

test("a plain subagent role whose model is unusable falls back to the session model", () => {
  // 真实踩坑:`roleModels.reviewer` 指向 `deepseek/deepseek-v4-flash`,而那个模型没被启用
  // (用户启用的是**另一个连接**上的同名模型)。旧行为是整条委派直接失败。
  const task: SubagentTask = {
    kind: "builtin-subagent",
    id: "task",
    role: "reviewer",
    prompt: "Review",
    cwd: "/workspace",
    model: { connectionId: "deepseek", modelId: "deepseek-v4-flash" },
  };
  const model = { reasoning: true } as Model<Api>;

  const resolution = resolveDelegatedTaskModel(
    task,
    parent,
    undefined,
    (reference) => {
      if (reference.connectionId === "deepseek") throw new Error("The selected model is not enabled");
      return model;
    },
    () => ({ supportsToolUse: true }) as ModelCapabilities,
  );

  assert.deepEqual(resolution.reference, parent, "回落到会话模型");
  assert.equal(resolution.fallbackReason, "unavailable", "降级必须被报出来,而不是静默发生");
});

test("the role's intended model is still reported, so the fallback is diagnosable", () => {
  const task: SubagentTask = {
    kind: "builtin-subagent",
    id: "task",
    role: "reviewer",
    prompt: "Review",
    cwd: "/workspace",
    model: { connectionId: "deepseek", modelId: "deepseek-v4-flash" },
  };

  // 扩展把角色配置原样交上来,`modelResolution.requested` 就是它能被看见的地方 ——
  // 否则"回落到会话模型了"这件事会连痕迹都不留。
  assert.deepEqual(delegatedTaskModelReference(task, parent), {
    connectionId: "deepseek",
    modelId: "deepseek-v4-flash",
  });
});

test("when the fallback itself is unusable the error names the role and where to fix it", () => {
  const task: SubagentTask = {
    kind: "builtin-subagent",
    id: "task",
    role: "reviewer",
    prompt: "Review",
    cwd: "/workspace",
    model: { connectionId: "deepseek", modelId: "deepseek-v4-flash" },
  };

  assert.throws(
    () =>
      resolveDelegatedTaskModel(
        task,
        parent,
        undefined,
        () => {
          throw new Error("The selected model is not enabled");
        },
        () => ({ supportsToolUse: true }) as ModelCapabilities,
      ),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /"reviewer"/, "必须说是哪个角色");
      assert.match(message, /deepseek\/deepseek-v4-flash/, "必须说它指向什么");
      assert.match(message, /Settings -> Extensions -> Subagent/, "必须说去哪儿改");
      return true;
    },
  );
});
