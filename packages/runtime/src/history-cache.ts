/**
 * 会话视图缓存(history cache)的策略。
 *
 * 缓存的是"整份会话视图" —— 把 journal 逐行解析进内存之后投影出来的消息、压缩记录和
 * turn 版本。它服务的是会话搜索与反复切回同一个会话,代价是内存。
 *
 * 这里只放**纯策略**:怎么算一份的占用、修订号是什么、超额度时该淘汰哪些。它不持有缓存
 * 本身(那是 `WordlessRuntime` 的 `historyCache`),也不需要 Electron 或 fs。
 *
 * 为什么值得单独一个文件并单测:这条策略算错的表现是"内存无上限增长"或"每次切会话都重新
 * 解析一遍 12MB 的 journal",两者都不会在界面上直接看出来 —— 和渲染层那份 `lruEvict`
 * 是同一个理由。
 *
 * 本文件不 import React、不 import Electron、不 import fs。
 */

/**
 * 一份会话历史在内存里约等于它文件大小的几倍。
 *
 * 实测(12.8MB / 4122 条):逐行 `JSON.parse` 进 Map 之后 V8 堆增加 **1.95 倍**;再加上投影
 * 那一份(消息数组 + 按 turn 分组的结构)≈ **3 倍**。原先按 2 倍记账,于是"64MB 预算"实际
 * 能留下 150-200MB —— 一个说小了 1.5 倍的额度,调它的人不会知道自己在调什么。
 */
export const HISTORY_BYTES_PER_FILE_BYTE = 3;

export const HISTORY_CACHE_LIMITS = {
  maxEntries: 5,
  maxBytes: 64 * 1024 * 1024,
} as const;

export interface HistoryCacheLimit {
  maxEntries: number;
  maxBytes: number;
}

export interface HistoryCacheEntry {
  /** 会话 id。淘汰按传入顺序(最旧的在前)。 */
  sessionId: string;
  /** 按 `HISTORY_BYTES_PER_FILE_BYTE` 折算后的估算占用。 */
  bytes: number;
}

/**
 * 会话历史的修订号:文件自身的 `size:mtime`。
 *
 * 判据必须只有一处:用量估算(复用已算好的结果)与会话视图(缓存整份快照)各写一遍这个
 * 格式的话,两边迟早会漂开,而漂开的后果是"看起来命中、实际用的是旧数据"。
 *
 * journal 是**只追加**的,所以 size 一定会变;mtime 兜住"被外部替换成同样大小"那一档。
 */
export function historyRevision(details: { size: number; mtimeMs: number }): string {
  return `${details.size}:${Math.round(details.mtimeMs)}`;
}

/**
 * 该淘汰哪些条目,最旧的优先,直到同时满足条数与字节两条额度。
 *
 * 顺序是**确定**的(按传入顺序,不依赖 Map 之外的任何时间戳),否则同样的输入会淘汰不同
 * 条目,测试就变成偶发。
 *
 * 单份就超过字节额度时它也会被淘汰:宁可不缓存这一份,也不越过预算 —— 越过预算的后果是
 * 内存无上限增长,而不缓存这一份的后果只是切回它时重新解析一次。
 */
export function historyCacheEvictions(
  entries: readonly HistoryCacheEntry[],
  limits: HistoryCacheLimit = HISTORY_CACHE_LIMITS,
): string[] {
  const maxEntries = Math.max(0, Math.floor(limits.maxEntries));
  const maxBytes = Math.max(0, limits.maxBytes);

  const evicted: string[] = [];
  let remainingEntries = entries.length;
  let remainingBytes = entries.reduce((total, entry) => total + entry.bytes, 0);

  for (const entry of entries) {
    if (remainingEntries <= maxEntries && remainingBytes <= maxBytes) break;
    evicted.push(entry.sessionId);
    remainingEntries -= 1;
    remainingBytes -= entry.bytes;
  }
  return evicted;
}
