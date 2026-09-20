import type {
  BrowserLoadError,
  BrowserNavigateResult,
  BrowserNavigationAction,
  BrowserPanelState,
  BrowserSessionScope,
  BrowserTabState,
  BrowserViewBounds,
} from "@wordless/protocol";
import { normalizeBounds, resolveVisibility, sameBounds } from "./browser-bounds";
import type { BrowserHost } from "./browser-host";
import { displayTabTitle, MAX_BROWSER_TABS, nextActiveTabId, shouldOpenInPanel, tabToEvict } from "./browser-tabs";
import {
  appendConsoleEntry,
  buildSnapshot,
  consoleEntriesSince,
  describeRefs,
  evaluateActRequest,
  findRef,
  isActionableUrl,
  isLoopbackUrl,
  originOf,
  healRef,
  levelFromSeverity,
  DEFAULT_MAX_SNAPSHOT_LINES,
  type AxNode,
  type BrowserActOutcome,
  type BrowserActRequest,
  type BrowserConsoleEntry,
  type BrowserConsolePage,
  type BrowserSnapshotSummary,
  type BrowserTabSummary,
  type SnapshotRef,
} from "@wordless/capability-browser";
import { capturePagePng, withCdp } from "./browser-cdp";
import { PAGE_SCROLLBAR_CSS } from "./browser-page-style";
import { normalizeNavigationInput } from "./browser-url";

export type BrowserServiceOptions = {
  host: BrowserHost;
  /** Called whenever the observable state changes, so the host can push it to the renderer. */
  onChange?: (state: BrowserPanelState) => void;
  /** Storage scope for the initial strip. */
  sessionScope?: BrowserSessionScope;
};

type TabRecord = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  crashed: boolean;
  loadError: BrowserLoadError | null;
  /** Whether this tab's guest has ever committed a navigation. */
  committed: boolean;
};

/** Electron fixes a session at view creation, so scope maps to a partition. */
function partitionFor(scope: BrowserSessionScope): string {
  // The `persist:` prefix is what makes the partition survive a restart.
  return scope === "persistent" ? "persist:wordless-browser" : "wordless-browser";
}

/**
 * Owns the embedded browser's tabs and exposes an observable state snapshot.
 *
 * The renderer drives layout, tab selection and navigation intent; the pages
 * themselves live here, in the main process, where the native views do. Only one
 * tab is ever mounted at a time — the others keep running (so a logged-in page
 * stays logged in) but are detached so they cost no compositing work.
 */
export class BrowserService {
  private readonly host: BrowserHost;
  private readonly onChange: ((state: BrowserPanelState) => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly tabs = new Map<string, TabRecord>();
  private activeTabId: string | null = null;
  private sessionScope: BrowserSessionScope;
  private panelVisible = false;
  private panelBounds: BrowserViewBounds | null = null;
  private detachedByOcclusion = false;
  /**
   * Grants are keyed by session, while tabs are global.
   *
   * The split is deliberate and reflects what each thing is. A tab is a page the
   * user is looking at, and treating it like a browser — one set of tabs that
   * survives moving between sessions — matches how people expect a browser to
   * behave. A grant is a decision the user made while working on one task, so it
   * belongs to that task: handing it to another session's agent would act on
   * consent the user gave in a different context.
   */
  private readonly sharedTabsBySession = new Map<string, Set<string>>();
  /** Which session the panel is currently showing, for the per-session flags in `getState`. */
  private panelSessionId: string | null = null;
  private readonly consoleEntries = new Map<string, BrowserConsoleEntry[]>();
  private readonly nextConsoleId = new Map<string, number>();
  /**
   * The snapshot each tab's handles came from.
   *
   * Held because a handle is only meaningful against the tree that produced it:
   * recovering a stale one means matching its role, name and rank against a newer
   * tree, which needs both the old identity and the new tree.
   */
  private readonly lastSnapshots = new Map<string, { refs: SnapshotRef[]; text: string }>();
  /**
   * Origins each session approved for actions.
   *
   * Per origin rather than per tab, so wandering away and back does not cost the
   * user another approval, and per session because the approval was given in a
   * particular task's context. Never persisted: an approval is a decision, not a
   * preference.
   */
  private readonly allowedOriginsBySession = new Map<string, Set<string>>();
  /** Action timestamps per session, for the runaway guard. */
  private readonly actionHistoryBySession = new Map<string, number[]>();
  private disposed = false;
  private nextTabNumber = 1;

  constructor(options: BrowserServiceOptions) {
    this.host = options.host;
    this.onChange = options.onChange;
    this.sessionScope = options.sessionScope ?? "ephemeral";
  }

  // ---------------------------------------------------------------- panel level

  getState(): BrowserPanelState {
    return {
      tabs: [...this.tabs.values()].map((tab) => this.tabState(tab)),
      activeTabId: this.activeTabId,
      sessionScope: this.sessionScope,
      attached: this.activeTabId !== null && this.host.isAttached(this.activeTabId),
      tabLimit: MAX_BROWSER_TABS,
    };
  }

  /** Shows the active tab's view, creating the strip if it is empty. */
  async show(): Promise<BrowserPanelState> {
    if (this.disposed) return this.getState();
    if (this.tabs.size === 0) await this.createTabInternal();
    this.panelVisible = true;
    this.detachedByOcclusion = false;
    return this.publish();
  }

  /**
   * Occlusion response: removes the active view from the window so overlapping
   * app UI is reachable, without discarding any page.
   */
  hide(): void {
    this.detachedByOcclusion = true;
    this.panelVisible = false;
    this.publish();
  }

  /**
   * The renderer reports its placeholder rect. A collapsing panel drives this
   * through zero width mid-animation, so geometry gates visibility rather than
   * deciding it.
   */
  setBounds(rect: BrowserViewBounds): void {
    const next = normalizeBounds(rect);
    const previous = this.panelBounds;
    this.panelBounds = next;
    // Geometry arrives on every animation frame while the panel is dragged or
    // the window resizes. Publishing unconditionally here would cost an IPC round
    // trip plus a full panel re-render per frame, and `getState` itself asks each
    // tab for its navigation history — a hop into that tab's renderer process. An
    // unchanged rect must cost nothing.
    if (previous && sameBounds(previous, next)) return;
    this.publish();
  }

  /**
   * Sets the storage scope used by tabs opened from now on.
   *
   * An Electron session is fixed when its web contents is created, so existing
   * tabs keep the partition they were built on. Rebuilding the strip would have
   * been the tidy alternative, but it silently discards whatever the user has
   * open, which is a worse trade than a strip whose tabs differ in scope.
   */
  async setSessionScope(scope: BrowserSessionScope): Promise<BrowserPanelState> {
    this.sessionScope = scope;
    return this.publish();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.destroyAllTabs();
  }

  get isHiddenForOcclusion(): boolean {
    return this.detachedByOcclusion;
  }

  // ------------------------------------------------------------------ tab level

  async createTab(url?: string): Promise<BrowserPanelState> {
    await this.createTabInternal(url);
    return this.publish();
  }

  async closeTab(tabId: string): Promise<BrowserPanelState> {
    if (!this.tabs.has(tabId)) return this.getState();
    const order = [...this.tabs.keys()];
    this.host.destroy(tabId);
    this.tabs.delete(tabId);
    // Every session's grant on this tab goes with it, along with the console
    // history: a reused id must not inherit the previous page's access.
    for (const tabs of this.sharedTabsBySession.values()) tabs.delete(tabId);
    this.consoleEntries.delete(tabId);
    this.nextConsoleId.delete(tabId);
    this.lastSnapshots.delete(tabId);
    this.activeTabId = nextActiveTabId(order, tabId, this.activeTabId);
    return this.publish();
  }

  async selectTab(tabId: string): Promise<BrowserPanelState> {
    if (!this.tabs.has(tabId) || tabId === this.activeTabId) return this.getState();
    this.activeTabId = tabId;
    // A tab whose renderer died has no guest until it is used again.
    if (!this.host.getWebContents(tabId)) await this.ensureGuest(tabId);
    return this.publish();
  }

  async navigate(action: BrowserNavigationAction, url?: string): Promise<BrowserNavigateResult> {
    const tab = this.activeTab();
    if (!tab) return { state: this.getState(), accepted: false };
    await this.ensureGuest(tab.id);
    const webContents = this.host.getWebContents(tab.id);
    if (!webContents) return { state: this.getState(), accepted: false };

    switch (action) {
      case "back":
        if (webContents.navigationHistory.canGoBack()) webContents.navigationHistory.goBack();
        break;
      case "forward":
        if (webContents.navigationHistory.canGoForward()) webContents.navigationHistory.goForward();
        break;
      case "reload": {
        // A rebuilt tab has no committed navigation to reload, so replay its
        // last address instead. Without this the retry button would do nothing.
        const target = tab.committed ? null : normalizeNavigationInput(tab.url);
        if (target) await this.load(tab, webContents, target);
        else webContents.reload();
        break;
      }
      case "url": {
        if (!url) break;
        // Scheme filtering lives here so no caller can bypass it. A refused
        // address is reported as `accepted: false` rather than inferred from an
        // unchanged url, because a failed connection looks identical that way.
        const target = normalizeNavigationInput(url);
        if (!target) return { state: this.publish(), accepted: false };
        await this.load(tab, webContents, target);
        break;
      }
    }
    return { state: this.publish(), accepted: true };
  }

  // ---------------------------------------------------------- agent access

  /**
   * Resolves the tab an agent may read: the one it named, or the active tab, and
   * only when the user has shared it. Returning null rather than falling back to
   * "whatever is open" is the entire point of the gate.
   */
  resolveSharedTab(tabId: string | undefined, sessionId: string): TabRecord | null {
    const id = tabId ?? this.activeTabId;
    if (!id || !this.isSharedWith(id, sessionId)) return null;
    return this.tabs.get(id) ?? null;
  }

  listSharedTabs(sessionId: string): BrowserTabSummary[] {
    return [...(this.sharedTabsBySession.get(sessionId) ?? [])].flatMap((id) => {
      const tab = this.tabs.get(id);
      return tab ? [this.toSummary(tab)] : [];
    });
  }

  /** Tells the service which session's grants the panel should reflect. */
  setPanelSession(sessionId: string | null): BrowserPanelState {
    this.panelSessionId = sessionId;
    return this.publish();
  }

  /**
   * Drops a session's grants.
   *
   * Called when a session is deleted. Without it a deleted session's approvals
   * would sit in memory with nothing to revoke them, and an id reused later would
   * inherit access nobody granted.
   */
  releaseSession(sessionId: string): void {
    this.sharedTabsBySession.delete(sessionId);
    this.allowedOriginsBySession.delete(sessionId);
    this.actionHistoryBySession.delete(sessionId);
    if (this.panelSessionId === sessionId) this.panelSessionId = null;
  }

  private isSharedWith(tabId: string, sessionId: string | null): boolean {
    if (!sessionId) return false;
    return this.sharedTabsBySession.get(sessionId)?.has(tabId) ?? false;
  }

  private isActionable(url: string, sessionId: string | null): boolean {
    if (!sessionId) return false;
    return isActionableUrl(url, [...(this.allowedOriginsBySession.get(sessionId) ?? [])]);
  }

  /**
   * Grants or revokes actions for the tab's current origin.
   *
   * Approving rather than toggling a per-tab flag: the permission belongs to the
   * site, and the gate re-reads the page's origin every time, so a navigation
   * cannot carry the grant somewhere the user never approved.
   */
  async setActionsAllowed(tabId: string, allowed: boolean): Promise<BrowserPanelState> {
    const sessionId = this.panelSessionId;
    if (!sessionId) return this.publish();
    const tab = this.tabs.get(tabId);
    const origin = tab ? originOf(tab.url) : null;
    // Loopback needs no grant, so recording one would only be confusing.
    if (origin && tab && !isLoopbackUrl(tab.url)) {
      const origins = this.allowedOriginsBySession.get(sessionId) ?? new Set<string>();
      if (allowed) origins.add(origin);
      else origins.delete(origin);
      this.allowedOriginsBySession.set(sessionId, origins);
    }
    return this.publish();
  }

  async setShared(tabId: string, shared: boolean): Promise<BrowserPanelState> {
    const sessionId = this.panelSessionId;
    if (!sessionId) return this.publish();
    const tabs = this.sharedTabsBySession.get(sessionId) ?? new Set<string>();
    if (shared) tabs.add(tabId);
    else tabs.delete(tabId);
    this.sharedTabsBySession.set(sessionId, tabs);
    return this.publish();
  }

  /** Roughly a tree walk over CDP; null when the tab has no live page. */
  async readAccessibilityTree(tabId: string): Promise<AxNode[] | null> {
    const webContents = this.host.getWebContents(tabId);
    if (!webContents) return null;
    try {
      return await withCdp(webContents, async (send) => {
        await send("Accessibility.enable");
        const result = (await send("Accessibility.getFullAXTree")) as { nodes?: AxNode[] };
        return result.nodes ?? [];
      });
    } catch {
      // A page whose debugger is unavailable is unreadable, not fatal: report no
      // content rather than failing the agent's whole step.
      return null;
    }
  }

  readConsoleBuffer(tabId: string, options: { sinceId?: number; limit?: number }): BrowserConsolePage {
    const tab = this.tabs.get(tabId);
    const entries = this.consoleEntries.get(tabId) ?? [];
    const page = consoleEntriesSince(entries, options);
    return {
      tab: tab ? this.toSummary(tab) : { id: tabId, url: "", title: "", loading: false, loadError: null },
      entries: page.entries,
      dropped: page.dropped,
      errorCount: page.errorCount,
    };
  }

  async captureScreenshot(tabId: string): Promise<{ data: string; mimeType: string } | null> {
    const webContents = this.host.getWebContents(tabId);
    if (!webContents) return null;
    return await capturePagePng(webContents);
  }

  /**
   * Builds a snapshot and remembers the handles it handed out.
   *
   * Storing them here rather than in the capability is what makes recovery
   * possible: the host is the only party that knows which tree the agent's
   * handles came from.
   */
  async readSnapshot(tabId: string): Promise<BrowserSnapshotSummary | null> {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    const nodes = (await this.readAccessibilityTree(tabId)) ?? [];
    const built = buildSnapshot(nodes, { maxLines: DEFAULT_MAX_SNAPSHOT_LINES });
    this.lastSnapshots.set(tabId, { refs: built.refs, text: built.text });
    return {
      url: tab.url,
      title: tab.title,
      text: built.text,
      refs: built.refs,
      truncated: built.truncated,
      settling: tab.loading,
    };
  }

  /**
   * Performs one action, refusing anything the policy does not allow.
   *
   * A stale handle is retried once against a fresh tree, resolved by what it
   * described rather than by its number. Without that, a page that re-renders
   * after every interaction leaves the agent in a click-fail-resnapshot loop on a
   * page that is otherwise working.
   */
  async act(tabId: string | undefined, sessionId: string, request: BrowserActRequest): Promise<BrowserActOutcome> {
    const tab = this.resolveSharedTab(tabId, sessionId);
    if (!tab) {
      return { ok: false, failure: { code: "not_shared", message: "The user has not shared this tab with you." } };
    }
    const gate = evaluateActRequest({
      shared: true,
      url: tab.url,
      allowedOrigins: [...(this.allowedOriginsBySession.get(sessionId) ?? [])],
      history: this.actionHistoryBySession.get(sessionId) ?? [],
      now: Date.now(),
    });
    if (!gate.allowed) return { ok: false, failure: gate.denial };

    const webContents = this.host.getWebContents(tab.id);
    const before = this.lastSnapshots.get(tab.id)?.text ?? "";
    if (!webContents) {
      return { ok: false, failure: { code: "ref_unknown", message: "The page is gone; open it again.", snapshot: await this.freshSnapshot(tab.id) } };
    }

    // Pressing a key needs no target.
    if (request.kind === "press") {
      await this.sendKey(webContents, request.key);
      return await this.finishAction(
        tab.id,
        webContents,
        { ref: "-", role: "key", name: request.key },
        undefined,
        before,
        gate.history,
        sessionId,
      );
    }

    const handle = findRef(this.lastSnapshots.get(tab.id)?.refs ?? [], request.ref);
    if (!handle) {
      return {
        ok: false,
        failure: {
          code: "ref_unknown",
          message: `${request.ref} is not in the snapshot you read. Read the page again with browser_snapshot.`,
          snapshot: await this.freshSnapshot(tab.id),
        },
      };
    }

    let target = handle;
    let healedFrom: string | undefined;
    let box = await this.contentCenter(webContents, handle);
    if (!box) {
      const fresh = await this.readSnapshot(tab.id);
      const healing = healRef(fresh?.refs ?? [], { role: handle.role, name: handle.name, ordinal: handle.ordinal }, request.ref);
      if (healing.kind === "ambiguous") {
        return {
          ok: false,
          failure: {
            code: "ref_ambiguous",
            message: `${request.ref} no longer exists and several elements now match "${handle.name}".`,
            candidates: describeRefs(healing.candidates),
            snapshot: fresh ?? (await this.freshSnapshot(tab.id)),
          },
        };
      }
      if (healing.kind !== "exact" && healing.kind !== "healed") {
        return {
          ok: false,
          failure: {
            code: "ref_missing",
            message: `${request.ref} (${handle.role} "${handle.name}") is no longer on the page.`,
            snapshot: fresh ?? (await this.freshSnapshot(tab.id)),
          },
        };
      }
      target = healing.ref;
      if (healing.kind === "healed") healedFrom = request.ref;
      box = await this.contentCenter(webContents, target);
      if (!box) {
        return {
          ok: false,
          failure: {
            code: "ref_missing",
            message: `${request.ref} is on the page but has no visible box, so it cannot be acted on.`,
            snapshot: fresh ?? (await this.freshSnapshot(tab.id)),
          },
        };
      }
    }

    if (request.kind === "click") {
      const button = request.button ?? "left";
      const clickCount = request.clickCount ?? 1;
      await this.sendMouse(webContents, "mouseMoved", box.x, box.y, button, 0);
      await this.sendMouse(webContents, "mousePressed", box.x, box.y, button, clickCount);
      await this.sendMouse(webContents, "mouseReleased", box.x, box.y, button, clickCount);
    } else if (request.kind === "hover") {
      await this.sendMouse(webContents, "mouseMoved", box.x, box.y, "left", 0);
    } else if (request.kind === "type") {
      await withCdp(webContents, async (send) => {
        await send("DOM.focus", { backendNodeId: target.backendDOMNodeId });
      });
      if (request.clear) await this.clearFocused(webContents);
      await withCdp(webContents, async (send) => {
        await send("Input.insertText", { text: request.text });
      });
      if (request.submit) await this.sendKey(webContents, "Enter");
    }

    return await this.finishAction(
      tab.id,
      webContents,
      { ref: target.ref, role: target.role, name: target.name },
      healedFrom,
      before,
      gate.history,
      sessionId,
    );
  }

  /** Records the action, waits for the page to settle, and reports what changed. */
  private async finishAction(
    tabId: string,
    webContents: Electron.WebContents,
    target: { ref: string; role: string; name: string },
    healedFrom: string | undefined,
    before: string,
    history: readonly number[],
    sessionId: string,
  ): Promise<BrowserActOutcome> {
    this.actionHistoryBySession.set(sessionId, [...history, Date.now()]);
    const settled = await this.settle(webContents);
    const after = await this.readSnapshot(tabId);
    const changed = after !== null && after.text !== before;
    return {
      ok: true,
      target,
      ...(healedFrom ? { healedFrom } : {}),
      settled,
      changed,
      // Only the changed case carries a tree; repeating an identical one would
      // spend the agent's context on nothing.
      snapshot: changed ? after : null,
    };
  }

  private async freshSnapshot(tabId: string): Promise<BrowserSnapshotSummary> {
    return (await this.readSnapshot(tabId)) ?? { url: "", title: "", text: "", refs: [], truncated: false, settling: false };
  }

  /**
   * Waits for the page to stop loading and stay stopped.
   *
   * Bounded, and a timeout is not a failure: long-polling pages never go idle, so
   * the caller reports "not settled" and the agent decides whether to read again.
   */
  private async settle(webContents: Electron.WebContents, timeoutMs = 5_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (webContents.isLoading()) {
        await delay(50);
        continue;
      }
      // A short quiet beat, so a page that navigates immediately after load is
      // not reported as settled mid-flight.
      await delay(120);
      if (!webContents.isLoading()) return true;
    }
    return false;
  }

  private async contentCenter(
    webContents: Electron.WebContents,
    handle: SnapshotRef,
  ): Promise<{ x: number; y: number } | null> {
    if (handle.backendDOMNodeId === null) return null;
    try {
      return await withCdp(webContents, async (send) => {
        const result = (await send("DOM.getBoxModel", { backendNodeId: handle.backendDOMNodeId })) as {
          model?: { content?: number[] };
        };
        const quad = result.model?.content;
        if (!quad || quad.length < 8) return null;
        // The content quad is four corners; their centroid is a point inside the
        // element regardless of rotation or scrolling.
        const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
        const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
        return { x: xs.reduce((a, b) => a + b, 0) / 4, y: ys.reduce((a, b) => a + b, 0) / 4 };
      });
    } catch {
      // A node that left the document has no box; the caller heals or reports it.
      return null;
    }
  }

  private async sendMouse(
    webContents: Electron.WebContents,
    type: "mouseMoved" | "mousePressed" | "mouseReleased",
    x: number,
    y: number,
    button: "left" | "right" | "middle",
    clickCount: number,
  ): Promise<void> {
    await withCdp(webContents, async (send) => {
      await send("Input.dispatchMouseEvent", { type, x, y, button, clickCount, buttons: type === "mousePressed" ? 1 : 0 });
    });
  }

  /** Selects the focused field's content so a replacement can be typed over it. */
  private async clearFocused(webContents: Electron.WebContents): Promise<void> {
    await withCdp(webContents, async (send) => {
      for (const modifiers of [2, 4]) {
        // 2 is Ctrl on Windows/Linux, 4 is Meta on macOS; sending both is how a
        // select-all shortcut is expressed without knowing the platform.
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers, windowsVirtualKeyCode: 65 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers, windowsVirtualKeyCode: 65 });
      }
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    });
  }

  private async sendKey(webContents: Electron.WebContents, key: string): Promise<void> {
    const mapped = KEY_CODES[key] ?? {};
    await withCdp(webContents, async (send) => {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, ...mapped });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, ...mapped });
    });
  }

  private toSummary(tab: TabRecord): BrowserTabSummary {
    return { id: tab.id, url: tab.url, title: tab.title, loading: tab.loading, loadError: tab.loadError };
  }

  openDevTools(): void {
    if (!this.activeTabId) return;
    const webContents = this.host.getWebContents(this.activeTabId);
    if (!webContents) return;
    if (webContents.isDevToolsOpened()) webContents.closeDevTools();
    else webContents.openDevTools({ mode: "detach" });
  }

  /** Opens a link in a new tab, or another tab's address, without user input. */
  async openInNewTab(url: string): Promise<BrowserPanelState> {
    if (!shouldOpenInPanel(url)) return this.getState();
    return await this.createTab(url);
  }

  // ----------------------------------------------------------------- internals

  private activeTab(): TabRecord | null {
    return this.activeTabId ? this.tabs.get(this.activeTabId) ?? null : null;
  }

  private tabState(tab: TabRecord): BrowserTabState {
    const webContents = this.host.getWebContents(tab.id);
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      loading: tab.loading,
      crashed: tab.crashed,
      loadError: tab.loadError,
      canGoBack: webContents ? webContents.navigationHistory.canGoBack() : false,
      canGoForward: webContents ? webContents.navigationHistory.canGoForward() : false,
      sharedWithAgent: this.isSharedWith(tab.id, this.panelSessionId),
      actionsAllowed: this.isActionable(tab.url, this.panelSessionId),
    };
  }

  private async createTabInternal(url?: string): Promise<TabRecord> {
    const evict = tabToEvict([...this.tabs.keys()], this.activeTabId);
    if (evict) {
      this.host.destroy(evict);
      this.tabs.delete(evict);
    }
    const id = `tab-${this.nextTabNumber++}`;
    const tab: TabRecord = {
      id,
      url: "",
      title: "",
      loading: false,
      crashed: false,
      loadError: null,
      committed: false,
    };
    this.tabs.set(id, tab);
    this.activeTabId = id;
    if (url) await this.navigateTo(tab, url);
    return tab;
  }

  private async navigateTo(tab: TabRecord, url: string): Promise<void> {
    const target = normalizeNavigationInput(url);
    if (!target) return;
    await this.ensureGuest(tab.id);
    const webContents = this.host.getWebContents(tab.id);
    if (!webContents) return;
    await this.load(tab, webContents, target);
  }

  private async load(tab: TabRecord, webContents: Electron.WebContents, target: string): Promise<void> {
    await webContents.loadURL(target).catch(() => {
      // The failure surfaces through `did-fail-load`, which records it on the
      // tab so the panel can explain what went wrong.
    });
  }

  private async ensureGuest(tabId: string): Promise<void> {
    if (this.disposed) return;
    if (this.host.getWebContents(tabId)) return;
    const guest = await this.host.createGuest(tabId, { partition: partitionFor(this.sessionScope) });
    this.wireEvents(tabId, guest.webContents);
  }

  private destroyAllTabs(): void {
    for (const id of [...this.tabs.keys()]) this.host.destroy(id);
    this.tabs.clear();
    this.activeTabId = null;
  }

  private wireEvents(tabId: string, webContents: Electron.WebContents): void {
    const refresh = () => this.publish();

    // Links that open a window become tabs in this panel instead of native
    // windows or silent no-ops. Returning deny keeps the OS window count at one
    // even when the caller has no tab left to give.
    webContents.setWindowOpenHandler(({ url }) => {
      void this.openInNewTab(url);
      return { action: "deny" };
    });
    // Anything the panel cannot render belongs to the system, not to a blank
    // guest. This is the second half of the scheme guard in `navigate`.
    webContents.on("will-navigate", (event, url) => {
      if (!shouldOpenInPanel(url)) event.preventDefault();
    });

    // Re-applied per document: injected stylesheet rules do not survive a
    // navigation, and `dom-ready` lands before first paint so the default
    // scrollbar is never shown.
    webContents.on("dom-ready", () => {
      void webContents.insertCSS(PAGE_SCROLLBAR_CSS).catch(() => {
        // Styling is cosmetic; a rejected injection must not affect the page.
      });
    });
    // Console output is captured per tab and bounded, because "the page renders
    // but throws" is the single most useful thing an agent proving its own work
    // can be told — and the one thing a screenshot cannot convey.
    webContents.on("console-message", (_event, level, message, line, sourceId) => {
      const previous = this.consoleEntries.get(tabId) ?? [];
      const result = appendConsoleEntry(previous, this.nextConsoleId.get(tabId) ?? 1, {
        level: levelFromSeverity(level),
        text: message,
        source: sourceId || null,
        line: typeof line === "number" ? line : null,
      });
      this.consoleEntries.set(tabId, result.entries);
      this.nextConsoleId.set(tabId, result.id);
    });
    webContents.on("did-start-loading", () => {
      this.patch(tabId, (tab) => {
        tab.loading = true;
        // A retry clears the previous failure immediately, so the error panel
        // and the page are never shown at the same time.
        tab.loadError = null;
      });
      refresh();
    });
    webContents.on("did-stop-loading", () => {
      this.patch(tabId, (tab) => {
        tab.loading = false;
      });
      refresh();
    });
    webContents.on("did-navigate", (_event, url) => {
      this.patch(tabId, (tab) => {
        tab.url = url;
        tab.crashed = false;
        tab.committed = true;
        tab.loadError = null;
      });
      refresh();
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      this.patch(tabId, (tab) => {
        tab.url = url;
      });
      refresh();
    });
    webContents.on("page-title-updated", (_event, title) => {
      this.patch(tabId, (tab) => {
        tab.title = title;
      });
      refresh();
    });
    webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ABORTED, which fires for ordinary in-flight navigations (a
      // redirect, or the user navigating again) and is not worth surfacing.
      if (!isMainFrame || errorCode === -3) return;
      this.patch(tabId, (tab) => {
        tab.loading = false;
        tab.loadError = {
          code: errorCode,
          description: errorDescription || String(errorCode),
          url: validatedURL || tab.url,
        };
      });
      refresh();
    });
    webContents.on("render-process-gone", () => {
      // Drop the dead guest so the next use rebuilds it; the tab itself stays so
      // its address is still there to retry.
      this.host.destroy(tabId);
      this.patch(tabId, (tab) => {
        tab.crashed = true;
        tab.loading = false;
        tab.committed = false;
      });
      refresh();
    });
  }

  private patch(tabId: string, mutate: (tab: TabRecord) => void): void {
    const tab = this.tabs.get(tabId);
    if (tab) mutate(tab);
  }

  /**
   * Single place that decides which views are mounted, and that at most one is.
   *
   * Hidden tabs stay alive so their session, scroll position and form state
   * survive; they are only detached from the window.
   */
  private applyVisibility(): void {
    for (const id of this.tabs.keys()) {
      if (id !== this.activeTabId) this.host.detach(id);
    }
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    const intent = resolveVisibility({
      requested: this.panelVisible,
      bounds: this.panelBounds,
      loadFailed: (tab?.loadError ?? null) !== null || (tab?.crashed ?? false),
    });
    if (intent === "detach") {
      this.host.detach(this.activeTabId);
      return;
    }
    this.host.attach(this.activeTabId);
    // Re-assert geometry after every attach. A view that was just created, or
    // rebuilt after its renderer died, has no size of its own and would
    // otherwise be mounted invisibly until the next layout change.
    if (this.panelBounds) this.host.setBounds(this.activeTabId, this.panelBounds);
  }

  private publish(): BrowserPanelState {
    // Visibility depends on the active tab and its load state, so every state
    // change re-decides it. All host operations are idempotent.
    this.applyVisibility();
    const state = this.getState();
    this.onChange?.(state);
    for (const listener of this.listeners) listener();
    return state;
  }

  /** Exposed for diagnostics and tests: how many tabs are currently alive. */
  get tabCount(): number {
    return this.tabs.size;
  }

  /** The cap enforced on the strip, surfaced so the UI can explain a refusal. */
  get tabLimit(): number {
    return MAX_BROWSER_TABS;
  }
}

/**
 * Keys that need an explicit code and virtual key code to reach the page.
 *
 * A bare `key` is enough for character keys, but Enter, Tab and the arrows are
 * identified by code in Chromium, and sending only the label leaves them inert.
 */
const KEY_CODES: Record<string, { code?: string; windowsVirtualKeyCode?: number; text?: string }> = {
  Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Home: { code: "Home", windowsVirtualKeyCode: 36 },
  End: { code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { code: "PageDown", windowsVirtualKeyCode: 34 },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
