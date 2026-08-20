import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { createTwoFilesPatch } from "diff";
import {
  AGENT_EXTENSION_STATE_JOURNAL_TYPE,
  type AgentExtensionManager,
} from "@wordless/agent-extension-runtime";
import {
  isValidFileSecurityPattern,
  resolveFileSecurityRules,
} from "@wordless/capability-filesystem";
import { resolveCommandSecurityRules } from "@wordless/capability-shell";
import type {
  AgentExtensionInteraction,
  AgentExtensionSessionState,
  AgentExtensionSnapshot,
  JsonObject,
} from "@wordless/agent-extension-sdk";
import {
  OPERATION_APPROVAL_JOURNAL_TYPE,
  CONTEXT_COMPACTION_JOURNAL_TYPE,
  SESSION_FILE_BASELINE_JOURNAL_TYPE,
  USER_REQUEST_JOURNAL_TYPE,
  projectUserMessageContent,
  formatPromptWithSkillReferences,
  selectedSkillIdsFromPromptParts,
  type AgentDriverEvent,
  type AgentDriverRegistry,
  type AgentDriverSession,
  type PersistedOperationApproval,
  type PersistedContextCompaction,
  type PersistedSessionFileBaseline,
  type PersistedUserRequest,
  type OperationApprovalRequest,
  type OperationApprovalResolution,
  type SessionFileBaseline,
} from "@wordless/agent-driver-sdk";
import {
  type Api,
  type Credential,
  type CredentialStore,
  type ImageContent,
  type ImagesContext,
  type Model,
  type MutableModels,
  createImagesModels,
  createModels,
  clampThinkingLevel,
  getSupportedThinkingLevels,
} from "@wordless/ai";
import {
  calculateCurrentTurnUsage,
  conversationUsageFromUnknown,
} from "@wordless/domain";
import type {
  AgentInteractionModeId,
  AppPreferences,
  ClarificationBrief,
  ClarificationQuestion,
  ClarificationQuestionAnswer,
  ContextCompactionRecord,
  ConfiguredModelSummary,
  ConversationMessage,
  ConversationUsage,
  EnabledModelRecord,
  MessageBlock,
  MessageToolBlock,
  MessageToolSource,
  MediaAsset,
  MediaBackgroundRemovalRequest,
  MediaCropRequest,
  MediaInlineImage,
  MediaLayoutUpdate,
  MediaViewportUpdate,
  MediaLocalEditRequest,
  MediaMultiViewRequest,
  MediaOperation,
  MediaOperationRequest,
  MediaProject,
  MediaProjectSummary,
  ModelConfigurationSnapshot,
  ModelReference,
  ProviderConnectionRecord,
  SecurityPolicySnapshot,
  SessionDraft,
  SessionRecord,
  ThinkingLevel,
  ToolApprovalMode,
  ToolSecurityRuleMatch,
  UsageReport,
  UsageReportQuery,
  UserMessageSubmission,
  PromptSessionOptions,
  TaskRecord,
  TaskRecordInput,
  TaskStatus,
  UserPromptPart,
  WorkbenchEntryDefinition,
  WorkspaceRecord,
  ExpertSelection,
  ExpertSummary,
  ExpertDefinition,
  ExpertDefinitionInput,
  SessionExpertSnapshot,
  SessionExpertTeamLeaderSnapshot,
  SessionExpertTeamMemberSnapshot,
  ExpertPortrait,
  ExpertTeamDefinition,
  ExpertTeamDefinitionInput,
  ExpertTeamDetail,
  ExpertTeamDetailMember,
  ExpertTeamMemberDefinition,
} from "@wordless/domain";
import type { ProfileDefinition, ProfileRegistry } from "@wordless/profile-sdk";
import {
  PROTOCOL_VERSION,
  type AppSnapshot,
  type RuntimeEvent,
  type RuntimeEventEnvelope,
  type SessionArtifactDiff,
  type SessionArtifactFile,
  type SessionArtifactPreview,
  type SessionArtifactsSnapshot,
  type SessionContextSnapshot,
  type SessionGeneratedArtifact,
  type SessionHistoryPage,
  type SessionHistoryPageRequest,
  type ExpertCollaborationSnapshot,
  type ExpertCollaborationStatus,
  type ExpertMemberLiveMessage,
  type ExpertTaskPhase,
  type SessionMessageSearchRequest,
  type SessionMessageSearchResponse,
  type SessionSnapshot,
  type SessionViewSnapshot,
  type SessionWorkspaceTextFile,
  type WorkspaceFileEntry,
} from "@wordless/protocol";
import {
  WordlessDatabase,
  createWordlessSession,
  openWordlessSession,
  type WordlessSessionMetadata,
} from "@wordless/persistence";
import { WorkspacePathService } from "@wordless/platform-node";
import type { WorkspaceSearchService } from "@wordless/workspace-search";
import {
  ConnectorRegistry,
  type ConnectorAuthorizationCallbacks,
  type ConnectorConfiguration,
} from "@wordless/connector-registry";
import { SkillRegistry } from "@wordless/skill-registry";
import {
  RuntimeModelConfiguration,
  type ModelConfigurationPaths,
} from "./model-configuration.ts";
import {
  SessionSubagentRunner,
  type ExpertMemberStreamEvent,
  type SubagentFileChange,
} from "./subagent-runner.ts";
import { estimateSessionContextUsage } from "./context-usage.ts";
import {
  createSessionHistoryPage,
  createSessionHistoryProjection,
  searchSessionHistoryMessages,
  type SessionHistoryProjection,
} from "./session-history.ts";
import { sessionTitleFromPrompt } from "./session-title.ts";
import {
  UsageReportService,
  conversationUsageFromAiUsage,
} from "./usage-report.ts";

const SUBAGENT_FILE_CHANGE_JOURNAL_TYPE = "wordless.subagent-file-change";
const CLARIFICATION_ANSWER_JOURNAL_TYPE = "wordless.clarification-answer";
const SESSION_ARTIFACTS_DIRECTORY = "artifacts";
const PRIMARY_ARTIFACTS_DIRECTORY = "primary";
const SHARED_ARTIFACTS_DIRECTORY = "shared";

const BUILTIN_EXPERTS: ExpertSummary[] = [
  {
    id: "research-analyst",
    version: "1",
    name: "研究分析师",
    description: "把复杂问题拆成可验证的研究结论和行动建议。",
    portrait: { kind: "builtin", key: "research-analyst" },
    kind: "expert",
    skillCount: 0,
    connectorCount: 0,
    source: "builtin",
  },
  {
    id: "product-strategist",
    version: "1",
    name: "产品策略师",
    description: "从用户目标、约束和证据出发，形成清晰的产品决策。",
    portrait: { kind: "builtin", key: "product-strategist" },
    kind: "expert",
    skillCount: 0,
    connectorCount: 0,
    source: "builtin",
  },
  {
    id: "content-studio",
    version: "1",
    name: "内容创作工作室",
    description:
      "由内容主理人协调策划、撰写与审校，把模糊的创作目标推进为完整且可发布的内容。",
    portrait: { kind: "builtin", key: "content-studio" },
    kind: "team",
    memberCount: 3,
    skillCount: 0,
    connectorCount: 0,
    source: "builtin",
    tags: ["内容策略", "写作", "审校"],
    roleLabel: "3 位专家协作",
  },
];

const BUILTIN_TEAM_MEMBERS: Record<
  string,
  Array<Omit<ExpertTeamDetailMember, "available">>
> = {
  "content-studio": [
    {
      id: "content-writer",
      name: "内容撰稿人",
      portrait: { kind: "builtin", key: "product-strategist" },
      systemPrompt:
        "You are the Content Writer. Write the complete deliverable from the assigned brief and upstream material. Maintain a consistent voice, concrete argument flow, and clear evidence boundaries. Do not replace missing facts with invention, and do not switch into reviewer or coordinator voice.",
      skillIds: [],
      connectorIds: [],
      executionProfile: "workspace-write",
      responsibility: "把研究和大纲转化为符合受众、语气与渠道要求的完整初稿。",
    },
    {
      id: "content-reviewer",
      name: "内容审校",
      portrait: { kind: "builtin", key: "research-analyst" },
      systemPrompt:
        "You are the Content Reviewer. Independently inspect the draft for factual support, logical gaps, audience fit, structure, tone, repetition, and publication risk. Cite exact passages when raising issues and provide prioritized, directly actionable revisions. Do not merely summarize the draft or assume the writer's voice.",
      skillIds: [],
      connectorIds: [],
      executionProfile: "workspace-write",
      responsibility: "检查逻辑、事实、表达与一致性，给出可执行的修改建议。",
    },
  ],
};

const BUILTIN_TEAM_LEADERS: Record<
  string,
  Omit<ExpertTeamDetailMember, "available">
> = {
  "content-studio": {
    id: "content-lead",
    name: "内容主理人",
    portrait: { kind: "builtin", key: "content-studio" },
    systemPrompt:
      "You are the Content Lead and the accountable editor speaking directly with the user. Lead with a clear editorial judgment, define the audience and promise, separate verified evidence from interpretation, and use precise, confident language rather than a generic assistant voice.",
    skillIds: [],
    connectorIds: [],
    executionProfile: "workspace-write",
    responsibility: "负责主对话、任务调度和最终交付。",
  },
};

const BUILTIN_TEAM_SUGGESTIONS: Record<string, string[]> = {
  "content-studio": [
    "围绕一个主题完成带资料依据的内容选题与文章初稿。",
    "把现有材料整理成清晰的大纲，并输出适合目标读者的完整内容。",
    "审校这篇内容的事实、结构和表达，并给出可直接修改的建议。",
  ],
};

const BUILTIN_EXPERT_PROMPTS: Record<string, string> = {
  "research-analyst":
    "You are the Research Analyst expert. Work from evidence, separate facts from assumptions, state uncertainty, and finish with actionable conclusions.",
  "product-strategist":
    "You are the Product Strategist expert. Clarify the target user and decision, compare tradeoffs, and produce a prioritized recommendation with measurable acceptance criteria.",
  "content-lead":
    "You are the Content Lead and the accountable editor speaking directly with the user. Lead with a clear editorial judgment, define the audience and promise, separate verified evidence from interpretation, and use precise, confident language rather than a generic assistant voice. When current facts or external context matter, use your available web research connectors and preserve source URLs, dates, and caveats. You may complete straightforward work yourself. When delegation materially improves the result, prepare a self-contained evidence packet and brief, read every member result, resolve conflicts, and deliver the final coherent answer in your own lead-editor voice.",
  "content-writer":
    "You are the Content Writer. Write the complete deliverable from the assigned brief and upstream material. Maintain a consistent voice, concrete argument flow, and clear evidence boundaries. Do not replace missing facts with invention, and do not switch into reviewer or coordinator voice.",
  "content-reviewer":
    "You are the Content Reviewer. Independently inspect the draft for factual support, logical gaps, audience fit, structure, tone, repetition, and publication risk. Cite exact passages when raising issues and provide prioritized, directly actionable revisions. Do not merely summarize the draft or assume the writer's voice.",
};

const BUILTIN_TEAM_PROMPTS: Record<string, string> = {
  "content-studio":
    "You are the only lead, primary conversational identity, and final decision-maker of the Content Studio. Clarify the audience, goal, tone, constraints, evidence boundary, and acceptance criteria. Decide deliberately whether member specialization creates enough quality, verification, or perspective gain to justify delegation. Simple questions and work you can complete to a high standard may stay with you. When you delegate, give each member a self-contained brief, read the results, resolve disagreements, and deliver one coherent final result in your own decisive lead-editor voice. Never delegate work back to yourself or expose raw member output as the final answer.",
};

function expertSummary(expert: ExpertDefinition): ExpertSummary {
  const {
    id,
    version,
    name,
    description,
    portrait,
    kind,
    skillCount,
    connectorCount,
    source,
    tags,
    categories,
    roleLabel,
  } = expert;
  return {
    id,
    version,
    name,
    description,
    portrait,
    kind,
    skillCount,
    connectorCount,
    source,
    tags,
    categories,
    roleLabel,
  };
}
function teamSummary(team: ExpertTeamDefinition): ExpertSummary {
  const {
    id,
    version,
    name,
    description,
    portrait,
    kind,
    memberCount,
    skillCount,
    connectorCount,
    source,
    tags,
    categories,
    roleLabel,
  } = team;
  return {
    id,
    version,
    name,
    description,
    portrait,
    kind,
    memberCount,
    skillCount,
    connectorCount,
    source,
    tags,
    categories,
    roleLabel,
  };
}

type PersistedClarificationAnswer = ClarificationQuestionAnswer;

type LegacyMediaScene = {
  id: string;
  index: number;
  title: string;
  shot: string;
  prompt: string;
  status: "draft" | "rendering" | "ready" | "failed";
  kind: "image" | "video";
  ratio: string;
  outputCount: number;
  outputTotal: number;
  providerId: string | null;
  modelId: string | null;
  imageUrls: string[];
  primaryAssetId?: string | null;
  errorMessage: string | null;
  x: number;
  y: number;
  width: number;
};

type LegacyMediaProject = {
  documentVersion?: unknown;
  sessionId: string;
  title: string;
  scenes: LegacyMediaScene[];
  viewport: MediaProject["viewport"];
  createdAt: number;
  updatedAt: number;
};

type MediaProjectV2 = {
  documentVersion: 2;
  sessionId: string;
  title: string;
  scenes: Array<{
    id: string;
    primaryAssetId: string | null;
    x: number;
    y: number;
  }>;
  assets: Array<{
    id: string;
    sceneId: string;
    generationId: string;
    kind: "image" | "video";
    status: "rendering" | "ready" | "failed";
    url: string | null;
    errorMessage: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    candidateIndex: number;
    createdAt: number;
    updatedAt: number;
  }>;
  generations: Array<{
    id: string;
    action: "generate" | "regenerate" | "variation" | "local-edit" | "upscale";
    parentAssetIds: string[];
    prompt: string;
    ratio: string;
    outputCount: number;
    outputTotal: number;
    providerId: string;
    modelId: string;
    status: "rendering" | "ready" | "failed";
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  viewport: MediaProject["viewport"];
  createdAt: number;
  updatedAt: number;
};

function mimeTypeForMediaName(value: string): string {
  const extension = extname(value).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function extensionForMediaMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

export interface CredentialVault {
  read(id: string): Promise<string | undefined>;
  write(id: string, value: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface RuntimePaths {
  dataRoot: string;
  databasePath: string;
  builtInSkillsRoot?: string;
  journalsRoot: string;
  modelConfiguration?: ModelConfigurationPaths;
  sessionWorkspacesRoot: string;
}

export interface RuntimeOptions {
  paths: RuntimePaths;
  credentialVault: CredentialVault;
  defaultWorkspaceRoot: string;
  profiles: ProfileRegistry;
  drivers: AgentDriverRegistry;
  extensions: AgentExtensionManager;
  workspaceSearch: WorkspaceSearchService;
}

export const BUILTIN_ENTRIES: WorkbenchEntryDefinition[] = [
  {
    id: "general-work",
    mode: "everyday",
    labelKey: "entryGeneralWork",
    descriptionKey: "entryGeneralWorkDescription",
    iconKey: "sparkles",
    profile: { id: "general", version: "1" },
    workbenchId: "conversation",
    availability: "available",
    modelRequirements: { requiresToolUse: true },
  },
  {
    id: "presentation",
    mode: "everyday",
    labelKey: "entryPresentation",
    descriptionKey: "entryPresentationDescription",
    iconKey: "presentation",
    profile: { id: "ppt", version: "1" },
    workbenchId: "presentation",
    availability: "available",
    modelRequirements: { requiresVision: true, requiresToolUse: true },
  },
  {
    id: "spreadsheet",
    mode: "everyday",
    labelKey: "entrySpreadsheet",
    descriptionKey: "entrySpreadsheetDescription",
    iconKey: "table",
    profile: { id: "excel", version: "1" },
    workbenchId: "workbook",
    availability: "available",
    modelRequirements: { requiresToolUse: true },
  },
  {
    id: "data-analysis",
    mode: "everyday",
    labelKey: "entryDataAnalysis",
    descriptionKey: "entryDataAnalysisDescription",
    iconKey: "chart",
    profile: { id: "data", version: "1" },
    workbenchId: "analysis",
    availability: "available",
    modelRequirements: { requiresToolUse: true },
  },
  {
    id: "code-development",
    mode: "code",
    labelKey: "entryCodeDevelopment",
    descriptionKey: "entryCodeDevelopmentDescription",
    iconKey: "code",
    profile: { id: "coding", version: "1" },
    workbenchId: "code",
    availability: "available",
    modelRequirements: { requiresToolUse: true },
  },
  {
    id: "ui-design",
    mode: "create",
    labelKey: "entryUiDesign",
    descriptionKey: "entryUiDesignDescription",
    iconKey: "palette",
    profile: { id: "ui", version: "1" },
    workbenchId: "ui-preview",
    availability: "unavailable",
    modelRequirements: { requiresVision: true, requiresToolUse: true },
  },
  {
    id: "image-generation",
    mode: "create",
    labelKey: "entryImageGeneration",
    descriptionKey: "entryImageGenerationDescription",
    iconKey: "image",
    profile: { id: "general", version: "1" },
    workbenchId: "media-canvas",
    availability: "available",
    modelRequirements: {},
  },
];

const DEFAULT_PREFERENCES = (defaultWorkspaceRoot: string): AppPreferences => ({
  locale: "zh-CN",
  theme: "system",
  fontScale: 1,
  reduceMotion: false,
  notifications: {
    enabled: false,
    onActionRequired: true,
    onRunCompleted: true,
    onRunFailed: true,
  },
  security: {
    customFileRules: [],
    customCommandRules: [],
  },
  appearance: {
    background: {
      source: { kind: "none" },
      fit: "cover",
      position: { x: 50, y: 50 },
      intensity: 40,
      blurPx: 0,
    },
  },
  defaultWorkspaceRoot,
  defaultModel: null,
  entryModels: {},
});

function connectionSecretId(connectionId: string): string {
  return `provider:${connectionId}`;
}

function isCompatible(
  model: EnabledModelRecord,
  entry: WorkbenchEntryDefinition,
): boolean {
  const requirements = entry.modelRequirements;
  if (requirements.requiresVision && !model.capabilities.supportsVision)
    return false;
  if (
    requirements.requiresToolUse &&
    model.capabilities.supportsToolUse === false
  )
    return false;
  if (
    requirements.minimumContextWindow &&
    model.capabilities.contextWindow < requirements.minimumContextWindow
  )
    return false;
  return true;
}

function thinkingLevelForModel(
  model: Model<Api>,
  requested: ThinkingLevel = "medium",
): ThinkingLevel {
  if (!model.reasoning) return "off";
  return clampThinkingLevel(model, requested) as ThinkingLevel;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageToolSourceFromUnknown(
  value: unknown,
): MessageToolSource | undefined {
  const source = asRecord(value);
  if (
    source?.kind !== "mcp" ||
    typeof source.connectorId !== "string" ||
    typeof source.connectorName !== "string" ||
    typeof source.toolName !== "string" ||
    (source.transport !== "stdio" && source.transport !== "streamable-http")
  )
    return undefined;
  const templateId =
    source.templateId === "feishu" ||
    source.templateId === "dingtalk" ||
    source.templateId === "wecom" ||
    source.templateId === "postgresql" ||
    source.templateId === "web-search" ||
    source.templateId === "firecrawl" ||
    source.templateId === "github" ||
    source.templateId === "ai-hot" ||
    source.templateId === null
      ? source.templateId
      : null;
  return {
    kind: "mcp",
    connectorId: source.connectorId,
    connectorName: source.connectorName,
    toolName: source.toolName,
    templateId,
    transport: source.transport,
  };
}

function persistedToolDetails(value: unknown): {
  details: unknown;
  source?: MessageToolSource;
} {
  const record = asRecord(value);
  if (!record) return { details: value };
  const source = messageToolSourceFromUnknown(record.toolSource);
  if (!source) return { details: value };
  const { toolSource: _toolSource, ...details } = record;
  return { details, source };
}

const EXPERT_COLLABORATION_STATUSES = new Set<ExpertCollaborationStatus>([
  "queued",
  "running",
  "awaiting-approval",
  "awaiting-user-input",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
]);
const EXPERT_TASK_PHASES = new Set<ExpertTaskPhase>([
  "queued",
  "thinking",
  "tool",
  "approval",
  "user-input",
  "finished",
]);

export function createExpertCollaborationSnapshot(
  messages: readonly ConversationMessage[],
  expert: SessionExpertSnapshot | undefined,
): ExpertCollaborationSnapshot | undefined {
  if (expert?.kind !== "team") return undefined;
  const roster = new Map(
    expert.teamMembers.map((member) => [member.id, member]),
  );
  const activity = new Map<
    string,
    {
      latestStatus: ExpertCollaborationStatus;
      phase?: ExpertTaskPhase;
      startedAt?: number;
      activeToolName?: string;
      blockedByTaskId?: string;
      terminalReason?: string;
      lastActiveAt: number;
      taskIds: Set<string>;
    }
  >();
  for (const message of messages)
    for (const block of message.blocks) {
      if (block.type !== "tool" || block.name !== "delegate_expert") continue;
      const tasks = asRecord(block.details)?.tasks;
      if (!Array.isArray(tasks)) continue;
      for (const value of tasks) {
        const task = asRecord(value);
        if (
          typeof task?.id !== "string" ||
          typeof task.memberId !== "string" ||
          typeof task.status !== "string" ||
          !EXPERT_COLLABORATION_STATUSES.has(
            task.status as ExpertCollaborationStatus,
          ) ||
          !roster.has(task.memberId)
        )
          continue;
        const eventActiveAt = Array.isArray(task.events)
          ? task.events.reduce((latest, event) => {
              const at = asRecord(event)?.at;
              return typeof at === "number" ? Math.max(latest, at) : latest;
            }, message.timestamp)
          : message.timestamp;
        const lastActiveAt =
          typeof task.updatedAt === "number" ? task.updatedAt : eventActiveAt;
        const phase =
          typeof task.phase === "string" &&
          EXPERT_TASK_PHASES.has(task.phase as ExpertTaskPhase)
            ? (task.phase as ExpertTaskPhase)
            : undefined;
        const taskState = {
          latestStatus: task.status as ExpertCollaborationStatus,
          ...(phase ? { phase } : {}),
          ...(typeof task.startedAt === "number"
            ? { startedAt: task.startedAt }
            : {}),
          ...(typeof task.activeToolName === "string"
            ? { activeToolName: task.activeToolName }
            : {}),
          ...(typeof task.blockedByTaskId === "string"
            ? { blockedByTaskId: task.blockedByTaskId }
            : {}),
          ...(typeof task.terminalReason === "string"
            ? { terminalReason: task.terminalReason }
            : {}),
          lastActiveAt,
        };
        const current = activity.get(task.memberId);
        if (!current) {
          activity.set(task.memberId, {
            ...taskState,
            taskIds: new Set([task.id]),
          });
          continue;
        }
        current.taskIds.add(task.id);
        if (lastActiveAt >= current.lastActiveAt) {
          Object.assign(current, taskState);
        }
      }
    }
  const members = expert.teamMembers.flatMap((member) => {
    const current = activity.get(member.id);
    return current
      ? [
          {
            memberId: member.id,
            name: member.expertName,
            portrait: member.portrait,
            executionProfile: member.executionProfile,
            latestStatus: current.latestStatus,
            ...(current.phase ? { phase: current.phase } : {}),
            ...(current.startedAt ? { startedAt: current.startedAt } : {}),
            ...(current.activeToolName
              ? { activeToolName: current.activeToolName }
              : {}),
            ...(current.blockedByTaskId
              ? { blockedByTaskId: current.blockedByTaskId }
              : {}),
            ...(current.terminalReason
              ? { terminalReason: current.terminalReason }
              : {}),
            taskCount: current.taskIds.size,
            lastActiveAt: current.lastActiveAt,
          },
        ]
      : [];
  });
  return {
    teamId: expert.selection.id,
    teamName: expert.teamName,
    teamPortrait: expert.teamPortrait,
    leader: {
      expertId: expert.leader.expertId,
      name: expert.leader.expertName,
      portrait: expert.leader.portrait,
    },
    members,
  };
}

export function activeExpertSystemPrompt(
  expert: SessionExpertSnapshot,
): string {
  const identity = `[ACTIVE EXPERT ROLE]\nYou are operating as ${expert.name}. Treat this role as the primary identity for the session. Keep your decisions, tone, terminology, and deliverables aligned with this expert role. Do not fall back to a generic assistant voice when the request is within this role's responsibility.\n\n${expert.systemPrompt}`;
  if (expert.kind !== "team") return identity;
  const roster = expert.teamMembers
    .map(
      (member) =>
        `- memberId=${member.id}; name=${member.expertName}; responsibility=${member.responsibility}`,
    )
    .join("\n");
  return `${identity}\n\n[AUTHORITATIVE EXPERT TEAM]\nTeam: ${expert.teamName}\nTeam Lead: ${expert.leader.expertName} (not delegable)\nDelegable members:\n${roster}\n\nThis roster comes directly from the Wordless runtime and is authoritative for this session. When asked who is on the team, answer directly with the Team Lead and these members. Use the listed memberId values for delegate_expert. Never search the workspace, user home directory, environment variables, skills, plugins, or unrelated configuration files for team membership.`;
}

export function expertConnectorScopes(
  sessionConnectorIds: readonly string[],
  expert: SessionExpertSnapshot | undefined,
): { primary: string[]; delegates: string[] } {
  const primary = [
    ...new Set([...sessionConnectorIds, ...(expert?.connectorIds ?? [])]),
  ];
  return {
    primary,
    delegates: [
      ...new Set([
        ...primary,
        ...(expert?.kind === "team"
          ? expert.teamMembers.flatMap((member) => member.connectorIds)
          : []),
      ]),
    ],
  };
}

function validCustomFileRules(
  value: AppPreferences["security"]["customFileRules"],
): AppPreferences["security"]["customFileRules"] {
  return Array.isArray(value)
    ? value.flatMap((rule) =>
        typeof rule?.id === "string" &&
        typeof rule.label === "string" &&
        typeof rule.pattern === "string" &&
        rule.id.trim() &&
        rule.label.trim() &&
        isValidFileSecurityPattern(rule.pattern)
          ? [{ id: rule.id, label: rule.label, pattern: rule.pattern }]
          : [],
      )
    : [];
}

function validCustomCommandRules(
  value: AppPreferences["security"]["customCommandRules"],
): AppPreferences["security"]["customCommandRules"] {
  return Array.isArray(value)
    ? value.flatMap((rule) =>
        typeof rule?.id === "string" &&
        typeof rule.label === "string" &&
        typeof rule.command === "string" &&
        rule.id.trim() &&
        rule.label.trim() &&
        rule.command.trim()
          ? [{ id: rule.id, label: rule.label, command: rule.command }]
          : [],
      )
    : [];
}

function contentToText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((item) => {
      const record = asRecord(item);
      return record?.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join("\n");
}

function toConversationUsage(value: unknown): ConversationUsage | undefined {
  const usage = asRecord(value);
  const cost = asRecord(usage?.cost);
  const inputTokens = typeof usage?.input === "number" ? usage.input : 0;
  const outputTokens = typeof usage?.output === "number" ? usage.output : 0;
  const cacheReadTokens =
    typeof usage?.cacheRead === "number" ? usage.cacheRead : 0;
  const cacheWriteTokens =
    typeof usage?.cacheWrite === "number" ? usage.cacheWrite : 0;
  const totalTokens =
    typeof usage?.totalTokens === "number"
      ? usage.totalTokens
      : typeof usage?.total === "number"
        ? usage.total
        : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalCost = typeof cost?.total === "number" ? cost.total : 0;
  if (
    totalTokens === 0 &&
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheWriteTokens === 0
  )
    return undefined;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalCost,
  };
}

function persistedApproval(
  value: unknown,
): PersistedOperationApproval | undefined {
  const record = asRecord(value);
  const approval = asRecord(record?.approval);
  const resolution = asRecord(record?.resolution);
  if (
    typeof record?.callId !== "string" ||
    typeof approval?.approvalId !== "string"
  ) {
    return undefined;
  }
  if (
    resolution &&
    (typeof resolution.approvalId !== "string" ||
      typeof resolution.approved !== "boolean")
  )
    return undefined;
  const matchedRules = Array.isArray(approval.matchedRules)
    ? approval.matchedRules.flatMap((candidate): ToolSecurityRuleMatch[] => {
        const rule = asRecord(candidate);
        if (
          (rule?.category !== "file" && rule?.category !== "command") ||
          typeof rule.id !== "string" ||
          typeof rule.label !== "string" ||
          (rule.source !== "builtin" && rule.source !== "custom")
        ) {
          return [];
        }
        return [
          {
            category: rule.category,
            id: rule.id,
            label: rule.label,
            source: rule.source,
          },
        ];
      })
    : [];
  return {
    callId: record.callId,
    approval: {
      ...(approval as unknown as OperationApprovalRequest),
      severity: approval.severity === "high" ? "high" : "normal",
      matchedRules,
    },
    ...(resolution
      ? {
          resolution: {
            ...(resolution as unknown as OperationApprovalResolution),
            approvalId: resolution.approvalId as string,
            approved: resolution.approved as boolean,
            ...(typeof resolution.feedback === "string"
              ? { feedback: resolution.feedback }
              : {}),
          },
        }
      : {}),
  };
}

function persistedFileBaseline(
  value: unknown,
): PersistedSessionFileBaseline | undefined {
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

function persistedSubagentFileChange(
  value: unknown,
): SubagentFileChange | undefined {
  const record = asRecord(value);
  const baseline = asRecord(record?.baseline);
  if (
    typeof record?.taskId !== "string" ||
    (record.role !== "scout" &&
      record.role !== "planner" &&
      record.role !== "reviewer" &&
      record.role !== "worker" &&
      record.role !== "researcher" &&
      record.role !== "research-reviewer" &&
      record.role !== "expert-member") ||
    typeof record.path !== "string" ||
    (record.kind !== "created" && record.kind !== "modified") ||
    typeof baseline?.path !== "string" ||
    typeof baseline.existed !== "boolean" ||
    (typeof baseline.content !== "string" && baseline.content !== null)
  ) {
    return undefined;
  }
  return {
    taskId: record.taskId,
    role: record.role,
    path: record.path,
    kind: record.kind,
    baseline: {
      path: baseline.path,
      existed: baseline.existed,
      content: baseline.content,
    },
  };
}

function artifactDirectoryName(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe || "member";
}

function artifactGroup(
  relativePath: string,
  memberByDirectory: Map<string, SessionExpertTeamMemberSnapshot>,
): string {
  const directory = relativePath.split("/")[0] ?? "";
  if (!directory) return "primary";
  if (directory === PRIMARY_ARTIFACTS_DIRECTORY) return "primary";
  if (directory === SHARED_ARTIFACTS_DIRECTORY) return "shared";
  const member = memberByDirectory.get(directory);
  return member ? member.id : directory;
}

function artifactPreviewKind(
  name: string,
): SessionGeneratedArtifact["previewKind"] {
  const extension = extname(name).toLowerCase();
  if ([".md", ".markdown", ".mdx"].includes(extension)) return "markdown";
  if (
    [
      ".txt",
      ".json",
      ".jsonl",
      ".csv",
      ".tsv",
      ".html",
      ".css",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".yaml",
      ".yml",
      ".xml",
      ".log",
    ].includes(extension)
  )
    return "text";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension))
    return "image";
  return "external";
}

function persistedUserRequest(
  value: unknown,
): PersistedUserRequest | undefined {
  const record = asRecord(value);
  const request = asRecord(record?.request);
  const resolution =
    record?.resolution === undefined ? undefined : asRecord(record.resolution);
  if (
    typeof record?.callId !== "string" ||
    typeof request?.requestId !== "string" ||
    typeof request.callId !== "string" ||
    typeof request.toolName !== "string" ||
    typeof request.title !== "string" ||
    !Array.isArray(request.fields) ||
    (resolution !== undefined &&
      (typeof resolution.requestId !== "string" ||
        (resolution.status !== "submitted" &&
          resolution.status !== "cancelled")))
  ) {
    return undefined;
  }
  return value as PersistedUserRequest;
}

function persistedContextCompaction(
  value: unknown,
): PersistedContextCompaction | undefined {
  const record = asRecord(value);
  const model = asRecord(record?.model);
  if (
    typeof record?.compactionId !== "string" ||
    (record.trigger !== "manual" &&
      record.trigger !== "automatic" &&
      record.trigger !== "overflow") ||
    typeof record.tokensAfter !== "number" ||
    (record.recoveredFailureEntryId !== undefined &&
      typeof record.recoveredFailureEntryId !== "string") ||
    typeof model?.connectionId !== "string" ||
    typeof model.modelId !== "string"
  ) {
    return undefined;
  }
  return {
    compactionId: record.compactionId,
    trigger: record.trigger,
    tokensAfter: record.tokensAfter,
    model: { connectionId: model.connectionId, modelId: model.modelId },
    recoveredFailureEntryId:
      typeof record.recoveredFailureEntryId === "string"
        ? record.recoveredFailureEntryId
        : undefined,
  };
}

function clarificationQuestionFromDetails(
  value: unknown,
): ClarificationQuestion | undefined {
  const details = asRecord(value);
  const question = asRecord(details?.clarificationQuestion);
  const recommendation = asRecord(question?.recommendation);
  if (
    !question ||
    typeof question.question !== "string" ||
    (question.answerType !== "choice" &&
      question.answerType !== "text" &&
      question.answerType !== "confirm") ||
    (question.purpose !== "discovery" &&
      question.purpose !== "final-confirmation") ||
    !recommendation ||
    typeof recommendation.answer !== "string" ||
    typeof recommendation.reason !== "string"
  ) {
    return undefined;
  }
  const options = Array.isArray(question.options)
    ? question.options.flatMap((candidate) => {
        const option = asRecord(candidate);
        return typeof option?.value === "string" &&
          typeof option.label === "string"
          ? [
              {
                value: option.value,
                label: option.label,
                ...(typeof option.description === "string"
                  ? { description: option.description }
                  : {}),
              },
            ]
          : [];
      })
    : undefined;
  if (question.answerType === "choice" && (!options || options.length === 0))
    return undefined;
  return {
    question: question.question,
    ...(typeof question.context === "string"
      ? { context: question.context }
      : {}),
    answerType: question.answerType,
    ...(options ? { options } : {}),
    recommendation: {
      answer: recommendation.answer,
      ...(typeof recommendation.value === "string"
        ? { value: recommendation.value }
        : {}),
      reason: recommendation.reason,
    },
    ...(typeof question.allowCustom === "boolean"
      ? { allowCustom: question.allowCustom }
      : {}),
    purpose: question.purpose,
  };
}

function hasPositiveClarificationConfirmation(value: unknown): boolean {
  const question = clarificationQuestionFromDetails(value);
  const answer = asRecord(asRecord(value)?.clarificationAnswer);
  return question?.purpose === "final-confirmation" && answer?.value === true;
}

function clarificationBriefFromDetails(
  value: unknown,
): ClarificationBrief | undefined {
  const details = asRecord(value);
  const brief = asRecord(details?.clarificationBrief);
  if (
    !brief ||
    typeof brief.title !== "string" ||
    typeof brief.summary !== "string" ||
    typeof brief.recommendedNextStep !== "string"
  )
    return undefined;
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  const decisions = Array.isArray(brief.decisions)
    ? brief.decisions.flatMap((candidate) => {
        const decision = asRecord(candidate);
        return typeof decision?.topic === "string" &&
          typeof decision.outcome === "string"
          ? [
              {
                topic: decision.topic,
                outcome: decision.outcome,
                ...(typeof decision.rationale === "string"
                  ? { rationale: decision.rationale }
                  : {}),
              },
            ]
          : [];
      })
    : [];
  return {
    title: brief.title,
    summary: brief.summary,
    goals: strings(brief.goals),
    constraints: strings(brief.constraints),
    decisions,
    openQuestions: strings(brief.openQuestions),
    recommendedNextStep: brief.recommendedNextStep,
  };
}

function persistedClarificationAnswer(
  value: unknown,
): PersistedClarificationAnswer | undefined {
  const answer = asRecord(value);
  if (
    typeof answer?.callId !== "string" ||
    (typeof answer.value !== "string" && typeof answer.value !== "boolean") ||
    typeof answer.submittedAt !== "number"
  ) {
    return undefined;
  }
  return {
    callId: answer.callId,
    value: answer.value,
    submittedAt: answer.submittedAt,
  };
}

function normalizeToLf(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

function unifiedPatch(path: string, before: string, after: string): string {
  return createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    normalizeToLf(before),
    normalizeToLf(after),
    undefined,
    undefined,
    { context: 3 },
  );
}

function workspaceRelativePath(
  rootPath: string,
  path: string,
): string | undefined {
  const candidate = isAbsolute(path) ? relative(rootPath, path) : path;
  if (isAbsolute(candidate)) return undefined;
  const normalized = candidate.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  )
    return undefined;
  return normalized;
}

function approvalFileBaseline(
  value: PersistedOperationApproval,
): SessionFileBaseline | undefined {
  if (!value.resolution?.approved) return undefined;
  const preview = asRecord(value.approval.preview);
  if (
    preview?.type !== "diff" ||
    preview.truncated === true ||
    typeof preview.path !== "string" ||
    typeof preview.before !== "string"
  ) {
    return undefined;
  }
  return { path: preview.path, existed: true, content: preview.before };
}

class VaultCredentialStore implements CredentialStore {
  private readonly vault: CredentialVault;

  constructor(vault: CredentialVault) {
    this.vault = vault;
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const serialized = await this.vault.read(connectionSecretId(providerId));
    return serialized ? (JSON.parse(serialized) as Credential) : undefined;
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const current = await this.read(providerId);
    const next = await fn(current);
    if (next)
      await this.vault.write(
        connectionSecretId(providerId),
        JSON.stringify(next),
      );
    return next ?? current;
  }

  async delete(providerId: string): Promise<void> {
    await this.vault.delete(connectionSecretId(providerId));
  }
}

function terminalizeToolDetails(details: unknown, reason: string): unknown {
  if (typeof details !== "object" || details === null || Array.isArray(details))
    return details;
  const record = details as Record<string, unknown>;
  if (!Array.isArray(record.tasks)) return details;
  return {
    ...record,
    updatedAt: Date.now(),
    tasks: record.tasks.map((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return value;
      const task = value as Record<string, unknown>;
      const status = task.status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "cancelled"
      )
        return task;
      return {
        ...task,
        status: "cancelled",
        completedAt: Date.now(),
        error: typeof task.error === "string" ? task.error : reason,
        ...(typeof task.activeTool === "object" &&
        task.activeTool !== null &&
        !Array.isArray(task.activeTool)
          ? {
              activeTool: {
                ...(task.activeTool as Record<string, unknown>),
                state: "error",
              },
            }
          : {}),
      };
    }),
  };
}

type ActiveRun = {
  driverSession: AgentDriverSession;
  subagents: SessionSubagentRunner;
  tools: Map<string, MessageToolBlock & { messageId: string }>;
  kind: "prompt" | "compaction";
  isCompacting: boolean;
  compactionTrigger?: ContextCompactionRecord["trigger"];
  sequence: number;
  runId: string;
  userMessageId?: string;
  taskId?: string;
  runError?: string;
  unsubscribe: () => void;
};

type CachedSessionHistory = {
  bytes: number;
  projection: SessionHistoryProjection;
  revision: string;
  snapshot: SessionSnapshot;
};

export class WordlessRuntime {
  private readonly database: WordlessDatabase;
  private readonly modelConfiguration: RuntimeModelConfiguration;
  private readonly pathService = new WorkspacePathService();
  private readonly profiles: ProfileRegistry;
  private readonly drivers: AgentDriverRegistry;
  private readonly extensions: AgentExtensionManager;
  private readonly skillRegistry: SkillRegistry;
  private readonly connectorRegistry: ConnectorRegistry;
  private readonly models: MutableModels;
  private readonly usageReport: UsageReportService;
  private readonly listeners = new Set<(event: RuntimeEventEnvelope) => void>();
  private readonly historyCache = new Map<string, CachedSessionHistory>();
  private readonly artifactRevisions = new Map<string, string>();
  private readonly runs = new Map<string, ActiveRun>();
  private readonly approvalResolutions = new Map<string, Promise<void>>();
  private readonly mediaOperations = new Map<string, AbortController>();
  private readonly runtimeInstanceId = randomUUID();
  private appSequence = 0;
  private preferences: AppPreferences;
  private readonly options: RuntimeOptions;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.database = new WordlessDatabase(options.paths.databasePath);
    this.preferences = this.database.getPreferences(
      DEFAULT_PREFERENCES(options.defaultWorkspaceRoot),
    );
    this.profiles = options.profiles;
    this.drivers = options.drivers;
    this.extensions = options.extensions;
    this.skillRegistry = new SkillRegistry({
      paths: {
        configPath: join(options.paths.dataRoot, "skills.json"),
        managedRoot: join(options.paths.dataRoot, "skills"),
      },
      homeDir: homedir(),
      builtInRoots: options.paths.builtInSkillsRoot
        ? [options.paths.builtInSkillsRoot]
        : [],
    });
    this.connectorRegistry = new ConnectorRegistry({
      configPath: join(options.paths.dataRoot, "connectors.json"),
    });
    this.models = createModels({
      credentials: new VaultCredentialStore(options.credentialVault),
    });
    this.modelConfiguration = new RuntimeModelConfiguration({
      credentials: new VaultCredentialStore(options.credentialVault),
      imageModels: createImagesModels({
        credentials: new VaultCredentialStore(options.credentialVault),
      }),
      models: this.models,
      paths: options.paths.modelConfiguration ?? {
        extensionsRoot: join(options.paths.dataRoot, "provider-extensions"),
        modelsPath: join(options.paths.dataRoot, "models.json"),
        settingsPath: join(options.paths.dataRoot, "settings.json"),
      },
    });
    this.usageReport = new UsageReportService({
      database: this.database,
      journalsRoot: options.paths.journalsRoot,
      getMediaProject: (sessionId) => this.database.getMediaProject(sessionId),
      listSessions: () => this.database.listSessions(),
    });
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.paths.dataRoot, { recursive: true });
    await mkdir(this.options.paths.journalsRoot, { recursive: true });
    await mkdir(this.options.paths.sessionWorkspacesRoot, { recursive: true });
    await mkdir(this.mediaAssetsRoot(), { recursive: true });
    await this.extensions.initialize();
    if (this.database.claimMigration(2)) {
      for (const connection of this.database.clearLegacyModelConfiguration()) {
        await this.options.credentialVault.delete(
          connectionSecretId(connection.id),
        );
      }
    }
    await this.refreshWorkspaceAvailability();
    await this.skillRegistry.initialize(this.database.listWorkspaces());
    this.skillRegistry.subscribe(() =>
      this.emitApp({ type: "skills.changed" }),
    );
    await this.connectorRegistry.initialize();
    this.connectorRegistry.subscribe(() =>
      this.emitApp({ type: "connectors.changed" }),
    );
    await this.modelConfiguration.initialize();
    this.modelConfiguration.subscribe(() => this.emitConfigurationChanged());
  }

  dispose(): void {
    for (const active of this.runs.values()) {
      active.unsubscribe();
      active.driverSession.dispose();
    }
    this.runs.clear();
    for (const controller of this.mediaOperations.values()) controller.abort();
    this.mediaOperations.clear();
    this.options.workspaceSearch.dispose();
    this.skillRegistry.dispose();
    this.modelConfiguration.dispose();
    this.database.close();
  }

  subscribe(listener: (event: RuntimeEventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AppSnapshot {
    const modelConfiguration = this.modelConfiguration.snapshot();
    return {
      preferences: this.preferences,
      entries: this.getEntries(),
      workspaces: this.database.listWorkspaces(),
      sessions: this.database.listSessions(),
      runningSessionIds: [...this.runs.entries()]
        .filter(([, active]) => active.kind === "prompt")
        .map(([sessionId]) => sessionId),
      connections: this.toLegacyConnections(modelConfiguration),
      models: this.toLegacyEnabledModels(modelConfiguration),
      modelConfiguration,
      security: this.securityPolicy(),
      extensions: this.extensions.snapshot(),
      skills: this.skillRegistry.snapshot(),
      connectors: this.connectorRegistry.snapshot(),
      mediaProjects: this.listMediaProjects(),
      experts: [
        ...BUILTIN_EXPERTS,
        ...this.database.listExperts().map(expertSummary),
        ...this.listExpertTeams().map(teamSummary),
      ],
    };
  }

  listExperts(): ExpertDefinition[] {
    return this.database.listExperts();
  }

  saveExpert(input: ExpertDefinitionInput, id?: string): ExpertDefinition {
    const now = Date.now();
    const existing = id ? this.database.getExpert(id) : undefined;
    if (id && !existing) throw new Error("Expert not found");
    const expert: ExpertDefinition = {
      id: existing?.id ?? randomUUID(),
      version: String((Number(existing?.version ?? "0") || 0) + 1),
      kind: "expert",
      name: input.name.trim(),
      description: input.description.trim(),
      systemPrompt: input.systemPrompt.trim(),
      portrait: structuredClone(input.portrait),
      skillIds: [...new Set(input.skillIds ?? [])],
      connectorIds: [...new Set(input.connectorIds ?? [])],
      skillCount: new Set(input.skillIds ?? []).size,
      connectorCount: new Set(input.connectorIds ?? []).size,
      source: "local",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      tags: [...new Set(input.tags ?? [])],
      categories: [...new Set(input.categories ?? [])],
      roleLabel: input.roleLabel?.trim() || undefined,
    };
    if (!expert.name || !expert.description || !expert.systemPrompt)
      throw new Error(
        "Name, description, and expert instructions are required",
      );
    this.database.upsertExpert(expert);
    this.emitApp({ type: "experts.changed" });
    return expert;
  }

  deleteExpert(id: string): void {
    this.database.deleteExpert(id);
    this.emitApp({ type: "experts.changed" });
  }

  listExpertTeams(): ExpertTeamDefinition[] {
    return this.database.listExpertTeams().map((stored) => {
      const team = this.normalizeExpertTeam(stored);
      if (team !== stored) this.database.upsertExpertTeam(team);
      return team;
    });
  }

  private getExpertTeam(id: string): ExpertTeamDefinition | undefined {
    const stored = this.database.getExpertTeam(id);
    if (!stored) return undefined;
    const team = this.normalizeExpertTeam(stored);
    if (team !== stored) this.database.upsertExpertTeam(team);
    return team;
  }

  private snapshotTeamMember(
    expertId: string,
    id: string,
    responsibility: string,
    executionProfile: ExpertTeamMemberDefinition["executionProfile"],
  ): ExpertTeamMemberDefinition {
    const local = this.database.getExpert(expertId);
    const builtin = BUILTIN_EXPERTS.find(
      (candidate) => candidate.kind === "expert" && candidate.id === expertId,
    );
    const name = local?.name ?? builtin?.name;
    return {
      id,
      name: name ?? "待补全成员",
      portrait: structuredClone(
        local?.portrait ??
          builtin?.portrait ?? { kind: "builtin", key: "research-analyst" },
      ),
      systemPrompt:
        local?.systemPrompt ??
        BUILTIN_EXPERT_PROMPTS[expertId] ??
        `You are a team member responsible for: ${responsibility}`,
      skillIds: [...new Set(local?.skillIds ?? [])],
      connectorIds: [...new Set(local?.connectorIds ?? [])],
      executionProfile,
      responsibility,
      ...(!name ? { needsReview: true } : {}),
    };
  }

  private normalizeExpertTeam(
    stored: ExpertTeamDefinition,
  ): ExpertTeamDefinition {
    const record = stored as unknown as {
      leaderMemberId?: string;
      leaderExpertId?: string;
      members: Array<{
        id?: string;
        expertId?: string;
        name?: string;
        systemPrompt?: string;
        responsibility?: string;
        executionProfile?: ExpertTeamMemberDefinition["executionProfile"];
      }>;
    };
    if (
      typeof record.leaderMemberId === "string" &&
      record.members.every(
        (member) =>
          typeof member.name === "string" &&
          typeof member.systemPrompt === "string",
      )
    )
      return stored;
    if (!record.leaderExpertId) return stored;
    const leader = this.snapshotTeamMember(
      record.leaderExpertId,
      `${stored.id}:leader`,
      "负责主对话、任务调度和最终交付。",
      "workspace-write",
    );
    const collaborators = record.members.flatMap((member) =>
      member.expertId
        ? [
            this.snapshotTeamMember(
              member.expertId,
              member.id ?? randomUUID(),
              member.responsibility ?? "协助团队完成目标。",
              member.executionProfile ?? "read-only",
            ),
          ]
        : [],
    );
    const members = [leader, ...collaborators].slice(0, 9);
    const { leaderExpertId: _legacyLeaderExpertId, ...base } =
      stored as unknown as ExpertTeamDefinition & { leaderExpertId: string };
    void _legacyLeaderExpertId;
    return {
      ...base,
      leaderMemberId: leader.id,
      members,
      memberCount: members.length,
      skillCount: new Set(members.flatMap((member) => member.skillIds)).size,
      connectorCount: new Set(members.flatMap((member) => member.connectorIds))
        .size,
    };
  }
  getExpertTeamDetail(id: string): ExpertTeamDetail {
    const summary = [
      ...BUILTIN_EXPERTS,
      ...this.listExpertTeams().map(teamSummary),
    ].find((candidate) => candidate.kind === "team" && candidate.id === id);
    if (!summary || summary.kind !== "team")
      throw new Error("Expert team not found");
    const resolvedSummary = summary as ExpertSummary & { kind: "team" };
    const builtinMembers = BUILTIN_TEAM_MEMBERS[id];
    const builtinLeader = BUILTIN_TEAM_LEADERS[id];
    if (builtinMembers && builtinLeader)
      return {
        ...resolvedSummary,
        leader: { ...builtinLeader, available: true },
        members: builtinMembers.map((member) => ({
          ...member,
          available: true,
        })),
        suggestedPrompts: BUILTIN_TEAM_SUGGESTIONS[id] ?? [
          resolvedSummary.description,
        ],
      };
    const team = this.getExpertTeam(id);
    if (!team) throw new Error("Expert team not found");
    const leader = team.members.find(
      (member) => member.id === team.leaderMemberId,
    );
    if (!leader) throw new Error("Expert team leader is unavailable");
    const members = team.members
      .filter((member) => member.id !== team.leaderMemberId)
      .map((member) => ({ ...member, available: !member.needsReview }));
    const focus = team.tags?.slice(0, 2).join("、") || team.description;
    return {
      ...resolvedSummary,
      leader: { ...leader, available: !leader.needsReview },
      members,
      suggestedPrompts: [
        team.description,
        `请围绕${focus}制定执行方案并交付结果。`,
        "请分工处理这项复杂任务，并在最后汇总可执行结论。",
      ],
    };
  }
  saveExpertTeam(
    input: ExpertTeamDefinitionInput,
    id?: string,
  ): ExpertTeamDefinition {
    const now = Date.now();
    const existing = id ? this.getExpertTeam(id) : undefined;
    if (id && !existing) throw new Error("Expert team not found");
    if (input.members.length > 9)
      throw new Error("An expert team supports at most nine members");
    const members = input.members.map((member) => ({
      ...member,
      name: member.name.trim(),
      systemPrompt: member.systemPrompt.trim(),
      responsibility: member.responsibility.trim(),
      portrait: structuredClone(member.portrait),
      skillIds: [...new Set(member.skillIds)],
      connectorIds: [...new Set(member.connectorIds)],
      model: member.model ? { ...member.model } : undefined,
      needsReview: undefined,
    }));
    if (members.length < 2)
      throw new Error("An expert team requires at least two members");
    if (new Set(members.map((member) => member.id)).size !== members.length)
      throw new Error("Team member IDs must be unique");
    if (!members.some((member) => member.id === input.leaderMemberId))
      throw new Error("The team leader must be a team member");
    if (
      members.some(
        (member) =>
          !member.name || !member.systemPrompt || !member.responsibility,
      )
    )
      throw new Error(
        "Each team member requires a name, responsibility, and instructions",
      );
    const team: ExpertTeamDefinition = {
      id: existing?.id ?? randomUUID(),
      version: String((Number(existing?.version ?? "0") || 0) + 1),
      kind: "team",
      name: input.name.trim(),
      description: input.description.trim(),
      portrait: structuredClone(input.portrait),
      leaderMemberId: input.leaderMemberId,
      members,
      systemPrompt: input.systemPrompt.trim(),
      memberCount: members.length,
      skillCount: new Set(members.flatMap((member) => member.skillIds)).size,
      connectorCount: new Set(members.flatMap((member) => member.connectorIds))
        .size,
      source: "local",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      tags: [...new Set(input.tags ?? [])],
      categories: [...new Set(input.categories ?? [])],
      roleLabel: input.roleLabel?.trim() || undefined,
    };
    if (!team.name || !team.description || !team.systemPrompt)
      throw new Error("Name, description, and team instructions are required");
    this.database.upsertExpertTeam(team);
    this.emitApp({ type: "experts.changed" });
    return team;
  }
  deleteExpertTeam(id: string): void {
    this.database.deleteExpertTeam(id);
    this.emitApp({ type: "experts.changed" });
  }

  private resolveExpertSelection(
    selection: ExpertSelection | undefined,
  ): ExpertSummary | undefined {
    if (!selection) return undefined;
    const expert = [
      ...BUILTIN_EXPERTS,
      ...this.database.listExperts().map(expertSummary),
      ...this.listExpertTeams().map(teamSummary),
    ].find(
      (candidate) =>
        candidate.kind === selection.kind &&
        candidate.id === selection.id &&
        candidate.version === selection.version,
    );
    if (!expert) throw new Error(`Expert is unavailable: ${selection.id}`);
    return expert;
  }

  private sessionExpertSnapshot(
    record: SessionRecord,
  ): SessionExpertSnapshot | undefined {
    if (!record.expertSelection) return undefined;
    const snapshot = this.database.getSessionExpertSnapshot(record.id);
    const matches =
      snapshot?.selection.id === record.expertSelection.id &&
      snapshot.selection.version === record.expertSelection.version &&
      snapshot.selection.kind === record.expertSelection.kind;
    return matches ? snapshot : undefined;
  }

  private resolveTeamLeader(
    id: string,
    team?: ExpertTeamDefinition,
  ): SessionExpertTeamLeaderSnapshot | undefined {
    const builtin = BUILTIN_TEAM_LEADERS[id];
    const leader =
      team?.members.find((member) => member.id === team.leaderMemberId) ??
      builtin;
    if (!leader) return undefined;
    const contentResearchSkill =
      id === "content-studio"
        ? this.skillRegistry
            .getSessionSkills(null)
            .find((skill) => skill.name === "content-web-research")
        : undefined;
    const contentResearchConnectorIds =
      id === "content-studio"
        ? this.connectorRegistry
            .snapshot()
            .connectors.filter(
              (connector) =>
                connector.enabled &&
                connector.status === "ready" &&
                (connector.templateId === "web-search" ||
                  connector.templateId === "firecrawl" ||
                  connector.templateId === "ai-hot"),
            )
            .map((connector) => connector.id)
        : [];
    return {
      expertId: leader.id,
      expertName: leader.name,
      portrait: leader.portrait,
      systemPrompt: leader.systemPrompt,
      skillIds: team
        ? leader.skillIds
        : contentResearchSkill
          ? [contentResearchSkill.id]
          : leader.skillIds,
      connectorIds: team ? leader.connectorIds : contentResearchConnectorIds,
    };
  }

  private resolveTeamMembers(
    id: string,
    team?: ExpertTeamDefinition,
  ): SessionExpertTeamMemberSnapshot[] | undefined {
    const definitions = (team?.members ?? BUILTIN_TEAM_MEMBERS[id])?.filter(
      (member) => member.id !== team?.leaderMemberId,
    );
    if (!definitions) return undefined;
    return definitions.map((member) => ({
      ...member,
      expertName: member.name,
    }));
  }

  private createSessionExpertSnapshot(
    selection: ExpertSelection,
    expert: ExpertSummary,
  ): SessionExpertSnapshot {
    if (selection.kind === "expert") {
      const definition =
        expert.source === "local"
          ? this.database.getExpert(expert.id)
          : undefined;
      return {
        kind: "expert",
        selection,
        name: expert.name,
        systemPrompt:
          definition?.systemPrompt ?? BUILTIN_EXPERT_PROMPTS[expert.id] ?? "",
        skillIds: definition?.skillIds ?? [],
        connectorIds: definition?.connectorIds ?? [],
      };
    }
    const team = this.getExpertTeam(expert.id);
    const leader = this.resolveTeamLeader(expert.id, team);
    if (!leader) throw new Error(`Team Lead is unavailable: ${expert.id}`);
    const members = this.resolveTeamMembers(expert.id, team) ?? [];
    const teamPrompt =
      team?.systemPrompt ?? BUILTIN_TEAM_PROMPTS[expert.id] ?? "";
    return {
      kind: "team",
      selection,
      name: leader.expertName,
      systemPrompt: `${leader.systemPrompt}\n\n[TEAM COORDINATION]\n${teamPrompt}`,
      skillIds: leader.skillIds,
      connectorIds: leader.connectorIds,
      teamName: expert.name,
      teamPortrait: expert.portrait,
      leader,
      teamMembers: members,
    };
  }

  async getUsageReport(query: UsageReportQuery): Promise<UsageReport> {
    return await this.usageReport.getReport(query);
  }

  async refreshSkills(): Promise<void> {
    await this.skillRegistry.refresh(this.database.listWorkspaces());
  }

  async importSkill(sourcePath: string): Promise<void> {
    await this.skillRegistry.importFrom(sourcePath);
  }

  async setSkillEnabled(skillId: string, enabled: boolean): Promise<void> {
    await this.skillRegistry.setEnabled(skillId, enabled);
  }

  async removeManagedSkill(skillId: string): Promise<void> {
    await this.skillRegistry.removeManagedSkill(skillId);
  }

  async saveConnector(
    configuration: Omit<
      ConnectorConfiguration,
      "id" | "createdAt" | "updatedAt"
    > & { id?: string },
  ) {
    return await this.connectorRegistry.upsert(configuration);
  }

  getConnectorConfiguration(
    connectorId: string,
  ): ConnectorConfiguration | undefined {
    return this.connectorRegistry.configuration(connectorId);
  }

  async testConnector(connectorId: string): Promise<void> {
    await this.connectorRegistry.test(connectorId);
  }

  async authorizeConnector(
    connectorId: string,
    callbacks: ConnectorAuthorizationCallbacks,
  ) {
    return await this.connectorRegistry.authorize(connectorId, callbacks);
  }

  async trustConnector(connectorId: string): Promise<void> {
    await this.connectorRegistry.trust(connectorId);
  }

  async setConnectorEnabled(
    connectorId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.connectorRegistry.setEnabled(connectorId, enabled);
  }

  async removeConnector(connectorId: string): Promise<void> {
    await this.connectorRegistry.remove(connectorId);
  }

  async listConnectorResources(connectorId: string) {
    return await this.connectorRegistry.listResources(connectorId);
  }

  async readConnectorResource(connectorId: string, uri: string) {
    return await this.connectorRegistry.readResource(connectorId, uri);
  }

  async listConnectorPrompts(connectorId: string) {
    return await this.connectorRegistry.listPrompts(connectorId);
  }

  async getConnectorPrompt(
    connectorId: string,
    name: string,
    argumentsValue: Record<string, string>,
  ) {
    return await this.connectorRegistry.getPrompt(
      connectorId,
      name,
      argumentsValue,
    );
  }

  setSessionConnectors(
    sessionId: string,
    connectorIds: string[],
  ): SessionRecord {
    if (this.runs.has(sessionId))
      throw new Error("Connectors can only change while the session is idle");
    const session = this.requireSession(sessionId);
    const unique = [...new Set(connectorIds)].filter((id) =>
      this.connectorRegistry
        .snapshot()
        .connectors.some(
          (connector) =>
            connector.id === id &&
            connector.enabled &&
            connector.status === "ready",
        ),
    );
    const next = { ...session, connectorIds: unique, updatedAt: Date.now() };
    this.database.upsertSession(next);
    return next;
  }

  setSessionExpert(
    sessionId: string,
    selection: ExpertSelection | null,
  ): SessionRecord {
    if (this.runs.has(sessionId))
      throw new Error("Experts can only change while the session is idle");
    const session = this.requireSession(sessionId);
    if (session.entryId !== "general-work")
      throw new Error("Experts are only available for General Work");
    const next = {
      ...session,
      ...(selection
        ? { expertSelection: selection }
        : { expertSelection: undefined }),
      updatedAt: Date.now(),
    };
    if (!selection) {
      this.database.upsertSession(next);
      this.database.deleteSessionExpertSnapshot(sessionId);
      return next;
    }
    const expert = this.resolveExpertSelection(selection)!;
    const expertSnapshot = this.createSessionExpertSnapshot(selection, expert);
    const readyConnectorIds = new Set(
      this.connectorRegistry
        .snapshot()
        .connectors.filter(
          (connector) => connector.enabled && connector.status === "ready",
        )
        .map((connector) => connector.id),
    );
    const requiredConnectorIds = [
      ...new Set([
        ...expertSnapshot.connectorIds,
        ...(expertSnapshot.kind === "team"
          ? expertSnapshot.teamMembers.flatMap((member) => member.connectorIds)
          : []),
      ]),
    ];
    const missingConnectorIds = requiredConnectorIds.filter(
      (id) => !readyConnectorIds.has(id),
    );
    if (missingConnectorIds.length)
      throw new Error(
        `Expert requires unavailable MCP connectors: ${missingConnectorIds.join(", ")}`,
      );
    const selectedRecord =
      expertSnapshot.kind === "expert"
        ? {
            ...next,
            connectorIds: [
              ...new Set([
                ...next.connectorIds,
                ...expertSnapshot.connectorIds,
              ]),
            ],
          }
        : next;
    this.database.upsertSession(selectedRecord);
    this.database.saveSessionExpertSnapshot(sessionId, expertSnapshot);
    return selectedRecord;
  }

  async getSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
    const record = await this.ensureSessionModelForOpen(sessionId);
    const session = await openWordlessSession(record.journalPath);
    const entries = await session.getEntries();
    const messages: ConversationMessage[] = [];
    const tools = new Map<
      string,
      { messageIndex: number; blockIndex: number }
    >();
    const approvals = new Map<string, PersistedOperationApproval>();
    const userRequests = new Map<string, PersistedUserRequest>();
    const clarificationAnswers = new Map<
      string,
      PersistedClarificationAnswer
    >();
    const compactionMetadata = new Map<string, PersistedContextCompaction>();
    const compactions: Array<{
      id: string;
      timestamp: number;
      summary: string;
      tokensBefore: number;
    }> = [];
    const extensions: AgentExtensionSessionState[] = [];
    for (const entry of entries) {
      const customEntry = entry as unknown as {
        type: string;
        customType?: string;
        data?: unknown;
      };
      if (
        customEntry.type === "custom" &&
        customEntry.customType === AGENT_EXTENSION_STATE_JOURNAL_TYPE
      ) {
        const state = asRecord(customEntry.data);
        if (
          typeof state?.extensionId === "string" &&
          typeof state.updatedAt === "number" &&
          asRecord(state.state)
        ) {
          const next = {
            extensionId: state.extensionId,
            updatedAt: state.updatedAt,
            state: asRecord(state.state)!,
          } satisfies AgentExtensionSessionState;
          const index = extensions.findIndex(
            (item) => item.extensionId === next.extensionId,
          );
          if (index === -1) extensions.push(next);
          else extensions[index] = next;
        }
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === OPERATION_APPROVAL_JOURNAL_TYPE
      ) {
        const approval = persistedApproval(customEntry.data);
        if (!approval) continue;
        approvals.set(approval.callId, approval);
        this.applyApproval(
          messages,
          tools.get(approval.callId),
          approval,
          this.runs.has(sessionId),
        );
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === USER_REQUEST_JOURNAL_TYPE
      ) {
        const userRequest = persistedUserRequest(customEntry.data);
        if (!userRequest) continue;
        userRequests.set(userRequest.callId, userRequest);
        this.applyUserRequest(
          messages,
          tools.get(userRequest.callId),
          userRequest,
          this.runs.has(sessionId),
        );
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === CLARIFICATION_ANSWER_JOURNAL_TYPE
      ) {
        const answer = persistedClarificationAnswer(customEntry.data);
        if (!answer) continue;
        clarificationAnswers.set(answer.callId, answer);
        this.applyClarificationAnswer(
          messages,
          tools.get(answer.callId),
          answer,
        );
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === CONTEXT_COMPACTION_JOURNAL_TYPE
      ) {
        const compaction = persistedContextCompaction(customEntry.data);
        if (compaction)
          compactionMetadata.set(compaction.compactionId, compaction);
        continue;
      }
      if (entry.type === "compaction") {
        const value = asRecord(entry);
        if (
          typeof value?.id === "string" &&
          typeof value.summary === "string" &&
          typeof value.tokensBefore === "number"
        ) {
          const timestamp =
            typeof value.timestamp === "string"
              ? Date.parse(value.timestamp)
              : Number.NaN;
          compactions.push({
            id: value.id,
            timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
            summary: value.summary,
            tokensBefore: value.tokensBefore,
          });
        }
        continue;
      }
      if (entry.type !== "message") continue;
      const value = asRecord(entry.message);
      if (
        value?.role === "toolResult" &&
        typeof value.toolCallId === "string"
      ) {
        this.applyToolResult(
          messages,
          tools.get(value.toolCallId),
          value,
          approvals.get(value.toolCallId),
          userRequests.get(value.toolCallId),
        );
        const answer = clarificationAnswers.get(value.toolCallId);
        if (answer)
          this.applyClarificationAnswer(
            messages,
            tools.get(value.toolCallId),
            answer,
          );
        continue;
      }
      const message = this.toConversationMessage(
        entry.message,
        record.model,
        entry.id,
      );
      if (!message) continue;
      const messageIndex = messages.length;
      messages.push(message);
      message.blocks.forEach((block, blockIndex) => {
        if (block.type === "tool")
          tools.set(block.callId, { messageIndex, blockIndex });
      });
    }
    const active = this.runs.get(sessionId);
    if (active) {
      for (const [callId, activeTool] of active.tools) {
        const location = tools.get(callId);
        if (!location) continue;
        const message = messages[location.messageIndex];
        const block = message?.blocks[location.blockIndex];
        if (
          !message ||
          !block ||
          block.type !== "tool" ||
          block.state !== "pending"
        )
          continue;
        const blocks = [...message.blocks];
        blocks[location.blockIndex] = {
          ...activeTool,
          ...(block.approval ? { approval: block.approval } : {}),
          ...(block.userRequest ? { userRequest: block.userRequest } : {}),
        };
        messages[location.messageIndex] = { ...message, blocks };
      }
    }
    const contextCompactions: ContextCompactionRecord[] = compactions.map(
      (compaction) => {
        const metadata = compactionMetadata.get(compaction.id);
        return {
          ...compaction,
          trigger: metadata?.trigger ?? "manual",
          tokensAfter: metadata?.tokensAfter ?? 0,
          model: metadata?.model ?? record.model,
        };
      },
    );
    const recoveredFailureEntryIds = new Set(
      [...compactionMetadata.values()]
        .map((metadata) => metadata.recoveredFailureEntryId)
        .filter((entryId): entryId is string => typeof entryId === "string"),
    );
    const latestInputTokens = [...messages]
      .reverse()
      .find((message) => (message.usage?.inputTokens ?? 0) > 0)
      ?.usage?.inputTokens;
    let contextUsage: SessionSnapshot["contextUsage"];
    try {
      const model = this.requireRuntimeModel(record.model);
      contextUsage = estimateSessionContextUsage({
        connectors: this.connectorRegistry
          .snapshot()
          .connectors.filter((connector) =>
            record.connectorIds.includes(connector.id),
          ),
        contextWindow: model.contextWindow || 128_000,
        entries,
        extensions: this.extensions.snapshot(),
        latestInputTokens,
        profile: this.requireProfile(record),
        skills: this.skillRegistry.getSessionSkills(record.workspaceId),
      });
    } catch {
      contextUsage = undefined;
    }
    const visibleMessages = messages.filter(
      (message) => !recoveredFailureEntryIds.has(message.id),
    );
    return {
      session: record,
      messages: visibleMessages,
      expertCollaboration: createExpertCollaborationSnapshot(
        visibleMessages,
        this.sessionExpertSnapshot(record),
      ),
      contextUsage,
      turnUsage: calculateCurrentTurnUsage(visibleMessages),
      contextCompactions,
      isRunning: active?.kind === "prompt",
      isCompacting: active?.isCompacting ?? false,
      compactionTrigger: active?.compactionTrigger,
      toolApprovalMode: record.toolApprovalMode,
      extensions,
    };
  }

  async getSessionView(sessionId: string): Promise<SessionViewSnapshot> {
    const record = await this.ensureSessionModelForOpen(sessionId);
    const cached = await this.getCachedSessionHistory(sessionId);
    const active = this.runs.get(sessionId);
    const view = {
      session: record,
      contextUsage: cached.snapshot.contextUsage,
      turnUsage: cached.snapshot.turnUsage,
      history: createSessionHistoryPage(cached.projection, cached.revision),
      turnSummaries: cached.projection.turnSummaries,
      isRunning: active?.kind === "prompt",
      isCompacting: active?.isCompacting ?? false,
      compactionTrigger: active?.compactionTrigger,
      toolApprovalMode: record.toolApprovalMode,
      compactionError: cached.snapshot.compactionError,
      extensions: cached.snapshot.extensions,
      expertCollaboration: cached.snapshot.expertCollaboration,
    };
    return view;
  }

  async getSessionHistoryPage(
    sessionId: string,
    request: SessionHistoryPageRequest,
  ): Promise<SessionHistoryPage> {
    const cached = await this.getCachedSessionHistory(sessionId);
    return createSessionHistoryPage(
      cached.projection,
      cached.revision,
      request,
    );
  }

  async getExpertMemberHistory(
    sessionId: string,
    memberId: string,
    request: SessionHistoryPageRequest,
  ): Promise<SessionHistoryPage> {
    const member = await this.getExpertMemberHistoryProjection(
      sessionId,
      memberId,
    );
    return createSessionHistoryPage(
      member.projection,
      member.revision,
      request,
    );
  }

  getExpertMemberLiveState(
    sessionId: string,
    memberId: string,
  ): ExpertMemberLiveMessage | null {
    this.requireSession(sessionId);
    return (
      this.runs.get(sessionId)?.subagents.getExpertMemberLiveState(memberId) ??
      null
    );
  }

  async getExpertMemberToolOutput(
    sessionId: string,
    memberId: string,
    callId: string,
  ): Promise<string> {
    const member = await this.getExpertMemberHistoryProjection(
      sessionId,
      memberId,
    );
    const output = member.projection.toolOutputs.get(callId);
    if (output === undefined) throw new Error("Tool output is unavailable");
    return output;
  }

  private async getExpertMemberHistoryProjection(
    sessionId: string,
    memberId: string,
  ): Promise<{ projection: SessionHistoryProjection; revision: string }> {
    const record = this.requireSession(sessionId);
    const expert = this.sessionExpertSnapshot(record);
    if (expert?.kind !== "team")
      throw new Error("The session does not use an expert team");
    const member = expert.teamMembers.find(
      (candidate) => candidate.id === memberId,
    );
    if (!member) throw new Error("Expert team member is unavailable");
    const membersRoot = resolve(
      this.options.paths.journalsRoot,
      "subagents",
      record.id,
      "members",
    );
    const journalPath = resolve(membersRoot, `${member.id}.jsonl`);
    const memberPath = relative(membersRoot, journalPath);
    if (!memberPath || memberPath.startsWith("..") || isAbsolute(memberPath))
      throw new Error("Invalid expert member journal path");
    let details;
    try {
      details = await stat(journalPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      return {
        projection: createSessionHistoryProjection([], []),
        revision: "missing",
      };
    }
    const journal = await openWordlessSession(journalPath);
    const messages: ConversationMessage[] = [];
    const compactions: ContextCompactionRecord[] = [];
    const tools = new Map<
      string,
      { messageIndex: number; blockIndex: number }
    >();
    const approvals = new Map<string, PersistedOperationApproval>();
    const isRunning = this.runs.has(sessionId);
    let model = record.model;
    for (const entry of await journal.getEntries()) {
      const value = asRecord(entry);
      const customEntry = entry as unknown as {
        type: string;
        customType?: string;
        data?: unknown;
      };
      if (
        customEntry.type === "custom" &&
        customEntry.customType === OPERATION_APPROVAL_JOURNAL_TYPE
      ) {
        const approval = persistedApproval(customEntry.data);
        if (!approval) continue;
        approvals.set(approval.callId, approval);
        this.applyApproval(
          messages,
          tools.get(approval.callId),
          approval,
          isRunning,
        );
        continue;
      }
      if (
        entry.type === "model_change" &&
        typeof value?.provider === "string" &&
        typeof value.modelId === "string"
      ) {
        model = { connectionId: value.provider, modelId: value.modelId };
        continue;
      }
      if (entry.type === "compaction") {
        if (
          typeof value?.id === "string" &&
          typeof value.summary === "string" &&
          typeof value.tokensBefore === "number"
        ) {
          const timestamp =
            typeof value.timestamp === "string"
              ? Date.parse(value.timestamp)
              : Number.NaN;
          compactions.push({
            id: value.id,
            timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp,
            summary: value.summary,
            tokensBefore: value.tokensBefore,
            tokensAfter: 0,
            trigger: "manual",
            model,
          });
        }
        continue;
      }
      if (entry.type !== "message") continue;
      const stored = asRecord(entry.message);
      if (
        stored?.role === "toolResult" &&
        typeof stored.toolCallId === "string"
      ) {
        this.applyToolResult(
          messages,
          tools.get(stored.toolCallId),
          stored,
          approvals.get(stored.toolCallId),
        );
        continue;
      }
      const message = this.toConversationMessage(
        entry.message,
        model,
        entry.id,
      );
      if (!message) continue;
      const messageIndex = messages.length;
      messages.push(message);
      message.blocks.forEach((block, blockIndex) => {
        if (block.type === "tool")
          tools.set(block.callId, { messageIndex, blockIndex });
      });
    }
    return {
      projection: createSessionHistoryProjection(messages, compactions),
      revision: `${details.size}:${Math.round(details.mtimeMs)}`,
    };
  }

  async searchSessionMessages(
    sessionId: string,
    request: SessionMessageSearchRequest,
  ): Promise<SessionMessageSearchResponse> {
    const cached = await this.getCachedSessionHistory(sessionId);
    return searchSessionHistoryMessages(cached.projection, request);
  }

  async getSessionToolOutput(
    sessionId: string,
    callId: string,
  ): Promise<string> {
    const cached = await this.getCachedSessionHistory(sessionId);
    const output = cached.projection.toolOutputs.get(callId);
    if (output === undefined) throw new Error("Tool output is unavailable");
    return output;
  }

  async getSessionContext(sessionId: string): Promise<SessionContextSnapshot> {
    const record = this.requireSession(sessionId);
    const workspace = record.workspaceId
      ? this.requireWorkspace(record.workspaceId)
      : undefined;
    const session = await openWordlessSession(record.journalPath);
    const changes = new Map<string, SessionArtifactFile>();
    const baselines = new Map<string, PersistedSessionFileBaseline>();
    const approvedBaselines = new Map<string, SessionFileBaseline>();
    const successfulWriteCalls = new Set<string>();
    for (const entry of await session.getEntries()) {
      const customEntry = entry as unknown as {
        type: string;
        customType?: string;
        data?: unknown;
      };
      if (
        customEntry.type === "custom" &&
        customEntry.customType === SUBAGENT_FILE_CHANGE_JOURNAL_TYPE
      ) {
        const persisted = persistedSubagentFileChange(customEntry.data);
        const path = persisted
          ? workspaceRelativePath(record.runtimeRootPath, persisted.path)
          : undefined;
        if (!persisted || !path) continue;
        if (!baselines.has(path))
          baselines.set(path, {
            callId: `subagent:${persisted.taskId}`,
            baseline: persisted.baseline,
          });
        const existing = changes.get(path);
        changes.set(path, {
          path,
          name: basename(path),
          kind:
            existing?.kind === "created" || persisted.kind === "created"
              ? "created"
              : "modified",
          diffAvailable: true,
        });
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === SESSION_FILE_BASELINE_JOURNAL_TYPE
      ) {
        const persisted = persistedFileBaseline(customEntry.data);
        const path = persisted
          ? workspaceRelativePath(
              record.runtimeRootPath,
              persisted.baseline.path,
            )
          : undefined;
        if (persisted && path && !baselines.has(path))
          baselines.set(path, persisted);
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === OPERATION_APPROVAL_JOURNAL_TYPE
      ) {
        const approval = persistedApproval(customEntry.data);
        const baseline = approval ? approvalFileBaseline(approval) : undefined;
        const path = baseline
          ? workspaceRelativePath(record.runtimeRootPath, baseline.path)
          : undefined;
        if (
          approval &&
          baseline &&
          path &&
          !approvedBaselines.has(approval.callId)
        )
          approvedBaselines.set(approval.callId, baseline);
        continue;
      }
      if (entry.type !== "message") continue;
      const message = asRecord(entry.message);
      if (
        message?.role !== "toolResult" ||
        message.isError === true ||
        (message.toolName !== "write" && message.toolName !== "edit")
      )
        continue;
      const details = asRecord(message.details);
      const change = asRecord(details?.change);
      const path =
        typeof details?.path === "string"
          ? workspaceRelativePath(record.runtimeRootPath, details.path)
          : undefined;
      if (
        !path ||
        typeof change?.kind !== "string" ||
        typeof message.toolCallId !== "string"
      )
        continue;
      successfulWriteCalls.add(message.toolCallId);
      const existing = changes.get(path);
      changes.set(path, {
        path,
        name: basename(path),
        kind:
          existing?.kind === "created" || change.kind === "created"
            ? "created"
            : "modified",
        diffAvailable: false,
      });
    }
    for (const callId of successfulWriteCalls) {
      const baseline = approvedBaselines.get(callId);
      const path = baseline
        ? workspaceRelativePath(record.runtimeRootPath, baseline.path)
        : undefined;
      if (baseline && path && !baselines.has(path))
        baselines.set(path, { callId, baseline });
    }
    for (const change of changes.values())
      change.diffAvailable = baselines.has(change.path);
    const sortedChanges = [...changes.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    return {
      workspace: workspace
        ? {
            id: workspace.id,
            name: workspace.name,
            available: workspace.availability === "available",
          }
        : null,
      artifacts: sortedChanges.filter((change) => change.kind === "created"),
      changes: sortedChanges,
    };
  }

  async getSessionArtifacts(
    sessionId: string,
  ): Promise<SessionArtifactsSnapshot> {
    const snapshot = await this.scanSessionArtifacts(
      this.requireSession(sessionId),
    );
    this.artifactRevisions.set(sessionId, snapshot.revision);
    return snapshot;
  }

  async readSessionArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<SessionArtifactPreview> {
    const record = this.requireSession(sessionId);
    const artifact = await this.requireSessionArtifact(record, artifactId);
    const source = await this.pathService.resolveWorkspaceFile(
      record.runtimeRootPath,
      artifact.path,
    );
    const details = await stat(source);
    const maximumBytes =
      artifact.previewKind === "image" ? 12_582_912 : 1_048_576;
    if (details.size > maximumBytes)
      return { status: "unavailable", reason: "too-large" };
    if (artifact.previewKind === "external")
      return { status: "unavailable", reason: "unsupported" };
    try {
      const data = await readFile(source);
      if (artifact.previewKind === "image") {
        const extension = extname(artifact.name).toLowerCase();
        const mimeType =
          extension === ".png"
            ? "image/png"
            : extension === ".webp"
              ? "image/webp"
              : extension === ".gif"
                ? "image/gif"
                : "image/jpeg";
        return {
          status: "available",
          kind: "image",
          name: artifact.name,
          mimeType,
          data: data.toString("base64"),
        };
      }
      if (data.includes(0)) return { status: "unavailable", reason: "binary" };
      return {
        status: "available",
        kind: "text",
        name: artifact.name,
        content: data.toString("utf8"),
      };
    } catch (cause) {
      const code = asRecord(cause)?.code;
      if (code === "ENOENT")
        return { status: "unavailable", reason: "missing" };
      throw cause;
    }
  }

  async resolveSessionArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<string> {
    const record = this.requireSession(sessionId);
    const artifact = await this.requireSessionArtifact(record, artifactId);
    return await this.pathService.resolveWorkspaceFile(
      record.runtimeRootPath,
      artifact.path,
    );
  }

  private async requireSessionArtifact(
    record: SessionRecord,
    artifactId: string,
  ): Promise<SessionGeneratedArtifact> {
    const snapshot = await this.scanSessionArtifacts(record);
    const artifact = snapshot.artifacts.find(
      (candidate) => candidate.id === artifactId,
    );
    if (!artifact) throw new Error("Session artifact is unavailable");
    return artifact;
  }

  private artifactProducer(
    record: SessionRecord,
    artifactPath: string,
  ): SessionGeneratedArtifact["producer"] {
    const [directory, role] = artifactPath.split("/");
    if (directory === "subagents" && role) {
      const names: Record<string, string> = {
        scout: "Scout",
        planner: "Planner",
        reviewer: "Reviewer",
        worker: "Worker",
        researcher: "Researcher",
        "research-reviewer": "Research reviewer",
      };
      return {
        kind: "builtin-subagent",
        id: role,
        name: names[role] ?? "Subagent",
      };
    }
    const expert = this.sessionExpertSnapshot(record);
    if (expert?.kind === "team") {
      const member = expert.teamMembers.find(
        (candidate) => artifactDirectoryName(candidate.id) === directory,
      );
      if (member)
        return {
          kind: "expert-member",
          id: member.id,
          name: member.expertName,
          portrait: member.portrait,
        };
      return {
        kind: "primary",
        id: expert.leader.expertId,
        name: expert.leader.expertName,
        portrait: expert.leader.portrait,
      };
    }
    return {
      kind: "primary",
      ...(expert ? { id: expert.selection.id } : {}),
      name: expert?.name ?? "General Work",
    };
  }

  private async scanSessionArtifacts(
    record: SessionRecord,
  ): Promise<SessionArtifactsSnapshot> {
    const root = join(record.runtimeRootPath, SESSION_ARTIFACTS_DIRECTORY);
    const artifacts: SessionGeneratedArtifact[] = [];
    const expert = this.sessionExpertSnapshot(record);
    const memberByDirectory = new Map<string, SessionExpertTeamMemberSnapshot>();
    if (expert?.kind === "team") {
      for (const member of expert.teamMembers)
        memberByDirectory.set(artifactDirectoryName(member.id), member);
    }
    const visit = async (
      directory: string,
      relativeDirectory: string,
    ): Promise<void> => {
      if (artifacts.length >= 1_000) return;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (cause) {
        if (asRecord(cause)?.code === "ENOENT") return;
        throw cause;
      }
      for (const entry of entries) {
        if (artifacts.length >= 1_000 || entry.isSymbolicLink()) continue;
        const relativePath = relativeDirectory
          ? `${relativeDirectory}/${entry.name}`
          : entry.name;
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath, relativePath);
          continue;
        }
        if (!entry.isFile()) continue;
        const details = await stat(absolutePath);
        const path = `${SESSION_ARTIFACTS_DIRECTORY}/${relativePath}`;
        artifacts.push({
          id: createHash("sha256").update(path).digest("hex").slice(0, 24),
          path,
          name: entry.name,
          size: details.size,
          mtimeMs: details.mtimeMs,
          previewKind: artifactPreviewKind(entry.name),
          producer: this.artifactProducer(record, relativePath),
          group: artifactGroup(relativePath, memberByDirectory),
        });
      }
    };
    let rootEntries: Dirent[];
    try {
      rootEntries = await readdir(root, { withFileTypes: true });
    } catch (cause) {
      if (asRecord(cause)?.code !== "ENOENT") throw cause;
      rootEntries = [];
    }
    for (const entry of rootEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name === "subagents") continue;
      await visit(join(root, entry.name), entry.name);
    }
    artifacts.sort(
      (left, right) =>
        right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path),
    );
    const revision = createHash("sha256")
      .update(
        JSON.stringify(
          artifacts.map(({ id, size, mtimeMs }) => [id, size, mtimeMs]),
        ),
      )
      .digest("hex")
      .slice(0, 20);
    return { revision, artifacts };
  }

  private async refreshSessionArtifacts(
    sessionId: string,
    active: ActiveRun,
  ): Promise<void> {
    const snapshot = await this.scanSessionArtifacts(
      this.requireSession(sessionId),
    );
    const previous = this.artifactRevisions.get(sessionId);
    this.artifactRevisions.set(sessionId, snapshot.revision);
    if (previous === snapshot.revision) return;
    this.emit(sessionId, active, {
      type: "session.artifacts.changed",
      revision: snapshot.revision,
      count: snapshot.artifacts.length,
    });
  }

  async readSessionWorkspaceTextFile(
    sessionId: string,
    path: string,
  ): Promise<SessionWorkspaceTextFile> {
    const record = this.requireSession(sessionId);
    try {
      const file = await this.pathService.readWorkspaceTextFile(
        record.runtimeRootPath,
        path,
        1_048_576,
      );
      return { status: "available", ...file };
    } catch (cause) {
      return {
        status: "unavailable",
        reason: this.workspaceReadFailure(cause),
      };
    }
  }

  async getSessionArtifactDiff(
    sessionId: string,
    path: string,
  ): Promise<SessionArtifactDiff> {
    const record = this.requireWorkspaceSession(sessionId);
    const workspacePath = workspaceRelativePath(record.runtimeRootPath, path);
    if (!workspacePath)
      return { status: "unavailable", reason: "baseline-missing" };
    const session = await openWordlessSession(record.journalPath);
    let baseline: PersistedSessionFileBaseline | undefined;
    const approvedBaselines = new Map<string, SessionFileBaseline>();
    const successfulWriteCalls = new Set<string>();
    for (const entry of await session.getEntries()) {
      const customEntry = entry as unknown as {
        type: string;
        customType?: string;
        data?: unknown;
      };
      if (
        customEntry.type === "custom" &&
        customEntry.customType === SUBAGENT_FILE_CHANGE_JOURNAL_TYPE
      ) {
        const candidate = persistedSubagentFileChange(customEntry.data);
        if (
          candidate &&
          workspaceRelativePath(record.runtimeRootPath, candidate.path) ===
            workspacePath &&
          !baseline
        ) {
          baseline = {
            callId: `subagent:${candidate.taskId}`,
            baseline: candidate.baseline,
          };
        }
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === SESSION_FILE_BASELINE_JOURNAL_TYPE
      ) {
        const candidate = persistedFileBaseline(customEntry.data);
        if (
          candidate &&
          workspaceRelativePath(
            record.runtimeRootPath,
            candidate.baseline.path,
          ) === workspacePath &&
          !baseline
        )
          baseline = candidate;
        continue;
      }
      if (
        customEntry.type === "custom" &&
        customEntry.customType === OPERATION_APPROVAL_JOURNAL_TYPE
      ) {
        const approval = persistedApproval(customEntry.data);
        const candidate = approval ? approvalFileBaseline(approval) : undefined;
        if (approval && candidate)
          approvedBaselines.set(approval.callId, candidate);
        continue;
      }
      if (entry.type !== "message") continue;
      const message = asRecord(entry.message);
      if (
        message?.role === "toolResult" &&
        message.isError !== true &&
        (message.toolName === "write" || message.toolName === "edit") &&
        typeof message.toolCallId === "string"
      )
        successfulWriteCalls.add(message.toolCallId);
    }
    if (!baseline) {
      for (const callId of successfulWriteCalls) {
        const candidate = approvedBaselines.get(callId);
        if (
          candidate &&
          workspaceRelativePath(record.runtimeRootPath, candidate.path) ===
            workspacePath
        ) {
          baseline = { callId, baseline: candidate };
          break;
        }
      }
    }
    if (!baseline || baseline.baseline.content === null)
      return { status: "unavailable", reason: "baseline-missing" };
    const current = await this.readSessionWorkspaceTextFile(
      sessionId,
      workspacePath,
    );
    if (current.status === "unavailable") return current;
    return {
      status: "available",
      path: workspacePath,
      patch: unifiedPatch(
        workspacePath,
        baseline.baseline.content,
        current.content,
      ),
    };
  }

  async listSessionWorkspaceDirectory(
    sessionId: string,
    path: string,
  ): Promise<WorkspaceFileEntry[]> {
    const record = this.requireSession(sessionId);
    return await this.pathService.listDirectory(record.runtimeRootPath, path);
  }

  async searchSessionWorkspace(
    sessionId: string,
    query: string,
  ): Promise<WorkspaceFileEntry[]> {
    const record = this.requireSession(sessionId);
    return await this.searchWorkspaceRoot(record.runtimeRootPath, query);
  }

  async searchWorkspace(
    workspaceId: string,
    query: string,
  ): Promise<WorkspaceFileEntry[]> {
    const workspace = await this.resolveAvailableWorkspace(workspaceId);
    return await this.searchWorkspaceRoot(workspace.canonicalRootPath, query);
  }

  invalidateSessionWorkspaceSearch(sessionId: string): void {
    this.requireSession(sessionId);
  }

  async resolveSessionWorkspaceFile(
    sessionId: string,
    path: string,
  ): Promise<string> {
    const record = this.requireWorkspaceSession(sessionId);
    return await this.pathService.resolveWorkspaceFile(
      record.runtimeRootPath,
      path,
    );
  }

  async resolveSessionWorkspaceEntry(
    sessionId: string,
    path: string,
  ): Promise<string> {
    if (this.runs.has(sessionId))
      throw new Error(
        "Workspace entries cannot be moved to Trash while the agent is running",
      );
    const record = this.requireWorkspaceSession(sessionId);
    return await this.pathService.resolveWorkspaceEntry(
      record.runtimeRootPath,
      path,
    );
  }

  async createManagedWorkspace(name: string): Promise<WorkspaceRecord> {
    const location = await this.pathService.createManagedWorkspace(
      this.preferences.defaultWorkspaceRoot,
      name.trim(),
    );
    const now = Date.now();
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      kind: "managed",
      name: name.trim(),
      rootPath: location.rootPath,
      canonicalRootPath: location.canonicalRootPath,
      availability: "available",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    this.database.upsertWorkspace(workspace);
    await this.skillRegistry.refresh(this.database.listWorkspaces());
    return workspace;
  }

  async openLinkedWorkspace(path: string): Promise<WorkspaceRecord> {
    const location = await this.pathService.openLinkedWorkspace(path);
    const existing = this.database.findWorkspaceByCanonicalRoot(
      location.canonicalRootPath,
    );
    const now = Date.now();
    if (existing) {
      const refreshed = {
        ...existing,
        rootPath: location.rootPath,
        name: location.name,
        availability: "available" as const,
        updatedAt: now,
        lastOpenedAt: now,
      };
      this.database.upsertWorkspace(refreshed);
      await this.skillRegistry.refresh(this.database.listWorkspaces());
      return refreshed;
    }
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      kind: "linked",
      name: location.name,
      rootPath: location.rootPath,
      canonicalRootPath: location.canonicalRootPath,
      availability: "available",
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    this.database.upsertWorkspace(workspace);
    await this.skillRegistry.refresh(this.database.listWorkspaces());
    return workspace;
  }

  async createAndPrompt(
    draft: SessionDraft,
    prompt: string,
    skillIds: string[] = [],
    submission?: UserMessageSubmission,
    options?: PromptSessionOptions,
  ): Promise<SessionRecord> {
    const entry = this.getEntry(draft.entryId);
    if (entry.mode !== draft.mode)
      throw new Error("Selected entry does not belong to the selected mode");
    const profile = entry.profile
      ? this.profiles.get(entry.profile)
      : undefined;
    if (
      entry.availability !== "available" ||
      !profile ||
      !this.drivers.get(profile.driverId)
    ) {
      throw new Error("This work type is not available yet");
    }
    const model = this.resolveSessionModel(draft, entry);
    const expert = this.resolveExpertSelection(draft.expertSelection);
    this.assertInteractionModeAvailable(
      draft.interactionMode ?? "default",
      profile.driverId,
      model,
    );
    const workspace = draft.workspaceId
      ? await this.resolveAvailableWorkspace(draft.workspaceId)
      : undefined;
    if (
      (entry.workbenchId === "code" || entry.workbenchId === "analysis") &&
      !workspace
    )
      throw new Error(
        `${entry.workbenchId === "code" ? "Coding" : "Data analysis"} sessions require a workspace`,
      );

    const now = Date.now();
    const id = randomUUID();
    const runtimeRootPath =
      workspace?.canonicalRootPath ??
      join(this.options.paths.sessionWorkspacesRoot, id);
    await this.pathService.ensureSessionRoot(runtimeRootPath);
    const journalPath = join(this.options.paths.journalsRoot, `${id}.jsonl`);
    const availableConnectors = this.connectorRegistry
      .snapshot()
      .connectors.filter(
        (connector) => connector.enabled && connector.status === "ready",
      );
    const defaultConnectorTemplates = new Set(
      profile.defaultConnectorTemplateIds ?? [],
    );
    const defaultConnectorIds = availableConnectors
      .filter(
        (connector) =>
          connector.templateId &&
          defaultConnectorTemplates.has(connector.templateId),
      )
      .map((connector) => connector.id);
    const expertSnapshot =
      expert && draft.expertSelection
        ? this.createSessionExpertSnapshot(draft.expertSelection, expert)
        : undefined;
    const missingConnectorIds = [
      ...new Set([
        ...(expertSnapshot?.connectorIds ?? []),
        ...(expertSnapshot?.kind === "team"
          ? expertSnapshot.teamMembers.flatMap((member) => member.connectorIds)
          : []),
      ]),
    ].filter(
      (connectorId) =>
        !availableConnectors.some((connector) => connector.id === connectorId),
    );
    if (missingConnectorIds.length)
      throw new Error(
        `Expert requires unavailable MCP connectors: ${missingConnectorIds.join(", ")}`,
      );
    const record: SessionRecord = {
      id,
      title: draft.title?.trim() || sessionTitleFromPrompt(prompt),
      workspaceId: workspace?.id ?? null,
      runtimeRootPath,
      mode: draft.mode,
      entryId: entry.id,
      profile: profile.reference,
      driverId: profile.driverId,
      journalFormat:
        profile.driverId === "coding"
          ? "wordless-coding-v1"
          : "wordless-agent-v1",
      workbenchId: entry.workbenchId,
      accessLevel: draft.accessLevel,
      model,
      thinkingLevel: thinkingLevelForModel(
        this.requireRuntimeModel(model),
        draft.thinkingLevel ?? "medium",
      ),
      journalPath,
      connectorIds: [
        ...new Set([
          ...(draft.connectorIds ?? []),
          ...defaultConnectorIds,
          ...(expertSnapshot?.kind === "expert"
            ? expertSnapshot.connectorIds
            : []),
        ]),
      ].filter((id) =>
        availableConnectors.some((connector) => connector.id === id),
      ),
      interactionMode: draft.interactionMode ?? "default",
      toolApprovalMode: draft.toolApprovalMode ?? "manual",
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
      ...(expert ? { expertSelection: draft.expertSelection } : {}),
    };
    const metadata: WordlessSessionMetadata = {
      id,
      createdAt: new Date(now).toISOString(),
      cwd: runtimeRootPath,
      path: journalPath,
      metadata: {
        workspaceId: record.workspaceId,
        entryId: record.entryId,
        profile: record.profile,
        driverId: record.driverId,
        accessLevel: record.accessLevel,
        model,
      },
    };
    const journal = await createWordlessSession(metadata);
    await journal.appendModelChange(model.connectionId, model.modelId);
    await journal.appendThinkingLevelChange(record.thinkingLevel);
    if (record.interactionMode === "plan")
      await this.persistPlanModeState(record, "planning");
    this.database.upsertSession(record);
    if (expertSnapshot)
      this.database.saveSessionExpertSnapshot(id, expertSnapshot);
    this.rememberEntryModel(entry.id, model);
    const initialPrompt =
      entry.workbenchId === "presentation"
        ? `${prompt}\n\n<wordless-presentation mode="${draft.presentation?.generationMode ?? "guided"}" template="${draft.presentation?.templateId ?? "auto"}">\nUse the Presentation workflow. In guided mode, inspect the request, propose a slide outline, and wait for confirmation before creating the deck. In quick mode, create the first complete draft directly.\n</wordless-presentation>`
        : prompt;
    await this.promptSession(id, initialPrompt, skillIds, submission, options);
    return this.requireSession(id);
  }

  async promptSession(
    sessionId: string,
    prompt: string,
    skillIds: string[] = [],
    submission?: UserMessageSubmission,
    options?: PromptSessionOptions,
  ): Promise<void> {
    const record = await this.ensureSessionModelForOpen(sessionId);
    const active = this.runs.get(sessionId);
    if (active) {
      if (active.kind === "compaction")
        throw new Error("Context compaction is in progress");
      if (skillIds.length > 0)
        throw new Error(
          "Skills can only be selected before starting a new agent run",
        );
      await active.driverSession.execute({
        type: "steer",
        text: prompt,
        submission,
      });
      return;
    }
    const selectedSkills = this.resolveSelectedSkills(record, skillIds);
    const automaticCompaction = this.isAutomaticContextCompactionEnabled();
    const run = await this.createActiveRun(
      sessionId,
      automaticCompaction ? "compaction" : "prompt",
      submission?.messageId,
      options?.connectorIds,
      options?.taskId,
    );
    void this.executeActiveRun(
      sessionId,
      run,
      prompt,
      selectedSkills,
      automaticCompaction,
      submission,
    ).catch(() => {});
  }

  async cancelSession(sessionId: string): Promise<void> {
    const active = this.runs.get(sessionId);
    if (!active) return;
    if (active.kind === "compaction") return;
    await active.driverSession.execute({ type: "cancel" });
    this.emit(sessionId, active, {
      type: "run.cancelled",
      runId: active.runId,
    });
  }

  renameSession(sessionId: string, title: string): SessionRecord {
    const normalized = title.trim();
    if (!normalized || normalized.length > 120)
      throw new Error("Session title must be between 1 and 120 characters");
    const session = this.database.renameSession(sessionId, normalized);
    if (!session) throw new Error("Session not found");
    if (session.workbenchId === "media-canvas") {
      const project = this.database.getMediaProject(sessionId);
      if (project) {
        this.database.upsertMediaProject({
          ...project,
          title: normalized,
          updatedAt: session.updatedAt,
        });
        this.emitApp({ type: "media.project.changed", sessionId });
      }
    }
    return session;
  }

  setSessionPinned(sessionId: string, pinned: boolean): SessionRecord {
    const session = this.database.setSessionPinned(sessionId, pinned);
    if (!session) throw new Error("Session not found");
    return session;
  }

  setSessionAccess(
    sessionId: string,
    accessLevel: SessionRecord["accessLevel"],
  ): SessionRecord {
    if (this.runs.has(sessionId))
      throw new Error("Access level can only change while the session is idle");
    const session = this.requireSession(sessionId);
    const next = { ...session, accessLevel, updatedAt: Date.now() };
    this.database.upsertSession(next);
    return next;
  }

  async setSessionToolApprovalMode(
    sessionId: string,
    mode: ToolApprovalMode,
  ): Promise<void> {
    const previous = this.requireSession(sessionId);
    const active = this.runs.get(sessionId);
    const next = { ...previous, toolApprovalMode: mode };
    this.database.upsertSession(next);
    if (!active) return;
    try {
      await Promise.all([
        active.driverSession.execute({
          type: "set-tool-approval-mode",
          mode,
        }),
        active.subagents.setToolApprovalMode(mode),
      ]);
    } catch (error) {
      this.database.upsertSession(previous);
      await Promise.allSettled([
        active.driverSession.execute({
          type: "set-tool-approval-mode",
          mode: previous.toolApprovalMode,
        }),
        active.subagents.setToolApprovalMode(previous.toolApprovalMode),
      ]);
      throw error;
    }
  }

  async setSessionInteractionMode(
    sessionId: string,
    interactionMode: AgentInteractionModeId,
  ): Promise<SessionRecord> {
    if (this.runs.has(sessionId))
      throw new Error(
        "Interaction mode can only change while the session is idle",
      );
    const current = this.requireSession(sessionId);
    this.assertInteractionModeAvailable(
      interactionMode,
      current.driverId,
      current.model,
    );
    const next = { ...current, interactionMode, updatedAt: Date.now() };
    this.database.upsertSession(next);
    await this.persistPlanModeState(
      next,
      interactionMode === "plan" ? "planning" : "off",
    );
    this.historyCache.delete(sessionId);
    return next;
  }

  async resolveClarificationQuestion(
    sessionId: string,
    callId: string,
    value: string | boolean,
  ): Promise<UserMessageSubmission> {
    if (this.runs.has(sessionId))
      throw new Error(
        "Wait for the current response before answering a clarification question",
      );
    const session = this.requireSession(sessionId);
    if (session.interactionMode !== "clarify")
      throw new Error("The session is not in clarification mode");
    const snapshot = await this.getSessionSnapshot(sessionId);
    const block = snapshot.messages
      .flatMap((message) => message.blocks)
      .find(
        (candidate) =>
          candidate.type === "tool" &&
          candidate.callId === callId &&
          candidate.name === "ask_clarifying_question",
      );
    if (!block || block.type !== "tool")
      throw new Error("The clarification question is unavailable");
    if (asRecord(block.details)?.clarificationAnswer !== undefined)
      throw new Error("This clarification question has already been answered");
    const question = clarificationQuestionFromDetails(block.details);
    if (!question) throw new Error("The clarification question is invalid");
    if (question.answerType === "confirm" && typeof value !== "boolean")
      throw new Error("This clarification question requires a confirmation");
    if (question.answerType !== "confirm" && typeof value !== "string")
      throw new Error("This clarification question requires text");
    if (typeof value === "string" && !value.trim())
      throw new Error("A clarification answer is required");
    if (
      question.answerType === "choice" &&
      typeof value === "string" &&
      !question.allowCustom &&
      !question.options?.some((option) => option.value === value)
    ) {
      throw new Error("The selected clarification answer is unavailable");
    }
    const answer: PersistedClarificationAnswer = {
      callId,
      value,
      submittedAt: Date.now(),
    };
    const journal = await openWordlessSession(session.journalPath);
    await (
      journal as unknown as {
        appendCustomEntry(customType: string, data?: unknown): Promise<string>;
      }
    ).appendCustomEntry(CLARIFICATION_ANSWER_JOURNAL_TYPE, answer);
    this.historyCache.delete(sessionId);
    const submission: UserMessageSubmission = {
      messageId: randomUUID(),
      submittedAt: Date.now(),
    };
    const displayValue =
      typeof value === "boolean" ? (value ? "Yes" : "No") : value;
    await this.promptSession(
      sessionId,
      `Clarification answer to "${question.question}": ${displayValue}`,
      [],
      submission,
    );
    return submission;
  }

  async handoffClarification(
    sessionId: string,
    interactionMode: AgentInteractionModeId,
  ): Promise<void> {
    if (this.runs.has(sessionId))
      throw new Error(
        "Wait for the current response before choosing the next mode",
      );
    const current = this.requireSession(sessionId);
    if (current.interactionMode !== "clarify")
      throw new Error("The session is not in clarification mode");
    const snapshot = await this.getSessionSnapshot(sessionId);
    const brief = [...snapshot.messages]
      .reverse()
      .flatMap((message) => [...message.blocks].reverse())
      .flatMap((block) =>
        block.type === "tool" && block.name === "complete_clarification"
          ? [clarificationBriefFromDetails(block.details)]
          : [],
      )
      .find(
        (candidate): candidate is ClarificationBrief => candidate !== undefined,
      );
    if (!brief)
      throw new Error(
        "A clarification brief is required before changing modes",
      );
    const confirmed = snapshot.messages
      .flatMap((message) => message.blocks)
      .some(
        (block) =>
          block.type === "tool" &&
          block.name === "ask_clarifying_question" &&
          hasPositiveClarificationConfirmation(block.details),
      );
    if (!confirmed)
      throw new Error("Confirm the clarification brief before changing modes");
    await this.setSessionInteractionMode(sessionId, interactionMode);
    if (interactionMode === "clarify") {
      await this.promptSession(
        sessionId,
        "Continue clarifying the highest-priority unresolved question. Ask exactly one question.",
      );
      return;
    }
    if (interactionMode === "plan") {
      const sections = [
        brief.summary,
        `Goals:\n${brief.goals.map((goal) => `- ${goal}`).join("\n")}`,
        `Constraints:\n${brief.constraints.map((constraint) => `- ${constraint}`).join("\n")}`,
        `Decisions:\n${brief.decisions.map((decision) => `- ${decision.topic}: ${decision.outcome}`).join("\n")}`,
        `Open questions:\n${brief.openQuestions.map((question) => `- ${question}`).join("\n")}`,
      ].filter((section) => section.trim().length > 0);
      await this.promptSession(
        sessionId,
        `Based on the clarification brief below, produce a concise ordered implementation plan. Do not execute the plan.\n\n${sections.join("\n\n")}`,
      );
    }
  }

  async deleteSession(
    sessionId: string,
    beforeDelete?: (session: SessionRecord) => Promise<void>,
  ): Promise<void> {
    if (this.runs.has(sessionId))
      throw new Error(
        "Wait for the current response before deleting this session",
      );
    const session = this.requireSession(sessionId);
    await beforeDelete?.(session);
    if (this.isInternalSessionRoot(session.runtimeRootPath))
      await rm(session.runtimeRootPath, {
        force: true,
        recursive: true,
        maxRetries: 10,
        retryDelay: 200,
      });
    await rm(session.journalPath, {
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    await rm(join(this.options.paths.journalsRoot, "subagents", sessionId), {
      force: true,
      recursive: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    await rm(join(this.mediaAssetsRoot(), sessionId), {
      force: true,
      recursive: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    if (session.workbenchId === "media-canvas")
      this.database.deleteMediaProject(sessionId);
    this.database.clearTaskSession(sessionId);
    this.database.deleteSession(sessionId);
    this.historyCache.delete(sessionId);
    this.artifactRevisions.delete(sessionId);
    if (session.workbenchId === "media-canvas")
      this.emitApp({ type: "media.project.changed", sessionId });
  }

  async createMediaProject(title?: string): Promise<MediaProject> {
    const entry = this.getEntry("image-generation");
    const profile = entry.profile
      ? this.profiles.get(entry.profile)
      : undefined;
    if (!profile || !this.drivers.get(profile.driverId))
      throw new Error("The media workbench profile is unavailable");

    const now = Date.now();
    const id = randomUUID();
    const runtimeRootPath = join(this.options.paths.sessionWorkspacesRoot, id);
    await this.pathService.ensureSessionRoot(runtimeRootPath);
    const journalPath = join(this.options.paths.journalsRoot, `${id}.jsonl`);
    const model = this.defaultMediaAgentModel();
    const runtimeModel =
      model.connectionId === "media-agent"
        ? undefined
        : this.requireRuntimeModel(model);
    const record: SessionRecord = {
      id,
      title: title?.trim() || "Untitled canvas",
      workspaceId: null,
      runtimeRootPath,
      mode: entry.mode,
      entryId: entry.id,
      profile: profile.reference,
      driverId: profile.driverId,
      journalFormat: "wordless-agent-v1",
      workbenchId: entry.workbenchId,
      accessLevel: "default",
      model,
      thinkingLevel: runtimeModel
        ? thinkingLevelForModel(runtimeModel)
        : "medium",
      journalPath,
      connectorIds: [],
      interactionMode: "default",
      toolApprovalMode: "manual",
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const journal = await createWordlessSession({
      id,
      createdAt: new Date(now).toISOString(),
      cwd: runtimeRootPath,
      path: journalPath,
      metadata: {
        workspaceId: null,
        entryId: entry.id,
        profile: record.profile,
        driverId: record.driverId,
        accessLevel: record.accessLevel,
        model,
      },
    });
    await journal.appendModelChange(model.connectionId, model.modelId);
    await journal.appendThinkingLevelChange(record.thinkingLevel);
    this.database.upsertSession(record);
    const project: MediaProject = {
      documentVersion: 3,
      sessionId: id,
      title: record.title,
      assets: [],
      operations: [],
      coverAssetId: null,
      viewport: { x: 0, y: 0, zoom: 0.78 },
      createdAt: now,
      updatedAt: now,
    };
    this.database.upsertMediaProject(project);
    this.emitApp({ type: "media.project.changed", sessionId: id });
    return project;
  }

  getMediaProject(sessionId: string): MediaProject {
    const session = this.requireSession(sessionId);
    if (session.workbenchId !== "media-canvas")
      throw new Error("The session is not a media project");
    const project = this.database.getMediaProject(sessionId);
    if (!project) throw new Error("Media project not found");
    const normalized = this.normalizeMediaProject(project);
    if (normalized !== project) this.database.upsertMediaProject(normalized);
    return normalized;
  }

  private saveMediaProject(
    project: MediaProject,
    source?: "viewport" | "layout" | "asset",
  ): MediaProject {
    const session = this.requireSession(project.sessionId);
    if (session.workbenchId !== "media-canvas")
      throw new Error("The session is not a media project");
    const now = Date.now();
    const next: MediaProject = {
      ...project,
      title: project.title.trim() || session.title,
      updatedAt: now,
    };
    this.database.upsertMediaProject(next);
    if (next.title !== session.title)
      this.database.upsertSession({
        ...session,
        title: next.title,
        updatedAt: now,
      });
    else this.database.upsertSession({ ...session, updatedAt: now });
    this.emitApp({
      type: "media.project.changed",
      sessionId: next.sessionId,
      ...(source ? { source } : {}),
    });
    return next;
  }

  async importMediaImages(request: {
    sessionId: string;
    sourcePaths: string[];
    targetPosition: { x: number; y: number };
  }): Promise<MediaProject> {
    let project = this.getMediaProject(request.sessionId);
    const now = Date.now();
    const assets: MediaAsset[] = [];
    const operations: MediaOperation[] = [];
    for (const [index, sourcePath] of request.sourcePaths.entries()) {
      const imported = await this.writeMediaFileAsset(
        request.sessionId,
        sourcePath,
      );
      const operationId = randomUUID();
      const assetId = randomUUID();
      const position = this.createAssetPosition(
        undefined,
        request.targetPosition,
        request.sourcePaths.length,
        index,
      );
      operations.push({
        id: operationId,
        kind: "upload",
        inputs: [],
        outputAssetIds: [assetId],
        prompt: null,
        ratio: "source",
        outputCount: 1,
        outputTotal: 1,
        providerId: null,
        modelId: null,
        parameters: { sourceName: imported.name },
        status: "ready",
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      });
      assets.push({
        id: assetId,
        operationId,
        origin: "uploaded",
        kind: "image",
        status: "ready",
        name: imported.name,
        mimeType: imported.mimeType,
        url: imported.url,
        errorMessage: null,
        pixelWidth: null,
        pixelHeight: null,
        ...position,
        outputIndex: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    return this.saveMediaProject({
      ...project,
      assets: [...project.assets, ...assets],
      operations: [...project.operations, ...operations],
    });
  }

  async duplicateMediaAsset(
    sessionId: string,
    assetId: string,
    targetPosition: { x: number; y: number },
  ): Promise<MediaProject> {
    const project = this.getMediaProject(sessionId);
    const source = this.requireMediaAsset(project, assetId);
    if (source.status !== "ready" || source.kind !== "image")
      throw new Error("Only ready image nodes can be copied");
    const image = await this.readMediaAssetInput(sessionId, source);
    const now = Date.now();
    const operationId = randomUUID();
    const copiedAssetId = randomUUID();
    const extension = extname(source.name);
    const name = `${basename(source.name, extension)} copy${extension}`;
    const copiedAsset: MediaAsset = {
      ...source,
      id: copiedAssetId,
      operationId,
      name,
      url: await this.writeMediaImageAsset(
        sessionId,
        image.mimeType,
        image.data,
      ),
      x: targetPosition.x,
      y: targetPosition.y,
      outputIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    const operation: MediaOperation = {
      id: operationId,
      kind: "upload",
      inputs: [],
      outputAssetIds: [copiedAssetId],
      prompt: null,
      ratio: "source",
      outputCount: 1,
      outputTotal: 1,
      providerId: null,
      modelId: null,
      parameters: { source: "copy" },
      status: "ready",
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.saveMediaProject({
      ...project,
      assets: [...project.assets, copiedAsset],
      operations: [...project.operations, operation],
    });
  }

  async deleteMediaAsset(
    sessionId: string,
    assetId: string,
  ): Promise<MediaProject> {
    const project = this.getMediaProject(sessionId);
    const asset = this.requireMediaAsset(project, assetId);
    if (asset.status === "rendering")
      throw new Error(
        "Wait for the image generation to finish before deleting it",
      );
    const next: MediaProject = {
      ...project,
      assets: project.assets.filter((candidate) => candidate.id !== assetId),
      operations: project.operations
        .map((operation) => ({
          ...operation,
          outputAssetIds: operation.outputAssetIds.filter(
            (id) => id !== assetId,
          ),
        }))
        .filter((operation) => operation.outputAssetIds.length > 0),
      coverAssetId:
        project.coverAssetId === assetId ? null : project.coverAssetId,
    };
    const saved = this.saveMediaProject(next);
    if (
      asset.url &&
      !saved.assets.some((candidate) => candidate.url === asset.url)
    ) {
      const parsed = new URL(asset.url);
      const [assetSessionId, fileName] = parsed.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      if (
        parsed.protocol === "wordless-media:" &&
        parsed.hostname === "asset" &&
        assetSessionId === sessionId &&
        fileName &&
        /^[a-f0-9]{64}\.(gif|jpe?g|png|webp)$/i.test(fileName)
      ) {
        try {
          await rm(join(this.mediaAssetsRoot(), sessionId, fileName), {
            force: true,
          });
        } catch {}
      }
    }
    return saved;
  }

  async readMediaAssetData(
    sessionId: string,
    assetId: string,
  ): Promise<MediaInlineImage> {
    const project = this.getMediaProject(sessionId);
    const asset = this.requireMediaAsset(project, assetId);
    const image = await this.readMediaAssetInput(sessionId, asset);
    return { mimeType: image.mimeType, data: image.data };
  }

  async downloadMediaAsset(
    sessionId: string,
    assetId: string,
    destinationDirectory: string,
  ): Promise<string> {
    const project = this.getMediaProject(sessionId);
    const asset = this.requireMediaAsset(project, assetId);
    const image = await this.readMediaAssetInput(sessionId, asset);
    const extension = extensionForMediaMimeType(image.mimeType);
    const originalStem = basename(asset.name, extname(asset.name));
    const sanitizedStem =
      originalStem
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim() || "wordless-image";
    await mkdir(destinationDirectory, { recursive: true });
    for (let suffix = 0; ; suffix += 1) {
      const fileName =
        suffix === 0
          ? `${sanitizedStem}.${extension}`
          : `${sanitizedStem} (${suffix}).${extension}`;
      const targetPath = join(destinationDirectory, fileName);
      try {
        await writeFile(targetPath, Buffer.from(image.data, "base64"), {
          flag: "wx",
        });
        return targetPath;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      }
    }
  }

  async startMediaOperation(
    request: MediaOperationRequest,
  ): Promise<MediaProject> {
    if (request.action === "crop") return await this.createMediaCrop(request);
    const project = this.getMediaProject(request.sessionId);
    const prompt = request.prompt.trim();
    if (!prompt) throw new Error("Describe the image before generating");
    const inputIds = [...request.parentAssetIds, ...request.referenceAssetIds];
    const inputAssets = inputIds.map((assetId) =>
      this.requireMediaAsset(project, assetId),
    );
    if (
      inputAssets.some(
        (asset) => asset.status !== "ready" || asset.kind !== "image",
      )
    )
      throw new Error("All source images must be ready");
    const operationId = randomUUID();
    const outputTotal =
      request.action === "multi-view"
        ? request.views.length
        : request.outputCount;
    const now = Date.now();
    const inputs = inputIds.map((assetId) => ({
      assetId,
      role: request.parentAssetIds.includes(assetId)
        ? ("parent" as const)
        : ("reference" as const),
    }));
    const operation: MediaOperation = {
      id: operationId,
      kind: request.action,
      inputs,
      outputAssetIds: [],
      prompt,
      ratio: request.ratio,
      outputCount: 0,
      outputTotal,
      providerId: request.providerId,
      modelId: request.modelId,
      parameters:
        request.action === "local-edit" || request.action === "remove-object"
          ? {
              hasMask: true,
              ...(request.imageParameters
                ? { imageParameters: request.imageParameters }
                : {}),
            }
          : request.action === "remove-background"
            ? {
                preserveSubject: request.preserveSubject,
                ...(request.imageParameters
                  ? { imageParameters: request.imageParameters }
                  : {}),
              }
            : request.action === "multi-view"
              ? {
                  views: request.views,
                  ...(request.imageParameters
                    ? { imageParameters: request.imageParameters }
                    : {}),
                }
              : request.imageParameters
                ? { imageParameters: request.imageParameters }
                : {},
      status: "rendering",
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    const parent = inputAssets.find((asset) =>
      request.parentAssetIds.includes(asset.id),
    );
    const assets = Array.from(
      { length: outputTotal },
      (_, outputIndex): MediaAsset => ({
        id: randomUUID(),
        operationId,
        origin: "generated",
        kind: "image",
        status: "rendering",
        name: `Image ${String(project.assets.length + outputIndex + 1).padStart(3, "0")}`,
        mimeType: "image/png",
        url: null,
        errorMessage: null,
        pixelWidth: null,
        pixelHeight: null,
        ...this.createAssetPosition(
          parent,
          request.targetPosition,
          outputTotal,
          outputIndex,
        ),
        outputIndex,
        createdAt: now,
        updatedAt: now,
      }),
    );
    operation.outputAssetIds = assets.map((asset) => asset.id);
    const controller = new AbortController();
    this.mediaOperations.set(operationId, controller);
    let initial: MediaProject;
    try {
      initial = this.saveMediaProject({
        ...project,
        assets: [...project.assets, ...assets],
        operations: [...project.operations, operation],
      });
    } catch (cause) {
      this.mediaOperations.delete(operationId);
      throw cause;
    }
    void this.runMediaOperation(request, operationId, controller.signal);
    return initial;
  }

  async cancelMediaOperation(
    sessionId: string,
    operationId: string,
  ): Promise<void> {
    const project = this.getMediaProject(sessionId);
    const operation = project.operations.find(
      (candidate) => candidate.id === operationId,
    );
    if (!operation) throw new Error("Media operation not found");
    this.mediaOperations.get(operationId)?.abort();
    if (!this.mediaOperations.has(operationId)) {
      this.saveMediaProject({
        ...project,
        operations: project.operations.map((candidate) =>
          candidate.id === operationId
            ? {
                ...candidate,
                status: "cancelled",
                errorMessage: "Operation cancelled",
                updatedAt: Date.now(),
              }
            : candidate,
        ),
        assets: project.assets.map((asset) =>
          asset.operationId === operationId && asset.status === "rendering"
            ? {
                ...asset,
                status: "failed",
                errorMessage: "Operation cancelled",
                updatedAt: Date.now(),
              }
            : asset,
        ),
      });
    }
  }

  updateMediaLayout(update: MediaLayoutUpdate): MediaProject {
    const project = this.getMediaProject(update.sessionId);
    const positions = new Map(update.assets.map((asset) => [asset.id, asset]));
    return this.saveMediaProject(
      {
        ...project,
        assets: project.assets.map((asset) => {
          const position = positions.get(asset.id);
          return position
            ? {
                ...asset,
                x: position.x,
                y: position.y,
                width: position.width,
                height: position.height,
                updatedAt: Date.now(),
              }
            : asset;
        }),
        ...(update.viewport ? { viewport: update.viewport } : {}),
      },
      "layout",
    );
  }

  updateMediaViewport(update: MediaViewportUpdate): MediaViewportUpdate["viewport"] {
    const project = this.getMediaProject(update.sessionId);
    this.saveMediaProject(
      {
        ...project,
        viewport: update.viewport,
      },
      "viewport",
    );
    return update.viewport;
  }

  setMediaCoverAsset(sessionId: string, assetId: string): MediaProject {
    const project = this.getMediaProject(sessionId);
    const asset = this.requireMediaAsset(project, assetId);
    if (asset.status !== "ready")
      throw new Error("Only ready media assets can be used as the cover");
    return this.saveMediaProject({ ...project, coverAssetId: assetId });
  }

  private async runMediaOperation(
    request: Exclude<MediaOperationRequest, MediaCropRequest>,
    operationId: string,
    signal: AbortSignal,
  ): Promise<void> {
    let completed = 0;
    try {
      const project = this.getMediaProject(request.sessionId);
      const operation = project.operations.find(
        (candidate) => candidate.id === operationId,
      );
      if (!operation) throw new Error("Media operation not found");
      const targets = project.assets.filter(
        (asset) => asset.operationId === operationId,
      );
      const inputs = [
        ...request.parentAssetIds,
        ...request.referenceAssetIds,
      ].map((assetId) => this.requireMediaAsset(project, assetId));
      const batches = targets.map((target, index) => ({
        targets: [target],
        viewLabel:
          request.action === "multi-view"
            ? request.views[index]?.label
            : undefined,
      }));
      for (const [batchIndex, batch] of batches.entries()) {
        if (signal.aborted) throw new Error("Operation cancelled");
        const prompt = this.mediaOperationPrompt(request, batch.viewLabel);
        const input: ImagesContext["input"] = [
          ...(await Promise.all(
            inputs.map((asset) =>
              this.readMediaAssetInput(request.sessionId, asset),
            ),
          )),
          { type: "text", text: prompt },
        ];
        const response = await this.modelConfiguration.generateImage(
          request.providerId,
          request.modelId,
          {
            input,
            outputCount: batch.targets.length,
            generation: {
              aspectRatio:
                request.imageParameters?.aspectRatio ?? request.ratio,
              ...request.imageParameters,
            },
            ...(request.action === "local-edit" ||
            request.action === "remove-object"
              ? {
                  edit: {
                    mask: {
                      type: "image" as const,
                      mimeType: request.mask.mimeType,
                      data: request.mask.data,
                    },
                    inputFidelity: "high" as const,
                  },
                }
              : {}),
            ...(request.action === "remove-background"
              ? { edit: { background: "transparent" as const } }
              : {}),
          },
          { signal },
        );
        const usage = conversationUsageFromAiUsage(response.usage);
        this.updateMediaProject(request.sessionId, (current) => ({
          ...current,
          operations: current.operations.map((candidate) =>
            candidate.id === operationId
              ? {
                  ...candidate,
                  usageEvents: [
                    ...(candidate.usageEvents ?? []),
                    {
                      id: response.responseId ?? `${operationId}:${batchIndex}`,
                      timestamp: response.timestamp,
                      ...(usage ? { usage } : {}),
                    },
                  ],
                  updatedAt: Date.now(),
                }
              : candidate,
          ),
        }));
        if (response.stopReason !== "stop")
          throw new Error(response.errorMessage ?? "Image generation failed");
        const images = response.output.filter(
          (item): item is Extract<typeof item, { type: "image" }> =>
            item.type === "image",
        );
        if (images.length === 0)
          throw new Error("The selected model did not return an image");
        for (const [index, image] of images
          .slice(0, batch.targets.length)
          .entries()) {
          const target = batch.targets[index];
          if (!target) continue;
          const url = await this.writeMediaImageAsset(
            request.sessionId,
            image.mimeType,
            image.data,
          );
          completed += 1;
          this.updateMediaProject(request.sessionId, (current) => ({
            ...current,
            assets: current.assets.map((asset) =>
              asset.id === target.id
                ? {
                    ...asset,
                    status: "ready",
                    url,
                    mimeType: image.mimeType,
                    errorMessage: null,
                    updatedAt: Date.now(),
                  }
                : asset,
            ),
            operations: current.operations.map((candidate) =>
              candidate.id === operationId
                ? {
                    ...candidate,
                    outputCount: completed,
                    updatedAt: Date.now(),
                  }
                : candidate,
            ),
          }));
        }
        if (images.length < batch.targets.length)
          throw new Error(
            `The selected model returned ${images.length} of ${batch.targets.length} requested images`,
          );
      }
      this.updateMediaProject(request.sessionId, (current) => ({
        ...current,
        operations: current.operations.map((candidate) =>
          candidate.id === operationId
            ? {
                ...candidate,
                status: "ready",
                outputCount: completed,
                errorMessage: null,
                updatedAt: Date.now(),
              }
            : candidate,
        ),
      }));
    } catch (cause) {
      const message = signal.aborted
        ? "Operation cancelled"
        : cause instanceof Error
          ? cause.message
          : String(cause);
      this.updateMediaProject(request.sessionId, (current) => ({
        ...current,
        assets: current.assets.map((asset) =>
          asset.operationId === operationId && asset.status === "rendering"
            ? {
                ...asset,
                status: "failed",
                errorMessage: message,
                updatedAt: Date.now(),
              }
            : asset,
        ),
        operations: current.operations.map((candidate) =>
          candidate.id === operationId
            ? {
                ...candidate,
                status: signal.aborted
                  ? "cancelled"
                  : completed > 0
                    ? "partial"
                    : "failed",
                outputCount: completed,
                errorMessage: message,
                updatedAt: Date.now(),
              }
            : candidate,
        ),
      }));
    } finally {
      this.mediaOperations.delete(operationId);
    }
  }

  private mediaOperationPrompt(
    request: Exclude<MediaOperationRequest, MediaCropRequest>,
    viewLabel?: string,
  ): string {
    if (request.action === "remove-background")
      return `${request.prompt}\nRemove the background and preserve only the ${request.preserveSubject}. Return a transparent background.`;
    if (request.action === "remove-object")
      return `${request.prompt}\nUse the provided raster mask as a strict spatial constraint. Transparent mask pixels are the only editable area. Remove only the image content inside that area and inpaint it from the immediate surroundings. Preserve every unmasked region exactly, especially connected body parts, the person's face, identity, pose, and clothing outside the mask. Never remove the whole subject unless the whole subject is masked.`;
    if (request.action === "multi-view" && viewLabel)
      return `${request.prompt}\nGenerate the same subject from the ${viewLabel} view while preserving identity, materials, lighting, and proportions.`;
    return request.prompt;
  }

  private updateMediaProject(
    sessionId: string,
    update: (project: MediaProject) => MediaProject,
  ): MediaProject {
    return this.saveMediaProject(update(this.getMediaProject(sessionId)));
  }

  private async createMediaCrop(
    request: MediaCropRequest,
  ): Promise<MediaProject> {
    const project = this.getMediaProject(request.sessionId);
    const source = this.requireMediaAsset(project, request.sourceAssetId);
    if (source.status !== "ready")
      throw new Error("The source image is not ready");
    const operationId = randomUUID();
    const assetId = randomUUID();
    const now = Date.now();
    const url = await this.writeMediaImageAsset(
      request.sessionId,
      request.image.mimeType,
      request.image.data,
    );
    const operation: MediaOperation = {
      id: operationId,
      kind: "crop",
      inputs: [{ assetId: source.id, role: "parent" }],
      outputAssetIds: [assetId],
      prompt: null,
      ratio: "source",
      outputCount: 1,
      outputTotal: 1,
      providerId: null,
      modelId: null,
      parameters: { crop: request.crop },
      status: "ready",
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    const asset: MediaAsset = {
      id: assetId,
      operationId,
      origin: "generated",
      kind: "image",
      status: "ready",
      name: `${source.name} cropped`,
      mimeType: request.image.mimeType,
      url,
      errorMessage: null,
      pixelWidth: null,
      pixelHeight: null,
      ...this.createAssetPosition(source, request.targetPosition, 1, 0),
      outputIndex: 0,
      createdAt: now,
      updatedAt: now,
    };
    return this.saveMediaProject({
      ...project,
      assets: [...project.assets, asset],
      operations: [...project.operations, operation],
    });
  }

  getSessionRuntimeRoot(sessionId: string): string {
    return this.requireSession(sessionId).runtimeRootPath;
  }

  async resolveOperationApproval(
    sessionId: string,
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ): Promise<void> {
    const key = `${sessionId}:${approvalId}`;
    const existing = this.approvalResolutions.get(key);
    if (existing) {
      await existing;
      return;
    }
    const resolution = (async () => {
      const active = this.runs.get(sessionId);
      if (!active)
        throw new Error("The requested operation is no longer active");
      if (
        await active.subagents.resolveOperationApproval(
          approvalId,
          approved,
          feedback,
        )
      )
        return;
      await active.driverSession.execute({
        type: "resolve-approval",
        resolution: { approvalId, approved, feedback },
      });
    })();
    this.approvalResolutions.set(key, resolution);
    try {
      await resolution;
    } finally {
      this.approvalResolutions.delete(key);
    }
  }

  listTasks(): TaskRecord[] {
    return this.database.listTasks();
  }

  createTask(input: TaskRecordInput): TaskRecord {
    this.validateTaskInput(input);
    const now = Date.now();
    const task: TaskRecord = {
      ...structuredClone(input),
      id: randomUUID(),
      completedAt: null,
      position:
        input.position ??
        this.database
          .listTasks()
          .filter((candidate) => candidate.status === input.status).length,
      execution: {
        status: "idle",
        sessionId: null,
        messageId: null,
        runId: null,
        startedAt: null,
        completedAt: null,
        error: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.database.upsertTask(task);
    this.emitApp({ type: "task.changed", id: task.id });
    return task;
  }

  updateTask(id: string, input: TaskRecordInput): TaskRecord {
    const current = this.requireTask(id);
    if (
      current.execution.status === "starting" ||
      current.execution.status === "running" ||
      current.execution.status === "waiting"
    )
      throw new Error("A running task cannot be edited");
    this.validateTaskInput(input);
    const task: TaskRecord = {
      ...structuredClone(input),
      id,
      completedAt: current.completedAt ?? null,
      position: input.position ?? current.position,
      execution: current.execution,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    };
    this.database.upsertTask(task);
    this.emitApp({ type: "task.changed", id });
    return task;
  }

  moveTask(id: string, status: TaskStatus, position?: number): TaskRecord {
    const current = this.requireTask(id);
    const task = {
      ...current,
      status,
      completedAt:
        status === "done" && current.completedAt == null
          ? Date.now()
          : current.completedAt,
      position:
        position ??
        this.database
          .listTasks()
          .filter(
            (candidate) => candidate.status === status && candidate.id !== id,
          ).length,
      updatedAt: Date.now(),
    };
    this.database.upsertTask(task);
    this.emitApp({ type: "task.changed", id });
    return task;
  }

  deleteTask(id: string): void {
    const task = this.requireTask(id);
    if (
      task.execution.status === "starting" ||
      task.execution.status === "running" ||
      task.execution.status === "waiting"
    )
      throw new Error("A running task cannot be deleted");
    this.database.deleteTask(id);
    this.emitApp({ type: "task.changed", id });
  }

  async executeTask(id: string): Promise<TaskRecord> {
    let task = this.requireTask(id);
    if (["starting", "running", "waiting"].includes(task.execution.status))
      throw new Error("The task is already running");
    const submission: UserMessageSubmission = {
      messageId: randomUUID(),
      submittedAt: Date.now(),
    };
    task = {
      ...task,
      execution: {
        status: "starting",
        sessionId: task.sessionId,
        messageId: submission.messageId,
        runId: null,
        startedAt: submission.submittedAt,
        completedAt: null,
        error: null,
      },
      updatedAt: Date.now(),
    };
    this.database.upsertTask(task);
    this.emitApp({ type: "task.changed", id });
    try {
      const parts = this.taskPromptParts(task);
      const prompt = formatPromptWithSkillReferences(parts);
      const skillIds = selectedSkillIdsFromPromptParts(parts);
      let sessionId = task.sessionId;
      if (sessionId) {
        const session = this.requireSession(sessionId);
        if (this.runs.has(sessionId))
          throw new Error("The linked session is currently running");
        if (
          task.model &&
          (task.model.connectionId !== session.model.connectionId ||
            task.model.modelId !== session.model.modelId)
        )
          await this.setSessionModel(sessionId, task.model, task.thinkingLevel);
        else if (task.thinkingLevel !== session.thinkingLevel)
          await this.setSessionThinkingLevel(sessionId, task.thinkingLevel);
        if (task.accessLevel !== session.accessLevel)
          this.setSessionAccess(sessionId, task.accessLevel);
        if (task.toolApprovalMode !== session.toolApprovalMode)
          await this.setSessionToolApprovalMode(
            sessionId,
            task.toolApprovalMode,
          );
        await this.promptSession(sessionId, prompt, skillIds, submission, {
          connectorIds: task.connectorIds,
          taskId: id,
        });
      } else {
        const entry = this.getEntry(task.entryId ?? "general-work");
        const session = await this.createAndPrompt(
          {
            mode: entry.mode,
            entryId: entry.id,
            title: task.title,
            workspaceId: task.workspaceId,
            accessLevel: task.accessLevel,
            model: task.model,
            thinkingLevel: task.thinkingLevel,
            connectorIds: task.connectorIds,
            interactionMode: "default",
            toolApprovalMode: task.toolApprovalMode,
            ...(task.expertSelection
              ? { expertSelection: task.expertSelection }
              : {}),
          },
          prompt,
          skillIds,
          submission,
          { taskId: id },
        );
        sessionId = session.id;
      }
      const current = this.requireTask(id);
      task = {
        ...current,
        sessionId,
        execution: { ...current.execution, sessionId },
        updatedAt: Date.now(),
      };
      this.database.upsertTask(task);
      this.emitApp({ type: "task.changed", id });
      return task;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const current = this.requireTask(id);
      task = {
        ...current,
        execution: {
          ...current.execution,
          status: "blocked",
          completedAt: Date.now(),
          error: message,
        },
        updatedAt: Date.now(),
      };
      this.database.upsertTask(task);
      this.emitApp({ type: "task.changed", id });
      throw cause;
    }
  }

  private taskPromptParts(task: TaskRecord): UserPromptPart[] {
    return [
      { type: "text", text: `Task title: ${task.title}\n\nTask details:\n` },
      ...task.detailParts,
      ...(task.expectedResult?.trim()
        ? [
            {
              type: "text" as const,
              text: `\n\nExpected result:\n${task.expectedResult.trim()}`,
            },
          ]
        : []),
    ];
  }

  private validateTaskInput(input: TaskRecordInput): void {
    if (!input.title.trim()) throw new Error("Task title is required");
    if (
      !input.detailParts.some(
        (part) => part.type === "text" && part.text.trim(),
      )
    )
      throw new Error("Task details are required");
    if (!input.sessionId) return;
    const session = this.requireSession(input.sessionId);
    if (input.entryId && input.entryId !== session.entryId)
      throw new Error("The task work type conflicts with the linked session");
    if (input.workspaceId !== null && input.workspaceId !== session.workspaceId)
      throw new Error("The task workspace conflicts with the linked session");
    if (
      input.expertSelection &&
      (input.expertSelection.id !== session.expertSelection?.id ||
        input.expertSelection.kind !== session.expertSelection?.kind)
    )
      throw new Error("The task employee conflicts with the linked session");
  }

  private requireTask(id: string): TaskRecord {
    const task = this.database.getTask(id);
    if (!task) throw new Error("Task not found");
    return task;
  }

  async resolveUserRequest(
    sessionId: string,
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, string | string[] | boolean>;
      feedback?: string;
    },
  ): Promise<void> {
    const active = this.runs.get(sessionId);
    if (!active)
      throw new Error("The requested user input is no longer active");
    if (await active.subagents.resolveUserRequest(requestId, resolution))
      return;
    await active.driverSession.execute({
      type: "resolve-user-request",
      resolution: {
        requestId,
        status: resolution.status,
        answers: resolution.answers,
        feedback: resolution.feedback,
      },
    });
  }

  async setSessionModel(
    sessionId: string,
    model: ModelReference,
    requestedThinkingLevel?: ThinkingLevel,
  ): Promise<void> {
    const session = this.requireSession(sessionId);
    const entry = this.getEntry(session.entryId);
    this.requireCompatibleEnabledModel(model, entry);
    if (this.runs.has(sessionId))
      throw new Error(
        "Wait for the current response before changing the model",
      );
    const currentRuntimeModel = this.models.getModel(
      session.model.connectionId,
      session.model.modelId,
    );
    const nextRuntimeModel = this.requireRuntimeModel(model);
    const requestedLevel =
      requestedThinkingLevel ??
      (currentRuntimeModel?.reasoning ? session.thinkingLevel : "medium");
    if (
      requestedThinkingLevel &&
      !getSupportedThinkingLevels(nextRuntimeModel).includes(
        requestedThinkingLevel,
      )
    ) {
      throw new Error(
        "The selected model does not support this thinking depth",
      );
    }
    const thinkingLevel = thinkingLevelForModel(
      nextRuntimeModel,
      requestedLevel,
    );
    const journal = await openWordlessSession(session.journalPath);
    await journal.appendModelChange(model.connectionId, model.modelId);
    if (thinkingLevel !== session.thinkingLevel)
      await journal.appendThinkingLevelChange(thinkingLevel);
    this.database.upsertSession({
      ...session,
      model,
      thinkingLevel,
      updatedAt: Date.now(),
    });
    this.rememberEntryModel(session.entryId, model);
  }

  async setSessionThinkingLevel(
    sessionId: string,
    level: ThinkingLevel,
  ): Promise<SessionRecord> {
    const session = this.requireSession(sessionId);
    if (this.runs.has(sessionId))
      throw new Error(
        "Wait for the current response before changing the thinking depth",
      );
    const model = this.requireRuntimeModel(session.model);
    if (!getSupportedThinkingLevels(model).includes(level))
      throw new Error(
        "The selected model does not support this thinking depth",
      );
    if (session.thinkingLevel === level) return session;
    const journal = await openWordlessSession(session.journalPath);
    await journal.appendThinkingLevelChange(level);
    const next = { ...session, thinkingLevel: level, updatedAt: Date.now() };
    this.database.upsertSession(next);
    return next;
  }

  setPreferences(preferences: AppPreferences): void {
    this.preferences = preferences;
    this.database.savePreferences(preferences);
    this.emitApp({ type: "preferences.changed" });
  }

  async discoverProviderModels(
    request: import("@wordless/domain").ProviderModelDiscoveryRequest,
  ): Promise<import("@wordless/domain").ProviderModelCandidate[]> {
    return await this.modelConfiguration.discoverProviderModels(request);
  }

  async saveProviderConfiguration(
    kind: "chat" | "image",
    providerId: string,
    configuration: Record<string, unknown>,
    enabledModelIds?: string[],
  ): Promise<void> {
    await this.modelConfiguration.saveProviderConfiguration(
      kind,
      providerId,
      configuration,
      enabledModelIds,
    );
  }

  async deleteCustomProvider(
    kind: "chat" | "image",
    providerId: string,
  ): Promise<void> {
    await this.modelConfiguration.deleteCustomProvider(kind, providerId);
    if (kind === "chat") this.removeProviderModelPreferences(providerId);
  }

  async setConfiguredModelEnabled(
    kind: "chat" | "image",
    providerId: string,
    modelId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.modelConfiguration.setEnabled(
      kind,
      providerId,
      modelId,
      enabled,
    );
  }

  async loginProviderOAuth(
    providerId: string,
    callbacks: unknown,
  ): Promise<void> {
    await this.modelConfiguration.loginOAuth(providerId, callbacks);
  }

  getExtensionSnapshot(): AgentExtensionSnapshot {
    return this.extensions.snapshot();
  }

  async setExtensionEnabled(
    extensionId: string,
    enabled: boolean,
  ): Promise<AgentExtensionSnapshot> {
    return await this.extensions.setEnabled(extensionId, enabled);
  }

  async updateExtensionSettings(
    extensionId: string,
    settings: JsonObject,
  ): Promise<AgentExtensionSnapshot> {
    return await this.extensions.updateSettings(extensionId, settings);
  }

  async interactWithSessionExtension(
    sessionId: string,
    interaction: AgentExtensionInteraction,
  ): Promise<void> {
    const active = this.runs.get(sessionId);
    if (!active) throw new Error("The session is not running");
    await active.driverSession.execute({
      type: "extension.interact",
      interaction,
    });
  }

  async setSessionExtensionState(
    sessionId: string,
    extensionId: string,
    state: JsonObject,
  ): Promise<void> {
    const session = this.requireSession(sessionId);
    const journal = await openWordlessSession(session.journalPath);
    await (
      journal as unknown as {
        appendCustomEntry(customType: string, data?: unknown): Promise<string>;
      }
    ).appendCustomEntry(AGENT_EXTENSION_STATE_JOURNAL_TYPE, {
      extensionId,
      state,
      updatedAt: Date.now(),
    });
  }

  async compactSession(sessionId: string): Promise<void> {
    if (this.runs.has(sessionId))
      throw new Error(
        "Wait for the current operation before compacting this session",
      );
    await this.runCompaction(sessionId);
  }

  private async executeActiveRun(
    sessionId: string,
    active: ActiveRun,
    prompt: string,
    selectedSkills: ReturnType<SkillRegistry["getSessionSkills"]>,
    automaticCompaction: boolean,
    submission?: UserMessageSubmission,
  ): Promise<void> {
    try {
      if (automaticCompaction) active.compactionTrigger = "automatic";
      if (automaticCompaction)
        await active.driverSession.execute({
          type: "compact",
          trigger: "automatic",
        });
      active.kind = "prompt";
      active.isCompacting = false;
      active.compactionTrigger = undefined;
      this.emit(sessionId, active, {
        type: "run.started",
        runId: active.runId,
      });
      await active.driverSession.execute({
        type: "prompt",
        text: prompt,
        selectedSkills,
        submission,
      });
      if (active.runError) throw new Error(active.runError);
      this.emit(sessionId, active, {
        type: "run.completed",
        runId: active.runId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await active.driverSession.execute({ type: "cancel" });
      } catch {
        // The driver may already have torn down its harness after the request failure.
      }
      this.finalizeActiveTools(
        sessionId,
        active,
        `Agent run failed: ${message}`,
      );
      await active.subagents.dispose();
      this.emit(sessionId, active, {
        type: "run.failed",
        runId: active.runId,
        message,
      });
      throw error;
    } finally {
      this.closeActiveRun(sessionId, active);
    }
  }

  private async runCompaction(sessionId: string): Promise<void> {
    const active = await this.createActiveRun(sessionId, "compaction");
    try {
      await active.driverSession.execute({
        type: "compact",
        trigger: "manual",
      });
    } finally {
      this.closeActiveRun(sessionId, active);
    }
  }

  private async createActiveRun(
    sessionId: string,
    kind: ActiveRun["kind"],
    userMessageId?: string,
    connectorIdsOverride?: string[],
    taskId?: string,
  ): Promise<ActiveRun> {
    const record = await this.ensureSessionModelForOpen(sessionId);
    if (this.runs.has(sessionId))
      throw new Error("The session is already running");
    const baseProfile = this.requireProfile(record);
    const expertSnapshot = this.sessionExpertSnapshot(record);
    const identityProfile = expertSnapshot
      ? {
          ...baseProfile,
          systemPrompt: `${baseProfile.systemPrompt}\n\n${activeExpertSystemPrompt(expertSnapshot)}`,
        }
      : baseProfile;
    const profile =
      record.workbenchId === "conversation"
        ? {
            ...identityProfile,
            systemPrompt: `${identityProfile.systemPrompt}\n\n[SESSION ARTIFACTS]\nThe session root is the shared namespace for this conversation. Put final user deliverables in artifacts/primary/ so they appear in the user's Artifacts panel. Put team handoff files, briefs, source notes, and evidence packets in artifacts/shared/. Keep member-specific work in artifacts/<member-id>/. Temporary files must remain inside the session root and must never use the OS temp directory. Always report paths relative to the session root, using the full artifacts/... path for any file another agent must read.`,
          }
        : identityProfile;
    const driver = this.drivers.get(record.driverId);
    if (!driver)
      throw new Error(`Agent Driver is unavailable: ${record.driverId}`);
    const model = this.requireRuntimeModel(record.model);
    const journal = await openWordlessSession(record.journalPath);
    if (record.workbenchId === "conversation")
      await mkdir(
        join(
          record.runtimeRootPath,
          SESSION_ARTIFACTS_DIRECTORY,
          PRIMARY_ARTIFACTS_DIRECTORY,
        ),
        { recursive: true },
      );
    if (record.workbenchId === "conversation")
      await mkdir(
        join(
          record.runtimeRootPath,
          SESSION_ARTIFACTS_DIRECTORY,
          SHARED_ARTIFACTS_DIRECTORY,
        ),
        { recursive: true },
      );
    if (record.workbenchId === "conversation") {
      const artifactSnapshot = await this.scanSessionArtifacts(record);
      this.artifactRevisions.set(sessionId, artifactSnapshot.revision);
    }
    const skills = this.skillRegistry.getSessionSkills(record.workspaceId);
    const env = this.pathService.createExecutionEnv(
      record.runtimeRootPath,
      record.accessLevel,
      {
        readOnlyRoots: skills.map((skill) => skill.baseDir),
      },
    );
    const effectiveConnectorIds = [
      ...new Set([...record.connectorIds, ...(connectorIdsOverride ?? [])]),
    ];
    const connectorScopes = expertConnectorScopes(
      effectiveConnectorIds,
      expertSnapshot,
    );
    const primaryConnectorTools = this.connectorRegistry.createTools(
      connectorScopes.primary,
    );
    const primaryConnectorToolPolicies =
      this.connectorRegistry.createToolPolicies(connectorScopes.primary);
    const delegateConnectorTools = this.connectorRegistry.createTools(
      connectorScopes.delegates,
    );
    const delegateConnectorToolPolicies =
      this.connectorRegistry.createToolPolicies(connectorScopes.delegates);
    const subagents = new SessionSubagentRunner({
      parent: record,
      profile: baseProfile,
      driver,
      models: this.models,
      env,
      workspaceSearch: this.options.workspaceSearch.forRoot(
        record.runtimeRootPath,
      ),
      skills,
      connectorTools: delegateConnectorTools,
      connectorToolPolicies: delegateConnectorToolPolicies,
      security: this.securityPolicy(),
      journalsRoot: this.options.paths.journalsRoot,
      resolveModel: (reference) => this.requireRuntimeModel(reference),
      resolveCapabilities: (reference) => {
        const provider = this.modelConfiguration
          .snapshot()
          .providers.find(
            (candidate) =>
              candidate.kind === "chat" &&
              candidate.id === reference.connectionId,
          );
        if (provider?.authStatus !== "configured")
          throw new Error("The selected model connection is not configured");
        return this.requireEnabledModel(reference).capabilities;
      },
      onFilesChanged: async (changes) => {
        await this.persistSubagentFileChanges(record, changes);
        const active = this.runs.get(sessionId);
        if (active) await this.refreshSessionArtifacts(sessionId, active);
      },
      createExecutionEnv: (rootPath, accessLevel, options) =>
        this.pathService.createExecutionEnv(rootPath, accessLevel, {
          readOnlyRoots: options.readOnlyRoots,
          writableRoot: options.writableRoot,
        }),
      onExpertMemberEvent: (event) =>
        this.emitExpertMemberEvent(sessionId, event),
      toolApprovalMode: record.toolApprovalMode,
      expertTeamDelegates:
        expertSnapshot?.kind === "team"
          ? expertSnapshot.teamMembers.map((member) => ({
              id: member.id,
              name: member.expertName,
              portrait: member.portrait,
              executionProfile: member.executionProfile,
              responsibility: member.responsibility,
              systemPrompt: member.systemPrompt,
              skillIds: member.skillIds,
              connectorIds: member.connectorIds,
              model: member.model,
              thinkingLevel: member.thinkingLevel,
            }))
          : undefined,
    });
    const driverSession = await driver.createSession({
      record,
      profile,
      model,
      modelCapabilities: this.requireEnabledModel(record.model).capabilities,
      models: this.models,
      session: journal,
      env,
      workspaceSearch: this.options.workspaceSearch.forRoot(
        record.runtimeRootPath,
      ),
      skills,
      connectorTools: primaryConnectorTools,
      connectorToolPolicies: primaryConnectorToolPolicies,
      security: this.securityPolicy(),
      resolveModel: (reference) => this.requireRuntimeModel(reference),
      executionKind: "primary",
      subagentRunner: subagents,
      expertTeamDelegates:
        expertSnapshot?.kind === "team"
          ? expertSnapshot.teamMembers.map((member) => ({
              id: member.id,
              name: member.expertName,
              portrait: member.portrait,
              executionProfile: member.executionProfile,
              responsibility: member.responsibility,
              systemPrompt: member.systemPrompt,
              skillIds: member.skillIds,
              connectorIds: member.connectorIds,
            }))
          : undefined,
      toolApprovalMode: record.toolApprovalMode,
    });
    const active: ActiveRun = {
      driverSession,
      subagents,
      tools: new Map(),
      kind,
      isCompacting: kind === "compaction",
      compactionTrigger: kind === "compaction" ? "manual" : undefined,
      sequence: 0,
      runId: randomUUID(),
      ...(userMessageId ? { userMessageId } : {}),
      ...(taskId ? { taskId } : {}),
      unsubscribe: () => {},
    };
    active.unsubscribe = driverSession.subscribe((event) =>
      this.handleDriverEvent(sessionId, active, event),
    );
    this.runs.set(sessionId, active);
    return active;
  }

  private closeActiveRun(sessionId: string, active: ActiveRun): void {
    this.finalizeActiveTools(
      sessionId,
      active,
      "Agent run ended before the tool completed",
    );
    active.unsubscribe();
    active.driverSession.dispose();
    void active.subagents.dispose();
    this.runs.delete(sessionId);
    this.emit(sessionId, active, { type: "session.idle" });
    const current = this.requireSession(sessionId);
    this.database.upsertSession({ ...current, updatedAt: Date.now() });
  }

  private finalizeActiveTools(
    sessionId: string,
    active: ActiveRun,
    reason: string,
  ): void {
    for (const [callId, tool] of active.tools) {
      if (tool.state === "complete" || tool.state === "error") continue;
      const details = terminalizeToolDetails(tool.details, reason);
      const output = tool.output ? `${tool.output}\n\n${reason}` : reason;
      active.tools.set(callId, { ...tool, state: "error", output, details });
      this.emit(sessionId, active, {
        type: "tool.completed",
        messageId: tool.messageId,
        callId,
        output,
        details,
        ...(tool.usage ? { usage: tool.usage } : {}),
        ...(tool.source ? { source: tool.source } : {}),
        isError: true,
      });
    }
    this.historyCache.delete(sessionId);
  }

  private async persistSubagentFileChanges(
    parent: SessionRecord,
    changes: SubagentFileChange[],
  ): Promise<void> {
    if (changes.length === 0) return;
    const journal = await openWordlessSession(parent.journalPath);
    for (const change of changes) {
      await (
        journal as unknown as {
          appendCustomEntry(
            customType: string,
            data?: unknown,
          ): Promise<string>;
        }
      ).appendCustomEntry(SUBAGENT_FILE_CHANGE_JOURNAL_TYPE, change);
    }
  }

  private async searchWorkspaceRoot(
    rootPath: string,
    query: string,
  ): Promise<WorkspaceFileEntry[]> {
    return (
      await this.options.workspaceSearch
        .forRoot(rootPath)
        .searchReferences(query, 50)
    ).map((entry) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      size: entry.size,
      mtimeMs: entry.modifiedAt,
    }));
  }

  private handleDriverEvent(
    sessionId: string,
    active: ActiveRun,
    event: AgentDriverEvent,
  ): void {
    if (event.type === "message.started")
      this.emit(sessionId, active, {
        type: "message.started",
        message: event.message,
      });
    if (event.type === "message.text.delta")
      this.emit(sessionId, active, event);
    if (event.type === "message.reasoning.delta")
      this.emit(sessionId, active, event);
    if (event.type === "message.completed")
      if (event.message.status === "error")
        active.runError = event.message.errorMessage ?? "Model response failed";
    if (event.type === "message.completed")
      this.emit(sessionId, active, {
        type: "message.completed",
        message: event.message,
      });
    if (event.type === "tool.started") {
      const configuredTimeout = event.input.timeout;
      active.tools.set(event.callId, {
        type: "tool",
        messageId: event.messageId,
        callId: event.callId,
        name: event.name,
        state: "running",
        startedAt: Date.now(),
        ...(event.name === "bash"
          ? {
              timeoutSeconds:
                typeof configuredTimeout === "number" ? configuredTimeout : 30,
            }
          : {}),
        input: event.input,
        ...(event.source ? { source: event.source } : {}),
      });
      this.historyCache.delete(sessionId);
      this.emit(sessionId, active, event);
    }
    if (event.type === "tool.updated") {
      const current = active.tools.get(event.callId);
      if (current) {
        active.tools.set(event.callId, {
          ...current,
          state: "running",
          output: `${current.output ?? ""}${event.output}`,
          ...(event.details !== undefined ? { details: event.details } : {}),
          ...(event.usage ? { usage: event.usage } : {}),
          ...(event.source ? { source: event.source } : {}),
        });
      }
      this.emit(sessionId, active, event);
    }
    if (event.type === "tool.completed") {
      const current = active.tools.get(event.callId);
      if (current) {
        active.tools.set(event.callId, {
          ...current,
          state: event.isError ? "error" : "complete",
          output: event.output,
          ...(event.details !== undefined ? { details: event.details } : {}),
          ...(event.usage ? { usage: event.usage } : {}),
          ...(event.source ? { source: event.source } : {}),
        });
      }
      this.invalidateSessionWorkspaceSearch(sessionId);
      this.historyCache.delete(sessionId);
      this.emit(sessionId, active, event);
      if (this.requireSession(sessionId).workbenchId === "conversation")
        void this.refreshSessionArtifacts(sessionId, active);
      const details = asRecord(event.details);
      const artifact = asRecord(details?.artifact);
      if (
        !event.isError &&
        typeof artifact?.id === "string" &&
        typeof artifact.revision === "number" &&
        (artifact.kind === "presentation" ||
          artifact.kind === "document" ||
          artifact.kind === "spreadsheet" ||
          artifact.kind === "browser")
      ) {
        const affectedLocators = Array.isArray(details?.affectedLocators)
          ? details.affectedLocators.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        this.emit(sessionId, active, {
          type: "artifact.changed",
          artifactId: artifact.id,
          kind: artifact.kind,
          revision: artifact.revision,
          affectedLocators,
        });
      }
    }
    if (event.type === "approval.requested") {
      this.historyCache.delete(sessionId);
      this.emit(sessionId, active, event);
    }
    if (event.type === "approval.resolved") {
      this.historyCache.delete(sessionId);
      this.emit(sessionId, active, event);
    }
    if (event.type === "user-request.requested")
      this.emit(sessionId, active, event);
    if (event.type === "user-request.resolved")
      this.emit(sessionId, active, event);
    if (event.type === "model.changed") this.emit(sessionId, active, event);
    if (event.type === "context.compaction.started") {
      active.isCompacting = true;
      active.compactionTrigger = event.trigger;
      this.emit(sessionId, active, event);
    }
    if (event.type === "context.compaction.completed") {
      active.isCompacting = false;
      active.compactionTrigger = undefined;
      this.emit(sessionId, active, event);
    }
    if (event.type === "context.compaction.failed") {
      active.isCompacting = false;
      active.compactionTrigger = undefined;
      this.emit(sessionId, active, event);
    }
    if (event.type === "extension.event") this.emit(sessionId, active, event);
  }

  private isAutomaticContextCompactionEnabled(): boolean {
    return (
      this.extensions.snapshot().configurations["wordless.context-compaction"]
        ?.enabled ?? false
    );
  }

  private getEntries(): WorkbenchEntryDefinition[] {
    return BUILTIN_ENTRIES.map((entry) => {
      if (entry.availability === "unavailable") return entry;
      if (!entry.profile) return entry;
      const profile = this.profiles.get(entry.profile);
      if (!profile || !this.drivers.get(profile.driverId))
        return { ...entry, availability: "unavailable" as const };
      return { ...entry, availability: "available" as const };
    });
  }

  private getEntry(id: string): WorkbenchEntryDefinition {
    const entry = this.getEntries().find((candidate) => candidate.id === id);
    if (!entry) throw new Error("Unknown work type");
    return entry;
  }

  private requireProfile(session: SessionRecord): ProfileDefinition {
    const profile = this.profiles.get(session.profile);
    if (!profile) throw new Error("The session profile is unavailable");
    return profile;
  }

  private resolveSessionModel(
    draft: SessionDraft,
    entry: WorkbenchEntryDefinition,
  ): ModelReference {
    const candidates = [
      draft.model,
      this.preferences.entryModels[entry.id],
      this.preferences.defaultModel,
    ];
    for (const candidate of candidates) {
      if (candidate && this.isAvailableSessionModel(candidate, entry))
        return candidate;
    }
    const fallback = this.firstAvailableSessionModel(entry);
    if (!fallback)
      throw new Error(
        "Configure and enable a compatible model before starting this task",
      );
    return fallback;
  }

  private requireCompatibleEnabledModel(
    reference: ModelReference,
    entry: WorkbenchEntryDefinition,
  ): ModelReference {
    const model = this.toLegacyEnabledModels(
      this.modelConfiguration.snapshot(),
    ).find(
      (candidate) =>
        candidate.connectionId === reference.connectionId &&
        candidate.modelId === reference.modelId,
    );
    if (!model?.enabled) throw new Error("The selected model is not enabled");
    if (!isCompatible(model, entry))
      throw new Error("The selected model does not support this work type");
    this.requireRuntimeModel(reference);
    return reference;
  }

  private requireRuntimeModel(reference: ModelReference): Model<Api> {
    const model = this.models.getModel(
      reference.connectionId,
      reference.modelId,
    );
    if (!model) throw new Error("The selected model is no longer available");
    return model;
  }

  private isAvailableSessionModel(
    reference: ModelReference,
    entry: WorkbenchEntryDefinition,
  ): boolean {
    const snapshot = this.modelConfiguration.snapshot();
    const provider = snapshot.providers.find(
      (candidate) =>
        candidate.kind === "chat" && candidate.id === reference.connectionId,
    );
    if (provider?.authStatus !== "configured") return false;
    const model = this.toLegacyEnabledModels(snapshot).find(
      (candidate) =>
        candidate.connectionId === reference.connectionId &&
        candidate.modelId === reference.modelId,
    );
    return (
      model !== undefined &&
      isCompatible(model, entry) &&
      this.models.getModel(reference.connectionId, reference.modelId) !==
        undefined
    );
  }

  private firstAvailableSessionModel(
    entry: WorkbenchEntryDefinition,
  ): ModelReference | undefined {
    const snapshot = this.modelConfiguration.snapshot();
    const configuredProviders = new Set(
      snapshot.providers
        .filter(
          (provider) =>
            provider.kind === "chat" && provider.authStatus === "configured",
        )
        .map((provider) => provider.id),
    );
    for (const model of this.toLegacyEnabledModels(snapshot)) {
      if (
        !configuredProviders.has(model.connectionId) ||
        !isCompatible(model, entry)
      )
        continue;
      if (!this.models.getModel(model.connectionId, model.modelId)) continue;
      return { connectionId: model.connectionId, modelId: model.modelId };
    }
    return undefined;
  }

  private async ensureSessionModelForOpen(
    sessionId: string,
  ): Promise<SessionRecord> {
    const session = this.requireSession(sessionId);
    if (this.runs.has(sessionId)) return session;
    const entry = this.getEntry(session.entryId);
    if (this.isAvailableSessionModel(session.model, entry)) return session;
    const model = this.firstAvailableSessionModel(entry);
    if (!model) return session;
    const journal = await openWordlessSession(session.journalPath);
    await journal.appendModelChange(model.connectionId, model.modelId);
    const previousModel = this.models.getModel(
      session.model.connectionId,
      session.model.modelId,
    );
    const nextRuntimeModel = this.requireRuntimeModel(model);
    const thinkingLevel = thinkingLevelForModel(
      nextRuntimeModel,
      previousModel?.reasoning ? session.thinkingLevel : "medium",
    );
    if (thinkingLevel !== session.thinkingLevel)
      await journal.appendThinkingLevelChange(thinkingLevel);
    const next = { ...session, model, thinkingLevel, updatedAt: Date.now() };
    this.database.upsertSession(next);
    this.historyCache.delete(sessionId);
    return next;
  }

  private async getCachedSessionHistory(
    sessionId: string,
  ): Promise<CachedSessionHistory> {
    const record = this.requireSession(sessionId);
    const details = await stat(record.journalPath);
    const revision = `${details.size}:${Math.round(details.mtimeMs)}`;
    const cached = this.historyCache.get(sessionId);
    if (cached?.revision === revision) {
      this.historyCache.delete(sessionId);
      this.historyCache.set(sessionId, cached);
      return cached;
    }
    const snapshot = await this.getSessionSnapshot(sessionId);
    const next: CachedSessionHistory = {
      projection: createSessionHistoryProjection(
        snapshot.messages,
        snapshot.contextCompactions,
      ),
      revision,
      snapshot,
      bytes: details.size * 2,
    };
    this.historyCache.delete(sessionId);
    this.historyCache.set(sessionId, next);
    while (
      this.historyCache.size > 5 ||
      [...this.historyCache.values()].reduce(
        (total, item) => total + item.bytes,
        0,
      ) >
        64 * 1024 * 1024
    ) {
      const oldest = this.historyCache.keys().next().value;
      if (!oldest) break;
      this.historyCache.delete(oldest);
    }
    return next;
  }

  private requireEnabledModel(reference: ModelReference): EnabledModelRecord {
    const model = this.toLegacyEnabledModels(
      this.modelConfiguration.snapshot(),
    ).find(
      (candidate) =>
        candidate.connectionId === reference.connectionId &&
        candidate.modelId === reference.modelId,
    );
    if (!model?.enabled) throw new Error("The selected model is not enabled");
    return model;
  }

  private assertInteractionModeAvailable(
    interactionMode: AgentInteractionModeId,
    driverId: string,
    model: ModelReference,
  ): void {
    if (interactionMode === "default") return;
    if (interactionMode === "clarify") {
      if (
        this.requireEnabledModel(model).capabilities.supportsToolUse === false
      ) {
        throw new Error(
          "Clarification mode requires a model that supports tool calling",
        );
      }
      return;
    }
    if (
      driverId !== "coding" ||
      !this.extensions.snapshot().configurations["wordless.plan-mode"]?.enabled
    ) {
      throw new Error("Plan mode is unavailable for this session");
    }
  }

  private async persistPlanModeState(
    session: SessionRecord,
    mode: "off" | "planning",
  ): Promise<void> {
    const journal = await openWordlessSession(session.journalPath);
    await (
      journal as unknown as {
        appendCustomEntry(customType: string, data?: unknown): Promise<string>;
      }
    ).appendCustomEntry(AGENT_EXTENSION_STATE_JOURNAL_TYPE, {
      extensionId: "wordless.plan-mode",
      state: { mode, plan: [] },
      updatedAt: Date.now(),
    });
  }

  private requireSession(id: string): SessionRecord {
    const session = this.database.getSession(id);
    if (!session) throw new Error("Session not found");
    return session;
  }

  private securityPolicy(): SecurityPolicySnapshot {
    const customFileRules = validCustomFileRules(
      this.preferences.security.customFileRules,
    );
    const customCommandRules = validCustomCommandRules(
      this.preferences.security.customCommandRules,
    );
    return {
      fileRules: resolveFileSecurityRules(customFileRules),
      commandRules: resolveCommandSecurityRules(customCommandRules),
    };
  }

  private resolveSelectedSkills(
    record: SessionRecord,
    skillIds: string[],
  ): ReturnType<SkillRegistry["getSessionSkills"]> {
    const profile = this.requireProfile(record);
    const expertSkillIds = this.sessionExpertSnapshot(record)?.skillIds ?? [];
    const selectedIds = [
      ...profile.skills.map((skill) => skill.id),
      ...expertSkillIds,
      ...skillIds,
    ];
    if (selectedIds.length === 0) return [];
    const available = new Map(
      this.skillRegistry
        .getSessionSkills(record.workspaceId)
        .map((skill) => [skill.id, skill]),
    );
    const selected = [] as ReturnType<SkillRegistry["getSessionSkills"]>;
    const seen = new Set<string>();
    for (const skillId of selectedIds) {
      const required = profile.skills.find((skill) => skill.id === skillId);
      const skill =
        required?.source === "built-in"
          ? (this.skillRegistry.getRequiredBuiltInSkill(skillId) ??
            available.get(skillId))
          : available.get(skillId);
      const identity = skill?.id ?? skillId;
      if (seen.has(identity)) continue;
      seen.add(identity);
      if (!skill)
        throw new Error(
          `Required or selected skill is unavailable: ${skillId}`,
        );
      selected.push(skill);
    }
    return selected;
  }

  private listMediaProjects(): MediaProjectSummary[] {
    return this.database
      .listMediaProjects()
      .map((project) => {
        const normalized = this.normalizeMediaProject(project);
        if (normalized !== project)
          this.database.upsertMediaProject(normalized);
        return normalized;
      })
      .map((project) => ({
        sessionId: project.sessionId,
        title: project.title,
        assetCount: project.assets.length,
        readyAssetCount: project.assets.filter(
          (asset) => asset.status === "ready",
        ).length,
        previewImageUrl:
          project.assets.find((asset) => asset.id === project.coverAssetId)
            ?.url ??
          project.assets.find((asset) => asset.status === "ready")?.url ??
          null,
        updatedAt: project.updatedAt,
      }));
  }

  private defaultMediaAgentModel(): ModelReference {
    const preferred = this.preferences.defaultModel;
    if (
      preferred &&
      this.toLegacyEnabledModels(this.modelConfiguration.snapshot()).some(
        (model) =>
          model.connectionId === preferred.connectionId &&
          model.modelId === preferred.modelId,
      )
    ) {
      return preferred;
    }
    const model = this.modelConfiguration
      .snapshot()
      .models.find(
        (candidate) => candidate.kind === "chat" && candidate.enabled,
      );
    return model
      ? { connectionId: model.providerId, modelId: model.modelId }
      : { connectionId: "media-agent", modelId: "unconfigured" };
  }

  private requireMediaAsset(
    project: MediaProject,
    assetId: string,
  ): MediaAsset {
    const asset = project.assets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new Error("Media asset not found");
    return asset;
  }

  private createAssetPosition(
    parent: MediaAsset | undefined,
    targetPosition: { x: number; y: number },
    outputTotal: number,
    outputIndex: number,
  ): Pick<MediaAsset, "x" | "y" | "width" | "height"> {
    const width = 300;
    const height = 210;
    const originX = parent ? parent.x + parent.width + 160 : targetPosition.x;
    const originY = parent
      ? parent.y + (parent.height - height) / 2
      : targetPosition.y;
    if (outputTotal <= 3)
      return {
        x: originX,
        y:
          originY +
          outputIndex * (height + 32) -
          ((outputTotal - 1) * (height + 32)) / 2,
        width,
        height,
      };
    const column = outputIndex % 2;
    const row = Math.floor(outputIndex / 2);
    return {
      x: originX + (outputTotal > 2 ? column * (width + 40) : 0),
      y:
        originY +
        (outputTotal === 1
          ? 0
          : row * (height + 32) -
            ((Math.ceil(outputTotal / 2) - 1) * (height + 32)) / 2),
      width,
      height,
    };
  }

  private mediaAssetsRoot(): string {
    return join(this.options.paths.dataRoot, "media-assets");
  }

  private normalizeMediaProject(project: MediaProject): MediaProject {
    const raw = project as unknown as { documentVersion?: unknown };
    if (raw.documentVersion === 2)
      return this.migrateMediaProjectV2(project as unknown as MediaProjectV2);
    if (raw.documentVersion !== 3)
      return this.migrateLegacyMediaProject(
        project as unknown as LegacyMediaProject,
      );
    let changed = false;
    const interruptedOperationIds = new Set(
      project.operations
        .filter(
          (operation) =>
            (operation.status === "rendering" ||
              operation.status === "partial") &&
            !this.mediaOperations.has(operation.id),
        )
        .map((operation) => operation.id),
    );
    const assets = project.assets.map((asset) => {
      if (
        asset.status === "rendering" &&
        interruptedOperationIds.has(asset.operationId)
      ) {
        changed = true;
        return {
          ...asset,
          status: "failed" as const,
          errorMessage: "Generation was interrupted when Wordless closed",
          updatedAt: Date.now(),
        };
      }
      if (!asset.url) return asset;
      const url = this.toMediaAssetUrl(asset.url);
      if (url !== asset.url) changed = true;
      return url === asset.url ? asset : { ...asset, url };
    });
    const operations = project.operations.map((operation) => {
      if (!interruptedOperationIds.has(operation.id)) return operation;
      changed = true;
      return {
        ...operation,
        status: "failed" as const,
        errorMessage: "Generation was interrupted when Wordless closed",
        updatedAt: Date.now(),
      };
    });
    return changed ? { ...project, assets, operations } : project;
  }

  private migrateMediaProjectV2(project: MediaProjectV2): MediaProject {
    const scenePositions = new Map(
      project.scenes.map((scene) => [scene.id, scene]),
    );
    const interruptedGenerationIds = new Set(
      project.generations
        .filter((generation) => generation.status === "rendering")
        .map((generation) => generation.id),
    );
    const assets = project.assets.map((asset): MediaAsset => {
      const scene = scenePositions.get(asset.sceneId);
      const url = asset.url ? this.toMediaAssetUrl(asset.url) : null;
      const interrupted = interruptedGenerationIds.has(asset.generationId);
      return {
        id: asset.id,
        operationId: asset.generationId,
        origin: "generated",
        kind: asset.kind,
        status: interrupted ? "failed" : asset.status,
        name: `Image ${String(asset.candidateIndex + 1).padStart(3, "0")}`,
        mimeType: url ? mimeTypeForMediaName(url) : "image/png",
        url,
        errorMessage: interrupted
          ? "Generation was interrupted when Wordless closed"
          : asset.errorMessage,
        pixelWidth: null,
        pixelHeight: null,
        x: (scene?.x ?? 0) + asset.x,
        y: (scene?.y ?? 0) + asset.y,
        width: asset.width,
        height: asset.height,
        outputIndex: asset.candidateIndex,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      };
    });
    const operations = project.generations.map(
      (generation): MediaOperation => ({
        id: generation.id,
        kind: generation.action === "upscale" ? "variation" : generation.action,
        inputs: generation.parentAssetIds.map((assetId, index) => ({
          assetId,
          role: index === 0 ? "parent" : "reference",
        })),
        outputAssetIds: project.assets
          .filter((asset) => asset.generationId === generation.id)
          .map((asset) => asset.id),
        prompt: generation.prompt,
        ratio: generation.ratio,
        outputCount: generation.outputCount,
        outputTotal: generation.outputTotal,
        providerId: generation.providerId,
        modelId: generation.modelId,
        parameters:
          generation.action === "upscale" ? { legacyAction: "upscale" } : {},
        status:
          generation.status === "rendering" ? "failed" : generation.status,
        errorMessage:
          generation.status === "rendering"
            ? "Generation was interrupted when Wordless closed"
            : generation.errorMessage,
        createdAt: generation.createdAt,
        updatedAt: generation.updatedAt,
      }),
    );
    return {
      documentVersion: 3,
      sessionId: project.sessionId,
      title: project.title,
      assets,
      operations,
      coverAssetId:
        project.scenes.find((scene) => scene.primaryAssetId)?.primaryAssetId ??
        assets.find((asset) => asset.status === "ready")?.id ??
        null,
      viewport: project.viewport,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private migrateLegacyMediaProject(project: LegacyMediaProject): MediaProject {
    const now = Date.now();
    const assets: MediaAsset[] = [];
    const operations: MediaOperation[] = [];
    let coverAssetId: string | null = null;
    for (const legacyScene of project.scenes) {
      const operationId = randomUUID();
      const sceneAssets = legacyScene.imageUrls.map(
        (url, candidateIndex): MediaAsset => {
          const position = this.createAssetPosition(
            undefined,
            { x: 64, y: 142 },
            legacyScene.imageUrls.length,
            candidateIndex,
          );
          const urlValue = this.toMediaAssetUrl(url);
          const name =
            basename(urlValue).split("?")[0] || `Image ${candidateIndex + 1}`;
          return {
            id: randomUUID(),
            operationId,
            origin: "generated",
            kind: legacyScene.kind,
            status: "ready",
            name,
            mimeType: mimeTypeForMediaName(name),
            url: urlValue,
            errorMessage: null,
            pixelWidth: null,
            pixelHeight: null,
            x: position.x + legacyScene.x,
            y: position.y + legacyScene.y,
            width: position.width,
            height: position.height,
            outputIndex: candidateIndex,
            createdAt: project.createdAt || now,
            updatedAt: project.updatedAt || now,
          };
        },
      );
      assets.push(...sceneAssets);
      if (!coverAssetId && sceneAssets[0]) coverAssetId = sceneAssets[0].id;
      if (legacyScene.prompt || sceneAssets.length > 0) {
        operations.push({
          id: operationId,
          kind: "generate",
          inputs: [],
          outputAssetIds: sceneAssets.map((asset) => asset.id),
          prompt: legacyScene.prompt || "Generated image",
          ratio: legacyScene.ratio || "16:9",
          outputCount: sceneAssets.length,
          outputTotal: Math.max(
            legacyScene.outputTotal || 1,
            sceneAssets.length,
          ),
          providerId: legacyScene.providerId,
          modelId: legacyScene.modelId,
          parameters: {},
          status:
            legacyScene.status === "failed" ||
            legacyScene.status === "rendering"
              ? "failed"
              : "ready",
          errorMessage:
            legacyScene.status === "rendering"
              ? "Generation was interrupted when Wordless closed"
              : legacyScene.errorMessage,
          createdAt: project.createdAt || now,
          updatedAt: project.updatedAt || now,
        });
      }
    }
    return {
      documentVersion: 3,
      sessionId: project.sessionId,
      title: project.title,
      assets,
      operations,
      coverAssetId,
      viewport: project.viewport,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private toMediaAssetUrl(value: string): string {
    if (!value.startsWith("file:")) return value;
    try {
      const absolutePath = fileURLToPath(value);
      const assetPath = relative(this.mediaAssetsRoot(), absolutePath);
      const parts = assetPath.split(/[/\\]+/);
      const [projectId, fileName] = parts;
      if (
        parts.length !== 2 ||
        !projectId ||
        !fileName ||
        !/^[a-f0-9-]{36}$/i.test(projectId) ||
        !/^[a-f0-9]{64}\.(gif|jpe?g|png|webp)$/i.test(fileName)
      )
        return value;
      return `wordless-media://asset/${encodeURIComponent(projectId)}/${encodeURIComponent(fileName)}`;
    } catch {
      return value;
    }
  }

  private async writeMediaImageAsset(
    sessionId: string,
    mimeType: string,
    data: string,
  ): Promise<string> {
    const extension = extensionForMediaMimeType(mimeType);
    const digest = createHash("sha256").update(data).digest("hex");
    const directory = join(this.mediaAssetsRoot(), sessionId);
    const path = join(directory, `${digest}.${extension}`);
    await mkdir(directory, { recursive: true });
    await writeFile(path, Buffer.from(data, "base64"));
    return `wordless-media://asset/${encodeURIComponent(sessionId)}/${encodeURIComponent(`${digest}.${extension}`)}`;
  }

  private async writeMediaFileAsset(
    sessionId: string,
    sourcePath: string,
  ): Promise<{ url: string; mimeType: string; name: string }> {
    const extension = extname(sourcePath).toLowerCase();
    if (
      extension !== ".png" &&
      extension !== ".jpg" &&
      extension !== ".jpeg" &&
      extension !== ".webp"
    )
      throw new Error(`Unsupported image type: ${extension || "unknown"}`);
    const mimeType = mimeTypeForMediaName(sourcePath);
    const metadata = await stat(sourcePath);
    if (!metadata.isFile())
      throw new Error("The selected media source is not a file");
    if (metadata.size > 50 * 1024 * 1024)
      throw new Error("Images must be 50 MB or smaller");
    const data = (await readFile(sourcePath)).toString("base64");
    return {
      url: await this.writeMediaImageAsset(sessionId, mimeType, data),
      mimeType,
      name: basename(sourcePath),
    };
  }

  private async readMediaAssetInput(
    sessionId: string,
    asset: MediaAsset,
  ): Promise<ImageContent> {
    if (!asset.url) throw new Error("The source image is not available yet");
    const parsed = new URL(asset.url);
    const parts = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    const [assetSessionId, fileName] = parts;
    if (
      parsed.protocol !== "wordless-media:" ||
      parsed.hostname !== "asset" ||
      assetSessionId !== sessionId ||
      !fileName ||
      !/^[a-f0-9]{64}\.(gif|jpe?g|png|webp)$/i.test(fileName)
    ) {
      throw new Error("The source image is not a Wordless media asset");
    }
    const mimeType =
      fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")
        ? "image/jpeg"
        : fileName.endsWith(".webp")
          ? "image/webp"
          : fileName.endsWith(".gif")
            ? "image/gif"
            : "image/png";
    return {
      type: "image",
      mimeType,
      data: (
        await readFile(join(this.mediaAssetsRoot(), sessionId, fileName))
      ).toString("base64"),
    };
  }

  private isInternalSessionRoot(rootPath: string): boolean {
    const relativePath = relative(
      this.options.paths.sessionWorkspacesRoot,
      rootPath,
    );
    return (
      relativePath.length > 0 &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath)
    );
  }

  private requireWorkspace(id: string): WorkspaceRecord {
    const workspace = this.database
      .listWorkspaces()
      .find((candidate) => candidate.id === id);
    if (!workspace) throw new Error("Workspace not found");
    return workspace;
  }

  private async resolveAvailableWorkspace(
    id: string,
  ): Promise<WorkspaceRecord> {
    const workspace = this.requireWorkspace(id);
    let available = false;
    try {
      available = (await stat(workspace.canonicalRootPath)).isDirectory();
    } catch {
      available = false;
    }
    const availability = available
      ? ("available" as const)
      : ("missing" as const);
    const current =
      workspace.availability === availability
        ? workspace
        : { ...workspace, availability, updatedAt: Date.now() };
    if (current !== workspace) {
      this.database.upsertWorkspace(current);
      await this.skillRegistry.refresh(this.database.listWorkspaces());
    }
    if (!available)
      throw new Error(
        "The selected workspace is unavailable. Select an available folder and try again.",
      );
    return current;
  }

  private requireWorkspaceSession(sessionId: string): SessionRecord {
    const record = this.requireSession(sessionId);
    if (!record.workspaceId)
      throw new Error("This session does not have a workspace");
    const workspace = this.requireWorkspace(record.workspaceId);
    if (workspace.availability !== "available")
      throw new Error("The selected workspace is unavailable");
    return record;
  }

  private workspaceReadFailure(
    cause: unknown,
  ): "binary" | "missing" | "too-large" {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes("too large")) return "too-large";
    if (message.includes("UTF-8 text")) return "binary";
    return "missing";
  }

  private toLegacyConnections(
    snapshot: ModelConfigurationSnapshot,
  ): ProviderConnectionRecord[] {
    const now = Date.now();
    return snapshot.providers
      .filter((provider) => provider.kind === "chat")
      .map((provider) => ({
        id: provider.id,
        kind:
          provider.source === "custom"
            ? ("openai-compatible" as const)
            : ("builtin" as const),
        providerId: provider.id,
        avatarId: provider.avatarId,
        displayName: provider.displayName,
        baseUrl: provider.baseUrl,
        api: null,
        authStatus:
          provider.configuration &&
          typeof provider.configuration.apiKey === "string"
            ? ("configured" as const)
            : provider.authStatus,
        createdAt: now,
        updatedAt: now,
      }));
  }

  private toLegacyEnabledModels(
    snapshot: ModelConfigurationSnapshot,
  ): EnabledModelRecord[] {
    return snapshot.models
      .filter((model) => model.kind === "chat" && model.enabled)
      .map((model) => ({
        connectionId: model.providerId,
        modelId: model.modelId,
        displayName: model.displayName,
        capabilities: {
          supportsText: true,
          supportsVision: model.supportsVision,
          supportsToolUse: "unknown",
          supportsReasoning: model.supportsReasoning,
          supportedThinkingLevels: model.supportedThinkingLevels,
          contextWindow: model.contextWindow ?? 128000,
          maxOutputTokens: 16384,
        },
        enabled: model.enabled,
        updatedAt: Date.now(),
      }));
  }

  private emitConfigurationChanged(): void {
    this.emitApp({ type: "model-configuration.changed" });
  }

  private removeProviderModelPreferences(providerId: string): void {
    const defaultModel =
      this.preferences.defaultModel?.connectionId === providerId
        ? null
        : this.preferences.defaultModel;
    const entryModels = Object.fromEntries(
      Object.entries(this.preferences.entryModels).filter(
        ([, model]) => model.connectionId !== providerId,
      ),
    );
    if (
      defaultModel === this.preferences.defaultModel &&
      Object.keys(entryModels).length ===
        Object.keys(this.preferences.entryModels).length
    )
      return;
    this.preferences = { ...this.preferences, defaultModel, entryModels };
    this.database.savePreferences(this.preferences);
  }

  private rememberEntryModel(entryId: string, model: ModelReference): void {
    this.preferences = {
      ...this.preferences,
      entryModels: { ...this.preferences.entryModels, [entryId]: model },
    };
    this.database.savePreferences(this.preferences);
  }

  private toConversationMessage(
    message: unknown,
    model: ModelReference,
    id: string,
  ): ConversationMessage | undefined {
    const value = asRecord(message);
    if (!value || (value.role !== "user" && value.role !== "assistant"))
      return undefined;
    const blocks: MessageBlock[] = [];
    if (value.role === "user") {
      blocks.push(...projectUserMessageContent(value.content));
    } else if (typeof value.content === "string") {
      blocks.push({ type: "text", text: value.content });
    } else if (Array.isArray(value.content)) {
      for (const item of value.content) {
        const block = asRecord(item);
        if (!block) continue;
        if (block.type === "text" && typeof block.text === "string")
          blocks.push({ type: "text", text: block.text });
        if (block.type === "thinking" && typeof block.thinking === "string")
          blocks.push({ type: "reasoning", text: block.thinking });
        if (
          block.type === "toolCall" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
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
    const interrupted =
      value.stopReason === "error" || value.stopReason === "aborted";
    const normalizedBlocks = interrupted
      ? blocks.map((block) =>
          block.type === "tool" && block.state === "pending"
            ? {
                ...block,
                state: "error" as const,
                output:
                  typeof value.errorMessage === "string"
                    ? value.errorMessage
                    : "The agent run ended before the tool completed.",
                details: terminalizeToolDetails(
                  block.details,
                  typeof value.errorMessage === "string"
                    ? value.errorMessage
                    : "The agent run ended before the tool completed.",
                ),
              }
            : block,
        )
      : blocks;
    return {
      id,
      role: value.role,
      status:
        value.stopReason === "error"
          ? "error"
          : value.stopReason === "aborted"
            ? "aborted"
            : "complete",
      blocks: normalizedBlocks,
      model: value.role === "assistant" ? model : null,
      timestamp:
        typeof value.timestamp === "number" ? value.timestamp : Date.now(),
      usage:
        value.role === "assistant"
          ? toConversationUsage(value.usage)
          : undefined,
      errorMessage:
        typeof value.errorMessage === "string" ? value.errorMessage : undefined,
    };
  }

  private applyApproval(
    messages: ConversationMessage[],
    location: { messageIndex: number; blockIndex: number } | undefined,
    persisted: PersistedOperationApproval,
    isRunning: boolean,
  ): void {
    if (!location) return;
    const message = messages[location.messageIndex];
    if (!message) return;
    const block = message.blocks[location.blockIndex];
    if (!block || block.type !== "tool") return;
    const approval = persisted.resolution
      ? {
          ...persisted.approval,
          status: persisted.resolution.approved
            ? ("approved" as const)
            : ("rejected" as const),
          feedback: persisted.resolution.feedback,
        }
      : { ...persisted.approval, status: "required" as const };
    const blocks = [...message.blocks];
    blocks[location.blockIndex] = persisted.resolution
      ? persisted.resolution.approved
        ? isRunning
          ? { ...block, state: "running", approval }
          : {
              ...block,
              state: "error",
              approval,
              output:
                "The operation was interrupted before the approved tool could finish. Start a new turn to retry it.",
            }
        : {
            ...block,
            state: "error",
            approval,
            output:
              persisted.resolution.feedback ?? "Operation rejected by the user",
          }
      : isRunning
        ? { ...block, state: "awaiting-approval", approval }
        : {
            ...block,
            state: "error",
            approval,
            output:
              "The operation was interrupted before approval could be resolved. Start a new turn to retry it.",
          };
    messages[location.messageIndex] = { ...message, blocks };
  }

  private applyUserRequest(
    messages: ConversationMessage[],
    location: { messageIndex: number; blockIndex: number } | undefined,
    persisted: PersistedUserRequest,
    isRunning: boolean,
  ): void {
    if (!location) return;
    const message = messages[location.messageIndex];
    if (!message) return;
    const block = message.blocks[location.blockIndex];
    if (!block || block.type !== "tool") return;
    const resolution =
      persisted.resolution ??
      (isRunning
        ? undefined
        : {
            requestId: persisted.request.requestId,
            status: "cancelled" as const,
            feedback:
              "The request was interrupted before a response was submitted",
          });
    const blocks = [...message.blocks];
    blocks[location.blockIndex] = {
      ...block,
      state: resolution ? "complete" : "awaiting-user-input",
      userRequest: { request: persisted.request, resolution },
    };
    messages[location.messageIndex] = { ...message, blocks };
  }

  private applyClarificationAnswer(
    messages: ConversationMessage[],
    location: { messageIndex: number; blockIndex: number } | undefined,
    answer: PersistedClarificationAnswer,
  ): void {
    if (!location) return;
    const message = messages[location.messageIndex];
    if (!message) return;
    const block = message.blocks[location.blockIndex];
    if (!block || block.type !== "tool") return;
    const question = clarificationQuestionFromDetails(block.details);
    if (!question) return;
    const blocks = [...message.blocks];
    blocks[location.blockIndex] = {
      ...block,
      details: {
        ...(asRecord(block.details) ?? {}),
        clarificationQuestion: question,
        clarificationAnswer: answer,
      },
    };
    messages[location.messageIndex] = { ...message, blocks };
  }

  private applyToolResult(
    messages: ConversationMessage[],
    location: { messageIndex: number; blockIndex: number } | undefined,
    result: Record<string, unknown>,
    persisted?: PersistedOperationApproval,
    persistedUserRequest?: PersistedUserRequest,
  ): void {
    if (!location) return;
    const message = messages[location.messageIndex];
    if (!message) return;
    const block = message.blocks[location.blockIndex];
    if (!block || block.type !== "tool") return;
    const blocks = [...message.blocks];
    const output = contentToText(result.content);
    const persistedResult = persistedToolDetails(result.details);
    const detailsRecord = asRecord(persistedResult.details);
    const details = result.isError
      ? terminalizeToolDetails(
          persistedResult.details,
          output || "Tool execution failed",
        )
      : persistedResult.details;
    const usage = conversationUsageFromUnknown(detailsRecord?.usage);
    const approval = persisted?.resolution
      ? {
          ...persisted.approval,
          status: persisted.resolution.approved
            ? ("approved" as const)
            : ("rejected" as const),
          feedback: persisted.resolution.feedback,
        }
      : persisted
        ? { ...persisted.approval, status: "required" as const }
        : block.approval;
    const next: MessageToolBlock = {
      ...block,
      state: result.isError === true ? "error" : "complete",
      output,
      details,
      source: persistedResult.source ?? block.source,
      ...(usage ? { usage } : block.usage ? { usage: block.usage } : {}),
      approval,
      userRequest: persistedUserRequest
        ? {
            request: persistedUserRequest.request,
            resolution: persistedUserRequest.resolution,
          }
        : block.userRequest,
    };
    blocks[location.blockIndex] = next;
    messages[location.messageIndex] = { ...message, blocks };
  }

  private emit(
    sessionId: string,
    active: ActiveRun,
    event: RuntimeEvent,
  ): void {
    const envelope: RuntimeEventEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      runtimeInstanceId: this.runtimeInstanceId,
      eventId: randomUUID(),
      sessionId,
      runId: active.runId,
      ...(active.userMessageId
        ? { turnId: `turn:${active.userMessageId}` }
        : {}),
      sequence: ++active.sequence,
      timestamp: Date.now(),
      event,
    };
    for (const listener of this.listeners) listener(envelope);
    if (active.taskId || active.userMessageId) {
      const task = active.taskId
        ? this.database.getTask(active.taskId)
        : this.database
            .listTasks()
            .find(
              (candidate) =>
                candidate.execution.messageId === active.userMessageId,
            );
      if (task) {
        const status =
          event.type === "run.started"
            ? "running"
            : event.type === "approval.requested" ||
                event.type === "user-request.requested"
              ? "waiting"
              : event.type === "run.completed"
                ? "completed"
                : event.type === "run.failed"
                  ? "failed"
                  : event.type === "run.cancelled"
                    ? "cancelled"
                    : null;
        if (status) {
          const terminal =
            status === "completed" ||
            status === "failed" ||
            status === "cancelled";
          const next: TaskRecord = {
            ...task,
            sessionId,
            execution: {
              ...task.execution,
              status,
              sessionId,
              runId: active.runId,
              completedAt: terminal ? Date.now() : null,
              error:
                event.type === "run.failed"
                  ? event.message
                  : terminal
                    ? null
                    : task.execution.error,
            },
            updatedAt: Date.now(),
          };
          this.database.upsertTask(next);
          this.emitApp({ type: "task.changed", id: task.id });
        }
      }
    }
  }

  private emitExpertMemberEvent(
    sessionId: string,
    event: ExpertMemberStreamEvent,
  ): void {
    const active = this.runs.get(sessionId);
    if (!active) return;
    if (event.type === "message.started") {
      this.emit(sessionId, active, {
        type: "expert-member.message.started",
        memberId: event.memberId,
        taskId: event.taskId,
        message: event.message,
        revision: event.revision,
      });
      return;
    }
    if (event.type === "message.text.delta") {
      this.emit(sessionId, active, {
        type: "expert-member.message.text.delta",
        memberId: event.memberId,
        taskId: event.taskId,
        messageId: event.messageId,
        delta: event.delta,
        revision: event.revision,
      });
      return;
    }
    if (event.type === "message.reasoning.delta") {
      this.emit(sessionId, active, {
        type: "expert-member.message.reasoning.delta",
        memberId: event.memberId,
        taskId: event.taskId,
        messageId: event.messageId,
        delta: event.delta,
        revision: event.revision,
      });
      return;
    }
    if (event.type === "message.completed") {
      this.emit(sessionId, active, {
        type: "expert-member.message.completed",
        memberId: event.memberId,
        taskId: event.taskId,
        message: event.message,
        revision: event.revision,
      });
      return;
    }
    if (event.type === "tool.started") {
      this.emit(sessionId, active, {
        ...event,
        type: "expert-member.tool.started",
      });
      return;
    }
    if (event.type === "tool.updated") {
      this.emit(sessionId, active, {
        ...event,
        type: "expert-member.tool.updated",
      });
      return;
    }
    if (event.type === "tool.completed") {
      this.emit(sessionId, active, {
        ...event,
        type: "expert-member.tool.completed",
      });
      return;
    }
    if (event.type === "approval.requested") {
      this.emit(sessionId, active, {
        ...event,
        type: "expert-member.approval.requested",
      });
      return;
    }
    this.emit(sessionId, active, {
      ...event,
      type: "expert-member.approval.resolved",
    });
  }

  private emitApp(event: RuntimeEvent): void {
    const envelope: RuntimeEventEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      runtimeInstanceId: this.runtimeInstanceId,
      eventId: randomUUID(),
      sessionId: null,
      sequence: ++this.appSequence,
      timestamp: Date.now(),
      event,
    };
    for (const listener of this.listeners) listener(envelope);
  }

  private async refreshWorkspaceAvailability(): Promise<void> {
    for (const workspace of this.database.listWorkspaces()) {
      let available = true;
      try {
        await access(workspace.rootPath);
      } catch {
        available = false;
      }
      if ((available ? "available" : "missing") !== workspace.availability) {
        this.database.upsertWorkspace({
          ...workspace,
          availability: available ? "available" : "missing",
          updatedAt: Date.now(),
        });
      }
    }
  }
}
