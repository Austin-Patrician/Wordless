import path from "node:path";
import { BrowserWindow, nativeTheme } from "electron";
import type { AppPreferences } from "@wordless/domain";

function titleBarOverlay(preferences: AppPreferences) {
  const dark = preferences.theme === "dark" || (preferences.theme === "system" && nativeTheme.shouldUseDarkColors);
  const hasBackground = preferences.appearance.background.source.kind !== "none";
  return {
    color: dark ? (hasBackground ? "#202219e6" : "#202219") : (hasBackground ? "#f6f6f5e6" : "#f6f6f5"),
    symbolColor: dark ? "#f2f2ec" : "#30302e",
    height: 29,
  };
}

export function updateTitleBarOverlays(preferences: AppPreferences): void {
  for (const window of BrowserWindow.getAllWindows()) window.setTitleBarOverlay(titleBarOverlay(preferences));
}

export function createMainWindow(preloadPath: string, preferences: AppPreferences): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1040,
    minHeight: 640,
    backgroundColor: "#111111",
    icon: path.join(__dirname, "wordless.png"),
    frame: false,
    title: "Wordless",
    titleBarOverlay: titleBarOverlay(preferences),
    titleBarStyle: "hidden",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  if (process.env.WORDLESS_RENDERER_URL) {
    void mainWindow.loadURL(process.env.WORDLESS_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
