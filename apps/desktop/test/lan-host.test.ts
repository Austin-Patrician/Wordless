import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LanHost, listLanAddresses } from "../src/main/remote/lan-host.ts";

/**
 * 局域网模式:起得来、指得对、端口被占用时**自己换一个**。
 *
 * 这里起的是**真的中继**(不是假实现):"一键"的价值就在于这一条链路真的通,
 * 而端口占用、webRoot 缺文件这些失败恰恰只在真起服务时才出现。
 */

const withWebRoot = async (): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "wordless-lan-"));
	await writeFile(join(root, "index.html"), "<!doctype html><title>wordless</title>ok");
	return root;
};

/**
 * 取一个 URL 的正文。
 *
 * 刻意**不用 `fetch`**:它默认留一条 keep-alive 连接,于是 `node --test` 的进程退不掉
 * (表现是"测试全过了但一直不结束")。`agent: false` 每次新开一条并立刻关掉。
 */
const httpGet = async (url: string): Promise<{ status: number; body: string }> =>
	new Promise((resolve, reject) => {
		const request = get(url, { agent: false }, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => (body += chunk));
			response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
		});
		request.on("error", reject);
		request.setTimeout(5_000, () => request.destroy(new Error("超时")));
	});

/** 占住一个端口(模拟"端口被别的程序用了")。 */
const occupy = async (port = 0): Promise<{ port: number; close: () => Promise<void> }> => {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "0.0.0.0", () => resolve());
	});
	const address = server.address();
	return {
		port: typeof address === "object" && address !== null ? address.port : 0,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
};

describe("局域网模式", () => {
	it("起得来:健康检查通,而且**把网页客户端托管出去**了", async () => {
		const webRoot = await withWebRoot();
		const host = new LanHost({ resolveWebRoot: () => webRoot, port: 0 });
		const status = await host.start();
		try {
			assert.equal(status.running, true);
			assert.equal(status.webClientReady, true);
			assert.ok(status.port && status.port > 0, "要有端口");
			const health = await httpGet(`http://127.0.0.1:${status.port}/health`);
			assert.equal(health.status, 200);
			const page = await httpGet(`http://127.0.0.1:${status.port}/`);
			assert.equal(page.status, 200);
			// 托管的是构建产物本身,而不是一个占位页。
			assert.match(page.body, /wordless/);
		} finally {
			await host.stop();
		}
		assert.equal(host.getStatus().running, false);
	});

	it("没有网页客户端就**不起服务**,并说清原因", async () => {
		// 起了也只会让手机看到一个说明页 —— 宁可不给。
		const host = new LanHost({ resolveWebRoot: () => undefined });
		const status = await host.start();
		assert.equal(status.running, false);
		assert.match(status.error ?? "", /还没有网页客户端/);
	});

	it("目录在但缺 index.html:也算没就绪", async () => {
		const root = await mkdtemp(join(tmpdir(), "wordless-lan-empty-"));
		const host = new LanHost({ resolveWebRoot: () => root });
		const status = await host.start();
		assert.equal(status.running, false);
		assert.match(status.error ?? "", /index\.html/);
	});

	it("端口被占用时**自己换一个**,而不是报 EADDRINUSE", async () => {
		const webRoot = await withWebRoot();
		const blocker = await occupy();
		const host = new LanHost({ resolveWebRoot: () => webRoot, port: blocker.port });
		try {
			const status = await host.start();
			assert.equal(status.running, true);
			assert.notEqual(status.port, blocker.port, "不能用被占用的那个端口");
			// 换过就要说:用户可能在路由器上做过端口转发、或照着文档记着 8787。
			assert.equal(status.portChanged, true, "换过端口要能被界面说出来");
		} finally {
			await host.stop();
			await blocker.close();
		}
	});

	it("地址列表只给非环回的 IPv4,而且**不替用户挑**", () => {
		const addresses = listLanAddresses({
			en0: [
				{ address: "192.168.1.9", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "", cidr: null },
				{ address: "127.0.0.1", family: "IPv4", internal: true, netmask: "", mac: "", cidr: null },
			],
			en1: [
				{ address: "fe80::1", family: "IPv6", internal: false, netmask: "", mac: "", cidr: null, scopeid: 0 },
			],
			utun3: [
				{ address: "10.8.0.2", family: "IPv4", internal: false, netmask: "", mac: "", cidr: null },
			],
		} as never);
		assert.deepEqual(
			addresses.map((entry) => entry.address),
			["192.168.1.9", "10.8.0.2"],
		);
		assert.deepEqual(
			addresses.map((entry) => entry.name),
			["en0", "utun3"],
			"网卡名要带上:多网卡时用户得认出哪一个",
		);
	});
});
