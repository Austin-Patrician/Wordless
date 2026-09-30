import path from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, session, shell, Tray } from "electron";
import type { AppPreferences } from "@wordless/domain";
import { createDesktopRuntime } from "./bootstrap/create-runtime";
import { prepareUserDataPath } from "./bootstrap/user-data";
import { registerRuntimeIpc } from "./ipc/register-runtime-ipc";
import { registerBrowserIpc } from "./ipc/register-browser-ipc";
import { WebContentsViewHost } from "./browser/browser-host";
import { BrowserService } from "./browser/browser-service";
import { DesktopNotificationService } from "./notifications/desktop-notification-service";
import { createDesktopNotificationHost } from "./notifications/desktop-notification-host";
import { registerDesktopNotificationIpc } from "./ipc/register-desktop-notification-ipc";
import { DesktopTranslationService } from "./translation/translation-service";
import { AppearanceAssetService } from "./appearance/appearance-asset-service";
import { registerAppearanceProtocol } from "./protocols/appearance";
import { registerMediaProtocol } from "./protocols/media";
import { registerPresentationProtocol } from "./protocols/presentation";
import { registerAnalysisProtocol } from "./protocols/analysis";
import { registerAttachmentProtocol } from "./protocols/attachment";
import { registerDesignProtocol, registerDesignScheme } from "./protocols/design";
import { createDesignHandlers } from "./design/handlers";
import { NodeDesignExporter } from "./design/design-exporter";
import { ElectronDesignClipboard } from "./design/design-clipboard";
import { RasterPool } from "./design/raster-pool";
import { ElectronOffscreenRaster } from "./design/electron-offscreen-raster";
import { WebContentsViewDesignHost } from "./design/design-view-host";
import { DESIGN_RASTER_BUDGETS } from "./design/raster-budgets";
import { registerDesignIpc } from "./ipc/register-design-ipc";
import { DesignStore } from "./design/design-store";
import { designBuildRecipes } from "./design/build-recipes";
import { NodeBuildRunner } from "./design/node-build-runner";
import { NodeDesignFs } from "./design/design-fs";
import { WorkspacePathService } from "@wordless/platform-node";
import { OnboardingService } from "./onboarding/onboarding-service";
import { createMainWindow, updateTitleBarOverlays } from "./windows/main-window";
import { createDesktopHostInfo } from "./platform/desktop-platform";
import { ApplicationMenuController } from "./menu/application-menu";
import { hydrateShellEnvironment } from "./environment/shell-environment";
import { DesktopUpdateService } from "./update/update-service";
import { OfficeCliService } from "./office/office-cli-service";
import { ElectronCredentialVault } from "./adapters/electron-credential-vault";
import { GoogleAccountService } from "./account/google-account-service";
import { CloudSyncService } from "./cloud-sync/cloud-sync-service";
import { GoogleDriveAppData } from "./cloud-sync/google-drive-app-data";
import { DesktopDataAnalysisService } from "./data-analysis/data-analysis-service";
import { configureHttpDispatcher } from "./network/http-dispatcher";
import { applyDesktopProxy, proxyRulesFromEnvironment } from "./proxy/proxy-runtime";
import { DesktopProxyStore } from "./proxy/proxy-store";
import { registerProxyIpc } from "./ipc/register-proxy-ipc";
import { registerNotificationDefaultsIpc, registerNotificationIpc } from "./ipc/register-notification-ipc";
import { WebhookManager } from "./notifications/webhook/manager";
import { getProvider, isSupportedKind } from "./notifications/webhook/providers/registry.ts";
import {
  defaultNotificationDefaultsPath,
  loadNotificationDefaults,
  saveNotificationDefaults,
} from "./notifications/settings-store.ts";
import { NotificationBus } from "./notifications/bus.ts";
import { lastAssistantText } from "./notifications/reply.ts";
import { AutomationService } from "./automation/automation-service";

import { McpRegistryService } from "./marketplace/mcp-registry-service";
import { SkillsMpMarketplaceService } from "./marketplace/skillsmp-marketplace-service";

declare const __WORDLESS_GOOGLE_CLIENT_ID__: string;
declare const __WORDLESS_GOOGLE_CLIENT_SECRET__: string;
declare const __WORDLESS_SKILLSMP_API_KEY__: string;

app.setName("Wordless");
/**
 * The taskbar identity. Windows groups taskbar buttons and resolves their icon
 * through the AppUserModelID, so a dev run must not claim the shipped app's id:
 * while it did, running `npm run dev:electron` gave the packaged app's button the
 * dev binary's icon (the Electron default), and the two builds collided on one
 * taskbar entry. Packaged builds keep the id the NSIS shortcut registers.
 */
app.setAppUserModelId(app.isPackaged ? "com.wordless.desktop" : "com.wordless.desktop.dev");
const userData = prepareUserDataPath();
app.setPath("userData", userData.path);

let runtime: ReturnType<typeof createDesktopRuntime> | undefined;
let office: OfficeCliService | undefined;
/** 设计包读写。协议与 IPC 都经它拿注册表,所以必须是同一个实例。 */
let designStore: DesignStore | undefined;
/** 光栅化池。离屏窗口是真实渲染进程,退出时要一起关掉。 */
let designRaster: ElectronOffscreenRaster | undefined;
/** 活体视图宿主。至多一个,所以只需要一个实例。 */
let designViewHost: WebContentsViewDesignHost | undefined;
let account: GoogleAccountService | undefined;
let cloudSync: CloudSyncService | undefined;
let automation: AutomationService | undefined;
let translation: DesktopTranslationService | undefined;
let tray: Tray | undefined;
let disposing = false;
let quitting = false;
let browser: BrowserService | undefined;
let notifications: DesktopNotificationService | undefined;
let notificationBus: NotificationBus | undefined;
const hostInfo = createDesktopHostInfo();
let mainWindow: BrowserWindow | undefined;
const hasSingleInstance = app.requestSingleInstanceLock();

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function createTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, process.platform === "win32" ? "wordless.ico" : "wordless.png");
  if (process.platform !== "darwin") return nativeImage.createFromPath(iconPath);
  // Keep the 1024px source out of AppKit's status-item cache. A status item
  // only needs a small bitmap, especially on Retina where Electron supplies
  // the backing scale factor itself.
  return nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32, quality: "best" });
}

function updateTrayMenu(preferences: AppPreferences): void {
  if (!tray) return;
  const chinese = preferences.locale === "zh-CN";
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: chinese ? "打开 Wordless" : "Open Wordless", click: showWindow },
      { type: "separator" },
      {
        label: chinese ? "退出 Wordless" : "Quit Wordless",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// 必须在 `app.whenReady()` 之前:设计帧要解析相对 URL(`../theme.css`),
// 那要求这个 scheme 被登记成标准 scheme。见 protocols/design.ts 的说明。
registerDesignScheme();

if (!hasSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:host-event", { type: "deep-link", url });
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstance) return;
  await hydrateShellEnvironment(hostInfo);
  const appearanceAssets = new AppearanceAssetService(path.join(userData.path, "appearance", "backgrounds"));
  registerAppearanceProtocol(path.join(userData.path, "appearance", "backgrounds"));
  registerMediaProtocol(path.join(userData.path, "media-assets"));
  const presentationArtifactsRoot = path.join(userData.path, "presentation-artifacts");
  registerPresentationProtocol(presentationArtifactsRoot);
  const dataAnalysis = new DesktopDataAnalysisService({ metadataRoot: path.join(userData.path, "analysis-metadata"), resourcesRoot: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources") });
  registerAnalysisProtocol(dataAnalysis);
  // 设计画布的协议。设计包路径**不进 URL**,只进注册表 —— 于是"从 URL 构造一个逃出
  // 设计包的路径"在结构上不可能(见 design-url.ts)。
  const designPaths = new WorkspacePathService();
  designStore = new DesignStore({ fs: new NodeDesignFs() });
  registerDesignProtocol({
    registry: designStore.registry,
    isWithinRoot: (root, candidate) => designPaths.isWithinRoot(root, candidate),
  });
  // 离屏光栅化:窗口数跟池的并发数走 —— 两者不一致时池会等空闲窗口,不会出错但会变慢。
  designRaster = new ElectronOffscreenRaster({
    maxWindows: DESIGN_RASTER_BUDGETS.rasterConcurrency,
    // 空闲即销毁:两个离屏窗口各约 128MB,留着到退出等于每次用过画布就永久多付 264MB。
    idleMs: DESIGN_RASTER_BUDGETS.rasterIdleMs,
  });
  const rasterPool = new RasterPool({
    port: designRaster,
    concurrency: DESIGN_RASTER_BUDGETS.rasterConcurrency,
    timeoutMs: DESIGN_RASTER_BUDGETS.rasterTimeoutMs,
  });
  designViewHost = new WebContentsViewDesignHost(() => mainWindow);
  /**
   * 构建能力。**同一个对象同时给画廊的 IPC 与 agent 那条路。**
   *
   * 两边都要在建包与刷新时构建,各造一份的后果不是"多一个对象",而是"能不能构建"取决于
   * 用户走的是哪条路 —— 而 agent 那条路从前根本没有构建,那是设计帧没有样式的直接原因。
   */
  const designBuilds = {
    runner: new NodeBuildRunner(),
    // 脚本与主进程产物同目录(两者都由 `scripts/build-electron.mjs` 产出)。
    recipes: designBuildRecipes({ scriptPath: path.join(__dirname, "design-build.mjs") }),
  };
  /**
   * 导出用的宿主能力。
   *
   * 目录对话框要挂在窗口上(未挂载时 macOS 上会弹不出来),而窗口是**这个文件**才有的 ——
   * 所以 `handlers.ts` 拿到的是注入的端口,它自己不 import Electron。
   */
  const designExporter = new NodeDesignExporter(
    async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ["openDirectory", "createDirectory"],
        title: "导出到哪个文件夹",
      });
      return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
    },
    async (input) => {
      // 保存对话框同样要挂在窗口上,否则 macOS 上弹不出来。
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: input.suggestedName,
        filters:
          input.extension === "pdf"
            ? [{ name: "PDF", extensions: ["pdf"] }]
            : [{ name: "PNG", extensions: ["png"] }],
      });
      return result.canceled || result.filePath === undefined || result.filePath === "" ? null : result.filePath;
    },
  );
  registerDesignIpc({
    handlers: createDesignHandlers(
      designStore,
      rasterPool,
      designViewHost,
      designBuilds,
      designExporter,
      new ElectronDesignClipboard(),
    ),
  });
  const officeResourcesPath = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources");
  office = new OfficeCliService({ artifactsRoot: presentationArtifactsRoot, resourcesPath: officeResourcesPath });
  const credentialVault = new ElectronCredentialVault(path.join(userData.path, "credentials.json"));
  const accountNetworkSession = session.fromPartition("wordless-account-network");
  // Chromium networking ignores the proxy environment variables, so each session
  // the app browses through is told explicitly. The two browser partitions are
  // included so the embedded panel follows the same proxy as the rest of the app.
  const proxySessions = [
    session.defaultSession,
    accountNetworkSession,
    session.fromPartition("wordless-browser"),
    session.fromPartition("persist:wordless-browser"),
  ];
  const proxyStore = new DesktopProxyStore(userData.path, credentialVault);
  // Shared by the startup apply and every later save, so a change goes through
  // exactly the same path as the initial value.
  const proxyDeps = {
    configureSessions: async (proxyRules: string | undefined) => {
      // With no application proxy the inherited environment still decides: that
      // is where a user's own HTTPS_PROXY and the system-resolved proxy land.
      const rules = proxyRules ?? proxyRulesFromEnvironment();
      const mode = rules
        ? { mode: "fixed_servers" as const, proxyRules: rules }
        : { mode: "system" as const };
      for (const target of proxySessions) await target.setProxy(mode);
    },
    // Rebuilt on every change, because `EnvHttpProxyAgent` reads the environment
    // when it is constructed rather than per request.
    configureDispatcher: async () => {
      await configureHttpDispatcher(accountNetworkSession);
    },
  };
  // Applied before the runtime is built so agent commands inherit the proxy from
  // their very first invocation.
  const proxyActive = await applyDesktopProxy(await proxyStore.read(), proxyDeps);
  const sendHostEvent = (event: import("@wordless/protocol").DesktopHostEvent) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:host-event", event);
  };
  account = new GoogleAccountService({
    clientId: process.env.WORDLESS_GOOGLE_CLIENT_ID?.trim() || __WORDLESS_GOOGLE_CLIENT_ID__,
    clientSecret: process.env.WORDLESS_GOOGLE_CLIENT_SECRET?.trim() || __WORDLESS_GOOGLE_CLIENT_SECRET__,
    credentialVault,
    profilePath: path.join(userData.path, "account", "google-profile.json"),
    send: sendHostEvent,
    fetch: async (input, init) => await accountNetworkSession.fetch(input, init),
    openExternal: async (url) => await shell.openExternal(url),
  });
  await account.initialize();
  // Constructed before the runtime so the agent driver can be handed the read-only
  // browser tools. Both the window and its content view are resolved lazily, so
  // building this before the window exists is safe.
  browser = new BrowserService({
    host: new WebContentsViewHost(() => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined)),
    onChange: (state) => {
      // The toolbar needs to follow navigations the page starts itself (a link
      // click, a redirect), not just the ones the user typed.
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("wordless:browser:state", state);
    },
  });
  runtime = createDesktopRuntime(
    userData.path,
    office,
    credentialVault,
    dataAnalysis,
    browser,
    // 设计工具与画布共用同一个 store 与离屏视图:注册表是共用状态,分开会各自持有半份。
    designRaster === undefined || designViewHost === undefined || designStore === undefined
      ? undefined
      : { store: designStore, raster: designRaster, evaluator: designRaster, builds: designBuilds },
  );
  await runtime.initialize();
  registerAttachmentProtocol(async (sessionId, previewPath) => await runtime!.resolveSessionAttachmentPreview(sessionId, previewPath));
  // Built before the automation service because that service is handed a way to
  // report finished runs. The bus's own dependencies point back at `automation`,
  // which is fine: they are closures, resolved when a run finishes, not now.
  const webhookManager = new WebhookManager({ userDataPath: userData.path, secrets: credentialVault });
  await webhookManager.reload();
  const notificationDefaultsPath = defaultNotificationDefaultsPath(userData.path);
  const readDefaults = async () => await loadNotificationDefaults(notificationDefaultsPath);
  const saveDefaults = async (defaults: import("@wordless/protocol").NotificationDefaults) =>
    await saveNotificationDefaults(notificationDefaultsPath, defaults);

  notificationBus = new NotificationBus({
    locale: () => runtime!.getSnapshot().preferences.locale,
    readDefaults,
    readSubscription: async (sourceId) => automation?.listTasks().find((task) => task.id === sourceId)?.notification,
    // Only enabled channels, and only ones this build can actually send through.
    listTargets: () =>
      webhookManager
        .list()
        .filter((endpoint) => endpoint.enabled && isSupportedKind(endpoint.kind))
        .map((endpoint) => {
          const capabilities = getProvider(endpoint.kind).capabilities;
          return {
            id: endpoint.id,
            name: endpoint.name,
            // Both ceilings when the platform declares one: DingTalk counts
            // characters, the others count bytes (see §15.3.5).
            limits: {
              maxBytes: capabilities.maxTextBytes,
              ...(capabilities.maxTextChars === undefined ? {} : { maxChars: capabilities.maxTextChars }),
            },
            ...(capabilities.maxMessagesPerMinute === undefined
              ? {}
              : { maxMessagesPerMinute: capabilities.maxMessagesPerMinute }),
          };
        }),
    readReply: async (event) => {
      // Only reached when the template uses {{reply}}; see NotificationBus.
      if (!event.sessionId) return undefined;
      const snapshot = await runtime!.getSessionSnapshot(event.sessionId);
      return lastAssistantText(snapshot.messages);
    },
    send: async (targetId, message) => await webhookManager.send(targetId, message),
    onResult: (event, failure) => {
      // Only on failure, and off the completion path: the run is already recorded.
      if (!failure) return;
      const runId = event.eventId.slice(event.eventId.indexOf(":") + 1);
      automation?.recordNotificationFailure(runId, failure);
    },
  });

  automation = new AutomationService({
    databasePath: path.join(userData.path, "wordless.db"),
    runtime,
    deleteSession: async (sessionId) => await runtime!.deleteSession(sessionId, async (record) => await office!.releaseSession(record.id, record.runtimeRootPath)),
    emit: (event) => {
      const envelope: import("@wordless/protocol").RuntimeEventEnvelope = { protocolVersion: 1, runtimeInstanceId: "desktop-automation", eventId: crypto.randomUUID(), sessionId: null, sequence: Date.now(), timestamp: Date.now(), event };
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:event", envelope);
    },
    // Synchronous by contract: this runs on the run-completion path, where a webhook
    // waiting on its 30s timeout would delay the run appearing as finished.
    notify: (event) => notificationBus?.emit(event),
  });
  automation.initialize();
  cloudSync = new CloudSyncService({
    statePath: path.join(userData.path, "cloud-sync", "state.json"),
    runtime,
    account,
    drive: new GoogleDriveAppData(account, async (input, init) => await accountNetworkSession.fetch(input, init)),
    send: sendHostEvent,
  });
  await cloudSync.initialize();
  // Everything platform-specific is injected, so the service itself has no
  // Electron import and its rules are testable with fakes.
  notifications = new DesktopNotificationService(
    createDesktopNotificationHost({
      // Late-bound: the window is created further down.
      getWindow: () => mainWindow,
      sendHostEvent,
      sessionTitle: (sessionId) => runtime?.getSnapshot().sessions.find((session) => session.id === sessionId)?.title,
    }),
  );
  registerDesktopNotificationIpc({ notifications });
  // Built before the subscription below, which reads it on every preference change.
  const applicationMenu = new ApplicationMenuController(hostInfo, runtime.getSnapshot().preferences.shortcuts.bindings);
  applicationMenu.install();
  runtime.subscribe((event) => {
    notifications?.handle(event, runtime!.getSnapshot().preferences);
    if (event.event.type === "preferences.changed") {
      const preferences = runtime!.getSnapshot().preferences;
      updateTrayMenu(preferences);
      // The menu shows accelerators, so it has to follow a rebound key.
      applicationMenu.applyShortcutBindings(preferences.shortcuts.bindings);
    }
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:event", event);
  });
  const updateService = new DesktopUpdateService(sendHostEvent);
  updateService.initialize();
  translation = new DesktopTranslationService({
    getRuntime: () => runtime,
    send: sendHostEvent,
  });
  nativeTheme.on("updated", () => {
    const preferences = runtime?.getSnapshot().preferences;
    if (preferences) updateTitleBarOverlays(preferences);
  });
  registerRuntimeIpc(runtime, appearanceAssets, {
    hostInfo,
    getAppInfo: () => updateService.getAppInfo(),
    showApplicationMenu: (menuId, window) => applicationMenu.show(menuId, window),
    getUpdateSnapshot: () => updateService.getSnapshot(),
    listReleases: (refresh) => updateService.listReleases(refresh),
    checkForUpdates: () => updateService.check(),
    downloadUpdate: () => updateService.download(),
    installUpdate: () => updateService.install(),
    openReleasePage: (version) => updateService.openReleasePage(version),
    account,
    cloudSync,
    office,
    dataAnalysis,
    automation,
    mcpMarketplace: new McpRegistryService(userData.path),
    onboarding: new OnboardingService(userData.path),
    // The browser service is created above the runtime so its tools can be built
    // per session; handing it here lets session deletion drop that session's grants.
    ...(browser ? { browser } : {}),
    translation,
    skillMarketplace: new SkillsMpMarketplaceService(userData.path, {
      apiKey: process.env.WORDLESS_SKILLSMP_API_KEY?.trim() || __WORDLESS_SKILLSMP_API_KEY__,
    }),
  });
  mainWindow = createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
  mainWindow.on("close", (event) => { if (!quitting) { event.preventDefault(); mainWindow?.hide(); } });
  mainWindow.on("focus", () => notifications?.clearBadge());
  // The browser service needs the window, which is created after the runtime
  // IPC is registered, so it takes a late-bound accessor rather than the window
  // itself.
  registerBrowserIpc(browser);
  registerProxyIpc({ apply: async (config) => await applyDesktopProxy(config, proxyDeps), initialActive: proxyActive, store: proxyStore });
  // Message push. Constructed like the proxy store rather than as a singleton:
  // it owns no timers or sockets, so there is nothing to dispose, and a plain
  // local keeps the process-global surface unchanged.
  //
  // `reload` never throws — a corrupt file degrades to "nothing configured"
  // instead of blocking the window.
  registerNotificationIpc({ manager: webhookManager });
  registerNotificationDefaultsIpc({ readDefaults, saveDefaults });
  // macOS AppKit synchronously redraws NSStatusItem replicants when the app
  // becomes active or display metrics change. That redraw runs on the main
  // thread and is the source of the focus-return hitch, so the Dock remains
  // the macOS entry point and the tray is kept for Windows/Linux only.
  if (process.platform !== "darwin") {
    tray = new Tray(createTrayIcon());
    tray.setToolTip("Wordless");
    tray.on("click", showWindow);
    updateTrayMenu(runtime.getSnapshot().preferences);
  }
  setTimeout(() => void updateService.check(), 12_000);
  if (userData.notice) await dialog.showMessageBox({ type: "warning", message: userData.notice });

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else if (runtime) {
      mainWindow = createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
      mainWindow.on("close", (event) => { if (!quitting) { event.preventDefault(); mainWindow?.hide(); } });
      mainWindow.on("focus", () => notifications?.clearBadge());
    }
  });
});

app.on("window-all-closed", () => {
  // Automations continue while the main window is hidden in the tray.
});

app.on("before-quit", (event) => {
  if (disposing) return;
  event.preventDefault();
  disposing = true;
  quitting = true;
  notifications?.dispose();
  notificationBus?.dispose();
  browser?.dispose();
  automation?.dispose();
  translation?.dispose();
  tray?.destroy();
  cloudSync?.dispose();
  runtime?.dispose();
  account?.dispose();
  // 离屏窗口是真实渲染进程,不关掉会让进程残留。
  designRaster?.dispose();
  designViewHost?.dispose();
  void (office?.dispose() ?? Promise.resolve()).finally(() => app.quit());
});
