import { describe, expect, it } from "vitest";
import {
	countBpeTokens,
	estimateBpeTokens,
	GENERIC_BPE_SAFETY_FACTOR,
	TokenCache,
	tokenCacheStats,
} from "../src/utils/tokenizer.ts";

/**
 * 这份缓存曾经把安装版的主进程撑到 1GB 以上:它的 key 是文本本身,而调用方里有一个
 * 每次消息完成就把**整段会话上下文**(单条 6MB 量级)喂进来。那时只有"2048 条"这一个
 * 上限,于是巨文本被一条条留了下来 —— 条数远没到,内存早就爆了。
 *
 * 断言的是**不变量**,不是实现细节:
 * 1. 计数结果与"不缓存"时完全一致(缓存只能改"算几次",绝不能改"算出多少")。
 * 2. 任何时刻缓存的字符总量不越过预算。
 * 3. 超过单条上限的文本根本不进缓存。
 * 4. 反复估算同一段大上下文,保留量不增长 —— 这正是当初那个 bug 的形状。
 *
 * 每条用例都 `new TokenCache({...})`:额度在构造时给,实例之间天然互不干扰,所以既不需要
 * "先重置再断言"的顺序,也不需要把额度调小这件事暴露到生产入口上。生产的 4MB 额度在这里
 * 是跑不动的 —— 真喂 4MB 字符给 BPE,一个用例就要 200 秒。
 */
describe("token cache", () => {
	it("caches repeated small text without changing the count", () => {
		const cache = new TokenCache();
		const text = "The quick brown fox jumps over the lazy dog.";
		const first = cache.count(text);
		const second = cache.count(text);

		expect(second).toBe(first);
		expect(cache.stats().entries).toBe(1);
		expect(cache.stats().chars).toBe(text.length);
		expect(cache.stats().hits).toBe(1);
	});

	it("returns exactly the uncached count for a text it refuses to cache", () => {
		const cache = new TokenCache({ maxEntryChars: 64 });
		const oversized = "token ".repeat(40);
		const small = "token token";
		expect(oversized.length).toBeGreaterThan(64);

		const first = cache.count(oversized);
		expect(cache.stats()).toMatchObject({ entries: 0, chars: 0, skipped: 1, misses: 1 });
		expect(cache.count(oversized)).toBe(first);
		expect(cache.stats()).toMatchObject({ entries: 0, chars: 0, skipped: 2, misses: 2 });

		// 同一条路径上,小文本照常被缓存 —— 拒绝缓存巨文本不等于把缓存关掉。
		expect(cache.count(small)).toBe(cache.count(small));
		expect(cache.stats().entries).toBe(1);
		expect(cache.stats().hits).toBe(1);
	});

	it("does not retain a large context that keeps being re-estimated", () => {
		// 复现原始缺陷的调用形状:同一段大文本反复进来。旧实现会把它整段留下。
		const cache = new TokenCache({ maxEntryChars: 1024 });
		const context = "x".repeat(4096);
		for (let round = 0; round < 20; round += 1) cache.count(context);

		const stats = cache.stats();
		expect(stats.entries).toBe(0);
		expect(stats.chars).toBe(0);
		expect(stats.skipped).toBe(20);
	});

	it("never lets the total retained chars exceed the budget", () => {
		const cache = new TokenCache({ maxChars: 200, maxEntries: 1000 });
		for (let index = 0; index < 60; index += 1) cache.count(`entry number ${index} padded`);

		const stats = cache.stats();
		expect(stats.chars).toBeLessThanOrEqual(200);
		// 预算不是"把缓存关掉"的借口:最近用过的那些仍然在里面。
		expect(stats.entries).toBeGreaterThan(1);
	});

	it("evicts the least recently used entry first, not the newest", () => {
		// 额度 45:a+b 刚好 30,再用一次 a 把它变成"最近使用",此时插入 c(20)会越界,
		// 必须淘汰 b —— 命中的 a 不许被淘汰。
		const cache = new TokenCache({ maxChars: 45, maxEntries: 1000 });
		const a = "aaaaaaaaaaaaaaa"; // 15 字符
		const b = "bbbbbbbbbbbbbbb"; // 15 字符
		const c = "cccccccccccccccccccc"; // 20 字符
		cache.count(a);
		cache.count(b);
		cache.count(a);
		cache.count(c);

		expect(cache.stats().chars).toBeLessThanOrEqual(45);
		// a 仍命中(它在 c 之前刚被用过),b 已经不在缓存里。
		cache.count(a);
		cache.count(b);
		const stats = cache.stats();
		expect(stats.hits).toBe(2); // 第一次"再用 a" + 这一次
		expect(stats.misses).toBe(4); // a、b、c、b
	});

	it("applies the cross-provider safety factor on top of the raw count", () => {
		const text = "safety factor";
		expect(estimateBpeTokens(text)).toBe(Math.ceil(countBpeTokens(text) * GENERIC_BPE_SAFETY_FACTOR));
	});

	it("keeps the shared instance's budget visible so a regression can be seen", () => {
		// 观测面本身也要有人守:额度一旦被谁改小/改没,这条会红。
		const stats = tokenCacheStats();
		expect(stats.maxChars).toBe(4 * 1024 * 1024);
		expect(stats.maxEntryChars).toBe(256 * 1024);
		expect(stats.chars).toBeLessThanOrEqual(stats.maxChars);
	});
});
