import { randomUUID } from "node:crypto";
import type {
  AgentExtensionDefinition,
  AgentTool,
  JsonObject,
  SubagentResult,
  SubagentTaskPhase,
  SubagentTaskProgress,
  SubagentTaskStatus,
} from "@wordless/agent-extension-sdk";
import {
  mergeConversationUsage,
  type ConversationUsage,
  type ExpertExecutionProfile,
  type ExpertPortrait,
} from "@wordless/domain";
import { Type, type Static } from "typebox";

type ExpertMember = {
  id: string;
  name: string;
  portrait: ExpertPortrait;
  executionProfile: ExpertExecutionProfile;
  responsibility: string;
  systemPrompt: string;
  skillIds: string[];
  connectorIds: string[];
};

type TaskDetails = {
  id: string;
  memberId: string;
  memberName: string;
  memberPortrait: ExpertMember["portrait"];
  executionProfile: ExpertExecutionProfile;
  task: string;
  responsibility: string;
  expectedOutput: string;
  status: SubagentTaskStatus;
  phase: SubagentTaskPhase;
  revision: number;
  queuedAt: number;
  startedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  activeToolName?: string;
  blockedByTaskId?: string;
  terminalReason?: string;
  output?: string;
  usage?: ConversationUsage;
  error?: string;
  tool?: SubagentTaskProgress["tool"];
  approval?: unknown;
  userRequest?: unknown;
  events: Array<
    | { id: string; type: "delegated"; text: string; at: number }
    | {
        id: string;
        type: "tool";
        name: string;
        state: "running" | "complete" | "error";
        output?: string;
        at: number;
      }
    | { id: string; type: "output"; text: string; at: number }
    | { id: string; type: "error"; text: string; at: number }
  >;
};

type DelegationDetails = {
  mode: "single" | "parallel" | "chain";
  tasks: TaskDetails[];
  usage?: ConversationUsage;
};

type PersistedTaskRun = Pick<
  TaskDetails,
  | "id"
  | "memberId"
  | "memberName"
  | "status"
  | "phase"
  | "revision"
  | "queuedAt"
  | "startedAt"
  | "updatedAt"
  | "finishedAt"
  | "activeToolName"
  | "blockedByTaskId"
  | "terminalReason"
> & { delegationId: string };

type ExpertTeamState = JsonObject & {
  taskRuns: Record<string, PersistedTaskRun>;
};

type TaskStateController = {
  recoverInterrupted(): Promise<void>;
  register(delegationId: string, tasks: TaskDetails[]): Promise<void>;
  transition(
    delegationId: string,
    task: TaskDetails,
    next: {
      status: SubagentTaskStatus;
      phase?: SubagentTaskPhase;
      activeToolName?: string;
      terminalReason?: string;
    },
  ): void;
  flush(): Promise<void>;
};

const TERMINAL_TASK_STATUSES = new Set<SubagentTaskStatus>([
  "completed",
  "failed",
  "cancelled",
  "skipped",
]);

const ExpertTaskSchema = Type.Object({
  memberId: Type.String({ minLength: 1, maxLength: 120 }),
  task: Type.String({ minLength: 1, maxLength: 12_000 }),
});

const ExpertDelegationSchema = Type.Object({
  mode: Type.Union([
    Type.Literal("single"),
    Type.Literal("parallel"),
    Type.Literal("sequential"),
  ]),
  tasks: Type.Array(ExpertTaskSchema, { minItems: 1, maxItems: 8 }),
});

type ExpertDelegationParams = Static<typeof ExpertDelegationSchema>;

export const expertTeamExtension: AgentExtensionDefinition = {
  descriptor: {
    id: "wordless.expert-team",
    version: "1",
    name: "Expert team",
    description: "Delegate work to the selected expert team's named members.",
    category: "orchestration",
    builtin: true,
    defaultEnabled: false,
    supportedDriverIds: ["coding", "generic"],
  },
  create(context) {
    const members = new Map(
      (context.expertTeamDelegates ?? []).map((member) => [member.id, member]),
    );
    const taskStates = createTaskStateController(context);
    return {
      async activate() {
        if (context.record.expertSelection?.kind !== "team")
          throw new Error("Expert team delegation requires a selected team");
        if (!context.subagentRunner)
          throw new Error(
            "Expert member execution is unavailable for this session",
          );
        if (!members.size)
          throw new Error("The selected expert team has no available members");
        await taskStates.recoverInterrupted();
        await context.registerTools([
          createExpertDelegateTool(context, members, taskStates),
        ]);
        context.harness.on("before_agent_start", (event) => ({
          systemPrompt: `${event.systemPrompt}\n\n${expertDelegationPolicy(members.values())}`,
        }));
        context.emit("capability.available", {
          members: [...members.values()].map(memberPresentation),
        });
      },
      dispose() {},
    };
  },
};

function createTaskStateController(
  context: Parameters<AgentExtensionDefinition["create"]>[0],
): TaskStateController {
  const initial =
    typeof context.state.taskRuns === "object" &&
    context.state.taskRuns !== null &&
    !Array.isArray(context.state.taskRuns)
      ? (context.state.taskRuns as Record<string, PersistedTaskRun>)
      : {};
  const taskRuns = new Map(
    Object.entries(initial).map(([id, run]) => [id, { ...run }]),
  );
  const baseState = { ...context.state };
  let writeTail = Promise.resolve();

  const persist = () => {
    const terminalDelegations = new Map<string, number>();
    for (const run of taskRuns.values())
      if (TERMINAL_TASK_STATUSES.has(run.status))
        terminalDelegations.set(
          run.delegationId,
          Math.max(terminalDelegations.get(run.delegationId) ?? 0, run.updatedAt),
        );
    const retainedTerminalDelegations = new Set(
      [...terminalDelegations.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 20)
        .map(([id]) => id),
    );
    for (const [id, run] of taskRuns)
      if (
        TERMINAL_TASK_STATUSES.has(run.status) &&
        !retainedTerminalDelegations.has(run.delegationId)
      )
        taskRuns.delete(id);
    const snapshot: ExpertTeamState = {
      ...baseState,
      taskRuns: Object.fromEntries(
        [...taskRuns.entries()].map(([id, run]) => [id, { ...run }]),
      ),
    };
    writeTail = writeTail.then(() => context.setState(snapshot));
  };

  const writeRunToTask = (task: TaskDetails, run: PersistedTaskRun) => {
    task.status = run.status;
    task.phase = run.phase;
    task.revision = run.revision;
    task.queuedAt = run.queuedAt;
    task.updatedAt = run.updatedAt;
    for (const key of [
      "startedAt",
      "finishedAt",
      "activeToolName",
      "blockedByTaskId",
      "terminalReason",
    ] as const) {
      delete task[key];
      const value = run[key];
      if (value !== undefined) (task as Record<string, unknown>)[key] = value;
    }
  };

  return {
    async recoverInterrupted() {
      const now = Date.now();
      let changed = false;
      for (const run of taskRuns.values()) {
        if (TERMINAL_TASK_STATUSES.has(run.status)) continue;
        run.status = "cancelled";
        run.phase = "finished";
        run.revision += 1;
        run.updatedAt = now;
        run.finishedAt = now;
        run.terminalReason = "The expert task was interrupted before it finished";
        delete run.activeToolName;
        changed = true;
      }
      if (changed) persist();
      await writeTail;
    },
    async register(delegationId, tasks) {
      for (const task of tasks) {
        const run: PersistedTaskRun = {
          delegationId,
          id: task.id,
          memberId: task.memberId,
          memberName: task.memberName,
          status: task.status,
          phase: task.phase,
          revision: task.revision,
          queuedAt: task.queuedAt,
          updatedAt: task.updatedAt,
          ...(task.blockedByTaskId
            ? { blockedByTaskId: task.blockedByTaskId }
            : {}),
        };
        taskRuns.set(task.id, run);
      }
      persist();
      await writeTail;
    },
    transition(delegationId, task, next) {
      const previous = taskRuns.get(task.id);
      if (!previous || previous.delegationId !== delegationId) return;
      if (TERMINAL_TASK_STATUSES.has(previous.status)) return;
      const now = Date.now();
      const phase =
        next.phase ??
        (TERMINAL_TASK_STATUSES.has(next.status)
          ? "finished"
          : next.status === "queued"
            ? "queued"
            : next.status === "awaiting-approval"
              ? "approval"
              : next.status === "awaiting-user-input"
                ? "user-input"
                : "thinking");
      const activeToolName =
        phase === "tool" ? next.activeToolName : undefined;
      if (
        previous.status === next.status &&
        previous.phase === phase &&
        previous.activeToolName === activeToolName &&
        previous.terminalReason === next.terminalReason
      )
        return;
      const run: PersistedTaskRun = {
        ...previous,
        status: next.status,
        phase,
        revision: previous.revision + 1,
        updatedAt: now,
        ...(previous.startedAt
          ? { startedAt: previous.startedAt }
          : next.status !== "queued"
            ? { startedAt: now }
            : {}),
        ...(activeToolName ? { activeToolName } : {}),
        ...(TERMINAL_TASK_STATUSES.has(next.status)
          ? { finishedAt: now }
          : {}),
        ...(next.terminalReason
          ? { terminalReason: next.terminalReason }
          : {}),
      };
      if (!activeToolName) delete run.activeToolName;
      if (next.status !== "queued") delete run.blockedByTaskId;
      taskRuns.set(task.id, run);
      writeRunToTask(task, run);
      persist();
    },
    async flush() {
      await writeTail;
    },
  };
}

function createExpertDelegateTool(
  context: Parameters<AgentExtensionDefinition["create"]>[0],
  members: ReadonlyMap<string, ExpertMember>,
  taskStates: TaskStateController,
): AgentTool<typeof ExpertDelegationSchema, DelegationDetails> {
  return {
    name: "delegate_expert",
    label: "Delegate to expert",
    description:
      "Delegate work to exact members of the selected expert team using { mode, tasks: [{ memberId, task }] }. Use memberId exactly as listed in the team roster.",
    parameters: ExpertDelegationSchema,
    async execute(toolCallId, params, signal, onUpdate) {
      validateDelegation(params, members);
      const delegatedAt = Date.now();
      const details: DelegationDetails = {
        mode: params.mode === "sequential" ? "chain" : params.mode,
        tasks: params.tasks.map((input) => {
          const member = members.get(input.memberId)!;
          return {
            id: randomUUID(),
            memberId: member.id,
            memberName: member.name,
            memberPortrait: member.portrait,
            executionProfile: member.executionProfile,
            task: input.task,
            responsibility: member.responsibility,
            expectedOutput: expectedOutput(member),
            status: "queued",
            phase: "queued",
            revision: 1,
            queuedAt: delegatedAt,
            updatedAt: delegatedAt,
            events: [
              {
                id: `delegated:${member.id}`,
                type: "delegated",
                text: input.task,
                at: Date.now(),
              },
            ],
          };
        }),
      };
      for (let index = 1; index < details.tasks.length; index++)
        if (params.mode === "sequential")
          details.tasks[index]!.blockedByTaskId = details.tasks[index - 1]!.id;
      await taskStates.register(toolCallId, details.tasks);
      const update = (progress: SubagentTaskProgress) => {
        const current = details.tasks.find(
          (task) => task.id === progress.taskId,
        );
        if (!current) return;
        const phase = progress.phase ?? taskPhaseFromProgress(progress);
        taskStates.transition(toolCallId, current, {
          status: progress.status,
          phase,
          ...(phase === "tool" && progress.tool
            ? { activeToolName: progress.tool.name }
            : {}),
        });
        if (progress.output !== undefined) current.output = progress.output;
        if (progress.usage !== undefined) current.usage = progress.usage;
        if (progress.tool !== undefined) {
          current.tool = progress.tool;
          const event = {
            id: progress.tool.callId
              ? `tool:${progress.tool.callId}`
              : `tool:${progress.tool.name}`,
            type: "tool" as const,
            name: progress.tool.name,
            state: progress.tool.state,
            ...(progress.tool.output ? { output: progress.tool.output } : {}),
            at: Date.now(),
          };
          const index = current.events.findIndex(
            (item) => item.id === event.id,
          );
          if (index === -1) current.events.push(event);
          else current.events[index] = event;
        }
        if (progress.approval !== undefined)
          current.approval = progress.approval;
        if (progress.userRequest !== undefined)
          current.userRequest = progress.userRequest;
        const usage = details.tasks.reduce<ConversationUsage | undefined>(
          (total, task) => mergeConversationUsage(total, task.usage),
          undefined,
        );
        if (usage) details.usage = usage;
        else delete details.usage;
        onUpdate?.({
          content: [],
          details: cloneDetails(details),
        });
      };
      const run = async (
        task: TaskDetails,
        previous?: string,
      ): Promise<SubagentResult> => {
        const prompt = previous
          ? `${task.task}\n\nPrevious expert result:\n${previous.slice(0, 50_000)}`
          : task.task;
        const result = await context.subagentRunner!.run(
          {
            kind: "expert-member",
            id: task.id,
            memberId: task.memberId,
            prompt,
            cwd: context.record.runtimeRootPath,
          },
          { signal, onUpdate: update },
        );
        task.output = result.text;
        task.usage = result.usage;
        task.error = result.error;
        if (result.error)
          task.events.push({
            id: `error:${task.id}`,
            type: "error",
            text: result.error,
            at: Date.now(),
          });
        taskStates.transition(toolCallId, task, {
          status: result.status,
          phase: "finished",
          ...(result.error ? { terminalReason: result.error } : {}),
        });
        update({
          taskId: task.id,
          status: result.status,
          phase: "finished",
          output: result.text,
          usage: result.usage,
        });
        return result;
      };
      onUpdate?.({
        content: [],
        details: cloneDetails(details),
      });
      let results: SubagentResult[];
      if (params.mode === "parallel")
        results = await Promise.all(details.tasks.map((task) => run(task)));
      else if (params.mode === "sequential") {
        results = [];
        let previous = "";
        for (let index = 0; index < details.tasks.length; index++) {
          const task = details.tasks[index]!;
          const result = await run(task, previous);
          results.push(result);
          if (result.status !== "completed") {
            for (const remaining of details.tasks.slice(index + 1)) {
              const reason = `${task.memberName} did not complete, so this dependent task was not started`;
              taskStates.transition(toolCallId, remaining, {
                status: "skipped",
                phase: "finished",
                terminalReason: reason,
              });
              remaining.error = reason;
              onUpdate?.({ content: [], details: cloneDetails(details) });
            }
            break;
          }
          previous = result.text;
        }
      } else results = [await run(details.tasks[0]!)];
      await taskStates.flush();
      return {
        content: [{ type: "text", text: formatSummary(details) }],
        details: cloneDetails(details),
        ...(results.some((result) => result.status !== "completed")
          ? { isError: true }
          : {}),
      };
    },
  };
}

function taskPhaseFromProgress(
  progress: SubagentTaskProgress,
): SubagentTaskPhase {
  if (TERMINAL_TASK_STATUSES.has(progress.status)) return "finished";
  if (progress.status === "queued") return "queued";
  if (progress.status === "awaiting-approval") return "approval";
  if (progress.status === "awaiting-user-input") return "user-input";
  if (progress.tool?.state === "running") return "tool";
  return "thinking";
}

function validateDelegation(
  params: ExpertDelegationParams,
  members: ReadonlyMap<string, ExpertMember>,
): void {
  if (params.mode === "single" && params.tasks.length !== 1)
    throw new Error("single mode requires exactly one task");
  if (
    (params.mode === "parallel" || params.mode === "sequential") &&
    params.tasks.length < 2
  )
    throw new Error(`${params.mode} mode requires at least two tasks`);
  for (const task of params.tasks)
    if (!members.has(task.memberId))
      throw new Error(`Unknown expert team member: ${task.memberId}`);
  if (
    params.mode === "parallel" &&
    params.tasks.some(
      (task) =>
        members.get(task.memberId)?.executionProfile === "workspace-write",
    )
  )
    throw new Error(
      "Workspace-writing experts cannot run in parallel until file ownership is explicitly coordinated",
    );
}

function expertDelegationPolicy(members: Iterable<ExpertMember>): string {
  const roster = [...members]
    .map(
      (member) =>
        `- ${member.id}: ${member.name}; responsibility: ${member.responsibility}`,
    )
    .join("\n");
  return `You are the selected team's Team Lead, the primary conversational identity, and the only agent responsible for the final answer. Stay in the Team Lead role in tone, judgment, terminology, and delivery. Before responding to a substantive request, decide whether delegation creates material value: use a named member when the work contains a separable specialty, benefits from independent verification or perspective, the user explicitly expects team collaboration, or the quality gain outweighs the added latency and context cost. Do not delegate simple questions, clarification, formatting, or work you can already complete to a high standard. This is a judgment rule, not a requirement to delegate every turn.\n\nWhen delegation is worthwhile, use delegate_expert with exactly { mode, tasks: [{ memberId, task }] }; memberId must match the roster and every task must be self-contained with relevant evidence, constraints, and acceptance criteria. Different members may work in parallel only when independent. Use sequential mode when a later member needs an earlier result. Read and evaluate every result, resolve conflicts yourself, and synthesize the final answer in your own Team Lead voice. Never present raw member output as the final response. Child experts cannot delegate further work.\n\nExpert team roster:\n${roster}`;
}

function memberPresentation(member: ExpertMember): JsonObject {
  return {
    id: member.id,
    name: member.name,
    portrait: member.portrait,
    executionProfile: member.executionProfile,
    responsibility: member.responsibility,
  };
}

function expectedOutput(member: ExpertMember): string {
  return `A complete result for ${member.responsibility}`;
}

function formatSummary(details: DelegationDetails): string {
  return details.tasks
    .map((task) => {
      const text = task.output
        ? `\n${task.output.slice(0, 50_000)}`
        : task.error
          ? `\n${task.error}`
          : "";
      return `### ${task.memberName} (${task.status})\n${text}`;
    })
    .join("\n\n---\n\n");
}

function cloneDetails(details: DelegationDetails): DelegationDetails {
  return JSON.parse(JSON.stringify(details)) as DelegationDetails;
}
