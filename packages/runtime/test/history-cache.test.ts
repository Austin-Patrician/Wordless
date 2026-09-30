import { describe, expect, it } from "vitest";
import {
	HISTORY_BYTES_PER_FILE_BYTE,
	HISTORY_CACHE_LIMITS,
	historyCacheEvictions,
	historyRevision,
} from "../src/history-cache.ts";

/**
 * 会话视图缓存的策略。
 *
 * 它算错的两个后果都不会在界面上直接看出来:额度算小了 → 内存无上限增长;算大了 →
 * 每次切会话都重新解析一遍 12MB 的 journal。所以它必须能单测。
 */
describe("history cache policy", () => {
	it("keeps everything while both limits hold", () => {
		const entries = [
			{ sessionId: "a", bytes: 10 },
			{ sessionId: "b", bytes: 20 },
		];
		expect(historyCacheEvictions(entries)).toEqual([]);
	});

	it("evicts the oldest first until the entry count fits", () => {
		const entries = Array.from({ length: 7 }, (_value, index) => ({
			sessionId: `s${index}`,
			bytes: 1,
		}));
		expect(historyCacheEvictions(entries)).toEqual(["s0", "s1"]);
	});

	it("evicts by accounted bytes, not by the raw file size", () => {
		// 五份 12MB 的会话:按文件大小是 60MB(看起来刚好符合 64MB 预算),按 3 倍记账是
		// 每份 36MB —— 只能留下一份,最旧的四份必须丢掉。
		const twelveMb = 12 * 1024 * 1024;
		const perEntry = twelveMb * HISTORY_BYTES_PER_FILE_BYTE;
		const entries = Array.from({ length: 5 }, (_value, index) => ({
			sessionId: `s${index}`,
			bytes: perEntry,
		}));

		const evicted = historyCacheEvictions(entries);
		expect(evicted).toEqual(["s0", "s1", "s2", "s3"]);
		expect(entries.length - evicted.length).toBe(
			Math.floor(HISTORY_CACHE_LIMITS.maxBytes / perEntry),
		);
	});

	it("drops a single entry that alone blows the byte budget", () => {
		// 单份就超额度:宁可不缓存这一份,也不越过预算。
		const entries = [{ sessionId: "huge", bytes: HISTORY_CACHE_LIMITS.maxBytes + 1 }];
		expect(historyCacheEvictions(entries)).toEqual(["huge"]);
	});

	it("returns nothing for an empty cache, and is deterministic for ties", () => {
		expect(historyCacheEvictions([])).toEqual([]);
		const entries = Array.from({ length: 6 }, (_value, index) => ({
			sessionId: `s${index}`,
			bytes: 1,
		}));
		// 同样的输入必须得出同样的淘汰名单,否则测试会变成偶发。
		expect(historyCacheEvictions(entries)).toEqual(historyCacheEvictions(entries));
	});

	it("keys the revision on size and mtime so an append is always noticed", () => {
		expect(historyRevision({ size: 100, mtimeMs: 1_700_000_000_000 })).toBe("100:1700000000000");
		// mtime 取整:统计口径里它是毫秒,不保留小数,免得同一状态被判成两个修订。
		expect(historyRevision({ size: 100, mtimeMs: 1_700_000_000_000.4 })).toBe("100:1700000000000");
		expect(historyRevision({ size: 101, mtimeMs: 1_700_000_000_000 })).not.toBe(
			historyRevision({ size: 100, mtimeMs: 1_700_000_000_000 }),
		);
	});
});
