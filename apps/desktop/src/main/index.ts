import path from "node:path";
import { app, BrowserWindow, dialog, nativeTheme } from "electron";
import { createDesktopRuntime } from "./bootstrap/create-runtime";
import { prepareUserDataPath } from "./bootstrap/user-data";
import { registerRuntimeIpc } from "./ipc/register-runtime-ipc";
import { DesktopNotificationService } from "./notifications/desktop-notification-service";
import { AppearanceAssetService } from "./appearance/appearance-asset-service";
import { registerAppearanceProtocol } from "./protocols/appearance";
import { registerMediaProtocol } from "./protocols/media";
import { registerPresentationProtocol } from "./protocols/presentation";
import { createMainWindow, updateTitleBarOverlays } from "./windows/main-window";
import { createDesktopHostInfo } from "./platform/desktop-platform";
import { ApplicationMenuController } from "./menu/application-menu";
import { hydrateShellEnvironment } from "./environment/shell-environment";
import { DesktopUpdateService } from "./update/update-service";
import { OfficeCliService } from "./office/office-cli-service";

app.setName("Wordless");
app.setAppUserModelId("com.wordless.desktop");
const userData = prepareUserDataPath();
app.setPath("userData", userData.path);

let runtime: ReturnType<typeof createDesktopRuntime> | undefined;
let office: OfficeCliService | undefined;
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
  const officeResourcesPath = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../resources");
  office = new OfficeCliService({ artifactsRoot: presentationArtifactsRoot, resourcesPath: officeResourcesPath });
  runtime = createDesktopRuntime(userData.path, office);
  await runtime.initialize();
  const notifications = new DesktopNotificationService();
  runtime.subscribe((event) => {
    notifications.handle(event, runtime!.getSnapshot().preferences);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:event", event);
  });
  const applicationMenu = new ApplicationMenuController(hostInfo);
  applicationMenu.install();
  const updateService = new DesktopUpdateService((event) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:host-event", event);
  });
  updateService.initialize();
  nativeTheme.on("updated", () => {
    const preferences = runtime?.getSnapshot().preferences;
    if (preferences) updateTitleBarOverlays(preferences);
  });
  registerRuntimeIpc(runtime, appearanceAssets, {
    hostInfo,
    showApplicationMenu: (menuId, window) => applicationMenu.show(menuId, window),
    checkForUpdates: () => updateService.check(),
    downloadUpdate: () => updateService.download(),
    installUpdate: () => updateService.install(),
    office,
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
  runtime?.dispose();
  void (office?.dispose() ?? Promise.resolve()).finally(() => app.quit());
});
