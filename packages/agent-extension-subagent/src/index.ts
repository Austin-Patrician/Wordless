import { randomUUID } from "node:crypto";
import type { AgentExtension, AgentExtensionDefinition, AgentExtensionContext, AgentTool, JsonObject, SubagentResult, SubagentRoleDefinition, SubagentTaskProgress } from "@wordless/agent-extension-sdk";
import { mergeConversationUsage, type ConversationUsage } from "@wordless/domain";
import { Type, type Static } from "typebox";

export interface SubagentExtensionState extends JsonObject {
  roles: SubagentRoleDefinition[];
}

export interface SubagentExtensionSettings extends JsonObject {
  roleModels?: Partial<Record<SubagentRoleDefinition["id"], { connectionId: string; modelId: string }>>;
}

type DelegationReason = "independent-research" | "complex-planning" | "isolated-implementation" | "explicit-user-review";

type TaskDetails = {
  id: string;
  role: SubagentRoleDefinition["id"];
  task: string;
  scope: string;
  expectedOutput: string;
  reason: DelegationReason;
  status: "queued" | "running" | "awaiting-approval" | "awaiting-user-input" | "completed" | "failed" | "cancelled";
  output?: string;
  usage?: ConversationUsage;
  error?: string;
  tool?: SubagentTaskProgress["tool"];
  approval?: unknown;
  userRequest?: unknown;
};

type DelegationDetails = {
  mode: "single" | "parallel" | "chain";
  tasks: TaskDetails[];
  usage?: ConversationUsage;
};

const DEFAULT_ROLES: SubagentRoleDefinition[] = [
  { id: "scout", name: "Scout", description: "Discover information. Search, inspect and summarize.", model: null },
  { id: "planner", name: "Planner", description: "Produce execution plans and break complex goals into actionable steps.", model: null },
  { id: "reviewer", name: "Reviewer", description: "Inspect completed work, verify correctness, and identify risks.", model: null },
  { id: "worker", name: "Worker", description: "Execute a concrete implementation task.", model: null },
  { id: "researcher", name: "Researcher", description: "Collect source-grounded evidence for one research dimension.", model: null },
  { id: "research-reviewer", name: "Research reviewer", description: "Review source-grounded evidence and identify gaps or conflicts.", model: null },
];

const DelegationTaskSchema = Type.Object({
  agent: Type.Union([Type.Literal("scout"), Type.Literal("planner"), Type.Literal("reviewer"), Type.Literal("worker"), Type.Literal("researcher"), Type.Literal("research-reviewer")]),
  task: Type.String({ minLength: 1, maxLength: 12_000 }),
});

const DelegationParamsSchema = Type.Object({
  mode: Type.Union([Type.Literal("single"), Type.Literal("parallel"), Type.Literal("sequential")]),
  tasks: Type.Array(DelegationTaskSchema, { minItems: 1, maxItems: 8 }),
});

type DelegationParams = Static<typeof DelegationParamsSchema>;
type DelegationTask = Static<typeof DelegationTaskSchema>;

const SUBAGENT_DELEGATION_POLICY = `
A delegated task must be self-contained, independently solvable, and narrowly scoped.

Choose scout to discover workspace information, researcher to collect source-grounded evidence for one confirmed data-research dimension, research-reviewer to inspect research evidence for support and gaps, planner to produce execution plans, and worker to execute implementation tasks. Choose reviewer only to inspect completed work when the user explicitly asks for review, audit, verification, or a second opinion.

Prefer delegation when specialization improves quality, the task can run independently, and the result can be summarized. Avoid delegation when the work is trivial, continuous interaction is required, or context sharing outweighs the benefit. Never delegate just to use this tool. Child agents cannot delegate further work.

Use exactly this argument shape: { mode: "single" | "parallel" | "sequential", tasks: [{ agent: "scout" | "planner" | "worker" | "reviewer" | "researcher" | "research-reviewer", task: "..." }] }.
For one reviewer: { mode: "single", tasks: [{ agent: "reviewer", task: "Review the current Git workspace changes" }] }.
For independent research: { mode: "parallel", tasks: [{ agent: "scout", task: "..." }, { agent: "scout", task: "..." }] }.
For ordered work: { mode: "sequential", tasks: [{ agent: "scout", task: "..." }, { agent: "planner", task: "..." }] }.
Do not send role, reason, scope, expectedOutput, chain, or any fields outside this shape.`;

export const subagentExtension: AgentExtensionDefinition = {
  descriptor: {
    id: "wordless.subagent",
    version: "1",
    name: "Subagent",
    description: "Delegate isolated research, planning, review, and implementation tasks.",
    category: "orchestration",
    builtin: true,
    defaultEnabled: false,
    supportedDriverIds: ["coding"],
  },
  create(context: AgentExtensionContext): AgentExtension {
    let reviewerAllowed = false;
    const roles = (): SubagentRoleDefinition[] => {
      const configured = configuredRoleModels(context.configuration.settings);
      const saved = Array.isArray(context.state.roles) ? context.state.roles.flatMap((role) => isRole(role) ? [role] : []) : [];
      const source = saved.length === DEFAULT_ROLES.length ? saved : DEFAULT_ROLES;
      return source.map((role) => ({ ...role, model: configured[role.id] ?? role.model }));
    };

    return {
      async activate() {
        if (!context.subagentRunner) throw new Error("Subagent execution is unavailable for this session");
        await context.registerTools([createDelegateTool(context, roles, () => reviewerAllowed)]);
        context.harness.on("before_agent_start", (event) => {
          reviewerAllowed = hasExplicitReviewIntent(context.getCurrentPrompt() ?? "");
          return { systemPrompt: `${event.systemPrompt}\n\n${SUBAGENT_DELEGATION_POLICY}\nReviewer available this turn: ${reviewerAllowed ? "yes" : "no"}.` };
        });
        context.emit("capability.available", { roles: roles(), reviewerAllowed });
      },
      async interact(action, payload) {
        if (action !== "set-role-models" || !Array.isArray(payload)) throw new Error(`Unknown Subagent action: ${action}`);
        const models = new Map(payload.flatMap((item) => isRoleModel(item) ? [[item.role, item.model] as const] : []));
        const next = { roles: roles().map((role) => ({ ...role, model: models.get(role.id) ?? role.model })) } satisfies SubagentExtensionState;
        await context.setState(next);
        context.emit("roles.updated", next.roles);
      },
      dispose() {},
    };
  },
};

function createDelegateTool(
  context: AgentExtensionContext,
  roles: () => SubagentRoleDefinition[],
  reviewerAllowed: () => boolean,
): AgentTool<typeof DelegationParamsSchema, DelegationDetails> {
  return {
    name: "delegate_task",
    label: "Delegate task",
    description: "Delegate work with exactly { mode, tasks }. Each task is exactly { agent, task }. mode=single requires one task; mode=parallel runs independent read-only tasks; mode=sequential passes each result to the next task. Example: { mode: 'single', tasks: [{ agent: 'reviewer', task: 'Review the current Git workspace changes' }] }.",
    parameters: DelegationParamsSchema,
    async execute(_toolCallId, params, signal, onUpdate) {
      validateDelegation(params.mode, params.tasks, reviewerAllowed());
      const availableRoles = new Set(roles().map((role) => role.id));
      for (const task of params.tasks) {
        if (!availableRoles.has(task.agent)) throw new Error(`The ${task.agent} role is unavailable`);
      }
      const details: DelegationDetails = {
        mode: params.mode === "sequential" ? "chain" : params.mode,
        tasks: params.tasks.map((task) => ({
          id: randomUUID(),
          role: task.agent,
          task: task.task,
          scope: "current workspace",
          expectedOutput: expectedOutput(task.agent),
          reason: delegationReason(task.agent),
          status: "queued",
        })),
      };
      const update = (progress: SubagentTaskProgress) => {
        const current = details.tasks.find((task) => task.id === progress.taskId);
        if (!current) return;
        current.status = progress.status;
        if (progress.output !== undefined) current.output = progress.output;
        if (progress.usage !== undefined) current.usage = progress.usage;
        if (progress.tool !== undefined) current.tool = progress.tool;
        if (progress.approval !== undefined) current.approval = progress.approval;
        if (progress.userRequest !== undefined) current.userRequest = progress.userRequest;
        const usage = details.tasks.reduce<ConversationUsage | undefined>((total, task) => mergeConversationUsage(total, task.usage), undefined);
        if (usage) details.usage = usage;
        else delete details.usage;
        onUpdate?.({ content: [{ type: "text", text: formatDelegationSummary(details) }], details: cloneDetails(details) });
      };
      const run = async (task: TaskDetails, previous?: string): Promise<SubagentResult> => {
        const prompt = previous ? `${task.task}\n\nPrevious task result:\n${previous.slice(0, 50_000)}` : task.task;
        const role = roles().find((candidate) => candidate.id === task.role);
        const result = await context.subagentRunner!.run({ id: task.id, role: task.role, prompt, cwd: context.record.runtimeRootPath, model: role?.model ?? null }, { signal, onUpdate: update });
        task.status = result.status;
        task.output = result.text;
        task.usage = result.usage;
        task.error = result.error;
        update({ taskId: task.id, status: result.status, output: result.text, usage: result.usage });
        return result;
      };
      let results: SubagentResult[];
      if (params.mode === "parallel") results = await Promise.all(details.tasks.map((task) => run(task)));
      else if (params.mode === "sequential") {
        results = [];
        let previous = "";
        for (const task of details.tasks) {
          const result = await run(task, previous);
          results.push(result);
          if (result.status !== "completed") break;
          previous = result.text;
        }
      } else results = [await run(details.tasks[0]!)];
      const failed = results.some((result) => result.status !== "completed");
      return { content: [{ type: "text", text: formatDelegationSummary(details) }], details: cloneDetails(details), ...(failed ? { isError: true } : {}) };
    },
  };
}

function validateDelegation(mode: DelegationParams["mode"], tasks: DelegationTask[], reviewerAllowed: boolean): void {
  if (mode === "single" && tasks.length !== 1) throw new Error("single mode requires exactly one task");
  if ((mode === "parallel" || mode === "sequential") && tasks.length < 2) throw new Error(`${mode} mode requires at least two tasks`);
  for (const task of tasks) {
    if (task.agent === "reviewer" && !reviewerAllowed) throw new Error("Reviewer delegation is only available when the user explicitly asks for review");
  }
  if (mode === "parallel" && tasks.some((task) => task.agent === "worker")) throw new Error("Worker tasks cannot run in parallel until their file ownership is explicitly coordinated");
}

function delegationReason(agent: DelegationTask["agent"]): DelegationReason {
  return agent === "scout" || agent === "researcher" || agent === "research-reviewer" ? "independent-research" : agent === "planner" ? "complex-planning" : agent === "worker" ? "isolated-implementation" : "explicit-user-review";
}

function expectedOutput(agent: DelegationTask["agent"]): string {
  return agent === "scout" ? "A concise findings summary with file references" : agent === "researcher" ? "Structured source-grounded claims submitted for one research dimension" : agent === "research-reviewer" ? "A review of evidence support, gaps, conflicts, and suggested supplement research" : agent === "planner" ? "An actionable implementation plan" : agent === "worker" ? "A concise implementation and verification summary" : "A review of correctness, risks, and suggested improvements";
}

function configuredRoleModels(settings: JsonObject): Partial<Record<SubagentRoleDefinition["id"], { connectionId: string; modelId: string }>> {
  const candidate = settings.roleModels;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return {};
  const models: Partial<Record<SubagentRoleDefinition["id"], { connectionId: string; modelId: string }>> = {};
  for (const role of DEFAULT_ROLES) {
    const value = (candidate as Record<string, unknown>)[role.id];
    if (isModelReference(value)) models[role.id] = value;
  }
  return models;
}

function hasExplicitReviewIntent(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return /(code\s+review|review(?:er)?\b|audit\b|second\s+opinion|subagent\s+reviewer|审查|审核|代码评审|(?:检查|查看).{0,18}(当前|工作区|git|变更|修改|diff|问题))/.test(normalized);
}

function formatDelegationSummary(details: DelegationDetails): string {
  return details.tasks.map((task) => {
    const state = task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : task.status;
    const text = task.output ? `\n${task.output.slice(0, 50_000)}` : task.error ? `\n${task.error}` : "";
    return `### ${task.role} (${state})\n${text}`;
  }).join("\n\n---\n\n");
}

function cloneDetails(details: DelegationDetails): DelegationDetails {
  return JSON.parse(JSON.stringify(details)) as DelegationDetails;
}

function isRole(value: unknown): value is SubagentRoleDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const role = value as Record<string, unknown>;
  return (role.id === "scout" || role.id === "planner" || role.id === "reviewer" || role.id === "worker" || role.id === "researcher" || role.id === "research-reviewer") && typeof role.name === "string" && typeof role.description === "string" && (role.model === null || isModelReference(role.model));
}

function isModelReference(value: unknown): value is { connectionId: string; modelId: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  return typeof reference.connectionId === "string" && typeof reference.modelId === "string";
}

function isRoleModel(value: unknown): value is { role: SubagentRoleDefinition["id"]; model: { connectionId: string; modelId: string } | null } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isRole({ id: candidate.role, name: "", description: "", model: candidate.model });
}
