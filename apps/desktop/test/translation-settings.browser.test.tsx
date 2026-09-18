import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    setPreferences: vi.fn(async () => {}),
  },
  snapshot: {
    extensions: { configurations: {}, descriptors: [] },
    modelConfiguration: { models: [{ displayName: "GPT", enabled: true, kind: "chat", modelId: "gpt", providerId: "openai" }] },
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
  },
}));

vi.mock("../src/renderer/platform/desktop-update", () => ({
  DesktopUpdateProvider: ({ children }: { children: React.ReactNode }) => children,
  useDesktopUpdate: () => ({ appInfo: { name: "Wordless", version: "0.0.0" } }),
}));

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ client: mocks.client, error: null, refresh: async () => {}, snapshot: mocks.snapshot, status: "ready" }),
  useRuntimeClient: () => mocks.client,
}));

import { PreferencesProvider } from "../src/renderer/shared/preferences";
import { SettingsDialog } from "../src/renderer/features/settings/SettingsDialog";
import { TranslationSettings } from "../src/renderer/features/settings/TranslationSettings";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  mocks.client.setPreferences.mockClear();
  mocks.snapshot.modelConfiguration.models = [{ displayName: "GPT", enabled: true, kind: "chat", modelId: "gpt", providerId: "openai" }];
  mocks.snapshot.preferences.translation = { bubbleMaxChars: 600, model: null, targetLanguage: null };
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

async function renderUi(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(<StrictMode><PreferencesProvider><div>{node}</div></PreferencesProvider></StrictMode>);
  });
  return container;
}

/** Radix controls react to pointer events, so a bare click() is not enough. */
function press(element: Element): void {
  for (const type of ["pointerenter", "pointerdown", "pointerup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}

async function chooseOption(selectId: string, optionLabel: string): Promise<void> {
  const trigger = document.getElementById(selectId) ?? document.querySelector(`[aria-labelledby="${selectId}"]`);
  expect(trigger).not.toBeNull();
  await act(async () => {
    press(trigger!);
  });
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((candidate) => candidate.textContent?.includes(optionLabel));
  expect(option, `option ${optionLabel} was not offered`).not.toBeUndefined();
  await act(async () => {
    press(option!);
  });
}

function lastPreferences(): Record<string, unknown> {
  const calls = mocks.client.setPreferences.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls.at(-1)![0] as Record<string, unknown>;
}

describe("translation preferences", () => {
  it("persists a pinned target language while keeping the other preferences intact", async () => {
    await renderUi(<TranslationSettings />);
    await chooseOption("translation-language", "日本語");

    const preferences = lastPreferences();
    expect(preferences.translation).toMatchObject({ bubbleMaxChars: 600, model: null, targetLanguage: "ja" });
    // The write replaces the whole object, so unrelated fields must survive it.
    expect(preferences.locale).toBe("zh-CN");
    expect(preferences.theme).toBe("system");
  });

  it("maps the follow-interface option back to a null target language", async () => {
    mocks.snapshot.preferences.translation.targetLanguage = "ja";
    await renderUi(<TranslationSettings />);
    await chooseOption("translation-language", "跟随界面语言");

    expect(lastPreferences().translation).toMatchObject({ targetLanguage: null });
  });

  it("persists a pinned translation model as a model reference", async () => {
    await renderUi(<TranslationSettings />);
    await chooseOption("translation-model", "GPT");

    expect(lastPreferences().translation).toMatchObject({ model: { connectionId: "openai", modelId: "gpt" } });
  });

  it("changes the bubble length limit from the slider", async () => {
    await renderUi(<TranslationSettings />);
    const slider = document.querySelector<HTMLElement>('[role="slider"]');
    expect(slider).not.toBeNull();
    await act(async () => {
      slider!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });

    expect(lastPreferences().translation).toMatchObject({ bubbleMaxChars: 700 });
  });

  it("disables the model picker when no chat model is enabled", async () => {
    mocks.snapshot.modelConfiguration.models = [];
    await renderUi(<TranslationSettings />);

    const trigger = document.getElementById("translation-model");
    expect(trigger?.hasAttribute("disabled")).toBe(true);
    // The page renders real translations, so assert on the resolved copy.
    expect(document.body.textContent).toContain("请先在设置中启用模型");
  });
});

describe("assistant settings page", () => {
  it("shows translation preferences and extensions on the same page", async () => {
    const container = await renderUi(<SettingsDialog initialPage="assistant" onOpenChange={() => {}} open />);

    expect(container.textContent).toContain("翻译");
    expect(container.textContent).toContain("扩展");
    // The page owns a single scroll container so the sections do not compete for height.
    expect(container.querySelectorAll(".overflow-y-auto").length).toBe(1);
  });
});
