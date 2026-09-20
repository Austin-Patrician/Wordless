import { useRef } from "react";
import { getEffectiveShortcut, SHORTCUT_ACTIONS, type ShortcutActionId } from "@wordless/domain";
import { useDesktopHost } from "../../platform/desktop-host";
import { usePreferences } from "../preferences";
import { matchesShortcut, shortcutModifier } from "./keyboard";
import { useShortcutScope } from "./use-shortcut-scope";

/**
 * The bottom scope: the actions the application menu advertises.
 *
 * The native menu exists on macOS only — Windows and Linux draw their own menu
 * bar and `ApplicationMenuController` installs no menu at all, so the
 * accelerators in the menu template are never registered and those keys have to
 * be served from here. macOS consumes the key in the menu before the page sees
 * it, so one handler covers both platforms without acting twice.
 *
 * Which key belongs to which action comes from the shared action table plus the
 * bindings the user stored in Settings, resolved on every render so a rebind
 * takes effect without reloading. Being a scope rather than its own listener is
 * what lets a dialog or an open picker take the keyboard away.
 */
export function useGlobalShortcuts(handler: (actionId: ShortcutActionId) => void): void {
  const { hostInfo } = useDesktopHost();
  const { shortcuts } = usePreferences();
  const modifier = shortcutModifier(hostInfo?.platform ?? platformHint());

  const resolvedRef = useRef<ReadonlyArray<{ key: string; actionId: ShortcutActionId }>>([]);
  resolvedRef.current = SHORTCUT_ACTIONS.map((action) => ({
    key: getEffectiveShortcut(action.id, shortcuts.bindings),
    actionId: action.id,
  }));
  // Handlers are usually inline closures; keeping the latest one in a ref means
  // the scope registers once instead of on every render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useShortcutScope({
    id: "app:global",
    kind: "app",
    // A surface that is capturing keys — the settings page recording a binding —
    // holds the keyboard until it is done.
    enabled: () => suspensionCount === 0,
    claim: (event) => {
      const binding = resolvedRef.current.find((candidate) => matchesShortcut(event, candidate.key, modifier));
      if (!binding) return false;
      handlerRef.current(binding.actionId);
      return true;
    },
  });
}

/** Until the host answers, the navigator is the only synchronous hint. */
function platformHint(): string | undefined {
  return navigator.platform.toUpperCase().includes("MAC") ? "darwin" : undefined;
}

let suspensionCount = 0;

/**
 * Holds global shortcuts while a surface is capturing keys for its own purpose,
 * such as the settings page recording a new binding. Without this the key being
 * recorded would also run the action it is already bound to, which both
 * surprises the user and reopens whatever it points at.
 *
 * A count rather than a flag, so overlapping suspensions unwind correctly.
 */
export function suspendGlobalShortcuts(suspended: boolean): void {
  suspensionCount = Math.max(0, suspensionCount + (suspended ? 1 : -1));
}

/** Test helper: forget any suspension left behind by an unmounted surface. */
export function resetGlobalShortcutSuspensionForTests(): void {
  suspensionCount = 0;
}
