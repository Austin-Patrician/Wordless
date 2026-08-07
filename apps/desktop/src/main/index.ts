import path from "node:path";
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from "electron";
import { createDesktopRuntime } from "./bootstrap/create-runtime";
import { prepareUserDataPath } from "./bootstrap/user-data";
import { registerRuntimeIpc } from "./ipc/register-runtime-ipc";
import { DesktopNotificationService } from "./notifications/desktop-notification-service";
import { AppearanceAssetService } from "./appearance/appearance-asset-service";
import { registerAppearanceProtocol } from "./protocols/appearance";
import { registerMediaProtocol } from "./protocols/media";
import { registerPresentationProtocol } from "./protocols/presentation";
import { registerAnalysisProtocol } from "./protocols/analysis";
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

declare const __WORDLESS_GOOGLE_CLIENT_ID__: string;
declare const __WORDLESS_GOOGLE_CLIENT_SECRET__: string;

app.setName("Wordless");
app.setAppUserModelId("com.wordless.desktop");
const userData = prepareUserDataPath();
app.setPath("userData", userData.path);

let runtime: ReturnType<typeof createDesktopRuntime> | undefined;
let office: OfficeCliService | undefined;
let account: GoogleAccountService | undefined;
let cloudSync: CloudSyncService | undefined;
let disposing = false;
const hostInfo = createDesktopHostInfo();
let mainWindow: BrowserWindow | undefined;
const hasSingleInstance = app.requestSingleInstanceLock();

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
  const officeResourcesPath = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources");
  office = new OfficeCliService({ artifactsRoot: presentationArtifactsRoot, resourcesPath: officeResourcesPath });
  const credentialVault = new ElectronCredentialVault(path.join(userData.path, "credentials.json"));
  const accountNetworkSession = session.fromPartition("wordless-account-network");
  const accountProxy = process.env.HTTPS_PROXY?.trim()
    || process.env.https_proxy?.trim()
    || process.env.ALL_PROXY?.trim()
    || process.env.all_proxy?.trim();
  await accountNetworkSession.setProxy(accountProxy
    ? { mode: "fixed_servers", proxyRules: accountProxy }
    : { mode: "system" });
  await configureHttpDispatcher(accountNetworkSession);
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
  runtime = createDesktopRuntime(userData.path, office, credentialVault, dataAnalysis);
  await runtime.initialize();
  cloudSync = new CloudSyncService({
    statePath: path.join(userData.path, "cloud-sync", "state.json"),
    runtime,
    account,
    drive: new GoogleDriveAppData(account, async (input, init) => await accountNetworkSession.fetch(input, init)),
    send: sendHostEvent,
  });
  await cloudSync.initialize();
  const notifications = new DesktopNotificationService();
  runtime.subscribe((event) => {
    notifications.handle(event, runtime!.getSnapshot().preferences);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:event", event);
  });
  const applicationMenu = new ApplicationMenuController(hostInfo);
  applicationMenu.install();
  const updateService = new DesktopUpdateService(sendHostEvent);
  updateService.initialize();
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
  });
  mainWindow = createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
  mainWindow.on("focus", () => notifications.clearBadge());
  setTimeout(() => void updateService.check(), 12_000);
  if (userData.notice) await dialog.showMessageBox({ type: "warning", message: userData.notice });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && runtime) {
      mainWindow = createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
      mainWindow.on("focus", () => notifications.clearBadge());
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (disposing) return;
  event.preventDefault();
  disposing = true;
  cloudSync?.dispose();
  runtime?.dispose();
  account?.dispose();
  void (office?.dispose() ?? Promise.resolve()).finally(() => app.quit());
});
