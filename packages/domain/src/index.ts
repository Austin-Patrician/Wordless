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

export type ArtifactKind =
  | "presentation"
  | "document"
  | "spreadsheet"
  | "browser"
  | "report"
  | "dataset"
  | "chart"
  | "image";

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
  | { kind: "custom"; assetId: string };

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
  mimeType: "image/jpeg" | "image/png" | "image/webp";
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
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface AutomationTaskInput extends AutomationConfiguration {
  name: string;
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
}

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
  | MessageArtifactBlock;

export interface ConversationUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
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
  source: "provider" | "estimate";
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
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    totalCost: usage.totalCost,
  };
}

export function mergeConversationUsage(
  current: ConversationUsage | undefined,
  next: ConversationUsage | undefined,
): ConversationUsage | undefined {
  if (!current) return next ? { ...next } : undefined;
  if (!next) return { ...current };
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    cacheReadTokens: current.cacheReadTokens + next.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + next.cacheWriteTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    totalCost: current.totalCost + next.totalCost,
  };
}

export function calculateCurrentTurnUsage(
  messages: readonly ConversationMessage[],
): SessionTurnUsage | undefined {
  let turnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      turnStart = index;
      break;
    }
  }
  if (turnStart === -1) return undefined;

  let usage: ConversationUsage | undefined;
  let primaryCallCount = 0;
  let toolCallCount = 0;
  for (const message of messages.slice(turnStart + 1)) {
    if (message.role !== "assistant") continue;
    if (message.usage) {
      usage = mergeConversationUsage(usage, message.usage);
      primaryCallCount += 1;
    }
    for (const block of message.blocks) {
      if (block.type !== "tool" || !block.usage) continue;
      usage = mergeConversationUsage(usage, block.usage);
      toolCallCount += 1;
    }
  }
  return usage ? { ...usage, primaryCallCount, toolCallCount } : undefined;
}
