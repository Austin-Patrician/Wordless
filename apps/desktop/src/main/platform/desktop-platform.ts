import process from "node:process";
import type { BrowserWindowConstructorOptions } from "electron";
import type { AppPreferences } from "@wordless/domain";
import type { DesktopHostInfo } from "@wordless/protocol";

type HostPlatform = DesktopHostInfo["platform"];

function supportedPlatform(value: NodeJS.Platform): HostPlatform {
  if (value === "darwin" || value === "win32" || value === "linux") return value;
  return "linux";
}

function supportedArch(value: string): DesktopHostInfo["arch"] {
  if (value === "arm64" || value === "x64" || value === "ia32") return value;
  return "x64";
}

export function createDesktopHostInfo(platform: NodeJS.Platform = process.platform, arch = process.arch): DesktopHostInfo {
  const current = supportedPlatform(platform);
  if (current === "darwin") {
    return {
      platform: current,
      arch: supportedArch(arch),
      windowChrome: "mac-hidden-inset",
      menuPresentation: "system",
      modifier: "meta",
      shellFamily: "zsh",
      capabilities: { dockBadge: true, nativeNotifications: true, titleBarOverlay: false },
    };
  }
  if (current === "win32") {
    return {
      platform: current,
      arch: supportedArch(arch),
      windowChrome: "overlay",
      menuPresentation: "in-window",
      modifier: "control",
      shellFamily: "powershell",
      capabilities: { dockBadge: false, nativeNotifications: true, titleBarOverlay: true },
    };
  }
  return {
    platform: current,
    arch: supportedArch(arch),
    windowChrome: "overlay",
    menuPresentation: "in-window",
    modifier: "control",
    shellFamily: "bash",
    capabilities: { dockBadge: false, nativeNotifications: true, titleBarOverlay: true },
  };
}

export function titleBarOverlay(preferences: AppPreferences, dark: boolean) {
  const hasBackground = preferences.appearance.background.source.kind !== "none";
  return {
    color: dark ? (hasBackground ? "#202219e6" : "#202219") : (hasBackground ? "#f6f6f5e6" : "#f6f6f5"),
    symbolColor: dark ? "#f2f2ec" : "#30302e",
    height: 30,
  };
}

export function mainWindowOptions(preloadPath: string, preferences: AppPreferences, dark: boolean, host = createDesktopHostInfo()): BrowserWindowConstructorOptions {
  const common: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 760,
    minWidth: 1040,
    minHeight: 640,
    backgroundColor: dark ? "#151610" : "#fbfbfa",
    title: "Wordless",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (host.windowChrome === "mac-hidden-inset") {
    return {
      ...common,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 12 },
    };
  }
  if (host.capabilities.titleBarOverlay) {
    return {
      ...common,
      frame: false,
      titleBarStyle: "hidden",
      titleBarOverlay: titleBarOverlay(preferences, dark),
    };
  }
  return common;
}
