import assert from "node:assert/strict";
import test from "node:test";
import type { AppPreferences } from "@wordless/domain";
import { closingQuitsApplication, createDesktopHostInfo, mainWindowOptions } from "../src/main/platform/desktop-platform.ts";

const preferences = {
  locale: "zh-CN",
  theme: "system",
  fontScale: 1,
  reduceMotion: false,
  notifications: { enabled: false, onActionRequired: true, onRunCompleted: true, onRunFailed: true },
  security: { customFileRules: [], customCommandRules: [] },
  appearance: { background: { source: { kind: "none" }, fit: "cover", position: { x: 50, y: 50 }, intensity: 40, blurPx: 0 } },
  defaultWorkspaceRoot: "",
  defaultModel: null,
  entryModels: {},
} satisfies AppPreferences;

test("describes macOS as a native hidden-inset host", () => {
  const host = createDesktopHostInfo("darwin", "arm64");

  assert.deepEqual(host, {
    platform: "darwin",
    arch: "arm64",
    windowChrome: "mac-hidden-inset",
    menuPresentation: "system",
    modifier: "meta",
    shellFamily: "zsh",
    capabilities: { dockBadge: true, nativeNotifications: true, titleBarOverlay: false },
  });

  const options = mainWindowOptions("/tmp/preload.cjs", preferences, false, host);
  assert.equal(options.titleBarStyle, "hiddenInset");
  assert.deepEqual(options.trafficLightPosition, { x: 14, y: 11 });
  assert.equal(options.titleBarOverlay, undefined);
  assert.equal(options.frame, undefined);
});

test("keeps overlay chrome on Windows", () => {
  const host = createDesktopHostInfo("win32", "x64");
  const options = mainWindowOptions("/tmp/preload.cjs", preferences, true, host);

  assert.deepEqual(host.capabilities, { dockBadge: false, nativeNotifications: true, titleBarOverlay: true });
  assert.equal(options.frame, false);
  assert.equal(options.titleBarStyle, "hidden");
  assert.deepEqual(options.titleBarOverlay, { color: "#202219", symbolColor: "#f2f2ec", height: 30 });
});

test("Linux is frameless without the system overlay — the renderer draws the buttons", () => {
  const host = createDesktopHostInfo("linux", "x64");
  const options = mainWindowOptions("/tmp/preload.cjs", preferences, true, host);

  // 关键点:依然无边框(否则系统标题栏会和窗口内那条 chrome 叠成两条),但**不**要 overlay ——
  // 那三个按钮由渲染层画(DesktopChrome 看 capabilities.titleBarOverlay 决定画不画)。
  assert.equal(host.capabilities.titleBarOverlay, false);
  assert.equal(options.frame, false);
  assert.equal(options.titleBarStyle, "hidden");
  assert.equal(options.titleBarOverlay, undefined);
});

test("closing the window quits only where there is no dependable tray", () => {
  // Windows 上托盘一定在,关窗收起来是对的;Linux 上 GNOME 默认没有托盘扩展,
  // "收起来"等于"窗口再也回不来、进程还在后台跑"。
  assert.equal(closingQuitsApplication("linux"), true);
  assert.equal(closingQuitsApplication("win32"), false);
  assert.equal(closingQuitsApplication("darwin"), false);
});
