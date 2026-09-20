import { ArrowLeft, ArrowRight, CircleAlert, Eye, EyeOff, LoaderCircle, MousePointerClick, Plus, RotateCw, ShieldOff, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowserPanelState, BrowserTabState } from "@wordless/protocol";
import { Button } from "@wordless/ui-kit";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import { formatAddressBarValue } from "./address-bar";
import { createFrameScheduler } from "./frame-scheduler";
import { browserOcclusion, domOcclusionProbe } from "./occlusion";

const EMPTY_PANEL: BrowserPanelState = {
  tabs: [],
  activeTabId: null,
  sessionScope: "ephemeral",
  attached: false,
  tabLimit: 8,
};

/**
 * Right-side panel that hosts the embedded browser.
 *
 * The panel renders only chrome — a toolbar, a tab strip and a placeholder. The
 * pages themselves are native `WebContentsView`s the main process positions over
 * the placeholder, which is why this component does two unusual things:
 *
 * 1. it keeps the active view's bounds mirroring the placeholder, and
 * 2. it takes the view out of the window whenever app UI overlaps the
 *    placeholder, because a native surface cannot be layered under DOM content
 *    (see `occlusion.ts`).
 */
export function BrowserPanel({ sessionId }: { sessionId: string | null }) {
  const { client } = useRuntime();
  const { t } = usePreferences();
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<BrowserPanelState>(EMPTY_PANEL);
  const [addressValue, setAddressValue] = useState("");
  const [addressRejected, setAddressRejected] = useState(false);
  const lastSentRef = useRef("");
  const readyRef = useRef(false);

  const activeTab: BrowserTabState | null = useMemo(
    () => panel.tabs.find((tab) => tab.id === panel.activeTabId) ?? null,
    [panel],
  );

  // The renderer owns geometry, so it can re-assert it on demand. `force`
  // bypasses the change signature for the cases where the main process needs to
  // hear the current rect again even though it has not changed: right after the
  // active view is attached, and after a tab is selected or rebuilt.
  const pushBounds = useCallback(
    (force = false) => {
      const element = placeholderRef.current;
      if (!client || !element) return;
      const rect = element.getBoundingClientRect();
      const signature = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
      if (!force && signature === lastSentRef.current) return;
      lastSentRef.current = signature;
      void client.setBrowserViewBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    },
    [client],
  );

  // 1. Bounds mirroring.
  useEffect(() => {
    const element = placeholderRef.current;
    if (!client || !element) return;
    // Coalescing lives in a tested helper: the hand-rolled version cancelled its
    // pending frame on cleanup without forgetting the handle, so after
    // StrictMode's mount/cleanup/mount every later ResizeObserver callback was
    // dropped and the view stopped following the panel's width.
    const scheduler = createFrameScheduler(() => pushBounds());
    const schedule = () => scheduler.schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    // The panel also moves when the sidebar toggles or the window resizes,
    // neither of which changes the placeholder's own box.
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      scheduler.dispose();
    };
  }, [client, pushBounds]);

  // 2. Attach the strip, and keep the detach decision in step with occlusion.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    // Tabs are shared across sessions, but the share and action grants are not, so
    // the panel has to say which task it is showing before reading the flags.
    void client.setBrowserPanelSession(sessionId).then((next) => {
      if (!cancelled) setPanel(next);
    });
    void client.showBrowserView().then((next) => {
      if (cancelled) return;
      readyRef.current = true;
      setPanel(next);
      // The bounds push from mount may have reached the main process before the
      // view existed. Now that it does, state the geometry again.
      pushBounds(true);
    });
    return () => {
      cancelled = true;
      readyRef.current = false;
      void client.hideBrowserView();
    };
  }, [client, pushBounds, sessionId]);

  useEffect(() => {
    if (!client) return;
    return client.subscribeBrowserViewState((next) => setPanel(next));
  }, [client]);

  // Probing costs a forced layout per sample, so it runs at the rate the
  // situation deserves: fast enough to feel immediate when a dialog opens over a
  // live page, free when the panel is showing nothing.
  const probePeriodMs = panel.attached ? 200 : 1_000;

  // Occlusion: sample the placeholder's own geometry. Running the probe on an
  // interval rather than wiring every overlay in the app means a new dialog
  // cannot silently bury the panel.
  useEffect(() => {
    if (!client) return;
    const element = placeholderRef.current;
    if (!element) return;
    const probe = domOcclusionProbe(element);
    let occluded: boolean | null = null;
    const evaluate = () => {
      // Either signal is sufficient: a declared overlay is authoritative, and
      // the probe is the backstop for ones that never declared themselves.
      const finding = probe();
      const next = browserOcclusion.occluded || finding.blocked;
      if (next === occluded) return;
      occluded = next;
      if (next) {
        // A false positive here shows up only as a page that never appears, so
        // name the culprit instead of leaving it to guesswork.
        console.info("[browser] hiding the page because the panel is covered by", browserOcclusion.reasons.length > 0 ? browserOcclusion.reasons : finding.source, finding.element ?? "");
        void client.hideBrowserView();
      }
      else if (readyRef.current) void client.showBrowserView().then((state) => {
        setPanel(state);
        // Coming back from occlusion re-attaches the view, which needs its
        // geometry stated again.
        pushBounds(true);
      });
    };
    // Probing costs a forced layout per sample, so it runs at the rate the
    // situation deserves: fast while a native view is actually covering the
    // placeholder, slow while there is nothing on screen to occlude.
    // A declared overlay should hide the page immediately rather than waiting
    // for the next poll, and its release should restore the page just as fast.
    const unsubscribe = browserOcclusion.subscribe(() => evaluate());
    const timer = window.setInterval(evaluate, probePeriodMs);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [client, pushBounds, probePeriodMs]);

  // Read the active tab without making it an effect dependency: keying the sync
  // effect below on the tab's url would clear the field whenever a load fails,
  // which is exactly when the user is about to fix what they typed.
  const activeTabRef = useRef<BrowserTabState | null>(null);
  activeTabRef.current = activeTab;

  // The address bar belongs to the active tab, so it re-syncs when the tab does.
  // Keying only on `url` was not enough: a freshly opened or still-blank tab has
  // an empty url, which cannot trigger a sync, so the field kept showing the
  // previous tab's address and looked shared across tabs.
  useEffect(() => {
    const tab = activeTabRef.current;
    setAddressValue(tab ? formatAddressBarValue(tab.url) : "");
    setAddressRejected(false);
  }, [panel.activeTabId]);

  // Then follow navigations the page starts itself. One-directional on purpose:
  // a failed load leaves `url` empty and must not erase what the user typed.
  useEffect(() => {
    if (activeTab?.url) setAddressValue(formatAddressBarValue(activeTab.url));
  }, [activeTab?.url]);

  // Switching tabs has to move the native view, which no resize will report.
  useEffect(() => {
    pushBounds(true);
  }, [panel.activeTabId, pushBounds]);

  const submitAddress = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!client) return;
      // The main process owns scheme filtering and reports refusal explicitly.
      // Inferring it from an unchanged url would mislabel a failed connection as
      // a malformed address.
      const result = await client.navigateBrowserView("url", addressValue.trim());
      setPanel(result.state);
      if (!result.accepted) {
        setAddressRejected(true);
        setAddressValue("");
        return;
      }
      setAddressRejected(false);
      pushBounds(true);
    },
    [addressValue, client, pushBounds],
  );

  const navigate = useCallback(
    async (action: "back" | "forward" | "reload") => {
      if (!client) return;
      const result = await client.navigateBrowserView(action);
      setPanel(result.state);
      // A retry has to state geometry again: the view was detached while the
      // error panel was up.
      if (action === "reload") pushBounds(true);
    },
    [client, pushBounds],
  );

  const selectTab = useCallback(
    async (tabId: string) => {
      if (!client) return;
      setPanel(await client.selectBrowserTab(tabId));
    },
    [client],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      if (!client) return;
      setPanel(await client.closeBrowserTab(tabId));
    },
    [client],
  );

  const createTab = useCallback(async () => {
    if (!client) return;
    setPanel(await client.createBrowserTab());
    setAddressValue("");
    setAddressRejected(false);
  }, [client]);

  const toggleSessionScope = useCallback(async () => {
    if (!client) return;
    // Applies to tabs opened from here on; existing tabs keep their session,
    // because switching one in place would discard whatever is signed in.
    setPanel(await client.setBrowserSessionScope(panel.sessionScope === "ephemeral" ? "persistent" : "ephemeral"));
  }, [client, panel.sessionScope]);

  const toggleShared = useCallback(async () => {
    if (!client || !activeTab) return;
    setPanel(await client.setBrowserTabShared(activeTab.id, !activeTab.sharedWithAgent));
  }, [activeTab, client]);

  const toggleActions = useCallback(async () => {
    if (!client || !activeTab) return;
    setPanel(await client.setBrowserActionsAllowed(activeTab.id, !activeTab.actionsAllowed));
  }, [activeTab, client]);

  const devTools = useCallback(() => {
    void client?.openBrowserViewDevTools();
  }, [client]);

  if (!client) {
    return <div className="p-4 text-[12px] text-muted-foreground">{t("browserEmptyHint")}</div>;
  }

  const atTabLimit = panel.tabs.length >= panel.tabLimit;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-[#e4e4df] px-2 py-1.5 dark:border-border">
        <Button
          aria-label={t("browserBack")}
          disabled={!activeTab?.canGoBack}
          onClick={() => void navigate("back")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label={t("browserForward")}
          disabled={!activeTab?.canGoForward}
          onClick={() => void navigate("forward")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label={t("browserReload")}
          onClick={() => void navigate("reload")}
          size="icon"
          type="button"
          variant="ghost"
        >
          {activeTab?.loading
            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            : <RotateCw className="h-3.5 w-3.5" />}
        </Button>
        <form className="min-w-0 flex-1" onSubmit={(event) => void submitAddress(event)}>
          <input
            aria-label={t("browserPanelTitle")}
            className={`w-full rounded-[8px] border bg-white px-2 py-1 text-[11.5px] outline-none dark:bg-card ${
              addressRejected
                ? "border-[#d56e4b] text-[#b04a28]"
                : "border-[#e4e4df] text-[#20201f] focus:border-[#a8b880] dark:border-border dark:text-foreground"
            }`}
            onChange={(event) => {
              setAddressValue(event.target.value);
              setAddressRejected(false);
            }}
            placeholder={addressRejected ? t("browserBlockedUrl") : t("browserAddressPlaceholder")}
            spellCheck={false}
            value={addressValue}
          />
        </form>
      </div>

      {/* Page and session controls on their own row. Seven controls in one
          strip squeezed the address field down to the point where a URL was
          unreadable; navigation and control are also different kinds of act —
          one is used constantly, the other rarely. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#e4e4df] px-2 py-1 dark:border-border">
        <Button
          aria-label={activeTab?.sharedWithAgent ? t("browserShareOff") : t("browserShareOn")}
          className={activeTab?.sharedWithAgent ? "text-[#718052]" : undefined}
          disabled={!activeTab}
          onClick={() => void toggleShared()}
          size="icon"
          title={t("browserShareHint")}
          type="button"
          variant="ghost"
        >
          {activeTab?.sharedWithAgent ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </Button>
        <Button
          aria-label={activeTab?.actionsAllowed ? t("browserAllowActionsOff") : t("browserAllowActionsOn")}
          className={activeTab?.actionsAllowed ? "text-[#718052]" : undefined}
          disabled={!activeTab}
          onClick={() => void toggleActions()}
          size="icon"
          title={t("browserAllowActionsHint")}
          type="button"
          variant="ghost"
        >
          {activeTab?.actionsAllowed
            ? <MousePointerClick className="h-3.5 w-3.5" />
            : <ShieldOff className="h-3.5 w-3.5" />}
        </Button>
        {/* Session scope sits with the other stateful controls rather than in the tab
            strip, where a long row of tabs would scroll it out of sight. A hairline
            separates it because it is a session-wide setting, while the two icons
            beside it apply to the current tab. */}
        <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-[#e4e4df] dark:bg-border" />
        <button
          className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] text-[#8a8a83] hover:bg-[#f4f4f1] dark:text-muted-foreground dark:hover:bg-muted"
          onClick={() => void toggleSessionScope()}
          title={t("browserSessionScopeHint")}
          type="button"
        >
          {panel.sessionScope === "persistent" ? t("browserScopePersistent") : t("browserScopePrivate")}
        </button>
        <Button
          aria-label={t("browserDevTools")}
          className="ml-auto"
          onClick={devTools}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Wrench className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="wordless-thin-scroll flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e4e4df] px-2 py-1 dark:border-border">
        {panel.tabs.map((tab) => {
          const active = tab.id === panel.activeTabId;
          return (
            <div
              className={`group/tab flex min-w-0 max-w-[150px] shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] ${
                active
                  ? "bg-[#eef4dc] text-[#354210] dark:bg-[#303a1c] dark:text-[#e8f5c6]"
                  : "text-[#6a6a63] hover:bg-[#f4f4f1] dark:text-muted-foreground dark:hover:bg-muted"
              }`}
              key={tab.id}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                onClick={() => void selectTab(tab.id)}
                title={tab.loadError ? `${tab.title || tab.url} · ${tab.loadError.description}` : tab.title || tab.url}
                type="button"
              >
                {tab.loading ? <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" /> : null}
                {tab.crashed ? <CircleAlert className="h-3 w-3 shrink-0 text-[#d56e4b]" /> : null}
                <span className="min-w-0 truncate">{tab.title || tab.url || t("browserNewTab")}</span>
              </button>
              <button
                aria-label={t("browserCloseTab")}
                className="shrink-0 rounded-[4px] p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => void closeTab(tab.id)}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        <button
          aria-label={t("browserNewTab")}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-[5px] text-[#6a6a63] hover:bg-[#f4f4f1] disabled:opacity-40 dark:text-muted-foreground dark:hover:bg-muted"
          disabled={atTabLimit}
          onClick={() => void createTab()}
          title={atTabLimit ? t("browserTabLimit").replace("{count}", String(panel.tabLimit)) : t("browserNewTab")}
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* The active tab's native view is positioned over this box whenever a
          page is loaded. On failure the main process detaches it, which is what
          lets this error panel be visible at all — DOM cannot be layered above
          a native surface. */}
      <div
        aria-label={activeTab?.title || t("browserPanelTitle")}
        className="relative min-h-0 flex-1"
        ref={placeholderRef}
        role="region"
      >
        {activeTab?.loadError && !activeTab.loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <CircleAlert className="h-5 w-5 text-[#d56e4b]" />
            <p className="text-[12.5px] font-semibold text-[#33332f] dark:text-foreground">{t("browserLoadFailed")}</p>
            <p className="break-all font-mono text-[11px] text-[#8a8a83] dark:text-muted-foreground">
              {activeTab.loadError.description}
            </p>
            {activeTab.loadError.url ? (
              <p className="break-all font-mono text-[10.5px] text-[#a8a8a2] dark:text-muted-foreground">{activeTab.loadError.url}</p>
            ) : null}
            <p className="max-w-[260px] text-[11px] text-[#8a8a83] dark:text-muted-foreground">{t("browserLoadHint")}</p>
            <Button onClick={() => void navigate("reload")} size="sm" type="button" variant="secondary">
              {t("browserLoadRetry")}
            </Button>
          </div>
        ) : null}
        {activeTab?.crashed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <CircleAlert className="h-5 w-5 text-[#d56e4b]" />
            <p className="text-[12.5px] font-semibold text-[#33332f] dark:text-foreground">{t("browserCrashed")}</p>
            <Button onClick={() => void navigate("reload")} size="sm" type="button" variant="secondary">
              {t("browserLoadRetry")}
            </Button>
          </div>
        ) : null}
        {!activeTab && panel.tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[11.5px] text-[#8a8a83] dark:text-muted-foreground">
            {t("browserEmptyHint")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
