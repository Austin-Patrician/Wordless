/**
 * Keyboard scope stack.
 *
 * One listener serves every surface that answers to keys, and scopes are tried
 * from the most to the least specific: a dialog beats an open picker, which
 * beats the panel under it, which beats the global shortcuts. A scope decides
 * for itself whether a key is its own, so this module stays free of platform
 * and binding knowledge.
 */
export type ShortcutScopeKind = "app" | "surface" | "overlay" | "modal";

export interface ShortcutScopeRegistration {
  /** Stable id, for debugging and for replacing a scope in tests. */
  id: string;
  kind: ShortcutScopeKind;
  /** Keys this scope does not claim stop here instead of reaching lower scopes. */
  exclusive?: boolean;
  /** Re-checked on every key press, for scopes that depend on component state. */
  enabled?: () => boolean;
  /** Runs a matching binding and reports whether the key was its own. */
  claim: (event: KeyboardEvent) => boolean;
}

export interface ShortcutScopeHandle {
  id: string;
  dispose: () => void;
}

const KIND_RANK: Record<ShortcutScopeKind, number> = { app: 0, surface: 1, overlay: 2, modal: 3 };

interface InternalScope extends ShortcutScopeRegistration {
  sequence: number;
}

export class ShortcutScopeStack {
  private scopes: InternalScope[] = [];
  private sequence = 0;
  private listening = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.handleKeyDown(event);
  };

  /** Routes one key press. Public so tests can drive it without a real document. */
  handleKeyDown(event: KeyboardEvent): void {
    // Something earlier on the capture path already claimed the key.
    if (event.defaultPrevented) return;
    for (const scope of this.orderedScopes()) {
      if (scope.enabled && !scope.enabled()) continue;
      if (scope.claim(event)) {
        // A claimed key behaves like a menu accelerator: it is consumed here and
        // no other surface, not even the one holding the caret, gets to see it.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // An exclusive scope keeps unmatched keys from falling through to the
      // surfaces below it — without pretending to have handled them itself.
      if (scope.exclusive) return;
    }
  }

  register(registration: ShortcutScopeRegistration): ShortcutScopeHandle {
    const entry: InternalScope = { ...registration, sequence: (this.sequence += 1) };
    this.scopes.push(entry);
    this.ensureListening();
    return {
      id: registration.id,
      dispose: () => {
        this.scopes = this.scopes.filter((scope) => scope !== entry);
        if (this.scopes.length === 0) this.stopListening();
      },
    };
  }

  /** Ids of the registered scopes, most specific first. */
  debugScopes(): string[] {
    return this.orderedScopes().map((scope) => `${scope.kind}:${scope.id}`);
  }

  /** Test helper: drop every scope and the listener with them. */
  reset(): void {
    this.scopes = [];
    this.sequence = 0;
    this.stopListening();
  }

  /** More specific kind first; within a kind, the most recently registered wins. */
  private orderedScopes(): InternalScope[] {
    return this.scopes
      .slice()
      .sort((left, right) => (KIND_RANK[right.kind] - KIND_RANK[left.kind]) || (right.sequence - left.sequence));
  }

  private ensureListening(): void {
    if (this.listening || typeof window === "undefined") return;
    window.addEventListener("keydown", this.onKeyDown, true);
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening || typeof window === "undefined") return;
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.listening = false;
  }
}

let singleton: ShortcutScopeStack | null = null;

export function getShortcutScopeStack(): ShortcutScopeStack {
  if (!singleton) singleton = new ShortcutScopeStack();
  return singleton;
}

/** Test helper: replace the shared stack. */
export function setShortcutScopeStackForTests(stack: ShortcutScopeStack | null): void {
  singleton = stack;
}
