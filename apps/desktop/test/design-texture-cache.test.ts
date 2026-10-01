import assert from "node:assert/strict";
import test from "node:test";
import { DESIGN_CANVAS_BUDGETS } from "../src/renderer/features/design/budgets.ts";
import { TextureCache } from "../src/renderer/features/design/texture-cache.ts";

/** 假句柄:淘汰策略的测试不需要真的位图。 */
type Handle = { id: string };

function textureCache(limits: { budgetBytes: number; maxEntries: number; maxPixels?: number }) {
  const { instance, disposed } = cache(limits);
  return { disposed, instance };
}

function cache(limits: { budgetBytes: number; maxEntries: number; maxPixels?: number }) {
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

/**
 * 真实规模下这条预算会不会真的触发 —— 上面那些用例用的是"限制 100px"这种玩具数字,
 * 它们只证明机制成立,证明不了**在你的数据上会不会发生**。
 *
 * 下面的字节/像素是**实测**的:390×844 的帧走 CDP 抓图,1 倍 6689B、2 倍 18378B
 * (见 docs/architecture/design-canvas.md 第 ② 步的测量表)。
 */
const REAL_FRAME_2X = { bytes: 18_378, pixels: 780 * 1_688 };

test("只按字节的旧预算在 40 帧设计上永不淘汰,像素预算才会", () => {
  const frames = 40;
  const totalBytes = REAL_FRAME_2X.bytes * frames;
  const totalPixels = REAL_FRAME_2X.pixels * frames;

  // 前提先钉住:JPEG 的字节数比像素低一个量级,所以字节预算**永远**不会先触发。
  assert.ok(
    totalBytes < DESIGN_CANVAS_BUDGETS.textureByteBudget,
    `40 帧的 JPEG 只有 ${(totalBytes / 1024).toFixed(0)}KB,远在 ${DESIGN_CANVAS_BUDGETS.textureByteBudget / 1048576}MB 字节预算内`,
  );
  assert.ok(totalPixels > DESIGN_CANVAS_BUDGETS.texturePixelBudget, "40 帧的解码像素超出像素预算");

  // 改动前(只有字节预算):一帧都不淘汰,而浏览器那边是 40 张 2 倍位图。
  const byteOnly = textureCache({ budgetBytes: DESIGN_CANVAS_BUDGETS.textureByteBudget, maxEntries: DESIGN_CANVAS_BUDGETS.maxTextures });
  // 改动后(加上像素预算)。
  const bounded = textureCache({
    budgetBytes: DESIGN_CANVAS_BUDGETS.textureByteBudget,
    maxEntries: DESIGN_CANVAS_BUDGETS.maxTextures,
    maxPixels: DESIGN_CANVAS_BUDGETS.texturePixelBudget,
  });
  for (let index = 0; index < frames; index += 1) {
    byteOnly.instance.set(`f${index}`, handle(`f${index}`), REAL_FRAME_2X.bytes, REAL_FRAME_2X.pixels);
    bounded.instance.set(`f${index}`, handle(`f${index}`), REAL_FRAME_2X.bytes, REAL_FRAME_2X.pixels);
  }

  assert.equal(byteOnly.instance.size, frames, "只按字节:40 帧全部留着");
  assert.equal(bounded.instance.size < frames, true, "加上像素预算:要淘汰掉一些");
  assert.ok(bounded.instance.pixels <= DESIGN_CANVAS_BUDGETS.texturePixelBudget);
  assert.equal(bounded.disposed.length, frames - bounded.instance.size, "淘汰的都被释放了");
});

test("真实设计(4–7 帧 @2x)碰不到像素预算 —— 这条改动不在你的数据上生效", () => {
  // 工作区里最大的设计是 7 帧 390×844:2 倍下 9.2M px,只有预算的 28%。
  const frames = 7;
  const { instance, disposed } = textureCache({
    budgetBytes: DESIGN_CANVAS_BUDGETS.textureByteBudget,
    maxEntries: DESIGN_CANVAS_BUDGETS.maxTextures,
    maxPixels: DESIGN_CANVAS_BUDGETS.texturePixelBudget,
  });
  for (let index = 0; index < frames; index += 1)
    instance.set(`f${index}`, handle(`f${index}`), REAL_FRAME_2X.bytes, REAL_FRAME_2X.pixels);

  assert.equal(instance.size, frames);
  assert.deepEqual(disposed, []);
  assert.equal(instance.pixels * 4 / 1048576 < 40, true, "7 帧 2 倍只有三十几 MB 解码内存");
});

/**
 * 预算从第几帧开始咬人 —— 把这条边界写下来,免得以后有人以为它"总是"在生效。
 */
test("像素预算装得下 25 帧 @2x,第 26 帧才开始淘汰", () => {
  const budget = DESIGN_CANVAS_BUDGETS.texturePixelBudget;
  const fits = Math.floor(budget / REAL_FRAME_2X.pixels);
  // 390×844 的帧 2 倍下是 1.32M px,32Mi px 的预算装得下 25 帧(26 帧就 34.2M,超了)。
  assert.equal(fits, 25);

  const { instance } = textureCache({
    budgetBytes: DESIGN_CANVAS_BUDGETS.textureByteBudget,
    maxEntries: DESIGN_CANVAS_BUDGETS.maxTextures,
    maxPixels: budget,
  });
  for (let index = 0; index < fits; index += 1)
    instance.set(`f${index}`, handle(`f${index}`), REAL_FRAME_2X.bytes, REAL_FRAME_2X.pixels);
  assert.equal(instance.size, fits, "刚好装满,不淘汰");

  instance.set("one-more", handle("one-more"), REAL_FRAME_2X.bytes, REAL_FRAME_2X.pixels);
  assert.equal(instance.size, fits, "第 26 帧进来,最旧的让位");
  assert.equal(instance.has("f0"), false);
});

test("解码像素预算会释放真实占用更大的旧位图", () => {
  const disposed: string[] = [];
  const bounded = new TextureCache<Handle>({
    dispose: (value) => disposed.push(value.id),
    limits: { budgetBytes: 1000, maxEntries: 10, maxPixels: 100 },
    now: (() => { let tick = 0; return () => ++tick; })(),
  });
  bounded.set("old", handle("old"), 1, 60);
  bounded.set("new", handle("new"), 1, 50);
  assert.deepEqual(disposed, ["old"]);
  assert.equal(bounded.has("new"), true);
});

test("单张超过像素预算时不保留句柄", () => {
  const disposed: string[] = [];
  const bounded = new TextureCache<Handle>({
    dispose: (value) => disposed.push(value.id),
    limits: { budgetBytes: 1000, maxEntries: 10, maxPixels: 100 },
  });
  bounded.set("huge", handle("huge"), 1, 101);
  assert.equal(bounded.has("huge"), false);
  assert.deepEqual(disposed, ["huge"]);
});
