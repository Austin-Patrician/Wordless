import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEffectiveShortcut, type ShortcutBindings } from "@wordless/domain";

const mocks = vi.hoisted(() => ({
  client: { setPreferences: vi.fn(async () => {}) },
  snapshot: {
    preferences: {
      appearance: { background: { blurPx: 0, fit: "cover", intensity: 40, position: { x: 50, y: 50 }, source: { kind: "none" } } },
      defaultModel: null,
      defaultWorkspaceRoot: "/workspace",
      entryModels: {},
      fontScale: 1,
      locale: "zh-CN",
      notifications: { enabled: false, onActionRequired: true, onRunCompleted: true, onRunFailed: true },
      reduceMotion: false,
      security: { customCommandRules: [], customFileRules: [] },
      theme: "system",
      translation: { bubbleMaxChars: 600, model: null, targetLanguage: null },
      shortcuts: { bindings: { "open-settings": "mod+shift+," } } as unknown,
    },
  },
}));

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ client: mocks.client, error: null, refresh: async () => {}, snapshot: mocks.snapshot, status: "ready" }),
  useRuntimeClient: () => mocks.client,
}));

import { PreferencesProvider, usePreferences } from "../src/renderer/shared/preferences";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Preferences = ReturnType<typeof usePreferences>;
let captured: Preferences | null = null;

function Probe() {
  captured = usePreferences();
  return <div />;
}

describe("shortcut bindings in preferences", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.client.setPreferences.mockClear();
    mocks.snapshot.preferences.shortcuts = { bindings: { "open-settings": "mod+shift+," } };
    captured = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PreferencesProvider>
          <Probe />
        </PreferencesProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function preferences(): Preferences {
    if (!captured) throw new Error("preferences were not captured");
    return captured;
  }

  it("hydrates the bindings the runtime stored", () => {
    expect(preferences().shortcuts).toEqual({ bindings: { "open-settings": "mod+shift+," } });
    expect(getEffectiveShortcut("open-settings", preferences().shortcuts.bindings)).toBe("mod+shift+,");
  });

  it("falls back to the defaults when the stored preferences predate shortcuts", () => {
    act(() => root.unmount());
    mocks.snapshot.preferences.shortcuts = undefined;
    captured = null;
    root = createRoot(container);
    act(() => {
      root.render(
        <PreferencesProvider>
          <Probe />
        </PreferencesProvider>,
      );
    });

    expect(preferences().shortcuts).toEqual({ bindings: {} });
    expect(getEffectiveShortcut("open-settings", preferences().shortcuts.bindings)).toBe("mod+,");
  });

  it("normalizes a rebinding on the way out instead of storing what it was handed", async () => {
    await act(async () => {
      await preferences().setShortcutBindings({
        "open-settings": "Shift+Mod+,",
        // Neither of these can be honoured; storing them would mean the
        // dispatcher has to re-filter on every key press.
        "removed-action": "mod+j",
      } as unknown as ShortcutBindings);
    });

    expect(mocks.client.setPreferences).toHaveBeenCalledTimes(1);
    expect(mocks.client.setPreferences.mock.calls[0]?.[0]).toMatchObject({
      shortcuts: { bindings: { "open-settings": "mod+shift+," } },
    });
    // Unrelated preferences travel with the write.
    expect(mocks.client.setPreferences.mock.calls[0]?.[0]).toMatchObject({ locale: "zh-CN", theme: "system" });
    expect(preferences().shortcuts.bindings).toEqual({ "open-settings": "mod+shift+," });
  });

  it("returns an action to its default when its binding is cleared", async () => {
    await act(async () => {
      await preferences().setShortcutBindings({});
    });

    expect(mocks.client.setPreferences.mock.calls[0]?.[0]).toMatchObject({ shortcuts: { bindings: {} } });
    expect(getEffectiveShortcut("open-settings", preferences().shortcuts.bindings)).toBe("mod+,");
  });
});
