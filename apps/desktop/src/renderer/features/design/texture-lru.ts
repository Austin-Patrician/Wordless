/**
 * 位图缓存的淘汰策略。
 *
 * 纯逻辑,不含实际存储 —— 调用方持有 `ImageBitmap` 并负责 `close()`,这里只回答
 * "该丢哪些"。分开的理由是这条逻辑要能单测:淘汰算错的表现是内存持续增长或画布
 * 反复重光栅,两者都很难在界面上直接看出来。
 *
 * 位置放在渲染层而不是主进程:位图(`ImageBitmap`)住在渲染进程,主进程只负责流字节。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface LruEntry {
  key: string;
  /** 这一条占的字节数。 */
  bytes: number;
  /** 最后一次被用到的时间戳(越大越新)。 */
  lastUsed: number;
  /** 解码后的像素数。压缩字节无法代表浏览器实际占用。 */
  pixels?: number;
}

export interface LruLimits {
  budgetBytes: number;
  maxEntries: number;
  maxPixels?: number;
}

/**
 * 返回应当丢弃的 key,最久未用优先,直到同时满足字节预算与条数上限。
 *
 * 排序是**确定**的(`lastUsed` 升序,同值时按 `key` 升序),否则同样的输入可能淘汰
 * 不同的条目,测试会变成偶发。
 *
 * 一个条目自身就超过字节预算时也会被丢弃:宁可不缓存这一张,也不越过预算 —— 越过预算
 * 的后果是内存无上限增长,而单张放不下的后果只是这一帧反复重光栅。
 */
export function lruEvict(entries: readonly LruEntry[], limits: LruLimits): string[] {
  const budgetBytes = Number.isFinite(limits.budgetBytes) ? Math.max(0, limits.budgetBytes) : 0;
  const maxEntries = Number.isFinite(limits.maxEntries) ? Math.max(0, Math.floor(limits.maxEntries)) : 0;
  const maxPixels = limits.maxPixels === undefined
    ? Number.POSITIVE_INFINITY
    : Number.isFinite(limits.maxPixels)
      ? Math.max(0, limits.maxPixels)
      : 0;

  const ordered = [...entries].sort((left, right) =>
    left.lastUsed === right.lastUsed ? left.key.localeCompare(right.key) : left.lastUsed - right.lastUsed,
  );

  const dropped: string[] = [];
  let bytes = ordered.reduce((total, entry) => total + safeBytes(entry.bytes), 0);
  let count = ordered.length;
  let pixels = ordered.reduce((total, entry) => total + safePixels(entry.pixels), 0);

  for (const entry of ordered) {
    if (bytes <= budgetBytes && count <= maxEntries && pixels <= maxPixels) break;
    dropped.push(entry.key);
    bytes -= safeBytes(entry.bytes);
    count -= 1;
    pixels -= safePixels(entry.pixels);
  }
  return dropped;
}

/** 缓存当前占用的总字节。非法字节数按 0 计,不让一个 NaN 把预算判定带偏。 */
export function lruTotalBytes(entries: readonly LruEntry[]): number {
  return entries.reduce((total, entry) => total + safeBytes(entry.bytes), 0);
}

function safeBytes(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function safePixels(pixels: number | undefined): number {
  return pixels !== undefined && Number.isFinite(pixels) && pixels > 0 ? pixels : 0;
}
