import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DRAFT_STORAGE_KEY,
	MAX_DRAFT_CHARS,
	clampComposerHeight,
	draftFor,
	readDrafts,
	settleSent,
	writeDraft,
} from "../src/composer.ts";

/**
 * 输入区的三件事:**草稿不丢**、**高度有上限**、**发送状态不撒谎**。
 */

const fakeStorage = (initial: Record<string, string> = {}) => {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		map,
	};
};

describe("输入框高度", () => {
	it("内容多高就多高,但不超过上限", () => {
		assert.equal(clampComposerHeight(20), 20);
		assert.equal(clampComposerHeight(999), 160);
	});

	it("量不出高度时给 0(由 CSS 的 min-height 兜底),而不是给个乱值", () => {
		assert.equal(clampComposerHeight(0), 0);
		assert.equal(clampComposerHeight(Number.NaN), 0);
		assert.equal(clampComposerHeight(-5), 0);
	});
});

describe("草稿", () => {
	it("按会话存:换会话不会把草稿带过去", () => {
		const storage = fakeStorage();
		let drafts = writeDraft(storage, {}, "s1", "给 A 的话");
		drafts = writeDraft(storage, drafts, "s2", "给 B 的话");
		assert.equal(draftFor(drafts, "s1"), "给 A 的话");
		assert.equal(draftFor(drafts, "s2"), "给 B 的话");
		assert.equal(draftFor(drafts, "s3"), "");
	});

	it("发完清空之后要删掉这一条,而不是留一个空字符串", () => {
		const storage = fakeStorage();
		let drafts = writeDraft(storage, {}, "s1", "草稿");
		drafts = writeDraft(storage, drafts, "s1", "");
		assert.equal(draftFor(drafts, "s1"), "");
		assert.deepEqual(Object.keys(drafts), []);
	});

	it("重新读一遍还在(这就是断网重连后草稿不丢)", () => {
		const storage = fakeStorage();
		writeDraft(storage, {}, "s1", "没发出去的一段话");
		assert.equal(draftFor(readDrafts(storage), "s1"), "没发出去的一段话");
	});

	it("存储里是坏数据时当成没有草稿,而不是炸掉", () => {
		assert.deepEqual(readDrafts(fakeStorage({ [DRAFT_STORAGE_KEY]: "不是 JSON" })), {});
		assert.deepEqual(readDrafts(fakeStorage({ [DRAFT_STORAGE_KEY]: "[1,2,3]" })), {});
		assert.deepEqual(readDrafts(fakeStorage({ [DRAFT_STORAGE_KEY]: '{"s1":42}' })), {});
	});

	it("超长草稿被截断(存储是有限的)", () => {
		const storage = fakeStorage();
		const drafts = writeDraft(storage, {}, "s1", "字".repeat(MAX_DRAFT_CHARS + 500));
		assert.equal(draftFor(drafts, "s1").length, MAX_DRAFT_CHARS);
	});

	it("存储不可用时也不炸(隐私模式)", () => {
		const hostile = {
			getItem: () => {
				throw new Error("blocked");
			},
		};
		assert.deepEqual(readDrafts(hostile), {});
		assert.doesNotThrow(() => writeDraft(undefined, {}, "s1", "草稿"));
	});
});

describe("发送状态", () => {
	const message = (at: number, text: string, extra: Record<string, unknown> = {}) => ({
		role: "user" as const,
		text,
		at,
		...extra,
	});

	it("成功之后不再是发送中", () => {
		const settled = settleSent([message(1, "你好", { pending: true })], 1, { pending: false });
		assert.equal(settled[0].pending, false);
		assert.equal(settled[0].failed, undefined);
	});

	it("失败之后标成失败,并且**文本还在**(用户打的字不能删)", () => {
		const settled = settleSent([message(1, "很长的一段话", { pending: true })], 1, { pending: false, failed: true });
		assert.equal(settled[0].failed, true);
		assert.equal(settled[0].text, "很长的一段话");
	});

	it("只动那一条:别的消息(包括已经发好的)不受影响", () => {
		const settled = settleSent(
			[message(1, "旧消息"), message(2, "刚发的", { pending: true })],
			2,
			{ pending: false },
		);
		assert.equal(settled[0].pending, undefined);
		assert.equal(settled[1].pending, false);
	});
});
