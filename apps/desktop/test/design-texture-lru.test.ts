import assert from "node:assert/strict";
import test from "node:test";
import { lruEvict, lruTotalBytes, type LruEntry } from "../src/renderer/features/design/texture-lru.ts";

function entry(key: string, bytes: number, lastUsed: number): LruEntry {
  return { key, bytes, lastUsed };
}

const LIMITS = { budgetBytes: 1000, maxEntries: 10 };

test("都在预算内时什么都不丢", () => {
  const entries = [entry("a", 300, 1), entry("b", 300, 2)];
  assert.deepEqual(lruEvict(entries, LIMITS), []);
});

test("超出字节预算时从最久未用的开始丢", () => {
  const entries = [entry("newest", 400, 30), entry("oldest", 400, 10), entry("middle", 400, 20)];
  // 合计 1200 > 1000,丢掉最久未用的那一条即可回到 800。
  assert.deepEqual(lruEvict(entries, LIMITS), ["oldest"]);
});

test("超出条数上限时也从最久未用的开始丢", () => {
  const entries = [entry("a", 1, 3), entry("b", 1, 1), entry("c", 1, 2)];
  assert.deepEqual(lruEvict(entries, { budgetBytes: 1000, maxEntries: 2 }), ["b"]);
});

test("单条就超过预算时会被丢弃", () => {
  // 宁可不缓存这一张,也不越过预算 —— 越过预算的后果是内存无上限增长,
  // 而单张放不下的后果只是这一帧反复重光栅。
  const entries = [entry("huge", 5000, 1), entry("small", 100, 2)];
  assert.deepEqual(lruEvict(entries, LIMITS), ["huge"]);
});

test("条数上限为 0 时全部丢弃", () => {
  const entries = [entry("a", 1, 1), entry("b", 1, 2)];
  assert.deepEqual(lruEvict(entries, { budgetBytes: 1000, maxEntries: 0 }), ["a", "b"]);
});

test("空集合与已达标集合返回空数组", () => {
  assert.deepEqual(lruEvict([], LIMITS), []);
  assert.deepEqual(lruEvict([entry("a", 1000, 1)], LIMITS), []);
});

test("排序是确定的,同样的输入不会淘汰不同的条目", () => {
  // lastUsed 相同时按 key 升序 —— 否则测试会变成偶发。
  const entries = [entry("z", 400, 5), entry("a", 400, 5), entry("m", 400, 5)];
  assert.deepEqual(lruEvict(entries, LIMITS), ["a"]);
  // 换个输入顺序,结果必须一样。
  const reordered = [entry("m", 400, 5), entry("z", 400, 5), entry("a", 400, 5)];
  assert.deepEqual(lruEvict(reordered, LIMITS), ["a"]);
});

test("非法的字节数与上限不会把判定带偏", () => {
  // 一个 NaN 若被当成"0 字节",这条就永远不会被淘汰,缓存会一直涨。
  assert.deepEqual(lruEvict([entry("a", Number.NaN, 1)], LIMITS), []);
  assert.equal(lruTotalBytes([entry("a", Number.NaN, 1), entry("b", 10, 2)]), 10);
  assert.equal(lruTotalBytes([entry("a", -5, 1)]), 0);

  // 预算非法时按 0 处理 → 全部丢弃,而不是"预算无限"。
  assert.deepEqual(lruEvict([entry("a", 10, 1)], { budgetBytes: Number.NaN, maxEntries: 10 }), ["a"]);
});

test("总量计算与淘汰判定一致", () => {
  const entries = [entry("a", 300, 1), entry("b", 200, 2)];
  assert.equal(lruTotalBytes(entries), 500);
  assert.deepEqual(lruEvict(entries, { budgetBytes: 500, maxEntries: 10 }), []);
  assert.deepEqual(lruEvict(entries, { budgetBytes: 499, maxEntries: 10 }), ["a"]);
});

test("解码像素超出预算时也按 LRU 淘汰", () => {

  const entries = [entry("old", 1, 1), entry("new", 1, 2)].map((item, index) => ({
    ...item,
    pixels: index === 0 ? 60 : 50,
  }));
  assert.deepEqual(lruEvict(entries, { budgetBytes: 1000, maxEntries: 10, maxPixels: 100 }), ["old"]);
});
