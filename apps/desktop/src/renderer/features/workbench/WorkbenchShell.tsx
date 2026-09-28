import { Button } from "@wordless/ui-kit";
import { AlertTriangle, ChevronLeft, Frame, Globe, Languages, ListTodo, LoaderCircle, PackageOpen, Search, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SessionContextPanel } from "../artifacts/SessionContextPanel";
import { SettingsDialog, type SettingsPage } from "../settings/SettingsDialog";
import { ConversationSearchDialog } from "../thread/ConversationSearchDialog";
import { ThreadView, type ThreadMessageNavigationTarget } from "../thread/ThreadView";
import type { InlineSkillComposerValue, InlineWorkspaceReferenceToken } from "../thread/InlineSkillComposer";
import type { PendingThreadTurn } from "../thread/pending-thread-turn";
import type { ArtifactSelection } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import { useGlobalShortcuts } from "../../shared/shortcuts/use-global-shortcuts";
import { useRuntime } from "../../shared/runtime";
import { BrowserPanel } from "../browser/BrowserPanel";
import { workbenchContextPanelRegistry } from "./context-panel-registry";
import type { ContextPanelView, FileChangeSelection, ResearchTaskSelection } from "./context-panel-types";
import { TranslationPanelSlot, TranslationProvider } from "../translation/TranslationPanelSlot";
import { WelcomeView } from "./WelcomeView";
import { Sidebar } from "./Sidebar";
import type { WorkbenchMainView } from "./sidebar-nav";
import { resolveSessionOpenTarget } from "./session-open-target";
import { SkillsView } from "../skills/SkillsView";
import { SkillImportDialog } from "../skills/SkillImportDialog";
import { MediaCanvas } from "../media/MediaCanvas";
import { DesignWorkspace } from "../design/DesignWorkspace";
import { DesignLibraryView } from "../design/DesignLibraryView";
import { MediaLibrary } from "../media/MediaLibrary";
import { AutomationView } from "../automation/AutomationView";
import { AppBackgroundLayer } from "../appearance/AppBackgroundLayer";
import wordlessIcon from "../../../icons/common-icons/wordless.jpeg";
import { DesktopChrome } from "./DesktopChrome";
import { useOnboarding } from "../onboarding/OnboardingFlow";
import { foregroundSessionId } from "./foreground-session";
import { ExpertsView } from "../experts/ExpertsView";
import { TasksView } from "../tasks/TasksView";
import type { ExpertSelection } from "@wordless/domain";

/**
 * Subscribes to host events for the lifetime of the component.
 *
 * Inline in an effect body the unsubscribe would be dropped by `useEffect`'s
 * cleanup contract, so it is wrapped once here.
 */
function subscribeToHostEvents(
  client: ReturnType<typeof useRuntime>["client"],
  listener: (event: import("@wordless/protocol").DesktopHostEvent) => void,
): () => void {
  if (!client) return () => {};
  return client.subscribeHost(listener);
}

const THREAD_COLUMN_MIN_WIDTH = 640;
const SIDEBAR_COLLAPSED_WIDTH = 58;
const SIDEBAR_EXPANDED_WIDTH = 238;
const CONTEXT_PANEL_MIN_WIDTH = 240;
// Workbenches whose context panel has room for a browser tab. Conversation
// because the agent may open a page unprompted, code and ui-preview because
// that is where a page under development gets verified.
const browserPanelWorkbenchIds = new Set<string>(["conversation", "code", "ui-preview"]);

export function WorkbenchShell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [mediaFullscreen, setMediaFullscreen] = useState(false);
  const [contextView, setContextView] = useState<ContextPanelView>("overview");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<WorkbenchMainView>("thread");
  const [pendingExpertSelection, setPendingExpertSelection] = useState<ExpertSelection | undefined>();
  const [pendingExpertPrompt, setPendingExpertPrompt] = useState<string | undefined>();
  const [pendingWorkspaceReferences, setPendingWorkspaceReferences] = useState<InlineWorkspaceReferenceToken[]>([]);
  const [pendingArtifactSelection, setPendingArtifactSelection] = useState<ArtifactSelection | null>(null);
  const [researchTaskSelection, setResearchTaskSelection] = useState<ResearchTaskSelection | null>(null);
  const [fileChangeSelection, setFileChangeSelection] = useState<FileChangeSelection | null>(null);
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [messageNavigationTarget, setMessageNavigationTarget] = useState<ThreadMessageNavigationTarget | null>(null);
  const [pendingInitialTurn, setPendingInitialTurn] = useState<{ sessionId: string; turn: PendingThreadTurn } | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const [unreadArtifactSessionIds, setUnreadArtifactSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  const messageNavigationSequenceRef = useRef(0);
  const autoOpenedAnalysisSessionsRef = useRef(new Set<string>());
  const autoOpenedArtifactSessionsRef = useRef(new Set<string>());
  const sessionDraftsRef = useRef(new Map<string, InlineSkillComposerValue>());
  const deletedSessionIdsRef = useRef(new Set<string>());
  const runningSessionStateInitializedRef = useRef(false);
  const pendingRunningSessionStatesRef = useRef(new Map<string, boolean>());
  const { t } = usePreferences();
  const { client, error, refresh, snapshot, status } = useRuntime();
  const onboarding = useOnboarding();
  const hasSelectedThread = mainView === "thread" && snapshot?.sessions.some((session) => session.id === selectedSessionId) === true;

  /**
   * Tell the host which session's chat is on screen, so it can decide whether a
   * finished run needs a desktop notification.
   *
   * Null whenever the chat is not actually visible — another main view, or a
   * dialog/tour covering it. That distinction is the whole point: "focused window"
   * alone used to suppress every notification, so a run that finished while the
   * user was reading a different session said nothing at all.
   *
   * Only the renderer can answer this; the host owns window focus and combines the
   * two itself.
   */
  useEffect(() => {
    const foreground = foregroundSessionId({
      mainView,
      selectedSessionId,
      settingsOpen,
      tourActive: onboarding?.active === true,
    });
    void client?.setForegroundSession(foreground);
  }, [client, mainView, selectedSessionId, settingsOpen, onboarding?.active]);

  /**
   * A notification was clicked: bring the session it was about into view.
   *
   * The session is checked against the snapshot first — it may have been deleted
   * between the notification appearing and the click, and selecting a session that
   * no longer exists would leave the thread view empty.
   */
  useEffect(() => subscribeToHostEvents(client, (event) => {
    if (event.type !== "open-session") return;
    if (!snapshot?.sessions.some((session) => session.id === event.sessionId)) return;
    setSettingsOpen(false);
    setMainView("thread");
    setSelectedSessionId(event.sessionId);
  }), [client, snapshot?.sessions]);
  const selectedWorkbenchId = snapshot?.sessions.find((session) => session.id === selectedSessionId)?.workbenchId;

  /**
   * 会话打开时顺手把它需要的辅助面板调出来(目前只有 UI 设计会话的画布)。
   *
   * 依赖只有"选中了哪个会话" —— 所以用户手动关掉之后它会保持关着,不会被这个效果一次次
   * 弹开。要的是"默认并排",不是"永远并排"。
   */
  useEffect(() => {
    if (selectedSessionId === null) return;
    const target = resolveSessionOpenTarget(selectedWorkbenchId);
    if (target.contextView === null) return;
    setContextView(target.contextView);
    setRightOpen(true);
  }, [selectedSessionId, selectedWorkbenchId]);

  const updateSessionRunningState = useCallback((sessionId: string, running: boolean) => {
    if (!runningSessionStateInitializedRef.current)
      pendingRunningSessionStatesRef.current.set(sessionId, running);
    setRunningSessionIds((current) => {
      if (current.has(sessionId) === running) return current;
      const next = new Set(current);
      if (running) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!client) return;
    return client.subscribe((event) => {
      if (!event.sessionId) return;
      const type = event.event.type;
      if (type !== "run.started" && type !== "run.failed" && type !== "run.cancelled" && type !== "session.idle") return;
      updateSessionRunningState(event.sessionId, type === "run.started");
    });
  }, [client, updateSessionRunningState]);

  useEffect(() => {
    if (!client) return;
    return client.subscribe((event) => {
      if (
        !event.sessionId ||
        event.event.type !== "session.artifacts.changed" ||
        event.event.count === 0
      )
        return;
      const sessionId = event.sessionId;
      if (
        sessionId === selectedSessionId &&
        selectedWorkbenchId === "conversation" &&
        !autoOpenedArtifactSessionsRef.current.has(sessionId)
      ) {
        autoOpenedArtifactSessionsRef.current.add(sessionId);
        setContextView("artifacts");
        setRightOpen(true);
        setUnreadArtifactSessionIds((current) => {
          if (!current.has(sessionId)) return current;
          const next = new Set(current);
          next.delete(sessionId);
          return next;
        });
        return;
      }
      setUnreadArtifactSessionIds((current) => {
        if (current.has(sessionId)) return current;
        return new Set(current).add(sessionId);
      });
    });
  }, [client, selectedSessionId, selectedWorkbenchId]);

  useEffect(() => {
    if (
      !selectedSessionId ||
      selectedWorkbenchId !== "conversation" ||
      !unreadArtifactSessionIds.has(selectedSessionId) ||
      autoOpenedArtifactSessionsRef.current.has(selectedSessionId)
    )
      return;
    autoOpenedArtifactSessionsRef.current.add(selectedSessionId);
    setContextView("artifacts");
    setRightOpen(true);
    setUnreadArtifactSessionIds((current) => {
      const next = new Set(current);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId, selectedWorkbenchId, unreadArtifactSessionIds]);

  useEffect(() => {
    if (!snapshot) return;
    if (!runningSessionStateInitializedRef.current) {
      const next = new Set(snapshot.runningSessionIds ?? []);
      for (const [sessionId, running] of pendingRunningSessionStatesRef.current) {
        if (running) next.add(sessionId);
        else next.delete(sessionId);
      }
      pendingRunningSessionStatesRef.current.clear();
      runningSessionStateInitializedRef.current = true;
      setRunningSessionIds(next);
      return;
    }
    const sessionIds = new Set(snapshot.sessions.map((session) => session.id));
    setRunningSessionIds((current) => {
      const next = new Set([...current].filter((sessionId) => sessionIds.has(sessionId)));
      return next.size === current.size ? current : next;
    });
  }, [snapshot]);

  const newThread = () => {
    setPendingExpertSelection(undefined);
    setPendingExpertPrompt(undefined);
    setPendingWorkspaceReferences([]);
    setPendingArtifactSelection(null);
    setResearchTaskSelection(null);
    setFileChangeSelection(null);
    setPendingInitialTurn(null);
    setSelectedSessionId(null);
    setMainView("thread");
    setRightOpen(false);
    setRightFullscreen(false);
    setMediaFullscreen(false);
  };
  const openSkills = () => {
    setMainView("skills");
    setRightOpen(false);
    setRightFullscreen(false);
    setMediaFullscreen(false);
  };
  const openMedia = () => {
    setSelectedSessionId(null);
    setMainView("media");
    setRightOpen(false);
    setRightFullscreen(false);
    setMediaFullscreen(false);
  };
  const openExperts = () => {
    setSelectedSessionId(null);
    setMainView("experts");
    setRightOpen(false);
    setRightFullscreen(false);
    setMediaFullscreen(false);
  };
  const openAutomation = () => {
    setSelectedSessionId(null);
    setMainView("automation");
    setRightOpen(false);
    setRightFullscreen(false);
    setMediaFullscreen(false);
  };
  const openTasks = () => {
    setSelectedSessionId(null);
    setMainView("tasks");
    setRightOpen(false);
    setRightFullscreen(false);
    setMediaFullscreen(false);
  };
  const openSettings = (page: SettingsPage = "general") => {
    setSettingsPage(page);
    setSettingsOpen(true);
  };
  const updateSessionDraft = useCallback((sessionId: string, draft: InlineSkillComposerValue) => {
    if (deletedSessionIdsRef.current.has(sessionId)) return;
    if (draft.parts.length === 0) sessionDraftsRef.current.delete(sessionId);
    else sessionDraftsRef.current.set(sessionId, draft);
  }, []);
  const consumeFileChangeSelection = useCallback(() => {
    setFileChangeSelection(null);
  }, []);

  useEffect(() => {
    setConversationSearchOpen(false);
    setMessageNavigationTarget(null);
    setPendingArtifactSelection(null);
    setResearchTaskSelection(null);
    setFileChangeSelection(null);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!client || !pendingInitialTurn) return;
    return client.subscribe((event) => {
      if (event.sessionId !== pendingInitialTurn.sessionId) return;
      if (event.event.type === "message.completed" && event.event.message.id === pendingInitialTurn.turn.message.id) setPendingInitialTurn(null);
      if (event.event.type === "run.failed" || event.event.type === "run.cancelled" || event.event.type === "session.idle") setPendingInitialTurn(null);
    });
  }, [client, pendingInitialTurn]);

  useEffect(() => {
    const definition = workbenchContextPanelRegistry.resolve(selectedWorkbenchId);
    setContextView(definition.tabs[0]?.id ?? "overview");
    if (selectedWorkbenchId === "presentation") setRightOpen(true);
    if (selectedWorkbenchId === "analysis" && selectedSessionId && !autoOpenedAnalysisSessionsRef.current.has(selectedSessionId)) {
      autoOpenedAnalysisSessionsRef.current.add(selectedSessionId);
      setRightOpen(true);
    }
  }, [selectedSessionId, selectedWorkbenchId]);

  // A session can disappear while it is open (deleted from the sidebar or from
  // Settings → session history). Leaving selectedSessionId set would render the
  // thread for a conversation that no longer exists.
  useEffect(() => {
    if (!selectedSessionId || !snapshot) return;
    if (!snapshot.sessions.some((session) => session.id === selectedSessionId)) newThread();
  }, [snapshot, selectedSessionId]);

  // The keyboard's half of the application menu plus navigation. macOS gets the
  // menu keys from the native menu; Windows and Linux have no native menu, so
  // they arrive here instead. Keys that depend on what is on screen are gated
  // here rather than unbound, so a rebind never points at nothing.
  useGlobalShortcuts((actionId) => {
    switch (actionId) {
      case "new-thread":
        newThread();
        break;
      case "open-conversation":
        setMainView("thread");
        setRightFullscreen(false);
        setMediaFullscreen(false);
        break;
      case "open-media":
        openMedia();
        break;
      case "open-automation":
        openAutomation();
        break;
      case "open-tasks":
        openTasks();
        break;
      case "open-experts":
        openExperts();
        break;
      case "open-skills":
        openSkills();
        break;
      // Searching only makes sense with a conversation open; the key is claimed
      // either way, because nothing else in the window answers to it.
      case "find-in-conversation":
        if (hasSelectedThread) setConversationSearchOpen(true);
        break;
      case "toggle-sidebar":
        setLeftOpen((open) => !open);
        break;
      case "toggle-context-panel":
        if (showSessionTools) setRightOpen((open) => !open);
        break;
      case "open-settings":
        openSettings();
        break;
    }
  });

  useEffect(() => {
    if (!rightOpen || rightFullscreen || !leftOpen) return;
    const preserveThreadWidth = () => {
      const requiredWidth = SIDEBAR_EXPANDED_WIDTH + THREAD_COLUMN_MIN_WIDTH + CONTEXT_PANEL_MIN_WIDTH;
      if (window.innerWidth >= 1024 && window.innerWidth < requiredWidth) setLeftOpen(false);
    };
    preserveThreadWidth();
    window.addEventListener("resize", preserveThreadWidth);
    return () => window.removeEventListener("resize", preserveThreadWidth);
  }, [leftOpen, rightFullscreen, rightOpen]);
  const importSkill = async (file?: File): Promise<boolean> => {
    if (!client) return false;
    if (file) {
      await client.importSkillFile(file);
      await refresh();
      return true;
    }
    const imported = await client.importSkill();
    if (imported) await refresh();
    return imported;
  };

  if (status !== "ready" || !snapshot) {
    const loading = status === "loading";
    return (
      <main className="relative isolate min-h-screen overflow-hidden bg-transparent text-foreground">
        <AppBackgroundLayer />
        <div className="relative z-10 flex min-h-screen flex-col">
        <DesktopChrome onNewThread={newThread} onOpenSettings={openSettings} />
        <section className="grid h-[calc(100dvh-var(--wordless-chrome-height))] place-items-center bg-[var(--wordless-shell-workspace)] px-6">
          <div className="w-full max-w-[520px] border-y border-[#e3e3de] py-8 text-center dark:border-border">
            {loading ? <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-[#6f8250]" /> : <AlertTriangle className="mx-auto h-5 w-5 text-[#b16854]" />}
            <h1 className="mt-4 text-[15px] font-semibold text-[#30302d] dark:text-foreground">{loading ? t("desktopRuntimeLoading") : t("desktopRuntimeUnavailable")}</h1>
            {!loading && error ? <p className="mx-auto mt-2 max-w-[460px] font-mono text-[11px] leading-5 text-[#74746d] dark:text-muted-foreground">{error}</p> : null}
          </div>
        </section>
        </div>
      </main>
    );
  }

  const activeSession = snapshot.sessions.find((session) => session.id === selectedSessionId);
  const showSessionTools = mainView === "thread" && activeSession !== undefined;

  const contextPanelDefinition = workbenchContextPanelRegistry.resolve(activeSession?.workbenchId);
  const ContextPanelContent = contextPanelDefinition.component;
  // The translation tab is appended centrally: translating a selection is a
  // global capability, not something each workbench registers.
  const contextPanelTabs = [
    ...contextPanelDefinition.tabs.map(({ labelKey, ...tab }) => ({ ...tab, label: t(labelKey) })),
    { id: "translation" as const, label: t("translationPanelTitle"), icon: Languages },
    // The browser is offered where a previewable surface is expected; on
    // presentation/workbook/analysis the panel is already spoken for.
    ...(browserPanelWorkbenchIds.has(selectedWorkbenchId ?? "") ? [{ id: "browser" as const, label: t("browserPanelTitle"), icon: Globe }] : []),
    // 设计画布与对话**并排**,而不是取代它:会话是对话,画布是这一轮工作的产物。取代意味着
    // agent 干活时你看不见它在干什么,而且画布上没有任何回去的入口。
    ...(selectedWorkbenchId === "ui-preview" ? [{ id: "design" as const, label: t("designPanelTitle"), icon: Frame }] : []),
  ];
  const revealTranslationPanel = () => {
    setContextView("translation");
    setRightOpen(true);
  };
  const addWorkspaceReference = (reference: InlineWorkspaceReferenceToken) => {
    setPendingWorkspaceReferences((current) => current.some((item) => item.path === reference.path) ? current : [...current, reference]);
    setRightOpen(true);
  };
  const contextPanel = (
    <SessionContextPanel
      collapsed={!rightOpen}
      fullscreen={rightFullscreen}
      leftSidebarWidth={leftOpen ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH}
      minimumMainWidth={THREAD_COLUMN_MIN_WIDTH}
      onFullscreen={() => setRightFullscreen((value) => !value)}
      onViewChange={setContextView}
      onToggle={() => {
        setRightFullscreen(false);
        setRightOpen(false);
      }}
      contentClassName={selectedWorkbenchId === "analysis" || selectedWorkbenchId === "conversation" || contextView === "browser" || contextView === "design" ? "overflow-hidden" : undefined}
      showFooter={selectedWorkbenchId !== "analysis" && selectedWorkbenchId !== "conversation"}
      showMenu={selectedWorkbenchId !== "analysis" && selectedWorkbenchId !== "conversation"}
      tabs={contextPanelTabs}
      renderContent={(view) => view === "browser"
        ? <BrowserPanel sessionId={activeSession?.id ?? null} />
        : view === "design" && activeSession
        ? <DesignWorkspace running={runningSessionIds.has(activeSession.id)} sessionId={activeSession.id} />
        : view === "translation"
        ? <TranslationPanelSlot />
        : activeSession
        ? <ContextPanelContent fileChangeSelection={fileChangeSelection} onArtifactSelection={(selection) => { setPendingArtifactSelection(selection); setRightOpen(true); }} onAttachFile={addWorkspaceReference} onClearResearchSelection={() => setResearchTaskSelection(null)} onFileChangeSelectionConsumed={consumeFileChangeSelection} onViewChange={setContextView} researchSelection={researchTaskSelection} sessionId={activeSession.id} view={view} />
        : <div className="p-4 text-[12px] text-muted-foreground">Select a session to view its context.</div>}
      view={contextView}
    />
  );

  return (
    <TranslationProvider onOpenSettings={() => openSettings("assistant")} onRevealPanel={revealTranslationPanel} sessionId={selectedSessionId ?? undefined}>
    <main className="relative isolate min-h-screen overflow-hidden bg-transparent text-foreground">
      <AppBackgroundLayer />
      <div className="relative z-10 flex min-h-screen flex-col">
      <DesktopChrome onNewThread={newThread} onOpenSettings={openSettings} />
      <div className="flex h-[calc(100dvh-var(--wordless-chrome-height))] overflow-hidden">
        {mainView === "media" && selectedSessionId && activeSession?.workbenchId === "media-canvas" && mediaFullscreen ? <MediaCanvas fullscreen leftOpen sessionId={selectedSessionId} onBackToLibrary={() => { setMediaFullscreen(false); setSelectedSessionId(null); }} onOpenModels={() => openSettings("models")} onToggleFullscreen={() => setMediaFullscreen(false)} onToggleLeft={() => setLeftOpen((value) => !value)} /> : <>
        <div className={showSessionTools && rightFullscreen ? "hidden" : undefined}><Sidebar mainView={mainView} onOpenTasks={openTasks} collapsed={!leftOpen} onNewThread={newThread} onOpenAutomation={openAutomation} onOpenExperts={openExperts} onOpenMedia={openMedia} onOpenSession={(sessionId) => { const session = snapshot.sessions.find((candidate) => candidate.id === sessionId); setPendingWorkspaceReferences([]); setPendingArtifactSelection(null); setSelectedSessionId(sessionId); setMainView(resolveSessionOpenTarget(session?.workbenchId).mainView); setRightFullscreen(false); setMediaFullscreen(false); }} onOpenSettings={(page) => openSettings(page)} onOpenDesign={() => { setMainView("design"); setSelectedSessionId(null); }} onOpenSkills={openSkills} onSessionDeleted={(sessionId) => { deletedSessionIdsRef.current.add(sessionId); sessionDraftsRef.current.delete(sessionId); if (selectedSessionId === sessionId) newThread(); }} onToggle={() => setLeftOpen((value) => !value)} runningSessionIds={runningSessionIds} selectedSessionId={selectedSessionId} /></div>
        <section className={showSessionTools && rightFullscreen ? "hidden" : "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)] lg:min-w-[640px]"} style={{ "--thread-content-max-width": rightOpen ? "820px" : "clamp(820px, 78%, 1180px)" } as CSSProperties}>
          {showSessionTools ? <header className="flex h-[62px] shrink-0 items-center justify-between px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex items-center gap-2 lg:hidden"><img alt="" className="h-7 w-7 shrink-0 rounded-[8px] object-cover" draggable={false} src={wordlessIcon} /><span className="text-sm font-bold tracking-[-0.04em]">wordless</span></div>
              <div className="hidden min-w-0 items-center gap-2 lg:flex">
                {!leftOpen ? <Button aria-label="Expand sidebar" onClick={() => setLeftOpen(true)} size="icon" type="button" variant="ghost"><ChevronLeft className="h-4 w-4 rotate-180" /></Button> : null}
                <span className="truncate text-[13px] font-semibold text-[#20201f] dark:text-foreground">{activeSession.title}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button aria-label={t("messageSearch")} onClick={() => setConversationSearchOpen(true)} size="icon" type="button" variant="ghost"><Search className="h-4 w-4" /></Button>
              <Button aria-label={t("tasks")} onClick={openTasks} size="icon" type="button" variant="ghost"><ListTodo className="h-4 w-4" /></Button>
              <span className="relative"><Button aria-label={t("artifacts")} onClick={() => { if (activeSession) setUnreadArtifactSessionIds((current) => { if (!current.has(activeSession.id)) return current; const next = new Set(current); next.delete(activeSession.id); return next; }); setRightOpen((value) => !value); }} size="icon" type="button" variant="ghost"><PackageOpen className="h-4 w-4" /></Button>{activeSession && unreadArtifactSessionIds.has(activeSession.id) && !rightOpen ? <span aria-hidden className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#d56e4b] ring-2 ring-[var(--wordless-shell-workspace)]" /> : null}</span>
              <Button aria-label={t("settings")} data-tour="header-settings" onClick={() => openSettings()} size="icon" type="button" variant="ghost"><Settings className="h-4 w-4" /></Button>
            </div>
          </header> : null}
          {mainView === "design" ? <DesignLibraryView /> : mainView === "tasks" ? <TasksView leftOpen={leftOpen} onOpenSession={(sessionId) => { setSelectedSessionId(sessionId); setMainView("thread"); }} onToggleLeft={() => setLeftOpen((value) => !value)} /> : mainView === "automation" ? <AutomationView leftOpen={leftOpen} onOpenSession={(sessionId) => { setSelectedSessionId(sessionId); setMainView("thread"); }} onToggleLeft={() => setLeftOpen((value) => !value)} /> : mainView === "experts" ? <ExpertsView onSummon={({ initialPrompt, selection }) => { newThread(); setPendingExpertSelection(selection); setPendingExpertPrompt(initialPrompt); }} /> : mainView === "skills" ? <SkillsView onOpenImport={() => setSkillImportOpen(true)} /> : mainView === "media" ? selectedSessionId && activeSession?.workbenchId === "media-canvas" ? <MediaCanvas fullscreen={false} leftOpen={leftOpen} onBackToLibrary={() => { setMediaFullscreen(false); setSelectedSessionId(null); }} onOpenModels={() => openSettings("models")} onToggleFullscreen={() => setMediaFullscreen(false)} onToggleLeft={() => setLeftOpen((value) => !value)} sessionId={selectedSessionId} /> : <MediaLibrary onOpenProject={(sessionId) => { setMediaFullscreen(false); setSelectedSessionId(sessionId); setMainView("media"); }} /> : selectedSessionId ? <ThreadView artifactSelection={pendingArtifactSelection} composerDraft={sessionDraftsRef.current.get(selectedSessionId)} initialPendingTurn={pendingInitialTurn?.sessionId === selectedSessionId ? pendingInitialTurn.turn : null} messageNavigationTarget={messageNavigationTarget} onArtifactSelectionConsumed={() => setPendingArtifactSelection(null)} onComposerDraftChange={updateSessionDraft} onMessageNavigationConsumed={(requestId) => setMessageNavigationTarget((current) => current?.requestId === requestId ? null : current)} onOpenFileChange={(selection) => { setFileChangeSelection(selection); setContextView("changes"); setRightOpen(true); }} onOpenModels={() => openSettings("models")} onOpenResearchTask={(selection) => { setResearchTaskSelection(selection); setContextView("research"); setRightOpen(true); }} onOpenSkillImport={() => setSkillImportOpen(true)} onOpenSkills={openSkills} onPendingWorkspaceReferencesConsumed={() => setPendingWorkspaceReferences([])} pendingWorkspaceReferences={pendingWorkspaceReferences} sessionId={selectedSessionId} /> : <WelcomeView initialExpertPrompt={pendingExpertPrompt} initialExpertSelection={pendingExpertSelection} onOpenModels={() => openSettings("models")} onOpenSkillImport={() => setSkillImportOpen(true)} onOpenSkills={openSkills} onSessionCreated={(sessionId, pendingTurn) => { setPendingExpertSelection(undefined); setPendingExpertPrompt(undefined); setPendingWorkspaceReferences([]); setPendingArtifactSelection(null); setResearchTaskSelection(null); setPendingInitialTurn({ sessionId, turn: pendingTurn }); setSelectedSessionId(sessionId); }} />}
        </section>
        {showSessionTools ? contextPanel : null}
        </>}
      </div>
      <SettingsDialog
        initialPage={settingsPage}
        onOpenChange={setSettingsOpen}
        onOpenSession={(sessionId) => {
          const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
          setPendingWorkspaceReferences([]);
          setPendingArtifactSelection(null);
          setSelectedSessionId(sessionId);
          setMainView(resolveSessionOpenTarget(session?.workbenchId).mainView);
          setRightFullscreen(false);
          setMediaFullscreen(false);
          setSettingsOpen(false);
        }}
        open={settingsOpen}
      />
      <SkillImportDialog onImport={importSkill} onOpenChange={setSkillImportOpen} open={skillImportOpen} />
      {activeSession && client ? <ConversationSearchDialog onNavigate={(result) => setMessageNavigationTarget({ matchText: result.snippet.slice(result.matchStart, result.matchEnd), messageId: result.messageId, sessionId: activeSession.id, turnId: result.turnId, requestId: ++messageNavigationSequenceRef.current })} onOpenChange={setConversationSearchOpen} open={conversationSearchOpen} searchMessages={(request) => client.searchSessionMessages(activeSession.id, request)} sessionId={activeSession.id} /> : null}
      </div>
    </main>
    </TranslationProvider>
  );
}
