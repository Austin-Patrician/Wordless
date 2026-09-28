import { Button } from "@wordless/ui-kit";
import { AlertTriangle, ChevronLeft, Globe, Languages, ListTodo, LoaderCircle, PackageOpen, Search, Settings } from "lucide-react";
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
import type { ContextPanelTab, ContextPanelView, FileChangeSelection, ResearchTaskSelection } from "./context-panel-types";
import {
  CONTEXT_PANEL_EXCLUSIVE_WORKBENCH_IDS,
  mainColumnFills,
  sharedContextPanelViews,
} from "./context-panel-tabs";
import { fillReskinText, reskinPromptParts } from "../design/reskin-prompt.ts";
import { createUserMessageSubmission } from "../thread/pending-thread-turn";
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
import wordlessIcon from "../../../icons/common-icons/wordless-brand.svg";
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
/**
 * 画布为主时对话列的宽度。
 *
 * 这一屏的主体是画布,所以对话列**定宽**而不是 `flex-1` —— 剩下的全部宽度归画布(见
 * `context-panel-tabs.ts` 的铺满型工作台)。
 *
 * 420 是**起点而不是结论**:它放得下一轮对话与输入框,同时给 1280 宽的窗口留下 800+ 给画布。
 * 390×844 的手机帧在 1:1 下要 844 高、390 宽 —— 宽度够了,高度靠全屏解决(见活体规则)。
 */
const DESIGN_THREAD_WIDTH = 420;
/** 拖动对话列的下限:再窄,消息和输入框就没法读了。 */
const DESIGN_THREAD_MIN_WIDTH = 320;
const SIDEBAR_COLLAPSED_WIDTH = 58;
const SIDEBAR_EXPANDED_WIDTH = 238;
const CONTEXT_PANEL_MIN_WIDTH = 240;
// 面板上追加哪些共享页签(翻译 / 浏览器)由 `context-panel-tabs.ts` 判定 —— 它是纯函数,
// 于是"哪些工作台铺满整块面板"这件事可以被断言,而不是一堆 JSX 里的展开表达式。

export function WorkbenchShell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [leftOpen, setLeftOpen] = useState(true);
  /** 画布为主时对话列的宽度。拖那条边界改的是**它**,不是画布。 */
  const [designThreadWidth, setDesignThreadWidth] = useState(DESIGN_THREAD_WIDTH);
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

  /**
   * 进了需要整块宽度的会话(设计画布)就把左栏收起来,并把面板调出来。
   *
   * 收不收由 `resolveSessionOpenTarget` 决定 —— 那是"进入一个会话时界面该是什么形状"的
   * 那一张表,而不是散在这里的一个 `if`。
   *
   * **这是一次性动作,不是持续约束。** `collapsedForRef` 让同一个会话只收一次:没有它,
   * 这个 effect 会因为运行时快照每来一个事件就重跑一次,于是用户刚展开左栏就被收回去 ——
   * 那比默认展开更糟(§14.11 同一条纪律:要的是默认,不是永远)。
   */
  const collapsedForSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedSessionId === null || collapsedForSessionRef.current === selectedSessionId) return;
    const session = snapshot?.sessions.find((candidate) => candidate.id === selectedSessionId);
    if (session === undefined) return;
    const target = resolveSessionOpenTarget(session.workbenchId);
    if (!target.collapseLeftSidebar) return;
    collapsedForSessionRef.current = selectedSessionId;
    setLeftOpen(false);
    setRightOpen(true);
  }, [selectedSessionId, snapshot?.sessions]);

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
  /**
   * 这块面板是不是**这一屏的主体**。
   *
   * 它同时决定两件事,而这两件事本来就是同一个判断:页签只来自注册表(不再追加翻译与
   * 浏览器),以及布局上把 flex 角色反过来 —— 对话定宽、画布吃剩下的。
   */
  const exclusivePanel = CONTEXT_PANEL_EXCLUSIVE_WORKBENCH_IDS.has(selectedWorkbenchId ?? "");
  /**
   * "画布为主"的布局**只在画布真的开着时**成立。
   *
   * 这里踩过:上一版只看 `exclusivePanel`,于是把对话列无条件设成固定宽 —— 用户把画布折叠
   * 起来之后,对话仍然是 420 宽,右边留一整片空背景,看起来像"折叠没生效、还留了个画布占位"。
   *
   * 折叠 = 没有画布了 = 对话回到 `flex-1`。同一件事不该有两种说法。
   */
  const canvasFirst = !mainColumnFills({ exclusive: exclusivePanel, panelFullscreen: rightFullscreen, panelOpen: rightOpen });
  const sharedTabs: Record<"translation" | "browser", ContextPanelTab> = {
    translation: { id: "translation", label: t("translationPanelTitle"), icon: Languages },
    browser: { id: "browser", label: t("browserPanelTitle"), icon: Globe },
  };
  const contextPanelTabs: ContextPanelTab[] = [
    ...contextPanelDefinition.tabs.map(({ labelKey, ...tab }) => ({ ...tab, label: t(labelKey) })),
    ...sharedContextPanelViews(selectedWorkbenchId).map((view) => sharedTabs[view as "translation" | "browser"]),
  ];
  const revealTranslationPanel = () => {
    setContextView("translation");
    setRightOpen(true);
  };
  /**
   * 换完设计体系之后,替用户把那一轮对话开起来。
   *
   * 直接走 `promptSession` 而不是往输入框里塞字:这是用户按了确认按钮的**动作**,不是给他起草
   * 一句话。消息的内容在 `reskin-prompt.ts` 里拼 —— 那是这个功能真正起作用的地方。
   *
   * 消息由运行时落库、并作为事件回到对话流,所以它会出现;这里不额外造待发气泡(那要把
   * ThreadView 的待发队列也接过来,而多一处状态就多一处会对不上的地方)。
   */
  const startReskin = async (
    sessionId: string,
    input: { designDir: string; frameCount: number; styleName: string },
  ): Promise<void> => {
    if (!client) return;
    const parts = reskinPromptParts({
      designDir: input.designDir,
      frameCount: input.frameCount,
      styleName: input.styleName,
      text: fillReskinText(t("designStyleReskinMessage"), input),
    });
    await client.promptSession(sessionId, parts, createUserMessageSubmission());
  };

  const addWorkspaceReference = (reference: InlineWorkspaceReferenceToken) => {
    setPendingWorkspaceReferences((current) => current.some((item) => item.path === reference.path) ? current : [...current, reference]);
    setRightOpen(true);
  };
  const contextPanel = (
    <SessionContextPanel
      collapsed={!rightOpen}
      fullscreen={rightFullscreen}
      layout={exclusivePanel ? "fill" : "fixed"}
      /*
        「设计画布」这一行不展示。它只有一个页签、名字也不再说出任何东西 —— 而它占掉的是画布
        的高度。**只对铺满型工作台这么做**:别的工作台那行还有内容可读(比如对话的「产物」),
        而它们的面板里也确实可能有多个页签要切。
      */
      showTabStrip={!exclusivePanel}
      leftSidebarWidth={leftOpen ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH}
      mainWidth={designThreadWidth}
      minimumMainWidth={canvasFirst ? DESIGN_THREAD_MIN_WIDTH : THREAD_COLUMN_MIN_WIDTH}
      onMainWidthChange={setDesignThreadWidth}
      onFullscreen={() => setRightFullscreen((value) => !value)}
      onViewChange={setContextView}
      onToggle={() => {
        setRightFullscreen(false);
        setRightOpen(false);
      }}
      contentClassName={selectedWorkbenchId === "analysis" || selectedWorkbenchId === "conversation" || contextView === "browser" || contextView === "design" ? "overflow-hidden" : undefined}
      showFooter={
        selectedWorkbenchId !== "analysis" &&
        selectedWorkbenchId !== "conversation" &&
        // 画布的页脚只是把那个页签名再写一遍 —— 与上面隐藏页签行同一个理由。
        !exclusivePanel
      }
      showMenu={selectedWorkbenchId !== "analysis" && selectedWorkbenchId !== "conversation"}
      tabs={contextPanelTabs}
      renderContent={(view) => view === "browser"
        ? <BrowserPanel sessionId={activeSession?.id ?? null} />
        : view === "design" && activeSession
        ? (
            /*
              把既有的工作区引用通道接进画布:帧就是文件,所以"引用这一帧"与"引用这个文件"
              是同一件事,不该另立一种引用类型(见 `frame-reference.ts`)。
            */
            <DesignWorkspace
              onAttachFile={addWorkspaceReference}
              onReskin={(input) => void startReskin(activeSession.id, input)}
              running={runningSessionIds.has(activeSession.id)}
              sessionId={activeSession.id}
            />
          )
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
        {/*
          铺满型工作台(设计画布)下这一列的 flex 角色是**反过来的**:对话定宽,画布吃掉剩下的。
          DOM 顺序不变 —— 左侧仍是对话、右侧仍是画布,只是谁伸缩换了。
        */}
        <section
          className={
            showSessionTools && rightFullscreen
              ? "hidden"
              : `relative flex min-w-0 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)] ${canvasFirst ? "shrink-0" : "flex-1 lg:min-w-[640px]"}`
          }
          style={{
            ...(canvasFirst ? { flex: "0 0 auto", width: designThreadWidth } : {}),
            "--thread-content-max-width": rightOpen ? "820px" : "clamp(820px, 78%, 1180px)",
          } as CSSProperties}
        >
          {showSessionTools ? <header className="flex h-[62px] shrink-0 items-center justify-between px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex items-center gap-2 lg:hidden"><img alt="" className="h-7 w-7 shrink-0 rounded-[20%] object-cover ring-1 ring-black/10 dark:ring-white/15" draggable={false} src={wordlessIcon} /><span className="text-sm font-bold tracking-[-0.04em]">wordless</span></div>
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
