import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@wordless/ui-kit";
import { ArchiveX, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ChevronRight as ChevronCollapsed, CircleAlert, FolderOpen, Layers, List, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionRecord } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import { relativeTimeFrom } from "../../shared/relative-time";
import {
  CONTENT_SEARCH_LIMIT,
  DEFAULT_HISTORY_PAGE_SIZE,
  contentSearchTargets,
  distinctWorkbenchIds,
  EMPTY_HISTORY_FILTERS,
  filterSessions,
  formatBytes,
  groupSessionsByWorkspace,
  growGroupLimit,
  GROUP_PAGE_SIZE,
  GROUP_SESSION_CAP,
  HISTORY_PAGE_SIZES,
  initiallyExpandedGroups,
  HISTORY_SORTS,
  isEverySelected,
  paginate,
  retainExistingSelection,
  shouldSearchContent,
  toggleGroupKey,
  UNASSIGNED_GROUP_KEY,
  type HistoryView,
  type SessionGroup,
  sortSessions,
  toggleEverySelection,
  toggleSelection,
  totalUsage,
  workbenchLabelKey,
  type HistoryPageSize,
  type HistorySort,
} from "./session-history";

type ContentMatch = { sessionId: string; count: number };

/**
 * Browses and manages every local session. Deletion removes the files the app
 * owns (journal, attachments, artifacts) and is not recoverable inside
 * Wordless — the host routes removal through the OS trash where it can, and the
 * confirmation lists exactly what will go.
 */
export function SessionHistorySettings({ onOpenSession }: { onOpenSession?: (sessionId: string) => void }) {
  const { client, refresh, snapshot } = useRuntime();
  const { locale, t } = usePreferences();
  const [filters, setFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [sort, setSort] = useState<HistorySort>("recent-activity");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<HistoryPageSize>(DEFAULT_HISTORY_PAGE_SIZE);
  const [view, setView] = useState<HistoryView>("grouped");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [groupLimits, setGroupLimits] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [measuring, setMeasuring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentMatches, setContentMatches] = useState<ContentMatch[]>([]);
  const [searchingContent, setSearchingContent] = useState(false);
  const [purgeTargets, setPurgeTargets] = useState<string[] | null>(null);
  const [purgeProgress, setPurgeProgress] = useState<{ done: number; total: number } | null>(null);
  const searchRunRef = useRef(0);

  const sessions = snapshot?.sessions ?? [];
  const workspaces = snapshot?.workspaces ?? [];
  const workbenchIds = useMemo(() => distinctWorkbenchIds(sessions), [sessions]);

  const filtered = useMemo(
    () => sortSessions(filterSessions(sessions, filters), sort, usage),
    [filters, sessions, sort, usage],
  );
  // Grouping is only meaningful once the user actually has spaces. With none,
  // the view collapses back to the flat list and the toggle is hidden.
  const groupingAvailable = workspaces.length > 0;
  const effectiveView: HistoryView = groupingAvailable ? view : "flat";
  const grouped = effectiveView === "grouped";

  const groups = useMemo(
    () => (grouped ? groupSessionsByWorkspace(filtered, usage) : []),
    [filtered, grouped, usage],
  );
  const pagedGroups = useMemo(
    () => paginate(groups, page, GROUP_PAGE_SIZE),
    [groups, page],
  );
  const paged = useMemo(
    () => (grouped ? paginate(filtered, 1, Math.max(filtered.length, 1)) : paginate(filtered, page, pageSize)),
    [filtered, grouped, page, pageSize],
  );
  // "Select all" applies to the visible page; the selection itself survives
  // paging, so the bulk bar keeps counting across pages.
  // "Select all" always covers everything on the current page, including
  // groups the user has left collapsed.
  // Grouped mode pages by space, flat mode pages by session; the footer and the
  // reset effects read whichever is active.
  const currentPage = grouped ? pagedGroups.page : paged.page;
  const pageCount = grouped ? pagedGroups.pageCount : paged.pageCount;

  const visibleIds = useMemo(
    () => (grouped
      ? pagedGroups.items.flatMap((group) => group.sessions.map((session) => session.id))
      : paged.items.map((session) => session.id)),
    [grouped, paged, pagedGroups],
  );
  const totalBytes = useMemo(() => totalUsage(usage, sessions.map((s) => s.id)), [sessions, usage]);

  // Selection must never outlive the rows it points at.
  useEffect(() => {
    setSelected((current) => retainExistingSelection(current, sessions.map((session) => session.id)));
  }, [sessions]);

  // Sizes are measured in the background: walking every session's files is far
  // too slow to block the list on.
  useEffect(() => {
    setPage(1);
  }, [filters, sort, pageSize, effectiveView]);

  useEffect(() => {
    const current = grouped ? pagedGroups.page : paged.page;
    setPage((previous) => (previous === current ? previous : current));
  }, [grouped, paged.page, pagedGroups.page]);

  // Collapsing state is derived from the group list so it never keeps keys for
  // groups that no longer exist.
  const groupKeys = useMemo(() => groups.map((group) => group.key).join("|"), [groups]);
  useEffect(() => {
    setExpandedGroups((current) => {
      const valid = new Set(groups.map((group) => group.key));
      const filteredCurrent = new Set([...current].filter((key) => valid.has(key)));
      if (filteredCurrent.size > 0) return filteredCurrent;
      // First render for this set of groups: everything collapsed, unless there
      // is only one group, which would hide the whole page behind one row.
      return initiallyExpandedGroups(groups);
    });
    setGroupLimits({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKeys]);

  const measureKey = useMemo(() => sessions.map((session) => `${session.id}:${session.updatedAt}`).join(","), [sessions]);
  useEffect(() => {
    if (!client || sessions.length === 0) return;
    let active = true;
    setMeasuring(true);
    void client
      .getSessionStorageUsage()
      .then((result) => {
        if (active) setUsage(result);
      })
      .catch(() => {
        // Sizes are informative only; showing "—" beats failing the page.
      })
      .finally(() => {
        if (active) setMeasuring(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, measureKey]);

  // Content search parses journals, so it is debounced, capped and abandoned
  // when a newer query arrives.
  useEffect(() => {
    const run = ++searchRunRef.current;
    if (!client || !shouldSearchContent(filters.query)) {
      setContentMatches([]);
      setSearchingContent(false);
      return;
    }
    setSearchingContent(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        const matches: ContentMatch[] = [];
        for (const sessionId of contentSearchTargets(sessions)) {
          if (searchRunRef.current !== run) return;
          try {
            const result = await client.searchSessionMessages(sessionId, { query: filters.query.trim(), limit: 1 });
            if (result.total > 0) matches.push({ sessionId, count: result.total });
          } catch {
            // A single unreadable journal must not fail the whole search.
          }
        }
        if (searchRunRef.current !== run) return;
        setContentMatches(matches);
        setSearchingContent(false);
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [client, filters.query, sessions]);

  const confirmDelete = async () => {
    if (!client || !purgeTargets) return;
    const targets = purgeTargets;
    setBusy(true);
    setError(null);
    setPurgeProgress({ done: 0, total: targets.length });
    try {
      const result = await client.deleteSessions(targets);
      if (result.failed.length) setError(result.failed.map((entry) => entry.error).join(" / "));
      setSelected(new Set());
      setPurgeTargets(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPurgeProgress(null);
      setBusy(false);
    }
  };

  /** Reveals the session folder in the OS file manager. */
  const revealFolder = async (sessionId: string) => {
    if (!client) return;
    setError(null);
    try {
      await client.openSessionFolder(sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const workspaceNameById = (workspaceId: string) =>
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? t("historyWorkspaceUnavailable");

  const workspaceUnavailable = (workspaceId: string) =>
    workspaces.find((workspace) => workspace.id === workspaceId)?.availability !== "available";

  const workbenchLabel = (id: string) => {
    const key = workbenchLabelKey(id);
    return key ? t(key) : id;
  };

  const workspaceName = (session: SessionRecord) => {
    if (!session.workspaceId) return t("historyNoWorkspace");
    return workspaces.find((workspace) => workspace.id === session.workspaceId)?.name ?? t("historyWorkspaceUnavailable");
  };

  const renderSessionRow = (session: SessionRecord, indent = false) => {
    const match = contentMatches.find((entry) => entry.sessionId === session.id);
    const bytes = usage[session.id];
    return (
      <div
        className={indent ? "flex items-center gap-3 px-3 py-2.5 pl-[38px]" : "flex items-center gap-3 px-3 py-2.5"}
        key={session.id}
      >
                  <input
                    aria-label={session.title}
                    checked={selected.has(session.id)}
                    className="h-3.5 w-3.5 shrink-0 accent-[#5d7a28]"
                    onChange={() => setSelected((current) => toggleSelection(current, session.id))}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-[#33332f] dark:text-foreground">{session.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-[#8a8a83] dark:text-muted-foreground">
                      <span className="rounded-[4px] bg-[#f1f1ec] px-1.5 py-0.5 dark:bg-muted">{workbenchLabel(session.workbenchId)}</span>
                      <span className="truncate">{workspaceName(session)}</span>
                      <span>{relativeTimeFrom(session.updatedAt, locale)}</span>
                      {match ? <span className="text-[#5d7a28] dark:text-[#c8df89]">{t("historyContentMatch").replace("{count}", String(match.count))}</span> : null}
                    </p>
                  </div>
                  <span className="w-[64px] shrink-0 text-right font-mono text-[10.5px] text-[#8a8a83] dark:text-muted-foreground">
                    {bytes === undefined ? "—" : formatBytes(bytes)}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {onOpenSession ? (
                      <Button
                        aria-label={t("historyOpen")}
                        className="text-[#6a6a63]"
                        disabled={busy}
                        onClick={() => onOpenSession(session.id)}
                        size="icon"
                        title={t("historyOpen")}
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    {/*
                      A folder icon has to reveal the folder: that is what it
                      means everywhere else in the app (Sidebar uses the same
                      icon for openFolder). Opening the session is a separate,
                      differently-shaped action above.
                    */}
                    <Button
                      aria-label={t("openFolder")}
                      className="text-[#6a6a63]"
                      disabled={busy}
                      onClick={() => void revealFolder(session.id)}
                      size="icon"
                      title={t("openFolder")}
                      type="button"
                      variant="ghost"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      aria-label={t("historyDelete")}
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => setPurgeTargets([session.id])}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
      </div>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
      <div className="mx-auto max-w-[920px] space-y-3">
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[#e0e0da] bg-white text-[#69794a] dark:border-border dark:bg-card dark:text-[#c8df89]">
                <ArchiveX className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[13px] font-semibold">{t("historyTitle")}</p>
                <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                  {t("historySummary")
                    .replace("{count}", String(sessions.length))
                    .replace("{size}", measuring && Object.keys(usage).length === 0 ? "…" : formatBytes(totalBytes))}
                </p>
              </div>
            </div>
            {sessions.length > 0 ? (
              <Button
                className="gap-1.5 text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setPurgeTargets(sessions.map((session) => session.id))}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("historyDeleteAll")}
              </Button>
            ) : null}
          </div>
        </section>

        {error ? (
          <p className="flex items-start gap-2 rounded-[10px] border border-[#e4c9c2] bg-[#fdf6f4] px-3 py-2 text-[11px] leading-5 text-[#9b5145] dark:border-[#613f37] dark:bg-[#2a1e1a] dark:text-[#efb0a3]" role="alert">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {groupingAvailable ? (
            <div className="flex shrink-0 rounded-[10px] border border-[#e4e4e0] bg-white p-0.5 dark:border-border dark:bg-card">
              {([["grouped", "historyViewGrouped", Layers], ["flat", "historyViewFlat", List]] as const).map(([mode, key, Icon]) => (
                <button
                  aria-pressed={effectiveView === mode}
                  className={`flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    effectiveView === mode
                      ? "bg-[#eef4dc] text-[#354210] dark:bg-[#303a1c] dark:text-[#e8f5c6]"
                      : "text-[#6a6a63] hover:bg-[#f4f4f1] dark:text-muted-foreground dark:hover:bg-muted"
                  }`}
                  key={mode}
                  onClick={() => setView(mode)}
                  type="button"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(key)}
                </button>
              ))}
            </div>
          ) : null}
          <label className="relative flex min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border border-[#e4e4e0] bg-white px-2.5 py-2 dark:border-border dark:bg-card">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#8d8d86]" />
            <input
              aria-label={t("historySearchPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[#33332f] outline-none placeholder:text-[#a1a19a] dark:text-foreground"
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder={t("historySearchPlaceholder")}
              value={filters.query}
            />
            {searchingContent ? <LoaderCircle aria-label={t("historySearchingContent")} className="h-3.5 w-3.5 shrink-0 animate-spin text-[#8d8d86]" /> : null}
            {filters.query ? (
              <button aria-label={t("historyClearSearch")} className="grid h-4 w-4 shrink-0 place-items-center rounded text-[#8d8d86] hover:bg-[#efefeb] dark:hover:bg-muted" onClick={() => setFilters((current) => ({ ...current, query: "" }))} type="button">
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </label>

          <Select onValueChange={(value) => setFilters((current) => ({ ...current, workspaceId: value === "__all" ? null : value }))} value={filters.workspaceId ?? "__all"}>
            <SelectTrigger aria-label={t("historyWorkspaceFilter")} className="w-[160px] rounded-[10px] border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("historyAllWorkspaces")}</SelectItem>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select onValueChange={(value) => setFilters((current) => ({ ...current, workbenchId: value === "__all" ? null : value }))} value={filters.workbenchId ?? "__all"}>
            <SelectTrigger aria-label={t("historyTypeFilter")} className="w-[140px] rounded-[10px] border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{t("historyAllTypes")}</SelectItem>
              {workbenchIds.map((id) => (
                <SelectItem key={id} value={id}>{workbenchLabel(id)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select onValueChange={(value) => setSort(value as HistorySort)} value={sort}>
            <SelectTrigger aria-label={t("historySortLabel")} className="w-[160px] rounded-[10px] border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HISTORY_SORTS.map((option) => (
                <SelectItem key={option} value={option}>{t(HISTORY_SORT_LABEL[option])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e0e0da] px-6 py-14 text-center dark:border-border">
            <ArchiveX className="mx-auto h-5 w-5 text-[#989891]" />
            <p className="mt-3 text-[12px] font-medium text-[#5d5d57] dark:text-foreground">
              {sessions.length === 0 ? t("historyEmptyTitle") : t("historyNoMatchTitle")}
            </p>
            <p className="mx-auto mt-1 max-w-[400px] text-[11px] leading-5 text-[#8a8a83] dark:text-muted-foreground">
              {sessions.length === 0 ? t("historyEmptyBody") : t("historyNoMatchBody")}
            </p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-2xl border border-[#e6e6e1] bg-white dark:border-border dark:bg-card">
            <header className="flex flex-wrap items-center gap-2 border-b border-[#ececE7] px-3 py-2 dark:border-border">
              <input
                aria-label={t("historySelectPageAll")}
                checked={isEverySelected(selected, visibleIds)}
                className="h-3.5 w-3.5 shrink-0 accent-[#5d7a28]"
                onChange={() => setSelected((current) => toggleEverySelection(current, visibleIds))}
                type="checkbox"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("historyCount").replace("{count}", String(filtered.length))}
              </span>
              {measuring ? <LoaderCircle aria-label={t("historyMeasuring")} className="h-3 w-3 animate-spin text-[#8d8d86]" /> : null}
              {grouped ? null : <Select onValueChange={(value) => setPageSize(Number(value) as HistoryPageSize)} value={String(pageSize)}>
                <SelectTrigger aria-label={t("historyPageSize")} className="ml-auto h-7 w-[104px] shrink-0 rounded-[8px] border-border bg-white px-2 text-left text-[11px] dark:bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HISTORY_PAGE_SIZES.map((size) => (
                    <SelectItem className="text-[11px]" key={size} value={String(size)}>
                      {t("historyPageSizeOption").replace("{count}", String(size))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>}
            </header>
            <div className="divide-y divide-[#f0f0EB] dark:divide-border">
              {grouped
                ? pagedGroups.items.map((group) => (
                  <div key={group.key}>
                    <GroupHeader
                      expanded={expandedGroups.has(group.key)}
                      groupSize={formatBytes(group.totalBytes)}
                      name={group.workspaceId === null ? t("historyUnassignedGroup") : workspaceNameById(group.workspaceId)}
                      onToggle={() => setExpandedGroups((current) => toggleGroupKey(current, group.key))}
                      sessionCount={group.sessions.length}
                      t={t}
                      unavailable={group.workspaceId !== null && workspaceUnavailable(group.workspaceId)}
                    />
                    {expandedGroups.has(group.key) ? (
                      <div className="divide-y divide-[#f6f6F2] dark:divide-border">
                        {group.sessions.slice(0, groupLimits[group.key] ?? GROUP_SESSION_CAP).map((session) => renderSessionRow(session, true))}
                        {group.sessions.length > (groupLimits[group.key] ?? GROUP_SESSION_CAP) ? (
                          <div className="px-3 py-2 pl-[46px]">
                            <Button
                              onClick={() => setGroupLimits((current) => ({ ...current, [group.key]: growGroupLimit(current[group.key] ?? GROUP_SESSION_CAP, group.sessions.length) }))}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              {t("historyShowMore")}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
                : paged.items.map((session) => renderSessionRow(session))}
            </div>
            {pageCount > 1 ? (
              <footer className="flex items-center justify-between gap-3 border-t border-[#ececE7] px-3 py-2 dark:border-border">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {t("historyPageIndicator").replace("{page}", String(currentPage)).replace("{pages}", String(pageCount))}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    aria-label={t("historyPrevPage")}
                    disabled={currentPage <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    aria-label={t("historyNextPage")}
                    disabled={currentPage >= pageCount}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </footer>
            ) : null}
          </section>
        )}

        {selected.size > 0 ? (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e0e0da] bg-white/95 px-4 py-3 shadow-[0_-4px_18px_rgba(24,24,20,0.06)] backdrop-blur dark:border-border dark:bg-card/95">
            <span className="text-[11px] text-muted-foreground">
              {t("historySelected")
                .replace("{count}", String(selected.size))
                .replace("{size}", formatBytes(totalUsage(usage, [...selected])))}
            </span>
            <div className="flex items-center gap-2">
              <Button disabled={busy} onClick={() => setSelected(new Set())} size="sm" type="button" variant="ghost">{t("historyClearSelection")}</Button>
              <Button className="gap-1.5 text-destructive hover:text-destructive" disabled={busy} onClick={() => setPurgeTargets([...selected])} size="sm" type="button" variant="ghost">
                <Trash2 className="h-3.5 w-3.5" />
                {t("historyDeleteSelected")}
              </Button>
            </div>
          </div>
        ) : null}

        <p className="px-1 text-[10px] leading-5 text-muted-foreground">
          {t("historyFootnote").replace("{count}", String(CONTENT_SEARCH_LIMIT))}
        </p>
      </div>

      {purgeTargets ? (
        <DeleteConfirm
          busy={busy}
          onCancel={() => setPurgeTargets(null)}
          onConfirm={() => void confirmDelete()}
          progress={purgeProgress}
          sessions={sessions.filter((session) => purgeTargets.includes(session.id))}
          size={formatBytes(totalUsage(usage, purgeTargets))}
          t={t}
        />
      ) : null}
    </div>
  );
}

const HISTORY_SORT_LABEL: Record<HistorySort, "historySortRecent" | "historySortOldest" | "historySortCreated" | "historySortLargest" | "historySortTitle"> = {
  "recent-activity": "historySortRecent",
  "oldest-activity": "historySortOldest",
  created: "historySortCreated",
  largest: "historySortLargest",
  title: "historySortTitle",
};

/**
 * Deletion removes files from disk, so the confirmation names every session that
 * will go and states plainly which files are removed instead of asking a generic
 * "are you sure".
 */
function DeleteConfirm({
  busy,
  onCancel,
  onConfirm,
  progress,
  sessions,
  size,
  t,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  progress: { done: number; total: number } | null;
  sessions: SessionRecord[];
  size: string;
  t: (key: Parameters<ReturnType<typeof usePreferences>["t"]>[0]) => string;
}) {
  return (
    <div aria-modal="true" className="fixed inset-0 z-[130] grid place-items-center bg-[#21211f]/45 p-4 backdrop-blur-[2px]" role="dialog">
      <div className="w-full max-w-[540px] rounded-[18px] border border-border bg-white p-5 shadow-[0_24px_60px_rgba(0,0,0,0.22)] dark:bg-card">
        <h2 className="text-[15px] font-semibold">{t("historyDeleteConfirmTitle").replace("{count}", String(sessions.length))}</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
          {t("historyDeleteConfirmBody").replace("{size}", size)}
        </p>
        <ul className="mt-3 max-h-[180px] overflow-y-auto rounded-[10px] border border-border bg-muted/30 px-3 py-2">
          {sessions.map((session) => (
            <li className="truncate py-0.5 text-[11.5px] text-foreground" key={session.id}>{session.title}</li>
          ))}
        </ul>
        {progress ? (
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">
            {t("historyDeleteProgress").replace("{done}", String(progress.done)).replace("{total}", String(progress.total))}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="outline">{t("cancel")}</Button>
          <Button className="bg-[#d8443c] text-white hover:bg-[#c23934]" disabled={busy} onClick={onConfirm} size="sm" type="button">
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("historyDeleteConfirmAction")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One space in the grouped view. Collapsed by default so a page of groups stays
 * short; the header carries the two numbers the page exists to answer — how many
 * sessions this space holds and how much room they take.
 */
function GroupHeader({
  expanded,
  groupSize,
  name,
  onToggle,
  sessionCount,
  t,
  unavailable,
}: {
  expanded: boolean;
  groupSize: string;
  name: string;
  onToggle: () => void;
  sessionCount: number;
  t: (key: Parameters<ReturnType<typeof usePreferences>["t"]>[0]) => string;
  unavailable: boolean;
}) {
  const Chevron = expanded ? ChevronDown : ChevronCollapsed;
  return (
    <button
      aria-expanded={expanded}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#fafaf8] focus-visible:bg-[#fafaf8] focus-visible:outline-none dark:hover:bg-muted/40 dark:focus-visible:bg-muted/40"
      onClick={onToggle}
      title={expanded ? t("historyCollapseGroup") : t("historyExpandGroup")}
      type="button"
    >
      <Chevron className="h-3.5 w-3.5 shrink-0 text-[#8a8a83] dark:text-muted-foreground" />
      <span className="min-w-0 truncate text-[12px] font-semibold text-[#33332f] dark:text-foreground">{name}</span>
      {unavailable ? (
        <span className="shrink-0 rounded-[4px] bg-[#fdf1ec] px-1.5 py-0.5 text-[10px] text-[#a3612f] dark:bg-[#2e2318] dark:text-[#e0a878]">
          {t("historyWorkspaceUnavailable")}
        </span>
      ) : null}
      <span className="ml-auto shrink-0 font-mono text-[10px] text-[#8a8a83] dark:text-muted-foreground">
        {t("historyGroupSummary").replace("{count}", String(sessionCount)).replace("{size}", groupSize)}
      </span>
    </button>
  );
}
