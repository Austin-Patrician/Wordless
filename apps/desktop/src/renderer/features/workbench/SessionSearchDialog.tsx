import { Button, Dialog, DialogContent, DialogTitle } from "@wordless/ui-kit";
import type { SessionRecord, WorkbenchEntryDefinition, WorkspaceRecord } from "@wordless/domain";
import { CalendarClock, Clock3, Folder, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePreferences } from "../../shared/preferences";
import { searchSidebarSessions } from "./session-search";
import { AgentEntryIcon } from "./AgentEntryIcon";

type SessionSearchDialogProps = {
  entries: readonly WorkbenchEntryDefinition[];
  onOpenChange: (open: boolean) => void;
  onSelectSession: (session: SessionRecord) => void;
  open: boolean;
  sessions: readonly SessionRecord[];
  workspaces: readonly WorkspaceRecord[];
};

export function SessionSearchDialog({ entries, onOpenChange, onSelectSession, open, sessions, workspaces }: SessionSearchDialogProps) {
  const { reduceMotion, t } = usePreferences();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const results = useMemo(() => searchSidebarSessions(sessions, query), [query, sessions]);
  const workspaceNames = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])), [workspaces]);
  const entryIconKeys = useMemo(() => new Map(entries.map((entry) => [entry.id, entry.iconKey])), [entries]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    resultRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [reduceMotion, results.length, selectedIndex]);

  const selectSession = (session: SessionRecord) => {
    onSelectSession(session);
    onOpenChange(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const session = results[selectedIndex];
      if (session) selectSession(session);
    }
  };

  return <Dialog onOpenChange={onOpenChange} open={open}>
    <DialogContent aria-describedby={undefined} className="top-[calc(50%+15px)] flex h-[min(560px,calc(100dvh-54px))] w-[min(500px,calc(100vw-24px))] flex-col rounded-[8px] border-[#d9d9d4] bg-[#fcfcfa] p-0 font-['Manrope','Noto_Sans_SC',sans-serif] shadow-[0_22px_60px_rgba(28,28,24,0.2)] dark:border-border dark:bg-card" onKeyDown={onKeyDown} overlayClassName="bottom-0 top-[30px]" showCloseButton={false}>
      <DialogTitle className="sr-only">{t("searchTasks")}</DialogTitle>
      <header className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-4">
        <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-[#f1f1ef] px-3 text-[#777771] dark:bg-muted dark:text-muted-foreground">
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <label className="sr-only" htmlFor="sidebar-session-search">{t("searchTasks")}</label>
          <input autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[12px] text-[#33332f] outline-none placeholder:text-[#a1a19a] dark:text-foreground" id="sidebar-session-search" onChange={(event) => setQuery(event.target.value)} placeholder={t("searchTasksPlaceholder")} ref={inputRef} value={query} />
        </div>
        <Button aria-label={t("closeTaskSearch")} className="h-8 w-8 shrink-0 text-[#676761] hover:bg-[#f0f0ed] hover:text-[#292925] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground" onClick={() => onOpenChange(false)} size="icon" type="button" variant="ghost"><X className="h-4 w-4" /></Button>
      </header>
      <section className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <p className="shrink-0 px-2 pb-2 pt-1 text-[10px] font-semibold text-[#a0a099] dark:text-muted-foreground">{query.trim() ? t("taskSearchResults") : t("recentTasks")}</p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.length > 0 ? <div aria-label={query.trim() ? t("taskSearchResults") : t("recentTasks")} role="listbox">{results.map((session, index) => {
            const workspaceName = session.workspaceId ? workspaceNames.get(session.workspaceId) : undefined;
            const source = workspaceName ?? (session.workspaceId ? t("noWorkspace") : t("recentThreads"));
            const SourceIcon = workspaceName ? Folder : Clock3;
            const isAutomation = session.source === "automation";
            return <button aria-selected={selectedIndex === index} className={`flex h-9 w-full min-w-0 items-center gap-2.5 rounded-[6px] px-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selectedIndex === index ? "bg-[#f0f1ed] dark:bg-muted" : "hover:bg-[#f5f5f2] dark:hover:bg-muted/60"}`} key={session.id} onClick={() => selectSession(session)} onMouseEnter={() => setSelectedIndex(index)} ref={(element) => { resultRefs.current[index] = element; }} role="option" type="button">{isAutomation ? <CalendarClock className={`h-3.5 w-3.5 shrink-0 ${selectedIndex === index ? "opacity-100" : "opacity-70"}`} /> : <AgentEntryIcon className={selectedIndex === index ? "opacity-100" : "opacity-70"} iconKey={entryIconKeys.get(session.entryId)} />}<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#3d3d38] dark:text-foreground" title={session.title}>{session.title}</span><span className="flex max-w-[155px] shrink-0 items-center gap-1.5 text-[10px] text-[#aaa9a2] dark:text-muted-foreground" title={source}><SourceIcon className="h-3 w-3 shrink-0 stroke-[1.5]" /><span className="truncate">{source}</span></span></button>;
          })}</div> : <div className="grid h-full min-h-[220px] place-items-center px-6 text-center"><div><Search aria-hidden className="mx-auto h-5 w-5 text-[#aaa9a2] dark:text-muted-foreground" /><p className="mt-3 text-[12px] font-semibold text-[#55554f] dark:text-foreground">{t("noMatchingSessions")}</p><p className="mt-1 text-[11px] text-[#92928b] dark:text-muted-foreground">{t("noMatchingSessionsHelp")}</p></div></div>}
        </div>
      </section>
    </DialogContent>
  </Dialog>;
}
