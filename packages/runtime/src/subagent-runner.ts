import { join } from "node:path";
import { SubagentTaskPool, type SubagentTaskExecutor } from "@wordless/agent-extension-runtime";
import type { SubagentResult, SubagentRoleDefinition, SubagentRunner, SubagentTask, SubagentTaskProgress } from "@wordless/agent-extension-sdk";
import type { AgentDriver, AgentDriverEvent, AgentDriverSession, AgentDriverSessionContext, AgentProfileDefinition, AgentRuntimeSkill, ConnectorToolPolicy } from "@wordless/agent-driver-sdk";
import type { AgentTool, ExecutionEnv } from "@wordless/agent";
import type { Api, Model, Models } from "@wordless/ai";
import { mergeConversationUsage, type ModelCapabilities, type ModelReference, type SecurityPolicySnapshot, type SessionRecord } from "@wordless/domain";
import { createWordlessSession, openWordlessSession } from "@wordless/persistence";

type SubagentTaskEntry = {
  session: AgentDriverSession;
  unsubscribe: () => void;
  approvals: Map<string, unknown>;
  userRequests: Map<string, unknown>;
};

export interface SessionSubagentRunnerOptions {
  parent: SessionRecord;
  profile: AgentProfileDefinition;
  driver: AgentDriver;
  models: Models;
  env: ExecutionEnv;
  skills: AgentRuntimeSkill[];
  connectorTools: AgentTool[];
  connectorToolPolicies: ConnectorToolPolicy[];
  security: SecurityPolicySnapshot;
  journalsRoot: string;
  resolveModel(reference: ModelReference): Model<Api>;
  resolveCapabilities(reference: ModelReference): ModelCapabilities;
  onFilesChanged(changes: SubagentFileChange[]): Promise<void>;
}

export interface SubagentFileChange {
  taskId: string;
  role: SubagentRoleDefinition["id"];
  path: string;
  baseline: { path: string; existed: boolean; content: string | null };
  kind: "created" | "modified";
}

const ROLE_PROMPTS: Record<SubagentRoleDefinition["id"], string> = {
  scout: "You are the Scout subagent. Discover relevant facts in the workspace using only your assigned read-only tools. Return concise findings with file references. Do not make changes and do not delegate work.",
  planner: "You are the Planner subagent. Inspect the workspace and produce an actionable implementation plan. Explain dependencies, risks, and verification. Do not make changes and do not delegate work.",
  reviewer: "You are the Reviewer subagent. Inspect the completed work, verify correctness, identify risks, and suggest focused improvements. Do not make changes and do not delegate work.",
  worker: "You are the Worker subagent. Complete the assigned implementation task within its stated scope. Use the smallest coherent change, respect all approvals, and report files changed plus verification. Do not delegate work.",
};

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const REVIEWER_TOOLS = [...READ_ONLY_TOOLS, "workspace_changes"];

function textFromMessage(event: Extract<AgentDriverEvent, { type: "message.completed" }>["message"]): string {
  return event.blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
}

function roleProfile(profile: AgentProfileDefinition, role: SubagentRoleDefinition["id"]): AgentProfileDefinition {
  const activeToolNames = role === "worker" ? profile.activeToolNames : role === "reviewer" ? REVIEWER_TOOLS : READ_ONLY_TOOLS;
  return {
    ...profile,
    systemPrompt: `${profile.systemPrompt}\n\n${ROLE_PROMPTS[role]}`,
    activeToolNames,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export class SessionSubagentRunner implements SubagentRunner, SubagentTaskExecutor {
  private readonly options: SessionSubagentRunnerOptions;
  private readonly pool: SubagentTaskPool;
  private readonly active = new Map<string, SubagentTaskEntry>();

  constructor(options: SessionSubagentRunnerOptions) {
    this.options = options;
    this.pool = new SubagentTaskPool({ executor: this });
  }

  run(task: SubagentTask, options?: { signal?: AbortSignal; onUpdate?: (progress: SubagentTaskProgress) => void }): Promise<SubagentResult> {
    return this.pool.run(task, options);
  }

  async cancel(taskId: string): Promise<void> {
    await this.pool.cancel(taskId);
  }

  async resolveOperationApproval(approvalId: string, approved: boolean, feedback?: string): Promise<boolean> {
    for (const entry of this.active.values()) {
      if (!entry.approvals.has(approvalId)) continue;
      await entry.session.execute({ type: "resolve-approval", resolution: { approvalId, approved, feedback } });
      return true;
    }
    return false;
  }

  async resolveUserRequest(
    requestId: string,
    resolution: { status: "submitted" | "cancelled"; answers?: Record<string, string | string[] | boolean>; feedback?: string },
  ): Promise<boolean> {
    for (const entry of this.active.values()) {
      if (!entry.userRequests.has(requestId)) continue;
      await entry.session.execute({ type: "resolve-user-request", resolution: { requestId, ...resolution } });
      return true;
    }
    return false;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.active.keys()].map((taskId) => this.cancel(taskId)));
  }

  async execute(task: SubagentTask, signal: AbortSignal, onUpdate?: (progress: SubagentTaskProgress) => void): Promise<SubagentResult> {
    const modelReference = task.model ?? this.options.parent.model;
    const model = this.options.resolveModel(modelReference);
    const modelCapabilities = this.options.resolveCapabilities(modelReference);
    if (modelCapabilities.supportsToolUse === false) throw new Error("The selected subagent model does not support tool use");
    const profile = roleProfile(this.options.profile, task.role);
    const path = join(this.options.journalsRoot, "subagents", this.options.parent.id, `${task.id}.jsonl`);
    const record: SessionRecord = {
      ...this.options.parent,
      id: task.id,
      title: `${task.role}: ${task.prompt.slice(0, 54)}`,
      profile: profile.reference,
      model: modelReference,
      journalPath: path,
      connectorIds: task.role === "worker" ? this.options.parent.connectorIds : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const journal = await createWordlessSession({
      id: task.id,
      createdAt: new Date(record.createdAt).toISOString(),
      cwd: task.cwd,
      path,
      metadata: { parentSessionId: this.options.parent.id, subagentTaskId: task.id, role: task.role },
    });
    const childContext: AgentDriverSessionContext = {
      record,
      profile,
      model,
      modelCapabilities,
      models: this.options.models,
      session: journal,
      env: this.options.env,
      skills: this.options.skills,
      connectorTools: task.role === "worker" ? this.options.connectorTools : [],
      connectorToolPolicies: task.role === "worker" ? this.options.connectorToolPolicies : [],
      security: this.options.security,
      resolveModel: this.options.resolveModel,
      executionKind: "subagent",
    };
    const session = await this.options.driver.createSession(childContext);
    const entry: SubagentTaskEntry = { session, unsubscribe: () => {}, approvals: new Map(), userRequests: new Map() };
    let output = "";
    let usage: SubagentResult["usage"];
    entry.unsubscribe = session.subscribe((event) => {
      if (event.type === "message.completed" && event.message.role === "assistant") {
        output = textFromMessage(event.message);
        usage = mergeConversationUsage(usage, event.message.usage);
        onUpdate?.({ taskId: task.id, status: "running", output, usage });
      }
      if (event.type === "tool.started") onUpdate?.({ taskId: task.id, status: "running", tool: { name: event.name, input: event.input, state: "running" } });
      if (event.type === "tool.updated") onUpdate?.({ taskId: task.id, status: "running", tool: { name: "tool", input: {}, output: event.output, state: "running" } });
      if (event.type === "tool.completed") onUpdate?.({ taskId: task.id, status: "running", tool: { name: "tool", input: {}, output: event.output, state: event.isError ? "error" : "complete" } });
      if (event.type === "approval.requested") {
        entry.approvals.set(event.approval.approvalId, event.approval);
        onUpdate?.({ taskId: task.id, status: "awaiting-approval", approval: event.approval });
      }
      if (event.type === "approval.resolved") {
        const approval = asRecord(entry.approvals.get(event.resolution.approvalId));
        entry.approvals.delete(event.resolution.approvalId);
        onUpdate?.({
          taskId: task.id,
          status: "running",
          ...(approval ? { approval: { ...approval, status: event.resolution.approved ? "approved" : "rejected", feedback: event.resolution.feedback } } : {}),
        });
      }
      if (event.type === "user-request.requested") {
        entry.userRequests.set(event.request.requestId, event.request);
        onUpdate?.({ taskId: task.id, status: "awaiting-user-input", userRequest: { request: event.request } });
      }
      if (event.type === "user-request.resolved") {
        const request = entry.userRequests.get(event.resolution.requestId);
        entry.userRequests.delete(event.resolution.requestId);
        onUpdate?.({ taskId: task.id, status: "running", ...(request ? { userRequest: { request, resolution: event.resolution } } : {}) });
      }
    });
    this.active.set(task.id, entry);
    const onAbort = () => void session.execute({ type: "cancel" });
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await session.execute({ type: "prompt", text: task.prompt });
      const result: SubagentResult = { taskId: task.id, status: signal.aborted ? "cancelled" : "completed", text: output, usage };
      onUpdate?.({ taskId: task.id, status: result.status, output: result.text, usage: result.usage });
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      const status = signal.aborted ? "cancelled" : "failed";
      onUpdate?.({ taskId: task.id, status, output, usage });
      return { taskId: task.id, status, text: output, usage, error };
    } finally {
      signal.removeEventListener("abort", onAbort);
      await this.options.onFilesChanged(await this.collectFileChanges(path, task));
      entry.unsubscribe();
      session.dispose();
      this.active.delete(task.id);
    }
  }

  private async collectFileChanges(path: string, task: SubagentTask): Promise<SubagentFileChange[]> {
    const journal = await openWordlessSession(path);
    const baselines = new Map<string, { path: string; existed: boolean; content: string | null }>();
    const changes = new Map<string, SubagentFileChange>();
    for (const entry of await journal.getEntries()) {
      const custom = entry as unknown as { type: string; customType?: string; data?: unknown };
      if (custom.type === "custom" && custom.customType === "wordless.session-file-baseline") {
        const data = asRecord(custom.data);
        const baseline = asRecord(data?.baseline);
        if (typeof data?.callId !== "string" || typeof baseline?.path !== "string" || typeof baseline.existed !== "boolean" || (typeof baseline.content !== "string" && baseline.content !== null)) continue;
        baselines.set(data.callId, { path: baseline.path, existed: baseline.existed, content: baseline.content });
        continue;
      }
      if (entry.type !== "message") continue;
      const message = asRecord(entry.message);
      if (message?.role !== "toolResult" || message.isError === true || (message.toolName !== "write" && message.toolName !== "edit") || typeof message.toolCallId !== "string") continue;
      const details = asRecord(message.details);
      const change = asRecord(details?.change);
      const baseline = baselines.get(message.toolCallId);
      if (!baseline || typeof details?.path !== "string" || (change?.kind !== "created" && change?.kind !== "modified")) continue;
      if (!changes.has(details.path)) changes.set(details.path, { taskId: task.id, role: task.role, path: details.path, baseline, kind: change.kind });
    }
    return [...changes.values()];
  }
}
