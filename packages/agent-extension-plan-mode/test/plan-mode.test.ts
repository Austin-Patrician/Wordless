import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentExtensionContext,
  AgentTool,
} from "@wordless/agent-extension-sdk";
import { planModeExtension } from "../src/index.ts";

type PlanState = Record<string, unknown>;

function fixture(state: PlanState) {
  const registered: AgentTool[] = [];
  const persisted: PlanState[] = [];
  let beforeAgentStart:
    | ((event: {
        systemPrompt: string;
      }) => { systemPrompt: string } | undefined)
    | undefined;
  const context = {
    descriptor: planModeExtension.descriptor,
    configuration: { enabled: true, settings: {} },
    record: { id: "session", driverId: "coding" },
    env: {},
    session: {},
    state,
    harness: {
      on(event: string, listener: typeof beforeAgentStart) {
        if (event === "before_agent_start") beforeAgentStart = listener;
      },
    },
    async registerTools(tools: AgentTool[]) {
      registered.push(...tools);
    },
    getCurrentPrompt() {
      return undefined;
    },
    async setState(next: PlanState) {
      persisted.push(structuredClone(next));
    },
    emit() {},
  } as unknown as AgentExtensionContext;
  return {
    beforeAgentStart: () => beforeAgentStart,
    context,
    persisted,
    registered,
  };
}

const pendingSteps = [
  {
    id: "inspect",
    title: "Inspect the workspace",
    detail: "Confirm the current behavior and affected modules.",
    status: "pending" as const,
  },
  {
    id: "change",
    title: "Implement the change",
    detail: "Make the smallest coherent code change.",
    status: "pending" as const,
  },
];

test("keeps a structured plan optional in planning mode", async () => {
  const { beforeAgentStart, context, registered } = fixture({
    mode: "planning",
    plan: [],
  });
  await planModeExtension.create(context).activate();

  const tool = registered.find((candidate) => candidate.name === "update_plan");
  assert.ok(tool);
  assert.match(tool.description, /persisted structured plan/i);
  assert.ok(tool.promptGuidelines?.some((line) => /state-mutation tool/i.test(line)));
  assert.ok(tool.promptGuidelines?.some((line) => /If the submitted plan is identical, do not call/i.test(line)));
  const instruction = beforeAgentStart()?.({ systemPrompt: "Base prompt" });
  assert.match(instruction?.systemPrompt ?? "", /structured plan is optional/i);
  assert.match(instruction?.systemPrompt ?? "", /Do not change files/i);
  assert.match(instruction?.systemPrompt ?? "", /Only after exploration is complete/i);
  assert.match(instruction?.systemPrompt ?? "", /Do not call update_plan while inspecting/i);
});

test("gives execution mode explicit state-transition rules", async () => {
  const { beforeAgentStart, context } = fixture({
    mode: "executing",
    plan: pendingSteps,
  });
  await planModeExtension.create(context).activate();
  const instruction = beforeAgentStart()?.({ systemPrompt: "Base prompt" });
  assert.match(instruction?.systemPrompt ?? "", /not a progress log or status query/i);
  assert.match(instruction?.systemPrompt ?? "", /pending to in-progress/i);
  assert.match(instruction?.systemPrompt ?? "", /If no persisted plan state changes, do not call update_plan/i);
});

test("persists a pending plan without a synthetic version", async () => {
  const { context, persisted, registered } = fixture({
    mode: "planning",
    plan: [],
  });
  await planModeExtension.create(context).activate();
  const tool = registered.find((candidate) => candidate.name === "update_plan");
  assert.ok(tool);

  await tool.execute(
    "plan-call",
    { steps: pendingSteps, activeStepId: "inspect" },
    new AbortController().signal,
  );

  assert.deepEqual(persisted.at(-1), {
    mode: "planning",
    plan: pendingSteps,
    activeStepId: "inspect",
  });
  assert.equal("version" in persisted.at(-1)!, false);
});

test("rejects implementation progress before the plan is approved", async () => {
  const { context, registered } = fixture({ mode: "planning", plan: [] });
  await planModeExtension.create(context).activate();
  const tool = registered.find((candidate) => candidate.name === "update_plan");
  assert.ok(tool);

  await assert.rejects(
    tool.execute(
      "plan-call",
      {
        steps: [
          { ...pendingSteps[0]!, status: "in-progress" },
          pendingSteps[1]!,
        ],
      },
      new AbortController().signal,
    ),
    /Planning mode can only create pending steps/,
  );
});

test("requires an existing structured plan before execution", async () => {
  const { context, registered } = fixture({ mode: "executing", plan: [] });
  await planModeExtension.create(context).activate();
  const tool = registered.find((candidate) => candidate.name === "update_plan");
  assert.ok(tool);

  await assert.rejects(
    tool.execute(
      "execution-call",
      { steps: pendingSteps },
      new AbortController().signal,
    ),
    /must be approved before it can be updated during execution/,
  );
});

test("reports the material progress from an execution update", async () => {
  const { context, persisted, registered } = fixture({
    mode: "executing",
    plan: pendingSteps,
  });
  await planModeExtension.create(context).activate();
  const tool = registered.find((candidate) => candidate.name === "update_plan");
  assert.ok(tool);

  const started = await tool.execute(
    "execution-call",
    {
      steps: [{ ...pendingSteps[0]!, status: "in-progress" }, pendingSteps[1]!],
      activeStepId: "inspect",
    },
    new AbortController().signal,
  );
  assert.match(started.content[0]?.text ?? "", /started: Inspect the workspace/i);
  assert.deepEqual(persisted.at(-1), {
    mode: "executing",
    plan: [{ ...pendingSteps[0]!, status: "in-progress" }, pendingSteps[1]!],
    activeStepId: "inspect",
  });

  const advanced = await tool.execute(
    "execution-call",
    {
      steps: [
        { ...pendingSteps[0]!, status: "completed" },
        { ...pendingSteps[1]!, status: "in-progress" },
      ],
      activeStepId: "inspect",
    },
    new AbortController().signal,
  );
  assert.match(advanced.content[0]?.text ?? "", /completed: Inspect the workspace/i);
  assert.match(advanced.content[0]?.text ?? "", /started: Implement the change/i);
  assert.deepEqual(persisted.at(-1), {
    mode: "executing",
    plan: [
      { ...pendingSteps[0]!, status: "completed" },
      { ...pendingSteps[1]!, status: "in-progress" },
    ],
    activeStepId: "change",
  });
});

test("does not persist a repeated plan update", async () => {
  const { context, persisted, registered } = fixture({
    mode: "executing",
    plan: [{ ...pendingSteps[0]!, status: "in-progress" }, pendingSteps[1]!],
    activeStepId: "inspect",
  });
  await planModeExtension.create(context).activate();
  const tool = registered.find((candidate) => candidate.name === "update_plan");
  assert.ok(tool);

  const result = await tool.execute(
    "execution-call",
    {
      steps: [{ ...pendingSteps[0]!, status: "in-progress" }, pendingSteps[1]!],
      activeStepId: "inspect",
    },
    new AbortController().signal,
  );

  assert.match(result.content[0]?.text ?? "", /Plan unchanged \(progress: 0\/2\)/i);
  assert.match(result.content[0]?.text ?? "", /no material changes/i);
  assert.equal(persisted.length, 0);
});
