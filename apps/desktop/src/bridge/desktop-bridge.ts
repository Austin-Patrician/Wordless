import type { AgentInteractionModeId, AppearanceBackgroundAsset, AppPreferences, ConfiguredModelKind, ConnectorConfiguration, ConnectorPromptSummary, ConnectorResourceSummary, ConnectorSummary, MediaInlineImage, MediaLayoutUpdate, MediaOperationRequest, MediaProject, ModelReference, SessionAccessLevel, SessionDraft, SessionRecord, UsageReport, UsageReportQuery, UserPromptPart, WorkspaceRecord } from "@wordless/domain";
import type { AgentExtensionSnapshot, JsonObject } from "@wordless/agent-extension-sdk";
import type { AppSnapshot, RuntimeEventEnvelope, SessionArtifactDiff, SessionContextSnapshot, SessionHistoryPage, SessionHistoryPageRequest, SessionSnapshot, SessionViewSnapshot, SessionWorkspaceTextFile, WorkspaceFileEntry } from "@wordless/protocol";

export const DESKTOP_BRIDGE_VERSION = 16;

export interface DesktopBridge {
  readonly version: typeof DESKTOP_BRIDGE_VERSION;
  getSnapshot(): Promise<AppSnapshot>;
  getUsageReport(query: UsageReportQuery): Promise<UsageReport>;
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot>;
  getSessionView(sessionId: string): Promise<SessionViewSnapshot>;
  getSessionHistoryPage(sessionId: string, request: SessionHistoryPageRequest): Promise<SessionHistoryPage>;
  getSessionToolOutput(sessionId: string, callId: string): Promise<string>;
  renameSession(sessionId: string, title: string): Promise<SessionRecord>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<SessionRecord>;
  deleteSession(sessionId: string): Promise<void>;
  createMediaProject(title?: string): Promise<MediaProject>;
  getMediaProject(sessionId: string): Promise<MediaProject>;
  importMediaImages(sessionId: string, files: File[], targetPosition: { x: number; y: number }): Promise<MediaProject>;
  duplicateMediaAsset(sessionId: string, assetId: string, targetPosition: { x: number; y: number }): Promise<MediaProject>;
  deleteMediaAsset(sessionId: string, assetId: string): Promise<MediaProject>;
  readMediaAssetData(sessionId: string, assetId: string): Promise<MediaInlineImage>;
  downloadMediaAsset(sessionId: string, assetId: string): Promise<string>;
  startMediaOperation(request: MediaOperationRequest): Promise<MediaProject>;
  updateMediaLayout(update: MediaLayoutUpdate): Promise<MediaProject>;
  setMediaCoverAsset(sessionId: string, assetId: string): Promise<MediaProject>;
  cancelMediaOperation(sessionId: string, operationId: string): Promise<void>;
  openSessionFolder(sessionId: string): Promise<void>;
  createManagedWorkspace(name: string): Promise<WorkspaceRecord>;
  openWorkspace(path: string): Promise<WorkspaceRecord>;
  pickWorkspace(): Promise<WorkspaceRecord | null>;
  createAndPrompt(draft: SessionDraft, parts: UserPromptPart[]): Promise<SessionRecord>;
  promptSession(sessionId: string, parts: UserPromptPart[], attachments?: Array<{ path: string }>): Promise<void>;
  compactSession(sessionId: string): Promise<void>;
  getSessionContext(sessionId: string): Promise<SessionContextSnapshot>;
  getSessionArtifactDiff(sessionId: string, path: string): Promise<SessionArtifactDiff>;
  listSessionWorkspaceDirectory(sessionId: string, path: string): Promise<WorkspaceFileEntry[]>;
  readSessionWorkspaceTextFile(sessionId: string, path: string): Promise<SessionWorkspaceTextFile>;
  openSessionWorkspaceFile(sessionId: string, path: string): Promise<void>;
  revealSessionWorkspaceFile(sessionId: string, path: string): Promise<void>;
  saveSessionWorkspaceFileAs(sessionId: string, path: string): Promise<void>;
  resolveOperationApproval(sessionId: string, approvalId: string, approved: boolean, feedback?: string): Promise<void>;
  resolveUserRequest(
    sessionId: string,
    requestId: string,
    resolution: { status: "submitted" | "cancelled"; answers?: Record<string, string | string[] | boolean>; feedback?: string },
  ): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  setSessionModel(sessionId: string, model: ModelReference): Promise<void>;
  setSessionAccess(sessionId: string, accessLevel: SessionAccessLevel): Promise<SessionRecord>;
  setSessionInteractionMode(sessionId: string, interactionMode: AgentInteractionModeId): Promise<SessionRecord>;
  resolveClarificationQuestion(sessionId: string, callId: string, value: string | boolean): Promise<void>;
  handoffClarification(sessionId: string, interactionMode: AgentInteractionModeId): Promise<void>;
  setPreferences(preferences: AppPreferences): Promise<void>;
  importAppearanceBackground(file: File): Promise<AppearanceBackgroundAsset>;
  removeAppearanceBackground(assetId: string): Promise<void>;
  getModelConfiguration(): Promise<AppSnapshot["modelConfiguration"]>;
  refreshSkills(): Promise<void>;
  importSkill(): Promise<boolean>;
  importSkillFile(file: File): Promise<void>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<void>;
  removeManagedSkill(skillId: string): Promise<void>;
  saveConnector(configuration: Omit<ConnectorConfiguration, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<ConnectorSummary>;
  testConnector(connectorId: string): Promise<void>;
  authorizeConnector(connectorId: string): Promise<void>;
  trustConnector(connectorId: string): Promise<void>;
  setConnectorEnabled(connectorId: string, enabled: boolean): Promise<void>;
  removeConnector(connectorId: string): Promise<void>;
  setSessionConnectors(sessionId: string, connectorIds: string[]): Promise<SessionRecord>;
  listConnectorResources(connectorId: string): Promise<ConnectorResourceSummary[]>;
  readConnectorResource(connectorId: string, uri: string): Promise<{ uri: string; content: string; mimeType: string | null }>;
  listConnectorPrompts(connectorId: string): Promise<ConnectorPromptSummary[]>;
  getConnectorPrompt(connectorId: string, name: string, argumentsValue: Record<string, string>): Promise<string>;
  saveProviderConfiguration(kind: ConfiguredModelKind, providerId: string, configuration: Record<string, unknown>): Promise<void>;
  setConfiguredModelEnabled(kind: ConfiguredModelKind, providerId: string, modelId: string, enabled: boolean): Promise<void>;
  deleteCustomProvider(kind: ConfiguredModelKind, providerId: string): Promise<void>;
  loginProviderOAuth(providerId: string): Promise<void>;
  getExtensionSnapshot(): Promise<AgentExtensionSnapshot>;
  setExtensionEnabled(extensionId: string, enabled: boolean): Promise<AgentExtensionSnapshot>;
  updateExtensionSettings(extensionId: string, settings: JsonObject): Promise<AgentExtensionSnapshot>;
  interactWithSessionExtension(sessionId: string, extensionId: string, action: string, payload?: unknown): Promise<void>;
  setSessionExtensionState(sessionId: string, extensionId: string, state: JsonObject): Promise<void>;
  subscribe(listener: (event: RuntimeEventEnvelope) => void): () => void;
}

const requiredMethods: Array<Exclude<keyof DesktopBridge, "version">> = [
  "getSnapshot",
  "getUsageReport",
  "getSessionSnapshot",
  "getSessionView",
  "getSessionHistoryPage",
  "getSessionToolOutput",
  "renameSession",
  "setSessionPinned",
  "deleteSession",
  "createMediaProject",
  "getMediaProject",
  "importMediaImages",
  "duplicateMediaAsset",
  "deleteMediaAsset",
  "readMediaAssetData",
  "downloadMediaAsset",
  "startMediaOperation",
  "updateMediaLayout",
  "setMediaCoverAsset",
  "cancelMediaOperation",
  "openSessionFolder",
  "createManagedWorkspace",
  "openWorkspace",
  "pickWorkspace",
  "createAndPrompt",
  "promptSession",
  "compactSession",
  "getSessionContext",
  "getSessionArtifactDiff",
  "listSessionWorkspaceDirectory",
  "readSessionWorkspaceTextFile",
  "openSessionWorkspaceFile",
  "revealSessionWorkspaceFile",
  "saveSessionWorkspaceFileAs",
  "resolveOperationApproval",
  "resolveUserRequest",
  "cancelSession",
  "setSessionModel",
  "setSessionAccess",
  "setSessionInteractionMode",
  "resolveClarificationQuestion",
  "handoffClarification",
  "setPreferences",
  "importAppearanceBackground",
  "removeAppearanceBackground",
  "getModelConfiguration",
  "refreshSkills",
  "importSkill",
  "importSkillFile",
  "setSkillEnabled",
  "removeManagedSkill",
  "saveConnector",
  "testConnector",
  "authorizeConnector",
  "trustConnector",
  "setConnectorEnabled",
  "removeConnector",
  "setSessionConnectors",
  "listConnectorResources",
  "readConnectorResource",
  "listConnectorPrompts",
  "getConnectorPrompt",
  "saveProviderConfiguration",
  "setConfiguredModelEnabled",
  "deleteCustomProvider",
  "loginProviderOAuth",
  "getExtensionSnapshot",
  "setExtensionEnabled",
  "updateExtensionSettings",
  "interactWithSessionExtension",
  "setSessionExtensionState",
  "subscribe",
];

export function desktopBridgeError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return "Electron preload bridge is unavailable.";
  const bridge = value as Record<string, unknown>;
  if (bridge.version !== DESKTOP_BRIDGE_VERSION) return "Electron preload bridge version is incompatible. Restart Wordless after rebuilding the desktop host.";
  const missing = requiredMethods.find((method) => typeof bridge[method] !== "function");
  return missing ? `Electron preload bridge is missing ${missing}. Restart Wordless after rebuilding the desktop host.` : undefined;
}

export function isDesktopBridge(value: unknown): value is DesktopBridge {
  return desktopBridgeError(value) === undefined;
}
