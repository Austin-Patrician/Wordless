import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocketTransport, nodeWebSocketFactory } from "../src/websocket-transport.ts";
import type { WebSocketLike } from "../src/websocket-transport.ts";

/**
 * WebSocket 工厂的形状兼容。
 *
 * 这一层存在的唯一理由是一个真实故障:在 Electron 主进程的 CJS 打包里,`import { WebSocket } from "ws"`
 * 变成了 undefined,报错是 `WebSocketImpl is not a constructor` —— 看不出根因。所以三种形状都要认,
 * 而且认不出时要说清楚。
 */

class FakeSocket {
	readonly readyState = 1;
	readonly url: string;
	readonly protocols: readonly string[];
	constructor(url: string, protocols: string[]) {
		this.url = url;
		this.protocols = protocols;
	}
	send(): void {}
	close(): void {}
}

describe("WebSocket 工厂", () => {
	it("类本身(默认导出)能用", () => {
		const factory = nodeWebSocketFactory(FakeSocket);
		const socket = factory.open("ws://relay.example/x", ["a"]) as unknown as FakeSocket;
		assert.equal(socket.url, "ws://relay.example/x");
		assert.deepEqual(socket.protocols, ["a"]);
	});

	it("命名导出对象能用", () => {
		const factory = nodeWebSocketFactory({ WebSocket: FakeSocket });
		assert.ok(factory.open("ws://relay.example/x", []));
	});

	it("模块命名空间(default 挂在上面)能用", () => {
		const factory = nodeWebSocketFactory({ default: FakeSocket, WebSocket: undefined });
		assert.ok(factory.open("ws://relay.example/x", []));
	});

	it("拿到 undefined 或对象时说清楚需要什么,而不是抛一句看不懂的错", () => {
		assert.throws(() => nodeWebSocketFactory(undefined), /WebSocket 实现.*undefined/);
		assert.throws(() => nodeWebSocketFactory({}), /WebSocket 实现.*object/);
	});
});

/** 一个能手动触发事件的假 socket:用来复现"升级被拒"这类只发生在 open 之前的情况。 */
class ScriptedSocket implements WebSocketLike {
	readonly readyState = 0;
	readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>();
	send(): void {}
	close(): void {}
	on(type: string, listener: (...args: unknown[]) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}
	fire(type: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(type) ?? []) listener(...args);
	}
}

const transportFor = (socket: ScriptedSocket) =>
	new WebSocketTransport({
		url: "ws://relay.example/x",
		protocols: ["wordless.remote.v2"],
		factory: { open: () => socket },
		openTimeoutMs: 5_000,
	});

describe("建链阶段的失败要立刻收尾", () => {
	it("socket 报错时立刻拒绝,而不是干等到超时", async () => {
		const socket = new ScriptedSocket();
		const started = Date.now();
		// 注意顺序:先发起建链(它同步注册好监听),再触发事件 —— 否则事件打在空处。
		const connect = transportFor(socket).connect({ onFrame: () => undefined, onClose: () => undefined });
		socket.fire("error", new Error("ECONNREFUSED"));
		await assert.rejects(() => connect, /无法连接到中继:ECONNREFUSED/);
		// 关键:不是等 5 秒超时。留一点余量给慢机器。
		assert.ok(Date.now() - started < 1_000, `应当立刻失败,实际等了 ${Date.now() - started}ms`);
	});

	it("open 之前就被关掉时报出中继拒绝,而不是超时", async () => {
		const socket = new ScriptedSocket();
		const connect = transportFor(socket).connect({ onFrame: () => undefined, onClose: () => undefined });
		socket.fire("close", 4003, "Unauthorized");
		await assert.rejects(() => connect, /中继拒绝了这条连接\(Unauthorized\)/);
	});

	it("open 之后再关掉就交给 onClose,而不是拒绝建链", async () => {
		const socket = new ScriptedSocket();
		const closes: string[] = [];
		const connect = transportFor(socket).connect({
			onFrame: () => undefined,
			onClose: (reason) => closes.push(reason ?? ""),
		});
		socket.fire("open");
		await connect;
		socket.fire("close", 1006, "gone");
		assert.deepEqual(closes, ["gone"]);
	});
});
