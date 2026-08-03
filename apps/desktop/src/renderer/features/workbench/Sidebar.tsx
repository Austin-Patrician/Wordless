import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { Bell, ChevronDown, ChevronLeft, Cloud, Command, Ellipsis, Folder, FolderOpen, Images, LoaderCircle, LogIn, LogOut, Pin, PinOff, Search, Settings, Trash2, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionRecord } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import folderIcon from "../../../icons/common-icons/floder.svg";
import wordlessIcon from "../../../icons/common-icons/wordless.png";
import { AgentEntryIcon } from "./AgentEntryIcon";
import { SessionSearchDialog } from "./SessionSearchDialog";
import { useDesktopAccount } from "../../shared/account";
import type { SettingsPage } from "../settings/SettingsDialog";

type SidebarProps = {
  collapsed: boolean;
  onNewThread: () => void;
  onOpenMedia: () => void;
  onOpenSettings: (page?: SettingsPage) => void;
  onOpenSkills: () => void;
  onOpenSession: (sessionId: string) => void;
  onSessionDeleted: (sessionId: string) => void;
  onToggle: () => void;
  selectedSessionId: string | null;
  mediaActive: boolean;
  skillsActive: boolean;
};

function sortSessions(sessions: SessionRecord[]): SessionRecord[] {
  return [...sessions].sort((left, right) => {
    if (left.pinnedAt !== null && right.pinnedAt === null) return -1;
    if (left.pinnedAt === null && right.pinnedAt !== null) return 1;
    if (left.pinnedAt !== null && right.pinnedAt !== null && left.pinnedAt !== right.pinnedAt) return right.pinnedAt - left.pinnedAt;
    return right.updatedAt - left.updatedAt;
  });
}

function relativeTime(timestamp: number, locale: "zh-CN" | "en-US"): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (elapsed < 60_000) return formatter.format(0, "second");
  if (elapsed < 3_600_000) return formatter.format(-Math.floor(elapsed / 60_000), "minute");
  if (elapsed < 86_400_000) return formatter.format(-Math.floor(elapsed / 3_600_000), "hour");
  return formatter.format(-Math.floor(elapsed / 86_400_000), "day");
}

type SessionRowProps = {
  active: boolean;
  editingTitle: string | null;
  entryIconKey?: string;
  onDelete: (session: SessionRecord) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onEditTitleChange: (title: string) => void;
  onOpen: (session: SessionRecord) => void;
  onOpenFolder: (session: SessionRecord) => void;
  onRename: (session: SessionRecord) => void;
  onSetPinned: (session: SessionRecord, pinned: boolean) => void;
  session: SessionRecord;
  timeLabel: string;
  t: ReturnType<typeof usePreferences>["t"];
};

function SessionRow({ active, editingTitle, entryIconKey, onDelete, onEditCancel, onEditSave, onEditTitleChange, onOpen, onOpenFolder, onRename, onSetPinned, session, timeLabel, t }: SessionRowProps) {
  const editing = editingTitle !== null;
  const renameInputRef = useRef<HTMLInputElement>(null);
  const rowClassName = editing
    ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-[#2a2c22]"
    : active
      ? "bg-[#edf4d9] text-[#39471d] shadow-[0_1px_2px_rgba(59,74,29,0.08)] dark:bg-[#303b1d] dark:text-[#e5f6b8]"
      : "hover:bg-[#e7e7e3] dark:hover:bg-[#282a21]";
  const contentClassName = active && !editing
    ? "text-[#39471d] dark:text-[#e5f6b8]"
    : "text-[#4d4d48] dark:text-muted-foreground";
  const timeClassName = active && !editing
    ? "text-[#73834b] dark:text-[#bed18f]"
    : "text-[#a1a19a] dark:text-muted-foreground";

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  return (
    <div className={`group relative flex min-w-0 items-center rounded-[8px] ${rowClassName}`}>
      <div className={`flex h-8 min-w-0 flex-1 items-center gap-2 px-3 text-left text-[12px] ${contentClassName}`}>
        <AgentEntryIcon className={active ? "opacity-100" : "opacity-70 transition-opacity group-hover:opacity-100"} iconKey={entryIconKey} />
        {editing ? <input className="h-5 min-w-0 flex-1 rounded-[3px] border border-[#6f6f6a] bg-white px-1 text-[12px] text-[#242421] outline-none dark:bg-card dark:text-foreground" maxLength={120} onBlur={onEditCancel} onChange={(event) => onEditTitleChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onEditSave(); } if (event.key === "Escape") { event.preventDefault(); onEditCancel(); } }} ref={renameInputRef} value={editingTitle} /> : <button className="min-w-0 flex-1 truncate text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(session)} type="button">{session.title}</button>}
        {session.pinnedAt !== null && !editing ? <Pin aria-label={t("pinSession")} className="h-2.5 w-2.5 shrink-0 text-[#738847] dark:text-[#bad47a]" /> : null}
        <span className={`shrink-0 pr-1 font-mono text-[10px] ${timeClassName} ${editing ? "opacity-100" : "group-hover:opacity-0"}`}>{timeLabel}</span>
      </div>
      {!editing ? <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label={t("sessionActions")} className="absolute right-1 grid h-6 w-6 place-items-center rounded-[5px] text-[#7a7a73] opacity-0 outline-none hover:bg-[#ecece7] group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-muted" type="button">
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuItem onSelect={() => onOpenFolder(session)}><FolderOpen className="h-3.5 w-3.5" />{t("openFolder")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRename(session)}><Pencil className="h-3.5 w-3.5" />{t("rename")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSetPinned(session, session.pinnedAt === null)}>{session.pinnedAt === null ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}{session.pinnedAt === null ? t("pinSession") : t("unpinSession")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:bg-[#f8efeb] focus:text-destructive dark:focus:bg-destructive/15" onSelect={() => onDelete(session)}><Trash2 className="h-3.5 w-3.5" />{t("delete")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu> : null}
    </div>
  );
}

function SessionDeleteConfirm({ error, onCancel, onConfirm, saving, session, t }: { error: string | null; onCancel: () => void; onConfirm: () => void; saving: boolean; session: SessionRecord | null; t: ReturnType<typeof usePreferences>["t"] }) {
  useEffect(() => {
    if (!session) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, session]);

  if (!session) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/35 px-4" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}>
      <section aria-describedby="delete-session-description" aria-labelledby="delete-session-title" aria-modal="true" className="w-full max-w-[360px] rounded-[8px] border border-[#3b3b38] bg-white p-4 text-[#242421] shadow-[0_18px_42px_rgba(0,0,0,0.24)] dark:border-border dark:bg-card dark:text-foreground" role="alertdialog">
        <h2 className="text-[15px] font-bold" id="delete-session-title">{t("deleteSession")}</h2>
        <p className="mt-3 text-[13px] leading-5 text-[#454540] dark:text-muted-foreground" id="delete-session-description">{t("deleteSessionHelp")}</p>
        {error ? <p className="mt-3 rounded-[6px] border border-[#ebccc4] bg-[#fdf4f1] px-3 py-2 text-[11px] leading-4 text-[#a65749] dark:border-[#613f37] dark:bg-[#2b201d] dark:text-[#efb0a3]" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2"><Button className="h-9 px-4" onClick={onCancel} type="button" variant="outline">{t("cancel")}</Button><Button className="h-9 bg-[#ff4d55] px-4 text-white hover:bg-[#e83e46]" disabled={saving} onClick={onConfirm} type="button">{t("delete")}</Button></div>
      </section>
    </div>,
    document.body,
  );
}

function SidebarActionNotice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return createPortal(
    <div aria-live="polite" className="fixed bottom-5 right-5 z-[130] flex max-w-[360px] items-start gap-2 rounded-[8px] border border-[#e4c9c2] bg-white px-3 py-2.5 text-[11px] leading-4 text-[#9b5145] shadow-[0_10px_26px_rgba(0,0,0,0.14)] dark:border-[#613f37] dark:bg-card dark:text-[#efb0a3]" role="status"><span className="min-w-0 flex-1">{message}</span><button aria-label="Dismiss" className="grid h-4 w-4 shrink-0 place-items-center text-[#9b5145]/70 hover:text-[#71352c] dark:text-[#efb0a3]/70 dark:hover:text-[#ffd0c9]" onClick={onDismiss} type="button"><X className="h-3 w-3" /></button></div>,
    document.body,
  );
}

export function Sidebar({ collapsed, mediaActive, onNewThread, onOpenMedia, onOpenSettings, onOpenSession, onSessionDeleted, onOpenSkills, onToggle, selectedSessionId, skillsActive }: SidebarProps) {
  const client = useRuntimeClient();
  const { refresh, snapshot } = useRuntime();
  const { locale, t } = usePreferences();
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<SessionRecord | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<SessionRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const sessions = (snapshot?.sessions ?? []).filter((session) => session.workbenchId !== "media-canvas");
  const workspaces = snapshot?.workspaces ?? [];
  const entries = snapshot?.entries ?? [];
  const entryIconKeys = useMemo(() => new Map(entries.map((entry) => [entry.id, entry.iconKey])), [entries]);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId);
  const recentSessions = useMemo(() => sortSessions(sessions.filter((session) => session.workspaceId === null)), [sessions]);
  const workspaceGroups = useMemo(
    () => workspaces
      .map((workspace) => ({ workspace, sessions: sortSessions(sessions.filter((session) => session.workspaceId === workspace.id)) }))
      .filter((group) => group.sessions.length > 0),
    [sessions, workspaces],
  );

  useEffect(() => {
    if (!selectedSession?.workspaceId) return;
    setExpandedWorkspaceIds((current) => current.has(selectedSession.workspaceId!) ? current : new Set([...current, selectedSession.workspaceId!]));
  }, [selectedSession?.workspaceId]);

  const run = async (operation: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    try {
      await operation();
      await refresh();
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const openSession = (session: SessionRecord) => {
    if (session.workspaceId) setExpandedWorkspaceIds((current) => new Set([...current, session.workspaceId!]));
    onOpenSession(session.id);
  };

  const beginRename = (session: SessionRecord) => {
    setActionError(null);
    setRenaming(session);
    setTitle(session.title);
  };

  const saveRename = async () => {
    if (!renaming) return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      setActionError(t("sessionTitleRequired"));
      return;
    }
    setSaving(true);
    const succeeded = await run(async () => await client.renameSession(renaming.id, nextTitle));
    setSaving(false);
    if (succeeded) setRenaming(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const session = deleting;
    setDeleteError(null);
    setSaving(true);
    try {
      await client.deleteSession(session.id);
      await refresh();
      setDeleting(null);
      onSessionDeleted(session.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setDeleteError(/\b(?:EBUSY|EPERM|ENOTEMPTY)\b/i.test(message) ? t("sessionDeleteInUse") : message);
    } finally {
      setSaving(false);
    }
  };

  const navItems = [
    { id: "new", label: t("newThread"), icon: Folder, onClick: onNewThread },
    { id: "media", label: t("imageVideoGeneration"), icon: Images, onClick: onOpenMedia },
    { id: "skills", label: "Skills & MCP", icon: Command, onClick: onOpenSkills },
  ];

  const sessionRow = (session: SessionRecord) => <SessionRow active={selectedSessionId === session.id} editingTitle={renaming?.id === session.id ? title : null} entryIconKey={entryIconKeys.get(session.entryId)} key={session.id} onDelete={(candidate) => { setDeleteError(null); setDeleting(candidate); }} onEditCancel={() => setRenaming(null)} onEditSave={() => void saveRename()} onEditTitleChange={setTitle} onOpen={openSession} onOpenFolder={(candidate) => void run(async () => await client.openSessionFolder(candidate.id))} onRename={beginRename} onSetPinned={(candidate, pinned) => void run(async () => await client.setSessionPinned(candidate.id, pinned))} session={session} t={t} timeLabel={relativeTime(session.updatedAt, locale)} />;

  return (
    <aside className={`hidden h-full min-h-0 shrink-0 flex-col border-r border-border bg-[var(--wordless-shell-sidebar)] py-4 transition-[width] duration-200 lg:flex ${collapsed ? "w-[58px] px-2" : "w-[238px] px-3"}`}>
      <div className={`flex shrink-0 items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
        <button className="flex min-w-0 items-center gap-2" onClick={onNewThread} type="button">
          <img alt="" className="h-7 w-7 shrink-0 rounded-[8px] object-cover transition-transform hover:rotate-3" draggable={false} src={wordlessIcon} />
          {!collapsed ? <span className="truncate text-[15px] font-bold tracking-[-0.04em]">wordless</span> : null}
        </button>
        {!collapsed ? <div className="flex items-center gap-1"><Button aria-label={t("searchTasks")} onClick={() => setSessionSearchOpen(true)} size="icon" type="button" variant="ghost"><Search className="h-4 w-4" /></Button><Button aria-label={t("collapseSidebar")} onClick={onToggle} size="icon" type="button" variant="ghost"><ChevronLeft className="h-4 w-4" /></Button></div> : null}
      </div>

      <nav aria-label="Primary navigation" className="mt-7 shrink-0 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = (item.id === "new" && selectedSessionId === null && !skillsActive && !mediaActive) || (item.id === "skills" && skillsActive) || (item.id === "media" && mediaActive);
          const button = <button className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${collapsed ? "justify-center" : ""} ${active ? "bg-[#e3e3df] text-foreground dark:bg-[#2a2c22]" : "text-[#4c4c47] hover:bg-[#e7e7e3] dark:text-muted-foreground dark:hover:bg-[#282a21] dark:hover:text-foreground"}`} onClick={item.onClick} type="button"><Icon className="h-[17px] w-[17px] shrink-0" />{!collapsed ? <span className="truncate">{item.label}</span> : null}</button>;
          return collapsed ? <Tooltip key={item.id}><TooltipTrigger asChild>{button}</TooltipTrigger><TooltipContent side="right">{item.label}</TooltipContent></Tooltip> : <div key={item.id}>{button}</div>;
        })}
      </nav>

      {!collapsed ? <div className="mt-7 min-h-0 flex-1 overflow-y-auto pr-1"><section><div className="mb-2 flex items-center justify-between px-3"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("recentThreads")}</p><span className="font-mono text-[10px] text-muted-foreground">{recentSessions.length.toString().padStart(2, "0")}</span></div><div className="space-y-1">{recentSessions.map(sessionRow)}</div></section><section className="mt-6"><div className="mb-2 flex items-center justify-between px-3"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t("yourSpace")}</p><span className="font-mono text-[10px] text-muted-foreground">{workspaceGroups.length.toString().padStart(2, "0")}</span></div><div className="space-y-2">{workspaceGroups.map(({ workspace, sessions: workspaceSessions }) => {
        const expanded = expandedWorkspaceIds.has(workspace.id);
        return <section key={workspace.id}><button aria-expanded={expanded} className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[11px] text-[#4f4f4a] outline-none hover:bg-[#e7e7e3] focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:bg-[#282a21]" onClick={() => setExpandedWorkspaceIds((current) => { const next = new Set(current); if (next.has(workspace.id)) next.delete(workspace.id); else next.add(workspace.id); return next; })} type="button"><img alt="" className="h-3.5 w-3.5 shrink-0 opacity-75 dark:invert" src={folderIcon} /><span className="min-w-0 flex-1 truncate font-medium">{workspace.name}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} /></button>{expanded ? <div className="mt-0.5 space-y-1 pl-2">{workspaceSessions.map(sessionRow)}</div> : null}</section>;
      })}</div></section></div> : null}

      <div className={`mt-auto flex shrink-0 items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}><AccountMenu collapsed={collapsed} onOpenSettings={onOpenSettings} onToggle={onToggle} t={t} />{!collapsed ? <div className="flex gap-1"><Button aria-label={t("settings")} onClick={() => onOpenSettings()} size="icon" type="button" variant="ghost"><Settings className="h-4 w-4" /></Button><Button aria-label={t("notifications")} size="icon" type="button" variant="ghost"><Bell className="h-4 w-4" /></Button></div> : null}</div>

      <SessionDeleteConfirm error={deleteError} onCancel={() => { setDeleteError(null); setDeleting(null); }} onConfirm={() => void confirmDelete()} saving={saving} session={deleting} t={t} />
      <SessionSearchDialog entries={entries} onOpenChange={setSessionSearchOpen} onSelectSession={openSession} open={sessionSearchOpen} sessions={sessions} workspaces={workspaces} />
      <SidebarActionNotice message={actionError} onDismiss={() => setActionError(null)} />
    </aside>
  );
}

function AccountMenu({ collapsed, onOpenSettings, onToggle, t }: { collapsed: boolean; onOpenSettings: (page?: SettingsPage) => void; onToggle: () => void; t: ReturnType<typeof usePreferences>["t"] }) {
  const { account, error, login, logout, operation } = useDesktopAccount();
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [account?.pictureUrl]);
  const signedIn = account?.status === "signed-in" || account?.status === "needs-login";
  const label = signedIn ? account?.name ?? account?.email ?? t("accountSignIn") : t("accountSignIn");
  const initials = (account?.name || account?.email || "W").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const avatar = account?.pictureUrl && !imageFailed ? <img alt="" className="h-full w-full object-cover" onError={() => setImageFailed(true)} src={account.pictureUrl} /> : <span>{signedIn ? initials : "W"}</span>;

  if (collapsed) return <button aria-label={t("accountMenu")} className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-[#d9efaa] text-[10px] font-extrabold text-[#314008] hover:ring-2 hover:ring-ring" onClick={onToggle} type="button">{avatar}</button>;

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button aria-label={t("accountMenu")} className="flex min-w-0 items-center gap-2 rounded-lg p-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" type="button">
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-[#d9efaa] text-[10px] font-extrabold text-[#314008]">{avatar}</span>
        <span className="min-w-0 truncate text-xs font-semibold">{label}</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" className="w-[260px]">
      <div className="border-b border-border px-2.5 pb-2.5 pt-1">
        <p className="truncate text-[12px] font-semibold">{label}</p>
        {account?.email ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{account.email}</p> : null}
        <p className="mt-1 text-[10px] text-muted-foreground">{account?.status === "needs-login" ? t("accountNeedsLogin") : account?.status === "signed-in" ? t("accountSignedIn") : t("accountSignInHelp")}</p>
      </div>
      {account?.status === "signed-in" ? <DropdownMenuItem onSelect={() => onOpenSettings("dataPrivacy")}><Cloud className="h-3.5 w-3.5" />{t("accountCloudSync")}</DropdownMenuItem> : null}
      {account?.status === "signed-in" ? <DropdownMenuItem disabled={operation !== "idle"} onSelect={() => void logout()}><LogOut className="h-3.5 w-3.5" />{operation === "signing-out" ? t("accountSigningOut") : t("accountSignOut")}</DropdownMenuItem> : <DropdownMenuItem disabled={operation !== "idle"} onSelect={() => void login()}><LogIn className="h-3.5 w-3.5" />{operation === "signing-in" ? t("accountSigningIn") : t("accountSignInWithGoogle")}</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => onOpenSettings()}><Settings className="h-3.5 w-3.5" />{t("settings")}</DropdownMenuItem>
      {operation !== "idle" ? <div className="flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-muted-foreground"><LoaderCircle className="h-3 w-3 animate-spin" />{operation === "signing-in" ? t("accountSigningIn") : t("accountSigningOut")}</div> : null}
      {error ? <p className="border-t border-border px-2.5 py-2 text-[10px] leading-4 text-destructive">{error}</p> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}
