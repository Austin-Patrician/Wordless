import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isNearBottom, jumpButtonView, nextUnseenCount } from "../src/scroll-model.ts";

/**
 * 滚动行为的三条规则。
 *
 * 它们对应一个真实缺陷:之前无条件滚到底,用户往上翻历史时会被不断拽回底部。
 * 这里钉住的是"什么时候跟随、什么时候计数、什么时候不该动"。
 */

const metrics = (scrollTop: number, scrollHeight = 2_000, clientHeight = 800) => ({ scrollTop, scrollHeight, clientHeight });

describe("贴着底部", () => {
	it("正好在底部算贴底", () => {
		assert.equal(isNearBottom(metrics(1_200)), true);
	});

	it("差几像素也算贴底(移动端会抖,严格相等会导致该跟随时不跟随)", () => {
		assert.equal(isNearBottom(metrics(1_180)), true);
	});

	it("往上翻就不算贴底", () => {
		assert.equal(isNearBottom(metrics(600)), false);
	});
});

describe("未读计数", () => {
	it("贴底时新内容不计数", () => {
		assert.equal(nextUnseenCount(3, { appended: 2, nearBottom: true }), 0);
	});

	it("离开底部时新内容累加", () => {
		assert.equal(nextUnseenCount(1, { appended: 2, nearBottom: false }), 3);
	});

	it("没有新内容时不动(避免把刚清掉的数字又加回来)", () => {
		assert.equal(nextUnseenCount(3, { appended: 0, nearBottom: false }), 3);
	});
});

describe("跳转按钮", () => {
	it("贴底时不出现", () => {
		assert.equal(jumpButtonView({ nearBottom: true, running: false, unseen: 0 }).visible, false);
	});

	it("离开底部时出现,并带上未读数", () => {
		const view = jumpButtonView({ nearBottom: false, running: false, unseen: 4 });
		assert.equal(view.visible, true);
		assert.equal(view.unseen, 4);
		assert.equal(view.showProgress, false);
	});

	it("电脑还在执行时用三点动画(它在说:还在往下长)", () => {
		assert.equal(jumpButtonView({ nearBottom: false, running: true, unseen: 0 }).showProgress, true);
	});
});
