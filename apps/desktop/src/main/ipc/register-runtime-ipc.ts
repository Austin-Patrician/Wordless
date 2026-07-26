import { copyFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import type { AppearancePreferences, AppPreferences, SessionAccessLevel, UserPromptPart } from "@wordless/domain";
import { formatPromptWithSkillReferences, selectedSkillIdsFromPromptParts } from "@wordless/agent-driver-sdk";
import {
  CreateAndPromptSchema,
  CompactSessionSchema,
  ConnectorConfigurationSchema,
  ConnectorIdSchema,
  ConnectorPromptSchema,
  CreateMediaProjectSchema,
  CreateWorkspaceSchema,
  DeleteMediaAssetSchema,
  DeleteCustomProviderSchema,
  DeleteSessionSchema,
  DuplicateMediaAssetSchema,
  ImportSkillFileSchema,
  ImportMediaImagesSchema,
  ImportAppearanceBackgroundSchema,
  SessionHistoryPageRequestSchema,
  SessionMessageSearchRequestSchema,
  SessionToolOutputRequestSchema,
  ListWorkspaceDirectorySchema,
  OpenWorkspaceSchema,
  MediaProjectRequestSchema,
  PromptSessionSchema,
  RenameSessionSchema,
  ResolveOperationApprovalSchema,
  ResolveClarificationQuestionSchema,
  ResolveUserRequestSchema,
  SaveProviderConfigurationSchema,
  SetMediaCoverSchema,
  RemoveManagedSkillSchema,
  RemoveAppearanceBackgroundSchema,
  SetExtensionEnabledSchema,
  SetSessionAccessSchema,
  SetSessionInteractionModeSchema,
  SetSessionToolApprovalModeSchema,
  SetSessionExtensionStateSchema,
  SetConfiguredModelEnabledSchema,
  SetConnectorEnabledSchema,
  SetSessionConnectorsSchema,
  SetSessionPinnedSchema,
  SetPreferenceSchema,
  SetSkillEnabledSchema,
  SetSessionModelSchema,
  SessionExtensionInteractionSchema,
  UpdateExtensionSettingsSchema,
  UpdateMediaLayoutSchema,
  UsageReportQuerySchema,
  WorkspaceFileRequestSchema,
  WorkspaceDeleteSchema,
  WorkspaceReferenceSearchSchema,
  SessionWorkspaceReferenceSearchSchema,
  CancelMediaOperationSchema,
  StartMediaOperationSchema,
  HandoffClarificationSchema,
  type DesktopHostInfo,
  type DesktopMenuId,
} from "@wordless/protocol";
import { WordlessRuntime } from "@wordless/runtime";
import { AppearanceAssetService } from "../appearance/appearance-asset-service";
import { updateTitleBarOverlays } from "../windows/main-window";

function parsePayload<T>(schema: TSchema, payload: unknown): T {
  if (!Value.Check(schema, payload)) throw new Error("Invalid request payload");
  return payload as T;
}

function isSecurityRuleList(value: unknown, property: "pattern" | "command"): boolean {
  return Array.isArray(value) && value.every((rule) => typeof rule === "object" && rule !== null && !Array.isArray(rule) && "id" in rule && "label" in rule && property in rule && typeof rule.id === "string" && typeof rule.label === "string" && typeof rule[property] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  if (!isRecord(value) || !isRecord(value.background)) return false;
  const { background } = value;
  if (background.fit !== "cover" && background.fit !== "contain" && background.fit !== "tile") return false;
  if (!isRecord(background.position) || typeof background.position.x !== "number" || typeof background.position.y !== "number" || !Number.isFinite(background.position.x) || !Number.isFinite(background.position.y) || background.position.x < 0 || background.position.x > 100 || background.position.y < 0 || background.position.y > 100) return false;
  if (typeof background.intensity !== "number" || !Number.isFinite(background.intensity) || background.intensity < 0 || background.intensity > 100) return false;
  if (typeof background.blurPx !== "number" || !Number.isFinite(background.blurPx) || background.blurPx < 0 || background.blurPx > 16) return false;
  if (!isRecord(background.source) || typeof background.source.kind !== "string") return false;
  if (background.source.kind === "none") return true;
  if (background.source.kind === "builtin") return background.source.id === "paper" || background.source.id === "micro-dots" || background.source.id === "fine-grid";
  return background.source.kind === "custom" && typeof background.source.assetId === "string" && /^[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(background.source.assetId);
}

function isAppPreferences(value: unknown): value is AppPreferences {
  if (typeof value !== "object" || value === null || !("locale" in value) || !("theme" in value) || !("entryModels" in value) || !("notifications" in value) || !("security" in value) || !("appearance" in value)) return false;
  const notifications = value.notifications;
  const security = value.security;
  return typeof notifications === "object" && notifications !== null && "enabled" in notifications && "onActionRequired" in notifications && "onRunCompleted" in notifications && "onRunFailed" in notifications && typeof notifications.enabled === "boolean" && typeof notifications.onActionRequired === "boolean" && typeof notifications.onRunCompleted === "boolean" && typeof notifications.onRunFailed === "boolean" && typeof security === "object" && security !== null && "customFileRules" in security && "customCommandRules" in security && isSecurityRuleList(security.customFileRules, "pattern") && isSecurityRuleList(security.customCommandRules, "command") && isAppearancePreferences(value.appearance);
}

type DesktopIpcOptions = {
  hostInfo: DesktopHostInfo;
  showApplicationMenu: (menuId: DesktopMenuId, window: BrowserWindow) => void;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
};

function isDesktopMenuId(value: unknown): value is DesktopMenuId {
  return value === "file" || value === "edit" || value === "window" || value === "help";
}

export function registerRuntimeIpc(runtime: WordlessRuntime, appearanceAssets: AppearanceAssetService, options: DesktopIpcOptions): void {
  ipcMain.handle("wordless:host:info", () => options.hostInfo);
  ipcMain.handle("wordless:menu:open", (event, payload: unknown) => {
    const menuId = isRecord(payload) ? payload.menuId : undefined;
    if (!isDesktopMenuId(menuId)) throw new Error("Invalid application menu");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Application window is unavailable");
    options.showApplicationMenu(menuId, window);
  });
  ipcMain.handle("wordless:update:check", () => options.checkForUpdates());
  ipcMain.handle("wordless:update:download", () => options.downloadUpdate());
  ipcMain.handle("wordless:update:install", () => options.installUpdate());
  ipcMain.handle("wordless:snapshot", () => runtime.getSnapshot());
  ipcMain.handle("wordless:usage:report", async (_event, payload: unknown) => {
    const input = parsePayload<{ startAt: number; endAt: number; groupBy: "provider" | "model" }>(UsageReportQuerySchema, payload);
    return await runtime.getUsageReport(input);
  });
  ipcMain.handle("wordless:session:snapshot", (_event, sessionId: unknown) => runtime.getSessionSnapshot(String(sessionId)));
  ipcMain.handle("wordless:session:view", (_event, sessionId: unknown) => runtime.getSessionView(String(sessionId)));
  ipcMain.handle("wordless:session:history", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; after?: string; before?: string; aroundTurnId?: string; limit?: number }>(SessionHistoryPageRequestSchema, payload);
    return runtime.getSessionHistoryPage(input.sessionId, { after: input.after, before: input.before, aroundTurnId: input.aroundTurnId, limit: input.limit });
  });
  ipcMain.handle("wordless:session:message-search", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; query: string; role?: "user" | "assistant"; limit?: number }>(SessionMessageSearchRequestSchema, payload);
    return runtime.searchSessionMessages(input.sessionId, { query: input.query, role: input.role, limit: input.limit });
  });
  ipcMain.handle("wordless:session:tool-output", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; callId: string }>(SessionToolOutputRequestSchema, payload);
    return runtime.getSessionToolOutput(input.sessionId, input.callId);
  });
  ipcMain.handle("wordless:session:rename", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; title: string }>(RenameSessionSchema, payload);
    return runtime.renameSession(input.sessionId, input.title);
  });
  ipcMain.handle("wordless:session:pin", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; pinned: boolean }>(SetSessionPinnedSchema, payload);
    return runtime.setSessionPinned(input.sessionId, input.pinned);
  });
  ipcMain.handle("wordless:session:delete", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string }>(DeleteSessionSchema, payload);
    await runtime.deleteSession(input.sessionId);
  });
  ipcMain.handle("wordless:media:create", async (_event, payload: unknown) => {
    const input = parsePayload<{ title?: string }>(CreateMediaProjectSchema, payload);
    return await runtime.createMediaProject(input.title);
  });
  ipcMain.handle("wordless:media:get", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string }>(MediaProjectRequestSchema, payload);
    return runtime.getMediaProject(input.sessionId);
  });
  ipcMain.handle("wordless:media:import", async (_event, payload: unknown) => {
    const input = parsePayload<Parameters<WordlessRuntime["importMediaImages"]>[0]>(ImportMediaImagesSchema, payload);
    return await runtime.importMediaImages(input);
  });
  ipcMain.handle("wordless:media:duplicate", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; assetId: string; targetPosition: { x: number; y: number } }>(DuplicateMediaAssetSchema, payload);
    return await runtime.duplicateMediaAsset(input.sessionId, input.assetId, input.targetPosition);
  });
  ipcMain.handle("wordless:media:delete", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; assetId: string }>(DeleteMediaAssetSchema, payload);
    return await runtime.deleteMediaAsset(input.sessionId, input.assetId);
  });
  ipcMain.handle("wordless:media:asset-data", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; assetId: string }>(Type.Object({ sessionId: Type.String({ minLength: 1 }), assetId: Type.String({ minLength: 1 }) }), payload);
    return await runtime.readMediaAssetData(input.sessionId, input.assetId);
  });
  ipcMain.handle("wordless:media:download", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; assetId: string }>(Type.Object({ sessionId: Type.String({ minLength: 1 }), assetId: Type.String({ minLength: 1 }) }), payload);
    return await runtime.downloadMediaAsset(input.sessionId, input.assetId, app.getPath("downloads"));
  });
  ipcMain.handle("wordless:media:operation:start", async (_event, payload: unknown) => {
    const input = parsePayload<Parameters<WordlessRuntime["startMediaOperation"]>[0]>(StartMediaOperationSchema, payload);
    return await runtime.startMediaOperation(input);
  });
  ipcMain.handle("wordless:media:layout", (_event, payload: unknown) => {
    const input = parsePayload<Parameters<WordlessRuntime["updateMediaLayout"]>[0]>(UpdateMediaLayoutSchema, payload);
    return runtime.updateMediaLayout(input);
  });
  ipcMain.handle("wordless:media:cover", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; assetId: string }>(SetMediaCoverSchema, payload);
    return runtime.setMediaCoverAsset(input.sessionId, input.assetId);
  });
  ipcMain.handle("wordless:media:operation:cancel", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; operationId: string }>(CancelMediaOperationSchema, payload);
    await runtime.cancelMediaOperation(input.sessionId, input.operationId);
  });
  ipcMain.handle("wordless:session:open-folder", async (_event, sessionId: unknown) => {
    const failure = await shell.openPath(runtime.getSessionRuntimeRoot(String(sessionId)));
    if (failure) throw new Error(failure);
  });
  ipcMain.handle("wordless:workspace:create", (_event, payload: unknown) => {
    const input = parsePayload<{ name: string }>(CreateWorkspaceSchema, payload);
    return runtime.createManagedWorkspace(input.name);
  });
  ipcMain.handle("wordless:workspace:open", (_event, payload: unknown) => {
    const input = parsePayload<{ path: string }>(OpenWorkspaceSchema, payload);
    return runtime.openLinkedWorkspace(input.path);
  });
  ipcMain.handle("wordless:workspace:pick", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return await runtime.openLinkedWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("wordless:session:create-and-prompt", async (_event, payload: unknown) => {
    const input = parsePayload<{ draft: Parameters<WordlessRuntime["createAndPrompt"]>[0]; parts: UserPromptPart[]; attachments?: Array<{ path: string }> }>(CreateAndPromptSchema, payload);
    return await runtime.createAndPrompt(input.draft, formatPromptWithSkillReferences(input.parts), selectedSkillIdsFromPromptParts(input.parts), input.attachments?.map((attachment) => attachment.path));
  });
  ipcMain.handle("wordless:session:prompt", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; parts: UserPromptPart[]; attachments?: Array<{ path: string }> }>(PromptSessionSchema, payload);
    await runtime.promptSession(input.sessionId, formatPromptWithSkillReferences(input.parts), input.attachments?.map((attachment) => attachment.path), selectedSkillIdsFromPromptParts(input.parts));
  });
  ipcMain.handle("wordless:session:compact", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string }>(CompactSessionSchema, payload);
    await runtime.compactSession(input.sessionId);
  });
  ipcMain.handle("wordless:session:context", (_event, sessionId: unknown) => runtime.getSessionContext(String(sessionId)));
  ipcMain.handle("wordless:session:artifact:diff", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; path: string }>(WorkspaceFileRequestSchema, payload);
    return await runtime.getSessionArtifactDiff(input.sessionId, input.path);
  });
  ipcMain.handle("wordless:session:workspace:list", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; path: string }>(ListWorkspaceDirectorySchema, payload);
    return await runtime.listSessionWorkspaceDirectory(input.sessionId, input.path);
  });
  ipcMain.handle("wordless:session:workspace:search", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; query: string }>(SessionWorkspaceReferenceSearchSchema, payload);
    return await runtime.searchSessionWorkspace(input.sessionId, input.query);
  });
  ipcMain.handle("wordless:workspace:search", async (_event, payload: unknown) => {
    const input = parsePayload<{ workspaceId: string; query: string }>(WorkspaceReferenceSearchSchema, payload);
    return await runtime.searchWorkspace(input.workspaceId, input.query);
  });
  ipcMain.handle("wordless:session:workspace:read", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; path: string }>(WorkspaceFileRequestSchema, payload);
    return await runtime.readSessionWorkspaceTextFile(input.sessionId, input.path);
  });
  ipcMain.handle("wordless:session:workspace:open", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; path: string }>(WorkspaceFileRequestSchema, payload);
    const failure = await shell.openPath(await runtime.resolveSessionWorkspaceFile(input.sessionId, input.path));
    if (failure) throw new Error(failure);
  });
  ipcMain.handle("wordless:session:workspace:reveal", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; path: string }>(WorkspaceFileRequestSchema, payload);
    shell.showItemInFolder(await runtime.resolveSessionWorkspaceFile(input.sessionId, input.path));
  });
  ipcMain.handle("wordless:session:workspace:save-as", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; path: string }>(WorkspaceFileRequestSchema, payload);
    const source = await runtime.resolveSessionWorkspaceFile(input.sessionId, input.path);
    const result = await dialog.showSaveDialog({ defaultPath: path.basename(source) });
    if (!result.canceled && result.filePath) await copyFile(source, result.filePath);
  });
  ipcMain.handle("wordless:session:workspace:trash", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; path: string }>(WorkspaceDeleteSchema, payload);
    const source = await runtime.resolveSessionWorkspaceEntry(input.sessionId, input.path);
    await shell.trashItem(source);
    runtime.invalidateSessionWorkspaceSearch(input.sessionId);
  });
  ipcMain.handle("wordless:session:approval", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; approvalId: string; approved: boolean; feedback?: string }>(ResolveOperationApprovalSchema, payload);
    await runtime.resolveOperationApproval(input.sessionId, input.approvalId, input.approved, input.feedback);
  });
  ipcMain.handle("wordless:session:approval-mode", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; mode: "manual" | "auto" }>(SetSessionToolApprovalModeSchema, payload);
    await runtime.setSessionToolApprovalMode(input.sessionId, input.mode);
  });
  ipcMain.handle("wordless:session:user-request", async (_event, payload: unknown) => {
    const input = parsePayload<{
      sessionId: string;
      requestId: string;
      status: "submitted" | "cancelled";
      answers?: Record<string, string | string[] | boolean>;
      feedback?: string;
    }>(ResolveUserRequestSchema, payload);
    await runtime.resolveUserRequest(input.sessionId, input.requestId, {
      status: input.status,
      answers: input.answers,
      feedback: input.feedback,
    });
  });
  ipcMain.handle("wordless:session:cancel", async (_event, sessionId: unknown) => await runtime.cancelSession(String(sessionId)));
  ipcMain.handle("wordless:session:model", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; model: { connectionId: string; modelId: string } }>(SetSessionModelSchema, payload);
    await runtime.setSessionModel(input.sessionId, input.model);
  });
  ipcMain.handle("wordless:session:access", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; accessLevel: SessionAccessLevel }>(SetSessionAccessSchema, payload);
    return runtime.setSessionAccess(input.sessionId, input.accessLevel);
  });
  ipcMain.handle("wordless:session:interaction-mode", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; interactionMode: "default" | "clarify" | "plan" }>(SetSessionInteractionModeSchema, payload);
    return await runtime.setSessionInteractionMode(input.sessionId, input.interactionMode);
  });
  ipcMain.handle("wordless:session:clarification-question", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; callId: string; value: string | boolean }>(ResolveClarificationQuestionSchema, payload);
    await runtime.resolveClarificationQuestion(input.sessionId, input.callId, input.value);
  });
  ipcMain.handle("wordless:session:clarification-handoff", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; interactionMode: "default" | "clarify" | "plan" }>(HandoffClarificationSchema, payload);
    await runtime.handoffClarification(input.sessionId, input.interactionMode);
  });
  ipcMain.handle("wordless:preferences", (_event, payload: unknown) => {
    const input = parsePayload<{ key: string; value: unknown }>(SetPreferenceSchema, payload);
    if (input.key !== "app" || !isAppPreferences(input.value)) throw new Error("Invalid preferences payload");
    runtime.setPreferences(input.value);
    updateTitleBarOverlays(input.value);
  });
  ipcMain.handle("wordless:appearance:import", async (_event, payload: unknown) => {
    const input = parsePayload<{ sourcePath: string }>(ImportAppearanceBackgroundSchema, payload);
    return await appearanceAssets.import(input.sourcePath);
  });
  ipcMain.handle("wordless:appearance:remove", async (_event, payload: unknown) => {
    const input = parsePayload<{ assetId: string }>(RemoveAppearanceBackgroundSchema, payload);
    const active = runtime.getSnapshot().preferences.appearance.background.source;
    if (active.kind === "custom" && active.assetId === input.assetId) throw new Error("Choose another background before removing this asset");
    await appearanceAssets.remove(input.assetId);
  });
  ipcMain.handle("wordless:model-config:snapshot", () => runtime.getSnapshot().modelConfiguration);
  ipcMain.handle("wordless:skills:refresh", async () => await runtime.refreshSkills());
  ipcMain.handle("wordless:skills:import", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "Skill package", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    await runtime.importSkill(result.filePaths[0]);
    return true;
  });
  ipcMain.handle("wordless:skills:import-file", async (_event, payload: unknown) => {
    const input = parsePayload<{ sourcePath: string }>(ImportSkillFileSchema, payload);
    await runtime.importSkill(input.sourcePath);
  });
  ipcMain.handle("wordless:skills:enabled", async (_event, payload: unknown) => {
    const input = parsePayload<{ skillId: string; enabled: boolean }>(SetSkillEnabledSchema, payload);
    await runtime.setSkillEnabled(input.skillId, input.enabled);
  });
  ipcMain.handle("wordless:skills:remove", async (_event, payload: unknown) => {
    const input = parsePayload<{ skillId: string }>(RemoveManagedSkillSchema, payload);
    await runtime.removeManagedSkill(input.skillId);
  });
  ipcMain.handle("wordless:connectors:save", async (_event, payload: unknown) => {
    const input = parsePayload<{ configuration: Parameters<WordlessRuntime["saveConnector"]>[0] }>(Type.Object({ configuration: ConnectorConfigurationSchema }), payload);
    await runtime.saveConnector(input.configuration);
  });
  ipcMain.handle("wordless:connectors:test", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string }>(ConnectorIdSchema, payload);
    await runtime.testConnector(input.connectorId);
  });
  ipcMain.handle("wordless:connectors:authorize", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string }>(ConnectorIdSchema, payload);
    await runtime.authorizeConnector(input.connectorId, {
      openExternal: async (url) => { await shell.openExternal(url); },
    });
  });
  ipcMain.handle("wordless:connectors:trust", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string }>(ConnectorIdSchema, payload);
    await runtime.trustConnector(input.connectorId);
  });
  ipcMain.handle("wordless:connectors:enabled", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string; enabled: boolean }>(SetConnectorEnabledSchema, payload);
    await runtime.setConnectorEnabled(input.connectorId, input.enabled);
  });
  ipcMain.handle("wordless:connectors:remove", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string }>(ConnectorIdSchema, payload);
    await runtime.removeConnector(input.connectorId);
  });
  ipcMain.handle("wordless:session:connectors", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; connectorIds: string[] }>(SetSessionConnectorsSchema, payload);
    return runtime.setSessionConnectors(input.sessionId, input.connectorIds);
  });
  ipcMain.handle("wordless:connectors:resources", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string }>(ConnectorIdSchema, payload);
    return await runtime.listConnectorResources(input.connectorId);
  });
  ipcMain.handle("wordless:connectors:resource", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string; uri: string }>(Type.Object({ connectorId: Type.String({ minLength: 1 }), uri: Type.String({ minLength: 1 }) }), payload);
    return await runtime.readConnectorResource(input.connectorId, input.uri);
  });
  ipcMain.handle("wordless:connectors:prompts", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string }>(ConnectorIdSchema, payload);
    return await runtime.listConnectorPrompts(input.connectorId);
  });
  ipcMain.handle("wordless:connectors:prompt", async (_event, payload: unknown) => {
    const input = parsePayload<{ connectorId: string; name: string; arguments: Record<string, string> }>(ConnectorPromptSchema, payload);
    return await runtime.getConnectorPrompt(input.connectorId, input.name, input.arguments);
  });
  ipcMain.handle("wordless:model-config:save-provider", async (_event, payload: unknown) => {
    const input = parsePayload<{ kind: "chat" | "image"; providerId: string; configuration: Record<string, unknown> }>(SaveProviderConfigurationSchema, payload);
    await runtime.saveProviderConfiguration(input.kind, input.providerId, input.configuration);
  });
  ipcMain.handle("wordless:model-config:set-enabled", async (_event, payload: unknown) => {
    const input = parsePayload<{ kind: "chat" | "image"; providerId: string; modelId: string; enabled: boolean }>(SetConfiguredModelEnabledSchema, payload);
    await runtime.setConfiguredModelEnabled(input.kind, input.providerId, input.modelId, input.enabled);
  });
  ipcMain.handle("wordless:model-config:delete-custom-provider", async (_event, payload: unknown) => {
    const input = parsePayload<{ kind: "chat" | "image"; providerId: string }>(DeleteCustomProviderSchema, payload);
    await runtime.deleteCustomProvider(input.kind, input.providerId);
  });
  ipcMain.handle("wordless:model-config:oauth", async (_event, providerId: unknown) => {
    await runtime.loginProviderOAuth(String(providerId), {
      prompt: async (prompt: { type: string; message: string; options?: Array<{ id: string; label: string }> }) => {
        if (prompt.type === "select" && prompt.options) {
          const result = await dialog.showMessageBox({ message: prompt.message, buttons: prompt.options.map((option) => option.label), cancelId: -1 });
          const selection = prompt.options[result.response];
          if (!selection) throw new Error("OAuth login cancelled");
          return selection.id;
        }
        throw new Error(`OAuth prompt type ${prompt.type} is not supported by the desktop host.`);
      },
      notify: async (event: { type: string; url?: string; verificationUri?: string; userCode?: string; instructions?: string }) => {
        if (event.type === "auth_url" && event.url) {
          await shell.openExternal(event.url);
          await dialog.showMessageBox({ message: event.instructions ?? "Complete sign-in in your browser, then return to Wordless." });
        }
        if (event.type === "device_code" && event.verificationUri && event.userCode) {
          await shell.openExternal(event.verificationUri);
          await dialog.showMessageBox({ message: `Enter code ${event.userCode} in your browser to continue.` });
        }
      },
    });
  });
  ipcMain.handle("wordless:extensions:snapshot", () => runtime.getExtensionSnapshot());
  ipcMain.handle("wordless:extensions:enabled", async (_event, payload: unknown) => {
    const input = parsePayload<{ extensionId: string; enabled: boolean }>(SetExtensionEnabledSchema, payload);
    return await runtime.setExtensionEnabled(input.extensionId, input.enabled);
  });
  ipcMain.handle("wordless:extensions:settings", async (_event, payload: unknown) => {
    const input = parsePayload<{ extensionId: string; settings: Record<string, unknown> }>(UpdateExtensionSettingsSchema, payload);
    return await runtime.updateExtensionSettings(input.extensionId, input.settings);
  });
  ipcMain.handle("wordless:session:extension-interact", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; extensionId: string; action: string; payload?: unknown }>(SessionExtensionInteractionSchema, payload);
    await runtime.interactWithSessionExtension(input.sessionId, { extensionId: input.extensionId, action: input.action, payload: input.payload });
  });
  ipcMain.handle("wordless:session:extension-state", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; extensionId: string; state: Record<string, unknown> }>(SetSessionExtensionStateSchema, payload);
    await runtime.setSessionExtensionState(input.sessionId, input.extensionId, input.state);
  });
}
