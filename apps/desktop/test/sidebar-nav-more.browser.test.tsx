import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    setPreferences: vi.fn(async () => {}),
  },
  handlers: {
    newThread: vi.fn(),
    openAutomation: vi.fn(),
    openExperts: vi.fn(),
    openMedia: vi.fn(),
    openSkills: vi.fn(),
    openTasks: vi.fn(),
  },
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
      sidebar: { layout: { more: [], pinned: [] }, pinnedLimit: 5 },
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

import { TooltipProvider } from "@wordless/ui-kit";
import { PreferencesProvider } from "../src/renderer/shared/preferences";
import { Sidebar } from "../src/renderer/features/workbench/Sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  mocks.client.setPreferences.mockClear();
  for (const handler of Object.values(mocks.handlers)) handler.mockClear();
  mocks.snapshot.preferences.sidebar = { layout: { more: [], pinned: [] }, pinnedLimit: 5 };
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

async function renderSidebar(mainView = "thread", collapsed = false): Promise<HTMLElement> {
  const container = document.getElementById("root")!;
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <StrictMode>
        <TooltipProvider>
        <PreferencesProvider>
          <Sidebar
            collapsed={collapsed}
            mainView={mainView as never}
            onNewThread={mocks.handlers.newThread}
            onOpenAutomation={mocks.handlers.openAutomation}
            onOpenExperts={mocks.handlers.openExperts}
            onOpenMedia={mocks.handlers.openMedia}
            onOpenSession={() => {}}
            onOpenSettings={() => {}}
            onOpenSkills={mocks.handlers.openSkills}
            onOpenTasks={mocks.handlers.openTasks}
            onSessionDeleted={() => {}}
            onToggle={() => {}}
            runningSessionIds={new Set<string>()}
            selectedSessionId={null}
          />
        </PreferencesProvider>
        </TooltipProvider>
      </StrictMode>,
    );
  });
  return container;
}

/** Radix reacts to pointer events, so a bare click() is not enough. */
function press(element: Element): void {
  for (const type of ["pointerenter", "pointerdown", "pointerup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}

const rail = () => Array.from(document.querySelectorAll<HTMLElement>("nav [data-tour]")).map((element) => element.dataset.tour);
const panel = () => document.body.querySelector<HTMLElement>("[data-sidebar-nav-panel]");
const panelRowIds = () => Array.from(panel()?.querySelectorAll<HTMLElement>("[data-sidebar-nav-row]") ?? []).map((row) => row.dataset.sidebarNavRow);
const row = (id: string): HTMLElement => {
  const element = panel()?.querySelector<HTMLElement>(`[data-sidebar-nav-row="${id}"]`);
  expect(element, `row ${id} is not in the panel`).not.toBeNull();
  return element!;
};
const rowButton = (id: string, label: string): HTMLElement => {
  const button = Array.from(row(id).querySelectorAll<HTMLElement>("button")).find((candidate) => candidate.getAttribute("aria-label") === label);
  expect(button, `row ${id} has no ${label} control`).not.toBeUndefined();
  return button!;
};
const rowLabelButton = (id: string): HTMLElement => row(id).querySelector<HTMLElement>("button")!;

async function openPanel(): Promise<void> {
  const trigger = document.querySelector<HTMLElement>('[data-tour="nav-more"]');
  expect(trigger, "the More trigger is not rendered").not.toBeNull();
  await act(async () => {
    press(trigger!);
  });
}

describe("sidebar navigation", () => {
  it("shows a few entries inline and keeps the rest one click away", async () => {
    await renderSidebar();

    expect(rail()).toEqual(["nav-new", "nav-media", "nav-experts", "nav-skills", "nav-more"]);
    expect(document.querySelector('[data-tour="nav-tasks"]')).toBeNull();
  });

  it("keeps an anchor for every first-run step that points at the sidebar", async () => {
    await renderSidebar();

    // The guide spotlights these rows; a step whose anchor is hidden inside the
    // panel would fall back to a centred card and lose its pointer.
    for (const anchor of ["nav-new", "nav-skills", "nav-experts"]) {
      expect(document.querySelector(`[data-tour="${anchor}"]`), anchor).not.toBeNull();
    }
  });

  it("lists both regions, with the locked entry first and unpinnable", async () => {
    await renderSidebar();
    await openPanel();

    expect(panelRowIds()).toEqual(["new", "media", "experts", "skills", "automation", "tasks"]);
    expect(row("new").getAttribute("draggable")).toBe("false");
    expect(row("media").getAttribute("draggable")).toBe("true");
    expect(row("new").querySelector('[aria-label="移到「更多」"]')).toBeNull();
    expect(row("new").querySelector('[aria-label="固定显示，不可移动"]')).not.toBeNull();
  });

  it("keeps its entry point when every entry is shown inline", async () => {
    // With nothing left in More the panel would otherwise become unreachable,
    // and an entry pinned by mistake could never be unpinned.
    mocks.snapshot.preferences.sidebar = { layout: { more: [], pinned: ["media", "automation", "tasks", "experts", "skills"] }, pinnedLimit: 6 };
    await renderSidebar();

    expect(rail()).toEqual(["nav-new", "nav-media", "nav-automation", "nav-tasks", "nav-experts", "nav-skills", "nav-more"]);
    await openPanel();

    await act(async () => {
      press(rowButton("skills", "移到「更多」"));
    });

    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: expect.objectContaining({ layout: expect.objectContaining({ more: ["skills"] }) }) }),
    );
  });

  it("stays reachable when the sidebar is collapsed to icons", async () => {
    await renderSidebar("thread", true);

    // Collapsed, the trigger is the only way to the hidden views.
    expect(document.querySelector('[data-tour="nav-more"]')).not.toBeNull();
    await openPanel();

    expect(panelRowIds()).toContain("tasks");
  });

  it("opens a hidden view from the panel and closes it", async () => {
    await renderSidebar();
    await openPanel();

    await act(async () => {
      press(rowLabelButton("automation"));
    });

    expect(mocks.handlers.openAutomation).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it("bubbles the hidden view that is current into the trigger", async () => {
    await renderSidebar("tasks");

    const trigger = document.querySelector<HTMLElement>('[data-tour="nav-more"]')!;
    expect(trigger.textContent).toContain("任务");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("pins a hidden entry inline and back, persisting both moves", async () => {
    await renderSidebar();
    await openPanel();

    await act(async () => {
      press(rowButton("tasks", "移到栏内"));
    });

    expect(rail()).toEqual(["nav-new", "nav-media", "nav-experts", "nav-skills", "nav-tasks", "nav-more"]);
    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: { layout: { pinned: ["media", "experts", "skills", "tasks"], more: ["automation"] }, pinnedLimit: 5 } }),
    );

    await act(async () => {
      press(rowButton("tasks", "移到「更多」"));
    });

    expect(rail()).toEqual(["nav-new", "nav-media", "nav-experts", "nav-skills", "nav-more"]);
    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: { layout: { pinned: ["media", "experts", "skills"], more: ["tasks", "automation"] }, pinnedLimit: 5 } }),
    );
  });

  it("refuses a pin when the bar is full instead of evicting an entry", async () => {
    mocks.snapshot.preferences.sidebar = { layout: { more: [], pinned: ["media", "experts", "skills"] }, pinnedLimit: 4 };
    await renderSidebar();
    await openPanel();

    const pin = rowButton("automation", "栏内已满，先移出一个");
    expect(pin.hasAttribute("disabled")).toBe(true);
    await act(async () => {
      press(pin);
    });

    expect(mocks.client.setPreferences).not.toHaveBeenCalled();
    expect(rail()).toEqual(["nav-new", "nav-media", "nav-experts", "nav-skills", "nav-more"]);
  });

  it("reorders with the keyboard, which is the same move the drag makes", async () => {
    await renderSidebar();
    await openPanel();

    await act(async () => {
      rowLabelButton("media").dispatchEvent(new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "ArrowDown" }));
    });

    // Down one slot means "insert before the entry after the next one".
    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: expect.objectContaining({ layout: expect.objectContaining({ pinned: ["experts", "media", "skills"] }) }) }),
    );
    expect(rail()).toEqual(["nav-new", "nav-experts", "nav-media", "nav-skills", "nav-more"]);
  });

  it("reorders by dragging a row inside its region", async () => {
    await renderSidebar();
    await openPanel();

    const source = row("skills");
    const target = row("media");
    const targetBox = target.getBoundingClientRect();
    const dataTransfer = new DataTransfer();

    await act(async () => {
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      // The upper half of a row means "insert before this entry".
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, clientY: targetBox.top + 2, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, clientY: targetBox.top + 2, dataTransfer }));
    });

    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: expect.objectContaining({ layout: expect.objectContaining({ pinned: ["skills", "media", "experts"] }) }) }),
    );
    expect(rail()).toEqual(["nav-new", "nav-skills", "nav-media", "nav-experts", "nav-more"]);
  });

  it("moves an entry across regions by dragging it onto the other list", async () => {
    await renderSidebar();
    await openPanel();

    const source = row("tasks");
    const target = row("experts");
    const targetBox = target.getBoundingClientRect();
    const dataTransfer = new DataTransfer();

    await act(async () => {
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, clientY: targetBox.top + 2, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, clientY: targetBox.top + 2, dataTransfer }));
    });

    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: expect.objectContaining({ layout: expect.objectContaining({ pinned: ["media", "tasks", "experts", "skills"], more: ["automation"] }) }) }),
    );
    expect(rail()).toEqual(["nav-new", "nav-media", "nav-tasks", "nav-experts", "nav-skills", "nav-more"]);
  });

  it("changes the inline limit and moves the rows that no longer fit", async () => {
    await renderSidebar();
    await openPanel();

    const limit = Array.from(panel()!.querySelectorAll<HTMLElement>("button")).find((candidate) => candidate.textContent?.trim() === "3");
    expect(limit, "the limit control is missing").not.toBeUndefined();
    await act(async () => {
      press(limit!);
    });

    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: { layout: { pinned: ["media", "experts"], more: ["skills", "automation", "tasks"] }, pinnedLimit: 3 } }),
    );
    expect(rail()).toEqual(["nav-new", "nav-media", "nav-experts", "nav-more"]);
  });

  it("resets the arrangement back to the default split", async () => {
    mocks.snapshot.preferences.sidebar = { layout: { more: [], pinned: ["automation"] }, pinnedLimit: 6 };
    await renderSidebar();
    await openPanel();

    await act(async () => {
      press(rowButton("media", "移到「更多」"));
    });
    await act(async () => {
      press(document.body.querySelector<HTMLElement>('[aria-label="恢复默认排列"]')!);
    });

    expect(mocks.client.setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ sidebar: { layout: { pinned: [], more: [] }, pinnedLimit: 6 } }),
    );
    expect(rail()).toEqual(["nav-new", "nav-media", "nav-experts", "nav-skills", "nav-more"]);
  });
});
