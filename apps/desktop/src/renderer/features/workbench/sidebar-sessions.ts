import { isKnowledgeRound } from "@wordless/domain";

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
 * **不是对话的东西不进列表**,两类各有各的判据:
 *
 *   - `media-canvas`:媒体画布有自己的素材库。按 `workbenchId` 认是安全的 —— 它那个 entry
 *     是 `internal` 的,用户没有从新建页建出它的路径。
 *   - `knowledge`:**按 `source` 标记认,不能按 `workbenchId`**(见 `isKnowledgeRound`)。
 *     隐藏的目标只是"加工轮次"(`source: "knowledge"`),而**新建页上那张"知识库整理"卡建的
 *     会话用的是同一个工作台** —— 按 `workbenchId` 认会把用户自己起的会话一起藏掉,他就再也
 *     找不到自己刚建的对话了(而且它还会冒充一轮加工出现在知识库页里)。
 *
 * 抽成纯函数是因为它**错了也不会报错**:只是列表里悄悄多出几行、或少掉几行,直到某天用户
 * 发现自己的对话都不见了。这类判据必须有测试。
 *
 * 注意与 `session-search.ts` 的区别:那里**不**过滤加工轮次 —— 主动搜索是另一回事,
 * 搜得到反而有用。
 */
export function sidebarVisibleSessions<
  T extends { workbenchId: string; source?: string | null },
>(sessions: readonly T[]): T[] {
  return sessions.filter(
    (session) =>
      session.workbenchId !== "media-canvas" && !isKnowledgeRound(session),
  );
}
