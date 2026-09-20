import type { SessionRecord, WorkbenchId } from "@wordless/domain";
import type { MessageKey } from "../../shared/i18n";

export type HistorySort = "recent-activity" | "oldest-activity" | "created" | "largest" | "title";

export const HISTORY_SORTS: readonly HistorySort[] = [
  "recent-activity",
  "oldest-activity",
  "created",
  "largest",
  "title",
];

export type HistoryFilters = {
  query: string;
  workspaceId: string | null;
  workbenchId: string | null;
};

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  query: "",
  workspaceId: null,
  workbenchId: null,
};

/**
 * Title matching only. Message-content matching parses each journal, so it runs
 * separately (debounced and capped) and its results are merged by the caller.
 */
export function filterSessions(
  sessions: readonly SessionRecord[],
  filters: HistoryFilters,
): SessionRecord[] {
  const needle = filters.query.trim().toLowerCase();
  return sessions.filter((session) => {
    if (filters.workspaceId !== null && session.workspaceId !== filters.workspaceId) return false;
    if (filters.workbenchId !== null && session.workbenchId !== filters.workbenchId) return false;
    if (!needle) return true;
    return session.title.toLowerCase().includes(needle);
  });
}

export function sortSessions(
  sessions: readonly SessionRecord[],
  sort: HistorySort,
  usage: Readonly<Record<string, number>> = {},
): SessionRecord[] {
  const size = (session: SessionRecord) => usage[session.id] ?? -1;
  return [...sessions].sort((left, right) => {
    if (sort === "recent-activity") return right.updatedAt - left.updatedAt;
    if (sort === "oldest-activity") return left.updatedAt - right.updatedAt;
    if (sort === "created") return right.createdAt - left.createdAt;
    if (sort === "title") {
      return (
        left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" }) ||
        right.updatedAt - left.updatedAt
      );
    }
    // Sessions whose size is still being measured (-1) sort last rather than
    // pretending to be empty.
    const leftSize = size(left);
    const rightSize = size(right);
    if (leftSize < 0 && rightSize < 0) return right.updatedAt - left.updatedAt;
    if (leftSize < 0) return 1;
    if (rightSize < 0) return -1;
    return rightSize - leftSize;
  });
}

export function isEverySelected(
  selected: ReadonlySet<string>,
  sessionIds: readonly string[],
): boolean {
  return sessionIds.length > 0 && sessionIds.every((id) => selected.has(id));
}

export function toggleSelection(selected: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

export function toggleEverySelection(
  selected: ReadonlySet<string>,
  sessionIds: readonly string[],
): Set<string> {
  return isEverySelected(selected, sessionIds) ? new Set() : new Set(sessionIds);
}

/** Drops ids that no longer exist, so a deletion can never act on a stale row. */
export function retainExistingSelection(
  selected: ReadonlySet<string>,
  sessionIds: readonly string[],
): Set<string> {
  const existing = new Set(sessionIds);
  const next = new Set([...selected].filter((id) => existing.has(id)));
  return next.size === selected.size ? (selected as Set<string>) : next;
}

export function totalUsage(
  usage: Readonly<Record<string, number>>,
  sessionIds: readonly string[],
): number {
  return sessionIds.reduce((sum, id) => sum + (usage[id] ?? 0), 0);
}

/** Byte count that stops being precise once the units get large. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * Message-content search parses every journal it touches, so it is capped and
 * only runs for queries long enough to be meaningful.
 */
export const CONTENT_SEARCH_MIN_LENGTH = 2;
export const CONTENT_SEARCH_LIMIT = 12;

export function shouldSearchContent(query: string): boolean {
  return query.trim().length >= CONTENT_SEARCH_MIN_LENGTH;
}

/** Search the most recently active first, so the cap favours fresh material. */
export function contentSearchTargets(sessions: readonly SessionRecord[]): string[] {
  return sortSessions(sessions, "recent-activity")
    .slice(0, CONTENT_SEARCH_LIMIT)
    .map((session) => session.id);
}

export function distinctWorkbenchIds(sessions: readonly SessionRecord[]): string[] {
  return [...new Set(sessions.map((session) => session.workbenchId))].sort();
}

export const HISTORY_PAGE_SIZES = [20, 50, 100] as const;
export type HistoryPageSize = (typeof HISTORY_PAGE_SIZES)[number];
export const DEFAULT_HISTORY_PAGE_SIZE: HistoryPageSize = 20;

export type HistoryPage<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
};

/**
 * Keeps a page number inside the range that currently exists. Deleting rows or
 * narrowing the filters can leave the viewer past the last page, which would
 * otherwise render an empty list with no way back.
 */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(1, pageCount));
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): HistoryPage<T> {
  const size = Math.max(1, Math.trunc(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = clampPage(page, pageCount);
  const start = (current - 1) * size;
  return { items: items.slice(start, start + size), page: current, pageCount, total };
}

/**
 * Display names for the workbench a session belongs to. Typed against
 * `WorkbenchId`, so adding a workbench is a compile error here until it is
 * labelled, and the labels come from i18n rather than a hardcoded language.
 */
export const WORKBENCH_LABEL_KEYS: Record<WorkbenchId, MessageKey> = {
  conversation: "workbenchConversation",
  code: "workbenchCode",
  presentation: "workbenchPresentation",
  workbook: "workbenchWorkbook",
  analysis: "workbenchAnalysis",
  "ui-preview": "workbenchUiPreview",
  "media-canvas": "workbenchMediaCanvas",
};

/** Falls back to the raw id so an unknown or legacy workbench still renders. */
export function workbenchLabelKey(id: string): MessageKey | null {
  return WORKBENCH_LABEL_KEYS[id as WorkbenchId] ?? null;
}

export type HistoryView = "flat" | "grouped";

/** Sessions without a workspace are collected under one synthetic group. */
export const UNASSIGNED_GROUP_KEY = "__unassigned__";
/** Groups per page. The per-page selector stays in session units for flat mode. */
export const GROUP_PAGE_SIZE = 20;
/** How many sessions a group renders before offering "show more". */
export const GROUP_SESSION_CAP = 50;

export type SessionGroup = {
  key: string;
  workspaceId: string | null;
  sessions: SessionRecord[];
  totalBytes: number;
  latestUpdatedAt: number;
};

/**
 * Groups sessions by their space, preserving the order the caller already sorted
 * them into. Groups themselves are ordered by most recent activity so the space
 * someone just worked in comes first; sessions with no space are the catch-all
 * and always land last.
 */
export function groupSessionsByWorkspace(
  sessions: readonly SessionRecord[],
  usage: Readonly<Record<string, number>> = {},
): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const key = session.workspaceId ?? UNASSIGNED_GROUP_KEY;
    let group = groups.get(key);
    if (!group) {
      group = { key, workspaceId: session.workspaceId, sessions: [], totalBytes: 0, latestUpdatedAt: 0 };
      groups.set(key, group);
    }
    group.sessions.push(session);
    group.totalBytes += usage[session.id] ?? 0;
    group.latestUpdatedAt = Math.max(group.latestUpdatedAt, session.updatedAt);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.workspaceId === null) return 1;
    if (right.workspaceId === null) return -1;
    return right.latestUpdatedAt - left.latestUpdatedAt;
  });
}

/**
 * Groups start collapsed so a page of groups stays short, except when there is
 * only one group — collapsing it would hide the entire page behind a single row.
 */
export function initiallyExpandedGroups(groups: readonly SessionGroup[]): Set<string> {
  return groups.length === 1 ? new Set([groups[0]!.key]) : new Set<string>();
}

export function growGroupLimit(current: number, total: number, step = GROUP_SESSION_CAP): number {
  return Math.min(Math.max(current, 0) + step, Math.max(total, 0));
}

export function toggleGroupKey(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
