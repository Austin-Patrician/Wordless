import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShortcutActionId, ShortcutBindings } from "@wordless/domain";
import { formatShortcut, matchesShortcut, shortcutFromEvent, shortcutModifier } from "../src/renderer/shared/shortcuts/keyboard";

const mocks = vi.hoisted(() => ({
  platform: "win32" as "darwin" | "win32" | "linux",
  bindings: {} as Record<string, string>,
}));

vi.mock("../src/renderer/platform/desktop-host", () => ({
  useDesktopHost: () => ({
    hostInfo: { platform: mocks.platform },
    modifierLabel: mocks.platform === "darwin" ? "Cmd" : "Ctrl",
    subscribeHost: () => () => {},
  }),
}));

vi.mock("../src/renderer/shared/preferences", () => ({
  usePreferences: () => ({ shortcuts: { bindings: mocks.bindings as ShortcutBindings } }),
}));

import { useGlobalShortcuts } from "../src/renderer/shared/shortcuts/use-global-shortcuts";
import { useShortcutScope } from "../src/renderer/shared/shortcuts/use-shortcut-scope";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
}

function Probe({ onAction }: { onAction: (actionId: ShortcutActionId) => void }) {
  useGlobalShortcuts(onAction);
  return (
    <div>
      <input aria-label="field" />
    </div>
  );
}

/** Stands in for a modal surface such as the settings dialog. */
function ModalSurface({ open }: { open: boolean }) {
  useShortcutScope({ active: open, claim: () => false, exclusive: true, id: "modal", kind: "modal" });
  return null;
}

describe("key event serialization", () => {
  it("spells the platform command key mod, the way the menu accelerators do", () => {
    expect(shortcutFromEvent(keyEvent({ key: ",", ctrlKey: true }), "control")).toBe("mod+,");
    expect(shortcutFromEvent(keyEvent({ key: ",", metaKey: true }), "meta")).toBe("mod+,");
  });

  it("keeps Control apart from Command on macOS so Ctrl+N never reads as mod+n", () => {
    expect(shortcutFromEvent(keyEvent({ key: "n", ctrlKey: true }), "meta")).toBe("ctrl+n");
    expect(matchesShortcut(keyEvent({ key: "n", ctrlKey: true }), "mod+n", "meta")).toBe(false);
  });

  it("writes modifiers in the order the stored bindings use", () => {
    // The domain normalizer writes "mod+ctrl+shift+alt+key"; a decoded key must
    // come out in the same order or a stored binding would never match.
    expect(shortcutFromEvent(keyEvent({ key: "N", ctrlKey: true, shiftKey: true }), "control")).toBe("mod+shift+n");
    expect(shortcutFromEvent(keyEvent({ key: "N", ctrlKey: true, altKey: true }), "control")).toBe("mod+alt+n");
    expect(shortcutFromEvent(keyEvent({ key: " ", ctrlKey: true }), "control")).toBe("mod+space");
  });

  it("ignores input-method composition and bare modifier presses", () => {
    expect(shortcutFromEvent(keyEvent({ key: ",", ctrlKey: true, isComposing: true }), "control")).toBeNull();
    expect(shortcutFromEvent(keyEvent({ key: "Shift", shiftKey: true }), "control")).toBeNull();
  });

  it("writes a combo the way each platform writes it", () => {
    // Windows and Linux separate the words; macOS glues glyphs in Apple's order
    // (Control, Option, Shift, Command) exactly as its own menus do.
    expect(formatShortcut("mod+n", "control")).toBe("Ctrl + N");
    expect(formatShortcut("mod+shift+,", "control")).toBe("Ctrl + Shift + ,");
    // Modifiers are shown in the platform's order, not the order they were stored in.
    expect(formatShortcut("shift+mod+n", "control")).toBe("Ctrl + Shift + N");
    expect(formatShortcut("mod+n", "meta")).toBe("⌘N");
    expect(formatShortcut("mod+shift+,", "meta")).toBe("⇧⌘,");
    expect(formatShortcut("shift+mod+n", "meta")).toBe("⇧⌘N");
    expect(formatShortcut("mod+space", "meta")).toBe("⌘Space");
    expect(formatShortcut("mod+arrowleft", "meta")).toBe("⌘←");
    expect(formatShortcut("mod+backspace", "meta")).toBe("⌘⌫");
  });

  it("resolves the command key from the host platform", () => {
    expect(shortcutModifier("darwin")).toBe("meta");
    expect(shortcutModifier("win32")).toBe("control");
    expect(shortcutModifier("linux")).toBe("control");
    expect(shortcutModifier(undefined)).toBe("control");
  });
});

describe("global shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.platform = "win32";
    mocks.bindings = {};
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** Mounts the hook and returns the field the caret would sit in. */
  function render(handler: (actionId: ShortcutActionId) => void): HTMLInputElement {
    act(() => root.render(<Probe onAction={handler} />));
    const field = container.querySelector("input");
    if (!field) throw new Error("probe input missing");
    return field;
  }

  function press(target: EventTarget, event: KeyboardEvent): KeyboardEvent {
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("runs the action bound to a chord, even with the caret in a field", () => {
    const actions: ShortcutActionId[] = [];
    const field = render((actionId) => actions.push(actionId));

    press(field, keyEvent({ key: ",", ctrlKey: true }));
    press(field, keyEvent({ key: "n", ctrlKey: true }));

    expect(actions).toEqual(["open-settings", "new-thread"]);
  });

  it("claims the key: nothing else sees it and no default action survives", () => {
    render(() => {});
    const field = container.querySelector("input") as HTMLInputElement;
    const bubbleListener = vi.fn();
    document.addEventListener("keydown", bubbleListener);

    const event = press(field, keyEvent({ key: ",", ctrlKey: true }));

    document.removeEventListener("keydown", bubbleListener);
    expect(event.defaultPrevented).toBe(true);
    expect(bubbleListener).not.toHaveBeenCalled();
  });

  it("follows the host platform for which key is the command key", () => {
    const actions: ShortcutActionId[] = [];
    const field = render((actionId) => actions.push(actionId));

    press(field, keyEvent({ key: ",", metaKey: true }));
    expect(actions).toEqual([]);

    mocks.platform = "darwin";
    const macField = render((actionId) => actions.push(actionId));
    press(macField, keyEvent({ key: ",", metaKey: true }));
    press(macField, keyEvent({ key: ",", ctrlKey: true }));

    expect(actions).toEqual(["open-settings"]);
  });

  it("leaves unbound keys to the surface underneath", () => {
    const actions: ShortcutActionId[] = [];
    const field = render((actionId) => actions.push(actionId));

    press(field, keyEvent({ key: "q", ctrlKey: true }));
    press(field, keyEvent({ key: "a" }));
    press(field, keyEvent({ key: "n", metaKey: true }));

    expect(actions).toEqual([]);
  });

  it("ignores a key another handler already consumed", () => {
    const actions: ShortcutActionId[] = [];
    const field = render((actionId) => actions.push(actionId));
    const consumed = keyEvent({ key: ",", ctrlKey: true });
    consumed.preventDefault();

    press(field, consumed);

    expect(actions).toEqual([]);
  });

  it("always calls the latest handler without re-registering", () => {
    const first = vi.fn();
    const second = vi.fn();
    const field = render(first);

    press(field, keyEvent({ key: ",", ctrlKey: true }));
    const rerendered = render(second);
    press(rerendered, keyEvent({ key: ",", ctrlKey: true }));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith("open-settings");
  });

  it("stops listening once the shell is gone", () => {
    const actions: ShortcutActionId[] = [];
    render((actionId) => actions.push(actionId));

    act(() => root.unmount());

    press(document.body, keyEvent({ key: ",", ctrlKey: true }));
    expect(actions).toEqual([]);
    root = createRoot(container);
  });

  it("moves an action to the key the user stored, releasing the default", () => {
    const actions: ShortcutActionId[] = [];
    mocks.bindings = { "open-settings": "mod+shift+," };
    const field = render((actionId) => actions.push(actionId));

    // The default has to be free again, or a rebound action would answer to two
    // keys; asked first so the two presses cannot be confused for one another.
    press(field, keyEvent({ key: ",", ctrlKey: true }));
    expect(actions).toEqual([]);

    press(field, keyEvent({ key: ",", ctrlKey: true, shiftKey: true }));
    expect(actions).toEqual(["open-settings"]);
  });

  it("gives the keyboard to an open modal surface", () => {
    const actions: ShortcutActionId[] = [];
    act(() =>
      root.render(
        <>
          <Probe onAction={(actionId) => actions.push(actionId)} />
          <ModalSurface open />
        </>,
      ),
    );
    const field = container.querySelector("input") as HTMLInputElement;

    press(field, keyEvent({ key: "n", ctrlKey: true }));
    expect(actions).toEqual([]);

    // Closing it hands the keys back.
    act(() =>
      root.render(
        <>
          <Probe onAction={(actionId) => actions.push(actionId)} />
          <ModalSurface open={false} />
        </>,
      ),
    );
    press(container.querySelector("input") as HTMLInputElement, keyEvent({ key: "n", ctrlKey: true }));
    expect(actions).toEqual(["new-thread"]);
  });

  it("keeps the other actions on their own keys while one is rebound", () => {
    const actions: ShortcutActionId[] = [];
    mocks.bindings = { "open-settings": "mod+alt+p" };
    const field = render((actionId) => actions.push(actionId));

    press(field, keyEvent({ key: "p", ctrlKey: true, altKey: true }));
    press(field, keyEvent({ key: "n", ctrlKey: true }));

    expect(actions).toEqual(["open-settings", "new-thread"]);
  });

  it("resolves a hand-made duplicate by table order", () => {
    // The settings page refuses to create one, but an edited database can still
    // hold a key claimed twice. The table decides, so the outcome is stable
    // rather than dependent on property order.
    const actions: ShortcutActionId[] = [];
    mocks.bindings = { "open-settings": "mod+j" };
    const field = render((actionId) => actions.push(actionId));

    press(field, keyEvent({ key: "j", ctrlKey: true }));

    expect(actions).toEqual(["toggle-context-panel"]);
  });
});
