export function latestSessionUpdatedAt(
  sessions: readonly { updatedAt: number }[],
): number {
  let latest = 0;
  for (const session of sessions) {
    if (session.updatedAt > latest) latest = session.updatedAt;
  }
  return latest;
}

export function sortWorkspaceGroupsByRecentSession<
  T extends { sessions: readonly { updatedAt: number }[] },
>(groups: readonly T[]): T[] {
  return [...groups].sort(
    (left, right) =>
      latestSessionUpdatedAt(right.sessions) -
      latestSessionUpdatedAt(left.sessions),
  );
}
