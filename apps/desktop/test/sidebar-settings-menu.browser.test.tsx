import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    setPreferences: vi.fn(async () => {}),
  },
  onOpenSettings: vi.fn(),
  snapshot: {
    entries: [],
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
    },
    sessions: [],
    workspaces: [],
  },
}));

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ client: mocks.client, error: null, refresh: async () => {}, snapshot: mocks.snapshot, status: "ready" }),
  useRuntimeClient: () => mocks.client,
}));

vi.mock("../src/renderer/shared/account", () => ({
  useDesktopAccount: () => ({ account: null, error: null, login: async () => {}, logout: async () => {}, operation: "idle" }),
}));

import { PreferencesProvider } from "../src/renderer/shared/preferences";
import { Sidebar } from "../src/renderer/features/workbench/Sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  mocks.client.setPreferences.mockClear();
  mocks.onOpenSettings.mockClear();
  mocks.snapshot.preferences.locale = "zh-CN";
  mocks.snapshot.preferences.theme = "system";
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  delete document.documentElement.dataset.theme;
  document.documentElement.lang = "";
});

async function renderSidebar(): Promise<HTMLElement> {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <StrictMode>
        <PreferencesProvider>
          <Sidebar
            collapsed={false}
            mainView="thread"
            onNewThread={() => {}}
            onOpenAutomation={() => {}}
            onOpenExperts={() => {}}
            onOpenMedia={() => {}}
            onOpenSession={() => {}}
            onOpenSettings={mocks.onOpenSettings}
            onOpenSkills={() => {}}
            onOpenTasks={() => {}}
            onSessionDeleted={() => {}}
            onToggle={() => {}}
            runningSessionIds={new Set<string>()}
            selectedSessionId={null}
          />
        </PreferencesProvider>
      </StrictMode>,
    );
  });
  return container;
}

/** Radix controls react to pointer events, so a bare click() is not enough. */
function press(element: Element): void {
  for (const type of ["pointerenter", "pointerdown", "pointerup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}

/** The popover content is portaled into document.body, so every lookup runs against the whole document. */
function queryButton(name: string): HTMLElement {
  const button = Array.from(document.body.querySelectorAll<HTMLElement>("button")).find((candidate) => candidate.getAttribute("aria-label") === name);
  expect(button, `button labelled ${name} was not rendered`).not.toBeUndefined();
  return button!;
}

function popoverGroup(label: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`);
}

describe("sidebar settings menu", () => {
  it("opens a quick menu instead of the settings dialog", async () => {
    await renderSidebar();
    const trigger = queryButton("设置");

    expect(popoverGroup("主题")).toBeNull();
    await act(async () => {
      press(trigger);
    });

    expect(mocks.onOpenSettings).not.toHaveBeenCalled();
    expect(popoverGroup("主题")).not.toBeNull();
    expect(popoverGroup("显示语言")).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("highlights the active theme and applies a new one immediately", async () => {
    await renderSidebar();
    await act(async () => {
      press(queryButton("设置"));
    });

    const themeGroup = popoverGroup("主题")!;
    const themeButtons = Array.from(themeGroup.querySelectorAll<HTMLElement>("button"));
    expect(themeButtons.map((button) => button.getAttribute("aria-label"))).toEqual(["浅色", "深色", "跟随系统"]);
    expect(themeButtons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);

    await act(async () => {
      press(queryButton("浅色"));
    });

    expect(mocks.client.setPreferences).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" }));
    expect(queryButton("浅色").getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("switches the locale from the compact language options", async () => {
    await renderSidebar();
    await act(async () => {
      press(queryButton("设置"));
    });

    const languageGroup = popoverGroup("显示语言")!;
    expect(Array.from(languageGroup.querySelectorAll<HTMLElement>("button")).map((button) => button.getAttribute("aria-label"))).toEqual(["简体中文", "English"]);


    await act(async () => {
      press(queryButton("English"));
    });

    expect(mocks.client.setPreferences).toHaveBeenCalledWith(expect.objectContaining({ locale: "en-US" }));
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("keeps the settings entry opening the full dialog", async () => {
    await renderSidebar();
    await act(async () => {
      press(queryButton("设置"));
    });

    const entry = Array.from(document.body.querySelectorAll<HTMLElement>("button")).find((candidate) => candidate.textContent?.trim() === "设置");
    expect(entry, "the quick menu settings entry was not rendered").not.toBeUndefined();
    await act(async () => {
      press(entry!);
    });

    expect(mocks.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(mocks.onOpenSettings).toHaveBeenCalledWith();
    expect(popoverGroup("主题")).toBeNull();
  });

  it("toggles closed when the trigger is pressed again", async () => {
    await renderSidebar();
    await act(async () => {
      press(queryButton("设置"));
    });
    expect(popoverGroup("主题")).not.toBeNull();
    await act(async () => {
      press(queryButton("设置"));
    });
    expect(popoverGroup("主题")).toBeNull();
  });
});
