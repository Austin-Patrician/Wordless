import path from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeTheme } from "electron";
import { createDesktopRuntime } from "./bootstrap/create-runtime";
import { prepareUserDataPath } from "./bootstrap/user-data";
import { registerRuntimeIpc } from "./ipc/register-runtime-ipc";
import { DesktopNotificationService } from "./notifications/desktop-notification-service";
import { AppearanceAssetService } from "./appearance/appearance-asset-service";
import { registerAppearanceProtocol } from "./protocols/appearance";
import { registerMediaProtocol } from "./protocols/media";
import { createMainWindow, updateTitleBarOverlays } from "./windows/main-window";

app.setName("Wordless");
app.setAppUserModelId("com.wordless.desktop");
const userData = prepareUserDataPath();
app.setPath("userData", userData.path);

let runtime: ReturnType<typeof createDesktopRuntime> | undefined;

app.whenReady().then(async () => {
  const appearanceAssets = new AppearanceAssetService(path.join(userData.path, "appearance", "backgrounds"));
  registerAppearanceProtocol(path.join(userData.path, "appearance", "backgrounds"));
  registerMediaProtocol(path.join(userData.path, "media-assets"));
  runtime = createDesktopRuntime(userData.path);
  await runtime.initialize();
  const notifications = new DesktopNotificationService();
  runtime.subscribe((event) => {
    notifications.handle(event, runtime!.getSnapshot().preferences);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("wordless:event", event);
  });
  Menu.setApplicationMenu(null);
  nativeTheme.on("updated", () => {
    const preferences = runtime?.getSnapshot().preferences;
    if (preferences) updateTitleBarOverlays(preferences);
  });
  registerRuntimeIpc(runtime, appearanceAssets);
  createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
  if (userData.notice) await dialog.showMessageBox({ type: "warning", message: userData.notice });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && runtime) {
      createMainWindow(path.join(__dirname, "preload.cjs"), runtime.getSnapshot().preferences);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => runtime?.dispose());
