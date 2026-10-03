import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRelayMailbox } from "../src/main/remote/relay-mailbox.ts";

/**
 * 中继信箱的 HTTP 层。
 *
 * 这一层的价值全在**失败时说了什么**:之前地址写错只报一句 `fetch failed`,用户既不知道是哪个地址,
 * 也不知道该去查地址还是查进程。所以这里钉住的正是"错误信息里有没有地址"。
 */

const envelope = { v: 1 as const, nonce: "a".repeat(32), ciphertext: "b".repeat(40) };

describe("写入邀请", () => {
	it("成功时不抛错,并且把令牌与信封一起发出去", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const mailbox = createRelayMailbox({
			fetchImpl: (async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return new Response(null, { status: 201 });
			}) as unknown as typeof fetch,
		});
		await mailbox.publish("http://127.0.0.1:8787/v2/invite/BOX", "token", envelope);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].init.method, "PUT");
		assert.deepEqual((calls[0].init.headers as Record<string, string>)["x-wordless-invite-token"], "token");
	});

	it("连通失败时把**地址**与原因一起说出来", async () => {
		const mailbox = createRelayMailbox({
			fetchImpl: (async () => {
				throw new TypeError("fetch failed");
			}) as unknown as typeof fetch,
		});
		await assert.rejects(
			() => mailbox.publish("http://192.168.x.x:8787/v2/invite/BOX", "token", envelope),
			(error: Error) => {
				// 地址要在里面:否则用户根本不知道该去检查哪个地址。
				assert.match(error.message, /http:\/\/192\.168\.x\.x:8787\/v2\/invite\/BOX/);
				assert.match(error.message, /fetch failed/);
				assert.match(error.message, /中继进程是否在运行/);
				return true;
			},
		);
	});

	it("中继返回非 2xx 时也说清是哪个地址", async () => {
		const mailbox = createRelayMailbox({
			fetchImpl: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
		});
		await assert.rejects(
			() => mailbox.publish("http://relay.example/v2/invite/BOX", "token", envelope),
			/中继拒绝了这次写入\(404\).*http:\/\/relay\.example\/v2\/invite\/BOX/,
		);
	});
});

describe("撤回邀请", () => {
	it("撤回失败不打断用户(邀请本来就会自己过期)", async () => {
		const mailbox = createRelayMailbox({
			fetchImpl: (async () => {
				throw new TypeError("fetch failed");
			}) as unknown as typeof fetch,
		});
		await mailbox.withdraw("http://relay.example/v2/invite/BOX", "token");
	});
});
