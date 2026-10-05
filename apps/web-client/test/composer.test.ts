import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DRAFT_STORAGE_KEY,
	MAX_DRAFT_CHARS,
	draftFor,
	mentionQueryAt,
	readDrafts,
	settleSent,
	shortWorkspacePath,
	skillIconText,
	stripTrailingMention,
	writeDraft,
} from "../src/composer.ts";

/**
 * 输入区里**不依赖编辑器**的那几件事:**草稿不丢**、**`@` 认得准**、**发送状态不撒谎**。
 *
 * 输入框本身是一个编辑器(Lexical,见 `composer-editor.tsx`)—— 它那边的东西(节点、光标、
 * 插入 token)只能在真浏览器里验,所以那些用例在 `apps/desktop/test/remote-web-thread.browser.test.tsx`。
 * 这里钉的是纯文本判断:它们错了的表现是"打字打到一半弹出选择器"或者"草稿读不回来"。
 */

const fakeStorage = (initial: Record<string, string> = {}) => {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		map,
	};
};

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

	it("存的是**一串字符串**就照存不误(它可能是纯文本,也可能是序列化后的编辑器状态)", () => {
		// 存的是什么形状由写的一方决定(编辑器那边写序列化状态),读的这边只保证"字符串进、字符串出"。
		const storage = fakeStorage();
		const serialized = "wordless-composer-v1:{\"root\":{}}";
		writeDraft(storage, {}, "s1", serialized);
		assert.equal(draftFor(readDrafts(storage), "s1"), serialized);
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

describe("`@` / `$` 的识别(P28 / P30)", () => {
	it("光标前刚打出的 `@`:认得出查询串", () => {
		assert.equal(mentionQueryAt("看一下 @app", 8, "workspace"), "app");
	});

	it("刚敲下触发符(还没打字):查询串是空串,而不是没有", () => {
		// 空串与 undefined 是两件事:前者是"该弹选择器了",后者是"这里根本没有触发符"。
		assert.equal(mentionQueryAt("看一下 @", 5, "workspace"), "");
		assert.equal(mentionQueryAt("看一下 $", 5, "skill"), "");
	});

	it("`$` 找的是技能,`@` 找的是文件 —— 两种互不串味", () => {
		assert.equal(mentionQueryAt("$写周报", 4, "skill"), "写周报");
		assert.equal(mentionQueryAt("$写周报", 4, "workspace"), undefined);
		assert.equal(mentionQueryAt("@app.tsx", 8, "workspace"), "app.tsx");
		assert.equal(mentionQueryAt("@app.tsx", 8, "skill"), undefined);
	});

	it("行首的触发符也算(用户在开头就开始找东西)", () => {
		assert.equal(mentionQueryAt("@src", 4, "workspace"), "src");
		assert.equal(mentionQueryAt("$技能", 3, "skill"), "技能");
	});

	it("邮箱不会被当成引用(否则打字打到一半就弹出选择器)", () => {
		assert.equal(mentionQueryAt("foo@bar.com", 11, "workspace"), undefined);
		assert.equal(mentionQueryAt("发给 foo@bar", 9, "workspace"), undefined);
	});

	it("`$` 前面没有空白时不算(价格那种写法不该弹选择器)", () => {
		assert.equal(mentionQueryAt("花了$100", 6, "skill"), undefined);
	});

	it("查询串里有空白就不再是引用(说明用户已经在写别的东西了)", () => {
		assert.equal(mentionQueryAt("看一下 @app 然后", 12, "workspace"), undefined);
		assert.equal(mentionQueryAt("$写周报 然后", 9, "skill"), undefined);
	});

	it("光标之后的内容不算:光标在句子中间时不弹选择器", () => {
		assert.equal(mentionQueryAt("看一下 @app 然后", 3, "workspace"), undefined);
	});

	it("超长的查询串不当引用(那不是找东西,是误粘贴)", () => {
		assert.equal(mentionQueryAt(`@${"x".repeat(65)}`, 66, "workspace"), undefined);
	});

	it("光标位置越界时不抛异常(手机上的选区偶尔会给出奇怪的值)", () => {
		assert.equal(mentionQueryAt("@a", 99, "workspace"), "a");
		assert.equal(mentionQueryAt("@a", Number.NaN, "workspace"), undefined);
		assert.equal(mentionQueryAt("@a", -1, "workspace"), undefined);
	});

	it("选中之后要去掉的那一段:从触发符那个字开始(与认出来的规则**同源**)", () => {
		// 认出来用一条正则、去掉用另一条的话,迟早会出现"弹了选择器、选中之后却删错一段"。
		assert.equal(stripTrailingMention("看一下 @app", "workspace"), 4);
		assert.equal(stripTrailingMention("看一下 $写周报", "skill"), 4);
		assert.equal(stripTrailingMention("看一下 @", "workspace"), 4);
		assert.equal(stripTrailingMention("@app", "workspace"), 0);
		assert.equal(stripTrailingMention("看一下 @app 这个", "workspace"), null);
		assert.equal(stripTrailingMention("看一下 @app", "skill"), null);
	});

	it("技能图标上的那个字:中文取首字、英文取首字母(与桌面端一致)", () => {
		assert.equal(skillIconText("写周报"), "写");
		assert.equal(skillIconText("deep research"), "D");
		assert.equal(skillIconText("   "), "?");
	});

	it("长路径从**前面**截:文件名才是用户认得出文件的那一半", () => {
		assert.equal(shortWorkspacePath("src/app.tsx", 28), "src/app.tsx");
		const long = "src/renderer/features/thread/Composer.tsx";
		const short = shortWorkspacePath(long, 28);
		assert.equal(short.length, 28);
		assert.ok(short.startsWith("…"));
		assert.ok(short.endsWith("Composer.tsx"));
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
