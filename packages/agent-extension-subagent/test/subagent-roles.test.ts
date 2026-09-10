import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentExtensionContext,
  AgentTool,
  SubagentTask,
} from "@wordless/agent-extension-sdk";
import { subagentExtension } from "../src/index.ts";

type CapturedTask = Pick<SubagentTask, "role" | "model">;

function fixture(settings: Record<string, unknown> = {}) {
  const events: Array<{ type: string; payload: unknown }> = [];
  const executedTasks: CapturedTask[] = [];
  let delegateTool: AgentTool | undefined;
  const context = {
    descriptor: subagentExtension.descriptor,
    configuration: { enabled: true, settings },
    record: { id: "parent", runtimeRootPath: "C:\\workspace" },
    harness: { on: () => () => {} },
    subagentRunner: {
      async run(task: SubagentTask) {
        executedTasks.push({ role: task.role, model: task.model });
        return { status: "completed", text: "done" };
      },
    },
    registerTools: async (tools: AgentTool[]) => {
      delegateTool = tools[0];
    },
    getCurrentPrompt: () => undefined,
    state: {},
    setState: async () => {},
    emit: (type: string, payload?: unknown) => {
      events.push({ type, payload });
    },
  } as unknown as AgentExtensionContext;

  return {
    context,
    events,
    executedTasks,
    getTool: () => {
      assert.ok(delegateTool, "delegate_task tool was not registered");
      return delegateTool;
    },
  };
}

test("role models come from extension settings only", async () => {
  const f = fixture({
    roleModels: {
      scout: { connectionId: "wong", modelId: "deepseek-v4-flash" },
    },
  });
  const extension = subagentExtension.create(f.context);
  await extension.activate();

  const capability = f.events.find((event) => event.type === "capability.available");
  assert.ok(capability);
  const roles = (capability.payload as { roles: Array<{ id: string; model: unknown }> })
    .roles;
  const scout = roles.find((role) => role.id === "scout");
  const planner = roles.find((role) => role.id === "planner");
  assert.deepEqual(scout?.model, { connectionId: "wong", modelId: "deepseek-v4-flash" });
  // Roles without a configured model inherit the current session's model.
  assert.equal(planner?.model, null);
});

test("delegation passes the configured role model and null for inheritance", async () => {
  const f = fixture({
    roleModels: {
      scout: { connectionId: "wong", modelId: "deepseek-v4-flash" },
    },
  });
  const extension = subagentExtension.create(f.context);
  await extension.activate();

  await f.getTool().execute("call-1", {
    mode: "single",
    tasks: [
      { agent: "scout", task: "Inspect the workspace" },
    ],
  } as never, undefined);

  assert.equal(f.executedTasks.length, 1);
  assert.equal(f.executedTasks[0]?.role, "scout");
  assert.deepEqual(f.executedTasks[0]?.model, {
    connectionId: "wong",
    modelId: "deepseek-v4-flash",
  });
});

test("per-session extension state no longer overrides role models", async () => {
  const f = fixture();
  // Simulate a legacy session journal that carried state.roles written by the
  // removed set-role-models interact action. The old implementation gated the
  // saved branch on roles.length === DEFAULT_ROLES.length and used its stale
  // models; the new implementation must ignore it entirely.
  (f.context as { state: unknown }).state = {
    roles: [
      {
        id: "scout",
        name: "Scout",
        description: "Stale",
        model: { connectionId: "legacy", modelId: "stale-model" },
      },
      { id: "planner", name: "Planner", description: "", model: null },
      { id: "reviewer", name: "Reviewer", description: "", model: null },
      {
        id: "worker",
        name: "Worker",
        description: "",
        model: { connectionId: "legacy", modelId: "stale-model" },
      },
      { id: "researcher", name: "Researcher", description: "", model: null },
      {
        id: "research-reviewer",
        name: "Research reviewer",
        description: "",
        model: null,
      },
    ],
  };
  const extension = subagentExtension.create(f.context);
  await extension.activate();

  await f.getTool().execute("call-1", {
    mode: "single",
    tasks: [{ agent: "worker", task: "Do the work" }],
  } as never, undefined);

  assert.equal(f.executedTasks.length, 1);
  // Legacy state must not leak a stale model: inheritance stays null so the
  // current session model is used.
  assert.equal(f.executedTasks[0]?.model, null);
});
