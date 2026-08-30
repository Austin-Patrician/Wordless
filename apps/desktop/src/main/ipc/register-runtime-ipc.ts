import { copyFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import type {
  AppearancePreferences,
  AppPreferences,
  AutomationTaskInput,
  TaskRecordInput,
  TaskStatus,
  SessionAccessLevel,
  ThinkingLevel,
  ToolApprovalMode,
  UserMessageSubmission,
  UserPromptPart,
} from "@wordless/domain";
import {
  formatPromptWithSkillReferences,
  selectedSkillIdsFromPromptParts,
} from "@wordless/agent-driver-sdk";
import {
  CreateAndPromptSchema,
  AutomationTaskInputSchema,
  TaskRecordInputSchema,
  TaskIdSchema,
  TaskMoveSchema,
  CompactSessionSchema,
  ConnectorConfigurationSchema,
  ConnectorIdSchema,
  ConnectorPromptSchema,
  CreateMediaProjectSchema,
  CreateWorkspaceSchema,
  DeleteMediaAssetSchema,
  DeleteCustomProviderSchema,
  DiscoverProviderModelsSchema,
  DeleteSessionSchema,
  DuplicateMediaAssetSchema,
  ImportSkillFileSchema,
  ImportMediaImagesSchema,
  ImportAppearanceBackgroundSchema,
  SessionHistoryPageRequestSchema,
  ExpertMemberHistoryRequestSchema,
  ExpertMemberLiveStateRequestSchema,
  ExpertMemberToolOutputRequestSchema,
  SessionMessageSearchRequestSchema,
  SessionToolOutputRequestSchema,
  SessionArtifactRequestSchema,
  ListWorkspaceDirectorySchema,
  OpenExternalUrlSchema,
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
  SetSessionExpertSchema,
  SetSessionPinnedSchema,
  SetPreferenceSchema,
  SetSkillEnabledSchema,
  SetSessionModelSchema,
  SetSessionThinkingLevelSchema,
  SessionExtensionInteractionSchema,
  UpdateExtensionSettingsSchema,
  UpdateMediaLayoutSchema,
  UpdateMediaViewportSchema,
  UsageReportQuerySchema,
  WorkspaceFileRequestSchema,
  WorkspaceDeleteSchema,
  WorkspaceReferenceSearchSchema,
  SessionWorkspaceReferenceSearchSchema,
  CancelMediaOperationSchema,
  StartMediaOperationSchema,
  HandoffClarificationSchema,
  SaveExpertSchema,
  DeleteExpertSchema,
  SaveExpertTeamSchema,
  DeleteExpertTeamSchema,
  GetExpertTeamDetailSchema,
  type DesktopHostInfo,
  type DesktopMenuId,
  type DesktopAppInfo,
  type DesktopRelease,
  type DesktopUpdateSnapshot,
} from "@wordless/protocol";
import { WordlessRuntime } from "@wordless/runtime";
import { AppearanceAssetService } from "../appearance/appearance-asset-service";
import { OfficeCliService } from "../office/office-cli-service";
import { GoogleAccountService } from "../account/google-account-service";
import { CloudSyncService } from "../cloud-sync/cloud-sync-service";
import { updateTitleBarOverlays } from "../windows/main-window";
import type { DesktopDataAnalysisService } from "../data-analysis/data-analysis-service";
import type { AutomationService } from "../automation/automation-service";
import { McpRegistryService } from "../marketplace/mcp-registry-service";
import { SkillsMpMarketplaceService } from "../marketplace/skillsmp-marketplace-service";

function parsePayload<T>(schema: TSchema, payload: unknown): T {
  if (!Value.Check(schema, payload)) throw new Error("Invalid request payload");
  return payload as T;
}

function isSecurityRuleList(
  value: unknown,
  property: "pattern" | "command",
): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (rule) =>
        typeof rule === "object" &&
        rule !== null &&
        !Array.isArray(rule) &&
        "id" in rule &&
        "label" in rule &&
        property in rule &&
        typeof rule.id === "string" &&
        typeof rule.label === "string" &&
        typeof rule[property] === "string",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAppearancePreferences(
  value: unknown,
): value is AppearancePreferences {
  if (!isRecord(value) || !isRecord(value.background)) return false;
  const { background } = value;
  if (
    background.fit !== "cover" &&
    background.fit !== "contain" &&
    background.fit !== "tile"
  )
    return false;
  if (
    !isRecord(background.position) ||
    typeof background.position.x !== "number" ||
    typeof background.position.y !== "number" ||
    !Number.isFinite(background.position.x) ||
    !Number.isFinite(background.position.y) ||
    background.position.x < 0 ||
    background.position.x > 100 ||
    background.position.y < 0 ||
    background.position.y > 100
  )
    return false;
  if (
    typeof background.intensity !== "number" ||
    !Number.isFinite(background.intensity) ||
    background.intensity < 0 ||
    background.intensity > 100
  )
    return false;
  if (
    typeof background.blurPx !== "number" ||
    !Number.isFinite(background.blurPx) ||
    background.blurPx < 0 ||
    background.blurPx > 16
  )
    return false;
  if (
    !isRecord(background.source) ||
    typeof background.source.kind !== "string"
  )
    return false;
  if (background.source.kind === "none") return true;
  if (background.source.kind === "builtin")
    return (
      background.source.id === "paper" ||
      background.source.id === "micro-dots" ||
      background.source.id === "fine-grid"
    );
  return (
    background.source.kind === "custom" &&
    typeof background.source.assetId === "string" &&
    /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/.test(background.source.assetId) &&
    (background.source.posterAssetId === undefined || (typeof background.source.posterAssetId === "string" && /^[a-f0-9]{64}-poster\.png$/.test(background.source.posterAssetId))) &&
    (background.source.animated === undefined || typeof background.source.animated === "boolean")
  );
}

function isAppPreferences(value: unknown): value is AppPreferences {
  if (
    typeof value !== "object" ||
    value === null ||
    !("locale" in value) ||
    !("theme" in value) ||
    !("entryModels" in value) ||
    !("notifications" in value) ||
    !("security" in value) ||
    !("appearance" in value)
  )
    return false;
  const notifications = value.notifications;
  const security = value.security;
  return (
    typeof notifications === "object" &&
    notifications !== null &&
    "enabled" in notifications &&
    "onActionRequired" in notifications &&
    "onRunCompleted" in notifications &&
    "onRunFailed" in notifications &&
    typeof notifications.enabled === "boolean" &&
    typeof notifications.onActionRequired === "boolean" &&
    typeof notifications.onRunCompleted === "boolean" &&
    typeof notifications.onRunFailed === "boolean" &&
    typeof security === "object" &&
    security !== null &&
    "customFileRules" in security &&
    "customCommandRules" in security &&
    isSecurityRuleList(security.customFileRules, "pattern") &&
    isSecurityRuleList(security.customCommandRules, "command") &&
    isAppearancePreferences(value.appearance)
  );
}

type DesktopIpcOptions = {
  hostInfo: DesktopHostInfo;
  getAppInfo: () => DesktopAppInfo;
  showApplicationMenu: (menuId: DesktopMenuId, window: BrowserWindow) => void;
  getUpdateSnapshot: () => DesktopUpdateSnapshot;
  listReleases: (refresh?: boolean) => Promise<DesktopRelease[]>;
  checkForUpdates: () => Promise<DesktopUpdateSnapshot>;
  downloadUpdate: () => Promise<DesktopUpdateSnapshot>;
  installUpdate: () => Promise<DesktopUpdateSnapshot>;
  openReleasePage: (version?: string) => Promise<void>;
  account: GoogleAccountService;
  cloudSync: CloudSyncService;
  office: OfficeCliService;
  dataAnalysis: DesktopDataAnalysisService;
  automation: AutomationService;
  mcpMarketplace: McpRegistryService;
  skillMarketplace: SkillsMpMarketplaceService;
};

function isDesktopMenuId(value: unknown): value is DesktopMenuId {
  return (
    value === "file" ||
    value === "edit" ||
    value === "window" ||
    value === "help"
  );
}

export function registerRuntimeIpc(
  runtime: WordlessRuntime,
  appearanceAssets: AppearanceAssetService,
  options: DesktopIpcOptions,
): void {
  const showDeviceCodeDialog = async ({
    verificationUri,
    userCode,
    providerLabel,
  }: {
    verificationUri: string;
    userCode: string;
    providerLabel: string;
  }) => {
    await shell.openExternal(verificationUri);
    const result = await dialog.showMessageBox({
      title: `Connect ${providerLabel}`,
      message: "Complete the connection in your browser",
      detail: `Enter the verification code ${userCode} in the browser window that just opened.`,
      buttons: [`Copy ${userCode}`, "Done"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      ...(process.platform === "win32" ? { icon: path.join(__dirname, "wordless.ico") } : {}),
    });
    if (result.response === 0) clipboard.writeText(userCode);
  };
  ipcMain.handle("wordless:host:info", () => options.hostInfo);
  ipcMain.handle("wordless:app:info", () => options.getAppInfo());
  ipcMain.handle("wordless:menu:open", (event, payload: unknown) => {
    const menuId = isRecord(payload) ? payload.menuId : undefined;
    if (!isDesktopMenuId(menuId)) throw new Error("Invalid application menu");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Application window is unavailable");
    options.showApplicationMenu(menuId, window);
  });
  ipcMain.handle("wordless:update:snapshot", () => options.getUpdateSnapshot());
  ipcMain.handle("wordless:update:releases", (_event, payload: unknown) =>
    options.listReleases(isRecord(payload) && payload.refresh === true),
  );
  ipcMain.handle("wordless:update:check", () => options.checkForUpdates());
  ipcMain.handle("wordless:update:download", () => options.downloadUpdate());
  ipcMain.handle("wordless:update:install", () => options.installUpdate());
  ipcMain.handle("wordless:update:open-release", (_event, payload: unknown) => {
    const version =
      isRecord(payload) && typeof payload.version === "string"
        ? payload.version
        : undefined;
    return options.openReleasePage(version);
  });
  ipcMain.handle("wordless:account:snapshot", () =>
    options.account.getSnapshot(),
  );
  ipcMain.handle("wordless:account:google:login", async () => {
    const snapshot = await options.account.login();
    if (options.cloudSync.getSnapshot().enabled)
      void options.cloudSync.syncNow();
    return snapshot;
  });
  ipcMain.handle("wordless:account:logout", async () => {
    await options.account.logout();
    options.cloudSync.onAccountLoggedOut();
  });
  ipcMain.handle("wordless:cloud-sync:snapshot", () =>
    options.cloudSync.getSnapshot(),
  );
  ipcMain.handle("wordless:cloud-sync:enable", (_event, strategy: unknown) =>
    options.cloudSync.enable(
      strategy === "local" || strategy === "remote" ? strategy : "merge",
    ),
  );
  ipcMain.handle("wordless:cloud-sync:disable", () =>
    options.cloudSync.disable(),
  );
  ipcMain.handle("wordless:cloud-sync:sync-now", async () => {
    if (await options.account.needsDriveAppDataAuthorization())
      await options.account.authorizeDriveAppData();
    return await options.cloudSync.syncNow();
  });
  ipcMain.handle(
    "wordless:cloud-sync:resolve-conflict",
    (_event, resolution: unknown) =>
      options.cloudSync.resolveConflicts(
        resolution === "remote" ? "remote" : "local",
      ),
  );
  ipcMain.handle("wordless:cloud-sync:delete-remote", () =>
    options.cloudSync.deleteRemote(),
  );
  ipcMain.handle("wordless:tasks:list", () => runtime.listTasks());
  ipcMain.handle("wordless:tasks:create", (_event, payload: unknown) => {
    const { input } = parsePayload<{ input: TaskRecordInput }>(Type.Object({ input: TaskRecordInputSchema }), payload);
    return runtime.createTask(input);
  });
  ipcMain.handle("wordless:tasks:update", (_event, payload: unknown) => {
    const { id, input } = parsePayload<{ id: string; input: TaskRecordInput }>(Type.Object({ id: Type.String({ minLength: 1 }), input: TaskRecordInputSchema }), payload);
    return runtime.updateTask(id, input);
  });
  ipcMain.handle("wordless:tasks:move", (_event, payload: unknown) => {
    const input = parsePayload<{ id: string; status: TaskStatus; position?: number }>(TaskMoveSchema, payload);
    return runtime.moveTask(input.id, input.status, input.position);
  });
  ipcMain.handle("wordless:tasks:delete", (_event, payload: unknown) => {
    const { id } = parsePayload<{ id: string }>(TaskIdSchema, payload);
    runtime.deleteTask(id);
  });
  ipcMain.handle("wordless:tasks:execute", (_event, payload: unknown) => {
    const { id } = parsePayload<{ id: string }>(TaskIdSchema, payload);
    return runtime.executeTask(id);
  });
  const IdSchema = Type.Object({ id: Type.String({ minLength: 1 }) });
  const IdsSchema = Type.Object({
    ids: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 500,
    }),
  });
  ipcMain.handle("wordless:automation:list", () =>
    options.automation.listTasks(),
  );
  ipcMain.handle("wordless:automation:create", (_event, payload: unknown) => {
    const input = parsePayload<{ input: AutomationTaskInput }>(
      Type.Object({ input: AutomationTaskInputSchema }),
      payload,
    );
    return options.automation.createTask(input.input);
  });
  ipcMain.handle("wordless:automation:update", (_event, payload: unknown) => {
    const input = parsePayload<{ id: string; input: AutomationTaskInput }>(
      Type.Object({
        id: Type.String({ minLength: 1 }),
        input: AutomationTaskInputSchema,
      }),
      payload,
    );
    return options.automation.updateTask(input.id, input.input);
  });
  ipcMain.handle(
    "wordless:automation:set-enabled",
    (_event, payload: unknown) => {
      const input = parsePayload<{ ids: string[]; enabled: boolean }>(
        Type.Intersect([IdsSchema, Type.Object({ enabled: Type.Boolean() })]),
        payload,
      );
      options.automation.setEnabled(input.ids, input.enabled);
    },
  );
  ipcMain.handle("wordless:automation:delete", (_event, payload: unknown) => {
    const input = parsePayload<{ ids: string[] }>(IdsSchema, payload);
    options.automation.deleteTasks(input.ids);
  });
  ipcMain.handle("wordless:automation:run", (_event, payload: unknown) => {
    const input = parsePayload<{ id: string }>(IdSchema, payload);
    return options.automation.runNow(input.id);
  });
  ipcMain.handle("wordless:automation:runs", (_event, payload: unknown) => {
    const input = parsePayload<{ limit?: number }>(
      Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      }),
      payload,
    );
    return options.automation.listRuns(input.limit);
  });
  ipcMain.handle(
    "wordless:automation:run-delete",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ id: string }>(IdSchema, payload);
      await options.automation.deleteRun(input.id);
    },
  );
  ipcMain.handle("wordless:external:open", async (_event, payload: unknown) => {
    const input = parsePayload<{ url: string }>(OpenExternalUrlSchema, payload);
    const url = new URL(input.url);
    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:" &&
      url.protocol !== "mailto:"
    )
      throw new Error("Unsupported external URL protocol");
    await shell.openExternal(url.toString());
  });
  ipcMain.handle("wordless:snapshot", () => runtime.getSnapshot());
  ipcMain.handle("wordless:usage:report", async (_event, payload: unknown) => {
    const input = parsePayload<{
      startAt: number;
      endAt: number;
      groupBy: "provider" | "model";
    }>(UsageReportQuerySchema, payload);
    return await runtime.getUsageReport(input);
  });
  ipcMain.handle("wordless:session:snapshot", (_event, sessionId: unknown) =>
    runtime.getSessionSnapshot(String(sessionId)),
  );
  ipcMain.handle("wordless:session:view", (_event, sessionId: unknown) =>
    runtime.getSessionView(String(sessionId)),
  );
  ipcMain.handle("wordless:session:history", (_event, payload: unknown) => {
    const input = parsePayload<{
      sessionId: string;
      after?: string;
      before?: string;
      aroundTurnId?: string;
      limit?: number;
    }>(SessionHistoryPageRequestSchema, payload);
    return runtime.getSessionHistoryPage(input.sessionId, {
      after: input.after,
      before: input.before,
      aroundTurnId: input.aroundTurnId,
      limit: input.limit,
    });
  });
  ipcMain.handle(
    "wordless:session:message-search",
    (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        query: string;
        role?: "user" | "assistant";
        limit?: number;
      }>(SessionMessageSearchRequestSchema, payload);
      return runtime.searchSessionMessages(input.sessionId, {
        query: input.query,
        role: input.role,
        limit: input.limit,
      });
    },
  );
  ipcMain.handle("wordless:session:tool-output", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; callId: string }>(
      SessionToolOutputRequestSchema,
      payload,
    );
    return runtime.getSessionToolOutput(input.sessionId, input.callId);
  });
  ipcMain.handle("wordless:session:rename", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; title: string }>(
      RenameSessionSchema,
      payload,
    );
    return runtime.renameSession(input.sessionId, input.title);
  });
  ipcMain.handle("wordless:session:pin", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; pinned: boolean }>(
      SetSessionPinnedSchema,
      payload,
    );
    return runtime.setSessionPinned(input.sessionId, input.pinned);
  });
  ipcMain.handle(
    "wordless:session:delete",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string }>(
        DeleteSessionSchema,
        payload,
      );
      await runtime.deleteSession(
        input.sessionId,
        async (session) =>
          await options.office.releaseSession(
            session.id,
            session.runtimeRootPath,
          ),
      );
      options.automation.onSessionDeleted(input.sessionId);
    },
  );
  ipcMain.handle("wordless:media:create", async (_event, payload: unknown) => {
    const input = parsePayload<{ title?: string }>(
      CreateMediaProjectSchema,
      payload,
    );
    return await runtime.createMediaProject(input.title);
  });
  ipcMain.handle("wordless:media:get", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string }>(
      MediaProjectRequestSchema,
      payload,
    );
    return runtime.getMediaProject(input.sessionId);
  });
  ipcMain.handle("wordless:media:import", async (_event, payload: unknown) => {
    const input = parsePayload<
      Parameters<WordlessRuntime["importMediaImages"]>[0]
    >(ImportMediaImagesSchema, payload);
    return await runtime.importMediaImages(input);
  });
  ipcMain.handle(
    "wordless:media:duplicate",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        assetId: string;
        targetPosition: { x: number; y: number };
      }>(DuplicateMediaAssetSchema, payload);
      return await runtime.duplicateMediaAsset(
        input.sessionId,
        input.assetId,
        input.targetPosition,
      );
    },
  );
  ipcMain.handle("wordless:media:delete", async (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; assetId: string }>(
      DeleteMediaAssetSchema,
      payload,
    );
    return await runtime.deleteMediaAsset(input.sessionId, input.assetId);
  });
  ipcMain.handle(
    "wordless:media:asset-data",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; assetId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          assetId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await runtime.readMediaAssetData(input.sessionId, input.assetId);
    },
  );
  ipcMain.handle(
    "wordless:media:download",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; assetId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          assetId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await runtime.downloadMediaAsset(
        input.sessionId,
        input.assetId,
        app.getPath("downloads"),
      );
    },
  );
  ipcMain.handle(
    "wordless:media:operation:start",
    async (_event, payload: unknown) => {
      const input = parsePayload<
        Parameters<WordlessRuntime["startMediaOperation"]>[0]
      >(StartMediaOperationSchema, payload);
      return await runtime.startMediaOperation(input);
    },
  );
  ipcMain.handle("wordless:media:layout", (_event, payload: unknown) => {
    const input = parsePayload<
      Parameters<WordlessRuntime["updateMediaLayout"]>[0]
    >(UpdateMediaLayoutSchema, payload);
    return runtime.updateMediaLayout(input);
  });
  ipcMain.handle("wordless:media:viewport", (_event, payload: unknown) => {
    const input = parsePayload<
      Parameters<WordlessRuntime["updateMediaViewport"]>[0]
    >(UpdateMediaViewportSchema, payload);
    return runtime.updateMediaViewport(input);
  });
  ipcMain.handle("wordless:media:cover", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; assetId: string }>(
      SetMediaCoverSchema,
      payload,
    );
    return runtime.setMediaCoverAsset(input.sessionId, input.assetId);
  });
  ipcMain.handle(
    "wordless:media:operation:cancel",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; operationId: string }>(
        CancelMediaOperationSchema,
        payload,
      );
      await runtime.cancelMediaOperation(input.sessionId, input.operationId);
    },
  );
  ipcMain.handle(
    "wordless:session:open-folder",
    async (_event, sessionId: unknown) => {
      const failure = await shell.openPath(
        runtime.getSessionRuntimeRoot(String(sessionId)),
      );
      if (failure) throw new Error(failure);
    },
  );
  ipcMain.handle("wordless:workspace:create", (_event, payload: unknown) => {
    const input = parsePayload<{ name: string }>(
      CreateWorkspaceSchema,
      payload,
    );
    return runtime.createManagedWorkspace(input.name);
  });
  ipcMain.handle("wordless:workspace:open", (_event, payload: unknown) => {
    const input = parsePayload<{ path: string }>(OpenWorkspaceSchema, payload);
    return runtime.openLinkedWorkspace(input.path);
  });
  ipcMain.handle("wordless:workspace:pick", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return await runtime.openLinkedWorkspace(result.filePaths[0]);
  });
  ipcMain.handle(
    "wordless:session:create-and-prompt",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        draft: Parameters<WordlessRuntime["createAndPrompt"]>[0];
        parts: UserPromptPart[];
        submission: UserMessageSubmission;
        attachments?: Parameters<WordlessRuntime["createAndPrompt"]>[4] extends infer T ? T extends { attachments?: infer A } ? A : never : never;
      }>(CreateAndPromptSchema, payload);
      return await runtime.createAndPrompt(
        input.draft,
        formatPromptWithSkillReferences(input.parts),
        selectedSkillIdsFromPromptParts(input.parts),
        input.submission,
        input.attachments ? { attachments: input.attachments } : undefined,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:expert-member-history",
    (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        memberId: string;
        after?: string;
        before?: string;
        aroundTurnId?: string;
        limit?: number;
      }>(ExpertMemberHistoryRequestSchema, payload);
      return runtime.getExpertMemberHistory(input.sessionId, input.memberId, {
        after: input.after,
        before: input.before,
        aroundTurnId: input.aroundTurnId,
        limit: input.limit,
      });
    },
  );
  ipcMain.handle(
    "wordless:session:expert-member-tool-output",
    (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        memberId: string;
        callId: string;
      }>(ExpertMemberToolOutputRequestSchema, payload);
      return runtime.getExpertMemberToolOutput(
        input.sessionId,
        input.memberId,
        input.callId,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:expert-member-live-state",
    (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; memberId: string }>(
        ExpertMemberLiveStateRequestSchema,
        payload,
      );
      return runtime.getExpertMemberLiveState(input.sessionId, input.memberId);
    },
  );
  ipcMain.handle("wordless:experts:list", () => runtime.listExperts());
  ipcMain.handle("wordless:experts:save", (_event, payload: unknown) => {
    const input = parsePayload<{
      id?: string;
      input: Parameters<WordlessRuntime["saveExpert"]>[0];
    }>(SaveExpertSchema, payload);
    return runtime.saveExpert(input.input, input.id);
  });
  ipcMain.handle("wordless:experts:delete", (_event, payload: unknown) => {
    const input = parsePayload<{ id: string }>(DeleteExpertSchema, payload);
    runtime.deleteExpert(input.id);
  });
  ipcMain.handle("wordless:expert-teams:list", () => runtime.listExpertTeams());
  ipcMain.handle("wordless:expert-teams:detail", (_event, payload: unknown) => {
    const input = parsePayload<{ id: string }>(
      GetExpertTeamDetailSchema,
      payload,
    );
    return runtime.getExpertTeamDetail(input.id);
  });
  ipcMain.handle("wordless:expert-teams:save", (_event, payload: unknown) => {
    const input = parsePayload<{
      id?: string;
      input: Parameters<WordlessRuntime["saveExpertTeam"]>[0];
    }>(SaveExpertTeamSchema, payload);
    return runtime.saveExpertTeam(input.input, input.id);
  });
  ipcMain.handle("wordless:expert-teams:delete", (_event, payload: unknown) => {
    const input = parsePayload<{ id: string }>(DeleteExpertTeamSchema, payload);
    runtime.deleteExpertTeam(input.id);
  });
  ipcMain.handle(
    "wordless:session:prompt",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        parts: UserPromptPart[];
        submission: UserMessageSubmission;
        attachments?: Parameters<WordlessRuntime["promptSession"]>[4] extends infer T ? T extends { attachments?: infer A } ? A : never : never;
      }>(PromptSessionSchema, payload);
      await runtime.promptSession(
        input.sessionId,
        formatPromptWithSkillReferences(input.parts),
        selectedSkillIdsFromPromptParts(input.parts),
        input.submission,
        input.attachments ? { attachments: input.attachments } : undefined,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:compact",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string }>(
        CompactSessionSchema,
        payload,
      );
      await runtime.compactSession(input.sessionId);
    },
  );
  ipcMain.handle("wordless:session:context", (_event, sessionId: unknown) =>
    runtime.getSessionContext(String(sessionId)),
  );
  ipcMain.handle("wordless:session:artifacts", (_event, sessionId: unknown) =>
    runtime.getSessionArtifacts(String(sessionId)),
  );
  ipcMain.handle(
    "wordless:session:artifact:read",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        SessionArtifactRequestSchema,
        payload,
      );
      return await runtime.readSessionArtifact(input.sessionId, input.artifactId);
    },
  );
  ipcMain.handle(
    "wordless:session:artifact:open",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        SessionArtifactRequestSchema,
        payload,
      );
      const failure = await shell.openPath(
        await runtime.resolveSessionArtifact(input.sessionId, input.artifactId),
      );
      if (failure) throw new Error(failure);
    },
  );
  ipcMain.handle(
    "wordless:session:artifact:reveal",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        SessionArtifactRequestSchema,
        payload,
      );
      shell.showItemInFolder(
        await runtime.resolveSessionArtifact(input.sessionId, input.artifactId),
      );
    },
  );
  ipcMain.handle(
    "wordless:session:artifact:save-as",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        SessionArtifactRequestSchema,
        payload,
      );
      const source = await runtime.resolveSessionArtifact(
        input.sessionId,
        input.artifactId,
      );
      const result = await dialog.showSaveDialog({ defaultPath: path.basename(source) });
      if (!result.canceled && result.filePath)
        await copyFile(source, result.filePath);
    },
  );
  ipcMain.handle("wordless:presentation:health", () => options.office.health());
  ipcMain.handle("wordless:presentation:templates", () =>
    options.office.listTemplates(),
  );
  ipcMain.handle(
    "wordless:presentation:list",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string }>(
        Type.Object({ sessionId: Type.String({ minLength: 1 }) }),
        payload,
      );
      return await options.office.list(input.sessionId);
    },
  );
  ipcMain.handle(
    "wordless:presentation:create",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        name?: string;
        templateId?: string | null;
      }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
          templateId: Type.Optional(
            Type.Union([
              Type.String({ minLength: 1, maxLength: 128 }),
              Type.Null(),
            ]),
          ),
        }),
        payload,
      );
      return await options.office.create(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        { name: input.name, templateId: input.templateId },
      );
    },
  );
  ipcMain.handle(
    "wordless:presentation:preview",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        artifactId: string;
        force?: boolean;
      }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
          force: Type.Optional(Type.Boolean()),
        }),
        payload,
      );
      return await options.office.preview(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
        { force: input.force },
      );
    },
  );
  ipcMain.handle(
    "wordless:presentation:selection",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        artifactId: string;
        surfaceId?: string;
      }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
          surfaceId: Type.Optional(Type.String({ minLength: 1 })),
        }),
        payload,
      );
      return await options.office.selection(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
        input.surfaceId,
      );
    },
  );
  ipcMain.handle(
    "wordless:presentation:validate",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await options.office.validate(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
      );
    },
  );
  ipcMain.handle(
    "wordless:presentation:open",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      const failure = await shell.openPath(
        await options.office.sourceForOpen(
          input.sessionId,
          runtime.getSessionRuntimeRoot(input.sessionId),
          input.artifactId,
        ),
      );
      if (failure) throw new Error(failure);
    },
  );
  ipcMain.handle(
    "wordless:presentation:reveal",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      shell.showItemInFolder(
        await options.office.sourceForOpen(
          input.sessionId,
          runtime.getSessionRuntimeRoot(input.sessionId),
          input.artifactId,
        ),
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:list",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string }>(
        Type.Object({ sessionId: Type.String({ minLength: 1 }) }),
        payload,
      );
      return await options.office.listSpreadsheets(input.sessionId);
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:preview",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await options.office.previewSpreadsheet(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:selection",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await options.office.selectionSpreadsheet(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:capabilities",
    async () => await options.office.spreadsheetCapabilities(),
  );
  ipcMain.handle(
    "wordless:spreadsheet:profile",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        artifactId: string;
        sheet: string;
        range: string;
      }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
          sheet: Type.String({ minLength: 1 }),
          range: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await options.office.profileSpreadsheetRange(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
        input,
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:focus",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        artifactId: string;
        locator: string;
      }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
          locator: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      await options.office.focusSpreadsheetLocator(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
        input.locator,
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:clear-marks",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      await options.office.clearSpreadsheetMarks(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:changes",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await options.office.spreadsheetChanges(
        input.sessionId,
        input.artifactId,
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:validate",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await options.office.validateSpreadsheet(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.artifactId,
      );
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:open",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      const failure = await shell.openPath(
        await options.office.sourceForSpreadsheetOpen(
          input.sessionId,
          runtime.getSessionRuntimeRoot(input.sessionId),
          input.artifactId,
        ),
      );
      if (failure) throw new Error(failure);
    },
  );
  ipcMain.handle(
    "wordless:spreadsheet:reveal",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; artifactId: string }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          artifactId: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      shell.showItemInFolder(
        await options.office.sourceForSpreadsheetOpen(
          input.sessionId,
          runtime.getSessionRuntimeRoot(input.sessionId),
          input.artifactId,
        ),
      );
    },
  );
  ipcMain.handle(
    "wordless:analysis:capabilities",
    async () => await options.dataAnalysis.capabilities(),
  );
  ipcMain.handle(
    "wordless:analysis:snapshot",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string }>(
        Type.Object({ sessionId: Type.String({ minLength: 1 }) }),
        payload,
      );
      return await options.dataAnalysis.snapshot(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
      );
    },
  );
  ipcMain.handle("wordless:analysis:open", async (_event, payload: unknown) => {
    const input = parsePayload<{
      sessionId: string;
      analysisId: string;
      path: string;
    }>(
      Type.Object({
        sessionId: Type.String({ minLength: 1 }),
        analysisId: Type.String({ minLength: 1 }),
        path: Type.String({ minLength: 1 }),
      }),
      payload,
    );
    const failure = await shell.openPath(
      await options.dataAnalysis.resolveOutput(
        input.sessionId,
        runtime.getSessionRuntimeRoot(input.sessionId),
        input.analysisId,
        input.path,
      ),
    );
    if (failure) throw new Error(failure);
  });
  ipcMain.handle(
    "wordless:analysis:reveal",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        analysisId: string;
        path: string;
      }>(
        Type.Object({
          sessionId: Type.String({ minLength: 1 }),
          analysisId: Type.String({ minLength: 1 }),
          path: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      shell.showItemInFolder(
        await options.dataAnalysis.resolveOutput(
          input.sessionId,
          runtime.getSessionRuntimeRoot(input.sessionId),
          input.analysisId,
          input.path,
        ),
      );
    },
  );
  ipcMain.handle(
    "wordless:session:artifact:diff",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; path: string }>(
        WorkspaceFileRequestSchema,
        payload,
      );
      return await runtime.getSessionArtifactDiff(input.sessionId, input.path);
    },
  );
  ipcMain.handle(
    "wordless:session:workspace:list",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; path: string }>(
        ListWorkspaceDirectorySchema,
        payload,
      );
      return await runtime.listSessionWorkspaceDirectory(
        input.sessionId,
        input.path,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:workspace:search",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; query: string }>(
        SessionWorkspaceReferenceSearchSchema,
        payload,
      );
      return await runtime.searchSessionWorkspace(input.sessionId, input.query);
    },
  );
  ipcMain.handle(
    "wordless:workspace:search",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ workspaceId: string; query: string }>(
        WorkspaceReferenceSearchSchema,
        payload,
      );
      return await runtime.searchWorkspace(input.workspaceId, input.query);
    },
  );
  ipcMain.handle(
    "wordless:session:workspace:read",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; path: string }>(
        WorkspaceFileRequestSchema,
        payload,
      );
      return await runtime.readSessionWorkspaceTextFile(
        input.sessionId,
        input.path,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:workspace:open",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; path: string }>(
        WorkspaceFileRequestSchema,
        payload,
      );
      const failure = await shell.openPath(
        await runtime.resolveSessionWorkspaceFile(input.sessionId, input.path),
      );
      if (failure) throw new Error(failure);
    },
  );
  ipcMain.handle(
    "wordless:session:workspace:reveal",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; path: string }>(
        WorkspaceFileRequestSchema,
        payload,
      );
      shell.showItemInFolder(
        await runtime.resolveSessionWorkspaceFile(input.sessionId, input.path),
      );
    },
  );
  ipcMain.handle(
    "wordless:session:workspace:save-as",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; path: string }>(
        WorkspaceFileRequestSchema,
        payload,
      );
      const source = await runtime.resolveSessionWorkspaceFile(
        input.sessionId,
        input.path,
      );
      const result = await dialog.showSaveDialog({
        defaultPath: path.basename(source),
      });
      if (!result.canceled && result.filePath)
        await copyFile(source, result.filePath);
    },
  );
  ipcMain.handle(
    "wordless:session:workspace:trash",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; path: string }>(
        WorkspaceDeleteSchema,
        payload,
      );
      const source = await runtime.resolveSessionWorkspaceEntry(
        input.sessionId,
        input.path,
      );
      await shell.trashItem(source);
      runtime.invalidateSessionWorkspaceSearch(input.sessionId);
    },
  );
  ipcMain.handle(
    "wordless:session:approval",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        approvalId: string;
        approved: boolean;
        feedback?: string;
      }>(ResolveOperationApprovalSchema, payload);
      await runtime.resolveOperationApproval(
        input.sessionId,
        input.approvalId,
        input.approved,
        input.feedback,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:approval-mode",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; mode: ToolApprovalMode }>(
        SetSessionToolApprovalModeSchema,
        payload,
      );
      await runtime.setSessionToolApprovalMode(input.sessionId, input.mode);
    },
  );
  ipcMain.handle(
    "wordless:session:user-request",
    async (_event, payload: unknown) => {
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
    },
  );
  ipcMain.handle(
    "wordless:session:cancel",
    async (_event, sessionId: unknown) =>
      await runtime.cancelSession(String(sessionId)),
  );
  ipcMain.handle("wordless:session:model", async (_event, payload: unknown) => {
    const input = parsePayload<{
      sessionId: string;
      model: { connectionId: string; modelId: string };
      thinkingLevel?: ThinkingLevel;
    }>(SetSessionModelSchema, payload);
    await runtime.setSessionModel(
      input.sessionId,
      input.model,
      input.thinkingLevel,
    );
  });
  ipcMain.handle(
    "wordless:session:thinking-level",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sessionId: string; level: ThinkingLevel }>(
        SetSessionThinkingLevelSchema,
        payload,
      );
      return await runtime.setSessionThinkingLevel(
        input.sessionId,
        input.level,
      );
    },
  );
  ipcMain.handle("wordless:session:access", (_event, payload: unknown) => {
    const input = parsePayload<{
      sessionId: string;
      accessLevel: SessionAccessLevel;
    }>(SetSessionAccessSchema, payload);
    return runtime.setSessionAccess(input.sessionId, input.accessLevel);
  });
  ipcMain.handle(
    "wordless:session:interaction-mode",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        interactionMode: "default" | "clarify" | "plan";
      }>(SetSessionInteractionModeSchema, payload);
      return await runtime.setSessionInteractionMode(
        input.sessionId,
        input.interactionMode,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:clarification-question",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        callId: string;
        value: string | boolean;
      }>(ResolveClarificationQuestionSchema, payload);
      return await runtime.resolveClarificationQuestion(
        input.sessionId,
        input.callId,
        input.value,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:clarification-handoff",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        interactionMode: "default" | "clarify" | "plan";
      }>(HandoffClarificationSchema, payload);
      await runtime.handoffClarification(
        input.sessionId,
        input.interactionMode,
      );
    },
  );
  ipcMain.handle("wordless:preferences", (_event, payload: unknown) => {
    const input = parsePayload<{ key: string; value: unknown }>(
      SetPreferenceSchema,
      payload,
    );
    if (input.key !== "app" || !isAppPreferences(input.value))
      throw new Error("Invalid preferences payload");
    runtime.setPreferences(input.value);
    options.cloudSync.markDirty();
    updateTitleBarOverlays(input.value);
  });
  ipcMain.handle(
    "wordless:appearance:import",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sourcePath: string }>(
        ImportAppearanceBackgroundSchema,
        payload,
      );
      return await appearanceAssets.import(input.sourcePath);
    },
  );
  ipcMain.handle(
    "wordless:appearance:remove",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ assetId: string }>(
        RemoveAppearanceBackgroundSchema,
        payload,
      );
      const active =
        runtime.getSnapshot().preferences.appearance.background.source;
      if (active.kind === "custom" && active.assetId === input.assetId)
        throw new Error("Choose another background before removing this asset");
      await appearanceAssets.remove(input.assetId);
    },
  );
  ipcMain.handle(
    "wordless:model-config:snapshot",
    () => runtime.getSnapshot().modelConfiguration,
  );
  ipcMain.handle(
    "wordless:skills:refresh",
    async () => await runtime.refreshSkills(),
  );
  ipcMain.handle("wordless:skills:import", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "Skill package", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    await runtime.importSkill(result.filePaths[0]);
    return true;
  });
  ipcMain.handle(
    "wordless:skills:import-file",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ sourcePath: string }>(
        ImportSkillFileSchema,
        payload,
      );
      await runtime.importSkill(input.sourcePath);
    },
  );
  ipcMain.handle(
    "wordless:skills:enabled",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ skillId: string; enabled: boolean }>(
        SetSkillEnabledSchema,
        payload,
      );
      await runtime.setSkillEnabled(input.skillId, input.enabled);
    },
  );
  ipcMain.handle("wordless:skills:remove", async (_event, payload: unknown) => {
    const input = parsePayload<{ skillId: string }>(
      RemoveManagedSkillSchema,
      payload,
    );
    await runtime.removeManagedSkill(input.skillId);
  });
  ipcMain.handle("wordless:marketplace:mcp-search", async (_event, payload: unknown) => {
    const input = parsePayload<{ query?: string; cursor?: string; refresh?: boolean }>(Type.Object({
      query: Type.Optional(Type.String({ maxLength: 200 })),
      cursor: Type.Optional(Type.String({ maxLength: 500 })),
      refresh: Type.Optional(Type.Boolean()),
    }), payload);
    return await options.mcpMarketplace.search(input.query, input.cursor, input.refresh === true);
  });
  ipcMain.handle("wordless:marketplace:mcp-detail", async (_event, payload: unknown) => {
    const input = parsePayload<{ name: string }>(Type.Object({ name: Type.String({ minLength: 1, maxLength: 240 }) }), payload);
    return await options.mcpMarketplace.getDetail(input.name);
  });
  ipcMain.handle("wordless:marketplace:mcp-install", async (_event, payload: unknown) => {
    const input = parsePayload<{ name: string }>(Type.Object({ name: Type.String({ minLength: 1, maxLength: 240 }) }), payload);
    const entry = await options.mcpMarketplace.getDetail(input.name);
    if (!entry.installable || entry.transport !== "streamable-http" || !entry.url)
      throw new Error("This MCP server requires local package setup and cannot be installed yet.");
    const installed = runtime.getSnapshot().connectors.connectors.find((connector) => connector.marketplace?.registryName === entry.name);
    if (installed) {
      if (installed.marketplace?.version === entry.version) return installed;
      const configuration = runtime.getConnectorConfiguration(installed.id);
      if (!configuration) throw new Error("Installed MCP connector configuration was not found");
      return await runtime.saveConnector({
        ...configuration,
        name: entry.title,
        url: entry.url,
        marketplace: {
          source: entry.source,
          registryName: entry.name,
          version: entry.version,
          sourceUrl: entry.sourceUrl,
        },
      });
    }
    return await runtime.saveConnector({
      name: entry.title,
      templateId: null,
      transport: "streamable-http",
      enabled: false,
      trustedAt: null,
      command: null,
      args: [],
      cwd: null,
      environment: {},
      url: entry.url,
      headers: [],
      oauth: null,
      marketplace: {
        source: entry.source,
        registryName: entry.name,
        version: entry.version,
        sourceUrl: entry.sourceUrl,
      },
    });
  });
  ipcMain.handle("wordless:marketplace:skill-search", async (_event, payload: unknown) => {
    const input = parsePayload<{ query: string; page?: number; sortBy?: "stars" | "recent"; refresh?: boolean }>(Type.Object({
      query: Type.String({ minLength: 1, maxLength: 200 }),
      page: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      sortBy: Type.Optional(Type.Union([Type.Literal("stars"), Type.Literal("recent")])),
      refresh: Type.Optional(Type.Boolean()),
    }), payload);
    return await options.skillMarketplace.search(input.query, input.page, input.sortBy, input.refresh === true);
  });
  ipcMain.handle("wordless:marketplace:skill-preview", async (_event, payload: unknown) => {
    const input = parsePayload<{ skillId: string }>(Type.Object({ skillId: Type.String({ minLength: 1, maxLength: 300 }) }), payload);
    return await options.skillMarketplace.preview(input.skillId);
  });
  ipcMain.handle("wordless:marketplace:skill-install", async (_event, payload: unknown) => {
    const input = parsePayload<{ previewId: string }>(Type.Object({ previewId: Type.String({ minLength: 36, maxLength: 36 }) }), payload);
    return await options.skillMarketplace.install(input.previewId, async (directory) => await runtime.importSkill(directory));
  });
  ipcMain.handle(
    "wordless:connectors:save",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        configuration: Parameters<WordlessRuntime["saveConnector"]>[0];
      }>(Type.Object({ configuration: ConnectorConfigurationSchema }), payload);
      return await runtime.saveConnector(input.configuration);
    },
  );
  ipcMain.handle(
    "wordless:connectors:test",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string }>(
        ConnectorIdSchema,
        payload,
      );
      await runtime.testConnector(input.connectorId);
    },
  );
  ipcMain.handle(
    "wordless:connectors:authorize",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string }>(
        ConnectorIdSchema,
        payload,
      );
      return await runtime.authorizeConnector(input.connectorId, {
        openExternal: async (url) => {
          await shell.openExternal(url);
        },
        showDeviceCode: async ({ verificationUri, userCode }) => {
          await showDeviceCodeDialog({ verificationUri, userCode, providerLabel: "GitHub" });
        },
      });
    },
  );
  ipcMain.handle(
    "wordless:connectors:trust",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string }>(
        ConnectorIdSchema,
        payload,
      );
      await runtime.trustConnector(input.connectorId);
    },
  );
  ipcMain.handle(
    "wordless:connectors:enabled",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string; enabled: boolean }>(
        SetConnectorEnabledSchema,
        payload,
      );
      await runtime.setConnectorEnabled(input.connectorId, input.enabled);
    },
  );
  ipcMain.handle(
    "wordless:connectors:remove",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string }>(
        ConnectorIdSchema,
        payload,
      );
      await runtime.removeConnector(input.connectorId);
    },
  );
  ipcMain.handle("wordless:session:connectors", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string; connectorIds: string[] }>(
      SetSessionConnectorsSchema,
      payload,
    );
    return runtime.setSessionConnectors(input.sessionId, input.connectorIds);
  });
  ipcMain.handle("wordless:session:expert", (_event, payload: unknown) => {
    const input = parsePayload<{
      sessionId: string;
      selection: import("@wordless/domain").ExpertSelection | null;
    }>(SetSessionExpertSchema, payload);
    return runtime.setSessionExpert(input.sessionId, input.selection);
  });
  ipcMain.handle(
    "wordless:connectors:resources",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string }>(
        ConnectorIdSchema,
        payload,
      );
      return await runtime.listConnectorResources(input.connectorId);
    },
  );
  ipcMain.handle(
    "wordless:connectors:resource",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string; uri: string }>(
        Type.Object({
          connectorId: Type.String({ minLength: 1 }),
          uri: Type.String({ minLength: 1 }),
        }),
        payload,
      );
      return await runtime.readConnectorResource(input.connectorId, input.uri);
    },
  );
  ipcMain.handle(
    "wordless:connectors:prompts",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ connectorId: string }>(
        ConnectorIdSchema,
        payload,
      );
      return await runtime.listConnectorPrompts(input.connectorId);
    },
  );
  ipcMain.handle(
    "wordless:connectors:prompt",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        connectorId: string;
        name: string;
        arguments: Record<string, string>;
      }>(ConnectorPromptSchema, payload);
      return await runtime.getConnectorPrompt(
        input.connectorId,
        input.name,
        input.arguments,
      );
    },
  );
  ipcMain.handle(
    "wordless:model-config:save-provider",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        kind: "chat" | "image";
        providerId: string;
        configuration: Record<string, unknown>;
        enabledModelIds?: string[];
      }>(SaveProviderConfigurationSchema, payload);
      await runtime.saveProviderConfiguration(
        input.kind,
        input.providerId,
        input.configuration,
        input.enabledModelIds,
      );
      options.cloudSync.markDirty();
    },
  );
  ipcMain.handle(
    "wordless:model-config:discover-models",
    async (_event, payload: unknown) => {
      const input = parsePayload<
        import("@wordless/domain").ProviderModelDiscoveryRequest
      >(DiscoverProviderModelsSchema, payload);
      return await runtime.discoverProviderModels(input);
    },
  );
  ipcMain.handle(
    "wordless:model-config:set-enabled",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        kind: "chat" | "image";
        providerId: string;
        modelId: string;
        enabled: boolean;
      }>(SetConfiguredModelEnabledSchema, payload);
      await runtime.setConfiguredModelEnabled(
        input.kind,
        input.providerId,
        input.modelId,
        input.enabled,
      );
      options.cloudSync.markDirty();
    },
  );
  ipcMain.handle(
    "wordless:model-config:delete-custom-provider",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        kind: "chat" | "image";
        providerId: string;
      }>(DeleteCustomProviderSchema, payload);
      await runtime.deleteCustomProvider(input.kind, input.providerId);
      options.cloudSync.markDirty();
    },
  );
  ipcMain.handle(
    "wordless:model-config:oauth",
    async (_event, providerId: unknown) => {
      await runtime.loginProviderOAuth(String(providerId), {
        prompt: async (prompt: {
          type: string;
          message: string;
          options?: Array<{ id: string; label: string }>;
        }) => {
          if (prompt.type === "select" && prompt.options) {
            const result = await dialog.showMessageBox({
              message: prompt.message,
              buttons: prompt.options.map((option) => option.label),
              cancelId: -1,
            });
            const selection = prompt.options[result.response];
            if (!selection) throw new Error("OAuth login cancelled");
            return selection.id;
          }
          throw new Error(
            `OAuth prompt type ${prompt.type} is not supported by the desktop host.`,
          );
        },
        notify: async (event: {
          type: string;
          url?: string;
          verificationUri?: string;
          userCode?: string;
          instructions?: string;
        }) => {
          if (event.type === "auth_url" && event.url) {
            await shell.openExternal(event.url);
            await dialog.showMessageBox({
              message:
                event.instructions ??
                "Complete sign-in in your browser, then return to Wordless.",
            });
          }
          if (
            event.type === "device_code" &&
            event.verificationUri &&
            event.userCode
          ) {
            await showDeviceCodeDialog({
              verificationUri: event.verificationUri,
              userCode: event.userCode,
              providerLabel: "Wordless",
            });
          }
        },
      });
    },
  );
  ipcMain.handle("wordless:extensions:snapshot", () =>
    runtime.getExtensionSnapshot(),
  );
  ipcMain.handle(
    "wordless:extensions:enabled",
    async (_event, payload: unknown) => {
      const input = parsePayload<{ extensionId: string; enabled: boolean }>(
        SetExtensionEnabledSchema,
        payload,
      );
      return await runtime.setExtensionEnabled(
        input.extensionId,
        input.enabled,
      );
    },
  );
  ipcMain.handle(
    "wordless:extensions:settings",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        extensionId: string;
        settings: Record<string, unknown>;
      }>(UpdateExtensionSettingsSchema, payload);
      return await runtime.updateExtensionSettings(
        input.extensionId,
        input.settings,
      );
    },
  );
  ipcMain.handle(
    "wordless:session:extension-interact",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        extensionId: string;
        action: string;
        payload?: unknown;
      }>(SessionExtensionInteractionSchema, payload);
      await runtime.interactWithSessionExtension(input.sessionId, {
        extensionId: input.extensionId,
        action: input.action,
        payload: input.payload,
      });
    },
  );
  ipcMain.handle(
    "wordless:session:extension-state",
    async (_event, payload: unknown) => {
      const input = parsePayload<{
        sessionId: string;
        extensionId: string;
        state: Record<string, unknown>;
      }>(SetSessionExtensionStateSchema, payload);
      await runtime.setSessionExtensionState(
        input.sessionId,
        input.extensionId,
        input.state,
      );
    },
  );
}
