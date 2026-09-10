import assert from "node:assert/strict";
import test from "node:test";
import type { AgentExtensionContext } from "@wordless/agent-extension-sdk";
import { planModeExtension } from "../src/index.ts";

function fixture(state: Record<string, unknown>) {
  const events: Array<{ type: string; payload: unknown }> = [];
  const setStateCalls: Record<string, unknown>[] = [];
  const setActiveToolsCalls: string[][] = [];
  let beforeAgentStart:
    | ((event: { systemPrompt: string }) => Promise<unknown>)
    | undefined;
  const context = {
    descriptor: planModeExtension.descriptor,
    configuration: { enabled: true, settings: {} },
    record: { id: "parent", runtimeRootPath: "C:\\workspace" },
    state,
    harness: {
      on: (type: string, handler: unknown) => {
        if (type === "before_agent_start") beforeAgentStart = handler as never;
        return () => {};
      },
      getActiveTools: () => [{ name: "update_plan" }, { name: "bash" }],
      setActiveTools: async (names: string[]) => {
        setActiveToolsCalls.push(names);
      },
    },
    registerTools: async () => {},
    getCurrentPrompt: () => undefined,
    setState: async (next: Record<string, unknown>) => {
      setStateCalls.push(next);
    },
    emit: (type: string, payload?: unknown) => {
      events.push({ type, payload });
    },
  } as unknown as AgentExtensionContext;

  return {
    context,
    events,
    setStateCalls,
    setActiveToolsCalls,
    getBeforeAgentStart: () => {
      assert.ok(beforeAgentStart, "before_agent_start hook was not registered");
      return beforeAgentStart;
    },
  };
}

function plan(steps: Array<{ id: string; status: string }>) {
  return steps.map((step) => ({
    id: step.id,
    title: `Step ${step.id}`,
    detail: "",
    status: step.status,
  }));
}

test("a fully completed plan auto-closes at the next turn start", async () => {
  const f = fixture({
    mode: "executing",
    plan: plan([
      { id: "s1", status: "completed" },
      { id: "s2", status: "completed" },
    ]),
    activeStepId: "s2",
  });
  const extension = planModeExtension.create(f.context);
  await extension.activate();

  const result = await f.getBeforeAgentStart()({ systemPrompt: "base" });
  assert.equal(result, undefined);
  // The teardown is fire-and-forget inside the sync hook; flush the
  // microtask queue before asserting on its effects.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(f.setStateCalls, [
    {
      mode: "off",
      plan: plan([
        { id: "s1", status: "completed" },
        { id: "s2", status: "completed" },
      ]),
    },
  ]);
  // The update_plan tool must be deactivated alongside the mode change.
  assert.deepEqual(f.setActiveToolsCalls, [["bash"]]);
  assert.ok(f.events.some((event) => event.type === "plan.updated"));
});

test("an unfinished plan stays active across the turn boundary", async () => {
  const f = fixture({
    mode: "executing",
    plan: plan([
      { id: "s1", status: "completed" },
      { id: "s2", status: "in-progress" },
    ]),
    activeStepId: "s2",
  });
  const extension = planModeExtension.create(f.context);
  await extension.activate();

  const result = await f.getBeforeAgentStart()({ systemPrompt: "base" });
  assert.ok(
    typeof result === "object" &&
      result !== null &&
      "systemPrompt" in result &&
      String((result as { systemPrompt: string }).systemPrompt).includes(
        "executing the user's request",
      ),
  );
  assert.equal(f.setStateCalls.length, 0);
  assert.equal(f.setActiveToolsCalls.length, 0);
});
