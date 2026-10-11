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

/**
 * 会话列表里显示哪些会话。
 *
 * **不是对话的东西不进列表**,判据是 `workbenchId`:
 *   - `media-canvas`:媒体画布有自己的素材库;
 *   - `knowledge`:知识库加工轮次是"一轮一个会话",而侧边栏的最近会话只有 5 格 ——
 *     定时一开就被占满,用户自己的对话全被挤进折叠区。它们从知识库页进入。
 *
 * 抽成纯函数是因为它**错了也不会报错**:只是列表里悄悄多出几行,直到某天用户发现自己的
 * 对话都不见了。这类判据必须有测试。
 *
 * 注意与 `session-search.ts` 的区别:那里**不**过滤加工轮次 —— 主动搜索是另一回事,
 * 搜得到反而有用。
 */
export function sidebarVisibleSessions<T extends { workbenchId: string }>(
  sessions: readonly T[],
): T[] {
  return sessions.filter(
    (session) =>
      session.workbenchId !== "media-canvas" &&
      session.workbenchId !== "knowledge",
  );
}
