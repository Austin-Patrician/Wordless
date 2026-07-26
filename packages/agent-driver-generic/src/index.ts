import { randomUUID } from "node:crypto";
import {
  AgentHarness,
  formatSkillsForSystemPrompt,
  type AgentHarnessEvent,
  type AgentMessage,
  type AgentTool,
  type ThinkingLevel,
  type Skill,
} from "@wordless/agent";
import { isContextOverflow, type AssistantMessage } from "@wordless/ai";
import { Type, type Static } from "typebox";
import type {
  AgentDriver,
  AgentDriverCommand,
  AgentDriverEvent,
  AgentDriverFeature,
  AgentDriverSession,
  AgentDriverSessionContext,
  AgentRuntimeSkill,
  OperationApprovalRequest,
  OperationApprovalResolution,
  OperationPreflightDecision,
  PersistedUserRequest,
  SessionFileBaseline,
} from "@wordless/agent-driver-sdk";
import type { AgentExtensionHost, AgentExtensionHostFactory } from "@wordless/agent-extension-sdk";
import {
  OPERATION_APPROVAL_JOURNAL_TYPE,
  CONTEXT_COMPACTION_JOURNAL_TYPE,
  SESSION_FILE_BASELINE_JOURNAL_TYPE,
  USER_REQUEST_JOURNAL_TYPE,
  formatPromptWithAttachments,
  projectUserMessageContent,
  stripPromptSkillReferences,
  type PersistedOperationApproval,
  type PersistedSessionFileBaseline,
  type PersistedContextCompaction,
} from "@wordless/agent-driver-sdk";
import { conversationUsageFromUnknown } from "@wordless/domain";
import type {
  ClarificationBrief,
  ClarificationQuestion,
  ConversationMessage,
  ContextCompactionRecord,
  ConversationUsage,
  MessageBlock,
  MessageUserRequest,
  UserRequest,
  UserRequestAnswer,
  UserRequestField,
  UserRequestResolution,
  ToolApprovalMode,
} from "@wordless/domain";

export interface AgentHarnessDriverOptions {
  id: string;
  features?: readonly AgentDriverFeature[];
  createTools(context: AgentDriverSessionContext): AgentTool[];
  preflightOperation?: (
    context: AgentDriverSessionContext,
    request: { toolName: string; input: Record<string, unknown> },
  ) => Promise<OperationPreflightDecision>;
  createExtensionHost?: AgentExtensionHostFactory;
}

type HookableHarness = {
  on(
    type: "context",
    handler: (event: { messages: AgentMessage[] }) => { messages: AgentMessage[] } | undefined,
  ): () => void;
  on(
    type: "tool_call",
    handler: (event: { toolCallId: string; toolName: string; input: Record<string, unknown> }) => Promise<{ block?: boolean; reason?: string } | undefined>,
  ): () => void;
  on(
    type: "tool_result",
    handler: (event: { toolCallId: string; toolName: string; isError: boolean }) => Promise<{ terminate?: boolean } | undefined>,
  ): () => void;
};

type ToolManagingHarness = {
  getTools(): AgentTool[];
  getActiveTools(): AgentTool[];
  setTools(tools: AgentTool[], activeToolNames: string[]): Promise<void>;
};

type CustomEntrySession = {
  appendCustomEntry(customType: string, data?: unknown): Promise<string>;
};

const UserRequestOptionSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 256 }),
  label: Type.String({ minLength: 1, maxLength: 256 }),
  description: Type.Optional(Type.String({ maxLength: 1_000 })),
});

const UserRequestFieldSchema = Type.Union([
  Type.Object({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.Literal("select"),
    label: Type.String({ minLength: 1, maxLength: 512 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    required: Type.Optional(Type.Boolean()),
    options: Type.Array(UserRequestOptionSchema, { minItems: 1, maxItems: 32 }),
    defaultValue: Type.Optional(Type.String({ maxLength: 4_000 })),
    allowCustom: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.Literal("multi-select"),
    label: Type.String({ minLength: 1, maxLength: 512 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    required: Type.Optional(Type.Boolean()),
    options: Type.Array(UserRequestOptionSchema, { minItems: 1, maxItems: 32 }),
    defaultValue: Type.Optional(Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 32 })),
    allowCustom: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.Literal("text"),
    label: Type.String({ minLength: 1, maxLength: 512 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    required: Type.Optional(Type.Boolean()),
    placeholder: Type.Optional(Type.String({ maxLength: 512 })),
    defaultValue: Type.Optional(Type.String({ maxLength: 4_000 })),
    multiline: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.Literal("confirm"),
    label: Type.String({ minLength: 1, maxLength: 512 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    required: Type.Optional(Type.Boolean()),
    defaultValue: Type.Optional(Type.Boolean()),
  }),
]);

const UserRequestParamsSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 512 }),
  description: Type.Optional(Type.String({ maxLength: 2_000 })),
  fields: Type.Array(UserRequestFieldSchema, { minItems: 1, maxItems: 8 }),
});

const LoadSkillParamsSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
});

const ClarificationOptionSchema = Type.Object({
  value: Type.String({ minLength: 1, maxLength: 256 }),
  label: Type.String({ minLength: 1, maxLength: 256 }),
  description: Type.Optional(Type.String({ maxLength: 1_000 })),
});

const ClarificationQuestionParamsSchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 1_000 }),
  context: Type.Optional(Type.String({ maxLength: 2_000 })),
  answerType: Type.Union([Type.Literal("choice"), Type.Literal("text"), Type.Literal("confirm")]),
  options: Type.Optional(Type.Array(ClarificationOptionSchema, { minItems: 1, maxItems: 4 })),
  recommendation: Type.Object({
    answer: Type.String({ minLength: 1, maxLength: 1_000 }),
    value: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
  }),
  allowCustom: Type.Optional(Type.Boolean()),
  purpose: Type.Union([Type.Literal("discovery"), Type.Literal("final-confirmation")]),
});

const ClarificationBriefDecisionSchema = Type.Object({
  topic: Type.String({ minLength: 1, maxLength: 512 }),
  outcome: Type.String({ minLength: 1, maxLength: 2_000 }),
  rationale: Type.Optional(Type.String({ maxLength: 2_000 })),
});

const ClarificationBriefParamsSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 512 }),
  summary: Type.String({ minLength: 1, maxLength: 8_000 }),
  goals: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 16 }),
  constraints: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 16 }),
  decisions: Type.Array(ClarificationBriefDecisionSchema, { maxItems: 24 }),
  openQuestions: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 16 }),
  recommendedNextStep: Type.String({ minLength: 1, maxLength: 2_000 }),
});

type UserRequestParams = Static<typeof UserRequestParamsSchema>;
type ClarificationQuestionParams = Static<typeof ClarificationQuestionParamsSchema>;
type ClarificationBriefParams = Static<typeof ClarificationBriefParamsSchema>;

type UserRequestToolDetails = {
  userRequest: MessageUserRequest;
};

type ClarificationQuestionToolDetails = {
  clarificationQuestion: ClarificationQuestion;
};

type ClarificationBriefToolDetails = {
  clarificationBrief: ClarificationBrief;
};

type SuppressedOverflowMessage = {
  message: ConversationMessage;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stripSkillReferenceMarkers(messages: AgentMessage[]): AgentMessage[] {
  let changed = false;
  const sanitized = messages.map((message) => {
    const value = asRecord(message);
    if (!value || value.role !== "user") return message;
    if (typeof value.content === "string") {
      const content = stripPromptSkillReferences(value.content);
      if (content === value.content) return message;
      changed = true;
      return { ...value, content } as AgentMessage;
    }
    if (!Array.isArray(value.content)) return message;
    const content = value.content.map((item) => {
      const block = asRecord(item);
      if (!block || block.type !== "text" || typeof block.text !== "string") return item;
      const text = stripPromptSkillReferences(block.text);
      if (text === block.text) return item;
      changed = true;
      return { ...block, text };
    });
    return changed ? { ...value, content } as AgentMessage : message;
  });
  return changed ? sanitized : messages;
}

function redactConnectorInput(value: unknown, key?: string): unknown {
  if (key && /(?:api[-_]?key|authorization|cookie|header|password|secret|token)/i.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redactConnectorInput(item));
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([entryKey, entryValue]) => [entryKey, redactConnectorInput(entryValue, entryKey)]));
}

function connectorPreflightOperation(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
): OperationPreflightDecision | undefined {
  const policy = context.connectorToolPolicies.find((candidate) => candidate.agentToolName === request.toolName);
  if (!policy) return undefined;
  if (policy.readOnly && policy.destructive !== true) return { type: "allow" };
  return {
    type: "approval",
    approval: {
      risk: "connector",
      severity: policy.destructive === true ? "high" : "normal",
      summary: policy.destructive === true
        ? "This Connector tool may modify or delete external data and requires confirmation."
        : "This Connector tool is not explicitly read-only and requires confirmation.",
      preview: {
        type: "connector",
        connectorId: policy.connectorId,
        connectorName: policy.connectorName,
        toolName: policy.toolName,
        input: asRecord(redactConnectorInput(request.input)) ?? {},
      },
      matchedRules: [],
    },
  };
}

function isAssistantMessage(value: AgentMessage): value is AssistantMessage {
  const message = asRecord(value);
  const usage = asRecord(message?.usage);
  return (
    value.role === "assistant" &&
    typeof message?.api === "string" &&
    typeof message.provider === "string" &&
    typeof message.model === "string" &&
    typeof message.stopReason === "string" &&
    typeof usage?.input === "number" &&
    typeof usage.output === "number" &&
    typeof usage.cacheRead === "number" &&
    typeof usage.cacheWrite === "number" &&
    typeof usage.totalTokens === "number"
  );
}

function persistedFileBaseline(value: unknown): PersistedSessionFileBaseline | undefined {
  const record = asRecord(value);
  const baseline = asRecord(record?.baseline);
  if (
    typeof record?.callId !== "string" ||
    typeof baseline?.path !== "string" ||
    typeof baseline?.existed !== "boolean" ||
    (typeof baseline?.content !== "string" && baseline?.content !== null)
  ) {
    return undefined;
  }
  return value as PersistedSessionFileBaseline;
}

function userRequestContent(resolution: UserRequestResolution): string {
  if (resolution.status === "cancelled") {
    return resolution.feedback ? `The user cancelled this request: ${resolution.feedback}` : "The user cancelled this request.";
  }
  return `The user submitted the following response: ${JSON.stringify(resolution.answers ?? {})}`;
}

function validateUserRequestResolution(request: UserRequest, resolution: UserRequestResolution): UserRequestResolution {
  if (resolution.requestId !== request.requestId) throw new Error("The user request does not match the pending interaction");
  if (resolution.status === "cancelled") return { requestId: request.requestId, status: "cancelled", feedback: resolution.feedback };
  const submitted = resolution.answers ?? {};
  const fieldIds = new Set(request.fields.map((field) => field.id));
  for (const fieldId of Object.keys(submitted)) {
    if (!fieldIds.has(fieldId)) throw new Error("The response contains an unknown field");
  }
  const answers: Record<string, UserRequestAnswer> = {};
  for (const field of request.fields) {
    const answer = submitted[field.id];
    if (field.type === "confirm") {
      if (answer !== undefined && typeof answer !== "boolean") throw new Error("The confirmation response is invalid");
      answers[field.id] = typeof answer === "boolean" ? answer : field.defaultValue ?? false;
      continue;
    }
    if (field.type === "text") {
      if (answer !== undefined && typeof answer !== "string") throw new Error("The text response is invalid");
      const value = typeof answer === "string" ? answer : field.defaultValue;
      if (field.required && !value?.trim()) throw new Error("A required response is missing");
      if (value !== undefined) answers[field.id] = value;
      continue;
    }
    const allowed = new Set(field.options.map((option) => option.value));
    if (field.type === "select") {
      if (answer !== undefined && typeof answer !== "string") throw new Error("The selected response is invalid");
      const value = typeof answer === "string" ? answer : field.defaultValue;
      if (field.required && !value) throw new Error("A required response is missing");
      if (value !== undefined && !allowed.has(value) && !field.allowCustom) throw new Error("The selected response is not available");
      if (value !== undefined) answers[field.id] = value;
      continue;
    }
    if (answer !== undefined && (!Array.isArray(answer) || answer.some((value) => typeof value !== "string"))) {
      throw new Error("The multi-select response is invalid");
    }
    const values = Array.isArray(answer) ? [...new Set(answer)] : field.defaultValue ?? [];
    if (field.required && values.length === 0) throw new Error("A required response is missing");
    if (values.some((value) => !allowed.has(value) && !field.allowCustom)) throw new Error("The selected response is not available");
    answers[field.id] = values;
  }
  return { requestId: request.requestId, status: "submitted", answers };
}

function createUserRequestTool(
  requestUserInput: (callId: string, params: UserRequestParams, signal?: AbortSignal) => Promise<MessageUserRequest>,
): AgentTool<typeof UserRequestParamsSchema, UserRequestToolDetails> {
  return {
    name: "request_user_input",
    label: "Request user input",
    description: "Ask the user for missing requirements or a decision. Group related questions in one request. Do not use this tool to approve file changes or command execution.",
    parameters: UserRequestParamsSchema,
    async execute(toolCallId, params, signal) {
      const userRequest = await requestUserInput(toolCallId, params, signal);
      return {
        content: [{ type: "text", text: userRequestContent(userRequest.resolution ?? { requestId: userRequest.request.requestId, status: "cancelled" }) }],
        details: { userRequest },
      };
    },
  };
}

function createLoadSkillTool(skills: readonly AgentRuntimeSkill[]): AgentTool<typeof LoadSkillParamsSchema> {
  return {
    name: "load_skill",
    label: "Load skill",
    description: "Load the complete instructions for an available skill by name.",
    parameters: LoadSkillParamsSchema,
    async execute(_toolCallId, params) {
      const skill = skills.find((candidate) => candidate.name === params.name);
      if (!skill) {
        return { content: [{ type: "text", text: `Unknown skill: ${params.name}` }], details: { found: false } };
      }
      return {
        content: [{ type: "text", text: `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${skill.content}\n</skill>` }],
        details: { found: true, skillId: skill.id, source: skill.source },
      };
    },
  };
}

function createClarificationQuestionTool(): AgentTool<typeof ClarificationQuestionParamsSchema, ClarificationQuestionToolDetails> {
  return {
    name: "ask_clarifying_question",
    label: "Ask clarifying question",
    description: "Ask exactly one question that resolves the next decision. Include a recommended answer and why it is recommended. This ends the current turn until the user responds.",
    parameters: ClarificationQuestionParamsSchema,
    async execute(_toolCallId, params) {
      if (params.answerType === "choice" && (!params.options || params.options.length === 0)) {
        throw new Error("Choice clarification questions require options");
      }
      if (params.answerType !== "choice" && params.options !== undefined) {
        throw new Error("Only choice clarification questions may define options");
      }
      if (params.purpose === "final-confirmation" && params.answerType !== "confirm") {
        throw new Error("Final clarification confirmation questions must use a confirmation response");
      }
      if (params.answerType === "choice" && params.recommendation.value !== undefined && !params.options?.some((option) => option.value === params.recommendation.value)) {
        throw new Error("The recommended value must match a question option");
      }
      return {
        content: [{ type: "text", text: "Waiting for the user's clarification." }],
        details: { clarificationQuestion: params as ClarificationQuestion },
      };
    },
  };
}

function createClarificationBriefTool(): AgentTool<typeof ClarificationBriefParamsSchema, ClarificationBriefToolDetails> {
  return {
    name: "complete_clarification",
    label: "Complete clarification",
    description: "Record the agreed clarification brief after the user has confirmed the shared understanding. This ends the current turn and shows the user next-mode choices.",
    parameters: ClarificationBriefParamsSchema,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Clarification brief recorded." }],
        details: { clarificationBrief: params as ClarificationBrief },
      };
    },
  };
}

const CLARIFICATION_MODE_PROMPT = `You are in Clarification Mode. Your job is to help the user sharpen an idea, decision, or plan without executing work.

Follow this process:
- Inspect local facts with read-only tools when that is more reliable than asking the user.
- Ask exactly one decision at a time with ask_clarifying_question. State a recommendation and its reasoning in every question.
- Work down the dependency tree: resolve the most important upstream uncertainty before asking dependent questions.
- Do not use request_user_input, write, edit, shell commands, connectors, subagents, or any external action.
- If the user requests execution, explain that this mode only clarifies and ask them to switch modes after a brief is complete.
- When the goals, constraints, decisions, and remaining uncertainty are clear, ask one final-confirmation question. Only after a positive confirmation call complete_clarification.
- Be concise, direct, and use the user's language.`;

function isClarificationMode(context: AgentDriverSessionContext): boolean {
  return context.record.interactionMode === "clarify";
}

function formatSelectedSkillsForSystemPrompt(skills: readonly AgentRuntimeSkill[]): string {
  if (skills.length === 0) return "";
  const lines = [
    "The user explicitly selected the following skills for this request. Apply their instructions throughout this run.",
    "<selected_skills>",
  ];
  for (const skill of skills) {
    lines.push(`  <skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`);
    lines.push(`References are relative to ${escapeXml(skill.baseDir)}.`);
    lines.push("");
    lines.push(skill.content);
    lines.push("  </skill>");
  }
  lines.push("</selected_skills>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function persistedBaselinePaths(context: AgentDriverSessionContext): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const entry of await context.session.getEntries()) {
    const customEntry = entry as unknown as { type: string; customType?: string; data?: unknown };
    if (customEntry.type !== "custom" || customEntry.customType !== SESSION_FILE_BASELINE_JOURNAL_TYPE) continue;
    const persisted = persistedFileBaseline(customEntry.data);
    if (persisted) paths.add(persisted.baseline.path);
  }
  return paths;
}

function contentToText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      const record = asRecord(item);
      return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("\n");
}

function estimateJournalTokens(entries: readonly unknown[]): number {
  try {
    let lastCompaction = -1;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (asRecord(entries[index])?.type === "compaction") {
        lastCompaction = index;
        break;
      }
    }
    const contextEntries = lastCompaction === -1 ? entries : entries.slice(lastCompaction);
    return Math.ceil(JSON.stringify(contextEntries).length / 4);
  } catch {
    return 0;
  }
}

function toConversationUsage(value: unknown): ConversationUsage | undefined {
  const usage = asRecord(value);
  const cost = asRecord(usage?.cost);
  const inputTokens = typeof usage?.input === "number" ? usage.input : 0;
  const outputTokens = typeof usage?.output === "number" ? usage.output : 0;
  const cacheReadTokens = typeof usage?.cacheRead === "number" ? usage.cacheRead : 0;
  const cacheWriteTokens = typeof usage?.cacheWrite === "number" ? usage.cacheWrite : 0;
  const totalTokens = typeof usage?.totalTokens === "number"
    ? usage.totalTokens
    : typeof usage?.total === "number"
      ? usage.total
      : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalCost = typeof cost?.total === "number" ? cost.total : 0;
  if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) return undefined;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, totalCost };
}

function toolUsageFromDetails(details: unknown): ConversationUsage | undefined {
  return conversationUsageFromUnknown(asRecord(details)?.usage);
}

function isToolExecutionStart(event: AgentHarnessEvent): event is AgentHarnessEvent & { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown } {
  return event.type === "tool_execution_start" && "toolCallId" in event && "toolName" in event && "args" in event;
}

function isToolExecutionUpdate(event: AgentHarnessEvent): event is AgentHarnessEvent & { type: "tool_execution_update"; toolCallId: string; partialResult: unknown } {
  return event.type === "tool_execution_update" && "toolCallId" in event && "partialResult" in event;
}

function isToolExecutionEnd(event: AgentHarnessEvent): event is AgentHarnessEvent & { type: "tool_execution_end"; toolCallId: string; result: unknown; isError: boolean } {
  return event.type === "tool_execution_end" && "toolCallId" in event && "result" in event && "isError" in event;
}

function toConversationMessage(message: AgentMessage, model: ConversationMessage["model"], id: string): ConversationMessage | undefined {
  const value = asRecord(message);
  if (!value || (value.role !== "user" && value.role !== "assistant")) return undefined;
  const blocks: MessageBlock[] = [];
  const content = value.content;
  if (value.role === "user") {
    blocks.push(...projectUserMessageContent(content));
  } else if (typeof content === "string") {
    blocks.push({ type: "text", text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      const block = asRecord(item);
      if (!block) continue;
      if (block.type === "text" && typeof block.text === "string") blocks.push({ type: "text", text: block.text });
      if (block.type === "thinking" && typeof block.thinking === "string") blocks.push({ type: "reasoning", text: block.thinking });
      if (block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
        blocks.push({
          type: "tool",
          callId: block.id,
          name: block.name,
          state: "pending",
          input: asRecord(block.arguments),
        });
      }
    }
  }
  return {
    id,
    role: value.role,
    status: value.stopReason === "error" ? "error" : value.stopReason === "aborted" ? "aborted" : "complete",
    blocks,
    model: value.role === "assistant" ? model : null,
    timestamp: typeof value.timestamp === "number" ? value.timestamp : Date.now(),
    usage: value.role === "assistant" ? toConversationUsage(value.usage) : undefined,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : undefined,
  };
}

class AgentHarnessDriverSession implements AgentDriverSession {
  private readonly harness: AgentHarness;
  private readonly context: AgentDriverSessionContext;
  private toolApprovalMode: ToolApprovalMode;
  private readonly clarificationMode: boolean;
  private readonly listeners = new Set<(event: AgentDriverEvent) => void>();
  private readonly unsubscribe: () => void;
  private readonly messageIds = new WeakMap<object, string>();
  private readonly pendingApprovals = new Map<
    string,
    {
      messageId: string;
      request: OperationApprovalRequest;
      resolve: (resolution: OperationApprovalResolution) => void;
    }
  >();
  private readonly approvalResults = new Map<string, PersistedOperationApproval>();
  private readonly pendingUserRequests = new Map<
    string,
    {
      messageId: string;
      request: UserRequest;
      resolve: (resolution: UserRequestResolution) => void;
    }
  >();
  private readonly userRequestResults = new Map<string, PersistedUserRequest>();
  private readonly pendingFileBaselines = new Map<string, SessionFileBaseline>();
  private readonly persistedFileBaselinePaths: Set<string>;
  private readonly toolMessageIds = new Map<string, string>();
  private activeAssistantMessageId: string | undefined;
  private overflowRecoveryAttempted = false;
  private suppressedOverflowMessage: SuppressedOverflowMessage | undefined;
  private currentPrompt: string | undefined;
  private selectedSkillsForRun: readonly AgentRuntimeSkill[] = [];
  readonly features: readonly AgentDriverFeature[];

  constructor(
    context: AgentDriverSessionContext,
    baseTools: AgentTool[],
    features: readonly AgentDriverFeature[],
    preflightOperation: AgentHarnessDriverOptions["preflightOperation"],
    persistedFileBaselinePaths: Set<string>,
  ) {
    this.context = context;
    this.toolApprovalMode = context.toolApprovalMode ?? "manual";
    this.features = features;
    this.persistedFileBaselinePaths = persistedFileBaselinePaths;
    this.clarificationMode = isClarificationMode(context);
    const clarificationMode = this.clarificationMode;
    const supportsUserRequests = context.modelCapabilities.supportsToolUse !== false;
    const skillPrompt = formatSkillsForSystemPrompt(context.skills, {
      loadingInstruction: "Use the load_skill tool to load a skill's complete instructions when the task matches its description.",
    });
    const baseSystemPrompt = clarificationMode
      ? `${context.profile.systemPrompt}${skillPrompt ? `\n\n${skillPrompt}` : ""}\n\n${CLARIFICATION_MODE_PROMPT}`
      : supportsUserRequests
        ? `${context.profile.systemPrompt}${skillPrompt ? `\n\n${skillPrompt}` : ""}\n\nWhen a user decision or missing requirement blocks progress, call request_user_input with a concise form. Group related questions together. Do not use it to approve file changes or commands.`
        : `${context.profile.systemPrompt}${skillPrompt ? `\n\n${skillPrompt}` : ""}\n\nThis model cannot call tools. When you need a user decision, ask a concise question in normal response text instead.`;
    const skillTools = context.skills.length > 0 ? [createLoadSkillTool(context.skills)] : [];
    const clarificationTools = clarificationMode && supportsUserRequests ? [createClarificationQuestionTool(), createClarificationBriefTool()] : [];
    const tools = supportsUserRequests
      ? [...baseTools, ...context.connectorTools, ...skillTools, createUserRequestTool((callId, params, signal) => this.requestUserInput(callId, params, signal)), ...clarificationTools]
      : [...baseTools, ...context.connectorTools];
    const clarificationToolNames = new Set(["read", "grep", "find", "ls", "workspace_changes", "load_skill", "ask_clarifying_question", "complete_clarification"]);
    const activeToolNames = clarificationMode
      ? tools.filter((tool) => clarificationToolNames.has(tool.name)).map((tool) => tool.name)
      : supportsUserRequests
        ? [...context.profile.activeToolNames, ...context.connectorTools.map((tool) => tool.name), ...skillTools.map((tool) => tool.name), "request_user_input"]
        : [...context.profile.activeToolNames, ...context.connectorTools.map((tool) => tool.name)];
    const toolContract = `Only call tools exposed for this session: ${activeToolNames.join(", ") || "none"}. Never invent or call tools outside this list.`;
    this.harness = new AgentHarness<Skill>({
      env: context.env,
      session: context.session,
      models: context.models,
      model: context.model,
      systemPrompt: baseSystemPrompt,
      tools,
      activeToolNames,
      thinkingLevel: context.model.reasoning ? "medium" : "off",
      resources: { skills: context.skills },
    });
    this.harness.on("before_agent_start", (event) => {
      const selectedSkillsPrompt = formatSelectedSkillsForSystemPrompt(this.selectedSkillsForRun);
      const prompt = selectedSkillsPrompt ? `${event.systemPrompt}\n\n${selectedSkillsPrompt}` : event.systemPrompt;
      return { systemPrompt: clarificationMode ? `${prompt}\n\n${CLARIFICATION_MODE_PROMPT}\n\n${toolContract}` : `${prompt}\n\n${toolContract}` };
    });
    const hookableHarness = this.harness as unknown as HookableHarness;
    hookableHarness.on("context", (event) => {
      const messages = stripSkillReferenceMarkers(event.messages);
      return messages === event.messages ? undefined : { messages };
    });
    if (clarificationMode) {
      hookableHarness.on("tool_call", async (event) => clarificationToolNames.has(event.toolName)
        ? undefined
        : { block: true, reason: "Clarification mode only permits read-only exploration and clarification tools." });
    }
    this.unsubscribe = this.harness.subscribe((event) => this.handleHarnessEvent(event));
    if (preflightOperation || context.connectorToolPolicies.length > 0) {
      hookableHarness.on("tool_call", async (event) => {
        const operationRequest = {
          toolName: event.toolName,
          input: event.input,
        };
        const decision = connectorPreflightOperation(this.context, operationRequest) ?? await preflightOperation?.(this.context, operationRequest);
        if (!decision) return undefined;
        if (decision.type === "block") return { block: true, reason: decision.reason };
        if (decision.type === "allow") {
          const baseline = decision.sessionFileBaseline;
          if (baseline && !this.persistedFileBaselinePaths.has(baseline.path)) {
            this.persistedFileBaselinePaths.add(baseline.path);
            this.pendingFileBaselines.set(event.toolCallId, baseline);
          }
          return undefined;
        }
        const definition = decision.approval;
        const { sessionFileBaseline, ...approvalDefinition } = definition;
        const messageId = this.activeAssistantMessageId;
        if (!messageId) return { block: true, reason: "Unable to request operation approval without an active assistant message" };
        const request: OperationApprovalRequest = {
          ...approvalDefinition,
          approvalId: randomUUID(),
          callId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
        };
        const resolution = await new Promise<OperationApprovalResolution>((resolve) => {
          this.pendingApprovals.set(request.approvalId, { messageId, request, resolve });
          this.emit({ type: "approval.requested", messageId, approval: request });
          if (this.toolApprovalMode === "auto" && request.severity === "normal") {
            this.resolvePendingApproval(request.approvalId, true);
          }
        });
        const persisted: PersistedOperationApproval = { callId: event.toolCallId, approval: request, resolution };
        this.approvalResults.set(event.toolCallId, persisted);
        await (this.context.session as unknown as CustomEntrySession).appendCustomEntry(OPERATION_APPROVAL_JOURNAL_TYPE, persisted);
        if (!resolution.approved) {
          return { block: true, reason: resolution.feedback ? `Operation rejected by the user: ${resolution.feedback}` : "Operation rejected by the user" };
        }
        if (sessionFileBaseline && !this.persistedFileBaselinePaths.has(sessionFileBaseline.path)) {
          this.persistedFileBaselinePaths.add(sessionFileBaseline.path);
          this.pendingFileBaselines.set(event.toolCallId, sessionFileBaseline);
        }
        return undefined;
      });
      hookableHarness.on("tool_result", async (event) => {
        const baseline = this.pendingFileBaselines.get(event.toolCallId);
        if (!baseline) return undefined;
        this.pendingFileBaselines.delete(event.toolCallId);
        if (event.isError) {
          this.persistedFileBaselinePaths.delete(baseline.path);
          return undefined;
        }
        const persisted: PersistedSessionFileBaseline = { callId: event.toolCallId, baseline };
        await (this.context.session as unknown as CustomEntrySession).appendCustomEntry(SESSION_FILE_BASELINE_JOURNAL_TYPE, persisted);
        return undefined;
      });
    }
    if (clarificationMode) {
      hookableHarness.on("tool_result", async (event) => {
        if (event.isError || (event.toolName !== "ask_clarifying_question" && event.toolName !== "complete_clarification")) return undefined;
        return { terminate: true };
      });
    }
  }

  private extensionHost?: AgentExtensionHost;

  async initialize(createExtensionHost?: AgentExtensionHostFactory): Promise<void> {
    if (!createExtensionHost) return;
    this.extensionHost = await createExtensionHost.create({
      record: this.context.record,
      env: this.context.env,
      session: this.context.session,
      harness: this.harness,
      contextCompactionInstructions: this.context.profile.contextCompactionInstructions,
      subagentRunner: this.context.subagentRunner,
      registerTools: async (tools) => {
        const managedHarness = this.harness as unknown as ToolManagingHarness;
        const existing = managedHarness.getTools();
        const existingNames = new Set(existing.map((tool) => tool.name));
        const additions = tools.filter((tool) => !existingNames.has(tool.name));
        if (additions.length === 0) return;
        const active = isClarificationMode(this.context)
          ? managedHarness.getActiveTools().map((tool) => tool.name)
          : [...managedHarness.getActiveTools().map((tool) => tool.name), ...additions.map((tool) => tool.name)];
        await managedHarness.setTools([...existing, ...additions], active);
      },
      getCurrentPrompt: () => this.currentPrompt,
      emit: (event) => this.emit({ type: "extension.event", event }),
    });
    await this.extensionHost.activate();
    if (this.clarificationMode) {
      const hookableHarness = this.harness as unknown as HookableHarness;
      hookableHarness.on("tool_result", async (event) => {
        if (event.isError || (event.toolName !== "ask_clarifying_question" && event.toolName !== "complete_clarification")) return undefined;
        return { terminate: true };
      });
    }
  }

  subscribe(listener: (event: AgentDriverEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async requestUserInput(callId: string, params: UserRequestParams, signal?: AbortSignal): Promise<MessageUserRequest> {
    if (this.pendingUserRequests.size > 0) throw new Error("Another user request is already awaiting a response");
    const messageId = this.activeAssistantMessageId ?? this.toolMessageIds.get(callId);
    if (!messageId) throw new Error("Unable to request user input without an active assistant message");
    const fieldIds = new Set<string>();
    for (const field of params.fields) {
      if (fieldIds.has(field.id)) throw new Error("User request field ids must be unique");
      fieldIds.add(field.id);
      if (field.type === "select" || field.type === "multi-select") {
        const optionValues = new Set<string>();
        for (const option of field.options) {
          if (optionValues.has(option.value)) throw new Error("User request option values must be unique");
          optionValues.add(option.value);
        }
      }
    }
    const request: UserRequest = {
      requestId: randomUUID(),
      callId,
      toolName: "request_user_input",
      title: params.title,
      description: params.description,
      fields: params.fields as UserRequestField[],
    };
    await (this.context.session as unknown as CustomEntrySession).appendCustomEntry(USER_REQUEST_JOURNAL_TYPE, { callId, request } satisfies PersistedUserRequest);
    const onAbort = () => this.resolvePendingUserRequests("The request was cancelled because the agent stopped");
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const resolution = await new Promise<UserRequestResolution>((resolve) => {
        this.pendingUserRequests.set(request.requestId, { messageId, request, resolve });
        this.emit({ type: "user-request.requested", messageId, request });
      });
      const persisted = { callId, request, resolution } satisfies PersistedUserRequest;
      this.userRequestResults.set(callId, persisted);
      await (this.context.session as unknown as CustomEntrySession).appendCustomEntry(USER_REQUEST_JOURNAL_TYPE, persisted);
      return { request, resolution };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async execute(command: AgentDriverCommand): Promise<void> {
    switch (command.type) {
      case "prompt": {
        this.currentPrompt = command.text;
        this.overflowRecoveryAttempted = false;
        this.suppressedOverflowMessage = undefined;
        this.selectedSkillsForRun = command.selectedSkills ?? [];
        try {
          const response = await this.harness.prompt(formatPromptWithAttachments(command.text, command.attachments ?? []));
          await this.recoverContextOverflow(response);
          return;
        } finally {
          this.selectedSkillsForRun = [];
        }
      }
      case "steer":
        this.currentPrompt = command.text;
        await this.harness.steer(formatPromptWithAttachments(command.text, command.attachments ?? []));
        return;
      case "follow-up":
        this.currentPrompt = command.text;
        await this.harness.followUp(formatPromptWithAttachments(command.text, command.attachments ?? []));
        return;
      case "cancel":
        this.resolvePendingApprovals(false, "Operation cancelled");
        this.resolvePendingUserRequests("The request was cancelled because the agent stopped");
        await this.harness.abort();
        return;
      case "resolve-approval": {
        const pending = this.pendingApprovals.get(command.resolution.approvalId);
        if (!pending) throw new Error("Operation approval is no longer pending");
        this.pendingApprovals.delete(command.resolution.approvalId);
        pending.resolve(command.resolution);
        this.emit({ type: "approval.resolved", messageId: pending.messageId, resolution: command.resolution });
        return;
      }
      case "set-tool-approval-mode":
        this.toolApprovalMode = command.mode;
        if (command.mode === "auto") this.resolvePendingNormalApprovals();
        await this.context.subagentRunner?.setToolApprovalMode?.(command.mode);
        return;
      case "resolve-user-request": {
        const pending = this.pendingUserRequests.get(command.resolution.requestId);
        if (!pending) throw new Error("User request is no longer pending");
        const resolution = validateUserRequestResolution(pending.request, command.resolution);
        this.pendingUserRequests.delete(resolution.requestId);
        pending.resolve(resolution);
        this.emit({ type: "user-request.resolved", messageId: pending.messageId, resolution });
        return;
      }
      case "set-model": {
        const model = this.context.resolveModel(command.model);
        await this.harness.setModel(model);
        this.emit({ type: "model.changed", model: command.model });
        return;
      }
      case "set-thinking":
        await this.harness.setThinkingLevel(command.level);
        return;
      case "compact": {
        if (command.trigger === "automatic" && !(await this.shouldAutomaticallyCompact())) return;
        this.emit({ type: "context.compaction.started", trigger: command.trigger });
        try {
          await this.harness.compact(command.instructions);
          const compaction = await this.persistCompaction(command.trigger);
          this.emit({ type: "context.compaction.completed", compaction });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (command.trigger === "automatic" && message === "Nothing to compact") return;
          this.emit({ type: "context.compaction.failed", trigger: command.trigger, message });
          throw cause;
        }
        return;
      }
      case "extension.interact":
        if (!this.extensionHost) throw new Error("Agent extensions are unavailable for this session");
        await this.extensionHost.interact(command.interaction);
        return;
    }
  }

  dispose(): void {
    this.resolvePendingApprovals(false, "Operation cancelled because the session was closed");
    this.resolvePendingUserRequests("The request was cancelled because the session was closed");
    this.unsubscribe();
    if (this.extensionHost) void this.extensionHost.dispose();
  }

  private emit(event: AgentDriverEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private async shouldAutomaticallyCompact(): Promise<boolean> {
    const entries = await this.context.session.getEntries();
    const tokens = estimateJournalTokens(entries);
    const contextWindow = this.context.model.contextWindow || 128_000;
    const reserveTokens = Math.min(16_384, Math.floor(contextWindow * 0.2));
    return tokens > contextWindow - reserveTokens;
  }

  private isCurrentModelOverflow(message: AssistantMessage): boolean {
    return (
      message.provider === this.context.model.provider &&
      message.model === this.context.model.id &&
      isContextOverflow(message, this.context.model.contextWindow)
    );
  }

  private async recoverContextOverflow(response: AssistantMessage): Promise<void> {
    if (!this.isCurrentModelOverflow(response)) return;
    if (response.stopReason === "stop") {
      await this.compactForOverflow();
      return;
    }
    if (this.overflowRecoveryAttempted) {
      this.emit({
        type: "context.compaction.failed",
        trigger: "overflow",
        message: "Context overflow recovery failed after one compact-and-retry attempt. Reduce the task scope or switch to a larger-context model.",
      });
      return;
    }

    this.overflowRecoveryAttempted = true;
    let recoveredFailureEntryId: string;
    try {
      ({ failedMessageEntryId: recoveredFailureEntryId } = await this.harness.prepareContextOverflowRecovery());
    } catch (cause) {
      this.completeSuppressedOverflowMessage();
      this.emit({
        type: "context.compaction.failed",
        trigger: "overflow",
        message: `Context overflow recovery could not prepare the session: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return;
    }

    const compacted = await this.compactForOverflow(recoveredFailureEntryId);
    if (!compacted) {
      this.completeSuppressedOverflowMessage();
      return;
    }

    this.suppressedOverflowMessage = undefined;
    const retryResponse = await this.harness.continue();
    await this.recoverContextOverflow(retryResponse);
  }

  private async compactForOverflow(recoveredFailureEntryId?: string): Promise<boolean> {
    this.emit({ type: "context.compaction.started", trigger: "overflow" });
    try {
      await this.harness.compact();
      const compaction = await this.persistCompaction("overflow", recoveredFailureEntryId);
      this.emit({ type: "context.compaction.completed", compaction });
      return true;
    } catch (cause) {
      this.emit({
        type: "context.compaction.failed",
        trigger: "overflow",
        message: `Context overflow recovery failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return false;
    }
  }

  private completeSuppressedOverflowMessage(): void {
    if (!this.suppressedOverflowMessage) return;
    this.emit({ type: "message.completed", message: this.suppressedOverflowMessage.message });
    this.suppressedOverflowMessage = undefined;
  }

  private async persistCompaction(
    trigger: ContextCompactionRecord["trigger"],
    recoveredFailureEntryId?: string,
  ): Promise<ContextCompactionRecord> {
    const entries = await this.context.session.getEntries();
    const entry = entries.at(-1);
    const record = asRecord(entry);
    if (
      entry?.type !== "compaction" ||
      typeof record?.id !== "string" ||
      typeof record.summary !== "string" ||
      typeof record.tokensBefore !== "number"
    ) {
      throw new Error("Compaction completed without a session entry");
    }
    const tokensAfter = estimateJournalTokens(entries);
    const persisted: PersistedContextCompaction = {
      compactionId: record.id,
      trigger,
      tokensAfter,
      model: this.context.record.model,
      recoveredFailureEntryId,
    };
    await (this.context.session as unknown as CustomEntrySession).appendCustomEntry(CONTEXT_COMPACTION_JOURNAL_TYPE, persisted);
    return {
      id: record.id,
      timestamp: typeof record.timestamp === "string" && !Number.isNaN(Date.parse(record.timestamp)) ? Date.parse(record.timestamp) : Date.now(),
      trigger,
      summary: record.summary,
      tokensBefore: record.tokensBefore,
      tokensAfter,
      model: this.context.record.model,
    };
  }

  private messageId(message: AgentMessage): string {
    const value = asRecord(message);
    if (!value) return randomUUID();
    const existing = this.messageIds.get(value);
    if (existing) return existing;
    const id = randomUUID();
    this.messageIds.set(value, id);
    return id;
  }

  private resolvePendingApprovals(approved: boolean, feedback: string): void {
    for (const [approvalId, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(approvalId);
      const resolution: OperationApprovalResolution = { approvalId, approved, feedback };
      pending.resolve(resolution);
      this.emit({ type: "approval.resolved", messageId: pending.messageId, resolution });
    }
  }

  private resolvePendingApproval(approvalId: string, approved: boolean, feedback?: string): void {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return;
    this.pendingApprovals.delete(approvalId);
    const resolution: OperationApprovalResolution = { approvalId, approved, ...(feedback ? { feedback } : {}) };
    pending.resolve(resolution);
    this.emit({ type: "approval.resolved", messageId: pending.messageId, resolution });
  }

  private resolvePendingNormalApprovals(): void {
    for (const [approvalId, pending] of this.pendingApprovals) {
      if (pending.request.severity !== "normal") continue;
      this.resolvePendingApproval(approvalId, true, "Automatically approved for this session");
    }
  }

  private resolvePendingUserRequests(feedback: string): void {
    for (const [requestId, pending] of this.pendingUserRequests) {
      this.pendingUserRequests.delete(requestId);
      const resolution: UserRequestResolution = { requestId, status: "cancelled", feedback };
      pending.resolve(resolution);
      this.emit({ type: "user-request.resolved", messageId: pending.messageId, resolution });
    }
  }

  private toolDetailsWithInteractions(callId: string, details: unknown): unknown {
    const approval = this.approvalResults.get(callId);
    const userRequest = this.userRequestResults.get(callId);
    if (!approval && !userRequest) return details;
    return {
      ...(asRecord(details) ?? {}),
      ...(approval ? {
        approval: {
          ...approval.approval,
          status: approval.resolution.approved ? "approved" : "rejected",
          feedback: approval.resolution.feedback,
        },
      } : {}),
      ...(userRequest ? { userRequest: { request: userRequest.request, resolution: userRequest.resolution } } : {}),
    };
  }

  private async handleHarnessEvent(event: AgentHarnessEvent): Promise<void> {
    if (event.type === "message_start" && (event.message.role === "assistant" || event.message.role === "user")) {
      // User messages are persisted by AgentHarness before message_end is
      // emitted. Wait for that event so the UI receives the durable journal
      // entry id instead of a driver-local id that cannot be reconciled with
      // a session snapshot during hydration.
      if (event.message.role === "user") return;
      const id = this.messageId(event.message);
      if (event.message.role === "assistant") {
        this.activeAssistantMessageId = id;
        this.emit({
          type: "message.started",
          message: { id, role: "assistant", status: "streaming", blocks: [], model: this.context.record.model, timestamp: Date.now() },
        });
      } else {
        const message = toConversationMessage(event.message, this.context.record.model, id);
        if (message) this.emit({ type: "message.started", message });
      }
      return;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta" && this.activeAssistantMessageId) {
      this.emit({ type: "message.text.delta", messageId: this.activeAssistantMessageId, delta: event.assistantMessageEvent.delta });
      return;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta" && this.activeAssistantMessageId) {
      this.emit({ type: "message.reasoning.delta", messageId: this.activeAssistantMessageId, delta: event.assistantMessageEvent.delta });
      return;
    }
    if (isToolExecutionStart(event) && (this.activeAssistantMessageId ?? this.toolMessageIds.get(event.toolCallId))) {
      const messageId = this.activeAssistantMessageId ?? this.toolMessageIds.get(event.toolCallId);
      if (!messageId) return;
      this.emit({
        type: "tool.started",
        messageId,
        callId: event.toolCallId,
        name: event.toolName,
        input: asRecord(event.args) ?? {},
      });
      return;
    }
    if (isToolExecutionUpdate(event) && (this.activeAssistantMessageId ?? this.toolMessageIds.get(event.toolCallId))) {
      const messageId = this.activeAssistantMessageId ?? this.toolMessageIds.get(event.toolCallId);
      if (!messageId) return;
      this.emit({
        type: "tool.updated",
        messageId,
        callId: event.toolCallId,
        output: contentToText(asRecord(event.partialResult)?.content),
        details: asRecord(event.partialResult)?.details,
        usage: toolUsageFromDetails(asRecord(event.partialResult)?.details),
      });
      return;
    }
    if (isToolExecutionEnd(event) && (this.activeAssistantMessageId ?? this.toolMessageIds.get(event.toolCallId))) {
      const messageId = this.activeAssistantMessageId ?? this.toolMessageIds.get(event.toolCallId);
      if (!messageId) return;
      const result = asRecord(event.result);
      const details = this.toolDetailsWithInteractions(event.toolCallId, result?.details);
      this.emit({
        type: "tool.completed",
        messageId,
        callId: event.toolCallId,
        output: contentToText(result?.content),
        details,
        usage: toolUsageFromDetails(details),
        isError: event.isError,
      });
      return;
    }
    if (event.type === "message_end" && (event.message.role === "assistant" || event.message.role === "user")) {
      const id = event.message.role === "assistant"
        ? this.activeAssistantMessageId ?? this.messageId(event.message)
        : await this.context.session.getLeafId() ?? this.messageId(event.message);
      const completed = toConversationMessage(event.message, this.context.record.model, id);
      if (event.message.role === "user") {
        if (completed) {
          this.emit({ type: "message.started", message: completed });
          this.emit({ type: "message.completed", message: completed });
        }
        return;
      }
      const suppressForRecovery =
        isAssistantMessage(event.message) &&
        event.message.stopReason !== "stop" &&
        !this.overflowRecoveryAttempted &&
        this.isCurrentModelOverflow(event.message);
      if (completed && suppressForRecovery) this.suppressedOverflowMessage = { message: completed };
      else if (completed) this.emit({ type: "message.completed", message: completed });
      if (event.message.role === "assistant") {
        let hasToolCalls = false;
        for (const block of completed?.blocks ?? []) {
          if (block.type === "tool") {
            hasToolCalls = true;
            this.toolMessageIds.set(block.callId, id);
          }
        }
        this.activeAssistantMessageId = hasToolCalls ? id : undefined;
      }
    }
  }
}

export function createAgentHarnessDriver(options: AgentHarnessDriverOptions): AgentDriver {
  const baseFeatures = options.features ?? ["steer", "follow-up", "thinking", "compact", ...(options.createExtensionHost ? ["extensions" as const] : [])];
  const features = baseFeatures.includes("user-request") ? baseFeatures : [...baseFeatures, "user-request" as const];
  return {
    id: options.id,
    features,
    async createSession(context) {
      const session = new AgentHarnessDriverSession(
        context,
        options.createTools(context),
        features,
        options.preflightOperation,
        await persistedBaselinePaths(context),
      );
      await session.initialize(context.executionKind === "subagent" ? undefined : options.createExtensionHost);
      return session;
    },
  };
}

export function createGenericAgentDriver(options: {
  createExtensionHost?: AgentExtensionHostFactory;
  createTools?: (context: AgentDriverSessionContext) => AgentTool[];
} = {}): AgentDriver {
  return createAgentHarnessDriver({
    id: "generic",
    createTools: options.createTools ?? (() => []),
    createExtensionHost: options.createExtensionHost,
  });
}
