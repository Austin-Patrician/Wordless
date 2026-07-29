import type { SessionRecord } from "@wordless/domain";

const RECENT_SESSION_LIMIT = 10;
const SEARCH_RESULT_LIMIT = 50;

function normalizedTitle(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function matchRank(title: string, query: string): number {
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  return 2;
}

export function searchSidebarSessions(sessions: readonly SessionRecord[], query: string): SessionRecord[] {
  const available = sessions.filter((session) => session.workbenchId !== "media-canvas");
  const normalizedQuery = normalizedTitle(query);
  if (!normalizedQuery) return [...available].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, RECENT_SESSION_LIMIT);
  return available
    .filter((session) => normalizedTitle(session.title).includes(normalizedQuery))
    .sort((left, right) => matchRank(normalizedTitle(left.title), normalizedQuery) - matchRank(normalizedTitle(right.title), normalizedQuery) || right.updatedAt - left.updatedAt)
    .slice(0, SEARCH_RESULT_LIMIT);
}
