import type { ActDenial } from "./action-policy.js";
import type { AxNode, SnapshotRef, SnapshotResult } from "./snapshot.js";

/**
 * The contract the browser capability is written against.
 *
 * Declared here rather than imported from the desktop app because a capability
 * must not know about Electron windows or renderer state — the app implements
 * this port, the capability only consumes it. That is also what keeps these
 * tools usable from a second host later without rewriting them.
 */
export type BrowserPort = {
  /** Tabs the user has explicitly shared with the agent. Empty means nothing is readable. */
  listSharedTabs(): Promise<BrowserTabSummary[]>;
  /**
   * A built snapshot of the shared tab, or null when there is nothing readable.
   * `tabId` defaults to the active tab.
   *
   * The snapshot arrives built rather than as raw nodes because the host has to
   * keep the handles it handed out: recovering a stale `@eN` means matching the
   * old handle's role, name and rank against the new tree, and only the host knows
   * which snapshot the agent is actually acting from.
   */
  readSnapshot(tabId?: string): Promise<{ tab: BrowserTabSummary; snapshot: BrowserSnapshotSummary } | null>;
  /** Null when nothing is shared, mirroring `readTree` so every tool fails the same way. */
  readConsole(tabId?: string, options?: { sinceId?: number; limit?: number }): Promise<BrowserConsolePage | null>;
  /**
   * PNG bytes as base64, or null when capture is unavailable. Returned without a
   * `data:` prefix because that is the shape the model expects.
   */
  captureScreenshot(tabId?: string): Promise<{ data: string; mimeType: string; tab: BrowserTabSummary } | null>;
  /**
   * Performs an action on a shared tab.
   *
   * Every refusal comes back as a typed failure rather than a thrown error, so the
   * agent can tell a permission problem (ask the user) from a capability limit
   * (stop trying) from a stale handle (read again).
   */
  act(tabId: string | undefined, request: BrowserActRequest): Promise<BrowserActOutcome>;
};

export type BrowserTabSummary = {
  id: string;
  url: string;
  title: string;
  /** True while the page is still loading, which usually means "read again shortly". */
  loading: boolean;
  /** Set when the last load failed, so the agent can report the cause instead of guessing. */
  loadError: { description: string; url: string } | null;
};

export type BrowserConsoleLevel = "error" | "warning" | "info" | "log";

export type BrowserConsoleEntry = {
  id: number;
  level: BrowserConsoleLevel;
  text: string;
  source: string | null;
  line: number | null;
};

export type BrowserConsolePage = {
  tab: BrowserTabSummary;
  entries: BrowserConsoleEntry[];
  /** Entries dropped since `sinceId`, so the agent knows the view is partial. */
  dropped: number;
  errorCount: number;
};

export type { AxNode, SnapshotRef, SnapshotResult };

/**
 * An action on a page.
 *
 * Targets are always `@eN` handles from a snapshot the agent has read, never CSS
 * selectors or coordinates. A handle is resolved against the accessibility tree,
 * so it survives a stylesheet change — a Tailwind or CSS-module class list is
 * rebuilt on every deploy and a selector written against it breaks immediately.
 */
export type BrowserActRequest =
  | { kind: "click"; ref: string; button?: "left" | "right" | "middle"; clickCount?: number }
  | { kind: "type"; ref: string; text: string; clear?: boolean; submit?: boolean }
  | { kind: "press"; key: string }
  | { kind: "hover"; ref: string };

export type BrowserSnapshotSummary = {
  url: string;
  title: string;
  text: string;
  refs: SnapshotRef[];
  truncated: boolean;
  /** True when the page had not settled yet, so `text` may be mid-flight. */
  settling: boolean;
};

export type BrowserActFailure =
  // The policy's own refusals, referenced rather than restated so the two cannot
  // drift apart as codes are added.
  | ActDenial
  /** The handle is not in the snapshot the agent read. */
  | { code: "ref_unknown"; message: string; snapshot: BrowserSnapshotSummary }
  /** The element left the page since that snapshot. */
  | { code: "ref_missing"; message: string; snapshot: BrowserSnapshotSummary }
  /** Several elements match the handle's description; acting would be a guess. */
  | { code: "ref_ambiguous"; message: string; candidates: string[]; snapshot: BrowserSnapshotSummary };

export type BrowserActOutcome =
  | {
      ok: true;
      /** What was acted on, and the handle it now has if the page renumbered. */
      target: { ref: string; role: string; name: string };
      healedFrom?: string;
      settled: boolean;
      /** False when the page did not change, in which case `snapshot` is omitted. */
      changed: boolean;
      snapshot: BrowserSnapshotSummary | null;
    }
  | { ok: false; failure: BrowserActFailure };
