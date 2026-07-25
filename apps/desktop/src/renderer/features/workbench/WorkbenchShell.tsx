import { Button } from "@wordless/ui-kit";
import { AlertTriangle, ChevronLeft, History, LoaderCircle, Search, Settings, Workflow } from "lucide-react";
import { useState } from "react";
import { SessionContextPanel } from "../artifacts/SessionContextPanel";
import { SettingsDialog, type SettingsPage } from "../settings/SettingsDialog";
import { ThreadView } from "../thread/ThreadView";
import type { WorkspaceAttachment } from "../thread/Composer";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import { workbenchContextPanelRegistry } from "./context-panel-registry";
import type { ContextPanelView } from "../artifacts/CodingContextPanel";
import { WelcomeView } from "./WelcomeView";
import { Sidebar } from "./Sidebar";
import { SkillsView } from "../skills/SkillsView";
import { SkillImportDialog } from "../skills/SkillImportDialog";
import { MediaCanvas } from "../media/MediaCanvas";
import { MediaLibrary } from "../media/MediaLibrary";
import { AppBackgroundLayer } from "../appearance/AppBackgroundLayer";
import wordlessIcon from "../../../icons/common-icons/wordless.png";

export function WorkbenchShell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [contextView, setContextView] = useState<ContextPanelView>("overview");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<"thread" | "skills" | "media">("thread");
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>([]);
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const { t } = usePreferences();
  const { client, error, refresh, snapshot, status } = useRuntime();

  const newThread = () => {
    setAttachments([]);
    setSelectedSessionId(null);
    setMainView("thread");
    setRightOpen(false);
    setRightFullscreen(false);
  };
  const openSkills = () => {
    setMainView("skills");
    setRightOpen(false);
    setRightFullscreen(false);
  };
  const openMedia = () => {
    setSelectedSessionId(null);
    setMainView("media");
    setRightOpen(false);
    setRightFullscreen(false);
  };
  const openSettings = (page: SettingsPage = "general") => {
    setSettingsPage(page);
    setSettingsOpen(true);
  };
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
        <div className="flex h-[30px] items-center border-b border-black/[0.055] bg-[var(--wordless-shell-titlebar)] px-3 pr-[142px] text-[11px] text-[#30302e] [-webkit-app-region:drag] dark:border-white/[0.07] dark:text-foreground">
          <span className="flex items-center gap-1.5 font-semibold"><span className="size-1.5 rounded-full bg-[#1f2933] dark:bg-[#eef4dc]" />{t("appName")}</span>
        </div>
        <section className="grid h-[calc(100vh-30px)] place-items-center bg-[var(--wordless-shell-workspace)] px-6">
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
  const ContextPanelContent = workbenchContextPanelRegistry.resolve(activeSession?.workbenchId);
  const addAttachment = (attachment: WorkspaceAttachment) => {
    setAttachments((current) => current.some((item) => item.path === attachment.path) ? current : [...current, attachment]);
    setRightOpen(true);
  };
  const contextPanel = (
    <SessionContextPanel
      collapsed={!rightOpen}
      fullscreen={rightFullscreen}
      onFullscreen={() => setRightFullscreen((value) => !value)}
      onViewChange={setContextView}
      onToggle={() => {
        setRightFullscreen(false);
        setRightOpen(false);
      }}
      renderContent={(view) => activeSession
        ? <ContextPanelContent onAttachFile={addAttachment} onViewChange={setContextView} sessionId={activeSession.id} view={view} />
        : <div className="p-4 text-[12px] text-muted-foreground">Select a session to view its context.</div>}
      view={contextView}
    />
  );

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-transparent text-foreground">
      <AppBackgroundLayer />
      <div className="relative z-10 flex min-h-screen flex-col">
      <div className="flex h-[30px] items-center border-b border-black/[0.055] bg-[var(--wordless-shell-titlebar)] px-3 pr-[142px] text-[11px] text-[#30302e] [-webkit-app-region:drag] dark:border-white/[0.07] dark:text-foreground">
        <div className="flex h-full items-center gap-2.5">
          <span className="flex items-center gap-1.5 font-semibold"><span className="size-1.5 rounded-full bg-[#1f2933] dark:bg-[#eef4dc]" />{t("appName")}</span>
          <nav aria-label="Application menu" className="flex h-full items-center gap-0.5 [-webkit-app-region:no-drag]">
            <button className="h-full px-1.5 text-left transition-colors hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10" type="button">{t("file")}</button>
            <button className="h-full px-1.5 text-left transition-colors hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10" type="button">{t("edit")}</button>
            <button className="h-full px-1.5 text-left transition-colors hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10" type="button">{t("window")}</button>
            <button className="h-full px-1.5 text-left transition-colors hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10" type="button">{t("help")}</button>
          </nav>
        </div>
      </div>
      <div className="flex h-[calc(100vh-30px)] overflow-hidden">
        {showSessionTools && rightFullscreen ? contextPanel : <>
        <Sidebar collapsed={!leftOpen} mediaActive={mainView === "media"} onNewThread={newThread} onOpenMedia={openMedia} onOpenSession={(sessionId) => { const session = snapshot.sessions.find((candidate) => candidate.id === sessionId); setAttachments([]); setSelectedSessionId(sessionId); setMainView(session?.workbenchId === "media-canvas" ? "media" : "thread"); setRightFullscreen(false); }} onOpenSettings={() => openSettings()} onOpenSkills={openSkills} onSessionDeleted={(sessionId) => { if (selectedSessionId === sessionId) newThread(); }} onToggle={() => setLeftOpen((value) => !value)} selectedSessionId={selectedSessionId} skillsActive={mainView === "skills"} />
        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--wordless-shell-workspace)]">
          {showSessionTools ? <header className="flex h-[62px] shrink-0 items-center justify-between px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex items-center gap-2 lg:hidden"><img alt="" className="h-7 w-7 shrink-0 rounded-[8px] object-cover" draggable={false} src={wordlessIcon} /><span className="text-sm font-bold tracking-[-0.04em]">wordless</span></div>
              <div className="hidden min-w-0 items-center gap-2 lg:flex">
                {!leftOpen ? <Button aria-label="Expand sidebar" onClick={() => setLeftOpen(true)} size="icon" type="button" variant="ghost"><ChevronLeft className="h-4 w-4 rotate-180" /></Button> : null}
                <span className="truncate text-[13px] font-semibold text-[#20201f] dark:text-foreground">{activeSession.title}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button aria-label={t("search")} size="icon" type="button" variant="ghost"><Search className="h-4 w-4" /></Button>
              <Button aria-label="Thread history" size="icon" type="button" variant="ghost"><History className="h-4 w-4" /></Button>
              <Button aria-label={t("generatedItems")} onClick={() => setRightOpen((value) => !value)} size="icon" type="button" variant="ghost"><Workflow className="h-4 w-4" /></Button>
              <Button aria-label={t("settings")} onClick={() => openSettings()} size="icon" type="button" variant="ghost"><Settings className="h-4 w-4" /></Button>
            </div>
          </header> : null}
          {mainView === "skills" ? <SkillsView onOpenImport={() => setSkillImportOpen(true)} /> : mainView === "media" ? selectedSessionId && activeSession?.workbenchId === "media-canvas" ? <MediaCanvas leftOpen={leftOpen} onBackToLibrary={() => setSelectedSessionId(null)} onOpenModels={() => openSettings("models")} onToggleLeft={() => setLeftOpen((value) => !value)} sessionId={selectedSessionId} /> : <MediaLibrary onOpenProject={(sessionId) => { setSelectedSessionId(sessionId); setMainView("media"); }} /> : selectedSessionId ? <ThreadView attachments={attachments} onAttachmentsConsumed={() => setAttachments([])} onOpenModels={() => openSettings("models")} onOpenSkillImport={() => setSkillImportOpen(true)} onOpenSkills={openSkills} onRemoveAttachment={(path) => setAttachments((current) => current.filter((attachment) => attachment.path !== path))} sessionId={selectedSessionId} /> : <WelcomeView onOpenModels={() => openSettings("models")} onOpenSkillImport={() => setSkillImportOpen(true)} onOpenSkills={openSkills} onSessionCreated={(sessionId) => { setAttachments([]); setSelectedSessionId(sessionId); }} />}
        </section>
        {showSessionTools ? contextPanel : null}
        </>}
      </div>
      <SettingsDialog initialPage={settingsPage} onOpenChange={setSettingsOpen} open={settingsOpen} />
      <SkillImportDialog onImport={importSkill} onOpenChange={setSkillImportOpen} open={skillImportOpen} />
      </div>
    </main>
  );
}
