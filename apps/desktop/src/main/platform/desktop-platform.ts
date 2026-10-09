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
    // Linux 也是自绘标题栏:窗口无边框,窗口内那条 chrome 就是标题栏。
    windowChrome: "overlay",
    menuPresentation: "in-window",
    modifier: "control",
    shellFamily: "bash",
    // **系统不画窗口按钮**:`titleBarOverlay` 这条只有 Windows 走得住,Linux 上不指望它
    // (d.ts 把 `setTitleBarOverlay` 标成 win32/linux,但 `titleBarOverlay` 这个构造项没有任何
    // 平台标注,而一旦它不生效,用户拿到的是一个没有关闭按钮的无边框窗口)。所以 Linux 上由
    // 渲染层自己画那三个按钮(见 DesktopChrome 的 inAppWindowControls)。
    // 决策与可撤销点见 `docs/architecture/linux-release.md` §3 D3。
    capabilities: { dockBadge: false, nativeNotifications: true, titleBarOverlay: false },
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

/**
 * 关掉主窗口 = 退出应用,还是收进托盘?
 *
 * 决策与代价见 `docs/architecture/linux-release.md` §3 D2。
 *
 * Windows 上托盘一定在,收起来是对的(自动化还在跑,任务栏/托盘还能叫回来)。Linux 上不行:
 * GNOME 默认不带托盘扩展,而且 `tray.on("click")` 在部分桌面环境下根本不触发 —— 于是"关窗"
 * 会变成**窗口再也回不来、进程还在后台跑**,用户只能去杀进程。所以 Linux 上关窗就是退出
 * (托盘照旧创建,它只是不再是唯一入口)。
 */
export function closingQuitsApplication(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux";
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
      trafficLightPosition: { x: 14, y: 11 },
    };
  }
  if (host.windowChrome === "overlay") {
    // 自绘标题栏的平台一律 `frame: false`(否则系统标题栏会和窗口内那条 chrome 叠成两条)。
    // `titleBarOverlay` 只加在系统会画那组按钮的平台上(Windows);Linux 上按钮由渲染层画。
    return host.capabilities.titleBarOverlay
      ? {
          ...common,
          frame: false,
          titleBarStyle: "hidden",
          titleBarOverlay: titleBarOverlay(preferences, dark),
        }
      : { ...common, frame: false, titleBarStyle: "hidden" };
  }
  return common;
}
