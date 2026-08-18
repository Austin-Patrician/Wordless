import type {
  AgentHarness,
  AgentTool,
  ExecutionEnv,
  Session,
} from "@wordless/agent";
import type {
  AgentDriverId,
  ConversationUsage,
  ExpertExecutionProfile,
  ExpertPortrait,
  ModelReference,
  SessionRecord,
  ThinkingLevel,
  ToolApprovalMode,
} from "@wordless/domain";

export type JsonObject = Record<string, unknown>;

export interface AgentExtensionDescriptor {
  id: string;
  version: string;
  name: string;
  description: string;
  category: "workflow" | "orchestration";
  builtin: true;
  defaultEnabled: false;
  supportedDriverIds: AgentDriverId[];
}

export interface AgentExtensionConfiguration {
  enabled: boolean;
  settings: JsonObject;
}

export interface AgentExtensionSnapshot {
  descriptors: AgentExtensionDescriptor[];
  configurations: Record<string, AgentExtensionConfiguration>;
}

export interface AgentExtensionSessionState {
  extensionId: string;
  state: JsonObject;
  updatedAt: number;
}

export interface AgentExtensionEvent {
  extensionId: string;
  type: string;
  payload: unknown;
}

export interface AgentExtensionInteraction {
  extensionId: string;
  action: string;
  payload?: unknown;
}

export interface AgentExtensionContext {
  readonly descriptor: AgentExtensionDescriptor;
  readonly configuration: AgentExtensionConfiguration;
  readonly record: SessionRecord;
  readonly env: ExecutionEnv;
  readonly session: Session;
  readonly harness: AgentHarness;
  readonly contextCompactionInstructions?: string;
  readonly subagentRunner?: SubagentRunner;
  readonly expertTeamDelegates?: Array<{
    id: string;
    name: string;
    portrait: ExpertPortrait;
    executionProfile: ExpertExecutionProfile;
    responsibility: string;
    systemPrompt: string;
    skillIds: string[];
    connectorIds: string[];
  }>;
  registerTools(tools: AgentTool[]): Promise<void>;
  getCurrentPrompt(): string | undefined;
  readonly state: JsonObject;
  setState(state: JsonObject): Promise<void>;
  emit(type: string, payload?: unknown): void;
}

export interface AgentExtension {
  activate(): Promise<void> | void;
  interact?(action: string, payload: unknown): Promise<void> | void;
  dispose(): Promise<void> | void;
}

export interface AgentExtensionDefinition {
  descriptor: AgentExtensionDescriptor;
  create(context: AgentExtensionContext): AgentExtension;
}

export interface AgentExtensionHost {
  activate(): Promise<void>;
  interact(interaction: AgentExtensionInteraction): Promise<void>;
  getState(extensionId: string): AgentExtensionSessionState | undefined;
  dispose(): Promise<void>;
}

export interface AgentExtensionHostFactory {
  create(context: {
    record: SessionRecord;
    env: ExecutionEnv;
    session: Session;
    harness: AgentHarness;
    contextCompactionInstructions?: string;
    subagentRunner?: SubagentRunner;
    registerTools(tools: AgentTool[]): Promise<void>;
    getCurrentPrompt(): string | undefined;
    expertTeamDelegates?: Array<{
      id: string;
      name: string;
      portrait: ExpertPortrait;
      executionProfile: ExpertExecutionProfile;
      responsibility: string;
      systemPrompt: string;
      skillIds: string[];
      connectorIds: string[];
    }>;
    emit(event: AgentExtensionEvent): void;
  }): Promise<AgentExtensionHost>;
}

export interface SubagentRoleDefinition {
  id:
    | "scout"
    | "planner"
    | "reviewer"
    | "worker"
    | "researcher"
    | "research-reviewer";
  name: string;
  description: string;
  model: { connectionId: string; modelId: string } | null;
}

export type SubagentTask =
  | {
      kind: "builtin-subagent";
      id: string;
      role: SubagentRoleDefinition["id"];
      prompt: string;
      cwd: string;
      model: { connectionId: string; modelId: string } | null;
    }
  | {
      kind: "expert-member";
      id: string;
      memberId: string;
      prompt: string;
      cwd: string;
      inputs?: string[];
      outputs?: string[];
    };

export type SubagentTaskStatus =
  | "queued"
  | "running"
  | "awaiting-approval"
  | "awaiting-user-input"
  | "completed"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "blocked"
  | "skipped";

export type SubagentTaskPhase =
  | "queued"
  | "thinking"
  | "tool"
  | "approval"
  | "user-input"
  | "finished";

export interface SubagentTaskProgress {
  taskId: string;
  status: SubagentTaskStatus;
  phase?: SubagentTaskPhase;
  output?: string;
  tool?: {
    callId?: string;
    name: string;
    input: Record<string, unknown>;
    output?: string;
    state: "running" | "complete" | "error";
  };
  usage?: ConversationUsage;
  modelResolution?: {
    requested: ModelReference | null;
    resolved: ModelReference;
    thinkingLevel: ThinkingLevel;
    fallbackReason?: "unavailable" | "tools-unsupported";
  };
  approval?: unknown;
  userRequest?: unknown;
}

export interface SubagentResult {
  taskId: string;
  status: "completed" | "interrupted" | "failed" | "cancelled";
  text: string;
  usage?: ConversationUsage;
  files?: string[];
  resultPath?: string;
  error?: string;
}

export interface SubagentRunner {
  run(
    task: SubagentTask,
    options?: {
      signal?: AbortSignal;
      onUpdate?: (progress: SubagentTaskProgress) => void;
    },
  ): Promise<SubagentResult>;
  cancel(taskId: string): Promise<void>;
  setToolApprovalMode?(mode: ToolApprovalMode): Promise<void>;
}

export const AGENT_EXTENSION_STATE_JOURNAL_TYPE =
  "wordless.agent-extension.state";

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function createDisabledConfiguration(): AgentExtensionConfiguration {
  return { enabled: false, settings: {} };
}

export type { AgentTool };
