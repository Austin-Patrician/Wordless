import type { SessionRecord, WorkspaceRecord } from "@wordless/domain";

/**
 * 「我的设计」要扫哪些根。
 *
 * 设计包住在**会话根**里,而会话根由这一行决定(`runtime/src/index.ts` 建会话那一段):
 *
 * ```ts
 * const runtimeRootPath = workspace?.canonicalRootPath ?? join(paths.sessionWorkspacesRoot, id);
 * ```
 *
 * 于是包会落在两个地方,而且它们是**两种不同的东西**:
 *
 * - **工作区** —— 用户自己选的目录,长期资产。会话删了它还在,画廊今天只认这一种。
 * - **会话** —— 没选工作区的会话把包落在自己的私有根里(`session-workspaces/<id>`),它跟着
 *   会话存亡。这一种从前在这页里根本不出现:画布看得到,列表看不到。
 *
 * 所以这个函数的产出就是那一口径:该扫的根、按什么顺序、扫到多少为止。
 *
 * **顺序**:工作区保持 `snapshot.workspaces` 的顺序(那是用户自己的顺序,而且"新建设计"要落
 * 在第一个可用工作区里 —— 换顺序会让新包落到另一个目录);会话按 `updatedAt` 倒序,"继续昨天
 * 那份"比"翻一个月前那份"常见得多。
 *
 * **去重按根**:绑定工作区的设计会话,它的 `runtimeRootPath` 就是那个工作区的 `canonicalRootPath`
 * (上面那行代码的左边),不去重就会把同一份设计列两遍。
 */
export type DesignLibrarySource =
  | { key: string; kind: "workspace"; rootPath: string; workspaceId: string; name: string }
  | { key: string; kind: "session"; rootPath: string; sessionId: string; name: string };

/**
 * 最多扫几个会话根。
 *
 * 每多扫一个根就是一次递归遍历 + 每个包读一遍清单(`DesignFs.listFiles` / `store.listDesigns`),
 * 而这是个"打开就要出画面"的页面 —— 无上限的话,攒了几十个设计会话的用户会先卡一下。取最近
 * 若干个够覆盖"继续昨天那份";这是画廊,不是审计。
 */
export const DESIGN_LIBRARY_SESSION_LIMIT = 12;

export function designLibrarySources(input: {
  sessions: readonly SessionRecord[] | undefined;
  workspaces: readonly WorkspaceRecord[] | undefined;
  sessionLimit?: number;
}): DesignLibrarySource[] {
  const sessionLimit = input.sessionLimit ?? DESIGN_LIBRARY_SESSION_LIMIT;
  const claimed = new Set<string>();
  const sources: DesignLibrarySource[] = [];

  for (const workspace of input.workspaces ?? []) {
    if (workspace.availability !== "available") continue;
    // `canonicalRootPath` 才是会话根的那个值(`runtimeRootPath` 取的也是它),符号链接/大小写
    // 归一化之后的路径才去得掉重;`rootPath` 只是回退。
    const rootPath = workspace.canonicalRootPath || workspace.rootPath;
    if (rootPath === "" || claimed.has(rootPath)) continue;
    claimed.add(rootPath);
    sources.push({
      key: `workspace:${rootPath}`,
      kind: "workspace",
      rootPath,
      workspaceId: workspace.id,
      name: workspace.name,
    });
  }

  const newestFirst = [...(input.sessions ?? [])].sort((left, right) => right.updatedAt - left.updatedAt);
  let scanned = 0;
  for (const session of newestFirst) {
    if (scanned >= sessionLimit) break;
    // 只有设计会话的根里可能有设计包。别的会话的私有根里也可能被人放进一个 `.wdesign`,那不是
    // 这次要覆盖的情况 —— 它是用户手放的,不是这条路产出的。
    if (session.workbenchId !== "ui-preview") continue;
    const rootPath = session.runtimeRootPath;
    if (rootPath === "" || claimed.has(rootPath)) continue;
    claimed.add(rootPath);
    scanned += 1;
    sources.push({
      key: `session:${session.id}`,
      kind: "session",
      rootPath,
      sessionId: session.id,
      name: session.title.trim() === "" ? session.id.slice(0, 8) : session.title,
    });
  }

  return sources;
}
