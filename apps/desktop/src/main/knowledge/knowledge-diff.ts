import type { KnowledgePage } from "./knowledge-schema.ts";

/**
 * 原始文件与知识页之间的**确定性差异计算**。
 *
 * 这一层是整个 P2 的心脏:它决定"哪些文件要重加工、哪些不用、哪些页该变成孤儿"。判定顺序
 * **就是语义**,顺序错了会把"移动"当成"删了再建"(白烧一轮 token)或者把"改了内容"当成
 * "新文件"(于是同一份资料留下两页)。
 *
 * ## 身份是复合的:路径 + 内容
 *
 * 一个源页的身份是 `(resource, source_hash)` 这一对,不是其中任何一个:
 *
 * - 只看**路径**:用户把文件改了内容,会被当成"没变",页面永远停在旧内容上;
 * - 只看**内容 hash**:用户把同一份文件拷到两个路径(备份),两条路径会被当成同一个来源,
 *   更新其中一个会把另一个删掉 —— 下一轮它又被判成"新文件",于是**无限重加工**。
 *
 * 所以配对要按顺序来:先同路径同内容(没变)→ 再同内容换路径(移动)→ 再同路径换内容(修改)
 * → 剩下的是新增 → 再剩下的是删除。
 *
 * ## 基线从 frontmatter 现算,不读缓存
 *
 * `prior` 由扫描页面 frontmatter 得来(见 `KnowledgeService.sourcePageSnapshots`)。**不读
 * manifest 之类的缓存**:缓存一旦损坏或过期,整库会被判成"全部新增",触发一次全库重加工 ——
 * 那是本设计里最贵的一种错。
 */

/** 一个源页的快照。只有 `type: Source` 的页面参与 diff(概念页/实体页没有 1:1 的来源)。 */
export interface SourcePageSnapshot {
  /** 页面路径,bundle 相对(如 `sources/合同.md`)。 */
  pagePath: string;
  /** 它对应的原始文件,bundle 相对(如 `/raws/合同.pdf`)。 */
  resource: string;
  /** 原始文件的内容 hash。 */
  hash: string;
  /** 孤儿标记;非 null 表示原始文件已经删了、等宽限期回收。 */
  orphanedAt: string | null;
  /** 这一页是否经过人工复核(带 `human:` 前缀的 `verified`)。 */
  verified: boolean;
}

/** 投递箱里的一个原始文件。 */
export interface RawSnapshot {
  /** 相对 `raws/` 的路径(如 `合同/2024.pdf`)。 */
  path: string;
  /** bundle 相对路径(如 `/raws/合同/2024.pdf`),与 {@link SourcePageSnapshot.resource} 同形状。 */
  resource: string;
  hash: string;
}

export interface KnowledgeDiff {
  /** 新文件:没有对应页。 */
  added: RawSnapshot[];
  /** 内容没变、换了路径:只改页面的元数据,**不重加工**。 */
  moved: Array<{ pagePath: string; from: string; to: string }>;
  /** 同一路径、内容变了:按旧页就地更新(保住页面的位置与 `generated` 之外的既有内容)。 */
  changed: Array<{ pagePath: string; resource: string; oldHash: string; newHash: string }>;
  /** 原始文件没了:标成孤儿(不是立刻删页 —— 见 {@link planOrphanReaping})。 */
  deleted: Array<{ pagePath: string; resource: string }>;
}

export function isDiffEmpty(diff: KnowledgeDiff): boolean {
  return diff.added.length === 0 && diff.moved.length === 0 && diff.changed.length === 0 && diff.deleted.length === 0;
}

/**
 * 这一轮要不要起 agent 会话。
 *
 * **只有 `added` 与 `changed` 需要读原文 → 写页**。`moved`(纯元数据)、`deleted`(标孤儿)与
 * 孤儿回收都是工程侧动作 —— 它们不烧 token,也不该占用模型。
 */
export function diffNeedsProcessing(diff: KnowledgeDiff): boolean {
  return diff.added.length > 0 || diff.changed.length > 0;
}

/**
 * 五趟配对。判定顺序见文件头。
 *
 * 已标孤儿的页**不参与匹配**:它们代表的原始文件已经不存在了,再拿它们去配对只会在
 * 用户把文件放回来时产生莫名其妙的"移动"。
 */
export function diffKnowledge(prior: SourcePageSnapshot[], current: RawSnapshot[]): KnowledgeDiff {
  const live = prior.filter((page) => page.orphanedAt === null);
  const remaining = new Map<string, SourcePageSnapshot>(live.map((page) => [page.pagePath, page]));
  const matched = new Set<number>();
  const diff: KnowledgeDiff = { added: [], moved: [], changed: [], deleted: [] };

  const take = (predicate: (page: SourcePageSnapshot) => boolean): SourcePageSnapshot | undefined => {
    for (const page of remaining.values()) {
      if (predicate(page)) return page;
    }
    return undefined;
  };

  // 第 1 趟:同路径同内容 → 没变,跳过。
  current.forEach((raw, index) => {
    const page = take((candidate) => candidate.resource === raw.resource && candidate.hash === raw.hash);
    if (!page) return;
    remaining.delete(page.pagePath);
    matched.add(index);
  });

  // 第 2 趟:同内容换路径 → 移动。纯元数据,不重加工。
  current.forEach((raw, index) => {
    if (matched.has(index)) return;
    const page = take((candidate) => candidate.hash === raw.hash);
    if (!page) return;
    remaining.delete(page.pagePath);
    matched.add(index);
    diff.moved.push({ pagePath: page.pagePath, from: page.resource, to: raw.resource });
  });

  // 第 3 趟:同路径换内容 → 修改。带着旧页路径交给 agent 就地更新。
  current.forEach((raw, index) => {
    if (matched.has(index)) return;
    const page = take((candidate) => candidate.resource === raw.resource);
    if (!page) return;
    remaining.delete(page.pagePath);
    matched.add(index);
    diff.changed.push({ pagePath: page.pagePath, resource: raw.resource, oldHash: page.hash, newHash: raw.hash });
  });

  // 第 4 趟:剩下的当前文件 → 新增。
  current.forEach((raw, index) => {
    if (!matched.has(index)) diff.added.push(raw);
  });

  // 第 5 趟:剩下的活页 → 原始文件没了,标孤儿。
  for (const page of remaining.values()) {
    diff.deleted.push({ pagePath: page.pagePath, resource: page.resource });
  }

  return diff;
}

/**
 * 孤儿回收规划(n+1)。
 *
 * 删除是**两轮**的事:第 N 轮把页标成孤儿(带时间戳),第 N+1 轮才物理删除。中间那一轮就是
 * 宽限期 —— 用户误删/误移一个文件时,页面还在,还能被找回来。
 *
 * 判据用**时间戳比较**而不是"轮次计数器":后者需要额外持久化一个计数器,而时间戳本来就在
 * 页面的 frontmatter 里,重启也不会丢。
 */
export function planOrphanReaping<T extends { orphanedAt: string | null }>(prior: readonly T[], roundStartedAt: string): T[] {
  return prior.filter((page) => page.orphanedAt !== null && page.orphanedAt < roundStartedAt);
}

/**
 * 从原始文件路径推出它在 bundle 里的 resource 形状。
 *
 * 只有一处实现:页面写 `sources[].resource` 与 diff 比较时都用它 —— 两处各写一遍,
 * 迟早会因为一个前导斜杠对不上,而那会让整库每一轮都被判成"全变了"。
 */
export function rawsResource(rawPath: string): string {
  return `/raws/${rawPath.replace(/^\/+/, "").replace(/\\/g, "/")}`;
}

/**
 * 复核闸门:人工复核过的页**不进 agent 的待办**,而是进"需要复核"那一栏。
 *
 * 两道防线的第一道。第二道在写路径上(`KnowledgeService.writePage` 会拒绝改写复核过的页)——
 * 两道都要有:只靠写路径的话,agent 会拿到一个注定被拒的指令,白烧一次工具调用,
 * 而且它看到的失败原因("不自动改写")与它被要求做的事("更新这一页")互相矛盾。
 */
export function applyVerificationGate(
  diff: KnowledgeDiff,
  verifiedPagePaths: ReadonlySet<string>,
): { diff: KnowledgeDiff; needsReview: Array<{ pagePath: string; resource: string }> } {
  const needsReview = diff.changed.filter((change) => verifiedPagePaths.has(change.pagePath));
  return {
    diff: { ...diff, changed: diff.changed.filter((change) => !verifiedPagePaths.has(change.pagePath)) },
    needsReview: needsReview.map((change) => ({ pagePath: change.pagePath, resource: change.resource })),
  };
}

/**
 * 摘掉一个页面对某个来源的引用(回收孤儿页时用)。
 *
 * **不删整页**:一个概念页可能综合了五份资料,删掉其中一份的来源不该让整页消失。它变成
 * "少了一条来源",而不是"没了"。这是 open-vetta 的"共享实体保留"那条经验。
 */
export function withoutSourceReference(page: KnowledgePage, resource: string): { page: KnowledgePage; removed: boolean; empty: boolean } {
  const sources = page.sources ?? [];
  const kept = sources.filter((source) => source.resource !== resource);
  if (kept.length === sources.length) return { page, removed: false, empty: sources.length === 0 };
  return {
    page: { ...page, ...(kept.length === 0 ? { sources: undefined } : { sources: kept }) },
    removed: true,
    empty: kept.length === 0,
  };
}
