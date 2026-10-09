import type { SessionTreeEntry } from "@wordless/agent";
import { CONTEXT_COMPACTION_JOURNAL_TYPE, MODEL_RETRY_JOURNAL_TYPE } from "@wordless/agent-driver-sdk";

/**
 * Retry versions of a turn live in the session journal tree as sibling subtrees
 * of the turn's user message entry. The active version is the one the session
 * leaf points into; earlier versions stay on disk as inactive branches.
 *
 * **不是每个兄弟子树都是一个"版本"** —— 只有用户主动要过的那份才是。同一个用户消息下出现第二个
 * 子树有两条路,语义完全不同:
 *
 * 1. **用户重答**(`retrySessionTurn` / redo 按钮):`moveTo(用户条目)` 之后重新 prompt。
 *    这是用户可选的版本,必须出现在切换器里。
 * 2. **内部回收**(自动重试、上下文溢出恢复):把失败的那条响应从活动分支上摘下来、换一条重跑。
 *    这**不是**版本 —— 用户从没要求过第二份答案,被摘下的那条只是同一份答案的失败尝试。
 *    运行时的可见消息列表一直把它藏着(`buildSessionSnapshot` 的 `visibleMessages`),而版本投影
 *    曾经照数不误,于是界面上凭空冒出 `<2/2>`,切过去看到的正是那条本该不可见的失败响应。
 *
 * 两者的区别**写在 journal 里**,不用猜:内部回收会留下一个指向"被摘下的那条响应"的标记,
 * 而那正好就是它所在子树的 tip。见 {@link collectSupersededResponseEntryIds}。
 */
export type SessionTurnVersions = {
  /** 1-based index of the version the session leaf currently points into. */
  active: number;
  /** Journal entry ids that end each version, in creation order. */
  tips: string[];
  total: number;
};

/**
 * Entry types that never carry conversation content. `leaf` markers are written
 * by `Session.moveTo` and must not be mistaken for version children.
 */
const NON_CONTENT_ENTRY_TYPES = new Set(["leaf", "label", "session_info"]);

type ContentEntry = SessionTreeEntry & { parentId: string | null };

function isContentEntry(entry: SessionTreeEntry): entry is ContentEntry {
  return !NON_CONTENT_ENTRY_TYPES.has(entry.type);
}

function messageRole(entry: SessionTreeEntry): string | undefined {
  const role = (entry.message as { role?: unknown } | undefined)?.role;
  return typeof role === "string" ? role : undefined;
}

function isUserTurn(entry: SessionTreeEntry): boolean {
  return entry.type === "message" && messageRole(entry) === "user";
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

/**
 * 被**内部回收**掉的响应条目:它们曾经是某个子树的 tip,被摘下来换了一条重跑。
 *
 * 两类标记都指向"被摘下的那条响应":
 * - `wordless.model-retry` 的 `failedMessageEntryId` —— 驱动在排重试之前写(`prepareContextOverflowRecovery`
 *   成功摘下来之后才写,所以有标记就一定意味着那条已经离开活动分支);
 * - 压缩记录里的 `recoveredFailureEntryId` —— 上下文溢出恢复时写。
 *
 * **扫全部条目,而不是只扫活动分支**:标记是写在"重试之后"那条分支上的,用户一旦切到被回收的那份
 * 答案,标记就落到活动分支之外 —— 只看分支的话,`total` 会随"你正在看哪一份"变化,切换时数量跳变。
 * 版本数必须是 journal 的纯函数。
 */
export function collectSupersededResponseEntryIds(
  entries: readonly SessionTreeEntry[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const marker = entry.customType === MODEL_RETRY_JOURNAL_TYPE
      ? stringField(entry.data, "failedMessageEntryId")
      : entry.customType === CONTEXT_COMPACTION_JOURNAL_TYPE
        ? stringField(entry.data, "recoveredFailureEntryId")
        : undefined;
    if (marker !== undefined) ids.add(marker);
  }
  return ids;
}

/**
 * Reports, for every user turn that has sibling response subtrees, how many
 * assistant response versions exist and which one is active.
 *
 * `entries` must be in journal (append) order, which the JSONL storage already
 * guarantees.
 *
 * 三条规则,每一条都为了一个具体的坏情况:
 * - **按 tip 判定"被回收",不按"子树里含被回收条目"**:用户重答出的那份如果自己又被自动重试过,
 *   标记的失败响应会落在**用户版本子树内部且不是 tip**。按"含即忽略"会把用户自己的版本整条吃掉。
 * - **回收集合扫全树**:见 {@link collectSupersededResponseEntryIds}(否则切换版本时数量跳变)。
 * - **活动版本永远算数**:leaf 恰好落在被回收的子树里时(改动前用户已经选中过失败版本、或重试进行
 *   到一半),仍把它算作可见版本 —— 否则会出现 `total: 0`,或"屏幕上这段内容不属于任何一个版本"。
 */
export function projectSessionTurnVersions(
  entries: readonly SessionTreeEntry[],
  activeLeafId: string | null,
): Map<string, SessionTurnVersions> {
  const superseded = collectSupersededResponseEntryIds(entries);
  const byId = new Map<string, SessionTreeEntry>();
  const childrenByParent = new Map<string, SessionTreeEntry[]>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    if (typeof entry.parentId !== "string") continue;
    const siblings = childrenByParent.get(entry.parentId);
    if (siblings) siblings.push(entry);
    else childrenByParent.set(entry.parentId, [entry]);
  }

  const activePathIds = new Set<string>();
  for (
    let entry = typeof activeLeafId === "string" ? byId.get(activeLeafId) : undefined;
    entry !== undefined;
    entry = typeof entry.parentId === "string" ? byId.get(entry.parentId) : undefined
  ) {
    activePathIds.add(entry.id);
  }

  /**
   * 某个条目之下(不跨用户消息)还有没有一条**真正的回复**。
   */
  const reachesMessage = new Map<string, boolean>();
  function hasMessageDescendant(id: string): boolean {
    const cached = reachesMessage.get(id);
    if (cached !== undefined) return cached;
    const entry = byId.get(id);
    let found = entry?.type === "message";
    if (entry !== undefined && !found) {
      for (const child of childrenByParent.get(id) ?? []) {
        if (!isContentEntry(child) || isUserTurn(child)) continue;
        if (hasMessageDescendant(child.id)) {
          found = true;
          break;
        }
      }
    }
    reachesMessage.set(id, found);
    return found;
  }

  /**
   * 一条版本链的**终点**:这条链里最后一条真正的回复(必须是 `message` 条目)。
   *
   * 两处讲究,都是真实 journal 逼出来的:
   * - **标记/压缩这类元数据条目本身不是回复**。自动重试的标记条目就挂在用户消息下面,重试出的那条
   *   回复挂在它下面(`U → [失败, 标记 → 重试成功]`)。它们要被穿过,不能被当成终点 ——
   *   否则那条标记会变成"版本 1"(`selectSessionTurnVersion` 会把叶子移到它上面,什么也看不到)。
   * - 往下走时**优先选"还能走到回复"的那一支**:重试被中断时标记是最后一个子节点且下面什么都没有,
   *   盲取最后一个子节点会把上面那条真回复丢掉(用户那一版凭空消失)。
   */
  function versionTip(head: SessionTreeEntry): string | undefined {
    let tip: string | undefined;
    let cursor: SessionTreeEntry | undefined = head;
    while (cursor !== undefined) {
      if (isUserTurn(cursor)) break;
      if (cursor.type === "message") tip = cursor.id;
      const children: SessionTreeEntry[] = (childrenByParent.get(cursor.id) ?? []).filter(
        (child) => isContentEntry(child) && !isUserTurn(child),
      );
      const alive: SessionTreeEntry[] = children.filter((child) => hasMessageDescendant(child.id));
      cursor = (alive.length > 0 ? alive : children).at(-1);
    }
    return tip;
  }

  const versions = new Map<string, SessionTurnVersions>();
  for (const entry of entries) {
    if (!isUserTurn(entry)) continue;
    const children = (childrenByParent.get(entry.id) ?? []).filter(
      isContentEntry,
    );
    if (children.length < 2) continue;
    const tips: string[] = [];
    let activeIndex = -1;
    for (const child of children) {
      const tip = versionTip(child);
      if (tip === undefined) continue;
      const onActivePath = activePathIds.has(child.id) || activePathIds.has(tip);
      // 内部回收掉的响应不是版本 —— 除非你正看着它(见上面第三条规则)。
      if (superseded.has(tip) && !onActivePath) continue;
      tips.push(tip);
      if (onActivePath) activeIndex = tips.length - 1;
    }
    if (tips.length < 2) continue;
    versions.set(entry.id, {
      active: activeIndex === -1 ? tips.length : activeIndex + 1,
      tips,
      total: tips.length,
    });
  }
  return versions;
}

