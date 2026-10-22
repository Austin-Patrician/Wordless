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
 * 一份会话历史**常驻**在内存里约等于它文件大小的几倍。
 *
 * 实测(`--expose-gc` 分阶段量堆,三份真实 journal:29.3MB / 26.2MB / 21.6MB):
 *
 * - **缓存常驻**(只留投影出来的消息 + 按 turn 分组的结构):**1.65× / 1.67× / 1.98×**;
 * - **装载峰值**(解析期间 `entries` 全在堆上):3.58× / 3.62× / 3.95×。
 *
 * 这里记的是**常驻**,所以取 2。峰值**不记在这本账里**:缓存不持有解析中间态(读完就丢,
 * 下一份装载重新解析),而且装载是单飞的 —— 峰值只取决于"一次解析一份",与缓存里有几条
 * 无关。把峰值折进缓存额度,得出的数与两者都不符。
 *
 * 曾经按 3 记账(那是峰值口径),后果是 64MB 预算只容得下 21MB 的 journal:内容最多的几个
 * 会话**永远进不了缓存**,每次打开都重解析整份文件(实测那份 29.3MB 仅解析就 290ms)。
 */
export const HISTORY_BYTES_PER_FILE_BYTE = 2;

export const HISTORY_CACHE_LIMITS = {
  maxEntries: 5,
  /**
   * 128MB(常驻口径)。取这个数是为了让**单个大会话一定进得来**:实测最大的会话 29.3MB
   * ⇒ 58.6MB,占预算 46%;两份大会话(58.6 + 52.4)也放得下。
   *
   * 64MB 那档下,32MB 以上的会话根本进不了缓存 —— 而那恰好是最需要缓存的那几个。
   */
  maxBytes: 128 * 1024 * 1024,
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
 *
 * 现在这条只对 64MB 以上的 journal 生效(2 倍折算 ⇒ 128MB 预算),而实测最大的会话是
 * 29.3MB。所以它是个**遥远的边界**,不是日常路径:真要越过它,说明该给"正在看的那一份"
 * 单独留位置了,而不是继续调这里。
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
