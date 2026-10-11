/**
 * journal 条目的读取口径。
 *
 * 只放**纯解析**:把一行 journal 条目读成运行时用的结构。不 import fs、不 import Electron、
 * 也不需要 runtime 实例 —— 所以能单测。
 *
 * 为什么值得单独一个文件:`timestamp` 在 journal 里是 **ISO 字符串**(见
 * `AgentSession.appendCompaction` 的 `new Date().toISOString()`),而读它的地方有三处
 * (会话视图、历史投影、用量估算)。三处各写一遍"字符串 → 数字"的结果,是其中一处漏了这一步:
 * 它把 ISO 串直接和数字比大小(JS 会先 `ToNumber`,得到 `NaN`),于是"最后一次压缩的时间戳"
 * 恒为 `0`,"只认压缩之后的 provider 用量"这条边界整个失效 —— 表现是**手动压缩之后指示器停在
 * 压缩前的百分比上**,要等下一轮对话才动。
 *
 * 这类"同一事实三处认"的漂移,判据只能有一处;这里就是那一处。
 */

/** 一行 `type: "compaction"` 的 journal 条目,读成运行时结构。 */
export interface JournalCompaction {
  id: string;
  /** 毫秒时间戳。journal 里存的是 ISO 字符串,这里已经换算过。 */
  timestamp: number;
  summary: string;
  tokensBefore: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * journal 的时间戳:ISO 字符串(正常)或数字(旧数据、测试构造)。
 *
 * 两种都读不出来时退到 `now`,而**不是退到 0**:读不出来的压缩条目仍然是一次"刚发生的压缩",
 * 退到 0 会让它排到所有消息之前,于是"压缩边界"失效 —— 那正是这个文件要修掉的那件事。
 */
function journalTimestamp(value: unknown, now: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return now;
}

/**
 * 读一行压缩条目。不是压缩条目、或缺少必要字段时返回 `undefined`(调用方跳过它)。
 *
 * `now` 可注入,好让"时间戳读不出来"这一档能测 —— 它是这个函数里唯一的非纯输入。
 */
export function journalCompaction(
  entry: unknown,
  now: number = Date.now(),
): JournalCompaction | undefined {
  const value = asRecord(entry);
  if (
    value?.type !== "compaction" ||
    typeof value.id !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.tokensBefore !== "number"
  ) {
    return undefined;
  }
  return {
    id: value.id,
    timestamp: journalTimestamp(value.timestamp, now),
    summary: value.summary,
    tokensBefore: value.tokensBefore,
  };
}

/**
 * 最后一次压缩的时间戳;从没压缩过是 `0`。
 *
 * `0` 在这里是"没有边界"的意思(而不是"1970 年"):没有压缩过时,最后一条 assistant 的
 * provider 用量就是当前上下文的真实大小,不该被任何边界排除掉。
 */
export function latestCompactionTimestamp(entries: readonly unknown[]): number {
  let latest = 0;
  for (const entry of entries) {
    const compaction = journalCompaction(entry);
    if (compaction && compaction.timestamp > latest) latest = compaction.timestamp;
  }
  return latest;
}
