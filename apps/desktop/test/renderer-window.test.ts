import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	isRendererWindowAlive,
	sendToRendererWindow,
	type RendererWindowLike,
} from "../src/main/renderer-window.ts";

/**
 * 往渲染层发消息的**唯一那道判断**。
 *
 * 用户报过这个错:
 *
 *     Error sending from webFrameMain: Error: Render frame was disposed before
 *     WebFrameMain could be accessed
 *
 * 它不抛异常,只在主进程里打一行 —— 所以它不会让谁崩,但会一直在日志里出现,而且带一串
 * 看不懂的栈。根因是**有几处 `webContents.send` 没检查窗口还活着没有**,其中最常见的一种是
 * "窗口正在关":这时候 `isDestroyed()` 还是 false,但**渲染帧已经没了**。
 *
 * 所以这里钉住的不是"某个字段怎么读",而是**哪些状态算不能发**。
 */

const window = (state: {
	destroyed?: boolean;
	contentsDestroyed?: boolean;
	crashed?: boolean;
	loading?: boolean;
}): RendererWindowLike & { readonly sent: Array<{ channel: string; payload: unknown }> } => {
	const sent: Array<{ channel: string; payload: unknown }> = [];
	return {
		sent,
		isDestroyed: () => state.destroyed === true,
		webContents: {
			isDestroyed: () => state.contentsDestroyed === true,
			isCrashed: () => state.crashed === true,
			isLoadingMainFrame: () => state.loading === true,
			send: (channel, payload) => void sent.push({ channel, payload }),
		},
	};
};

describe("能不能发", () => {
	it("正常窗口:能发", () => {
		assert.equal(isRendererWindowAlive(window({})), true);
	});

	it("窗口已经没了:不发", () => {
		assert.equal(isRendererWindowAlive(window({ destroyed: true })), false);
	});

	it("WebContents 已经销毁:不发", () => {
		assert.equal(isRendererWindowAlive(window({ contentsDestroyed: true })), false);
	});

	it("渲染进程崩了(帧还在、没人接):不发", () => {
		assert.equal(isRendererWindowAlive(window({ crashed: true })), false);
	});

	it("**帧正在被换掉**(重载中):不发 —— 这一条正是那句报错的来源", () => {
		assert.equal(isRendererWindowAlive(window({ loading: true })), false);
	});

	it("窗口还没建出来(启动早期):不发,也不炸", () => {
		assert.equal(isRendererWindowAlive(undefined), false);
	});
});

describe("发一条", () => {
	it("活着就真的发出去,并如实说「发出去了」", () => {
		const target = window({});
		assert.equal(sendToRendererWindow(target, "wordless:event", { type: "state" }), true);
		assert.deepEqual(target.sent, [{ channel: "wordless:event", payload: { type: "state" } }]);
	});

	it("不能发时:**什么都不做**,返回 false(而不是抛异常)", () => {
		for (const state of [{ destroyed: true }, { contentsDestroyed: true }, { crashed: true }, { loading: true }]) {
			const target = window(state);
			assert.equal(sendToRendererWindow(target, "wordless:event", { type: "state" }), false);
			assert.deepEqual(target.sent, [], `${JSON.stringify(state)} 不该发出任何东西`);
		}
		assert.equal(sendToRendererWindow(undefined, "wordless:event", {}), false);
	});

	it("检查之后、send 之前帧被销毁:吞掉异常,别让它冒进运行时的事件流", () => {
		// 这是重载时序里真实存在的一瞬:判断那一刻还活着,`send` 那一刻已经不是了。
		const target: RendererWindowLike = {
			isDestroyed: () => false,
			webContents: {
				isDestroyed: () => false,
				isCrashed: () => false,
				isLoadingMainFrame: () => false,
				send: () => {
					throw new Error("Render frame was disposed before WebFrameMain could be accessed");
				},
			},
		};
		assert.equal(sendToRendererWindow(target, "wordless:event", {}), false);
	});
});
