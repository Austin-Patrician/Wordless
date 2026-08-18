import { Button } from "@wordless/ui-kit";
import { AlertTriangle, ChevronLeft, LoaderCircle, PackageOpen, Search, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SessionContextPanel } from "../artifacts/SessionContextPanel";
import { SettingsDialog, type SettingsPage } from "../settings/SettingsDialog";
import { ConversationSearchDialog } from "../thread/ConversationSearchDialog";
import { ThreadView, type ThreadMessageNavigationTarget } from "../thread/ThreadView";
import type { InlineSkillComposerValue, InlineWorkspaceReferenceToken } from "../thread/InlineSkillComposer";
import type { PendingThreadTurn } from "../thread/pending-thread-turn";
import type { ArtifactSelection } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import { workbenchContextPanelRegistry } from "./context-panel-registry";
import type { ContextPanelView, ResearchTaskSelection } from "./context-panel-types";
import { WelcomeView } from "./WelcomeView";
import { Sidebar } from "./Sidebar";
import { SkillsView } from "../skills/SkillsView";
import { SkillImportDialog } from "../skills/SkillImportDialog";
import { MediaCanvas } from "../media/MediaCanvas";
import { MediaLibrary } from "../media/MediaLibrary";
import { AutomationView } from "../automation/AutomationView";
import { AppBackgroundLayer } from "../appearance/AppBackgroundLayer";
import wordlessIcon from "../../../icons/common-icons/wordless.png";
import { DesktopChrome } from "./DesktopChrome";
import { ExpertsView } from "../experts/ExpertsView";
import type { ExpertSelection } from "@wordless/domain";

const THREAD_COLUMN_MIN_WIDTH = 640;
const SIDEBAR_COLLAPSED_WIDTH = 58;
const SIDEBAR_EXPANDED_WIDTH = 238;
const CONTEXT_PANEL_MIN_WIDTH = 240;

export function WorkbenchShell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [mediaFullscreen, setMediaFullscreen] = useState(false);
  const [contextView, setContextView] = useState<ContextPanelView>("overview");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<"thread" | "skills" | "experts" | "media" | "automation">("thread");
  const [pendingExpertSelection, setPendingExpertSelection] = useState<ExpertSelection | undefined>();
  const [pendingExpertPrompt, setPendingExpertPrompt] = useState<string | undefined>();
  const [pendingWorkspaceReferences, setPendingWorkspaceReferences] = useState<InlineWorkspaceReferenceToken[]>([]);
  const [pendingArtifactSelection, setPendingArtifactSelection] = useState<ArtifactSelection | null>(null);
  const [researchTaskSelection, setResearchTaskSelection] = useState<ResearchTaskSelection | null>(null);
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
  const hasSelectedThread = mainView === "thread" && snapshot?.sessions.some((session) => session.id === selectedSessionId) === true;
  const selectedWorkbenchId = snapshot?.sessions.find((session) => session.id === selectedSessionId)?.workbenchId;

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
  const openSettings = (page: SettingsPage = "general") => {
    setSettingsPage(page);
    setSettingsOpen(true);
  };
  const updateSessionDraft = useCallback((sessionId: string, draft: InlineSkillComposerValue) => {
    if (deletedSessionIdsRef.current.has(sessionId)) return;
    if (draft.parts.length === 0) sessionDraftsRef.current.delete(sessionId);
    else sessionDraftsRef.current.set(sessionId, draft);
  }, []);

  useEffect(() => {
    setConversationSearchOpen(false);
    setMessageNavigationTarget(null);
    setPendingArtifactSelection(null);
    setResearchTaskSelection(null);
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

  useEffect(() => {
    if (!hasSelectedThread) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setConversationSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSelectedThread]);

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
      contentClassName={selectedWorkbenchId === "analysis" || selectedWorkbenchId === "conversation" ? "overflow-hidden" : undefined}
      showFooter={selectedWorkbenchId !== "analysis" && selectedWorkbenchId !== "conversation"}
      showMenu={selectedWorkbenchId !== "analysis" && selectedWorkbenchId !== "conversation"}
      tabs={contextPanelDefinition.tabs}
      renderContent={(view) => activeSession
        ? <ContextPanelContent onArtifactSelection={(selection) => { setPendingArtifactSelection(selection); setRightOpen(true); }} onAttachFile={addWorkspaceReference} onClearResearchSelection={() => setResearchTaskSelection(null)} onViewChange={setContextView} researchSelection={researchTaskSelection} sessionId={activeSession.id} view={view} />
        : <div className="p-4 text-[12px] text-muted-foreground">Select a session to view its context.</div>}
      view={contextView}
    />
  );

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-transparent text-foreground">
      <AppBackgroundLayer />
      <div className="relative z-10 flex min-h-screen flex-col">
      <DesktopChrome onNewThread={newThread} onOpenSettings={openSettings} />
      <div className="flex h-[calc(100dvh-var(--wordless-chrome-height))] overflow-hidden">
        {showSessionTools && rightFullscreen ? contextPanel : mainView === "media" && selectedSessionId && activeSession?.workbenchId === "media-canvas" && mediaFullscreen ? <MediaCanvas fullscreen leftOpen sessionId={selectedSessionId} onBackToLibrary={() => { setMediaFullscreen(false); setSelectedSessionId(null); }} onOpenModels={() => openSettings("models")} onToggleFullscreen={() => setMediaFullscreen(false)} onToggleLeft={() => setLeftOpen((value) => !value)} /> : <>
        <Sidebar automationActive={mainView === "automation"} collapsed={!leftOpen} expertsActive={mainView === "experts"} mediaActive={mainView === "media"} onNewThread={newThread} onOpenAutomation={openAutomation} onOpenExperts={openExperts} onOpenMedia={openMedia} onOpenSession={(sessionId) => { const session = snapshot.sessions.find((candidate) => candidate.id === sessionId); setPendingWorkspaceReferences([]); setPendingArtifactSelection(null); setSelectedSessionId(sessionId); setMainView(session?.workbenchId === "media-canvas" ? "media" : "thread"); setRightFullscreen(false); setMediaFullscreen(false); }} onOpenSettings={(page) => openSettings(page)} onOpenSkills={openSkills} onSessionDeleted={(sessionId) => { deletedSessionIdsRef.current.add(sessionId); sessionDraftsRef.current.delete(sessionId); if (selectedSessionId === sessionId) newThread(); }} onToggle={() => setLeftOpen((value) => !value)} runningSessionIds={runningSessionIds} selectedSessionId={selectedSessionId} skillsActive={mainView === "skills"} />
        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)] lg:min-w-[640px]" style={{ "--thread-content-max-width": rightOpen ? "820px" : "clamp(820px, 78%, 1180px)" } as CSSProperties}>
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
              <span className="relative"><Button aria-label={t("artifacts")} onClick={() => { if (activeSession) setUnreadArtifactSessionIds((current) => { if (!current.has(activeSession.id)) return current; const next = new Set(current); next.delete(activeSession.id); return next; }); setRightOpen((value) => !value); }} size="icon" type="button" variant="ghost"><PackageOpen className="h-4 w-4" /></Button>{activeSession && unreadArtifactSessionIds.has(activeSession.id) && !rightOpen ? <span aria-hidden className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#d56e4b] ring-2 ring-[var(--wordless-shell-workspace)]" /> : null}</span>
              <Button aria-label={t("settings")} onClick={() => openSettings()} size="icon" type="button" variant="ghost"><Settings className="h-4 w-4" /></Button>
            </div>
          </header> : null}
          {mainView === "automation" ? <AutomationView leftOpen={leftOpen} onOpenSession={(sessionId) => { setSelectedSessionId(sessionId); setMainView("thread"); }} onToggleLeft={() => setLeftOpen((value) => !value)} /> : mainView === "experts" ? <ExpertsView onSummon={({ initialPrompt, selection }) => { newThread(); setPendingExpertSelection(selection); setPendingExpertPrompt(initialPrompt); }} /> : mainView === "skills" ? <SkillsView onOpenImport={() => setSkillImportOpen(true)} /> : mainView === "media" ? selectedSessionId && activeSession?.workbenchId === "media-canvas" ? <MediaCanvas fullscreen={false} leftOpen={leftOpen} onBackToLibrary={() => { setMediaFullscreen(false); setSelectedSessionId(null); }} onOpenModels={() => openSettings("models")} onToggleFullscreen={() => setMediaFullscreen(true)} onToggleLeft={() => setLeftOpen((value) => !value)} sessionId={selectedSessionId} /> : <MediaLibrary onOpenProject={(sessionId) => { setMediaFullscreen(false); setSelectedSessionId(sessionId); setMainView("media"); }} /> : selectedSessionId ? <ThreadView artifactSelection={pendingArtifactSelection} composerDraft={sessionDraftsRef.current.get(selectedSessionId)} initialPendingTurn={pendingInitialTurn?.sessionId === selectedSessionId ? pendingInitialTurn.turn : null} messageNavigationTarget={messageNavigationTarget} onArtifactSelectionConsumed={() => setPendingArtifactSelection(null)} onComposerDraftChange={updateSessionDraft} onMessageNavigationConsumed={(requestId) => setMessageNavigationTarget((current) => current?.requestId === requestId ? null : current)} onOpenModels={() => openSettings("models")} onOpenResearchTask={(selection) => { setResearchTaskSelection(selection); setContextView("research"); setRightOpen(true); }} onOpenSkillImport={() => setSkillImportOpen(true)} onOpenSkills={openSkills} onPendingWorkspaceReferencesConsumed={() => setPendingWorkspaceReferences([])} pendingWorkspaceReferences={pendingWorkspaceReferences} sessionId={selectedSessionId} /> : <WelcomeView initialExpertPrompt={pendingExpertPrompt} initialExpertSelection={pendingExpertSelection} onOpenModels={() => openSettings("models")} onOpenSkillImport={() => setSkillImportOpen(true)} onOpenSkills={openSkills} onSessionCreated={(sessionId, pendingTurn) => { setPendingExpertSelection(undefined); setPendingExpertPrompt(undefined); setPendingWorkspaceReferences([]); setPendingArtifactSelection(null); setResearchTaskSelection(null); setPendingInitialTurn({ sessionId, turn: pendingTurn }); setSelectedSessionId(sessionId); }} />}
        </section>
        {showSessionTools ? contextPanel : null}
        </>}
      </div>
      <SettingsDialog initialPage={settingsPage} onOpenChange={setSettingsOpen} open={settingsOpen} />
      <SkillImportDialog onImport={importSkill} onOpenChange={setSkillImportOpen} open={skillImportOpen} />
      {activeSession && client ? <ConversationSearchDialog onNavigate={(result) => setMessageNavigationTarget({ matchText: result.snippet.slice(result.matchStart, result.matchEnd), messageId: result.messageId, sessionId: activeSession.id, turnId: result.turnId, requestId: ++messageNavigationSequenceRef.current })} onOpenChange={setConversationSearchOpen} open={conversationSearchOpen} searchMessages={(request) => client.searchSessionMessages(activeSession.id, request)} sessionId={activeSession.id} /> : null}
      </div>
    </main>
  );
}
