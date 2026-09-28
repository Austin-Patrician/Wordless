import assert from "node:assert/strict";
import test from "node:test";
import { TextureCache } from "../src/renderer/features/design/texture-cache.ts";

/** 假句柄:淘汰策略的测试不需要真的位图。 */
type Handle = { id: string };

function cache(limits: { budgetBytes: number; maxEntries: number }) {
  const disposed: string[] = [];
  let clock = 0;
  const instance = new TextureCache<Handle>({
    dispose: (handle) => disposed.push(handle.id),
    limits,
    now: () => {
      clock += 1;
      return clock;
    },
  });
  return { instance, disposed };
}

function handle(id: string): Handle {
  return { id };
}

test("放入与取用", () => {
  const { instance } = cache({ budgetBytes: 1000, maxEntries: 10 });
  instance.set("a", handle("a"), 100);
  assert.equal(instance.has("a"), true);
  assert.equal(instance.get("a")?.id, "a");
  assert.equal(instance.get("missing"), null);
  assert.equal(instance.size, 1);
  assert.equal(instance.bytes, 100);
});

test("超出条数上限时淘汰最久未用的", () => {
  const { instance, disposed } = cache({ budgetBytes: 1000, maxEntries: 2 });
  instance.set("a", handle("a"), 10);
  instance.set("b", handle("b"), 10);
  instance.set("c", handle("c"), 10);
  // a 最久未用 → 被淘汰,而且句柄被释放(否则漏一个 URL)。
  assert.deepEqual(disposed, ["a"]);
  assert.deepEqual([...["a", "b", "c"]].filter((key) => instance.has(key)), ["b", "c"]);
});

test("取用会刷新使用时间", () => {
  const { instance, disposed } = cache({ budgetBytes: 1000, maxEntries: 2 });
  instance.set("a", handle("a"), 10);
  instance.set("b", handle("b"), 10);
  instance.get("a");
  instance.set("c", handle("c"), 10);
  // a 刚被用过,所以这次淘汰 b。
  assert.deepEqual(disposed, ["b"]);
});

test("超出字节预算时也按 LRU 淘汰", () => {
  const { instance, disposed } = cache({ budgetBytes: 25, maxEntries: 10 });
  instance.set("a", handle("a"), 10);
  instance.set("b", handle("b"), 10);
  instance.set("c", handle("c"), 10);
  assert.deepEqual(disposed, ["a"]);
  assert.ok(instance.bytes <= 25);
});

test("单张就超过预算时不缓存它,但句柄被释放", () => {
  // 宁可不缓存这一张,也不越过预算:越过预算的后果是内存无上限增长。
  const { instance, disposed } = cache({ budgetBytes: 50, maxEntries: 10 });
  instance.set("huge", handle("huge"), 500);
  assert.equal(instance.has("huge"), false);
  assert.deepEqual(disposed, ["huge"]);
  assert.equal(instance.bytes, 0);
});

test("同 key 覆盖时先释放旧句柄", () => {
  // 重新光栅(换缩放档)会覆盖同一个 key。不释放的话每换一次档就漏一个 URL。
  const { instance, disposed } = cache({ budgetBytes: 1000, maxEntries: 10 });
  instance.set("a", handle("first"), 10);
  instance.set("a", handle("second"), 10);
  assert.deepEqual(disposed, ["first"]);
  assert.equal(instance.get("a")?.id, "second");
  assert.equal(instance.size, 1);
});

test("清空释放全部句柄", () => {
  const { instance, disposed } = cache({ budgetBytes: 1000, maxEntries: 10 });
  instance.set("a", handle("a"), 10);
  instance.set("b", handle("b"), 10);
  instance.clear();
  assert.deepEqual(disposed.sort(), ["a", "b"]);
  assert.equal(instance.size, 0);
});

test("非法的字节数不会让某一条永不淘汰", () => {
  // NaN 若被当成 0 字节,这一条就永远不会因预算被淘汰,缓存会一直涨。
  const { instance } = cache({ budgetBytes: 10, maxEntries: 10 });
  instance.set("a", handle("a"), Number.NaN);
  instance.set("b", handle("b"), 10);
  instance.set("c", handle("c"), 10);
  assert.ok(instance.size <= 2);
});
