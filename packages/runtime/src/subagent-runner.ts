import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  SubagentTaskPool,
  type SubagentTaskExecutor,
} from "@wordless/agent-extension-runtime";
import type {
  SubagentResult,
  SubagentRoleDefinition,
  SubagentRunner,
  SubagentTask,
  SubagentTaskProgress,
} from "@wordless/agent-extension-sdk";
import type {
  AgentDriver,
  AgentDriverEvent,
  AgentDriverSession,
  AgentDriverSessionContext,
  AgentProfileDefinition,
  AgentRuntimeSkill,
  ConnectorToolPolicy,
  OperationApprovalRequest,
  OperationApprovalResolution,
} from "@wordless/agent-driver-sdk";
import type { AgentTool, ExecutionEnv } from "@wordless/agent";
import type { WorkspaceSearchProvider } from "@wordless/workspace-search";
import {
  clampThinkingLevel,
  type Api,
  type Model,
  type Models,
} from "@wordless/ai";
import {
  mergeConversationUsage,
  type ConversationMessage,
  type ExpertExecutionProfile,
  type ModelCapabilities,
  type ModelReference,
  type SecurityPolicySnapshot,
  type SessionRecord,
  type ThinkingLevel,
  type ToolApprovalMode,
} from "@wordless/domain";
import {
  createWordlessSession,
  openWordlessSession,
} from "@wordless/persistence";

type SubagentTaskEntry = {
  session: AgentDriverSession;
  memberId?: string;
  unsubscribe: () => void;
  approvals: Map<string, unknown>;
  userRequests: Map<string, unknown>;
  tools: Map<
    string,
    { name: string; input: Record<string, unknown>; output?: string }
  >;
};

export interface SessionSubagentRunnerOptions {
  parent: SessionRecord;
  profile: AgentProfileDefinition;
  driver: AgentDriver;
  models: Models;
  env: ExecutionEnv;
  createExecutionEnv?: (
    rootPath: string,
    accessLevel: SessionRecord["accessLevel"],
    readOnlyRoots: string[],
  ) => ExecutionEnv;
  workspaceSearch: WorkspaceSearchProvider;
  skills: AgentRuntimeSkill[];
  connectorTools: AgentTool[];
  connectorToolPolicies: ConnectorToolPolicy[];
  security: SecurityPolicySnapshot;
  journalsRoot: string;
  resolveModel(reference: ModelReference): Model<Api>;
  resolveCapabilities(reference: ModelReference): ModelCapabilities;
  onFilesChanged(changes: SubagentFileChange[]): Promise<void>;
  toolApprovalMode: ToolApprovalMode;
  onExpertMemberEvent?: (event: ExpertMemberStreamEvent) => void;
  expertTeamDelegates?: {
    id: string;
    name: string;
    executionProfile: ExpertExecutionProfile;
    responsibility: string;
    systemPrompt: string;
    skillIds: string[];
    connectorIds: string[];
    model?: ModelReference;
    thinkingLevel?: ThinkingLevel;
  }[];
}

export interface SubagentFileChange {
  taskId: string;
  role: SubagentRoleDefinition["id"] | "expert-member";
  path: string;
  baseline: { path: string; existed: boolean; content: string | null };
  kind: "created" | "modified";
}

export type ExpertMemberStreamEvent =
  | { type: "message.started"; memberId: string; taskId: string; message: ConversationMessage; revision: number }
  | { type: "message.text.delta"; memberId: string; taskId: string; messageId: string; delta: string; revision: number }
  | { type: "message.reasoning.delta"; memberId: string; taskId: string; messageId: string; delta: string; revision: number }
  | { type: "message.completed"; memberId: string; taskId: string; message: ConversationMessage; revision: number }
  | { type: "tool.started"; memberId: string; taskId: string; messageId: string; callId: string; name: string; input: Record<string, unknown> }
  | { type: "tool.updated"; memberId: string; taskId: string; messageId: string; callId: string; output: string; details?: unknown }
  | { type: "tool.completed"; memberId: string; taskId: string; messageId: string; callId: string; output: string; details?: unknown; isError: boolean }
  | { type: "approval.requested"; memberId: string; taskId: string; messageId: string; approval: OperationApprovalRequest }
  | { type: "approval.resolved"; memberId: string; taskId: string; messageId: string; resolution: OperationApprovalResolution };

export interface ExpertMemberLiveMessage {
  memberId: string;
  taskId: string;
  message: ConversationMessage;
  revision: number;
}

const ROLE_PROMPTS: Record<SubagentRoleDefinition["id"], string> = {
  scout:
    "You are the Scout subagent. Discover relevant facts in the workspace using only your assigned read-only tools. Return concise findings with file references. Do not make changes and do not delegate work.",
  planner:
    "You are the Planner subagent. Inspect the workspace and produce an actionable implementation plan. Explain dependencies, risks, and verification. Do not make changes and do not delegate work.",
  reviewer:
    "You are the Reviewer subagent. Inspect the completed work, verify correctness, identify risks, and suggest focused improvements. Do not make changes and do not delegate work.",
  worker:
    "You are the Worker subagent. Complete the assigned implementation task within its stated scope. Use the smallest coherent change, respect all approvals, and report files changed plus verification. Do not delegate work.",
  researcher:
    "You are a Researcher subagent. Work only on the assigned confirmed research dimension. Use available search connectors to discover sources, call research_snapshot for every source actually used, then call research_submit_dimension with concise claims whose evidenceRefs contain only returned source ids. Never rely on model memory for factual claims, never write the shared report directly, and do not delegate work.",
  "research-reviewer":
    "You are a Research Reviewer subagent. Read the submitted dimension evidence and source snapshots. Check whether every claim is supported, whether sources are sufficiently independent and current, and whether conflicts or material gaps remain. Record the verdict with research_review_dimension. Do not add new factual claims and do not delegate work.",
};

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const REVIEWER_TOOLS = [...READ_ONLY_TOOLS, "workspace_changes"];
const RESEARCHER_TOOLS = [
  ...READ_ONLY_TOOLS,
  "research_snapshot",
  "research_submit_dimension",
];
const RESEARCH_REVIEWER_TOOLS = [
  ...READ_ONLY_TOOLS,
  "research_review_dimension",
];

function textFromMessage(
  event: Extract<AgentDriverEvent, { type: "message.completed" }>["message"],
): string {
  return event.blocks
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

function roleProfile(
  profile: AgentProfileDefinition,
  role: SubagentRoleDefinition["id"],
): AgentProfileDefinition {
  const researchTools = profile.activeToolNames.filter((name) =>
    RESEARCHER_TOOLS.includes(name),
  );
  const activeToolNames =
    role === "worker"
      ? profile.activeToolNames
      : role === "reviewer"
        ? [
            ...REVIEWER_TOOLS,
            ...profile.activeToolNames.filter(
              (name) => name === "workspace_changes",
            ),
          ]
        : role === "researcher" && researchTools.length > 0
          ? [...READ_ONLY_TOOLS, ...researchTools]
          : role === "research-reviewer" &&
              profile.activeToolNames.includes("research_review_dimension")
            ? [...READ_ONLY_TOOLS, "research_review_dimension"]
            : READ_ONLY_TOOLS;
  return {
    ...profile,
    systemPrompt: `${profile.systemPrompt}\n\n${ROLE_PROMPTS[role]}`,
    activeToolNames,
  };
}

type ResolvedExpertMember = NonNullable<
  SessionSubagentRunnerOptions["expertTeamDelegates"]
>[number];

export function connectorPoliciesForExpertMember(
  member: Pick<ResolvedExpertMember, "connectorIds" | "executionProfile">,
  policies: readonly ConnectorToolPolicy[],
): ConnectorToolPolicy[] {
  return policies.filter(
    (policy) =>
      member.connectorIds.includes(policy.connectorId) &&
      (member.executionProfile !== "research" || policy.destructive !== true),
  );
}

const EXPERT_PROFILE_CONSTRAINTS: Record<ExpertExecutionProfile, string> = {
  "read-only":
    "Work read-only. Inspect available context and return a focused result. Do not change files or delegate work.",
  review:
    "Review the assigned material using read-only tools. Identify concrete issues and actionable improvements. Do not change files or delegate work.",
  research:
    "Research the assigned question using only the tools and connectors available to you. Distinguish evidence from assumptions and do not delegate work.",
  "workspace-write":
    "You may use the available workspace tools to complete the assigned work. Stay within scope, respect approvals, and do not delegate work.",
};

function expertProfile(
  profile: AgentProfileDefinition,
  member: ResolvedExpertMember,
  connectorToolNames: readonly string[],
): AgentProfileDefinition {
  const activeToolNames =
    member.executionProfile === "workspace-write"
      ? profile.activeToolNames.filter(
          (name) =>
            !name.startsWith("mcp_") || connectorToolNames.includes(name),
        )
      : member.executionProfile === "research"
        ? [
            ...READ_ONLY_TOOLS,
            ...profile.activeToolNames.filter((name) =>
              connectorToolNames.includes(name),
            ),
          ]
        : member.executionProfile === "review"
          ? REVIEWER_TOOLS
          : READ_ONLY_TOOLS;
  return {
    ...profile,
    systemPrompt: `${profile.systemPrompt}\n\nYou are ${member.name}, a member of the selected expert team. Stay in this expert identity throughout the task.\n\nExpert instructions:\n${member.systemPrompt}\n\nTeam responsibility:\n${member.responsibility}\n\nExecution constraints:\n${EXPERT_PROFILE_CONSTRAINTS[member.executionProfile]}\n\nSession artifacts:\nWhen creating or editing files, use the current working directory and keep all deliverables inside it. Report paths relative to that directory. Do not write to absolute paths outside the current session artifact directory. Other members' artifact directories are available read-only through sibling paths when their files are needed.`,
    activeToolNames: [...new Set(activeToolNames)],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeArtifactDirectoryName(memberId: string): string {
  const safe = memberId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "member";
}

function appendConversationDelta(
  message: ConversationMessage,
  type: "text" | "reasoning",
  delta: string,
): ConversationMessage {
  const blocks = [...message.blocks];
  const last = blocks.at(-1);
  if (last?.type === type)
    blocks[blocks.length - 1] = { ...last, text: last.text + delta };
  else blocks.push({ type, text: delta });
  return { ...message, blocks };
}

function recoverableSubagentError(message: string, output: string): boolean {
  if (output.length > 0) return true;
  return /(?:stream|finish_reason|terminated|timeout|timed out|rate.?limit|temporar|network|connection|token generation|internal error)/i.test(
    message,
  );
}

export function delegatedTaskModelReference(
  task: SubagentTask,
  parentModel: ModelReference,
  memberModel?: ModelReference,
): ModelReference {
  return task.kind === "expert-member"
    ? (memberModel ?? parentModel)
    : (task.model ?? parentModel);
}

export function delegatedTaskThinkingLevelRequest(
  memberLevel: ThinkingLevel | undefined,
  parentLevel: ThinkingLevel,
): ThinkingLevel {
  return memberLevel ?? parentLevel;
}

export function resolveDelegatedTaskModel(
  task: SubagentTask,
  parentModel: ModelReference,
  memberModel: ModelReference | undefined,
  resolveModel: (reference: ModelReference) => Model<Api>,
  resolveCapabilities: (reference: ModelReference) => ModelCapabilities,
): {
  reference: ModelReference;
  model: Model<Api>;
  capabilities: ModelCapabilities;
  fallbackReason?: "unavailable" | "tools-unsupported";
} {
  const requested = delegatedTaskModelReference(task, parentModel, memberModel);
  let reference = requested;
  let model: Model<Api>;
  let capabilities: ModelCapabilities;
  let fallbackReason: "unavailable" | "tools-unsupported" | undefined;
  try {
    model = resolveModel(reference);
    capabilities = resolveCapabilities(reference);
  } catch (cause) {
    if (!memberModel) throw cause;
    fallbackReason = "unavailable";
    reference = parentModel;
    model = resolveModel(reference);
    capabilities = resolveCapabilities(reference);
  }
  if (capabilities.supportsToolUse === false) {
    if (!memberModel || fallbackReason)
      throw new Error("The selected subagent model does not support tool use");
    fallbackReason = "tools-unsupported";
    reference = parentModel;
    model = resolveModel(reference);
    capabilities = resolveCapabilities(reference);
    if (capabilities.supportsToolUse === false)
      throw new Error("The selected subagent model does not support tool use");
  }
  return {
    reference,
    model,
    capabilities,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

export class SessionSubagentRunner
  implements SubagentRunner, SubagentTaskExecutor
{
  private readonly options: SessionSubagentRunnerOptions;
  private readonly pool: SubagentTaskPool;
  private readonly active = new Map<string, SubagentTaskEntry>();
  private readonly memberQueues = new Map<string, Promise<void>>();
  private readonly liveMessages = new Map<string, ExpertMemberLiveMessage>();
  private readonly resolvedApprovalIds = new Map<string, boolean>();
  private readonly expertMembers: ReadonlyMap<string, ResolvedExpertMember>;

  constructor(options: SessionSubagentRunnerOptions) {
    this.options = options;
    this.expertMembers = new Map(
      (options.expertTeamDelegates ?? []).map((member) => [member.id, member]),
    );
    this.pool = new SubagentTaskPool({ executor: this });
  }

  run(
    task: SubagentTask,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (progress: SubagentTaskProgress) => void;
    },
  ): Promise<SubagentResult> {
    return this.pool.run(task, options);
  }

  async cancel(taskId: string): Promise<void> {
    await this.pool.cancel(taskId);
  }

  getExpertMemberLiveState(memberId: string): ExpertMemberLiveMessage | null {
    const state = this.liveMessages.get(memberId);
    return state ? structuredClone(state) : null;
  }

  async resolveOperationApproval(
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ): Promise<boolean> {
    if (this.resolvedApprovalIds.has(approvalId)) return true;
    for (const entry of this.active.values()) {
      if (!entry.approvals.has(approvalId)) continue;
      this.rememberResolvedApproval(approvalId, approved);
      try {
        await entry.session.execute({
          type: "resolve-approval",
          resolution: { approvalId, approved, feedback },
        });
      } catch (cause) {
        this.resolvedApprovalIds.delete(approvalId);
        throw cause;
      }
      return true;
    }
    return false;
  }

  async setToolApprovalMode(mode: ToolApprovalMode): Promise<void> {
    const previous = this.options.toolApprovalMode;
    this.options.toolApprovalMode = mode;
    try {
      await Promise.all(
        [...this.active.values()].map((entry) =>
          entry.session.execute({ type: "set-tool-approval-mode", mode }),
        ),
      );
    } catch (cause) {
      this.options.toolApprovalMode = previous;
      await Promise.allSettled(
        [...this.active.values()].map((entry) =>
          entry.session.execute({
            type: "set-tool-approval-mode",
            mode: previous,
          }),
        ),
      );
      throw cause;
    }
  }

  async resolveUserRequest(
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, string | string[] | boolean>;
      feedback?: string;
    },
  ): Promise<boolean> {
    for (const entry of this.active.values()) {
      if (!entry.userRequests.has(requestId)) continue;
      await entry.session.execute({
        type: "resolve-user-request",
        resolution: { requestId, ...resolution },
      });
      return true;
    }
    return false;
  }

  async dispose(): Promise<void> {
    await this.pool.dispose();
  }

  async execute(
    task: SubagentTask,
    signal: AbortSignal,
    onUpdate?: (progress: SubagentTaskProgress) => void,
  ): Promise<SubagentResult> {
    if (task.kind === "builtin-subagent")
      return await this.executeTask(task, signal, onUpdate);
    const previous = this.memberQueues.get(task.memberId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.memberQueues.set(task.memberId, tail);
    await previous;
    try {
      if (signal.aborted)
        return {
          taskId: task.id,
          status: "cancelled",
          text: "",
          error: "The task was cancelled before the expert became available",
        };
      return await this.executeTask(task, signal, onUpdate);
    } finally {
      release();
      if (this.memberQueues.get(task.memberId) === tail)
        this.memberQueues.delete(task.memberId);
    }
  }

  private async executeTask(
    task: SubagentTask,
    signal: AbortSignal,
    onUpdate?: (progress: SubagentTaskProgress) => void,
  ): Promise<SubagentResult> {
    const member =
      task.kind === "expert-member"
        ? this.expertMembers.get(task.memberId)
        : undefined;
    if (task.kind === "expert-member" && !member)
      throw new Error(`Unknown expert team member: ${task.memberId}`);
    const role = task.kind === "builtin-subagent" ? task.role : undefined;
    const modelResolution = resolveDelegatedTaskModel(
      task,
      this.options.parent.model,
      member?.model,
      this.options.resolveModel,
      this.options.resolveCapabilities,
    );
    const modelReference = modelResolution.reference;
    const model = modelResolution.model;
    const modelCapabilities = modelResolution.capabilities;
    const requestedThinkingLevel = delegatedTaskThinkingLevelRequest(
      member?.thinkingLevel,
      this.options.parent.thinkingLevel,
    );
    const thinkingLevel = model.reasoning
      ? clampThinkingLevel(model, requestedThinkingLevel)
      : "off";
    const memberConnectorPolicies = member
      ? connectorPoliciesForExpertMember(
          member,
          this.options.connectorToolPolicies,
        )
      : [];
    const memberConnectorNames = new Set(
      memberConnectorPolicies.map((policy) => policy.agentToolName),
    );
    const memberConnectorTools = member
      ? this.options.connectorTools.filter((tool) =>
          memberConnectorNames.has(tool.name),
        )
      : [];
    const profile = member
      ? expertProfile(this.options.profile, member, [...memberConnectorNames])
      : roleProfile(this.options.profile, role!);
    const path = member
      ? join(
          this.options.journalsRoot,
          "subagents",
          this.options.parent.id,
          "members",
          `${member.id}.jsonl`,
        )
      : join(
          this.options.journalsRoot,
          "subagents",
          this.options.parent.id,
          `${task.id}.jsonl`,
        );
    const sessionArtifactsRoot = join(
      this.options.parent.runtimeRootPath,
      "artifacts",
    );
    const artifactRoot = member
      ? join(sessionArtifactsRoot, safeArtifactDirectoryName(member.id))
      : this.options.parent.workbenchId === "conversation" &&
          task.kind === "builtin-subagent"
        ? join(
            sessionArtifactsRoot,
            "subagents",
            safeArtifactDirectoryName(task.role),
            safeArtifactDirectoryName(task.id),
          )
        : undefined;
    if (artifactRoot) await mkdir(artifactRoot, { recursive: true });
    const childRoot = artifactRoot ?? this.options.parent.runtimeRootPath;
    const record: SessionRecord = {
      ...this.options.parent,
      id: task.id,
      title: `${member?.name ?? role}: ${task.prompt.slice(0, 54)}`,
      profile: profile.reference,
      model: modelReference,
      thinkingLevel,
      runtimeRootPath: childRoot,
      journalPath: path,
      connectorIds: member
        ? member.connectorIds
        : role === "worker" ||
            (role === "researcher" &&
              profile.activeToolNames.some((name) =>
                this.options.connectorTools.some((tool) => tool.name === name),
              ))
          ? this.options.parent.connectorIds
          : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const journal = await (async () => {
      try {
        return await openWordlessSession(path);
      } catch {
        return await createWordlessSession({
          id: member
            ? `${this.options.parent.id}:member:${member.id}`
            : task.id,
          createdAt: new Date(record.createdAt).toISOString(),
          cwd: childRoot,
          path,
          metadata: {
            parentSessionId: this.options.parent.id,
            subagentTaskId: task.id,
            ...(member
              ? {
                  memberId: member.id,
                  executionProfile: member.executionProfile,
                }
              : { role }),
          },
        });
      }
    })();
    const journalEntryOffset = (await journal.getEntries()).length;
    await journal.appendModelChange(
      modelReference.connectionId,
      modelReference.modelId,
    );
    await journal.appendThinkingLevelChange(record.thinkingLevel);
    onUpdate?.({
      taskId: task.id,
      status: "running",
      modelResolution: {
        requested:
          task.kind === "expert-member" ? (member?.model ?? null) : task.model,
        resolved: modelReference,
        thinkingLevel: record.thinkingLevel,
        ...(modelResolution.fallbackReason
          ? { fallbackReason: modelResolution.fallbackReason }
          : {}),
      },
    });
    const childContext: AgentDriverSessionContext = {
      record,
      profile,
      model,
      modelCapabilities,
      models: this.options.models,
      session: journal,
      env:
        member && this.options.createExecutionEnv
          ? this.options.createExecutionEnv(
              childRoot,
              record.accessLevel,
              [...this.options.skills.map((skill) => skill.baseDir), sessionArtifactsRoot],
            )
          : this.options.env,
      workspaceSearch: this.options.workspaceSearch,
      skills: member
        ? this.options.skills.filter((skill) =>
            member.skillIds.includes(skill.id),
          )
        : this.options.skills,
      connectorTools: member
        ? memberConnectorTools
        : role === "worker" ||
            (role === "researcher" &&
              profile.activeToolNames.some((name) =>
                this.options.connectorTools.some((tool) => tool.name === name),
              ))
          ? this.options.connectorTools
          : [],
      connectorToolPolicies: member
        ? memberConnectorPolicies
        : role === "worker" ||
            (role === "researcher" &&
              profile.activeToolNames.some((name) =>
                this.options.connectorTools.some((tool) => tool.name === name),
              ))
          ? this.options.connectorToolPolicies
          : [],
      security: this.options.security,
      resolveModel: this.options.resolveModel,
      executionKind: "subagent",
      resourceOwnerSessionId: this.options.parent.id,
      allowUserRequests: member
        ? member.executionProfile !== "research"
        : role !== "researcher" && role !== "research-reviewer",
      toolApprovalMode: this.options.toolApprovalMode,
    };
    const session = await this.options.driver.createSession(childContext);
    const entry: SubagentTaskEntry = {
      session,
      ...(member ? { memberId: member.id } : {}),
      unsubscribe: () => {},
      approvals: new Map(),
      userRequests: new Map(),
      tools: new Map(),
    };
    let output = "";
    let usage: SubagentResult["usage"];
    let finalAssistantMessage: ConversationMessage | undefined;
    entry.unsubscribe = session.subscribe((event) => {
      if (task.kind === "expert-member") {
        if (
          event.type === "message.started" &&
          event.message.role === "assistant"
        ) {
          const live = {
            memberId: task.memberId,
            taskId: task.id,
            message: event.message,
            revision: 0,
          };
          this.liveMessages.set(task.memberId, live);
          this.options.onExpertMemberEvent?.({
            type: "message.started",
            memberId: task.memberId,
            taskId: task.id,
            message: event.message,
            revision: live.revision,
          });
        } else if (
          event.type === "message.text.delta" ||
          event.type === "message.reasoning.delta"
        ) {
          const current = this.liveMessages.get(task.memberId);
          const message =
            current?.message.id === event.messageId
              ? current.message
              : {
                  id: event.messageId,
                  role: "assistant" as const,
                  status: "streaming" as const,
                  blocks: [],
                  model: modelReference,
                  timestamp: Date.now(),
                };
          const live = {
            memberId: task.memberId,
            taskId: task.id,
            message: appendConversationDelta(
              message,
              event.type === "message.text.delta" ? "text" : "reasoning",
              event.delta,
            ),
            revision: (current?.revision ?? 0) + 1,
          };
          this.liveMessages.set(task.memberId, live);
          this.options.onExpertMemberEvent?.({
            type: event.type,
            memberId: task.memberId,
            taskId: task.id,
            messageId: event.messageId,
            delta: event.delta,
            revision: live.revision,
          });
        } else if (
          event.type === "message.completed" &&
          event.message.role === "assistant"
        ) {
          const current = this.liveMessages.get(task.memberId);
          const live = {
            memberId: task.memberId,
            taskId: task.id,
            message: event.message,
            revision: (current?.revision ?? 0) + 1,
          };
          this.liveMessages.set(task.memberId, live);
          this.options.onExpertMemberEvent?.({
            type: "message.completed",
            memberId: task.memberId,
            taskId: task.id,
            message: event.message,
            revision: live.revision,
          });
        }
      }
      if (
        event.type === "message.completed" &&
        event.message.role === "assistant"
      ) {
        finalAssistantMessage = event.message;
        output = textFromMessage(event.message);
        usage = mergeConversationUsage(usage, event.message.usage);
        onUpdate?.({ taskId: task.id, status: "running", output, usage });
      }
      if (event.type === "tool.started") {
        entry.tools.set(event.callId, { name: event.name, input: event.input });
        onUpdate?.({
          taskId: task.id,
          status: "running",
          tool: {
            callId: event.callId,
            name: event.name,
            input: event.input,
            state: "running",
          },
        });
        if (task.kind === "expert-member")
          this.options.onExpertMemberEvent?.({
            ...event,
            memberId: task.memberId,
            taskId: task.id,
          });
      }
      if (event.type === "tool.updated") {
        const current = entry.tools.get(event.callId) ?? {
          name: "tool",
          input: {},
        };
        const next = { ...current, output: event.output };
        entry.tools.set(event.callId, next);
        onUpdate?.({
          taskId: task.id,
          status: "running",
          tool: { callId: event.callId, ...next, state: "running" },
        });
        if (task.kind === "expert-member")
          this.options.onExpertMemberEvent?.({
            ...event,
            memberId: task.memberId,
            taskId: task.id,
          });
      }
      if (event.type === "tool.completed") {
        const current = entry.tools.get(event.callId) ?? {
          name: "tool",
          input: {},
        };
        onUpdate?.({
          taskId: task.id,
          status: "running",
          tool: {
            callId: event.callId,
            ...current,
            output: event.output,
            state: event.isError ? "error" : "complete",
          },
        });
        entry.tools.delete(event.callId);
        if (task.kind === "expert-member")
          this.options.onExpertMemberEvent?.({
            ...event,
            memberId: task.memberId,
            taskId: task.id,
          });
      }
      if (event.type === "approval.requested") {
        entry.approvals.set(event.approval.approvalId, event.approval);
        onUpdate?.({
          taskId: task.id,
          status: "awaiting-approval",
          approval: event.approval,
        });
        if (task.kind === "expert-member")
          this.options.onExpertMemberEvent?.({
            ...event,
            memberId: task.memberId,
            taskId: task.id,
          });
      }
      if (event.type === "approval.resolved") {
        const approval = asRecord(
          entry.approvals.get(event.resolution.approvalId),
        );
        entry.approvals.delete(event.resolution.approvalId);
        this.rememberResolvedApproval(
          event.resolution.approvalId,
          event.resolution.approved,
        );
        onUpdate?.({
          taskId: task.id,
          status: "running",
          ...(approval
            ? {
                approval: {
                  ...approval,
                  status: event.resolution.approved ? "approved" : "rejected",
                  feedback: event.resolution.feedback,
                },
              }
            : {}),
        });
        if (task.kind === "expert-member")
          this.options.onExpertMemberEvent?.({
            ...event,
            memberId: task.memberId,
            taskId: task.id,
          });
      }
      if (event.type === "user-request.requested") {
        entry.userRequests.set(event.request.requestId, event.request);
        onUpdate?.({
          taskId: task.id,
          status: "awaiting-user-input",
          userRequest: { request: event.request },
        });
      }
      if (event.type === "user-request.resolved") {
        const request = entry.userRequests.get(event.resolution.requestId);
        entry.userRequests.delete(event.resolution.requestId);
        onUpdate?.({
          taskId: task.id,
          status: "running",
          ...(request
            ? { userRequest: { request, resolution: event.resolution } }
            : {}),
        });
      }
    });
    this.active.set(task.id, entry);
    const onAbort = () => void session.execute({ type: "cancel" });
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await session.execute({ type: "prompt", text: task.prompt });
      const terminalError = finalAssistantMessage?.errorMessage;
      const status: SubagentResult["status"] = signal.aborted
        ? "cancelled"
        : task.kind !== "expert-member"
          ? "completed"
          : finalAssistantMessage?.status === "aborted"
            ? "cancelled"
            : finalAssistantMessage?.status === "error"
              ? recoverableSubagentError(terminalError ?? "", output)
                ? "interrupted"
                : "failed"
              : finalAssistantMessage?.status === "complete"
                ? "completed"
                : "failed";
      const error =
        status === "completed"
          ? undefined
          : terminalError ??
            (status === "cancelled"
              ? "The expert task was cancelled"
              : "The expert task ended without a complete assistant response");
      const result: SubagentResult = {
        taskId: task.id,
        status,
        text: output,
        usage,
        ...(error ? { error } : {}),
      };
      onUpdate?.({
        taskId: task.id,
        status: result.status,
        output: result.text,
        usage: result.usage,
      });
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      const status: SubagentResult["status"] = signal.aborted
        ? "cancelled"
        : task.kind === "expert-member" &&
            recoverableSubagentError(error, output)
          ? "interrupted"
          : "failed";
      onUpdate?.({ taskId: task.id, status, output, usage });
      return { taskId: task.id, status, text: output, usage, error };
    } finally {
      signal.removeEventListener("abort", onAbort);
      await this.options.onFilesChanged(
        await this.collectFileChanges(path, task, journalEntryOffset),
      );
      entry.unsubscribe();
      session.dispose();
      this.active.delete(task.id);
      if (member && this.liveMessages.get(member.id)?.taskId === task.id)
        this.liveMessages.delete(member.id);
    }
  }

  private rememberResolvedApproval(approvalId: string, approved: boolean): void {
    this.resolvedApprovalIds.delete(approvalId);
    this.resolvedApprovalIds.set(approvalId, approved);
    if (this.resolvedApprovalIds.size <= 256) return;
    const oldest = this.resolvedApprovalIds.keys().next().value;
    if (oldest) this.resolvedApprovalIds.delete(oldest);
  }

  private async collectFileChanges(
    path: string,
    task: SubagentTask,
    journalEntryOffset: number,
  ): Promise<SubagentFileChange[]> {
    const journal = await openWordlessSession(path);
    const baselines = new Map<
      string,
      { path: string; existed: boolean; content: string | null }
    >();
    const changes = new Map<string, SubagentFileChange>();
    for (const entry of (await journal.getEntries()).slice(
      journalEntryOffset,
    )) {
      const custom = entry as unknown as {
        type: string;
        customType?: string;
        data?: unknown;
      };
      if (
        custom.type === "custom" &&
        custom.customType === "wordless.session-file-baseline"
      ) {
        const data = asRecord(custom.data);
        const baseline = asRecord(data?.baseline);
        if (
          typeof data?.callId !== "string" ||
          typeof baseline?.path !== "string" ||
          typeof baseline.existed !== "boolean" ||
          (typeof baseline.content !== "string" && baseline.content !== null)
        )
          continue;
        baselines.set(data.callId, {
          path: baseline.path,
          existed: baseline.existed,
          content: baseline.content,
        });
        continue;
      }
      if (entry.type !== "message") continue;
      const message = asRecord(entry.message);
      if (
        message?.role !== "toolResult" ||
        message.isError === true ||
        (message.toolName !== "write" && message.toolName !== "edit") ||
        typeof message.toolCallId !== "string"
      )
        continue;
      const details = asRecord(message.details);
      const change = asRecord(details?.change);
      const baseline = baselines.get(message.toolCallId);
      if (
        !baseline ||
        typeof details?.path !== "string" ||
        (change?.kind !== "created" && change?.kind !== "modified")
      )
        continue;
      if (!changes.has(details.path))
        changes.set(details.path, {
          taskId: task.id,
          role: task.kind === "builtin-subagent" ? task.role : "expert-member",
          path: details.path,
          baseline,
          kind: change.kind,
        });
    }
    return [...changes.values()];
  }
}
