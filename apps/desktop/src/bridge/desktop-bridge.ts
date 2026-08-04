import type { AgentInteractionModeId, AppearanceBackgroundAsset, AppPreferences, ConfiguredModelKind, ConnectorConfiguration, ConnectorPromptSummary, ConnectorResourceSummary, ConnectorSummary, MediaInlineImage, MediaLayoutUpdate, MediaOperationRequest, MediaProject, ModelReference, SessionAccessLevel, SessionDraft, SessionRecord, ThinkingLevel, UsageReport, UsageReportQuery, UserMessageSubmission, UserPromptPart, WorkspaceRecord } from "@wordless/domain";
import type { AgentExtensionSnapshot, JsonObject } from "@wordless/agent-extension-sdk";
import type { AccountSnapshot, AnalysisSessionSnapshot, AppSnapshot, ArtifactDescriptor, ArtifactIssue, ArtifactPreviewManifest, ArtifactSelection, CloudSyncConflictResolution, CloudSyncInitialStrategy, CloudSyncSnapshot, DataAnalysisCapabilitySnapshot, DesktopAppInfo, DesktopHostEvent, DesktopHostInfo, DesktopMenuId, DesktopRelease, DesktopUpdateSnapshot, OfficeEngineHealth, PresentationTemplate, RuntimeEventEnvelope, SessionArtifactDiff, SessionContextSnapshot, SessionHistoryPage, SessionHistoryPageRequest, SessionMessageSearchRequest, SessionMessageSearchResponse, SessionSnapshot, SessionViewSnapshot, SessionWorkspaceTextFile, SpreadsheetCapabilitySnapshot, SpreadsheetChangeRecord, SpreadsheetRangeProfile, SpreadsheetSelection, WorkspaceFileEntry } from "@wordless/protocol";
import type { ToolApprovalMode } from "@wordless/domain";

export const DESKTOP_BRIDGE_VERSION = 27;

export interface DesktopBridge {
  readonly version: typeof DESKTOP_BRIDGE_VERSION;
  getHostInfo(): Promise<DesktopHostInfo>;
  getAppInfo(): Promise<DesktopAppInfo>;
  openApplicationMenu(menuId: DesktopMenuId): Promise<void>;
  getUpdateSnapshot(): Promise<DesktopUpdateSnapshot>;
  listReleases(refresh?: boolean): Promise<DesktopRelease[]>;
  checkForUpdates(): Promise<DesktopUpdateSnapshot>;
  downloadUpdate(): Promise<DesktopUpdateSnapshot>;
  installUpdate(): Promise<DesktopUpdateSnapshot>;
  openReleasePage(version?: string): Promise<void>;
  getAccountSnapshot(): Promise<AccountSnapshot>;
  loginGoogle(): Promise<AccountSnapshot>;
  logoutGoogle(): Promise<void>;
  getCloudSyncSnapshot(): Promise<CloudSyncSnapshot>;
  enableCloudSync(strategy?: CloudSyncInitialStrategy): Promise<CloudSyncSnapshot>;
  disableCloudSync(): Promise<CloudSyncSnapshot>;
  syncCloudNow(): Promise<CloudSyncSnapshot>;
  resolveCloudSyncConflict(resolution: CloudSyncConflictResolution): Promise<CloudSyncSnapshot>;
  deleteCloudSyncRemote(): Promise<CloudSyncSnapshot>;
  getSnapshot(): Promise<AppSnapshot>;
  getUsageReport(query: UsageReportQuery): Promise<UsageReport>;
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot>;
  getSessionView(sessionId: string): Promise<SessionViewSnapshot>;
  getSessionHistoryPage(sessionId: string, request: SessionHistoryPageRequest): Promise<SessionHistoryPage>;
  searchSessionMessages(sessionId: string, request: SessionMessageSearchRequest): Promise<SessionMessageSearchResponse>;
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
  openExternalUrl(url: string): Promise<void>;
  createAndPrompt(draft: SessionDraft, parts: UserPromptPart[], submission: UserMessageSubmission): Promise<SessionRecord>;
  promptSession(sessionId: string, parts: UserPromptPart[], submission: UserMessageSubmission): Promise<void>;
  compactSession(sessionId: string): Promise<void>;
  getSessionContext(sessionId: string): Promise<SessionContextSnapshot>;
  getOfficeEngineHealth(): Promise<OfficeEngineHealth>;
  listPresentationTemplates(): Promise<PresentationTemplate[]>;
  listPresentationArtifacts(sessionId: string): Promise<ArtifactDescriptor[]>;
  createPresentationArtifact(sessionId: string, input?: { name?: string; templateId?: string | null }): Promise<ArtifactDescriptor>;
  getPresentationPreview(sessionId: string, artifactId: string, force?: boolean): Promise<ArtifactPreviewManifest>;
  getPresentationSelection(sessionId: string, artifactId: string, surfaceId?: string): Promise<ArtifactSelection | null>;
  validatePresentationArtifact(sessionId: string, artifactId: string): Promise<ArtifactIssue[]>;
  openPresentationArtifact(sessionId: string, artifactId: string): Promise<void>;
  revealPresentationArtifact(sessionId: string, artifactId: string): Promise<void>;
  listSpreadsheetArtifacts(sessionId: string): Promise<ArtifactDescriptor[]>;
  getSpreadsheetPreview(sessionId: string, artifactId: string): Promise<ArtifactPreviewManifest>;
  getSpreadsheetSelection(sessionId: string, artifactId: string): Promise<SpreadsheetSelection | null>;
  getSpreadsheetCapabilities(): Promise<SpreadsheetCapabilitySnapshot>;
  profileSpreadsheetRange(sessionId: string, artifactId: string, sheet: string, range: string): Promise<SpreadsheetRangeProfile>;
  focusSpreadsheetLocator(sessionId: string, artifactId: string, locator: string): Promise<void>;
  clearSpreadsheetMarks(sessionId: string, artifactId: string): Promise<void>;
  getSpreadsheetChanges(sessionId: string, artifactId: string): Promise<SpreadsheetChangeRecord[]>;
  validateSpreadsheetArtifact(sessionId: string, artifactId: string): Promise<ArtifactIssue[]>;
  openSpreadsheetArtifact(sessionId: string, artifactId: string): Promise<void>;
  revealSpreadsheetArtifact(sessionId: string, artifactId: string): Promise<void>;
  getDataAnalysisCapabilities(): Promise<DataAnalysisCapabilitySnapshot>;
  getAnalysisSnapshot(sessionId: string): Promise<AnalysisSessionSnapshot>;
  openAnalysisOutput(sessionId: string, analysisId: string, path: string): Promise<void>;
  revealAnalysisOutput(sessionId: string, analysisId: string, path: string): Promise<void>;
  getSessionArtifactDiff(sessionId: string, path: string): Promise<SessionArtifactDiff>;
  listSessionWorkspaceDirectory(sessionId: string, path: string): Promise<WorkspaceFileEntry[]>;
  searchSessionWorkspace(sessionId: string, query: string): Promise<WorkspaceFileEntry[]>;
  searchWorkspace(workspaceId: string, query: string): Promise<WorkspaceFileEntry[]>;
  readSessionWorkspaceTextFile(sessionId: string, path: string): Promise<SessionWorkspaceTextFile>;
  openSessionWorkspaceFile(sessionId: string, path: string): Promise<void>;
  revealSessionWorkspaceFile(sessionId: string, path: string): Promise<void>;
  saveSessionWorkspaceFileAs(sessionId: string, path: string): Promise<void>;
  trashSessionWorkspaceEntry(sessionId: string, path: string): Promise<void>;
  resolveOperationApproval(sessionId: string, approvalId: string, approved: boolean, feedback?: string): Promise<void>;
  setSessionToolApprovalMode(sessionId: string, mode: ToolApprovalMode): Promise<void>;
  resolveUserRequest(
    sessionId: string,
    requestId: string,
    resolution: { status: "submitted" | "cancelled"; answers?: Record<string, string | string[] | boolean>; feedback?: string },
  ): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  setSessionModel(sessionId: string, model: ModelReference, thinkingLevel?: ThinkingLevel): Promise<void>;
  setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<SessionRecord>;
  setSessionAccess(sessionId: string, accessLevel: SessionAccessLevel): Promise<SessionRecord>;
  setSessionInteractionMode(sessionId: string, interactionMode: AgentInteractionModeId): Promise<SessionRecord>;
  resolveClarificationQuestion(sessionId: string, callId: string, value: string | boolean): Promise<UserMessageSubmission>;
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
  subscribeHost(listener: (event: DesktopHostEvent) => void): () => void;
}

const requiredMethods: Array<Exclude<keyof DesktopBridge, "version">> = [
  "getHostInfo",
  "getAppInfo",
  "openApplicationMenu",
  "getUpdateSnapshot",
  "listReleases",
  "checkForUpdates",
  "downloadUpdate",
  "installUpdate",
  "openReleasePage",
  "getAccountSnapshot",
  "loginGoogle",
  "logoutGoogle",
  "getCloudSyncSnapshot",
  "enableCloudSync",
  "disableCloudSync",
  "syncCloudNow",
  "resolveCloudSyncConflict",
  "deleteCloudSyncRemote",
  "getSnapshot",
  "getUsageReport",
  "getSessionSnapshot",
  "getSessionView",
  "getSessionHistoryPage",
  "searchSessionMessages",
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
  "openExternalUrl",
  "createAndPrompt",
  "promptSession",
  "compactSession",
  "getSessionContext",
  "getOfficeEngineHealth",
  "listPresentationTemplates",
  "listPresentationArtifacts",
  "createPresentationArtifact",
  "getPresentationPreview",
  "getPresentationSelection",
  "validatePresentationArtifact",
  "openPresentationArtifact",
  "revealPresentationArtifact",
  "listSpreadsheetArtifacts",
  "getSpreadsheetPreview",
  "getSpreadsheetSelection",
  "getSpreadsheetCapabilities",
  "profileSpreadsheetRange",
  "focusSpreadsheetLocator",
  "clearSpreadsheetMarks",
  "getSpreadsheetChanges",
  "validateSpreadsheetArtifact",
  "openSpreadsheetArtifact",
  "revealSpreadsheetArtifact",
  "getDataAnalysisCapabilities",
  "getAnalysisSnapshot",
  "openAnalysisOutput",
  "revealAnalysisOutput",
  "getSessionArtifactDiff",
  "listSessionWorkspaceDirectory",
  "searchSessionWorkspace",
  "searchWorkspace",
  "readSessionWorkspaceTextFile",
  "openSessionWorkspaceFile",
  "revealSessionWorkspaceFile",
  "saveSessionWorkspaceFileAs",
  "trashSessionWorkspaceEntry",
  "resolveOperationApproval",
  "setSessionToolApprovalMode",
  "resolveUserRequest",
  "cancelSession",
  "setSessionModel",
  "setSessionThinkingLevel",
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
  "subscribeHost",
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
