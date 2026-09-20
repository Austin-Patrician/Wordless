import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@wordless/ui-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHORTCUT_ACTIONS, type ShortcutBindings } from "@wordless/domain";

const mocks = vi.hoisted(() => ({
  platform: "win32" as string,
  bindings: {} as Record<string, string>,
  setShortcutBindings: vi.fn(async () => {}),
  globalShortcuts: vi.fn(),
}));

vi.mock("../src/renderer/platform/desktop-host", () => ({
  useDesktopHost: () => ({
    hostInfo: { platform: mocks.platform },
    modifierLabel: mocks.platform === "darwin" ? "Cmd" : "Ctrl",
    subscribeHost: () => () => {},
  }),
}));

// The real translations would hide which branch produced a message, so the mock
// keeps the placeholders and lets the component fill them in.
vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({
    shortcuts: { bindings: mocks.bindings as ShortcutBindings },
    setShortcutBindings: mocks.setShortcutBindings,
    t: (key: string): string =>
      ({
        shortcutInUse: "{action} holds it",
        shortcutNeedsModifier: "{combo} needs a modifier",
        shortcutRecord: "record {action}",
        shortcutReset: "reset {action}",
      })[key] ?? key,
  }),
}));

import { ShortcutSettings } from "../src/renderer/features/settings/ShortcutSettings";
import { useGlobalShortcuts } from "../src/renderer/shared/shortcuts/use-global-shortcuts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useGlobalShortcuts(mocks.globalShortcuts);
  return null;
}

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
}

describe("shortcut settings page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.platform = "win32";
    mocks.bindings = {};
    mocks.setShortcutBindings.mockClear();
    mocks.globalShortcuts.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(withDispatcher = false) {
    act(() =>
      root.render(
        <TooltipProvider>
          {withDispatcher ? <Probe /> : null}
          <ShortcutSettings />
        </TooltipProvider>,
      ),
    );
  }

  /** Re-renders with bindings as they would look after a write. */
  function withBindings(bindings: Record<string, string>) {
    mocks.bindings = bindings;
    render();
  }

  function recorder(actionId: string): HTMLButtonElement {
    const button = container.querySelector(`[data-shortcut-action="${actionId}"]`);
    if (!button) throw new Error(`no recorder for ${actionId}`);
    return button as HTMLButtonElement;
  }

  function byLabel(label: string): HTMLButtonElement {
    const button = container.querySelector(`[aria-label="${label}"]`);
    if (!button) throw new Error(`no button labelled ${label}`);
    return button as HTMLButtonElement;
  }

  function resetAllButton(): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) => (candidate.textContent ?? "").includes("shortcutResetAll"));
    if (!button) throw new Error("no reset-all button");
    return button as HTMLButtonElement;
  }

  function press(target: EventTarget, event: KeyboardEvent): void {
    act(() => {
      target.dispatchEvent(event);
    });
  }

  function text(): string {
    return container.textContent ?? "";
  }

  it("lists every action with the key it answers to", () => {
    render();

    expect(container.querySelectorAll("[data-shortcut-action]").length).toBe(SHORTCUT_ACTIONS.length);
    expect(recorder("new-thread").textContent).toBe("Ctrl + N");
    expect(recorder("open-settings").textContent).toBe("Ctrl + ,");
    expect(recorder("find-in-conversation").textContent).toBe("Ctrl + F");
    expect(recorder("open-tasks").textContent).toBe("Ctrl + 4");
    expect(text()).toContain("shortcutNewThreadLabel");
    expect(text()).toContain("shortcutOpenSettingsLabel");
    // Nothing is customized yet.
    expect(resetAllButton().disabled).toBe(true);
  });

  it("shows the keys of the host platform", () => {
    mocks.platform = "darwin";
    render();

    // macOS glues the glyphs, so the page matches the menu bar.
    expect(recorder("open-settings").textContent).toBe("⌘,");

    mocks.bindings = { "open-settings": "mod+shift+," };
    render();
    expect(recorder("open-settings").textContent).toBe("⇧⌘,");
  });

  it("records a new combination for one action", () => {
    render();

    act(() => recorder("open-settings").click());
    expect(recorder("open-settings").textContent).toBe("shortcutRecording");

    press(recorder("open-settings"), keyEvent({ key: ",", ctrlKey: true, shiftKey: true }));

    expect(mocks.setShortcutBindings).toHaveBeenCalledWith({ "open-settings": "mod+shift+," });

    // Recording ended. The page renders from the stored bindings, so showing the
    // new key is the write landing rather than something the recorder keeps.
    withBindings({ "open-settings": "mod+shift+," });
    expect(recorder("open-settings").textContent).toBe("Ctrl + Shift + ,");
  });

  it("refuses a combination that would shadow ordinary typing", () => {
    render();
    act(() => recorder("new-thread").click());

    press(recorder("new-thread"), keyEvent({ key: "a" }));
    // Still recording, with the reason in front of the user.
    expect(text()).toContain("A needs a modifier");
    expect(recorder("new-thread").textContent).toBe("shortcutRecording");

    // Shift alone is not a holding modifier either.
    press(recorder("new-thread"), keyEvent({ key: "a", shiftKey: true }));
    expect(text()).toContain("Shift + A needs a modifier");
    expect(mocks.setShortcutBindings).not.toHaveBeenCalled();
  });

  it("refuses a key another action already holds and names it", () => {
    render();
    act(() => recorder("new-thread").click());

    press(recorder("new-thread"), keyEvent({ key: ",", ctrlKey: true }));

    expect(text()).toContain("shortcutOpenSettingsLabel holds it");
    expect(mocks.setShortcutBindings).not.toHaveBeenCalled();
  });

  it("takes a key the other action has moved away from", () => {
    withBindings({ "open-settings": "mod+k" });
    act(() => recorder("new-thread").click());

    press(recorder("new-thread"), keyEvent({ key: ",", ctrlKey: true }));

    expect(mocks.setShortcutBindings).toHaveBeenCalledWith({ "open-settings": "mod+k", "new-thread": "mod+," });
  });

  it("leaves recording on Escape without writing anything", () => {
    render();
    act(() => recorder("new-thread").click());

    press(recorder("new-thread"), keyEvent({ key: "Escape" }));

    expect(mocks.setShortcutBindings).not.toHaveBeenCalled();
    expect(recorder("new-thread").textContent).toBe("Ctrl + N");
  });

  it("restores one action to its default", () => {
    withBindings({ "open-settings": "mod+shift+," });

    act(() => byLabel("reset shortcutOpenSettingsLabel").click());

    // The default is what the action falls back to once its binding is cleared.
    expect(mocks.setShortcutBindings).toHaveBeenCalledWith({ "open-settings": "mod+," });
  });

  it("restores everything at once", () => {
    withBindings({ "open-settings": "mod+shift+," });
    expect(text()).toContain("shortcutCustomized");

    act(() => resetAllButton().click());

    expect(mocks.setShortcutBindings).toHaveBeenCalledWith({});
  });
});

describe("recording and the global shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.platform = "win32";
    mocks.bindings = {};
    mocks.setShortcutBindings.mockClear();
    mocks.globalShortcuts.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <TooltipProvider>
          <Probe />
          <ShortcutSettings />
        </TooltipProvider>,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function recorder(actionId: string): HTMLButtonElement {
    return container.querySelector(`[data-shortcut-action="${actionId}"]`) as HTMLButtonElement;
  }

  it("keeps a recorded key from also running the action it is bound to", () => {
    // `Ctrl+,` is what open-settings answers to right now; pressing it while
    // recording must be captured, not dispatched, or the page would reopen.
    act(() => recorder("open-settings").click());

    act(() => {
      recorder("open-settings").dispatchEvent(keyEvent({ key: ",", ctrlKey: true }));
    });

    expect(mocks.globalShortcuts).not.toHaveBeenCalled();
    expect(mocks.setShortcutBindings).toHaveBeenCalledWith({ "open-settings": "mod+," });
  });

  it("hands the keyboard back when recording ends", () => {
    act(() => recorder("open-settings").click());
    act(() => {
      recorder("open-settings").dispatchEvent(keyEvent({ key: "Escape" }));
    });

    act(() => {
      window.dispatchEvent(keyEvent({ key: "n", ctrlKey: true }));
    });

    expect(mocks.globalShortcuts).toHaveBeenCalledWith("new-thread");
  });
});
