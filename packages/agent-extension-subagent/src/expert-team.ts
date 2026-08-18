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
  type ModelReference,
  type ThinkingLevel,
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
  inputs?: string[];
  outputs?: string[];
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
  resultPath?: string;
  files?: string[];
  usage?: ConversationUsage;
  error?: string;
  tool?: SubagentTaskProgress["tool"];
  approval?: unknown;
  userRequest?: unknown;
  modelResolution?: {
    requested: ModelReference | null;
    resolved: ModelReference;
    thinkingLevel: ThinkingLevel;
    fallbackReason?: "unavailable" | "tools-unsupported";
  };
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
  "interrupted",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
]);

const ExpertTaskSchema = Type.Object({
  memberId: Type.String({ minLength: 1, maxLength: 120 }),
  task: Type.String({ minLength: 1, maxLength: 12_000 }),
  inputs: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 32 })),
  outputs: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 32 })),
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

function validateArtifactPaths(paths: string[] | undefined, label: string): void {
  for (const path of paths ?? []) {
    if (
      path.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      path.includes("\\") ||
      path.split("/").includes("..") ||
      !path.startsWith("artifacts/") ||
      path.includes("%TEMP%") ||
      path.includes("/tmp/")
    )
      throw new Error(`${label} must be a session-relative artifacts/... path: ${path}`);
  }
}

function taskPreview(value: string): string {
  if (value.length <= 1_200) return value;
  return `${value.slice(0, 1_200)}\n...[full task stored in the delegation brief file]`;
}

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
        run.status = "interrupted";
        run.phase = "finished";
        run.revision += 1;
        run.updatedAt = now;
        run.finishedAt = now;
        run.terminalReason =
          "The expert task was interrupted before it finished. Its member conversation is preserved for Team Lead follow-up.";
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
    description: `Delegate work to exact members of the selected expert team using { mode, tasks: [{ memberId, task, inputs?, outputs? }] }. inputs and outputs must be full session-relative artifacts/... paths. Put shared inputs in artifacts/shared/, member outputs in artifacts/<member-id>/, and never use OS temp or absolute paths for handoff. The following roster is authoritative; use memberId exactly as listed and never search the filesystem or environment for team configuration.\n\nAvailable members:\n${expertRoster(members.values())}`,
    parameters: ExpertDelegationSchema,
    async execute(toolCallId, params, signal, onUpdate) {
      validateDelegation(params, members);
      for (const task of params.tasks) {
        validateArtifactPaths(task.inputs, "inputs");
        validateArtifactPaths(task.outputs, "outputs");
        if (task.outputs?.some((path) => path.startsWith("artifacts/primary/")))
          throw new Error("outputs must stay in the delegated member's artifact directory; Team Lead publishes primary deliverables");
      }
      const delegatedAt = Date.now();
      const taskPrompts = new Map(
        params.tasks.map((task, index) => [
          index,
          task.task,
        ]),
      );
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
            task: taskPreview(input.task),
            ...(input.inputs ? { inputs: input.inputs } : {}),
            ...(input.outputs ? { outputs: input.outputs } : {}),
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
        if (progress.usage !== undefined) current.usage = progress.usage;
        if (progress.modelResolution !== undefined)
          current.modelResolution = progress.modelResolution;
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
        previousPath?: string,
      ): Promise<SubagentResult> => {
        const prompt = `${taskPrompts.get(details.tasks.indexOf(task)) ?? task.task}${
          previousPath
            ? `\n\nPrevious expert result file:\n${previousPath}\nRead it before starting this task.`
            : ""
        }`;
        const inputs = [
          ...(task.inputs ?? []),
          ...(previousPath ? [previousPath] : []),
        ];
        const result = await context.subagentRunner!.run(
          {
            kind: "expert-member",
            id: task.id,
            memberId: task.memberId,
            prompt,
            cwd: context.record.runtimeRootPath,
            ...(inputs.length ? { inputs } : {}),
            ...(task.outputs ? { outputs: task.outputs } : {}),
          },
          { signal, onUpdate: update },
        );
        task.resultPath = result.resultPath;
        task.files = result.files;
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
        let previousPath: string | undefined;
        for (let index = 0; index < details.tasks.length; index++) {
          const task = details.tasks[index]!;
          const result = await run(task, previousPath);
          results.push(result);
          if (result.status !== "completed") {
            for (const remaining of details.tasks.slice(index + 1)) {
              const reason = `${task.memberName} did not complete. This dependent task is blocked until the Team Lead decides whether to continue the member, take over, or delegate differently.`;
              taskStates.transition(toolCallId, remaining, {
                status: "blocked",
                phase: "finished",
                terminalReason: reason,
              });
              remaining.error = reason;
              onUpdate?.({ content: [], details: cloneDetails(details) });
            }
            break;
          }
          previousPath = result.resultPath;
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

function expertRoster(members: Iterable<ExpertMember>): string {
  return [...members]
    .map(
      (member) =>
        `- ${member.id}: ${member.name}; responsibility: ${member.responsibility}`,
    )
    .join("\n");
}

function expertDelegationPolicy(members: Iterable<ExpertMember>): string {
  const roster = expertRoster(members);
  return `You are the selected team's Team Lead, the primary conversational identity, and the only agent responsible for the final answer. Stay in the Team Lead role in tone, judgment, terminology, and delivery. Before responding to a substantive request, decide whether delegation creates material value: use a named member when the work contains a separable specialty, benefits from independent verification or perspective, the user explicitly expects team collaboration, or the quality gain outweighs the added latency and context cost. Do not delegate simple questions, clarification, formatting, or work you can already complete to a high standard. This is a judgment rule, not a requirement to delegate every turn.\n\nTeam file protocol: keep task messages concise. Put briefs, source notes, evidence packets, and any long context in artifacts/shared/; members write only to their own artifacts/<member-id>/ directory; publish only final confirmed deliverables to artifacts/primary/. Always pass full session-relative paths in inputs and outputs when files are involved. Never use OS temp directories or bare paths such as draft.md for cross-member handoff. Member completion returns status and file paths; read the result file when you need the full content.\n\nWhen delegation is worthwhile, use delegate_expert with exactly { mode, tasks: [{ memberId, task, inputs?, outputs? }] }; memberId must match the roster and every task must be self-contained with relevant evidence, constraints, acceptance criteria, and file paths. Different members may work in parallel only when independent. Use sequential mode when a later member needs an earlier result. Read and evaluate every result file, resolve conflicts yourself, and synthesize the final answer in your own Team Lead voice. Never present raw member output as the final response. Child experts cannot delegate further work.\n\nThe roster below is authoritative runtime configuration. Answer roster questions directly from it. Never search the workspace, user home directory, environment variables, skills, plugins, or unrelated configuration files to discover team members.\n\nIf a member is interrupted or fails, inspect the preserved partial output and error before deciding what to do. You may delegate the same member again with precise continuation instructions, revise the assignment, complete the work yourself, delegate another member, or stop. Reusing a member continues that member's existing conversation history. Do not treat partial output as complete and do not automatically continue a blocked dependent task until its dependency is resolved.\n\nExpert team roster:\n${roster}`;
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
  const summary = details.tasks
    .map((task) => {
      const result = task.resultPath
        ? `\n\nResult file: ${task.resultPath}`
        : "";
      const files = task.files?.length
        ? `\n\nFiles: ${task.files.join(", ")}`
        : "";
      const error = task.error ? `\n\nError:\n${task.error}` : "";
      return `### ${task.memberName} (${task.status})${result}${files}${error}`;
    })
    .join("\n\n---\n\n");
  if (
    details.tasks.some(
      (task) => task.status === "interrupted" || task.status === "failed",
    )
  )
    return `${summary}\n\nThe member conversation and any partial output are preserved. As Team Lead, decide whether to delegate the same member again to continue, revise the assignment, complete the work yourself, delegate another member, or stop. Do not treat partial output as a completed deliverable.`;
  return summary;
}

function cloneDetails(details: DelegationDetails): DelegationDetails {
  return JSON.parse(JSON.stringify(details)) as DelegationDetails;
}
