import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RemoteEventJournal } from "../src/event-journal.ts";
import type { RemoteEvent } from "../src/types.ts";

/**
 * 出站事件日志。
 *
 * 它决定了"断线之后对端要补多少"和"什么时候必须整体重拉"。所以两件事都要钉住:
 * **能补就补**,**补不了要明确说补不了**(而不是让对端把新事件当成已见过的丢掉)。
 */

const event = (sequence: number): RemoteEvent => ({
	type: "event",
	eventId: `e${sequence}`,
	sequence,
	name: "session.message",
	payload: { sequence },
});

const fill = (journal: RemoteEventJournal, count: number): void => {
	for (let index = 1; index <= count; index += 1) journal.remember(event(journal.nextSequence()));
};

describe("序号与补发", () => {
	it("序号从 1 开始且单调递增", () => {
		const journal = new RemoteEventJournal();
		assert.equal(journal.lastSequence, 0);
		assert.equal(journal.nextSequence(), 1);
		assert.equal(journal.nextSequence(), 2);
		assert.equal(journal.lastSequence, 2);
	});

	it("只补缺失的尾部", () => {
		const journal = new RemoteEventJournal();
		fill(journal, 3);
		assert.deepEqual(
			journal.replay(1)?.map((entry) => entry.sequence),
			[2, 3],
		);
	});

	it("已经追平时补发空数组(而不是 undefined)", () => {
		const journal = new RemoteEventJournal();
		fill(journal, 3);
		assert.deepEqual(journal.replay(3), []);
	});

	it("对端确认之后,它之前的事件就被丢掉,不会重复补发", () => {
		const journal = new RemoteEventJournal();
		fill(journal, 3);
		journal.acknowledge(2);
		assert.deepEqual(
			journal.replay(2)?.map((entry) => entry.sequence),
			[3],
		);
		// 对端若声称只收到 0(丢了状态),1 与 2 已经不在日志里 —— 这时必须整体重拉,不能装作补得上。
		assert.equal(journal.replay(0), undefined);
	});
});

describe("补不了的时候要明确说补不了", () => {
	it("超过条数上限:被淘汰的尾部补不上", () => {
		const journal = new RemoteEventJournal({ capacity: 3 });
		fill(journal, 5);
		assert.equal(journal.replay(0), undefined);
		assert.deepEqual(
			journal.replay(2)?.map((entry) => entry.sequence),
			[3, 4, 5],
		);
	});

	it("超过时长上限:过老的事件被淘汰", () => {
		let now = 0;
		const journal = new RemoteEventJournal({ maxAgeMs: 1_000, now: () => now });
		fill(journal, 2);
		now = 2_000;
		assert.equal(journal.replay(0), undefined);
	});

	it("端点重启(日志是新的一份)时,对端必须整体重拉", () => {
		const journal = new RemoteEventJournal();
		// 对端说"我收到 5 了",而这份日志从没见过 5 —— 若返回空数组,对端会把接下来每个新事件都当已见过。
		assert.equal(journal.replay(5), undefined);
	});

	it("容量至少保留 1 条,不会被配成 0", () => {
		const journal = new RemoteEventJournal({ capacity: 0 });
		fill(journal, 2);
		assert.deepEqual(
			journal.replay(1)?.map((entry) => entry.sequence),
			[2],
		);
	});
});
