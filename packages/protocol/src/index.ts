import { Type, type Static } from "typebox";
import type { AgentExtensionEvent, AgentExtensionSessionState, AgentExtensionSnapshot } from "@wordless/agent-extension-sdk";
import type {
  AppPreferences,
  ContextCompactionRecord,
  ConversationMessage,
  ConversationUsage,
  EnabledModelRecord,
  ModelConfigurationSnapshot,
  MediaLayoutUpdate,
  MediaOperationRequest,
  MediaProject,
  MediaProjectSummary,
  ModelReference,
  ProviderConnectionRecord,
  SessionDraft,
  SessionContextUsage,
  SessionTurnUsage,
  SessionRecord,
  SecurityPolicySnapshot,
  SkillCatalogSnapshot,
  ToolOperationApproval,
  UserPromptPart,
  UserRequest,
  UserRequestResolution,
  UsageReport,
  WorkbenchEntryDefinition,
  WorkspaceRecord,
  ConnectorCatalogSnapshot,
  ToolApprovalMode,
} from "@wordless/domain";

export type { ConversationMessage } from "@wordless/domain";

export const PROTOCOL_VERSION = 1;

export const DesktopHostInfoSchema = Type.Object({
  platform: Type.Union([Type.Literal("darwin"), Type.Literal("win32"), Type.Literal("linux")]),
  arch: Type.Union([Type.Literal("arm64"), Type.Literal("x64"), Type.Literal("ia32")]),
  windowChrome: Type.Union([Type.Literal("mac-hidden-inset"), Type.Literal("overlay"), Type.Literal("framed")]),
  menuPresentation: Type.Union([Type.Literal("system"), Type.Literal("in-window")]),
  modifier: Type.Union([Type.Literal("meta"), Type.Literal("control")]),
  shellFamily: Type.Union([Type.Literal("zsh"), Type.Literal("bash"), Type.Literal("powershell"), Type.Literal("sh")]),
  capabilities: Type.Object({
    dockBadge: Type.Boolean(),
    nativeNotifications: Type.Boolean(),
    titleBarOverlay: Type.Boolean(),
  }),
});

export type DesktopHostInfo = Static<typeof DesktopHostInfoSchema>;

export type DesktopMenuId = "file" | "edit" | "window" | "help";

export type DesktopCommand = "new-thread" | "open-settings" | "search" | "show-about";

export type DesktopHostEvent =
  | { type: "command"; command: DesktopCommand }
  | { type: "deep-link"; url: string }
  | { type: "update"; state: "available" | "downloading" | "ready" | "error"; version?: string; progress?: number; message?: string };

export type DesktopUpdateState = Extract<DesktopHostEvent, { type: "update" }>;

export interface ProtocolFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export type ProtocolResult<T> = { ok: true; value: T } | { ok: false; error: ProtocolFailure };

export const ModelReferenceSchema = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
});

export const SessionAccessLevelSchema = Type.Union([Type.Literal("default"), Type.Literal("full")]);

export const AgentInteractionModeSchema = Type.Union([
  Type.Literal("default"),
  Type.Literal("clarify"),
  Type.Literal("plan"),
]);

export const ToolApprovalModeSchema = Type.Union([Type.Literal("manual"), Type.Literal("auto"), Type.Literal("bypass")]);

const SkillSourceSchema = Type.Union([
  Type.Literal("wordless"),
  Type.Literal("pi"),
  Type.Literal("agents"),
  Type.Literal("claude"),
  Type.Literal("codex"),
  Type.Literal("workspace-pi"),
  Type.Literal("workspace-claude"),
  Type.Literal("workspace-codex"),
]);

export const UserPromptPartSchema = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String({ maxLength: 100_000 }) }),
  Type.Object({
    type: Type.Literal("skill-reference"),
    skillId: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    source: SkillSourceSchema,
  }),
  Type.Object({
    type: Type.Literal("workspace-reference"),
    path: Type.String({ minLength: 1, maxLength: 1024 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    kind: Type.Union([Type.Literal("file"), Type.Literal("directory")]),
  }),
  Type.Object({
    type: Type.Literal("artifact-reference"),
    artifactId: Type.String({ minLength: 1, maxLength: 128 }),
    kind: Type.Union([Type.Literal("presentation"), Type.Literal("document"), Type.Literal("spreadsheet"), Type.Literal("browser")]),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    revision: Type.Integer({ minimum: 1 }),
    surfaceId: Type.String({ minLength: 1, maxLength: 512 }),
    locator: Type.String({ minLength: 1, maxLength: 2_048 }),
    locators: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2_048 }), { minItems: 1, maxItems: 10_000 })),
    intent: Type.Optional(Type.Union([Type.Literal("reference"), Type.Literal("analyze"), Type.Literal("formula"), Type.Literal("chart"), Type.Literal("pivot")])),
  }),
]);

export const UserPromptPartsSchema = Type.Array(UserPromptPartSchema, { minItems: 1, maxItems: 1_024 });
export type ProtocolUserPromptPart = Static<typeof UserPromptPartSchema> & UserPromptPart;

export const UserMessageSubmissionSchema = Type.Object({
  messageId: Type.String({ minLength: 1, maxLength: 128 }),
  submittedAt: Type.Number({ minimum: 0 }),
});

export const SessionDraftSchema = Type.Object({
  mode: Type.Union([Type.Literal("everyday"), Type.Literal("code"), Type.Literal("create")]),
  entryId: Type.String({ minLength: 1 }),
  workspaceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  accessLevel: SessionAccessLevelSchema,
  model: Type.Union([ModelReferenceSchema, Type.Null()]),
  connectorIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 })),
  interactionMode: Type.Optional(AgentInteractionModeSchema),
  toolApprovalMode: Type.Optional(ToolApprovalModeSchema),
  presentation: Type.Optional(Type.Object({
    generationMode: Type.Union([Type.Literal("guided"), Type.Literal("quick")]),
    templateId: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  })),
});

export const CreateWorkspaceSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 96 }),
});

export const OpenWorkspaceSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
});

export const CreateAndPromptSchema = Type.Object({
  draft: SessionDraftSchema,
  parts: UserPromptPartsSchema,
  submission: UserMessageSubmissionSchema,
});

export const PromptSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  parts: UserPromptPartsSchema,
  submission: UserMessageSubmissionSchema,
});

export const WorkspaceReferenceSearchSchema = Type.Object({
  workspaceId: Type.String({ minLength: 1 }),
  query: Type.String({ maxLength: 256 }),
});

export const SessionWorkspaceReferenceSearchSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  query: Type.String({ maxLength: 256 }),
});

export const WorkspaceDeleteSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const SetSkillEnabledSchema = Type.Object({
  skillId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const RemoveManagedSkillSchema = Type.Object({
  skillId: Type.String({ minLength: 1 }),
});

export const ImportSkillFileSchema = Type.Object({
  sourcePath: Type.String({ minLength: 1, maxLength: 4_096 }),
});

export const ConnectorConfigurationSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  templateId: Type.Union([Type.Literal("feishu"), Type.Literal("dingtalk"), Type.Literal("wecom"), Type.Literal("postgresql"), Type.Literal("web-search"), Type.Null()]),
  transport: Type.Union([Type.Literal("stdio"), Type.Literal("streamable-http")]),
  enabled: Type.Boolean(),
  trustedAt: Type.Union([Type.Number(), Type.Null()]),
  command: Type.Union([Type.String(), Type.Null()]),
  args: Type.Array(Type.String()),
  cwd: Type.Union([Type.String(), Type.Null()]),
  environment: Type.Record(Type.String(), Type.String()),
  url: Type.Union([Type.String(), Type.Null()]),
  headers: Type.Array(Type.Object({ name: Type.String(), value: Type.String() })),
  oauth: Type.Union([Type.Object({ clientId: Type.Optional(Type.String()), clientSecret: Type.Optional(Type.String()), scope: Type.Optional(Type.String()), accessToken: Type.Optional(Type.String()), refreshToken: Type.Optional(Type.String()), expiresAt: Type.Optional(Type.Number()) }), Type.Null()]),
});

export const ConnectorIdSchema = Type.Object({ connectorId: Type.String({ minLength: 1 }) });

export const SetConnectorEnabledSchema = Type.Object({ connectorId: Type.String({ minLength: 1 }), enabled: Type.Boolean() });

export const SetSessionConnectorsSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), connectorIds: Type.Array(Type.String({ minLength: 1 })) });

export const ConnectorPromptSchema = Type.Object({ connectorId: Type.String({ minLength: 1 }), name: Type.String({ minLength: 1 }), arguments: Type.Record(Type.String(), Type.String()) });

export const CompactSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

export const SessionHistoryPageRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  after: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  before: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  aroundTurnId: Type.Optional(Type.String({ minLength: 1 })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 48 })),
});

export const SessionMessageSearchRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  query: Type.String({ minLength: 1, maxLength: 500 }),
  role: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("assistant")])),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});

export const SessionToolOutputRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  callId: Type.String({ minLength: 1 }),
});

export const WorkspaceFileRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const ListWorkspaceDirectorySchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  path: Type.String({ maxLength: 1024 }),
});

export const ResolveOperationApprovalSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  approvalId: Type.String({ minLength: 1 }),
  approved: Type.Boolean(),
  feedback: Type.Optional(Type.String({ maxLength: 4_000 })),
});

export const SetSessionToolApprovalModeSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  mode: ToolApprovalModeSchema,
});

export const ResolveUserRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
  status: Type.Union([Type.Literal("submitted"), Type.Literal("cancelled")]),
  answers: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Union([Type.String({ maxLength: 4_000 }), Type.Array(Type.String({ maxLength: 4_000 }), { maxItems: 32 }), Type.Boolean()]))),
  feedback: Type.Optional(Type.String({ maxLength: 4_000 })),
});

export const RenameSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
});

export const SetSessionPinnedSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  pinned: Type.Boolean(),
});

export const DeleteSessionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

export const SetSessionModelSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  model: ModelReferenceSchema,
});

export const SetSessionAccessSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  accessLevel: SessionAccessLevelSchema,
});

export const SetSessionInteractionModeSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  interactionMode: AgentInteractionModeSchema,
});

export const ResolveClarificationQuestionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  callId: Type.String({ minLength: 1 }),
  value: Type.Union([Type.String({ maxLength: 8_000 }), Type.Boolean()]),
});

export const HandoffClarificationSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  interactionMode: Type.Union([Type.Literal("default"), Type.Literal("clarify"), Type.Literal("plan")]),
});

export const SetPreferenceSchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  value: Type.Unknown(),
});

export const UsageReportQuerySchema = Type.Object({
  startAt: Type.Number({ minimum: 0 }),
  endAt: Type.Number({ minimum: 0 }),
  groupBy: Type.Union([Type.Literal("provider"), Type.Literal("model")]),
});

export const ImportAppearanceBackgroundSchema = Type.Object({
  sourcePath: Type.String({ minLength: 1, maxLength: 4_096 }),
});

export const RemoveAppearanceBackgroundSchema = Type.Object({
  assetId: Type.String({ minLength: 1, maxLength: 96 }),
});

export const SetExtensionEnabledSchema = Type.Object({
  extensionId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const UpdateExtensionSettingsSchema = Type.Object({
  extensionId: Type.String({ minLength: 1 }),
  settings: Type.Object({}, { additionalProperties: true }),
});

export const SessionExtensionInteractionSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  extensionId: Type.String({ minLength: 1 }),
  action: Type.String({ minLength: 1 }),
  payload: Type.Optional(Type.Unknown()),
});

export const SetSessionExtensionStateSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
  extensionId: Type.String({ minLength: 1 }),
  state: Type.Object({}, { additionalProperties: true }),
});

export const SaveCustomProviderSchema = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 96 }),
  baseUrl: Type.String({ minLength: 1 }),
  api: Type.Union([Type.Literal("openai-completions"), Type.Literal("openai-responses")]),
  modelId: Type.String({ minLength: 1 }),
  modelName: Type.String({ minLength: 1 }),
  apiKey: Type.Optional(Type.String()),
});

export const SetEnabledModelSchema = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const SaveBuiltinCredentialSchema = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  apiKey: Type.String({ minLength: 1 }),
});

export const SaveProviderConfigurationSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("image")]),
  providerId: Type.String({ minLength: 1 }),
  configuration: Type.Object({}, { additionalProperties: true }),
});

export const SetConfiguredModelEnabledSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("image")]),
  providerId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  enabled: Type.Boolean(),
});

export const DeleteCustomProviderSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("image")]),
  providerId: Type.String({ minLength: 1 }),
});

export const MediaAssetSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  operationId: Type.String({ minLength: 1 }),
  origin: Type.Union([Type.Literal("uploaded"), Type.Literal("generated")]),
  kind: Type.Union([Type.Literal("image"), Type.Literal("video")]),
  status: Type.Union([Type.Literal("rendering"), Type.Literal("ready"), Type.Literal("failed")]),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  mimeType: Type.String({ minLength: 1, maxLength: 128 }),
  url: Type.Union([Type.String({ minLength: 1, maxLength: 16_384 }), Type.Null()]),
  errorMessage: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
  pixelWidth: Type.Union([Type.Number({ minimum: 1, maximum: 32_768 }), Type.Null()]),
  pixelHeight: Type.Union([Type.Number({ minimum: 1, maximum: 32_768 }), Type.Null()]),
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 160, maximum: 720 }),
  height: Type.Number({ minimum: 120, maximum: 720 }),
  outputIndex: Type.Number({ minimum: 0, maximum: 15 }),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
});

const MediaOperationKindSchema = Type.Union([
  Type.Literal("upload"), Type.Literal("generate"), Type.Literal("regenerate"), Type.Literal("variation"), Type.Literal("crop"),
  Type.Literal("local-edit"), Type.Literal("remove-background"), Type.Literal("remove-object"), Type.Literal("multi-view"),
]);

const ConversationUsageSchema = Type.Object({
  inputTokens: Type.Number({ minimum: 0 }),
  outputTokens: Type.Number({ minimum: 0 }),
  cacheReadTokens: Type.Number({ minimum: 0 }),
  cacheWriteTokens: Type.Number({ minimum: 0 }),
  totalTokens: Type.Number({ minimum: 0 }),
  totalCost: Type.Number({ minimum: 0 }),
});

const MediaUsageEventSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  timestamp: Type.Number({ minimum: 0 }),
  usage: Type.Optional(ConversationUsageSchema),
});

export const MediaOperationSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: MediaOperationKindSchema,
  inputs: Type.Array(Type.Object({ assetId: Type.String({ minLength: 1 }), role: Type.Union([Type.Literal("parent"), Type.Literal("reference")]) }), { maxItems: 16 }),
  outputAssetIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 16 }),
  prompt: Type.Union([Type.String({ minLength: 1, maxLength: 8_000 }), Type.Null()]),
  ratio: Type.String({ minLength: 1, maxLength: 24 }),
  outputCount: Type.Number({ minimum: 0, maximum: 16 }),
  outputTotal: Type.Number({ minimum: 1, maximum: 16 }),
  providerId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  modelId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  parameters: Type.Record(Type.String(), Type.Unknown()),
  status: Type.Union([Type.Literal("rendering"), Type.Literal("ready"), Type.Literal("partial"), Type.Literal("failed"), Type.Literal("cancelled")]),
  errorMessage: Type.Union([Type.String({ minLength: 1, maxLength: 4_000 }), Type.Null()]),
  usageEvents: Type.Optional(Type.Array(MediaUsageEventSchema, { maxItems: 128 })),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
});

export const MediaProjectSchema = Type.Object({
  documentVersion: Type.Literal(3),
  sessionId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: 120 }),
  assets: Type.Array(MediaAssetSchema, { maxItems: 2_048 }),
  operations: Type.Array(MediaOperationSchema, { maxItems: 2_048 }),
  coverAssetId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  viewport: Type.Object({ x: Type.Number(), y: Type.Number(), zoom: Type.Number({ minimum: 0.1, maximum: 3 }) }),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
});

export const CreateMediaProjectSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
});

export const MediaProjectRequestSchema = Type.Object({
  sessionId: Type.String({ minLength: 1 }),
});

const MediaPositionSchema = Type.Object({ x: Type.Number(), y: Type.Number() });
const MediaProviderRequestBase = {
  sessionId: Type.String({ minLength: 1 }),
  parentAssetIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 16 }),
  referenceAssetIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 16 }),
  providerId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1, maxLength: 8_000 }),
  ratio: Type.String({ minLength: 1, maxLength: 24 }),
  outputCount: Type.Number({ minimum: 1, maximum: 4 }),
  targetPosition: MediaPositionSchema,
};
const MediaInlineImageSchema = Type.Object({ mimeType: Type.Literal("image/png"), data: Type.String({ minLength: 1, maxLength: 70_000_000 }) });

export const StartMediaOperationSchema = Type.Union([
  Type.Object({ ...MediaProviderRequestBase, action: Type.Union([Type.Literal("generate"), Type.Literal("regenerate"), Type.Literal("variation")]) }),
  Type.Object({ ...MediaProviderRequestBase, action: Type.Union([Type.Literal("local-edit"), Type.Literal("remove-object")]), mask: MediaInlineImageSchema }),
  Type.Object({ ...MediaProviderRequestBase, action: Type.Literal("remove-background"), preserveSubject: Type.Union([Type.Literal("object"), Type.Literal("person")]) }),
  Type.Object({ ...MediaProviderRequestBase, action: Type.Literal("multi-view"), views: Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1, maxLength: 80 }), yaw: Type.Number({ minimum: -180, maximum: 180 }), pitch: Type.Number({ minimum: -90, maximum: 90 }) }), { minItems: 1, maxItems: 8 }) }),
  Type.Object({ sessionId: Type.String({ minLength: 1 }), action: Type.Literal("crop"), sourceAssetId: Type.String({ minLength: 1 }), crop: Type.Object({ x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }), width: Type.Number({ exclusiveMinimum: 0, maximum: 1 }), height: Type.Number({ exclusiveMinimum: 0, maximum: 1 }) }), image: MediaInlineImageSchema, targetPosition: MediaPositionSchema }),
]);

export const ImportMediaImagesSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), sourcePaths: Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), { minItems: 1, maxItems: 16 }), targetPosition: MediaPositionSchema });
export const DuplicateMediaAssetSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), assetId: Type.String({ minLength: 1 }), targetPosition: MediaPositionSchema });
export const DeleteMediaAssetSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), assetId: Type.String({ minLength: 1 }) });
export const UpdateMediaLayoutSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), assets: Type.Array(Type.Object({ id: Type.String({ minLength: 1 }), x: Type.Number(), y: Type.Number(), width: Type.Number({ minimum: 160, maximum: 720 }), height: Type.Number({ minimum: 120, maximum: 720 }) }), { maxItems: 2_048 }), viewport: Type.Object({ x: Type.Number(), y: Type.Number(), zoom: Type.Number({ minimum: 0.1, maximum: 3 }) }) });
export const SetMediaCoverSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), assetId: Type.String({ minLength: 1 }) });
export const CancelMediaOperationSchema = Type.Object({ sessionId: Type.String({ minLength: 1 }), operationId: Type.String({ minLength: 1 }) });

export type ModelReferenceDto = Static<typeof ModelReferenceSchema>;
export type SessionDraftDto = Static<typeof SessionDraftSchema>;
export type SessionAccessLevelDto = Static<typeof SessionAccessLevelSchema>;
export type CreateWorkspaceDto = Static<typeof CreateWorkspaceSchema>;
export type OpenWorkspaceDto = Static<typeof OpenWorkspaceSchema>;
export type CreateAndPromptDto = Static<typeof CreateAndPromptSchema>;
export type PromptSessionDto = Static<typeof PromptSessionSchema>;
export type CompactSessionDto = Static<typeof CompactSessionSchema>;
export type SessionHistoryPageRequestDto = Static<typeof SessionHistoryPageRequestSchema>;
export type SessionMessageSearchRequestDto = Static<typeof SessionMessageSearchRequestSchema>;
export type SessionToolOutputRequestDto = Static<typeof SessionToolOutputRequestSchema>;
export type WorkspaceFileRequestDto = Static<typeof WorkspaceFileRequestSchema>;
export type ListWorkspaceDirectoryDto = Static<typeof ListWorkspaceDirectorySchema>;
export type ResolveOperationApprovalDto = Static<typeof ResolveOperationApprovalSchema>;
export type ResolveUserRequestDto = Static<typeof ResolveUserRequestSchema>;
export type RenameSessionDto = Static<typeof RenameSessionSchema>;
export type SetSessionPinnedDto = Static<typeof SetSessionPinnedSchema>;
export type DeleteSessionDto = Static<typeof DeleteSessionSchema>;
export type SetSessionModelDto = Static<typeof SetSessionModelSchema>;
export type SetSessionAccessDto = Static<typeof SetSessionAccessSchema>;
export type SetPreferenceDto = Static<typeof SetPreferenceSchema>;
export type UsageReportQueryDto = Static<typeof UsageReportQuerySchema>;
export type SetExtensionEnabledDto = Static<typeof SetExtensionEnabledSchema>;
export type UpdateExtensionSettingsDto = Static<typeof UpdateExtensionSettingsSchema>;
export type SessionExtensionInteractionDto = Static<typeof SessionExtensionInteractionSchema>;
export type SetSessionExtensionStateDto = Static<typeof SetSessionExtensionStateSchema>;
export type SaveCustomProviderDto = Static<typeof SaveCustomProviderSchema>;
export type SetEnabledModelDto = Static<typeof SetEnabledModelSchema>;
export type SaveBuiltinCredentialDto = Static<typeof SaveBuiltinCredentialSchema>;
export type SaveProviderConfigurationDto = Static<typeof SaveProviderConfigurationSchema>;
export type SetConfiguredModelEnabledDto = Static<typeof SetConfiguredModelEnabledSchema>;
export type DeleteCustomProviderDto = Static<typeof DeleteCustomProviderSchema>;
export type MediaProjectDto = Static<typeof MediaProjectSchema>;
export type CreateMediaProjectDto = Static<typeof CreateMediaProjectSchema>;
export type MediaProjectRequestDto = Static<typeof MediaProjectRequestSchema>;
export type StartMediaOperationDto = Static<typeof StartMediaOperationSchema>;
export type ImportMediaImagesDto = Static<typeof ImportMediaImagesSchema>;
export type DuplicateMediaAssetDto = Static<typeof DuplicateMediaAssetSchema>;
export type DeleteMediaAssetDto = Static<typeof DeleteMediaAssetSchema>;
export type UpdateMediaLayoutDto = Static<typeof UpdateMediaLayoutSchema>;
export type SetSkillEnabledDto = Static<typeof SetSkillEnabledSchema>;
export type RemoveManagedSkillDto = Static<typeof RemoveManagedSkillSchema>;
export type ImportSkillFileDto = Static<typeof ImportSkillFileSchema>;
export type ConnectorConfigurationDto = Static<typeof ConnectorConfigurationSchema>;
export type ConnectorIdDto = Static<typeof ConnectorIdSchema>;
export type SetConnectorEnabledDto = Static<typeof SetConnectorEnabledSchema>;
export type SetSessionConnectorsDto = Static<typeof SetSessionConnectorsSchema>;
export type ConnectorPromptDto = Static<typeof ConnectorPromptSchema>;

export interface AppSnapshot {
  preferences: AppPreferences;
  entries: WorkbenchEntryDefinition[];
  workspaces: WorkspaceRecord[];
  sessions: SessionRecord[];
  connections: ProviderConnectionRecord[];
  models: EnabledModelRecord[];
  modelConfiguration: ModelConfigurationSnapshot;
  security: SecurityPolicySnapshot;
  extensions: AgentExtensionSnapshot;
  skills: SkillCatalogSnapshot;
  connectors: ConnectorCatalogSnapshot;
  mediaProjects: MediaProjectSummary[];
}

export type { MediaLayoutUpdate, MediaOperationRequest, MediaProject, MediaProjectSummary };
export type { UsageReport };

export interface SessionSnapshot {
  session: SessionRecord;
  messages: ConversationMessage[];
  contextUsage?: SessionContextUsage;
  turnUsage?: SessionTurnUsage;
  contextCompactions: ContextCompactionRecord[];
  isRunning: boolean;
  isCompacting: boolean;
  compactionTrigger?: ContextCompactionRecord["trigger"];
  compactionError?: string;
  extensions: AgentExtensionSessionState[];
  toolApprovalMode: ToolApprovalMode;
}

export interface SessionHistoryTurn {
  id: string;
  anchorMessageId: string;
  messages: ConversationMessage[];
  timestamp: number;
}

export type SessionHistoryTimelineItem =
  | { type: "turn"; turn: SessionHistoryTurn }
  | { type: "compaction"; compaction: ContextCompactionRecord };

export interface SessionTurnSummary {
  excerpt: string;
  messageId: string;
  ordinal: number;
  timestamp: number;
  tokens: number;
  turnId: string;
}

export interface SessionHistoryPage {
  hasMoreAfter: boolean;
  hasMoreBefore: boolean;
  items: SessionHistoryTimelineItem[];
  nextAfterCursor?: string;
  nextBeforeCursor?: string;
  revision: string;
}

export interface SessionHistoryPageRequest {
  after?: string;
  aroundTurnId?: string;
  before?: string;
  limit?: number;
}

export type SessionMessageSearchRole = "user" | "assistant";

export interface SessionMessageSearchRequest {
  limit?: number;
  query: string;
  role?: SessionMessageSearchRole;
}

export interface SessionMessageSearchResult {
  matchEnd: number;
  matchStart: number;
  messageId: string;
  role: SessionMessageSearchRole;
  snippet: string;
  timestamp: number;
  turnId: string;
}

export interface SessionMessageSearchResponse {
  results: SessionMessageSearchResult[];
  total: number;
  truncated: boolean;
}

export interface SessionViewSnapshot {
  compactionError?: string;
  compactionTrigger?: ContextCompactionRecord["trigger"];
  contextUsage?: SessionContextUsage;
  extensions: AgentExtensionSessionState[];
  history: SessionHistoryPage;
  isCompacting: boolean;
  isRunning: boolean;
  session: SessionRecord;
  turnSummaries: SessionTurnSummary[];
  turnUsage?: SessionTurnUsage;
  toolApprovalMode: ToolApprovalMode;
}

export interface SessionWorkspaceSummary {
  id: string | null;
  name: string;
  available: boolean;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number;
  mtimeMs: number;
}

export interface SessionArtifactFile {
  path: string;
  name: string;
  kind: "created" | "modified";
  diffAvailable: boolean;
}

export interface SessionContextSnapshot {
  workspace: SessionWorkspaceSummary | null;
  artifacts: SessionArtifactFile[];
  changes: SessionArtifactFile[];
}

export type ArtifactKind = "presentation" | "document" | "spreadsheet" | "browser";

export interface ArtifactDescriptor {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  sourcePath: string;
  displayName: string;
  mimeType: string;
  revision: number;
  status: "creating" | "ready" | "updating" | "failed";
  capabilities: Array<"preview" | "select" | "validate" | "export" | "open">;
  quality?: ArtifactQualitySummary;
  updatedAt: number;
}

export interface ArtifactQualitySummary {
  revision: number;
  status: "draft" | "needs-review" | "needs-fix" | "ready";
  cycle: number;
  totalSlides: number;
  reviewedSlides: number;
  issueCount: number;
  checkedAt: number;
}

export interface ArtifactIssue {
  severity: "warning" | "error";
  message: string;
  locator?: string;
  code?: string;
  category?: "schema" | "format" | "content" | "structure" | "visual";
  surfaceId?: string;
  suggestion?: string;
}

export interface ArtifactPreviewSurface {
  id: string;
  kind: "slide" | "page" | "sheet" | "browser-frame";
  label: string;
  thumbnailUrl?: string;
}

export interface ArtifactPreviewManifest {
  artifactId: string;
  revision: number;
  htmlUrl?: string;
  watchUrl?: string;
  surfaces: ArtifactPreviewSurface[];
  issues: ArtifactIssue[];
}

export interface ArtifactSelection {
  artifactId: string;
  kind: ArtifactKind;
  revision: number;
  surfaceId: string;
  locator: string;
  label: string;
  locators?: string[];
  intent?: "reference" | "analyze" | "formula" | "chart" | "pivot";
}

export interface SpreadsheetSelectionRange {
  sheetName: string;
  range: string;
  locator: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetSelection extends ArtifactSelection {
  paths: string[];
  ranges: SpreadsheetSelectionRange[];
  elements: string[];
  selectionKind: "range" | "multi-range" | "elements" | "mixed";
  sheetName?: string;
  range?: string;
  rowCount?: number;
  columnCount?: number;
  displayValue?: string;
  formula?: string;
}

export interface SpreadsheetCapabilitySnapshot {
  version: string;
  elements: string[];
  highLevelTools: string[];
}

export interface SpreadsheetRangeProfile {
  artifactId: string;
  revision: number;
  sheetName: string;
  range: string;
  rowCount: number;
  columnCount: number;
  populatedCells: number;
  blankCells: number;
  numericCells: number;
  duplicateValues: number;
  minimum?: number;
  maximum?: number;
  average?: number;
}

export interface SpreadsheetChangeRecord {
  revision: number;
  updatedAt: number;
  operations: Array<{ command: string; locator?: string; elementType?: string }>;
}

export interface PresentationTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface OfficeEngineHealth {
  status: "ready" | "missing" | "error";
  version?: string;
  message?: string;
  bundled: boolean;
}

export type SessionWorkspaceTextFile =
  | { status: "available"; path: string; name: string; content: string }
  | { status: "unavailable"; reason: "binary" | "missing" | "too-large" };

export type SessionArtifactDiff =
  | { status: "available"; path: string; patch: string }
  | { status: "unavailable"; reason: "baseline-missing" | "binary" | "missing" | "too-large" };

export type RuntimeEvent =
  | { type: "skills.changed" }
  | { type: "connectors.changed" }
  | { type: "model-configuration.changed" }
  | { type: "media.project.changed"; sessionId: string }
  | { type: "artifact.changed"; artifactId: string; kind: ArtifactKind; revision: number; affectedLocators: string[] }
  | { type: "run.started"; runId: string }
  | { type: "run.completed"; runId: string }
  | { type: "run.failed"; runId: string; message: string }
  | { type: "run.cancelled"; runId: string }
  | { type: "context.compaction.started"; trigger: ContextCompactionRecord["trigger"] }
  | { type: "context.compaction.completed"; compaction: ContextCompactionRecord }
  | { type: "context.compaction.failed"; trigger: ContextCompactionRecord["trigger"]; message: string }
  | { type: "message.started"; message: ConversationMessage }
  | { type: "message.text.delta"; messageId: string; delta: string }
  | { type: "message.reasoning.delta"; messageId: string; delta: string }
  | { type: "message.completed"; message: ConversationMessage }
  | { type: "tool.started"; messageId: string; callId: string; name: string; input: Record<string, unknown> }
  | { type: "tool.updated"; messageId: string; callId: string; output: string; details?: unknown; usage?: ConversationUsage }
  | { type: "tool.completed"; messageId: string; callId: string; output: string; details?: unknown; usage?: ConversationUsage; isError: boolean }
  | {
      type: "approval.requested";
      messageId: string;
      approval: {
        approvalId: string;
        callId: string;
        toolName: string;
        input: Record<string, unknown>;
        risk: ToolOperationApproval["risk"];
        severity: ToolOperationApproval["severity"];
        summary: string;
        preview: ToolOperationApproval["preview"];
        matchedRules: ToolOperationApproval["matchedRules"];
      };
    }
  | { type: "approval.resolved"; messageId: string; resolution: { approvalId: string; approved: boolean; feedback?: string } }
  | { type: "user-request.requested"; messageId: string; request: UserRequest }
  | { type: "user-request.resolved"; messageId: string; resolution: UserRequestResolution }
  | { type: "model.changed"; model: ModelReference }
  | { type: "extension.event"; event: AgentExtensionEvent }
  | { type: "session.idle" };

export interface RuntimeEventEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  runtimeInstanceId: string;
  eventId: string;
  sessionId: string | null;
  runId?: string;
  turnId?: string;
  sequence: number;
  timestamp: number;
  event: RuntimeEvent;
}
