import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@wordless/ui-kit";

const updateAutomation = vi.fn(async () => {});
const createAutomation = vi.fn(async () => {});

const enabledModel = {
  connectionId: "conn-1",
  modelId: "gpt",
  displayName: "GPT",
  enabled: true,
  capabilities: {
    supportsText: true,
    supportsVision: false,
    supportsToolUse: true,
    supportsReasoning: true,
    supportedThinkingLevels: ["off", "low", "medium", "high"],
    contextWindow: 128000,
    maxOutputTokens: 8192,
  },
} as never;

const snapshot = {
  preferences: { defaultModel: { connectionId: "conn-1", modelId: "gpt" } },
  entries: [],
  workspaces: [
    { id: "ws-1", name: "Main", availability: "available" },
  ],
  sessions: [
    {
      id: "session-1",
      title: "Linked conversation",
      workspaceId: "ws-1",
      runtimeRootPath: "/tmp/rt",
      mode: "everyday",
      entryId: "general-work",
      profile: { id: "general", version: "1" },
      driverId: "generic",
      journalFormat: "wordless-agent-v1",
      workbenchId: "conversation",
      accessLevel: "default",
      model: { connectionId: "conn-1", modelId: "gpt" },
      thinkingLevel: "medium",
      journalPath: "/tmp/session.jsonl",
      connectorIds: [],
      interactionMode: "default",
      toolApprovalMode: "bypass",
      pinnedAt: null,
      createdAt: 1,
      updatedAt: 1,
    },
  ] as never,
  runningSessionIds: [],
  connections: [
    { id: "conn-1", providerId: "openai", avatarId: "openai" },
  ] as never,
  models: [enabledModel],
  modelConfiguration: {},
  security: {},
  extensions: {},
  skills: { skills: [] },
  connectors: { connectors: [] },
  mediaProjects: [],
  experts: [],
} as never;

vi.mock("../src/renderer/shared/runtime", () => ({
  useRuntime: () => ({ snapshot }),
  useRuntimeClient: () => ({ updateAutomation, createAutomation }),
}));

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    locale: "en-US",
    reduceMotion: true,
    t: (key: string) => key,
  }),
}));

import { AutomationForm } from "../src/renderer/features/automation/AutomationView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  updateAutomation.mockClear();
  createAutomation.mockClear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function composerText(): string {
  const composer = document.querySelector("[aria-label='automationPrompt']");
  return composer?.textContent ?? "";
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

function buttonByText(label: string): HTMLButtonElement | null {
  const buttons = [...document.querySelectorAll("button")];
  return buttons.find((item) => item.textContent?.trim() === label) ?? null;
}

function pointerPress(element: Element): void {
  const init: PointerEventInit = { bubbles: true, pointerId: 1, isPrimary: true };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  element.dispatchEvent(new PointerEvent("pointerup", init));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const initial = {
  id: "task-1",
  name: "Daily digest",
  prompt: "Summarize the news.",
  entryId: "general-work",
  workspaceId: null,
  sessionId: null,
  accessLevel: "default",
  toolApprovalMode: "auto",
  model: { connectionId: "conn-1", modelId: "gpt" },
  thinkingLevel: "medium",
  skillIds: [],
  connectorIds: [],
  schedule: { kind: "recurring", cadence: "daily", time: "09:00" },
  activeFrom: null,
  activeUntil: null,
  enabled: true,
  nextRunAt: 10,
  createdAt: 1,
  updatedAt: 1,
} as never;

async function mountForm(): Promise<void> {
  await act(async () => {
    const root = createRoot(document.querySelector("#root")!);
    roots.push(root);
    root.render(
      <TooltipProvider>
        <AutomationForm
          initial={initial}
          onBack={() => {}}
          onSaved={async () => {}}
        />
      </TooltipProvider>,
    );
  });
  await delay(120);
}

describe("automation form linked session", () => {
  it("saves an edit without touching the linked-session picker", async () => {
    await mountForm();
    expect(composerText()).toContain("Summarize the news.");
    const save = buttonByText("automationSave");
    expect(save).not.toBeNull();
    await act(async () => {
      save!.click();
    });
    await delay(120);
    expect(updateAutomation).toHaveBeenCalled();
    const input = updateAutomation.mock.calls[0]![1] as { prompt: string };
    expect(input.prompt).toBe("Summarize the news.");
  });

  it("keeps the prompt when a linked session is picked", async () => {
    await mountForm();
    expect(composerText()).toContain("Summarize the news.");
    const triggers = [...document.querySelectorAll("button[role='combobox']")];
    const sessionTrigger = triggers.find((item) =>
      item.textContent?.includes("automationNewSession"),
    );
    expect(sessionTrigger).toBeDefined();
    await act(async () => {
      pointerPress(sessionTrigger!);
    });
    await delay(120);
    const option = [...document.querySelectorAll("[role='option']")].find(
      (item) => item.textContent?.includes("Linked conversation"),
    );
    expect(option).toBeDefined();
    await act(async () => {
      pointerPress(option!);
    });
    await delay(120);
    expect(sessionTrigger!.textContent).toContain("Linked conversation");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!document.querySelector("[role='listbox']")) break;
      await act(async () => {
        document.body.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            pointerId: 1,
            isPrimary: true,
          }),
        );
      });
      await delay(120);
    }
    expect(document.querySelector("[role='listbox']")).toBeNull();
    expect(composerText()).toContain("Summarize the news.");
    const save = buttonByText("automationSave");
    expect(save).not.toBeNull();
    await act(async () => {
      pointerPress(save!);
    });
    await delay(120);
    if (!updateAutomation.mock.calls.length) {
      // The session's bypass/full permissions open the confirmation dialog.
      expect(bodyText()).toContain("automationPermissionConfirmTitle");
      const checkbox = document.querySelector(
        "[role='alertdialog'] input[type='checkbox']",
      ) as HTMLInputElement | null;
      expect(checkbox).not.toBeNull();
      await act(async () => {
        checkbox!.click();
      });
      await delay(120);
      const confirm = buttonByText("automationConfirmSave");
      expect(confirm).not.toBeNull();
      await act(async () => {
        pointerPress(confirm!);
      });
      await delay(120);
    }
    if (!updateAutomation.mock.calls.length) {
      throw new Error(
        `confirm save not called; promptError=${bodyText().includes("automationPromptRequired")}; dialogOpen=${bodyText().includes("automationPermissionConfirmTitle")}; body=${bodyText().slice(0, 600)}`,
      );
    }
    expect(updateAutomation).toHaveBeenCalled();
    const input = updateAutomation.mock.calls[0]![1] as {
      prompt: string;
      sessionId: string | null;
    };
    expect(input.prompt).toBe("Summarize the news.");
    expect(input.sessionId).toBe("session-1");
    expect(bodyText()).not.toContain("automationPromptRequired");
  });
});
