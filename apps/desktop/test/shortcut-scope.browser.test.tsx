import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutScopeStack } from "../src/renderer/shared/shortcuts/scope-stack";
import { useShortcutScope } from "../src/renderer/shared/shortcuts/use-shortcut-scope";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, composed: true, ...init });
}

describe("shortcut scope stack", () => {
  let stack: ShortcutScopeStack;

  beforeEach(() => {
    stack = new ShortcutScopeStack();
  });

  afterEach(() => {
    stack.reset();
  });

  it("gives the keyboard to the most specific scope", () => {
    const app = vi.fn(() => true);
    const modal = vi.fn(() => true);
    stack.register({ claim: app, id: "app", kind: "app" });
    stack.register({ claim: modal, id: "dialog", kind: "modal" });

    const event = keyEvent({ key: "n", ctrlKey: true });
    stack.handleKeyDown(event);

    expect(modal).toHaveBeenCalledTimes(1);
    expect(app).not.toHaveBeenCalled();
    // A claimed key is consumed like a menu accelerator.
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets the later registration win within one kind", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    stack.register({ claim: first, id: "first", kind: "surface" });
    stack.register({ claim: second, id: "second", kind: "surface" });

    stack.handleKeyDown(keyEvent({ key: "n", ctrlKey: true }));

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("lets an exclusive scope hold a key without pretending to handle it", () => {
    const app = vi.fn(() => true);
    stack.register({ claim: app, id: "app", kind: "app" });
    stack.register({ claim: () => false, exclusive: true, id: "dialog", kind: "modal" });

    const event = keyEvent({ key: "n", ctrlKey: true });
    stack.handleKeyDown(event);

    expect(app).not.toHaveBeenCalled();
    // It was not handled, so the key is left untouched for the focused field.
    expect(event.defaultPrevented).toBe(false);
  });

  it("falls through when a scope is not enabled", () => {
    const app = vi.fn(() => true);
    stack.register({ claim: app, id: "app", kind: "app" });
    stack.register({ claim: () => false, enabled: () => false, exclusive: true, id: "dialog", kind: "modal" });

    stack.handleKeyDown(keyEvent({ key: "n", ctrlKey: true }));

    expect(app).toHaveBeenCalledTimes(1);
  });

  it("stops answering once a scope is disposed", () => {
    const app = vi.fn(() => true);
    const handle = stack.register({ claim: app, id: "app", kind: "app" });

    handle.dispose();
    stack.handleKeyDown(keyEvent({ key: "n", ctrlKey: true }));

    expect(app).not.toHaveBeenCalled();
  });

  it("ignores a key another handler already consumed", () => {
    const app = vi.fn(() => true);
    stack.register({ claim: app, id: "app", kind: "app" });
    const consumed = keyEvent({ key: "n", ctrlKey: true });
    consumed.preventDefault();

    stack.handleKeyDown(consumed);

    expect(app).not.toHaveBeenCalled();
  });

  it("reports the scopes it is holding, most specific first", () => {
    stack.register({ claim: () => false, id: "app", kind: "app" });
    stack.register({ claim: () => false, id: "picker", kind: "overlay" });

    expect(stack.debugScopes()).toEqual(["overlay:picker", "app:app"]);
  });
});

describe("useShortcutScope", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function Probe({ active, claim }: { active: boolean; claim: (event: KeyboardEvent) => boolean }) {
    useShortcutScope({ active, claim, id: "probe", kind: "modal" });
    return null;
  }

  it("answers keys while mounted and stops when unmounted", () => {
    const claim = vi.fn(() => true);
    act(() =>
      root.render(
        <Probe
          active
          claim={claim}
        />,
      ),
    );

    act(() => {
      window.dispatchEvent(keyEvent({ key: "j", ctrlKey: true }));
    });
    expect(claim).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    act(() => {
      window.dispatchEvent(keyEvent({ key: "j", ctrlKey: true }));
    });
    expect(claim).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("registers nothing while inactive", () => {
    const claim = vi.fn(() => true);
    act(() =>
      root.render(
        <Probe
          active={false}
          claim={claim}
        />,
      ),
    );

    act(() => {
      window.dispatchEvent(keyEvent({ key: "j", ctrlKey: true }));
    });

    expect(claim).not.toHaveBeenCalled();
  });
});
