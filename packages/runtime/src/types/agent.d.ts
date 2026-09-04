import type { AssistantMessage, Model, Models } from "./ai";
import type { Static, TSchema } from "typebox";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type AgentToolSource = {
  kind: "mcp";
  connectorId: string;
  connectorName: string;
  toolName: string;
  templateId: "feishu" | "dingtalk" | "wecom" | "postgresql" | "web-search" | "firecrawl" | "github" | "ai-hot" | null;
  transport: "stdio" | "streamable-http";
};

export type AgentMessage = { role: "user" | "assistant"; content: unknown; timestamp?: number; stopReason?: string; errorMessage?: string };

export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  tools?: AgentTool[];
}

export interface AgentToolResult<TDetails = unknown> {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string }>;
  details: TDetails;
  addedToolNames?: string[];
  terminate?: boolean;
}

export type AgentToolUpdateCallback<TDetails = unknown> = (partialResult: AgentToolResult<TDetails>) => void;

export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;
  promptSnippet?: string;
  promptGuidelines?: readonly string[];
  source?: AgentToolSource;
  executionMode?: "parallel" | "sequential";
  execute(toolCallId: string, params: Static<TParameters>, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<TDetails>): Promise<AgentToolResult<TDetails>>;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation: boolean;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

export function estimateContextTokens(
  messages: unknown[] | AgentMessage[],
  expectedModel?: { provider: string; modelId: string },
): ContextUsageEstimate;

export function estimateTextTokens(text: string): number;
export const DEFAULT_MAX_BYTES: number;
export const DEFAULT_MAX_LINES: number;
export function truncateHead(text: string, options?: { maxBytes?: number; maxLines?: number }): { content: string; truncated: boolean; totalBytes: number; totalLines: number; outputBytes: number; outputLines: number };
export function truncateTail(text: string, options?: { maxBytes?: number; maxLines?: number }): { content: string; truncated: boolean; totalBytes: number; totalLines: number; outputBytes: number; outputLines: number };
export function executeShellWithCapture(env: ExecutionEnv, command: string, options?: { abortSignal?: AbortSignal; timeout?: number; onChunk?: (chunk: string) => void }): Promise<{ ok: true; value: { output: string; exitCode: number; truncated?: boolean; fullOutputPath?: string } } | { ok: false; error: Error }>;

export function formatSkillsForSystemPrompt(skills: Skill[], options?: { loadingInstruction?: string }): string;

export interface ExecutionEnv {
  cwd: string;
  readTextFile(path: string, signal?: AbortSignal): Promise<{ ok: true; value: string } | { ok: false; error: Error }>;
  readTextLines(path: string, options?: { maxLines?: number; abortSignal?: AbortSignal }): Promise<{ ok: true; value: string[] } | { ok: false; error: Error }>;
  writeFile(path: string, content: string | Uint8Array, signal?: AbortSignal): Promise<{ ok: true; value: void } | { ok: false; error: Error }>;
  fileInfo(path: string, signal?: AbortSignal): Promise<{ ok: true; value: { name: string; path: string; kind: "file" | "directory" | "symlink"; size: number } } | { ok: false; error: Error }>;
  listDir(path: string, signal?: AbortSignal): Promise<{ ok: true; value: Array<{ name: string; path: string; kind: "file" | "directory" | "symlink"; size: number }> } | { ok: false; error: Error }>;
  canonicalPath(path: string, signal?: AbortSignal): Promise<{ ok: true; value: string } | { ok: false; error: Error }>;
  exec(command: string, options?: { abortSignal?: AbortSignal; timeout?: number; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void }): Promise<{ ok: true; value: { stdout: string; stderr: string; exitCode: number } } | { ok: false; error: Error }>;
}

export type AgentHarnessEvent =
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_end"; message: AgentMessage }
  | { type: "message_update"; assistantMessageEvent: { type: "text_delta" | "thinking_delta"; delta: string } }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown; source?: AgentToolSource }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown; source?: AgentToolSource }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean; source?: AgentToolSource }
  | { type: "agent_start" | "agent_end" | "turn_start" | "turn_end" | "queue_update" | "save_point" | "abort" | "settled" | "before_agent_start" | "context" | "before_provider_request" | "before_provider_payload" | "after_provider_response" | "tool_call" | "tool_result" | "session_before_compact" | "session_compact" | "session_before_tree" | "session_tree" | "model_update" | "thinking_level_update" | "resources_update" | "tools_update" };

export interface SessionMetadata {
  id: string;
  createdAt: string;
}

export interface SessionTreeEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: AgentMessage;
  targetId?: string | null;
  label?: string;
}

export interface SessionStorage<TMetadata extends SessionMetadata = SessionMetadata> {
  getMetadata(): Promise<TMetadata>;
  getLeafId(): Promise<string | null>;
  setLeafId(leafId: string | null): Promise<void>;
  createEntryId(): Promise<string>;
  appendEntry(entry: SessionTreeEntry): Promise<void>;
  getEntry(id: string): Promise<SessionTreeEntry | undefined>;
  findEntries<TType extends string>(type: TType): Promise<Array<SessionTreeEntry & { type: TType }>>;
  getLabel(id: string): Promise<string | undefined>;
  getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
  getEntries(): Promise<SessionTreeEntry[]>;
}

export class Session<TMetadata extends SessionMetadata = SessionMetadata> {
  constructor(storage: SessionStorage<TMetadata>);
  getLeafId(): Promise<string | null>;
  getEntries(): Promise<SessionTreeEntry[]>;
  buildContext(): Promise<{ messages: AgentMessage[] }>;
  getBranch(): Promise<SessionTreeEntry[]>;
  moveTo(entryId: string | null): Promise<string | undefined>;
  appendModelChange(provider: string, modelId: string): Promise<string>;
  appendThinkingLevelChange(thinkingLevel: string): Promise<string>;
  appendCustomEntry(customType: string, data?: unknown): Promise<string>;
}

export class SessionError extends Error {
  constructor(code: string, message: string);
}

export class AgentHarness<TSkill extends Skill = Skill> {
  constructor(options: {
    env: ExecutionEnv;
    session: Session;
    models: Models;
    model: Model;
    systemPrompt:
      | string
      | ((context: {
          env: ExecutionEnv;
          session: Session;
          model: Model;
          thinkingLevel: ThinkingLevel;
          activeTools: AgentTool[];
          resources: { skills?: TSkill[] };
        }) => string | Promise<string>);
    tools?: readonly AgentTool[];
    activeToolNames?: readonly string[];
    thinkingLevel: ThinkingLevel;
    resources?: { skills?: TSkill[] };
    streamOptions?: { maxRetries?: number; maxRetryDelayMs?: number; timeoutMs?: number };
    beforeNextTurn?: (context: AgentContext) => Promise<AgentContext | undefined> | AgentContext | undefined;
  });
  prompt(text: string, options?: { messageId?: string; timestamp?: number }): Promise<AssistantMessage>;
  continue(): Promise<AssistantMessage>;
  prepareContextOverflowRecovery(): Promise<{ failedMessageEntryId: string }>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  setModel(model: Model): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  compact(instructions?: string): Promise<unknown>;
  compactForNextTurn(instructions?: string): Promise<unknown>;
  abort(): Promise<unknown>;
  subscribe(listener: (event: AgentHarnessEvent) => void): () => void;
  on(
    type: "before_agent_start",
    handler: (event: { type: "before_agent_start"; systemPrompt: string }) =>
      | { systemPrompt?: string; messages?: AgentMessage[] }
      | undefined,
  ): () => void;
  on(
    type: "session_before_compact",
    handler: (event: { type: "session_before_compact"; customInstructions?: string }) => { customInstructions?: string } | undefined,
  ): () => void;
}

export class NodeExecutionEnv implements ExecutionEnv {
  constructor(options: { cwd: string });
  cwd: string;
  readTextFile(path: string, signal?: AbortSignal): ReturnType<ExecutionEnv["readTextFile"]>;
  readTextLines(path: string, options?: { maxLines?: number; abortSignal?: AbortSignal }): ReturnType<ExecutionEnv["readTextLines"]>;
  writeFile(path: string, content: string | Uint8Array, signal?: AbortSignal): ReturnType<ExecutionEnv["writeFile"]>;
  fileInfo(path: string, signal?: AbortSignal): ReturnType<ExecutionEnv["fileInfo"]>;
  listDir(path: string, signal?: AbortSignal): ReturnType<ExecutionEnv["listDir"]>;
  canonicalPath(path: string, signal?: AbortSignal): ReturnType<ExecutionEnv["canonicalPath"]>;
  exec(command: string, options?: { abortSignal?: AbortSignal; timeout?: number; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void }): ReturnType<ExecutionEnv["exec"]>;
}
