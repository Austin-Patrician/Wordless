import { describe, expect, it } from "vitest";
import { journalCompaction, latestCompactionTimestamp } from "../src/journal-entries.ts";

/**
 * journal 压缩条目的读取口径。
 *
 * 这里钉的是一条**真实坏过**的判据:`timestamp` 在 journal 里是 ISO 字符串,而读它的三处
 * 里有一处把它当数字用。JS 的 `"2026-…" > 0` 会先 `ToNumber` 得到 `NaN`,比较恒为 false,
 * 于是"最后一次压缩的时间戳"恒为 0 —— 用量估算里"只认压缩之后的 provider 用量"这条边界
 * 整个失效,表现是**手动压缩后指示器停在压缩前的百分比上**,要等下一轮对话才动。
 *
 * 所以下面第一条测试就是那次事故本身:字符串时间戳必须被解析,而不是被丢掉。
 */

/** `AgentSession.appendCompaction` 写进 journal 的形状。 */
const compactionEntry = (timestamp: string, overrides: Record<string, unknown> = {}) => ({
  type: "compaction",
  id: "c1",
  parentId: null,
  timestamp,
  summary: "summary",
  firstKeptEntryId: "e1",
  tokensBefore: 120_000,
  ...overrides,
});

describe("journal compaction entry", () => {
	it("把 ISO 字符串时间戳解析成毫秒 —— 而不是当成数字丢掉", () => {
		const entry = compactionEntry("2026-10-11T14:19:23.705Z");
		expect(journalCompaction(entry)?.timestamp).toBe(Date.parse("2026-10-11T14:19:23.705Z"));
	});

	it("数字时间戳也认(旧数据、测试构造)", () => {
		expect(journalCompaction(compactionEntry("x", { timestamp: 1_700_000_000_000 }))?.timestamp).toBe(1_700_000_000_000);
	});

	it("时间戳读不出来时退到 now,而不是退到 0", () => {
		// 退到 0 会让这次压缩排到所有消息之前,边界失效 —— 那正是要修的那件事。
		expect(journalCompaction(compactionEntry("not a date"), 1_700_000_000_000)?.timestamp).toBe(1_700_000_000_000);
	});

	it("不是压缩条目、或缺少必要字段时返回 undefined", () => {
		expect(journalCompaction({ type: "message", id: "m1" })).toBeUndefined();
		expect(journalCompaction({ type: "compaction", id: "c1", summary: "s" })).toBeUndefined();
		expect(journalCompaction(undefined)).toBeUndefined();
		expect(journalCompaction("compaction")).toBeUndefined();
	});
});

describe("latestCompactionTimestamp", () => {
	it("取最后一次压缩的时间戳", () => {
		const entries = [
			{ type: "message", id: "m1", timestamp: "2026-10-11T14:00:00.000Z" },
			compactionEntry("2026-10-11T14:19:23.705Z", { id: "c1" }),
			compactionEntry("2026-10-11T15:00:00.000Z", { id: "c2" }),
		];
		expect(latestCompactionTimestamp(entries)).toBe(Date.parse("2026-10-11T15:00:00.000Z"));
	});

	it("从没压缩过是 0 —— 0 是「没有边界」,不是「1970 年」", () => {
		// 没有压缩过时,最后一条 assistant 的 provider 用量就是当前上下文的真实大小,
		// 不该被任何边界排除掉。
		expect(latestCompactionTimestamp([{ type: "message", id: "m1", timestamp: "2026-10-11T14:00:00.000Z" }])).toBe(0);
		expect(latestCompactionTimestamp([])).toBe(0);
	});

	it("能挡住「压缩之前那条 provider 用量」—— 这正是它存在的理由", () => {
		// 压缩后没有任何新消息时,边界必须落在压缩那一刻:比它早的 assistant 用量一律不算。
		const compactedAt = Date.parse("2026-10-11T14:19:23.705Z");
		const boundary = latestCompactionTimestamp([compactionEntry("2026-10-11T14:19:23.705Z")]);
		expect(boundary).toBe(compactedAt);
		const messages = [
			{ role: "assistant", timestamp: compactedAt - 60_000, usage: { input: 180_000 } },
		];
		// 与 `WordlessRuntime.latestProviderInputTokens` 同一个判据。
		const usable = messages.filter((message) => !(typeof message.timestamp === "number" && message.timestamp <= boundary));
		expect(usable).toHaveLength(0);
	});

	it("读的是**真实** journal 条目:appendCompaction 写的就是 ISO 字符串", async () => {
		// 这一条是这次事故的护栏。上面几条用的是手搭的 fixture,它们只能证明"按我理解的形状
		// 是对的";真正坏掉的是"我理解的形状 ≠ journal 的形状" —— 所以这里用真的 Session
		// 写一行真的压缩条目,再读回来。`timestamp` 哪天改成数字,这条会先红。
		const agent = (await import("@wordless/agent")) as unknown as {
			InMemorySessionStorage: new (options: { metadata: { createdAt: string; id: string } }) => unknown;
			Session: new (storage: unknown) => {
				appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number): Promise<string>;
				appendMessage(message: unknown): Promise<string>;
				getEntries(): Promise<unknown[]>;
			};
		};
		const session = new agent.Session(
			new agent.InMemorySessionStorage({ metadata: { createdAt: new Date(0).toISOString(), id: "session-compaction" } }),
		);
		await session.appendMessage({ role: "assistant", content: [{ type: "text", text: "before" }] });
		await session.appendCompaction("summary", "kept", 120_000);

		const entries = await session.getEntries();
		const entry = entries.find((candidate) => (candidate as { type?: string }).type === "compaction") as { timestamp: unknown };
		expect(typeof entry.timestamp).toBe("string");

		// 关键断言:边界必须落在**压缩那一刻**,而不是 0(0 会让边界失效、用量停在压缩前)。
		expect(latestCompactionTimestamp(entries)).toBe(Date.parse(entry.timestamp as string));
		expect(latestCompactionTimestamp(entries)).toBeGreaterThan(0);
	});
});
