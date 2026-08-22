import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  DESKTOP_BRIDGE_VERSION,
  type DesktopBridge,
} from "../bridge/desktop-bridge";

async function fileToPromptAttachment(file: File) {
  const path = webUtils.getPathForFile(file);
  if (path) return { id: crypto.randomUUID(), name: file.name, mediaType: file.type, size: file.size, source: { type: "path" as const, path } };
  if (file.size > 52_428_800) throw new Error(`Attachment exceeds the 50 MB limit: ${file.name}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { id: crypto.randomUUID(), name: file.name, mediaType: file.type, size: file.size, source: { type: "bytes" as const, base64: btoa(binary) } };
}

const wordlessBridge: DesktopBridge = {
  version: DESKTOP_BRIDGE_VERSION,
  getHostInfo: () => ipcRenderer.invoke("wordless:host:info"),
  getAppInfo: () => ipcRenderer.invoke("wordless:app:info"),
  openApplicationMenu: (menuId) =>
    ipcRenderer.invoke("wordless:menu:open", { menuId }),
  getUpdateSnapshot: () => ipcRenderer.invoke("wordless:update:snapshot"),
  listReleases: (refresh) =>
    ipcRenderer.invoke("wordless:update:releases", {
      refresh: refresh === true,
    }),
  checkForUpdates: () => ipcRenderer.invoke("wordless:update:check"),
  downloadUpdate: () => ipcRenderer.invoke("wordless:update:download"),
  installUpdate: () => ipcRenderer.invoke("wordless:update:install"),
  openReleasePage: (version) =>
    ipcRenderer.invoke("wordless:update:open-release", { version }),
  getAccountSnapshot: () => ipcRenderer.invoke("wordless:account:snapshot"),
  loginGoogle: () => ipcRenderer.invoke("wordless:account:google:login"),
  logoutGoogle: () => ipcRenderer.invoke("wordless:account:logout"),
  getCloudSyncSnapshot: () =>
    ipcRenderer.invoke("wordless:cloud-sync:snapshot"),
  enableCloudSync: (strategy) =>
    ipcRenderer.invoke("wordless:cloud-sync:enable", strategy ?? "merge"),
  disableCloudSync: () => ipcRenderer.invoke("wordless:cloud-sync:disable"),
  syncCloudNow: () => ipcRenderer.invoke("wordless:cloud-sync:sync-now"),
  resolveCloudSyncConflict: (resolution) =>
    ipcRenderer.invoke("wordless:cloud-sync:resolve-conflict", resolution),
  deleteCloudSyncRemote: () =>
    ipcRenderer.invoke("wordless:cloud-sync:delete-remote"),
  listAutomations: () => ipcRenderer.invoke("wordless:automation:list"),
  createAutomation: (input) =>
    ipcRenderer.invoke("wordless:automation:create", { input }),
  updateAutomation: (id, input) =>
    ipcRenderer.invoke("wordless:automation:update", { id, input }),
  setAutomationsEnabled: (ids, enabled) =>
    ipcRenderer.invoke("wordless:automation:set-enabled", { ids, enabled }),
  deleteAutomations: (ids) =>
    ipcRenderer.invoke("wordless:automation:delete", { ids }),
  runAutomation: (id) => ipcRenderer.invoke("wordless:automation:run", { id }),
  listAutomationRuns: (limit) =>
    ipcRenderer.invoke("wordless:automation:runs", { limit }),
  deleteAutomationRun: (id) =>
    ipcRenderer.invoke("wordless:automation:run-delete", { id }),
  listTasks: () => ipcRenderer.invoke("wordless:tasks:list"),
  createTask: (input) => ipcRenderer.invoke("wordless:tasks:create", { input }),
  updateTask: (id, input) => ipcRenderer.invoke("wordless:tasks:update", { id, input }),
  moveTask: (id, status, position) => ipcRenderer.invoke("wordless:tasks:move", { id, status, ...(position === undefined ? {} : { position }) }),
  deleteTask: (id) => ipcRenderer.invoke("wordless:tasks:delete", { id }),
  executeTask: (id) => ipcRenderer.invoke("wordless:tasks:execute", { id }),
  getSnapshot: () => ipcRenderer.invoke("wordless:snapshot"),
  listExperts: () => ipcRenderer.invoke("wordless:experts:list"),
  saveExpert: (input, id) =>
    ipcRenderer.invoke("wordless:experts:save", {
      input,
      ...(id ? { id } : {}),
    }),
  deleteExpert: (id) => ipcRenderer.invoke("wordless:experts:delete", { id }),
  listExpertTeams: () => ipcRenderer.invoke("wordless:expert-teams:list"),
  getExpertTeamDetail: (id) =>
    ipcRenderer.invoke("wordless:expert-teams:detail", { id }),
  saveExpertTeam: (input, id) =>
    ipcRenderer.invoke("wordless:expert-teams:save", {
      input,
      ...(id ? { id } : {}),
    }),
  deleteExpertTeam: (id) =>
    ipcRenderer.invoke("wordless:expert-teams:delete", { id }),
  getUsageReport: (query) => ipcRenderer.invoke("wordless:usage:report", query),
  getSessionSnapshot: (sessionId) =>
    ipcRenderer.invoke("wordless:session:snapshot", sessionId),
  getSessionView: (sessionId) =>
    ipcRenderer.invoke("wordless:session:view", sessionId),
  getSessionHistoryPage: (sessionId, request) =>
    ipcRenderer.invoke("wordless:session:history", { sessionId, ...request }),
  getExpertMemberHistory: (sessionId, memberId, request) =>
    ipcRenderer.invoke("wordless:session:expert-member-history", {
      sessionId,
      memberId,
      ...request,
    }),
  getExpertMemberLiveState: (sessionId, memberId) =>
    ipcRenderer.invoke("wordless:session:expert-member-live-state", {
      sessionId,
      memberId,
    }),
  getExpertMemberToolOutput: (sessionId, memberId, callId) =>
    ipcRenderer.invoke("wordless:session:expert-member-tool-output", {
      sessionId,
      memberId,
      callId,
    }),
  searchSessionMessages: (sessionId, request) =>
    ipcRenderer.invoke("wordless:session:message-search", {
      sessionId,
      ...request,
    }),
  getSessionToolOutput: (sessionId, callId) =>
    ipcRenderer.invoke("wordless:session:tool-output", { sessionId, callId }),
  renameSession: (sessionId, title) =>
    ipcRenderer.invoke("wordless:session:rename", { sessionId, title }),
  setSessionPinned: (sessionId, pinned) =>
    ipcRenderer.invoke("wordless:session:pin", { sessionId, pinned }),
  deleteSession: (sessionId) =>
    ipcRenderer.invoke("wordless:session:delete", { sessionId }),
  createMediaProject: (title) =>
    ipcRenderer.invoke("wordless:media:create", {
      ...(title ? { title } : {}),
    }),
  getMediaProject: (sessionId) =>
    ipcRenderer.invoke("wordless:media:get", { sessionId }),
  importMediaImages: async (sessionId, files, targetPosition) => {
    const sourcePaths = files
      .map((file) => webUtils.getPathForFile(file))
      .filter((path) => path.length > 0);
    if (sourcePaths.length !== files.length)
      throw new Error("One or more selected images are unavailable");
    return await ipcRenderer.invoke("wordless:media:import", {
      sessionId,
      sourcePaths,
      targetPosition,
    });
  },
  duplicateMediaAsset: (sessionId, assetId, targetPosition) =>
    ipcRenderer.invoke("wordless:media:duplicate", {
      sessionId,
      assetId,
      targetPosition,
    }),
  deleteMediaAsset: (sessionId, assetId) =>
    ipcRenderer.invoke("wordless:media:delete", { sessionId, assetId }),
  readMediaAssetData: (sessionId, assetId) =>
    ipcRenderer.invoke("wordless:media:asset-data", { sessionId, assetId }),
  downloadMediaAsset: (sessionId, assetId) =>
    ipcRenderer.invoke("wordless:media:download", { sessionId, assetId }),
  startMediaOperation: (request) =>
    ipcRenderer.invoke("wordless:media:operation:start", request),
  updateMediaLayout: (update) =>
    ipcRenderer.invoke("wordless:media:layout", update),
  updateMediaViewport: (update) =>
    ipcRenderer.invoke("wordless:media:viewport", update),
  setMediaCoverAsset: (sessionId, assetId) =>
    ipcRenderer.invoke("wordless:media:cover", { sessionId, assetId }),
  cancelMediaOperation: (sessionId, operationId) =>
    ipcRenderer.invoke("wordless:media:operation:cancel", {
      sessionId,
      operationId,
    }),
  openSessionFolder: (sessionId) =>
    ipcRenderer.invoke("wordless:session:open-folder", sessionId),
  createManagedWorkspace: (name) =>
    ipcRenderer.invoke("wordless:workspace:create", { name }),
  openWorkspace: (path) =>
    ipcRenderer.invoke("wordless:workspace:open", { path }),
  pickWorkspace: () => ipcRenderer.invoke("wordless:workspace:pick"),
  openExternalUrl: (url) =>
    ipcRenderer.invoke("wordless:external:open", { url }),
  createAndPrompt: async (draft, parts, submission, attachments) =>
    await ipcRenderer.invoke("wordless:session:create-and-prompt", {
      draft,
      parts,
      submission,
      ...(attachments ? { attachments: await Promise.all(attachments.map(fileToPromptAttachment)) } : {}),
    }),
  promptSession: async (sessionId, parts, submission, attachments) =>
    await ipcRenderer.invoke("wordless:session:prompt", {
      sessionId,
      parts,
      submission,
      ...(attachments ? { attachments: await Promise.all(attachments.map(fileToPromptAttachment)) } : {}),
    }),
  compactSession: (sessionId) =>
    ipcRenderer.invoke("wordless:session:compact", { sessionId }),
  getSessionContext: (sessionId) =>
    ipcRenderer.invoke("wordless:session:context", sessionId),
  getSessionArtifacts: (sessionId) =>
    ipcRenderer.invoke("wordless:session:artifacts", sessionId),
  readSessionArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:session:artifact:read", {
      sessionId,
      artifactId,
    }),
  openSessionArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:session:artifact:open", {
      sessionId,
      artifactId,
    }),
  revealSessionArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:session:artifact:reveal", {
      sessionId,
      artifactId,
    }),
  saveSessionArtifactAs: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:session:artifact:save-as", {
      sessionId,
      artifactId,
    }),
  getOfficeEngineHealth: () =>
    ipcRenderer.invoke("wordless:presentation:health"),
  listPresentationTemplates: () =>
    ipcRenderer.invoke("wordless:presentation:templates"),
  listPresentationArtifacts: (sessionId) =>
    ipcRenderer.invoke("wordless:presentation:list", { sessionId }),
  createPresentationArtifact: (sessionId, input) =>
    ipcRenderer.invoke("wordless:presentation:create", { sessionId, ...input }),
  getPresentationPreview: (sessionId, artifactId, force) =>
    ipcRenderer.invoke("wordless:presentation:preview", {
      sessionId,
      artifactId,
      ...(force ? { force } : {}),
    }),
  getPresentationSelection: (sessionId, artifactId, surfaceId) =>
    ipcRenderer.invoke("wordless:presentation:selection", {
      sessionId,
      artifactId,
      ...(surfaceId ? { surfaceId } : {}),
    }),
  validatePresentationArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:presentation:validate", {
      sessionId,
      artifactId,
    }),
  openPresentationArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:presentation:open", { sessionId, artifactId }),
  revealPresentationArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:presentation:reveal", {
      sessionId,
      artifactId,
    }),
  listSpreadsheetArtifacts: (sessionId) =>
    ipcRenderer.invoke("wordless:spreadsheet:list", { sessionId }),
  getSpreadsheetPreview: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:spreadsheet:preview", {
      sessionId,
      artifactId,
    }),
  getSpreadsheetSelection: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:spreadsheet:selection", {
      sessionId,
      artifactId,
    }),
  getSpreadsheetCapabilities: () =>
    ipcRenderer.invoke("wordless:spreadsheet:capabilities"),
  profileSpreadsheetRange: (sessionId, artifactId, sheet, range) =>
    ipcRenderer.invoke("wordless:spreadsheet:profile", {
      sessionId,
      artifactId,
      sheet,
      range,
    }),
  focusSpreadsheetLocator: (sessionId, artifactId, locator) =>
    ipcRenderer.invoke("wordless:spreadsheet:focus", {
      sessionId,
      artifactId,
      locator,
    }),
  clearSpreadsheetMarks: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:spreadsheet:clear-marks", {
      sessionId,
      artifactId,
    }),
  getSpreadsheetChanges: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:spreadsheet:changes", {
      sessionId,
      artifactId,
    }),
  validateSpreadsheetArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:spreadsheet:validate", {
      sessionId,
      artifactId,
    }),
  openSpreadsheetArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:spreadsheet:open", { sessionId, artifactId }),
  revealSpreadsheetArtifact: (sessionId, artifactId) =>
    ipcRenderer.invoke("wordless:spreadsheet:reveal", {
      sessionId,
      artifactId,
    }),
  getDataAnalysisCapabilities: () =>
    ipcRenderer.invoke("wordless:analysis:capabilities"),
  getAnalysisSnapshot: (sessionId) =>
    ipcRenderer.invoke("wordless:analysis:snapshot", { sessionId }),
  openAnalysisOutput: (sessionId, analysisId, path) =>
    ipcRenderer.invoke("wordless:analysis:open", {
      sessionId,
      analysisId,
      path,
    }),
  revealAnalysisOutput: (sessionId, analysisId, path) =>
    ipcRenderer.invoke("wordless:analysis:reveal", {
      sessionId,
      analysisId,
      path,
    }),
  getSessionArtifactDiff: (sessionId, path) =>
    ipcRenderer.invoke("wordless:session:artifact:diff", { sessionId, path }),
  listSessionWorkspaceDirectory: (sessionId, path) =>
    ipcRenderer.invoke("wordless:session:workspace:list", { sessionId, path }),
  searchSessionWorkspace: (sessionId, query) =>
    ipcRenderer.invoke("wordless:session:workspace:search", {
      sessionId,
      query,
    }),
  searchWorkspace: (workspaceId, query) =>
    ipcRenderer.invoke("wordless:workspace:search", { workspaceId, query }),
  readSessionWorkspaceTextFile: (sessionId, path) =>
    ipcRenderer.invoke("wordless:session:workspace:read", { sessionId, path }),
  openSessionWorkspaceFile: (sessionId, path) =>
    ipcRenderer.invoke("wordless:session:workspace:open", { sessionId, path }),
  revealSessionWorkspaceFile: (sessionId, path) =>
    ipcRenderer.invoke("wordless:session:workspace:reveal", {
      sessionId,
      path,
    }),
  saveSessionWorkspaceFileAs: (sessionId, path) =>
    ipcRenderer.invoke("wordless:session:workspace:save-as", {
      sessionId,
      path,
    }),
  trashSessionWorkspaceEntry: (sessionId, path) =>
    ipcRenderer.invoke("wordless:session:workspace:trash", { sessionId, path }),
  resolveOperationApproval: (sessionId, approvalId, approved, feedback) =>
    ipcRenderer.invoke("wordless:session:approval", {
      sessionId,
      approvalId,
      approved,
      feedback,
    }),
  setSessionToolApprovalMode: (sessionId, mode) =>
    ipcRenderer.invoke("wordless:session:approval-mode", { sessionId, mode }),
  resolveUserRequest: (sessionId, requestId, resolution) =>
    ipcRenderer.invoke("wordless:session:user-request", {
      sessionId,
      requestId,
      ...resolution,
    }),
  cancelSession: (sessionId) =>
    ipcRenderer.invoke("wordless:session:cancel", sessionId),
  setSessionModel: (sessionId, model, thinkingLevel) =>
    ipcRenderer.invoke("wordless:session:model", {
      sessionId,
      model,
      ...(thinkingLevel ? { thinkingLevel } : {}),
    }),
  setSessionThinkingLevel: (sessionId, level) =>
    ipcRenderer.invoke("wordless:session:thinking-level", { sessionId, level }),
  setSessionAccess: (sessionId, accessLevel) =>
    ipcRenderer.invoke("wordless:session:access", { sessionId, accessLevel }),
  setSessionInteractionMode: (sessionId, interactionMode) =>
    ipcRenderer.invoke("wordless:session:interaction-mode", {
      sessionId,
      interactionMode,
    }),
  resolveClarificationQuestion: (sessionId, callId, value) =>
    ipcRenderer.invoke("wordless:session:clarification-question", {
      sessionId,
      callId,
      value,
    }),
  handoffClarification: (sessionId, interactionMode) =>
    ipcRenderer.invoke("wordless:session:clarification-handoff", {
      sessionId,
      interactionMode,
    }),
  setPreferences: (preferences) =>
    ipcRenderer.invoke("wordless:preferences", {
      key: "app",
      value: preferences,
    }),
  importAppearanceBackground: async (file) => {
    const sourcePath = webUtils.getPathForFile(file);
    if (!sourcePath)
      throw new Error("The selected background image is unavailable");
    return await ipcRenderer.invoke("wordless:appearance:import", {
      sourcePath,
    });
  },
  removeAppearanceBackground: (assetId) =>
    ipcRenderer.invoke("wordless:appearance:remove", { assetId }),
  getModelConfiguration: () =>
    ipcRenderer.invoke("wordless:model-config:snapshot"),
  refreshSkills: () => ipcRenderer.invoke("wordless:skills:refresh"),
  importSkill: () => ipcRenderer.invoke("wordless:skills:import"),
  importSkillFile: async (file) => {
    const sourcePath = webUtils.getPathForFile(file);
    if (!sourcePath) throw new Error("The dropped skill file is unavailable");
    await ipcRenderer.invoke("wordless:skills:import-file", { sourcePath });
  },
  setSkillEnabled: (skillId, enabled) =>
    ipcRenderer.invoke("wordless:skills:enabled", { skillId, enabled }),
  removeManagedSkill: (skillId) =>
    ipcRenderer.invoke("wordless:skills:remove", { skillId }),
  searchMcpMarketplace: (query, cursor, refresh) =>
    ipcRenderer.invoke("wordless:marketplace:mcp-search", { query, cursor, refresh }),
  getMcpMarketplaceDetail: (name) =>
    ipcRenderer.invoke("wordless:marketplace:mcp-detail", { name }),
  installMcpMarketplaceEntry: (name) =>
    ipcRenderer.invoke("wordless:marketplace:mcp-install", { name }),
  searchSkillMarketplace: (query, page, sortBy, refresh) =>
    ipcRenderer.invoke("wordless:marketplace:skill-search", { query, page, sortBy, refresh }),
  previewSkillMarketplace: (skillId) =>
    ipcRenderer.invoke("wordless:marketplace:skill-preview", { skillId }),
  installSkillMarketplacePreview: (previewId) =>
    ipcRenderer.invoke("wordless:marketplace:skill-install", { previewId }),
  saveConnector: (configuration) =>
    ipcRenderer.invoke("wordless:connectors:save", { configuration }),
  testConnector: (connectorId) =>
    ipcRenderer.invoke("wordless:connectors:test", { connectorId }),
  authorizeConnector: (connectorId) =>
    ipcRenderer.invoke("wordless:connectors:authorize", { connectorId }),
  trustConnector: (connectorId) =>
    ipcRenderer.invoke("wordless:connectors:trust", { connectorId }),
  setConnectorEnabled: (connectorId, enabled) =>
    ipcRenderer.invoke("wordless:connectors:enabled", { connectorId, enabled }),
  removeConnector: (connectorId) =>
    ipcRenderer.invoke("wordless:connectors:remove", { connectorId }),
  setSessionConnectors: (sessionId, connectorIds) =>
    ipcRenderer.invoke("wordless:session:connectors", {
      sessionId,
      connectorIds,
    }),
  setSessionExpert: (sessionId, selection) =>
    ipcRenderer.invoke("wordless:session:expert", { sessionId, selection }),
  listConnectorResources: (connectorId) =>
    ipcRenderer.invoke("wordless:connectors:resources", { connectorId }),
  readConnectorResource: (connectorId, uri) =>
    ipcRenderer.invoke("wordless:connectors:resource", { connectorId, uri }),
  listConnectorPrompts: (connectorId) =>
    ipcRenderer.invoke("wordless:connectors:prompts", { connectorId }),
  getConnectorPrompt: (connectorId, name, argumentsValue) =>
    ipcRenderer.invoke("wordless:connectors:prompt", {
      connectorId,
      name,
      arguments: argumentsValue,
    }),
  discoverProviderModels: (request) =>
    ipcRenderer.invoke("wordless:model-config:discover-models", request),
  saveProviderConfiguration: (
    kind,
    providerId,
    configuration,
    enabledModelIds,
  ) =>
    ipcRenderer.invoke("wordless:model-config:save-provider", {
      kind,
      providerId,
      configuration,
      ...(enabledModelIds ? { enabledModelIds } : {}),
    }),
  setConfiguredModelEnabled: (kind, providerId, modelId, enabled) =>
    ipcRenderer.invoke("wordless:model-config:set-enabled", {
      kind,
      providerId,
      modelId,
      enabled,
    }),
  deleteCustomProvider: (kind, providerId) =>
    ipcRenderer.invoke("wordless:model-config:delete-custom-provider", {
      kind,
      providerId,
    }),
  loginProviderOAuth: (providerId) =>
    ipcRenderer.invoke("wordless:model-config:oauth", providerId),
  getExtensionSnapshot: () =>
    ipcRenderer.invoke("wordless:extensions:snapshot"),
  setExtensionEnabled: (extensionId, enabled) =>
    ipcRenderer.invoke("wordless:extensions:enabled", { extensionId, enabled }),
  updateExtensionSettings: (extensionId, settings) =>
    ipcRenderer.invoke("wordless:extensions:settings", {
      extensionId,
      settings,
    }),
  interactWithSessionExtension: (sessionId, extensionId, action, payload) =>
    ipcRenderer.invoke("wordless:session:extension-interact", {
      sessionId,
      extensionId,
      action,
      payload,
    }),
  setSessionExtensionState: (sessionId, extensionId, state) =>
    ipcRenderer.invoke("wordless:session:extension-state", {
      sessionId,
      extensionId,
      state,
    }),
  subscribe: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: Parameters<typeof listener>[0],
    ) => listener(event);
    ipcRenderer.on("wordless:event", handler);
    return () => ipcRenderer.removeListener("wordless:event", handler);
  },
  subscribeHost: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: Parameters<typeof listener>[0],
    ) => listener(event);
    ipcRenderer.on("wordless:host-event", handler);
    return () => ipcRenderer.removeListener("wordless:host-event", handler);
  },
};

contextBridge.exposeInMainWorld("wordless", wordlessBridge);
