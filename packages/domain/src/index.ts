export type WorkbenchMode = "everyday" | "code" | "create";

export type AgentDriverId = string;

export type AgentInteractionModeId = "default" | "clarify" | "plan";

export type SessionJournalFormat = "wordless-agent-v1" | "wordless-coding-v1";

export type WorkbenchId =
  | "conversation"
  | "code"
  | "presentation"
  | "workbook"
  | "analysis"
  | "ui-preview"
  | "media-canvas";

/**
 * 产物类型。
 *
 * 写成数组再由它派生联合类型(与 `PROVIDER_MODEL_FETCHERS` 等同一范式),因为**运行时
 * 也需要这份清单**:驱动 SDK 的反序列化要逐值校验,而手抄一份校验链的结果是——给类型
 * 加了新值却忘了加校验,产物引用就被**静默丢弃**,而且没有编译错误。
 */
export const ARTIFACT_KINDS = [
  "presentation",
  "document",
  "spreadsheet",
  "browser",
  "report",
  "dataset",
  "chart",
  "image",
  "design",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type WorkspaceKind = "managed" | "linked";

export type WorkspaceAvailability = "available" | "missing";

export type SkillSource =
  | "built-in"
  | "wordless"
  | "pi"
  | "agents"
  | "claude"
  | "codex"
  | "workspace-pi"
  | "workspace-claude"
  | "workspace-codex";

export type SkillState = "active" | "disabled" | "shadowed" | "invalid";

export type ConnectorTransport = "stdio" | "streamable-http";

export type ConnectorStatus = "disconnected" | "ready" | "needs-auth" | "error";

export type ConnectorTemplateId =
  | "feishu"
  | "dingtalk"
  | "wecom"
  | "postgresql"
  | "web-search"
  | "firecrawl"
  | "github"
  | "ai-hot"
  | null;

export const CONNECTOR_OAUTH_REDIRECT_URI =
  "http://127.0.0.1:18191/oauth/callback";

export interface ConnectorHeader {
  name: string;
  value: string;
}

export interface ConnectorOAuthConfiguration {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface ConnectorMarketplaceOrigin {
  source: "official-mcp-registry";
  registryName: string;
  version: string;
  sourceUrl: string;
}

export interface ConnectorConfiguration {
  id: string;
  name: string;
  templateId: ConnectorTemplateId;
  transport: ConnectorTransport;
  enabled: boolean;
  trustedAt: number | null;
  command: string | null;
  args: string[];
  cwd: string | null;
  environment: Record<string, string>;
  url: string | null;
  headers: ConnectorHeader[];
  oauth: ConnectorOAuthConfiguration | null;
  marketplace?: ConnectorMarketplaceOrigin;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectorToolSummary {
  name: string;
  title: string;
  description: string;
  /** JSON Schema declared by the MCP server for this tool's arguments. */
  inputSchema: Record<string, unknown> | null;
  readOnly: boolean | null;
  destructive: boolean | null;
}

export interface ConnectorResourceSummary {
  uri: string;
  name: string;
  description: string;
  mimeType: string | null;
}

export interface ConnectorPromptSummary {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export interface ConnectorSummary {
  id: string;
  name: string;
  templateId: ConnectorTemplateId;
  transport: ConnectorTransport;
  enabled: boolean;
  trustedAt: number | null;
  status: ConnectorStatus;
  lastError?: string;
  tools: ConnectorToolSummary[];
  resources: ConnectorResourceSummary[];
  prompts: ConnectorPromptSummary[];
  marketplace?: ConnectorMarketplaceOrigin;
  updatedAt: number;
}

export interface ConnectorCatalogSnapshot {
  connectors: ConnectorSummary[];
  updatedAt: number;
}

export interface McpMarketplaceEntry {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  publisher: string;
  repositoryUrl: string | null;
  websiteUrl: string | null;
  iconUrl: string | null;
  transport: ConnectorTransport | "unsupported";
  url: string | null;
  packageName: string | null;
  setup?: {
    registryType: string | null;
    packageVersion: string | null;
    runtimeHint: string | null;
    suggestedCommand: string | null;
    requiredInputs: Array<{
      name: string;
      description: string;
      secret: boolean;
      kind: "header" | "environment";
    }>;
    documentationUrl: string | null;
    documentationLabel: "Publisher website" | "Source repository" | null;
  };
  auth: "Server-defined" | "API key / headers" | "None specified";
  capabilities: string[];
  installable: boolean;
  source: "official-mcp-registry";
  sourceUrl: string;
}

export interface McpMarketplacePage {
  entries: McpMarketplaceEntry[];
  nextCursor: string | null;
  stale: boolean;
  fetchedAt: number;
}

export interface SkillMarketplaceEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  contentLanguage: string | null;
  githubUrl: string;
  skillUrl: string;
  stars: number;
  updatedAt: number;
  source: "skillsmp";
}

export interface SkillMarketplacePage {
  entries: SkillMarketplaceEntry[];
  page: number;
  totalPages: number;
  hasNext: boolean;
  total: number;
  stale: boolean;
  fetchedAt: number;
}

export interface SkillMarketplaceFile {
  path: string;
  size: number;
}

export interface SkillMarketplacePreview {
  previewId: string;
  entry: SkillMarketplaceEntry;
  files: SkillMarketplaceFile[];
  skillMarkdown: string;
  commitSha: string;
  expiresAt: number;
}

export interface SkillMarketplaceOrigin {
  source: "skillsmp";
  id: string;
  githubUrl: string;
  commitSha: string;
  installedAt: number;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  workspaceId: string | null;
  filePath: string;
  enabled: boolean;
  state: SkillState;
  shadowedBy?: string;
  diagnostic?: string;
  contentBytes: number;
  /** BPE token count of the complete skill file, calculated by the runtime. */
  contentTokens: number;
  marketplace?: SkillMarketplaceOrigin;
}

export interface SkillDiagnostic {
  type: "warning";
  source: SkillSource;
  path: string;
  message: string;
}

export interface SkillCatalogSnapshot {
  skills: SkillSummary[];
  diagnostics: SkillDiagnostic[];
  updatedAt: number;
}

export type SessionAccessLevel = "default" | "full";

export type ToolApprovalMode = "manual" | "auto" | "bypass";

export type PresentationGenerationMode = "guided" | "quick";

export interface PresentationLaunchOptions {
  generationMode: PresentationGenerationMode;
  templateId: string | null;
}

export type ProviderConnectionKind = "builtin" | "openai-compatible";

export type ProviderAuthStatus = "configured" | "missing" | "expired" | "error";

export const PROVIDER_AVATARS = [
  { id: "amazon-bedrock", label: "Amazon Bedrock" },
  { id: "ant-ling", label: "Ant Ling" },
  { id: "anthropic", label: "Anthropic" },
  { id: "azure", label: "Azure" },
  { id: "baai", label: "BAAI" },
  { id: "bailian", label: "Bailian" },
  { id: "bytedance", label: "ByteDance" },
  { id: "cerebras", label: "Cerebras" },
  { id: "cloudflare", label: "Cloudflare" },
  { id: "copilot", label: "GitHub Copilot" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "fireworks", label: "Fireworks AI" },
  { id: "gemini", label: "Google Gemini" },
  { id: "groq", label: "Groq" },
  { id: "huggingface", label: "Hugging Face" },
  { id: "hunyuan", label: "Hunyuan" },
  { id: "jimeng", label: "Jimeng" },
  { id: "kimi", label: "Kimi" },
  { id: "kling", label: "Kling" },
  { id: "longcat", label: "LongCat" },
  { id: "minimax", label: "MiniMax" },
  { id: "mistral", label: "Mistral AI" },
  { id: "moonshot", label: "Moonshot AI" },
  { id: "nvidia", label: "NVIDIA" },
  { id: "ollama", label: "Ollama" },
  { id: "openai", label: "OpenAI" },
  { id: "opencode", label: "OpenCode" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "qwen", label: "Qwen" },
  { id: "stepfun", label: "StepFun" },
  { id: "together", label: "Together AI" },
  { id: "vercel", label: "Vercel" },
  { id: "volcengine", label: "Volcengine" },
  { id: "workersai", label: "Cloudflare Workers AI" },
  { id: "xiaomi", label: "Xiaomi MiMo" },
  { id: "xai", label: "xAI" },
  { id: "zai", label: "Z.AI" },
  { id: "zhipu", label: "Zhipu AI" },
] as const;

export type ProviderAvatarId = (typeof PROVIDER_AVATARS)[number]["id"];

export type EntryAvailability = "available" | "unavailable";

export interface ProfileReference {
  id: string;
  version: string;
}

export interface ModelReference {
  connectionId: string;
  modelId: string;
}

export type ThinkingLevel =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelCapabilities {
  supportsText: true;
  supportsVision: boolean;
  supportsToolUse: boolean | "unknown";
  supportsReasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ModelRequirements {
  requiresVision?: boolean;
  requiresToolUse?: boolean;
  minimumContextWindow?: number;
}

export interface WorkbenchEntryDefinition {
  id: string;
  mode: WorkbenchMode;
  labelKey: string;
  descriptionKey: string;
  iconKey: string;
  profile: ProfileReference | null;
  workbenchId: WorkbenchId;
  availability: EntryAvailability;
  modelRequirements: ModelRequirements;
  /**
   * 不摆在新建页的可选项里,但仍**能被解析**。
   *
   * 需要这个区分是因为"有没有这个入口"与"这个入口的 profile 存不存在"是两件事:媒体工作台
   * (`createMediaProject`)按 id 取这个 entry 的 profile 来建会话,而它不该作为"今天想做什么"的
   * 一类出现在新建页。直接删掉这个 entry 会让那条路拿不到 profile,存下来的会话也会指向一个
   * 解析不出来的 `entryId`。
   */
  internal?: boolean;
}

export interface WorkspaceRecord {
  id: string;
  kind: WorkspaceKind;
  name: string;
  rootPath: string;
  canonicalRootPath: string;
  availability: WorkspaceAvailability;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  workspaceId: string | null;
  runtimeRootPath: string;
  mode: WorkbenchMode;
  entryId: string;
  profile: ProfileReference;
  driverId: AgentDriverId;
  journalFormat: SessionJournalFormat;
  workbenchId: WorkbenchId;
  accessLevel: SessionAccessLevel;
  model: ModelReference;
  thinkingLevel: ThinkingLevel;
  journalPath: string;
  connectorIds: string[];
  interactionMode?: AgentInteractionModeId;
  toolApprovalMode: ToolApprovalMode;
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
  expertSelection?: ExpertSelection;
  source?: string | null;
}

export type ExpertSelection = {
  kind: "expert" | "team";
  id: string;
  version: string;
};

export type AvataaarsTop =
  | "hat"
  | "hijab"
  | "turban"
  | "winterHat1"
  | "winterHat02"
  | "winterHat03"
  | "winterHat04"
  | "bob"
  | "bun"
  | "curly"
  | "curvy"
  | "dreads"
  | "frida"
  | "fro"
  | "froBand"
  | "longButNotTooLong"
  | "miaWallace"
  | "shavedSides"
  | "straight02"
  | "straight01"
  | "straightAndStrand"
  | "dreads01"
  | "dreads02"
  | "frizzle"
  | "shaggy"
  | "shaggyMullet"
  | "shortCurly"
  | "shortFlat"
  | "shortRound"
  | "shortWaved"
  | "sides"
  | "theCaesar"
  | "theCaesarAndSidePart"
  | "bigHair";

export type AvataaarsClothing =
  | "blazerAndShirt"
  | "blazerAndSweater"
  | "collarAndSweater"
  | "graphicShirt"
  | "hoodie"
  | "overall"
  | "shirtCrewNeck"
  | "shirtScoopNeck"
  | "shirtVNeck";

export type AvataaarsEyes =
  | "closed"
  | "cry"
  | "default"
  | "eyeRoll"
  | "happy"
  | "hearts"
  | "side"
  | "squint"
  | "surprised"
  | "winkWacky"
  | "wink"
  | "xDizzy";

export type AvataaarsEyebrows =
  | "angryNatural"
  | "defaultNatural"
  | "flatNatural"
  | "frownNatural"
  | "raisedExcitedNatural"
  | "sadConcernedNatural"
  | "unibrowNatural"
  | "upDownNatural"
  | "angry"
  | "default"
  | "raisedExcited"
  | "sadConcerned"
  | "upDown";

export type AvataaarsMouth =
  | "concerned"
  | "default"
  | "disbelief"
  | "eating"
  | "grimace"
  | "sad"
  | "screamOpen"
  | "serious"
  | "smile"
  | "tongue"
  | "twinkle"
  | "vomit";

export type AvataaarsFacialHair =
  | "none"
  | "beardLight"
  | "beardMajestic"
  | "beardMedium"
  | "moustacheFancy"
  | "moustacheMagnum";

export type AvataaarsAccessories =
  | "none"
  | "kurt"
  | "prescription01"
  | "prescription02"
  | "round"
  | "sunglasses"
  | "wayfarers"
  | "eyepatch";

export interface AvataaarsPortraitOptions {
  backgroundColor: string;
  skinColor: string;
  top: AvataaarsTop;
  hairColor: string;
  hatColor: string;
  eyes: AvataaarsEyes;
  eyebrows: AvataaarsEyebrows;
  mouth: AvataaarsMouth;
  facialHair: AvataaarsFacialHair;
  facialHairColor: string;
  clothing: AvataaarsClothing;
  clothesColor: string;
  accessories: AvataaarsAccessories;
  accessoriesColor: string;
}

export type ExpertPortrait =
  | { kind: "builtin"; key: string }
  | {
      kind: "avataaars";
      schemaVersion: 1;
      options: AvataaarsPortraitOptions;
    };

export interface ExpertSummary {
  id: string;
  version: string;
  name: string;
  description: string;
  portrait: ExpertPortrait;
  kind: "expert" | "team";
  memberCount?: number;
  skillCount: number;
  connectorCount: number;
  source: "builtin" | "local" | "imported";
  tags?: string[];
  categories?: string[];
  roleLabel?: string;
}

export interface ExpertDefinition extends ExpertSummary {
  kind: "expert";
  systemPrompt: string;
  skillIds: string[];
  connectorIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ExpertDefinitionInput {
  name: string;
  description: string;
  systemPrompt: string;
  portrait: ExpertPortrait;
  skillIds?: string[];
  connectorIds?: string[];
  tags?: string[];
  categories?: string[];
  roleLabel?: string;
}

export type ExpertExecutionProfile =
  "read-only" | "review" | "research" | "workspace-write";

export interface ExpertTeamMemberDefinition {
  id: string;
  name: string;
  portrait: ExpertPortrait;
  systemPrompt: string;
  skillIds: string[];
  connectorIds: string[];
  model?: ModelReference;
  thinkingLevel?: ThinkingLevel;
  executionProfile: ExpertExecutionProfile;
  responsibility: string;
  needsReview?: boolean;
}
export interface SessionExpertTeamMemberSnapshot extends ExpertTeamMemberDefinition {
  expertName: string;
}

export interface SessionExpertTeamLeaderSnapshot {
  expertId: string;
  expertName: string;
  portrait: ExpertPortrait;
  systemPrompt: string;
  skillIds: string[];
  connectorIds: string[];
}

export interface ExpertTeamDefinition extends ExpertSummary {
  kind: "team";
  leaderMemberId: string;
  members: ExpertTeamMemberDefinition[];
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExpertTeamDefinitionInput {
  name: string;
  description: string;
  portrait: ExpertPortrait;
  leaderMemberId: string;
  members: ExpertTeamMemberDefinition[];
  systemPrompt: string;
  tags?: string[];
  categories?: string[];
  roleLabel?: string;
}

export interface ExpertTeamDetailMember extends ExpertTeamMemberDefinition {
  name: string;
  portrait: ExpertPortrait;
  available: boolean;
}

export interface ExpertTeamDetailLeader extends ExpertTeamMemberDefinition {
  available: boolean;
}

/** A presentation-safe, resolved view of an expert team for the desktop UI. */
export interface ExpertTeamDetail extends ExpertSummary {
  kind: "team";
  leader: ExpertTeamDetailLeader;
  members: ExpertTeamDetailMember[];
  suggestedPrompts: string[];
}

interface SessionExpertSnapshotBase {
  selection: ExpertSelection;
  name: string;
  systemPrompt: string;
  skillIds: string[];
  connectorIds: string[];
}

export interface SessionIndividualExpertSnapshot extends SessionExpertSnapshotBase {
  kind: "expert";
}

export interface SessionExpertTeamSnapshot extends SessionExpertSnapshotBase {
  kind: "team";
  teamName: string;
  teamPortrait: ExpertPortrait;
  leader: SessionExpertTeamLeaderSnapshot;
  teamMembers: SessionExpertTeamMemberSnapshot[];
}

export type SessionExpertSnapshot =
  SessionIndividualExpertSnapshot | SessionExpertTeamSnapshot;

export type MediaKind = "image" | "video";

export type MediaAssetStatus = "rendering" | "ready" | "failed";

export type MediaOperationKind =
  | "upload"
  | "generate"
  | "regenerate"
  | "variation"
  | "crop"
  | "local-edit"
  | "remove-background"
  | "remove-object"
  | "multi-view";

export type MediaOperationStatus =
  "rendering" | "ready" | "partial" | "failed" | "cancelled";

export type MediaAssetOrigin = "uploaded" | "generated";

export type MediaInputRole = "parent" | "reference";

export interface MediaViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface MediaAsset {
  id: string;
  operationId: string;
  origin: MediaAssetOrigin;
  kind: MediaKind;
  status: MediaAssetStatus;
  name: string;
  mimeType: string;
  url: string | null;
  errorMessage: string | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
  outputIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface MediaOperationInput {
  assetId: string;
  role: MediaInputRole;
}

export interface MediaUsageEvent {
  id: string;
  timestamp: number;
  usage?: ConversationUsage;
}

export interface MediaOperation {
  id: string;
  kind: MediaOperationKind;
  inputs: MediaOperationInput[];
  outputAssetIds: string[];
  prompt: string | null;
  ratio: string;
  outputCount: number;
  outputTotal: number;
  providerId: string | null;
  modelId: string | null;
  parameters: Record<string, unknown>;
  status: MediaOperationStatus;
  errorMessage: string | null;
  usageEvents?: MediaUsageEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface MediaProject {
  documentVersion: 3;
  sessionId: string;
  title: string;
  assets: MediaAsset[];
  operations: MediaOperation[];
  coverAssetId: string | null;
  viewport: MediaViewport;
  createdAt: number;
  updatedAt: number;
}

export interface MediaProjectSummary {
  sessionId: string;
  title: string;
  assetCount: number;
  readyAssetCount: number;
  previewImageUrl: string | null;
  updatedAt: number;
}

export interface MediaInlineImage {
  mimeType: string;
  data: string;
}

export interface MediaPosition {
  x: number;
  y: number;
}

export interface MediaCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaViewAngle {
  id: string;
  label: string;
  yaw: number;
  pitch: number;
}

interface MediaProviderOperationRequestBase {
  sessionId: string;
  parentAssetIds: string[];
  referenceAssetIds: string[];
  providerId: string;
  modelId: string;
  prompt: string;
  ratio: string;
  outputCount: number;
  imageParameters?: MediaImageParameters;
  targetPosition: MediaPosition;
}

export interface MediaImageParameters {
  aspectRatio?: string;
  resolution?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  outputCompression?: number;
  seed?: number;
  watermark?: boolean;
  promptEnhancement?: boolean;
}

export interface MediaGenerationRequest extends MediaProviderOperationRequestBase {
  action: "generate" | "regenerate" | "variation";
}

export interface MediaLocalEditRequest extends MediaProviderOperationRequestBase {
  action: "local-edit" | "remove-object";
  mask: MediaInlineImage;
}

export interface MediaBackgroundRemovalRequest extends MediaProviderOperationRequestBase {
  action: "remove-background";
  preserveSubject: "object" | "person";
}

export interface MediaMultiViewRequest extends MediaProviderOperationRequestBase {
  action: "multi-view";
  views: MediaViewAngle[];
}

export interface MediaCropRequest {
  sessionId: string;
  action: "crop";
  sourceAssetId: string;
  crop: MediaCropRect;
  image: MediaInlineImage;
  targetPosition: MediaPosition;
}

export type MediaOperationRequest =
  | MediaGenerationRequest
  | MediaLocalEditRequest
  | MediaBackgroundRemovalRequest
  | MediaMultiViewRequest
  | MediaCropRequest;

export interface MediaLayoutUpdate {
  sessionId: string;
  assets: Array<Pick<MediaAsset, "id" | "x" | "y" | "width" | "height">>;
  viewport?: MediaViewport;
}

export interface MediaViewportUpdate {
  sessionId: string;
  viewport: MediaViewport;
}

export interface ImageModelCapabilities {
  supportsMaskEditing: boolean;
  supportsTransparentBackground: boolean;
  supportsTextToImage?: boolean;
  supportsReferenceImageEditing?: boolean;
  supportsSpatialAnnotation?: boolean;
  maxReferenceImages?: number;
  maxOutputImages?: number;
  aspectRatios?: string[];
  resolutions?: string[];
  outputFormats?: string[];
  qualityLevels?: string[];
  supportsSeed?: boolean;
  supportsWatermark?: boolean;
}

export interface ConfiguredModelSummary {
  providerId: string;
  providerAvatarId: ProviderAvatarId | null;
  modelId: string;
  displayName: string;
  kind: ConfiguredModelKind;
  enabled: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
  contextWindow: number | null;
  api: string;
  imageCapabilities: ImageModelCapabilities | null;
}

export interface ProviderConnectionRecord {
  id: string;
  kind: ProviderConnectionKind;
  providerId: string;
  avatarId: ProviderAvatarId | null;
  displayName: string;
  baseUrl: string | null;
  api: "openai-completions" | "openai-responses" | null;
  authStatus: ProviderAuthStatus;
  createdAt: number;
  updatedAt: number;
}

export interface EnabledModelRecord {
  connectionId: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  enabled: boolean;
  updatedAt: number;
}

export type ConfiguredModelKind = "chat" | "image";

export const PROVIDER_MODEL_FETCHERS = [
  "aihubmix",
  "ollama",
  "gemini",
  "vertex",
  "github",
  "copilot",
  "ovms",
  "together",
  "new-api",
  "openrouter",
  "ppio",
  "vercel-gateway",
  "anthropic",
  "jina",
  "openai",
  "openai-compatible",
] as const;

export type ProviderModelFetcherId = (typeof PROVIDER_MODEL_FETCHERS)[number];

export interface ProviderModelDiscoveryRequest {
  providerId: string;
  providerFamily: ProviderAvatarId | null;
  baseUrl: string;
  apiKey?: string;
  api?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  modelFetcher?: ProviderModelFetcherId;
}

export interface ProviderModelCandidate {
  id: string;
  name: string;
  ownedBy?: string;
  description?: string;
  contextWindow?: number;
  maxTokens?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  /** Safe model-definition fields copied from the built-in catalog when matched. */
  configuration?: Record<string, unknown>;
}

export interface ConfiguredProviderSummary {
  id: string;
  displayName: string;
  kind: ConfiguredModelKind;
  source: "builtin" | "custom" | "extension";
  avatarId: ProviderAvatarId | null;
  baseUrl: string | null;
  authStatus: ProviderAuthStatus;
  enabledModelCount: number;
  modelCount: number;
  apiKeyConfigured: boolean;
  supportsOAuth: boolean;
  configuration: Record<string, unknown> | null;
}

export interface ModelConfigurationSnapshot {
  providers: ConfiguredProviderSummary[];
  models: ConfiguredModelSummary[];
  diagnostics: string[];
}

export interface NotificationPreferences {
  enabled: boolean;
  onActionRequired: boolean;
  onRunCompleted: boolean;
  onRunFailed: boolean;
}

export interface CustomFileSecurityRule {
  id: string;
  label: string;
  pattern: string;
}

export interface CustomCommandSecurityRule {
  id: string;
  label: string;
  command: string;
}

export interface SecurityPreferences {
  customFileRules: CustomFileSecurityRule[];
  customCommandRules: CustomCommandSecurityRule[];
}

export type BuiltinBackgroundId = "paper" | "micro-dots" | "fine-grid";

export type BackgroundSource =
  | { kind: "none" }
  | { kind: "builtin"; id: BuiltinBackgroundId }
  | { kind: "custom"; assetId: string; animated?: boolean; posterAssetId?: string };

export type BackgroundFit = "cover" | "contain" | "tile";

export interface AppearancePreferences {
  background: {
    source: BackgroundSource;
    fit: BackgroundFit;
    position: { x: number; y: number };
    intensity: number;
    blurPx: number;
  };
}

export interface AppearanceBackgroundAsset {
  assetId: string;
  posterAssetId?: string;
  animated?: boolean;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  width: number;
  height: number;
}

export type SecurityRuleSource = "builtin" | "custom";

export interface FileSecurityRule extends CustomFileSecurityRule {
  source: SecurityRuleSource;
}

export interface CommandSecurityRule extends CustomCommandSecurityRule {
  source: SecurityRuleSource;
}

export interface SecurityPolicySnapshot {
  fileRules: FileSecurityRule[];
  commandRules: CommandSecurityRule[];
}

export interface TranslationPreferences {
  /** Language tag used for translations. `null` follows the interface language. */
  targetLanguage: string | null;
  /** Chat model used for translation. `null` follows the session's selected model. */
  model: ModelReference | null;
  /** Selection length above which a translation opens in the panel instead of a bubble. */
  bubbleMaxChars: number;
}

/**
 * Actions a keyboard shortcut can be bound to.
 *
 * The table is the single source for the dispatcher, the stored bindings and,
 * later, the settings page, so no binding can name an action the interface does
 * not handle. A combo is written the way the application menu writes an
 * accelerator: `mod` is Command on macOS and Control elsewhere, so `mod+,` is
 * the `CommandOrControl+,` the menu installs.
 */
export const SHORTCUT_ACTIONS = [
  { id: "new-thread", defaultShortcut: "mod+n" },
  // The digits follow the order of the sidebar: the conversation first, then
  // the views in the order they are listed there.
  { id: "open-conversation", defaultShortcut: "mod+1" },
  { id: "open-media", defaultShortcut: "mod+2" },
  { id: "open-automation", defaultShortcut: "mod+3" },
  { id: "open-tasks", defaultShortcut: "mod+4" },
  { id: "open-experts", defaultShortcut: "mod+5" },
  { id: "open-skills", defaultShortcut: "mod+6" },
  { id: "find-in-conversation", defaultShortcut: "mod+f" },
  { id: "toggle-sidebar", defaultShortcut: "mod+b" },
  { id: "toggle-context-panel", defaultShortcut: "mod+j" },
  { id: "open-settings", defaultShortcut: "mod+," },
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]["id"];

/** Combos by action. An action left out keeps its default. */
export type ShortcutBindings = Partial<Record<ShortcutActionId, string>>;

export interface ShortcutPreferences {
  bindings: ShortcutBindings;
}

const SHORTCUT_ACTION_IDS: ReadonlySet<string> = new Set(SHORTCUT_ACTIONS.map((action) => action.id));
const SHORTCUT_MODIFIERS: ReadonlySet<string> = new Set(["mod", "ctrl", "shift", "alt"]);
/** Modifiers that make a binding safe to hold; Shift only ever comes along. */
const SHORTCUT_HOLDING_MODIFIERS: ReadonlySet<string> = new Set(["mod", "ctrl", "alt"]);
/** Both the key serializer and the normalizer write modifiers in this order. */
const SHORTCUT_MODIFIER_ORDER = ["mod", "ctrl", "shift", "alt"] as const;

export function isShortcutActionId(value: unknown): value is ShortcutActionId {
  return typeof value === "string" && SHORTCUT_ACTION_IDS.has(value);
}

export function getShortcutActionDef(id: ShortcutActionId): (typeof SHORTCUT_ACTIONS)[number] {
  const action = SHORTCUT_ACTIONS.find((candidate) => candidate.id === id);
  if (!action) throw new Error(`Unknown shortcut action: ${id}`);
  return action;
}

/**
 * Canonical form of one combo, or null when it is not a shortcut:
 * modifiers in a fixed order and a lowercase last part ("Shift+Mod+N" →
 * "mod+shift+n"), so two spellings of one key can never both be stored.
 */
function normalizeShortcutCombo(value: string): string | null {
  const parts = value.trim().toLowerCase().split("+").filter(Boolean);
  const key = parts.at(-1);
  if (!key) return null;
  // Modifiers may appear once each, and never as the key itself.
  const modifiers = parts.slice(0, -1);
  if (SHORTCUT_MODIFIERS.has(key) || /\s/.test(key) || key.length > 24) return null;
  if (new Set(modifiers).size !== modifiers.length) return null;
  if (modifiers.some((modifier) => !SHORTCUT_MODIFIERS.has(modifier))) return null;
  return [...SHORTCUT_MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier)), key].join("+");
}

export function getEffectiveShortcut(actionId: ShortcutActionId, bindings: ShortcutBindings = {}): string {
  return bindings[actionId] ?? getShortcutActionDef(actionId).defaultShortcut;
}

/**
 * True when a combo is safe to hold. A binding needs a key plus one of `mod`,
 * `ctrl` or `alt`: a bare key or a Shift-only combo would swallow ordinary
 * typing, which is the one failure a global shortcut must never cause. Shift is
 * therefore only ever a companion of a holding modifier.
 */
export function isBindableShortcut(combo: string): boolean {
  const normalized = normalizeShortcutCombo(combo);
  if (!normalized) return false;
  return normalized
    .split("+")
    .slice(0, -1)
    .some((modifier) => SHORTCUT_HOLDING_MODIFIERS.has(modifier));
}

/**
 * The action that already holds `combo`, or null when it is free.
 *
 * Effective keys are compared, not stored ones: an action without a binding
 * still holds its default, and the user has to be told which action to move
 * before this key can be used. Only the interface can explain that, which is
 * why conflicts are refused here rather than filtered silently.
 */
export function findShortcutConflict(
  actionId: ShortcutActionId,
  combo: string,
  bindings: ShortcutBindings = {},
): ShortcutActionId | null {
  const normalized = normalizeShortcutCombo(combo);
  if (!normalized) return null;
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === actionId) continue;
    if (getEffectiveShortcut(action.id, bindings) === normalized) return action.id;
  }
  return null;
}

export interface ShortcutBindingSnapshot {
  id: ShortcutActionId;
  /** The combo in effect, whether stored or default. */
  shortcut: string;
  defaultShortcut: string;
  /** True while the action still answers to its default. */
  isDefault: boolean;
}

export function listShortcutBindings(bindings: ShortcutBindings = {}): ShortcutBindingSnapshot[] {
  return SHORTCUT_ACTIONS.map((action) => ({
    id: action.id,
    defaultShortcut: action.defaultShortcut,
    isDefault: bindings[action.id] === undefined,
    shortcut: getEffectiveShortcut(action.id, bindings),
  }));
}

/**
 * Keeps only bindings the interface can honour: known actions, bindable
 * combos, and no entry that merely restates a default — so "is this action
 * customized?" is answerable from the stored value alone and a cleared binding
 * is recoverable.
 *
 * Conflicts *between* actions (one key claimed twice) are prevented where a
 * binding is offered, because only there can the user be told which action
 * holds the key. A row that still contains one dispatches in table order, which
 * keeps a hand-edited database predictable rather than random.
 */
export function normalizeShortcutBindings(value: unknown): ShortcutBindings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const bindings: ShortcutBindings = {};
  for (const action of SHORTCUT_ACTIONS) {
    const combo = raw[action.id];
    if (typeof combo !== "string") continue;
    const normalized = normalizeShortcutCombo(combo);
    if (!normalized || normalized === action.defaultShortcut) continue;
    if (!isBindableShortcut(normalized)) continue;
    bindings[action.id] = normalized;
  }
  return bindings;
}

/**
 * The entry that starts a conversation. It is locked to the first inline
 * position: it is an action rather than a view, the first-run guide points at
 * it, and a sidebar whose first row can disappear looks broken.
 */
export const SIDEBAR_PINNED_ANCHOR = "new";

/**
 * Which sidebar entries are shown inline and which are listed in the "More"
 * panel, in the order the user arranged them.
 *
 * Only keys are stored, never the entries themselves: a view that is removed
 * and later comes back keeps the place it was given instead of taking over the
 * layout. Everything here is pure — the arrangement is arranged by the pointer
 * and the keyboard through the same functions, so the two cannot disagree.
 */
export interface SidebarNavLayout {
  /** Keys shown inline, in order. Never holds {@link SIDEBAR_PINNED_ANCHOR}. */
  pinned: readonly string[];
  /** Keys listed in the "More" panel, in order. */
  more: readonly string[];
}

export interface SidebarPreferences {
  layout: SidebarNavLayout;
  /**
   * Inline rows at most, {@link SIDEBAR_PINNED_ANCHOR} included. Counted from
   * the top row because that is what the user counts on screen.
   */
  pinnedLimit: number;
}

/** Inline rows: the anchor always takes one, so the floor leaves two choices. */
export const SIDEBAR_PINNED_LIMIT_MIN = 3;
export const SIDEBAR_PINNED_LIMIT_MAX = 6;
/**
 * One more than the entries a first-time sidebar shows inline, so a slot is
 * free from the start: a limit equal to what is already shown would leave every
 * "Show inline" button disabled until the user hid something first.
 */
export const SIDEBAR_PINNED_LIMIT_DEFAULT = 5;

/** Keys are entries of the interface catalog; only their arrangement is stored. */
const SIDEBAR_LOCKED_KEYS: ReadonlySet<string> = new Set([SIDEBAR_PINNED_ANCHOR]);

/** Slots the user may fill, the locked anchor not counted. */
export function sidebarPinnedCapacity(pinnedLimit: number): number {
  return Math.max(0, clampSidebarPinnedLimit(pinnedLimit) - 1);
}

export function clampSidebarPinnedLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SIDEBAR_PINNED_LIMIT_DEFAULT;
  return Math.min(SIDEBAR_PINNED_LIMIT_MAX, Math.max(SIDEBAR_PINNED_LIMIT_MIN, Math.round(value)));
}

function sidebarNavKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 120) continue;
    if (SIDEBAR_LOCKED_KEYS.has(candidate) || keys.includes(candidate)) continue;
    keys.push(candidate);
  }
  return keys;
}

/**
 * Read-time repair, the counterpart of {@link normalizeShortcutBindings}: a
 * hand-edited or older row must not reach the sidebar with a malformed key list
 * or a limit outside the range. Keys the catalog no longer offers are kept —
 * dropping them would be the renderer's business, and keeping them lets an
 * entry that comes back keep the place the user gave it.
 */
export function normalizeSidebarPreferences(value: unknown): SidebarPreferences {
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const layout = typeof record.layout === "object" && record.layout !== null && !Array.isArray(record.layout) ? (record.layout as Record<string, unknown>) : {};
  const pinned = sidebarNavKeys(layout.pinned);
  const inPinned: ReadonlySet<string> = new Set(pinned);
  return {
    layout: { pinned, more: sidebarNavKeys(layout.more).filter((key) => !inPinned.has(key)) },
    pinnedLimit: clampSidebarPinnedLimit(record.pinnedLimit),
  };
}

/** Inline rows first, the locked anchor in front, then the "More" panel. */
export interface ResolvedSidebarNavLayout {
  pinned: readonly string[];
  more: readonly string[];
}

/**
 * Reconciles the stored arrangement with the entries the interface offers:
 *
 * - keys no longer in the catalog are dropped (a view was removed);
 * - keys the arrangement never mentioned land at the end of "More", so a new
 *   entry never pushes a chosen one out of the way;
 * - inline rows above the limit fall back to the front of "More" instead of
 *   disappearing silently when the user lowers the limit.
 */
export function resolveSidebarNavLayout(
  catalogKeys: readonly string[],
  layout: SidebarNavLayout,
  pinnedLimit: number = SIDEBAR_PINNED_LIMIT_DEFAULT,
  defaultPinned: readonly string[] = [],
): ResolvedSidebarNavLayout {
  const catalog: ReadonlySet<string> = new Set(catalogKeys.filter((key) => !SIDEBAR_LOCKED_KEYS.has(key)));
  const arranged: ReadonlySet<string> = new Set([...layout.pinned, ...layout.more]);
  const pinned = sidebarNavKeys(layout.pinned).filter((key) => catalog.has(key));
  const more = sidebarNavKeys(layout.more).filter((key) => catalog.has(key));
  const placed: ReadonlySet<string> = new Set([...pinned, ...more]);

  for (const key of catalogKeys) {
    if (SIDEBAR_LOCKED_KEYS.has(key) || placed.has(key)) continue;
    if (!arranged.has(key) && defaultPinned.includes(key)) pinned.push(key);
    else more.push(key);
  }
  // Rows above the limit are not dropped: they move to the front of "More".
  const overflow = pinned.splice(sidebarPinnedCapacity(pinnedLimit));
  return { pinned: [SIDEBAR_PINNED_ANCHOR, ...pinned], more: [...overflow, ...more] };
}

export function canPinSidebarNavItem(resolved: ResolvedSidebarNavLayout, pinnedLimit: number): boolean {
  return resolved.pinned.length <= sidebarPinnedCapacity(pinnedLimit);
}

/** Stored form: the locked anchor is implied, so it is not written down. */
export function toStoredSidebarNavLayout(resolved: ResolvedSidebarNavLayout): SidebarNavLayout {
  return { pinned: resolved.pinned.filter((key) => key !== SIDEBAR_PINNED_ANCHOR), more: [...resolved.more] };
}

function withoutSidebarKey(keys: readonly string[], key: string): string[] {
  return keys.filter((candidate) => candidate !== key);
}

/**
 * Moves an entry into the inline list, at the end. Refuses when it is already
 * there, is the locked anchor, or the limit is reached — silently ignoring a
 * full list beats evicting an entry the user did not choose to lose.
 */
export function pinSidebarNavItem(resolved: ResolvedSidebarNavLayout, key: string, pinnedLimit: number): ResolvedSidebarNavLayout {
  if (SIDEBAR_LOCKED_KEYS.has(key)) return resolved;
  if (resolved.pinned.includes(key) || !resolved.more.includes(key)) return resolved;
  if (!canPinSidebarNavItem(resolved, pinnedLimit)) return resolved;
  return { pinned: [...resolved.pinned, key], more: withoutSidebarKey(resolved.more, key) };
}

/** Moves an entry back into "More", first, so it is visible where it landed. */
export function unpinSidebarNavItem(resolved: ResolvedSidebarNavLayout, key: string): ResolvedSidebarNavLayout {
  if (SIDEBAR_LOCKED_KEYS.has(key) || !resolved.pinned.includes(key)) return resolved;
  return { pinned: withoutSidebarKey(resolved.pinned, key), more: [key, ...resolved.more] };
}

/**
 * Puts an entry into a region, before `beforeKey` (null = at the end).
 * The locked anchor keeps the first inline slot and the limit is enforced here,
 * so the pointer and the keyboard cannot arrange the sidebar differently.
 */
export function moveSidebarNavItem(
  resolved: ResolvedSidebarNavLayout,
  key: string,
  region: "pinned" | "more",
  beforeKey: string | null,
  pinnedLimit: number,
): ResolvedSidebarNavLayout {
  if (SIDEBAR_LOCKED_KEYS.has(key)) return resolved;
  if (!resolved.pinned.includes(key) && !resolved.more.includes(key)) return resolved;
  if (region === "pinned" && !resolved.pinned.includes(key) && !canPinSidebarNavItem(resolved, pinnedLimit)) return resolved;

  const pinned = withoutSidebarKey(resolved.pinned, key);
  const more = withoutSidebarKey(resolved.more, key);
  const target = region === "pinned" ? pinned : more;
  const index = beforeKey === null ? -1 : target.indexOf(beforeKey);
  const at = index < 0 ? target.length : index;
  // The anchor occupies the first inline slot; insertions are clamped past it.
  target.splice(region === "pinned" ? Math.max(1, at) : at, 0, key);
  return { pinned, more };
}

export interface AppPreferences {
  locale: "zh-CN" | "en-US";
  theme: "light" | "dark" | "system";
  fontScale: number;
  reduceMotion: boolean;
  notifications: NotificationPreferences;
  security: SecurityPreferences;
  appearance: AppearancePreferences;
  defaultWorkspaceRoot: string;
  defaultModel: ModelReference | null;
  entryModels: Record<string, ModelReference>;
  translation: TranslationPreferences;
  shortcuts: ShortcutPreferences;
  sidebar: SidebarPreferences;
}

/** Languages offered for translation; the label is resolved by the interface locale. */
export const TRANSLATION_LANGUAGE_IDS = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "pt",
  "ru",
  "it",
  "ar",
] as const;

export type TranslationLanguageId = (typeof TRANSLATION_LANGUAGE_IDS)[number];

export function isTranslationLanguageId(value: unknown): value is TranslationLanguageId {
  return typeof value === "string" && (TRANSLATION_LANGUAGE_IDS as readonly string[]).includes(value);
}

/**
 * Resolves the language a translation should target.
 *
 * An explicit preference wins; otherwise the interface language is used, which
 * matches the behaviour users expect from a translate action: foreign-language
 * output comes back in the language they read the interface in.
 */
export function resolveTranslationTargetLanguage(
  preferences: Pick<AppPreferences, "locale" | "translation">,
): TranslationLanguageId {
  const configured = preferences.translation?.targetLanguage;
  if (isTranslationLanguageId(configured)) return configured;
  return preferences.locale === "en-US" ? "en-US" : "zh-CN";
}

export interface SessionDraft {
  mode: WorkbenchMode;
  entryId: string;
  title?: string;
  workspaceId: string | null;
  accessLevel: SessionAccessLevel;
  model: ModelReference | null;
  thinkingLevel?: ThinkingLevel;
  connectorIds?: string[];
  interactionMode?: AgentInteractionModeId;
  toolApprovalMode?: ToolApprovalMode;
  presentation?: PresentationLaunchOptions;
  expertSelection?: ExpertSelection;
  source?: string;
}

export type AutomationSchedule =
  | {
      kind: "recurring";
      cadence: "daily" | "weekdays" | "weekly" | "monthly";
      time: string;
      weekdays?: number[];
      dayOfMonth?: number;
    }
  | { kind: "interval"; every: number; unit: "minutes" | "hours" | "days" }
  | { kind: "once"; at: number };

export interface AutomationConfiguration {
  prompt: string;
  entryId: string;
  workspaceId: string | null;
  /** Linked history session; null = each run creates a new session. */
  sessionId: string | null;
  accessLevel: SessionAccessLevel;
  toolApprovalMode: ToolApprovalMode;
  model: ModelReference | null;
  thinkingLevel: ThinkingLevel;
  skillIds: string[];
  connectorIds: string[];
}

export interface AutomationTask extends AutomationConfiguration {
  id: string;
  name: string;
  /**
   * Per-task push override. Absent means "use the global defaults"; present means
   * the task decides, with any field it omits falling back to the defaults.
   */
  notification?: NotificationSubscription;
  schedule: AutomationSchedule;
  activeFrom: number | null;
  activeUntil: number | null;
  enabled: boolean;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "configuration-error"
  | "interrupted";

export interface AutomationRun {
  id: string;
  automationId: string | null;
  automationName: string;
  configuration: AutomationConfiguration;
  scheduledFor: number;
  sessionId: string | null;
  status: AutomationRunStatus;
  error: string | null;
  /**
   * Why the push notification failed, when one was attempted and did not arrive.
   *
   * Written *after* the terminal status above, by a second update. Delivery is
   * asynchronous and must not sit on the completion path — a webhook that hangs for
   * 30s would otherwise delay the run itself appearing as finished.
   */
  notifyError?: NotificationFailure;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface AutomationTaskInput extends AutomationConfiguration {
  name: string;
  notification?: NotificationSubscription;
  schedule: AutomationSchedule;
  activeFrom: number | null;
  activeUntil: number | null;
  enabled: boolean;
}

export type ClarificationQuestionAnswerType = "choice" | "text" | "confirm";

export interface ClarificationQuestionOption {
  value: string;
  label: string;
  description?: string;
}

export interface ClarificationQuestion {
  question: string;
  context?: string;
  answerType: ClarificationQuestionAnswerType;
  options?: ClarificationQuestionOption[];
  recommendation: {
    answer: string;
    value?: string;
    reason: string;
  };
  allowCustom?: boolean;
  purpose: "discovery" | "final-confirmation";
}

export interface ClarificationQuestionAnswer {
  callId: string;
  value: string | boolean;
  submittedAt: number;
}

export interface ClarificationBriefDecision {
  topic: string;
  outcome: string;
  rationale?: string;
}

export interface ClarificationBrief {
  title: string;
  summary: string;
  goals: string[];
  constraints: string[];
  decisions: ClarificationBriefDecision[];
  openQuestions: string[];
  recommendedNextStep: string;
}

export type UserPromptPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "skill-reference";
      skillId: string;
      name: string;
      source: SkillSource;
    }
  | {
      type: "workspace-reference";
      path: string;
      name: string;
      kind: "file" | "directory";
    }
  /**
   * 用户在画布的色彩系统面板上点选的**主题令牌**。
   *
   * 与 `workspace-reference` 分开,是因为它要送进模型的东西不同:文件引用说明"看这个文件",
   * 而令牌引用要说明"用户指的是**这个**令牌" —— 用户看到的是一块颜色,他说不出 `--color-primary`
   * 这个名字,而 `path` 已经在设计画像里告诉过模型了(令牌都在 `theme.css`)。
   *
   * `name` 是**完整变量名**(带 `--color-` 前缀),`value` 是文件里的原值 —— 两个都给,模型不必
   * 先去读文件才能知道用户指的是哪一个。
   */
  | {
      type: "theme-token-reference";
      path: string;
      name: string;
      value: string;
    }
  /**
   * 用户在新建成页挑的那套**内置风格**。
   *
   * 与 `workspace-reference` / `theme-token-reference` 都不同:那两个指着**已经存在的文件**,
   * 而这一个只带一个 id —— 资料的落盘由 `design_create` 的 `styleId` 参数(或
   * `design_style_apply`)在**设计包里**完成,主进程做,不需要先往任何地方写一份再让 agent 抄。
   *
   * 它存在只为一件事:**把用户的选择说出来**(§14.22)。风格到底应用没应用,判定看的是设计包的
   * `manifest.style`,不是这条消息。
   */
  | {
      type: "design-style";
      styleId: string;
    }
  | {
      type: "artifact-reference";
      artifactId: string;
      kind: ArtifactKind;
      name: string;
      revision: number;
      surfaceId: string;
      locator: string;
      locators?: string[];
      intent?: "reference" | "analyze" | "formula" | "chart" | "pivot";
    };

export interface UserMessageSubmission {
  messageId: string;
  submittedAt: number;
}

export interface PromptSessionOptions {
  connectorIds?: string[];
  taskId?: string;
  attachments?: PromptAttachmentInput[];
}

export type PromptAttachmentInput = {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  source:
    | { type: "path"; path: string }
    | { type: "bytes"; base64: string };
};

export interface MessageTextBlock {
  type: "text";
  text: string;
}

export interface MessageReasoningBlock {
  type: "reasoning";
  text: string;
}

export type TaskStatus = "todo" | "in-progress" | "review" | "done";
export type TaskExecutionStatus =
  | "idle"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "interrupted";

export interface TaskExecutionState {
  status: TaskExecutionStatus;
  sessionId: string | null;
  messageId: string | null;
  runId: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

export interface TaskRecord {
  id: string;
  title: string;
  detailParts: UserPromptPart[];
  expectedResult?: string;
  status: TaskStatus;
  priority?: "low" | "medium" | "high";
  dueAt: number | null;
  completedAt: number | null;
  position: number;
  entryId: string | null;
  expertSelection?: ExpertSelection;
  workspaceId: string | null;
  sessionId: string | null;
  model: ModelReference | null;
  thinkingLevel: ThinkingLevel;
  accessLevel: SessionAccessLevel;
  toolApprovalMode: ToolApprovalMode;
  connectorIds: string[];
  execution: TaskExecutionState;
  createdAt: number;
  updatedAt: number;
}

export type TaskRecordInput = Omit<
  TaskRecord,
  "id" | "execution" | "createdAt" | "updatedAt" | "position" | "completedAt"
> & { position?: number };

export interface MessageToolSource {
  kind: "mcp";
  connectorId: string;
  connectorName: string;
  toolName: string;
  templateId: ConnectorTemplateId;
  transport: ConnectorTransport;
}

export interface MessageToolBlock {
  type: "tool";
  callId: string;
  name: string;
  source?: MessageToolSource;
  state:
    | "pending"
    | "awaiting-approval"
    | "awaiting-user-input"
    | "running"
    | "complete"
    | "error";
  startedAt?: number;
  /** Wall-clock end time, set by the live renderer when the tool completes. Not persisted by the journal. */
  completedAt?: number;
  timeoutSeconds?: number;
  input?: Record<string, unknown>;
  output?: string;
  outputTruncated?: boolean;
  details?: unknown;
  usage?: ConversationUsage;
  approval?: ToolOperationApproval;
  userRequest?: MessageUserRequest;
}

export type ResearchDelegationTaskStatus =
  | "queued"
  | "running"
  | "awaiting-approval"
  | "awaiting-user-input"
  | "completed"
  | "failed"
  | "cancelled";

export interface ResearchDelegationEvent {
  id: string;
  kind: "tool" | "status";
  label: string;
  state?: "running" | "complete" | "error";
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  inputSummary?: string;
  outputPreview?: string;
}

export interface ResearchDelegationTask {
  taskId: string;
  dimensionId: string;
  dimensionName: string;
  question: string;
  agent: "researcher" | "research-reviewer";
  status: ResearchDelegationTaskStatus;
  startedAt?: number;
  completedAt?: number;
  activeTool?: {
    callId?: string;
    name: string;
    state: "running" | "complete" | "error";
    inputSummary?: string;
    outputPreview?: string;
  };
  events: ResearchDelegationEvent[];
  output?: string;
  error?: string;
  usage?: ConversationUsage;
  approval?: unknown;
  userRequest?: unknown;
}

export interface ResearchDelegationDetails extends Record<string, unknown> {
  version: 1;
  analysisId: string;
  mode: "parallel" | "sequential";
  startedAt: number;
  updatedAt: number;
  tasks: ResearchDelegationTask[];
}

export type ToolOperationApprovalPreview =
  | {
      type: "external-access";
      paths: string[];
      workspaceRoot: string;
      operation: "read" | "write" | "list" | "execute";
    }
  | {
      type: "diff";
      path: string;
      before: string;
      after: string;
      truncated: boolean;
    }
  | {
      type: "command";
      command: string;
      cwd: string;
      timeoutSeconds: number | undefined;
    }
  | {
      type: "connector";
      connectorId: string;
      connectorName: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | {
      type: "spreadsheet";
      artifactId: string;
      workbookName: string;
      affectedSheets: string[];
      changes: Array<{
        kind: "cell" | "range" | "structure";
        locator: string;
        before?: string;
        after?: string;
        summary: string;
      }>;
      truncated: boolean;
    };

export interface ToolOperationApproval {
  approvalId: string;
  status: "required" | "approved" | "rejected";
  risk: "file-write" | "command" | "connector" | "workspace-access";
  severity: "normal" | "high";
  summary: string;
  preview: ToolOperationApprovalPreview;
  matchedRules: ToolSecurityRuleMatch[];
  requiresElevation?: boolean;
  feedback?: string;
}

export interface ToolSecurityRuleMatch {
  category: "file" | "command";
  id: string;
  label: string;
  source: SecurityRuleSource;
}

export interface UserRequestOption {
  value: string;
  label: string;
  description?: string;
}

interface UserRequestFieldBase {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface UserRequestSelectField extends UserRequestFieldBase {
  type: "select";
  options: UserRequestOption[];
  defaultValue?: string;
  allowCustom?: boolean;
}

export interface UserRequestMultiSelectField extends UserRequestFieldBase {
  type: "multi-select";
  options: UserRequestOption[];
  defaultValue?: string[];
  allowCustom?: boolean;
}

export interface UserRequestTextField extends UserRequestFieldBase {
  type: "text";
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
}

export interface UserRequestConfirmField extends UserRequestFieldBase {
  type: "confirm";
  defaultValue?: boolean;
}

export type UserRequestField =
  | UserRequestSelectField
  | UserRequestMultiSelectField
  | UserRequestTextField
  | UserRequestConfirmField;

export type UserRequestAnswer = string | string[] | boolean;

export interface UserRequest {
  requestId: string;
  callId: string;
  toolName: string;
  title: string;
  description?: string;
  fields: UserRequestField[];
}

export interface UserRequestResolution {
  requestId: string;
  status: "submitted" | "cancelled";
  answers?: Record<string, UserRequestAnswer>;
  feedback?: string;
}

export interface MessageUserRequest {
  request: UserRequest;
  resolution?: UserRequestResolution;
}

export interface MessageAttachmentBlock {
  type: "attachment";
  id: string;
  name: string;
  mediaType: string;
  path?: string;
  previewPath?: string;
  size?: number;
}

export interface MessageSkillReferenceBlock {
  type: "skill-reference";
  id: string;
  skillId: string;
  name: string;
  source: SkillSource;
}

export interface MessageWorkspaceReferenceBlock {
  type: "workspace-reference";
  id: string;
  path: string;
  name: string;
  kind: "file" | "directory";
}

/** 用户消息里的主题令牌引用。渲染成"色点 + 变量名"。 */
export interface MessageThemeTokenBlock {
  type: "theme-token";
  id: string;
  path: string;
  name: string;
  value: string;
}

/**
 * 用户在新建成页挑的风格。
 *
 * 只带 id:显示名按当前语言从 i18n 取(`DESIGN_STYLE_NAME_KEYS`),所以这里**不冻结**任何语言
 * 相关的文案 —— 冻结了的话,切换界面语言之后老消息会停在旧语言里。
 */
export interface MessageDesignStyleBlock {
  type: "design-style";
  id: string;
  styleId: string;
}

export interface MessageArtifactBlock {
  type: "artifact";
  artifactId: string;
  kind: string;
  name: string;
  revision?: number;
  surfaceId?: string;
  locator?: string;
}

export type MessageBlock =
  | MessageTextBlock
  | MessageReasoningBlock
  | MessageToolBlock
  | MessageAttachmentBlock
  | MessageSkillReferenceBlock
  | MessageWorkspaceReferenceBlock
  | MessageThemeTokenBlock
  | MessageDesignStyleBlock
  | MessageArtifactBlock;

/**
 * 缓存观测级别:provider 这**一次**调用有没有上报缓存读写的明细。
 *
 * 之所以必须有这个字段:token 直接关系计费,而"`cacheRead` 为 0"有三张面孔 —— 真的没命中、
 * provider 压根没上报、这个模型没有缓存。没有这个字段,三者会被压成同一个 0,界面上就出现了
 * 一个假的"命中率 0%"。
 *
 * 缺省(字段不存在)= `unavailable`:历史记录天生如此,也是保守的那一侧。
 */
export type CacheUsageReporting = "unavailable" | "read-only" | "read-write";

export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  /**
   * **逐条调用**的缓存观测级别。只有原始模型调用的记录带它;聚合结果不写这一项,而是带下面
   * 那组累计计数(见 `observationOf`)。
   */
  cacheUsageReporting?: CacheUsageReporting;
  /**
   * **逐条调用**:provider 自己报告的 prompt 总数,独立于我们归一化出来的分量。
   *
   * 只用于对账。归一化时我们会把 cached 从 prompt 里减掉(见 `packages/ai` 各适配器),
   * 一旦 provider 的数字不自洽,差额会被 `Math.max(0, …)` 静默吞掉 —— 有了这个自报值,
   * 才能分清"我们算错了"和"provider 自己不自洽"。
   */
  reportedPromptTokens?: number;
  /**
   * 以下六项是**聚合字段**:合并多条用量时累计,逐条记录不写。
   *
   * 它们存在的唯一理由:命中率只允许在"可观测到缓存读"的调用上求和(I2/I3)。如果聚合时
   * 丢掉这个区分,分母就会退化成"凭运气",命中率会随合并路径变化。
   */
  cacheReadObservedCalls?: number;
  cacheWriteObservedCalls?: number;
  cacheReadObservedPromptTokens?: number;
  cacheWriteObservedPromptTokens?: number;
  /** 可观测到的缓存读 token 之和 —— 命中率的**分子**(不是 `cacheReadTokens`,见 `summarizeTokenUsage`)。 */
  cacheReadObservedTokens?: number;
  /** 可观测到的缓存写 token 之和 —— 与 `cacheReadObservedTokens` 对称。 */
  cacheWriteObservedTokens?: number;
  /** `cacheRead > 0` 的调用数,用于调用级命中率。 */
  cacheHitCalls?: number;
}

export type UsageGroupBy = "provider" | "model";

export type UsageMetric = "cost" | "tokens" | "requests";

export type UsageBucket = "hour" | "day" | "week" | "month";

export type UsageModelKind = "chat" | "image";

export interface UsageReportQuery {
  startAt: number;
  endAt: number;
  groupBy: UsageGroupBy;
}

export interface UsageAggregate {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCost: number;
  requestCount: number;
  incompleteUsageCount: number;
  unmeteredOperationCount: number;
}

export interface UsageGroup {
  key: string;
  providerId: string;
  modelId: string | null;
  modelKind: UsageModelKind | "mixed";
  usage: UsageAggregate;
}

export interface UsageTrendValue {
  groupKey: string;
  usage: UsageAggregate;
}

export interface UsageTrendPoint {
  startAt: number;
  values: UsageTrendValue[];
}

export interface UsageReport {
  query: UsageReportQuery;
  bucket: UsageBucket;
  generatedAt: number;
  totals: UsageAggregate;
  groups: UsageGroup[];
  trend: UsageTrendPoint[];
}

export interface SessionTurnUsage extends ConversationUsage {
  primaryCallCount: number;
  toolCallCount: number;
}

export interface SessionContextUsageCategories {
  systemPrompt: number;
  toolsAndSubagents: number;
  conversation: number;
  connectors: number;
  skills: number;
}

export interface SessionContextUsage {
  contextWindow: number;
  usedTokens: number;
  source: "provider" | "tokenizer" | "estimate";
  categories: SessionContextUsageCategories;
}

export type ContextCompactionTrigger = "manual" | "automatic" | "overflow";

export interface ContextCompactionRecord {
  id: string;
  timestamp: number;
  trigger: ContextCompactionTrigger;
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
  model: ModelReference;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  status: "streaming" | "complete" | "error" | "aborted";
  blocks: MessageBlock[];
  model: ModelReference | null;
  timestamp: number;
  usage?: ConversationUsage;
  errorMessage?: string;
}

export interface ModelRetryState {
  attempt: number;
  maxRetries: number;
  scheduledAt: number;
  retryAt: number;
  delayMs: number;
  errorMessage: string;
  failedMessageId: string;
}

/// Message push (group-robot webhooks)
///
/// The host POSTs task-completion messages to group robots the user created in
/// Feishu / DingTalk / WeCom. Nothing here receives messages — that is what makes
/// this affordable next to the IM gateway (docs/architecture/message-push.md).
///
/// Unlike the proxy, which is a single record, an endpoint is a *collection*, so
/// this owns a Settings page of its own.
///
/// Credentials deliberately do not appear anywhere in this section: the URL and
/// the sign secret live in the OS credential vault and never reach the renderer.
/// `WebhookEndpointPublic` carries a mask and a boolean instead.

export type WebhookKind = "feishu" | "dingtalk" | "wecom";

export type WebhookMessageLevel = "info" | "warn" | "error" | "success";

export interface WebhookAttachment {
  /** Absolute local path. Providers read the bytes; callers never do. */
  path: string;
  name: string;
  kind: "image" | "file";
  sizeBytes: number;
}

/**
 * The provider-neutral message contract. Each provider maps it to its own wire
 * schema (Feishu prefers an interactive card, DingTalk markdown, ...).
 *
 * `attachments` exists from the first version even though only WeCom can deliver
 * files: whether a platform can carry an attachment is a provider *capability*,
 * and a message type without the field would force every provider, the approval
 * preview and the settings form to change the day file delivery lands.
 *
 * Providers that cannot carry an attachment must degrade *visibly* — see
 * `degradeAttachments` in the main process. Silently dropping one would let us
 * report "sent" for something the user never received.
 */
export interface WebhookMessage {
  title?: string;
  /** Markdown. Providers decide how much of it their platform can render. */
  text: string;
  level?: WebhookMessageLevel;
  attachments?: WebhookAttachment[];
}

/**
 * Per-provider non-secret options.
 *
 * Kept as an opaque blob on purpose. Its true type is `unknown` — it comes back
 * from a JSON file — and each provider owns a schema for it, so adding a channel
 * adds no field here. Everywhere else the options are carried through untouched.
 */
export type WebhookOptions = Record<string, unknown>;

/** A field a provider needs in order to send, so the form can be provider-driven. */
export interface WebhookCredentialField {
  key: "url" | "signSecret";
  required: boolean;
  /** Tells the user what a valid URL starts with, e.g. the platform's hook prefix. */
  urlHint?: string;
  /** Rendered as a password input and stripped from logs. */
  secret: boolean;
}

/**
 * What a provider's platform can do.
 *
 * This is the only place upper layers are allowed to branch on platform
 * differences. There must be no `kind === "wecom"` outside a provider file:
 * rate limiting, attachment degradation, length truncation and mention syntax
 * differences are all driven from here.
 */
export interface WebhookProviderCapabilities {
  /** Whether the platform offers a request signature at all. WeCom does not. */
  supportsSign: boolean;
  supportsImage: boolean;
  supportsFile: boolean;
  supportsMentionAll: boolean;
  supportsMentionByMobile: boolean;
  /**
   * Character ceiling, for platforms that document their limit that way.
   *
   * The units genuinely differ: Feishu caps the request body in bytes, WeCom caps
   * the body in bytes, and **DingTalk caps it in characters**. A byte ceiling alone
   * is wrong for DingTalk in both directions — 4000 Chinese characters is 12000
   * bytes, so a 4000-byte cap throws away two thirds of what the platform allows,
   * while a 12000-byte cap lets pure ASCII through at 12000 characters and gets
   * rejected. Both ceilings apply; whichever binds first wins.
   */
  maxTextChars?: number;

  /** Body limit in *bytes*, not characters. Chinese text is 3 bytes per character. */
  maxTextBytes: number;
  maxTitleBytes: number;
  /** Platform messages per minute; undefined when unknown. */
  maxMessagesPerMinute?: number;
  supportsMarkdown: boolean;
}

/**
 * What the settings page needs to render a channel without knowing any of them.
 *
 * There is deliberately no label here. A label would have to be an i18n key
 * carried as a plain string, which nothing can verify — one typo on the main side
 * and the user sees a raw key. Labels live in the i18n layer, where the renderer
 * maps the kind through an exhaustive `Record<WebhookKind, MessageKey>` and the
 * compiler checks it.
 */
export interface WebhookProviderDescriptor {
  kind: WebhookKind;
  iconClass?: string;
  credentialFields: WebhookCredentialField[];
  capabilities: WebhookProviderCapabilities;
}

/** The part of an endpoint safe to send to the renderer, logs and agent context. */
export interface WebhookEndpointPublic {
  id: string;
  kind: WebhookKind;
  name: string;
  enabled: boolean;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Protocol + host + the last 4 characters, so the user can tell rows apart. */
  urlMask?: string;
  /** Whether a sign secret is stored. The value itself is never exposed. */
  hasSignSecret: boolean;
  options: WebhookOptions;
}

/** Held by the main process only. */
export interface WebhookEndpointSecret {
  url: string;
  signSecret?: string;
}

/**
 * Why a stored endpoint cannot be used.
 *
 * Codes rather than sentences: the message has to be translated, searchable in
 * logs, and classifiable by the UI ("the address is wrong" is shown inline on the
 * field, "the platform refused" belongs next to the send button).
 */
export type WebhookValidationErrorCode =
  | "url-empty"
  | "url-not-https"
  | "url-http-not-allowed"
  | "url-bad-format"
  | "url-wrong-host"
  | "url-wrong-path"
  | "url-missing-token"
  | "url-token-too-short"
  | "sign-secret-required"
  | "sign-secret-unexpected"
  | "options-invalid";

export type WebhookValidationResult =
  | { ok: true }
  | { ok: false; code: WebhookValidationErrorCode; detail?: string };

/**
 * Why a send failed. `detail` carries the platform's own wording, for the log and
 * a "details" affordance — never the primary message.
 */
export type WebhookSendErrorCode =
  | "url-invalid"
  | "credentials-missing"
  | "timeout"
  | "http-error"
  | "response-unparsable"
  | "platform-rejected"
  | "rate-limited"
  | "attachment-unsupported"
  | "attachment-too-large"
  | "attachment-upload-failed"
  | "unknown";

export type WebhookSendResult =
  | {
      ok: true;
      platformMessageId?: string;
      /** Set when something was left out of the delivered message. */
      degraded?: "attachment-dropped" | "truncated";
    }
  | { ok: false; code: WebhookSendErrorCode; detail?: string };

export interface WebhookDispatchResult {
  id: string;
  kind: WebhookKind;
  name: string;
  ok: boolean;
  code?: WebhookSendErrorCode;
  detail?: string;
}

/**
 * Outcome of creating or editing an endpoint.
 *
 * A typed failure rather than a thrown error: the renderer needs the code to
 * show *which* field is wrong and why, and a generic "the operation failed" is
 * exactly what the typed codes exist to avoid.
 */
export type WebhookMutationErrorCode =
  | WebhookValidationErrorCode
  /** The row disappeared underneath the form — most often a second window. */
  | "endpoint-not-found"
  /** This build cannot send through that channel. */
  | "unsupported-kind";

export type WebhookMutationResult =
  | { ok: true; endpoint: WebhookEndpointPublic }
  | { ok: false; code: WebhookMutationErrorCode; detail?: string };

/**
 * Why a push did not arrive.
 *
 * A code rather than a sentence, matching the send errors: the run list shows a
 * translated message, and the raw platform wording is kept aside for the log.
 * `no-endpoint` is the case where the task asked to be pushed and there was
 * nothing usable to push to.
 */
export interface NotificationFailure {
  code: WebhookSendErrorCode | "no-endpoint";
  detail?: string;
}

/**
 * One thing worth telling the user about, produced by whatever finished.
 *
 * Shaped after the *event*, not after any single producer: the notification bus
 * knows how to resolve a subscription, apply a template and truncate for the
 * target platform once, so adding a producer is one `emit` call.
 */
export interface NotificationEvent {
  /**
   * Idempotency key. The same run must never be announced twice, and the terminal
   * branch that produces this event can fire more than once for one run.
   */
  eventId: string;
  kind: "automation.finished" | "batch.finished" | "agent.notify";
  /** Stable id of the producer, used for subscription lookup. */
  sourceId: string;
  /**
   * The session the run used, when the producer knows it.
   *
   * Only needed to fetch the reply for `{{reply}}`, and only then.
   */
  sessionId?: string | null;
  /**
   * How the run ended. Carried explicitly rather than inferred from `level`,
   * because the `when` filter has to tell `failed` from `configuration-error`,
   * and both are "an error" to a card.
   */
  status: AutomationRunStatus;
  title: string;
  /**
   * A finished body, for a producer that writes its own message (the agent, later).
   * When absent the body is rendered from the subscription's template and `context`.
   */
  text?: string;
  /** Defaults to whatever `status` implies; set it to override the card's colour. */
  level?: WebhookMessageLevel;
  attachments?: WebhookAttachment[];
  /** Variables a user-editable template may reference. */
  context: Record<string, string | number | undefined>;
  at: string;
}

/**
 * Per-producer override. A producer with `enabled` and no `endpointIds` falls back
 * to the global defaults, so "notify me about every failure" does not require
 * editing every automation.
 */
export interface NotificationSubscription {
  enabled: boolean;
  endpointIds: string[];
  when: "always" | "success" | "failure";
  /** User-editable template with {{variables}}. Absent means the built-in one. */
  template?: string;
}

export interface NotificationDefaults {
  enabled: boolean;
  endpointIds: string[];
  when: "always" | "success" | "failure";
  /** Absent means the built-in default, rendered by the renderer at save time. */
  template?: string;
}

/**
 * A template problem, kept separate from `WebhookValidationErrorCode`: those are
 * about an address, this is about a message body.
 */
export type NotificationTemplateErrorCode = "template-unknown-variable" | "template-empty";

export type NotificationDefaultsResult =
  | { ok: true; defaults: NotificationDefaults }
  | { ok: false; code: NotificationTemplateErrorCode; detail?: string };

/**
 * 把适配器形状的 usage(`input` / `output` / `cacheRead` / `cacheWrite` / `totalTokens` / `cost.total`)
 * 折算成 `ConversationUsage`。
 *
 * 这个映射以前有**三份逐字重复**的实现(`runtime`、`agent-driver-generic`、`usage-report`),
 * 而且全零判断并不一致:两份返回 `undefined`,一份把全零当成一次"成功但没有用量"的调用。
 * 计费敏感的路径上不该有三份判断,所以只留这一份。
 *
 * 全零一律返回 `undefined`:一次真实调用即使把 token 用成 0,也应该是"没有用量数据"而不是
 * "确实花了 0" —— 否则汇总里会多出一次假的成功调用。
 */
export function conversationUsageFromAiUsage(
  value: unknown,
): ConversationUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const usage = value as Record<string, unknown>;
  const cost =
    typeof usage.cost === "object" && usage.cost !== null
      ? (usage.cost as Record<string, unknown>)
      : undefined;
  const inputTokens = typeof usage.input === "number" ? usage.input : 0;
  const outputTokens = typeof usage.output === "number" ? usage.output : 0;
  const cacheReadTokens =
    typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
  const cacheWriteTokens =
    typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
  const totalTokens =
    typeof usage.totalTokens === "number"
      ? usage.totalTokens
      : typeof usage.total === "number"
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
  const result: ConversationUsage = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalCost,
  };
  const reporting = optionalCacheUsageReporting(usage.cacheUsageReporting);
  if (reporting !== undefined) result.cacheUsageReporting = reporting;
  const reportedPromptTokens = optionalNonNegativeNumber(
    usage.reportedPromptTokens,
  );
  if (reportedPromptTokens !== undefined)
    result.reportedPromptTokens = reportedPromptTokens;
  return result;
}

/** 逐条调用的可选事实:非法值一律当"没有",而不是当 0 —— 0 是一个有含义的值。 */
function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function optionalCacheUsageReporting(
  value: unknown,
): CacheUsageReporting | undefined {
  return value === "unavailable" || value === "read-only" || value === "read-write"
    ? value
    : undefined;
}

/** 可选数值字段(`reportedPromptTokens` 与那组聚合计数)。 */
const OPTIONAL_USAGE_NUMBER_KEYS = [
  "reportedPromptTokens",
  "cacheReadObservedCalls",
  "cacheWriteObservedCalls",
  "cacheReadObservedPromptTokens",
  "cacheWriteObservedPromptTokens",
  "cacheReadObservedTokens",
  "cacheWriteObservedTokens",
  "cacheHitCalls",
] as const;

export function conversationUsageFromUnknown(
  value: unknown,
): ConversationUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const usage = value as Record<string, unknown>;
  if (
    typeof usage.inputTokens !== "number" ||
    typeof usage.outputTokens !== "number" ||
    typeof usage.cacheReadTokens !== "number" ||
    typeof usage.cacheWriteTokens !== "number" ||
    typeof usage.totalTokens !== "number" ||
    typeof usage.totalCost !== "number"
  ) {
    return undefined;
  }
  const result: ConversationUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    totalCost: usage.totalCost,
  };
  const reporting = optionalCacheUsageReporting(usage.cacheUsageReporting);
  if (reporting !== undefined) result.cacheUsageReporting = reporting;
  for (const key of OPTIONAL_USAGE_NUMBER_KEYS) {
    const parsed = optionalNonNegativeNumber(usage[key]);
    if (parsed !== undefined) result[key] = parsed;
  }
  return result;
}

/**
 * prompt 的分量口径:`input` / `cacheRead` / `cacheWrite` **互斥**,三者之和才是 prompt。
 * `output` 永不进任何 prompt 分母(它不属于请求)。
 */
export function promptTokensOf(
  usage: Pick<
    ConversationUsage,
    "inputTokens" | "cacheReadTokens" | "cacheWriteTokens"
  >,
): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

function readsObserved(reporting: CacheUsageReporting | undefined): boolean {
  return reporting === "read-only" || reporting === "read-write";
}

function writesObserved(reporting: CacheUsageReporting | undefined): boolean {
  return reporting === "read-write";
}

interface UsageObservation {
  readCalls: number;
  writeCalls: number;
  readPromptTokens: number;
  writePromptTokens: number;
  readTokens: number;
  writeTokens: number;
  hitCalls: number;
}

/**
 * 把一条用量折算成"观测计数"。两种输入形态都吃:
 *
 * - **逐条调用**记录:带 `cacheUsageReporting`,按它折算成 0 或 1;
 * - **聚合**记录:带累计计数,原样读出。
 *
 * 这是 I2/I3 的唯一实现处:未上报的调用**不进**命中率的分子分母,但仍进调用数与覆盖率的
 * 分母 —— 也就是说"没上报"会让覆盖率下降,而不会伪装成"没命中"。
 */
function observationOf(usage: ConversationUsage): UsageObservation {
  const reporting = usage.cacheUsageReporting;
  if (reporting !== undefined) {
    const promptTokens = promptTokensOf(usage);
    const read = readsObserved(reporting);
    const write = writesObserved(reporting);
    return {
      readCalls: read ? 1 : 0,
      writeCalls: write ? 1 : 0,
      readPromptTokens: read ? promptTokens : 0,
      writePromptTokens: write ? promptTokens : 0,
      readTokens: read ? usage.cacheReadTokens : 0,
      writeTokens: write ? usage.cacheWriteTokens : 0,
      hitCalls: read && usage.cacheReadTokens > 0 ? 1 : 0,
    };
  }
  return {
    readCalls: usage.cacheReadObservedCalls ?? 0,
    writeCalls: usage.cacheWriteObservedCalls ?? 0,
    readPromptTokens: usage.cacheReadObservedPromptTokens ?? 0,
    writePromptTokens: usage.cacheWriteObservedPromptTokens ?? 0,
    readTokens: usage.cacheReadObservedTokens ?? 0,
    writeTokens: usage.cacheWriteObservedTokens ?? 0,
    hitCalls: usage.cacheHitCalls ?? 0,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** 合并后的观测计数;为 0 的项一律省略(缺省读出来就是 0)。 */
function observationCountFields(
  left: UsageObservation,
  right: UsageObservation,
): Partial<ConversationUsage> {
  const sums: Array<[keyof ConversationUsage, number]> = [
    ["cacheReadObservedCalls", left.readCalls + right.readCalls],
    ["cacheWriteObservedCalls", left.writeCalls + right.writeCalls],
    ["cacheReadObservedPromptTokens", left.readPromptTokens + right.readPromptTokens],
    ["cacheWriteObservedPromptTokens", left.writePromptTokens + right.writePromptTokens],
    ["cacheReadObservedTokens", left.readTokens + right.readTokens],
    ["cacheWriteObservedTokens", left.writeTokens + right.writeTokens],
    ["cacheHitCalls", left.hitCalls + right.hitCalls],
  ];
  const result: Partial<ConversationUsage> = {};
  for (const [key, value] of sums) {
    if (value > 0) (result as Record<string, number>)[key] = value;
  }
  return result;
}

export function mergeConversationUsage(
  current: ConversationUsage | undefined,
  next: ConversationUsage | undefined,
): ConversationUsage | undefined {
  if (!current) return next ? { ...next } : undefined;
  if (!next) return { ...current };
  const left = observationOf(current);
  const right = observationOf(next);
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    cacheReadTokens: current.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + next.cacheWriteTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    totalCost: current.totalCost + next.totalCost,
    // 观测计数是**可加**的聚合事实,合并时必须带上 —— 否则"只对可观测的调用求分母"这条
    // 就退化了:命中率会随合并路径变化(先合并再总结 ≠ 先总结再合并)。
    //
    // 计数为 0 时**不写**这个字段:读到的默认值就是 0,语义没有任何变化,而"一次都没观测到"
    // 的记录可以和普通记录逐字段相等 —— 不会凭空给每个聚合结果加一堆 0。
    ...observationCountFields(left, right),
    // 逐条事实合并后不再有唯一答案,一律清掉;缺省 = 未上报,是保守的一侧。
    // `reportedPromptTokens` 同理:两个来源不同的自报数相加没有意义。
  };
}

/**
 * 缓存**写入**的可观测状态。用它而不是"写入覆盖率 0%"来说话 —— 后者字面上没错
 * (确实没有调用上报过写入),但在界面上会被读成"写入占比 0%",而真实含义是
 * "这些调用根本不报写入"(只读上报),或者"什么都没上报"。
 */
export type CacheWriteObservation = "reported" | "read-only" | "unavailable";

export interface TokenUsageSummary {
  /** 参与统计的用量记录数 = 主调用数 + 委派(子代理/团队)调用数。 */
  modelCalls: number;
  primaryCalls: number;
  delegatedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  /** `input + cacheRead + cacheWrite`。 */
  promptTokens: number;
  cacheReadObservedCalls: number;
  cacheWriteObservedCalls: number;
  cacheReadObservedPromptTokens: number;
  cacheReadObservedTokens: number;
  cacheWriteObservedTokens: number;
  cacheHitCalls: number;
  /** token 级缓存命中率;没有可观测调用时为 `null`(注意:`null` ≠ 0)。 */
  tokenHitRate: number | null;
  /** 调用级命中率。 */
  requestHitRate: number | null;
  writeRate: number | null;
  /** 可观测读的调用占比;用于让界面说清"这个率覆盖了几次调用"。 */
  readCallCoverage: number | null;
  readTokenCoverage: number | null;
  writeCallCoverage: number | null;
  /** 写入是否可观测。见 `CacheWriteObservation`。 */
  cacheWriteObservation: CacheWriteObservation;
  /** Σ provider 自报 prompt 总数(只有逐条记录带);用于对账。 */
  reportedPromptTokens: number;
  /** 有多少条记录带了自报值。 */
  reportedPromptCount: number;
  /** 自报值与分量和不一致的记录数 —— 不为 0 说明要么我们算错了,要么 provider 不自洽。 */
  reportedPromptDriftCount: number;
  /** 不一致记录里最大的绝对差额(token)。 */
  reportedPromptMaxDrift: number;
}

/**
 * 汇总一组用量记录。
 *
 * `counts` 是调用数(主调用 / 委派),由调用方给 —— 因为一条**聚合**记录可能代表多次调用,
 * 光看数组长度会把覆盖率算错。
 */
/** 空汇总:还没有任何用量时的形状。率一律是 `null` —— "没有数据"不等于"0%"。 */
export function emptyTokenUsageSummary(): TokenUsageSummary {
  return {
    modelCalls: 0,
    primaryCalls: 0,
    delegatedCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    promptTokens: 0,
    cacheReadObservedCalls: 0,
    cacheWriteObservedCalls: 0,
    cacheReadObservedPromptTokens: 0,
    cacheReadObservedTokens: 0,
    cacheWriteObservedTokens: 0,
    cacheHitCalls: 0,
    tokenHitRate: null,
    requestHitRate: null,
    writeRate: null,
    readCallCoverage: null,
    readTokenCoverage: null,
    writeCallCoverage: null,
    cacheWriteObservation: "unavailable",
    reportedPromptTokens: 0,
    reportedPromptCount: 0,
    reportedPromptDriftCount: 0,
    reportedPromptMaxDrift: 0,
  };
}

export function summarizeTokenUsage(
  usages: readonly ConversationUsage[],
  counts: { primaryCalls: number; delegatedCalls: number },
): TokenUsageSummary | undefined {
  if (usages.length === 0) return undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let cacheReadObservedCalls = 0;
  let cacheWriteObservedCalls = 0;
  let cacheReadObservedPromptTokens = 0;
  let cacheWriteObservedPromptTokens = 0;
  let cacheReadObservedTokens = 0;
  let cacheWriteObservedTokens = 0;
  let cacheHitCalls = 0;
  let reportedPromptTokens = 0;
  let reportedPromptCount = 0;
  let reportedPromptDriftCount = 0;
  let reportedPromptMaxDrift = 0;

  for (const usage of usages) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cacheReadTokens += usage.cacheReadTokens;
    cacheWriteTokens += usage.cacheWriteTokens;
    totalTokens += usage.totalTokens;
    totalCost += usage.totalCost;
    const observation = observationOf(usage);
    cacheReadObservedCalls += observation.readCalls;
    cacheWriteObservedCalls += observation.writeCalls;
    cacheReadObservedPromptTokens += observation.readPromptTokens;
    cacheWriteObservedPromptTokens += observation.writePromptTokens;
    cacheReadObservedTokens += observation.readTokens;
    cacheWriteObservedTokens += observation.writeTokens;
    cacheHitCalls += observation.hitCalls;
    if (usage.reportedPromptTokens !== undefined) {
      reportedPromptTokens += usage.reportedPromptTokens;
      reportedPromptCount += 1;
      const drift = Math.abs(
        usage.reportedPromptTokens - promptTokensOf(usage),
      );
      if (drift > 0) {
        reportedPromptDriftCount += 1;
        reportedPromptMaxDrift = Math.max(reportedPromptMaxDrift, drift);
      }
    }
  }

  const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const modelCalls = counts.primaryCalls + counts.delegatedCalls;
  return {
    modelCalls,
    primaryCalls: counts.primaryCalls,
    delegatedCalls: counts.delegatedCalls,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalCost,
    promptTokens,
    cacheReadObservedCalls,
    cacheWriteObservedCalls,
    cacheReadObservedPromptTokens,
    cacheReadObservedTokens,
    cacheWriteObservedTokens,
    cacheHitCalls,
    // 分子也必须是"可观测"的那部分:否则未上报调用里的 cacheRead 会白送给分子,
    // 而它们的分母没有进来 —— 命中率就被抬高了。
    tokenHitRate: ratio(cacheReadObservedTokens, cacheReadObservedPromptTokens),
    requestHitRate: ratio(cacheHitCalls, cacheReadObservedCalls),
    writeRate: ratio(cacheWriteObservedTokens, cacheWriteObservedPromptTokens),
    readCallCoverage: ratio(cacheReadObservedCalls, modelCalls),
    readTokenCoverage: ratio(cacheReadObservedPromptTokens, promptTokens),
    writeCallCoverage: ratio(cacheWriteObservedCalls, modelCalls),
    cacheWriteObservation:
      cacheWriteObservedCalls > 0
        ? "reported"
        : cacheReadObservedCalls > 0
          ? "read-only"
          : "unavailable",
    reportedPromptTokens,
    reportedPromptCount,
    reportedPromptDriftCount,
    reportedPromptMaxDrift,
  };
}

export interface TurnUsageDetails {
  /** 兼容既有形状:合并后的用量 + 两个调用计数。 */
  usage: SessionTurnUsage;
  /** 本轮汇总:命中率、覆盖率、对账结果都在这里。 */
  summary: TokenUsageSummary;
  /** 参与统计的逐条用量(主调用在前、委派在后),给折叠明细用。 */
  usages: readonly ConversationUsage[];
}

/**
 * 本轮用量。**轮次边界只有一个定义**(I11):
 *
 * 从**最后一条 `user` 消息**起,到下一个 `user` 消息止。中途 steer / follow-up 会插入新的
 * user 消息,所以它开新一轮 —— 与既有的 `turnUsage` 口径一致,避免同一屏上出现两个"本轮"。
 *
 * 委派(子代理 / 专家团)的用量挂在该消息的 tool 块上,计入**同一轮**,并单独计数。
 */
export function calculateTurnUsage(
  messages: readonly ConversationMessage[],
): TurnUsageDetails | undefined {
  let turnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      turnStart = index;
      break;
    }
  }
  if (turnStart === -1) return undefined;

  return summarizeUsageMessages(messages.slice(turnStart + 1));
}

/**
 * 把一组消息折算成本轮用量。
 *
 * 与 `calculateTurnUsage` 分开的理由:**逐轮渲染的地方拿不到 user 消息**(助手行只有助手消息),
 * 而它要算的又必须是同一个东西。所以"哪些用量算在一条记录上"只有这一个实现,轮次**边界**才由
 * `calculateTurnUsage` 负责 —— 两处不会各算各的。
 */
export function summarizeUsageMessages(
  messages: readonly ConversationMessage[],
): TurnUsageDetails | undefined {
  const usages: ConversationUsage[] = [];
  let primaryCallCount = 0;
  let toolCallCount = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.usage) {
      usages.push(message.usage);
      primaryCallCount += 1;
    }
    // 委派(子代理 / 专家团)的用量挂在该消息的工具块上,算同一轮。
    for (const block of message.blocks) {
      if (block.type !== "tool" || !block.usage) continue;
      usages.push(block.usage);
      toolCallCount += 1;
    }
  }
  if (usages.length === 0) return undefined;

  let merged: ConversationUsage | undefined;
  for (const usage of usages)
    merged = mergeConversationUsage(merged, usage);
  if (!merged) return undefined;
  const summary = summarizeTokenUsage(usages, {
    primaryCalls: primaryCallCount,
    delegatedCalls: toolCallCount,
  });
  if (!summary) return undefined;
  return {
    usage: { ...merged, primaryCallCount, toolCallCount },
    summary,
    usages,
  };
}

/** 只用合并结果的地方(存储、协议)走这里;要率就调 `calculateTurnUsage`。 */
export function calculateCurrentTurnUsage(
  messages: readonly ConversationMessage[],
): SessionTurnUsage | undefined {
  return calculateTurnUsage(messages)?.usage;
}
