import { contextBridge, ipcRenderer, webUtils } from "electron";
import { DESKTOP_BRIDGE_VERSION, type DesktopBridge } from "../bridge/desktop-bridge";

const wordlessBridge: DesktopBridge = {
  version: DESKTOP_BRIDGE_VERSION,
  getSnapshot: () => ipcRenderer.invoke("wordless:snapshot"),
  getUsageReport: (query) => ipcRenderer.invoke("wordless:usage:report", query),
  getSessionSnapshot: (sessionId) => ipcRenderer.invoke("wordless:session:snapshot", sessionId),
  getSessionView: (sessionId) => ipcRenderer.invoke("wordless:session:view", sessionId),
  getSessionHistoryPage: (sessionId, request) => ipcRenderer.invoke("wordless:session:history", { sessionId, ...request }),
  getSessionToolOutput: (sessionId, callId) => ipcRenderer.invoke("wordless:session:tool-output", { sessionId, callId }),
  renameSession: (sessionId, title) => ipcRenderer.invoke("wordless:session:rename", { sessionId, title }),
  setSessionPinned: (sessionId, pinned) => ipcRenderer.invoke("wordless:session:pin", { sessionId, pinned }),
  deleteSession: (sessionId) => ipcRenderer.invoke("wordless:session:delete", { sessionId }),
  createMediaProject: (title) => ipcRenderer.invoke("wordless:media:create", { ...(title ? { title } : {}) }),
  getMediaProject: (sessionId) => ipcRenderer.invoke("wordless:media:get", { sessionId }),
  importMediaImages: async (sessionId, files, targetPosition) => {
    const sourcePaths = files.map((file) => webUtils.getPathForFile(file)).filter((path) => path.length > 0);
    if (sourcePaths.length !== files.length) throw new Error("One or more selected images are unavailable");
    return await ipcRenderer.invoke("wordless:media:import", { sessionId, sourcePaths, targetPosition });
  },
  duplicateMediaAsset: (sessionId, assetId, targetPosition) => ipcRenderer.invoke("wordless:media:duplicate", { sessionId, assetId, targetPosition }),
  deleteMediaAsset: (sessionId, assetId) => ipcRenderer.invoke("wordless:media:delete", { sessionId, assetId }),
  readMediaAssetData: (sessionId, assetId) => ipcRenderer.invoke("wordless:media:asset-data", { sessionId, assetId }),
  downloadMediaAsset: (sessionId, assetId) => ipcRenderer.invoke("wordless:media:download", { sessionId, assetId }),
  startMediaOperation: (request) => ipcRenderer.invoke("wordless:media:operation:start", request),
  updateMediaLayout: (update) => ipcRenderer.invoke("wordless:media:layout", update),
  setMediaCoverAsset: (sessionId, assetId) => ipcRenderer.invoke("wordless:media:cover", { sessionId, assetId }),
  cancelMediaOperation: (sessionId, operationId) => ipcRenderer.invoke("wordless:media:operation:cancel", { sessionId, operationId }),
  openSessionFolder: (sessionId) => ipcRenderer.invoke("wordless:session:open-folder", sessionId),
  createManagedWorkspace: (name) => ipcRenderer.invoke("wordless:workspace:create", { name }),
  openWorkspace: (path) => ipcRenderer.invoke("wordless:workspace:open", { path }),
  pickWorkspace: () => ipcRenderer.invoke("wordless:workspace:pick"),
  createAndPrompt: (draft, parts) => ipcRenderer.invoke("wordless:session:create-and-prompt", { draft, parts }),
  promptSession: (sessionId, parts, attachments) => ipcRenderer.invoke("wordless:session:prompt", { sessionId, parts, attachments }),
  compactSession: (sessionId) => ipcRenderer.invoke("wordless:session:compact", { sessionId }),
  getSessionContext: (sessionId) => ipcRenderer.invoke("wordless:session:context", sessionId),
  getSessionArtifactDiff: (sessionId, path) => ipcRenderer.invoke("wordless:session:artifact:diff", { sessionId, path }),
  listSessionWorkspaceDirectory: (sessionId, path) => ipcRenderer.invoke("wordless:session:workspace:list", { sessionId, path }),
  readSessionWorkspaceTextFile: (sessionId, path) => ipcRenderer.invoke("wordless:session:workspace:read", { sessionId, path }),
  openSessionWorkspaceFile: (sessionId, path) => ipcRenderer.invoke("wordless:session:workspace:open", { sessionId, path }),
  revealSessionWorkspaceFile: (sessionId, path) => ipcRenderer.invoke("wordless:session:workspace:reveal", { sessionId, path }),
  saveSessionWorkspaceFileAs: (sessionId, path) => ipcRenderer.invoke("wordless:session:workspace:save-as", { sessionId, path }),
  resolveOperationApproval: (sessionId, approvalId, approved, feedback) => ipcRenderer.invoke("wordless:session:approval", { sessionId, approvalId, approved, feedback }),
  resolveUserRequest: (sessionId, requestId, resolution) => ipcRenderer.invoke("wordless:session:user-request", { sessionId, requestId, ...resolution }),
  cancelSession: (sessionId) => ipcRenderer.invoke("wordless:session:cancel", sessionId),
  setSessionModel: (sessionId, model) => ipcRenderer.invoke("wordless:session:model", { sessionId, model }),
  setSessionAccess: (sessionId, accessLevel) => ipcRenderer.invoke("wordless:session:access", { sessionId, accessLevel }),
  setSessionInteractionMode: (sessionId, interactionMode) => ipcRenderer.invoke("wordless:session:interaction-mode", { sessionId, interactionMode }),
  resolveClarificationQuestion: (sessionId, callId, value) => ipcRenderer.invoke("wordless:session:clarification-question", { sessionId, callId, value }),
  handoffClarification: (sessionId, interactionMode) => ipcRenderer.invoke("wordless:session:clarification-handoff", { sessionId, interactionMode }),
  setPreferences: (preferences) => ipcRenderer.invoke("wordless:preferences", { key: "app", value: preferences }),
  importAppearanceBackground: async (file) => {
    const sourcePath = webUtils.getPathForFile(file);
    if (!sourcePath) throw new Error("The selected background image is unavailable");
    return await ipcRenderer.invoke("wordless:appearance:import", { sourcePath });
  },
  removeAppearanceBackground: (assetId) => ipcRenderer.invoke("wordless:appearance:remove", { assetId }),
  getModelConfiguration: () => ipcRenderer.invoke("wordless:model-config:snapshot"),
  refreshSkills: () => ipcRenderer.invoke("wordless:skills:refresh"),
  importSkill: () => ipcRenderer.invoke("wordless:skills:import"),
  importSkillFile: async (file) => {
    const sourcePath = webUtils.getPathForFile(file);
    if (!sourcePath) throw new Error("The dropped skill file is unavailable");
    await ipcRenderer.invoke("wordless:skills:import-file", { sourcePath });
  },
  setSkillEnabled: (skillId, enabled) => ipcRenderer.invoke("wordless:skills:enabled", { skillId, enabled }),
  removeManagedSkill: (skillId) => ipcRenderer.invoke("wordless:skills:remove", { skillId }),
  saveConnector: (configuration) => ipcRenderer.invoke("wordless:connectors:save", { configuration }),
  testConnector: (connectorId) => ipcRenderer.invoke("wordless:connectors:test", { connectorId }),
  authorizeConnector: (connectorId) => ipcRenderer.invoke("wordless:connectors:authorize", { connectorId }),
  trustConnector: (connectorId) => ipcRenderer.invoke("wordless:connectors:trust", { connectorId }),
  setConnectorEnabled: (connectorId, enabled) => ipcRenderer.invoke("wordless:connectors:enabled", { connectorId, enabled }),
  removeConnector: (connectorId) => ipcRenderer.invoke("wordless:connectors:remove", { connectorId }),
  setSessionConnectors: (sessionId, connectorIds) => ipcRenderer.invoke("wordless:session:connectors", { sessionId, connectorIds }),
  listConnectorResources: (connectorId) => ipcRenderer.invoke("wordless:connectors:resources", { connectorId }),
  readConnectorResource: (connectorId, uri) => ipcRenderer.invoke("wordless:connectors:resource", { connectorId, uri }),
  listConnectorPrompts: (connectorId) => ipcRenderer.invoke("wordless:connectors:prompts", { connectorId }),
  getConnectorPrompt: (connectorId, name, argumentsValue) => ipcRenderer.invoke("wordless:connectors:prompt", { connectorId, name, arguments: argumentsValue }),
  saveProviderConfiguration: (kind, providerId, configuration) => ipcRenderer.invoke("wordless:model-config:save-provider", { kind, providerId, configuration }),
  setConfiguredModelEnabled: (kind, providerId, modelId, enabled) => ipcRenderer.invoke("wordless:model-config:set-enabled", { kind, providerId, modelId, enabled }),
  deleteCustomProvider: (kind, providerId) => ipcRenderer.invoke("wordless:model-config:delete-custom-provider", { kind, providerId }),
  loginProviderOAuth: (providerId) => ipcRenderer.invoke("wordless:model-config:oauth", providerId),
  getExtensionSnapshot: () => ipcRenderer.invoke("wordless:extensions:snapshot"),
  setExtensionEnabled: (extensionId, enabled) => ipcRenderer.invoke("wordless:extensions:enabled", { extensionId, enabled }),
  updateExtensionSettings: (extensionId, settings) => ipcRenderer.invoke("wordless:extensions:settings", { extensionId, settings }),
  interactWithSessionExtension: (sessionId, extensionId, action, payload) => ipcRenderer.invoke("wordless:session:extension-interact", { sessionId, extensionId, action, payload }),
  setSessionExtensionState: (sessionId, extensionId, state) => ipcRenderer.invoke("wordless:session:extension-state", { sessionId, extensionId, state }),
  subscribe: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: Parameters<typeof listener>[0]) => listener(event);
    ipcRenderer.on("wordless:event", handler);
    return () => ipcRenderer.removeListener("wordless:event", handler);
  },
};

contextBridge.exposeInMainWorld("wordless", wordlessBridge);
