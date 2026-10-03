import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RELAY_PORT, normalizeRelayAddress, probeRelay } from "../src/main/remote/relay-address.ts";

/**
 * 中继地址的规范化与探测。
 *
 * 这一层来自一个真实事故:用户填了 `ws://192.168.1.109`(少了端口),桌面端于是去连 80 端口,
 * 只报了一句 `fetch failed` —— 看不出根因。所以这里钉住两件事:**少写端口要自动补上**、
 * **失败信息里必须有地址**。
 */

describe("地址规范化", () => {
	it("少写端口时补上默认端口,并说明补过", () => {
		const address = normalizeRelayAddress("ws://192.168.1.109");
		assert.equal(address.webSocketUrl, `ws://192.168.1.109:${DEFAULT_RELAY_PORT}`);
		assert.equal(address.httpUrl, `http://192.168.1.109:${DEFAULT_RELAY_PORT}`);
		assert.equal(address.paddedPort, true);
	});

	it("`wss://` 不带端口时不补:按约定那指的是 443(前面通常有 TLS 反代)", () => {
		const address = normalizeRelayAddress("wss://relay.example");
		assert.equal(address.webSocketUrl, "wss://relay.example");
		assert.equal(address.httpUrl, "https://relay.example");
		assert.equal(address.paddedPort, false);
	});

	it("写了端口就原样保留", () => {
		const address = normalizeRelayAddress("wss://relay.example:9443");
		assert.equal(address.webSocketUrl, "wss://relay.example:9443");
		assert.equal(address.httpUrl, "https://relay.example:9443");
		assert.equal(address.paddedPort, false);
	});

	it("不带协议也认(用户很自然会只填地址)", () => {
		assert.equal(normalizeRelayAddress("192.168.1.109:8787").webSocketUrl, "ws://192.168.1.109:8787");
		assert.equal(normalizeRelayAddress("relay.example").webSocketUrl, `ws://relay.example:${DEFAULT_RELAY_PORT}`);
	});

	it("前后空格不算错", () => {
		assert.equal(normalizeRelayAddress("  ws://relay.example  ").webSocketUrl, `ws://relay.example:${DEFAULT_RELAY_PORT}`);
	});

	it("把网页地址当中继地址时,说的是真正的问题(协议不对)", () => {
		assert.throws(() => normalizeRelayAddress("http://192.168.1.109:8787"), /要用 ws:\/\/ 或 wss:\/\/ 开头/);
		assert.throws(() => normalizeRelayAddress("https://relay.example"), /https:\/\/ 是另一类地址/);
	});

	it("带路径这种写法直接说清楚该怎么写", () => {
		assert.throws(() => normalizeRelayAddress("ws://relay.example:8787/v2/relay"), /不要带路径/);
	});

	it("端口不合法时拒绝", () => {
		assert.throws(() => normalizeRelayAddress("ws://relay.example:0"), /端口不合法/);
		assert.throws(() => normalizeRelayAddress("ws://relay.example:99999"), /端口不合法/);
	});

	it("空地址拒绝", () => {
		assert.throws(() => normalizeRelayAddress("   "), /不能为空/);
	});
});

describe("探测", () => {
	const respond = (body: unknown, status = 200) =>
		(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

	it("通的时候说清地址与协议版本", async () => {
		const result = await probeRelay("ws://192.168.1.109", {
			fetchImpl: respond({ status: "ok", protocolVersion: 2 }),
		});
		assert.equal(result.ok, true);
		assert.match(result.detail, /http:\/\/192\.168\.1\.109:8787/);
		assert.match(result.detail, /协议 v2/);
	});

	it("连不上时**地址**与原因都要在(上次那句 fetch failed 的最大问题)", async () => {
		const result = await probeRelay("ws://192.168.1.109", {
			fetchImpl: (async () => {
				throw new TypeError("fetch failed");
			}) as unknown as typeof fetch,
		});
		assert.equal(result.ok, false);
		assert.match(result.detail, /http:\/\/192\.168\.1\.109:8787/);
		assert.match(result.detail, /fetch failed/);
		assert.match(result.detail, /端口是否写对/);
	});

	it("地址不合法时直接说地址的问题,不发请求", async () => {
		let called = false;
		const result = await probeRelay("ws://relay.example:8787/path", {
			fetchImpl: (async () => {
				called = true;
				return new Response(null, { status: 200 });
			}) as unknown as typeof fetch,
		});
		assert.equal(result.ok, false);
		assert.equal(called, false);
		assert.match(result.detail, /不要带路径/);
	});

	it("返回的不是中继(状态码/内容不对)也要说清", async () => {
		const badStatus = await probeRelay("ws://relay.example", { fetchImpl: respond({}, 502) });
		assert.equal(badStatus.ok, false);
		assert.match(badStatus.detail, /502/);
		const badBody = await probeRelay("ws://relay.example", { fetchImpl: respond({ hello: "world" }) });
		assert.equal(badBody.ok, false);
		assert.match(badBody.detail, /不像中继的健康检查/);
	});
});
