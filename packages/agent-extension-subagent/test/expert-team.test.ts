import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentExtensionContext,
  AgentTool,
  SubagentTask,
} from "@wordless/agent-extension-sdk";
import { expertTeamExtension } from "../src/expert-team.ts";

function fixture(options: { failingMember?: string } = {}) {
  const registered: AgentTool[] = [];
  const executed: SubagentTask[] = [];
  const states: Record<string, unknown>[] = [];
  const context = {
    descriptor: expertTeamExtension.descriptor,
    configuration: { enabled: false, settings: {} },
    record: {
      id: "parent",
      expertSelection: { kind: "team", id: "team", version: "1" },
      runtimeRootPath: "C:\\workspace",
    },
    expertTeamDelegates: [
      {
        id: "writer-a",
        name: "Writer A",
        portrait: { kind: "builtin", key: "writer-a" },
        executionProfile: "read-only",
        responsibility: "Draft the article.",
        systemPrompt: "Write clearly.",
        skillIds: [],
        connectorIds: [],
      },
      {
        id: "writer-b",
        name: "Writer B",
        portrait: { kind: "builtin", key: "writer-b" },
        executionProfile: "read-only",
        responsibility: "Create an alternative draft.",
        systemPrompt: "Use a concise style.",
        skillIds: [],
        connectorIds: [],
      },
    ],
    subagentRunner: {
      async run(
        task: SubagentTask,
        runOptions?: {
          onUpdate?: (progress: {
            taskId: string;
            status: "running";
          }) => void;
        },
      ) {
        executed.push(task);
        runOptions?.onUpdate?.({ taskId: task.id, status: "running" });
        const memberId =
          task.kind === "expert-member" ? task.memberId : task.role;
        if (memberId === options.failingMember)
          return {
            taskId: task.id,
            status: "failed" as const,
            text: "",
            error: "member failed",
          };
        return {
          taskId: task.id,
          status: "completed" as const,
          text: `result:${memberId}`,
        };
      },
      async cancel() {},
    },
    harness: { on() {} },
    async registerTools(tools: AgentTool[]) {
      registered.push(...tools);
    },
    emit() {},
    getCurrentPrompt() {
      return undefined;
    },
    env: {},
    session: {},
    state: {},
    async setState(state: Record<string, unknown>) {
      states.push(structuredClone(state));
    },
  } as unknown as AgentExtensionContext;
  return { context, executed, registered, states };
}

test("registers an expert-only tool and routes duplicate profiles by member id", async () => {
  const { context, executed, registered } = fixture();
  await expertTeamExtension.create(context).activate();
  assert.deepEqual(
    registered.map((tool) => tool.name),
    ["delegate_expert"],
  );
  const tool = registered[0]!;
  const result = await tool.execute(
    "call",
    {
      mode: "parallel",
      tasks: [
        { memberId: "writer-a", task: "Draft A" },
        { memberId: "writer-b", task: "Draft B" },
      ],
    },
    new AbortController().signal,
  );
  assert.equal(result.isError, undefined);
  assert.deepEqual(
    executed.map((task) =>
      task.kind === "expert-member" ? task.memberId : task.role,
    ),
    ["writer-a", "writer-b"],
  );
  assert.equal(
    executed.every((task) => task.kind === "expert-member"),
    true,
  );
});

test("rejects unknown expert members without role fallback", async () => {
  const { context, registered } = fixture();
  await expertTeamExtension.create(context).activate();
  await assert.rejects(
    registered[0]!.execute(
      "call",
      { mode: "single", tasks: [{ memberId: "missing", task: "Draft" }] },
      new AbortController().signal,
    ),
    /Unknown expert team member: missing/,
  );
});

test("does not allow the Team Lead to delegate itself", async () => {
  const { context, registered } = fixture();
  await expertTeamExtension.create(context).activate();
  await assert.rejects(
    registered[0]!.execute(
      "call",
      {
        mode: "single",
        tasks: [{ memberId: "team-lead", task: "Coordinate the work" }],
      },
      new AbortController().signal,
    ),
    /Unknown expert team member: team-lead/,
  );
});

test("persists ordered sequential transitions through writer completion and reviewer start", async () => {
  const { context, registered, states } = fixture();
  await expertTeamExtension.create(context).activate();
  await registered[0]!.execute(
    "sequence-call",
    {
      mode: "sequential",
      tasks: [
        { memberId: "writer-a", task: "Draft" },
        { memberId: "writer-b", task: "Review" },
      ],
    },
    new AbortController().signal,
  );

  const snapshots = states.map((state) =>
    Object.values(state.taskRuns as Record<string, Record<string, unknown>>),
  );
  assert.equal(
    snapshots.some((runs) => {
      const writer = runs.find((run) => run.memberId === "writer-a");
      const reviewer = runs.find((run) => run.memberId === "writer-b");
      return writer?.status === "completed" && reviewer?.status === "running";
    }),
    true,
  );
  const finalRuns = snapshots.at(-1)!;
  assert.deepEqual(
    finalRuns.map((run) => run.status),
    ["completed", "completed"],
  );
  assert.equal(
    finalRuns.every((run) => run.phase === "finished"),
    true,
  );
});

test("marks dependent tasks skipped when a sequential member fails", async () => {
  const { context, registered, states } = fixture({
    failingMember: "writer-a",
  });
  await expertTeamExtension.create(context).activate();
  const result = await registered[0]!.execute(
    "failed-call",
    {
      mode: "sequential",
      tasks: [
        { memberId: "writer-a", task: "Draft" },
        { memberId: "writer-b", task: "Review" },
      ],
    },
    new AbortController().signal,
  );

  assert.equal(result.isError, true);
  const runs = Object.values(
    states.at(-1)!.taskRuns as Record<string, Record<string, unknown>>,
  );
  assert.deepEqual(
    runs.map((run) => run.status),
    ["failed", "skipped"],
  );
  assert.match(String(runs[1]?.terminalReason), /did not complete/);
});
