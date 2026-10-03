import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectionStatus } from "../src/connection-status.ts";
import type { RemoteClientState } from "../src/remote-client.ts";

/**
 * 顶部那行状态最容易**说假话**。
 *
 * 以前不管重连了几次都只说"正在重连",而当时根本没有重连动作 —— 用户在等一件不会发生的事。
 * 现在重连是真的,于是"试了几次"要说出来,试得多了还要告诉他去查什么。
 */

const state = (overrides: Partial<RemoteClientState> = {}): RemoteClientState =>
	({
		phase: "online",
		sessions: [],
		messages: [],
		tools: [],
		running: false,
		waitingForApproval: false,
		...overrides,
	}) as RemoteClientState;

describe("顶部状态", () => {
	it("刚断:说正在重连", () => {
		assert.equal(connectionStatus(state({ phase: "offline" })).text, "与电脑的连接中断,正在重连");
	});

	it("试过几次:把次数说出来(它在做事,不是卡住了)", () => {
		const status = connectionStatus(state({ phase: "offline", reconnectAttempts: 2 }));
		assert.match(status.text, /第 2 次/);
		assert.equal(status.tone, "working");
	});

	it("一直连不上:换口径,并告诉他去查什么", () => {
		const status = connectionStatus(state({ phase: "offline", reconnectAttempts: 3 }));
		assert.equal(status.tone, "attention");
		assert.match(status.text, /Wordless 与中继还在运行/);
	});

	it("电脑在跑的时候:顶部**不许说空闲**", () => {
		// 具体在做什么("正在执行命令")挂在消息底部;顶部只说"它在跑"。
		// 少了这一条,发完消息之后顶部会写着"空闲" —— 用户看到的是一句假话。
		assert.equal(connectionStatus(state({ running: true })).text, "电脑正在执行");
		assert.equal(connectionStatus(state({ running: true })).tone, "working");
		assert.equal(connectionStatus(state()).text, "空闲");
	});

	it("正在补消息时说出来(否则和空闲长得一模一样)", () => {
		const status = connectionStatus(state({ phase: "recovering", running: true }));
		assert.match(status.text, /正在补齐/);
		assert.equal(status.tone, "working");
	});

	it("出错时把原因带出来", () => {
		const status = connectionStatus(state({ phase: "error", error: "这台机器没有留下可用的邀请" }));
		assert.equal(status.tone, "attention");
		assert.equal(status.text, "这台机器没有留下可用的邀请");
	});
});
