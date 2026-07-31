import path from "node:path";
import { BrowserWindow, nativeTheme } from "electron";
import type { AppPreferences } from "@wordless/domain";
import { createDesktopHostInfo, mainWindowOptions, titleBarOverlay } from "../platform/desktop-platform";

function isDark(preferences: AppPreferences): boolean {
  return preferences.theme === "dark" || (preferences.theme === "system" && nativeTheme.shouldUseDarkColors);
}

export function updateTitleBarOverlays(preferences: AppPreferences): void {
  const host = createDesktopHostInfo();
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(isDark(preferences) ? "#151610" : "#fbfbfa");
    if (!host.capabilities.titleBarOverlay || typeof window.setTitleBarOverlay !== "function") continue;
    window.setTitleBarOverlay(titleBarOverlay(preferences, isDark(preferences)));
  }
}

export function createMainWindow(preloadPath: string, preferences: AppPreferences): BrowserWindow {
  const host = createDesktopHostInfo();
  const mainWindow = new BrowserWindow({ ...mainWindowOptions(preloadPath, preferences, isDark(preferences), host), icon: path.join(__dirname, "wordless.png") });
  if (host.menuPresentation === "in-window") mainWindow.setMenuBarVisibility(false);

  if (process.env.WORDLESS_RENDERER_URL) {
    void mainWindow.loadURL(process.env.WORDLESS_RENDERER_URL).catch((error) => console.error("Failed to load the Wordless development renderer", error));
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html")).catch((error) => console.error("Failed to load the packaged Wordless renderer", error));
  }
  return mainWindow;
}
