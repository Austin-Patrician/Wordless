import type { KnowledgeDiff, RawSnapshot } from "./knowledge-diff.ts";

/**
 * 加工失败的计数与隔离(纯逻辑,不做 IO)。
 *
 * ## 为什么需要它
 *
 * "源页存在且 `source_hash` 与原文一致"是**加工成功的唯一凭证**。任何永远写不出页的文件
 * (加密、扫描件识别不出来、大到爆上下文、agent 中途崩),每一轮都会重新落进 `added` ——
 * 于是每一轮都重试一遍,永远重试。这是无人值守最典型的坏法:**它不会报错,只会一直烧钱**。
 *
 * 所以给"永久失败"的文件加止损:连续失败到阈值就隔离,后续轮次不再自动加工;用户可以手动
 * 解除;而**内容一变自动重试**(改过了就是另一件事了)。
 *
 * ## 两条来自同类实现的教训
 *
 * 1. **按路径记账,不是按 hash。** 同一份内容可能被拷到多个路径(备份),它们各自是独立的页;
 *    按 hash 记账会让一个副本写出页时清掉另一个副本的失败记录,于是那个永远写不出的副本
 *    逃过隔离,继续无限重试。
 * 2. **隔离只在内容未变时生效。** 用户把文件改好了,它就该重新试 —— 隔离不该是永久判决。
 *
 * ## 状态放哪
 *
 * 放**应用数据目录**,不放 bundle:一份知识库应该是能带走的纯内容(见设计文档 §4.1),
 * 而失败计数是这台机器的记账。丢了它的后果只是"多试几次",不会丢知识。
 */

/** 连续失败到这个次数就隔离。 */
export const KNOWLEDGE_MAX_ATTEMPTS = 3;

export interface KnowledgeFailureEntry {
  /** 最近一次尝试时的内容 hash —— 用来判断"内容变了没有"。 */
  hash: string;
  attempts: number;
  quarantined: boolean;
  firstFailedAt: string;
  lastFailedAt: string;
}

/** 失败记录:原始文件路径(相对 `raws/`)→ 记录。 */
export interface KnowledgeFailures {
  version: 1;
  entries: Record<string, KnowledgeFailureEntry>;
}

export const EMPTY_KNOWLEDGE_FAILURES: KnowledgeFailures = { version: 1, entries: {} };

/**
 * 当前被隔离的路径。
 *
 * **只有内容未变的才算隔离**:hash 变了说明用户改过了,那是一次全新的尝试。
 */
export function quarantinedPaths(failures: KnowledgeFailures, currentHashes: Map<string, string>): Set<string> {
  const result = new Set<string>();
  for (const [path, entry] of Object.entries(failures.entries)) {
    if (!entry.quarantined) continue;
    if (currentHashes.get(path) === entry.hash) result.add(path);
  }
  return result;
}

/**
 * 把隔离的文件从这一轮的待办里剔掉,并如实报出剔了哪些。
 *
 * 剔掉而不是静默跳过:界面与日志要能看到"这几个文件被隔离了,去设置里重试"。
 */
export function applyQuarantine(
  diff: KnowledgeDiff,
  quarantined: Set<string>,
): { diff: KnowledgeDiff; skipped: RawSnapshot[] } {
  const isQuarantined = (resource: string): boolean =>
    quarantined.has(resource.replace(/^\/raws\//, ""));

  const added = diff.added.filter((raw) => !isQuarantined(raw.resource));
  const changed = diff.changed.filter((change) => !isQuarantined(change.resource));
  return {
    diff: { ...diff, added, changed },
    skipped: diff.added.filter((raw) => isQuarantined(raw.resource)),
  };
}

export interface ReconcileInput {
  failures: KnowledgeFailures;
  /** 本轮真的交给 agent 的文件(已剔除隔离项)。 */
  attempted: Array<{ path: string; hash: string }>;
  /** 本轮结束时"写出了页且内容一致"的路径 → hash。 */
  present: Map<string, string>;
  /** 当前 raws 里每个路径的 hash(判断文件是否还在、内容是否变过)。 */
  current: Map<string, string>;
  now: string;
}

/**
 * 轮末对账:本轮尝试过的每个文件,写出了页就清记录,仍然没有就失败次数 +1。
 *
 * 只处理**本轮尝试过的**:没尝试的(被隔离的、这一轮没轮到的)保持原样。
 * 被用户中止的轮次不该计失败,所以调用方在轮次异常结束时**不要**调用它。
 */
export function reconcileFailures(input: ReconcileInput): KnowledgeFailures {
  const { failures, attempted, present, current, now } = input;
  if (attempted.length === 0) return failures;

  const entries: Record<string, KnowledgeFailureEntry> = { ...failures.entries };
  for (const file of attempted) {
    // 页写出来了、而且内容与原文一致 → 这一份成功了,清掉它的失败史。
    if (present.get(file.path) === file.hash) {
      delete entries[file.path];
      continue;
    }
    // 文件已经不在 raws 里了(用户删了)→ 不再记账,它会走孤儿回收那条路。
    if (!current.has(file.path)) {
      delete entries[file.path];
      continue;
    }
    const previous = entries[file.path];
    // 内容变过就重新计数:改过了就是另一件事,不该继承旧的失败次数。
    const attempts = previous === undefined || previous.hash !== file.hash ? 1 : previous.attempts + 1;
    entries[file.path] = {
      hash: file.hash,
      attempts,
      quarantined: attempts >= KNOWLEDGE_MAX_ATTEMPTS,
      firstFailedAt: previous === undefined || previous.hash !== file.hash ? now : previous.firstFailedAt,
      lastFailedAt: now,
    };
  }
  return { version: 1, entries };
}

/** 解除全部隔离(用户点"重试失败的文件")。 */
export function clearKnowledgeFailures(): KnowledgeFailures {
  return { version: 1, entries: {} };
}

/** 只保留仍然存在的文件的记录(用户删掉的源文件不该一直占着账本)。 */
export function pruneFailures(failures: KnowledgeFailures, current: Map<string, string>): KnowledgeFailures {
  const entries: Record<string, KnowledgeFailureEntry> = {};
  for (const [path, entry] of Object.entries(failures.entries)) {
    if (current.has(path)) entries[path] = entry;
  }
  return { version: 1, entries };
}

/** 归一(从磁盘读回来的东西不可信)。 */
export function normalizeKnowledgeFailures(value: unknown): KnowledgeFailures {
  if (typeof value !== "object" || value === null) return EMPTY_KNOWLEDGE_FAILURES;
  const entries = (value as { entries?: unknown }).entries;
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) return EMPTY_KNOWLEDGE_FAILURES;
  const normalized: Record<string, KnowledgeFailureEntry> = {};
  for (const [path, raw] of Object.entries(entries as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.hash !== "string" || typeof entry.attempts !== "number") continue;
    normalized[path] = {
      hash: entry.hash,
      attempts: entry.attempts,
      quarantined: entry.quarantined === true,
      firstFailedAt: typeof entry.firstFailedAt === "string" ? entry.firstFailedAt : "",
      lastFailedAt: typeof entry.lastFailedAt === "string" ? entry.lastFailedAt : "",
    };
  }
  return { version: 1, entries: normalized };
}
