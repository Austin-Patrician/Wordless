import assert from "node:assert/strict";
import test from "node:test";
import type { AppPreferences } from "@wordless/domain";
import { createDesktopHostInfo, mainWindowOptions } from "../src/main/platform/desktop-platform.ts";

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
  assert.deepEqual(options.trafficLightPosition, { x: 14, y: 12 });
  assert.equal(options.titleBarOverlay, undefined);
  assert.equal(options.frame, undefined);
});

test("keeps overlay chrome on Windows and Linux", () => {
  const host = createDesktopHostInfo("win32", "x64");
  const options = mainWindowOptions("/tmp/preload.cjs", preferences, true, host);

  assert.equal(options.frame, false);
  assert.equal(options.titleBarStyle, "hidden");
  assert.deepEqual(options.titleBarOverlay, { color: "#202219", symbolColor: "#f2f2ec", height: 30 });
});
