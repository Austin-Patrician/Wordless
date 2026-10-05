import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import {
	REMOTE_PROTOCOL_VERSION,
	RELAY_CLOSE_INVALID_FRAME,
	RemoteConnection,
	buildPairingProtocols,
	generateIdentityKeyPair,
	inviteBoxId,
	nodeWebSocketFactory,
	sealInvite,
	sha256Hex,
	toBase64Url,
	verificationCode,
	WebSocketTransport,
	type RemoteConnectionEvent,
} from "@wordless/remote-control";
import { describeBindingRisk, startRelayServer } from "../src/server.ts";

/**
 * 真中继(真 WebSocket、真 HTTP)。
 *
 * 这是 P0-b 的关键一步:同一份 `RelayCore` 跑在真实 socket 上,
 * 两个端点经它握手、请求、收事件 —— 证明"测试里通过的规则"就是"线上跑的规则"。
 *
 * 这里还不需要任何云账号与域名:服务器起在本机随机端口上。
 */

const PAIRING_ID = "pairing-abcdefghijklmnop";
const DESKTOP_SECRET = "desktop-secret-0123456789abcdefghijklmnop";
const PHONE_SECRET = "phone-secret-0123456789abcdefghijklmnopqrst";
const CAPABILITIES = { chat: true, sessionRead: true } as const;
const factory = nodeWebSocketFactory(WebSocket as never);

const relayUrl = (server: { url: string }, role: "desktop" | "mobile"): string =>
	`${server.url}/v2/relay/${PAIRING_ID}/${role}`;

/** 先关两端的连接,再关中继 —— 否则客户端的 socket 会让测试进程一直不退出。 */
const teardown = async (
	server: Awaited<ReturnType<typeof startRelayServer>>,
	...connections: readonly { close(): Promise<void> }[]
): Promise<void> => {
	for (const connection of connections) await connection.close();
	await server.close();
};

const desktopProtocols = () =>
	buildPairingProtocols({ pairingSecret: DESKTOP_SECRET, peerCredentialHash: sha256Hex(PHONE_SECRET) });
const mobileProtocols = () => buildPairingProtocols({ pairingSecret: PHONE_SECRET });

describe("健康检查与信箱", () => {
	it("健康检查报告协议版本", async () => {
		const server = await startRelayServer({ port: 0 });
		const response = await fetch(`${server.httpUrl}/health`);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { status: "ok", protocolVersion: REMOTE_PROTOCOL_VERSION });
		await server.close();
	});

	it("信箱:写入要令牌,读回是同一份,撤回也要令牌", async () => {
		const server = await startRelayServer({ port: 0 });
		const code = "K7Q29MXD";
		const boxId = inviteBoxId(code);
		const envelope = await sealInvite("wordless://pair?v=2", code, "123456");
		const url = `${server.httpUrl}/v2/invite/${boxId}`;

		// 没有令牌写不进去。
		assert.equal((await fetch(url, { method: "PUT", body: JSON.stringify(envelope) })).status, 401);
		// 有令牌就能写。
		const put = await fetch(url, {
			method: "PUT",
			headers: { "x-wordless-invite-token": "writer-token-0123456789abcdefghijklmn" },
			body: JSON.stringify(envelope),
		});
		assert.equal(put.status, 201);
		// 手机端不需要令牌就能读(它只有连接码,而信箱名就是连接码的哈希)。
		const got = await fetch(url);
		assert.equal(got.status, 200);
		assert.deepEqual(await got.json(), envelope);
		// 撤回:令牌格式合法但不是那把(真实场景:别人猜的),撤不掉。
		const wrongToken = "wrong-token-0123456789abcdefghijklmnopq";
		assert.equal((await fetch(url, { method: "DELETE", headers: { "x-wordless-invite-token": wrongToken } })).status, 404);
		// 令牌畸形则直接 401(连"猜对没有"都不告诉对方)。
		assert.equal((await fetch(url, { method: "DELETE", headers: { "x-wordless-invite-token": "short" } })).status, 401);
		assert.equal(
			(await fetch(url, { method: "DELETE", headers: { "x-wordless-invite-token": "writer-token-0123456789abcdefghijklmn" } })).status,
			204,
		);
		assert.equal((await fetch(url)).status, 404);
		await server.close();
	});

	it("不合规的信封写不进去", async () => {
		const server = await startRelayServer({ port: 0 });
		const boxId = inviteBoxId("K7Q29MXD");
		const response = await fetch(`${server.httpUrl}/v2/invite/${boxId}`, {
			method: "PUT",
			headers: { "x-wordless-invite-token": "writer-token-0123456789abcdefghijklmn" },
			body: JSON.stringify({ v: 1, nonce: "short", ciphertext: "x" }),
		});
		assert.equal(response.status, 400);
		await server.close();
	});
});

describe("绑定风险提示", () => {
	it("只绑环回时没有提示(默认配置不该吓人)", () => {
		assert.equal(describeBindingRisk("127.0.0.1"), undefined);
		assert.equal(describeBindingRisk("::1"), undefined);
		assert.equal(describeBindingRisk("localhost"), undefined);
	});

	it("绑非环回时把代价说清楚(明文的是连接码、密码与手机凭据)", () => {
		const risk = describeBindingRisk("0.0.0.0");
		assert.ok(risk);
		assert.match(risk, /没有 TLS/);
		assert.match(risk, /连接码、密码与手机凭据/);
		// 要说清"怎么办",而不是只报个警。
		assert.match(risk, /隧道|反向代理/);
		assert.ok(describeBindingRisk("192.168.1.10"));
	});
});

describe("托管网页客户端", () => {
	const withWebRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
		const root = await mkdtemp(join(tmpdir(), "wordless-web-"));
		await writeFile(join(root, "index.html"), "<!doctype html><title>Wordless 远程</title>", "utf8");
		await mkdir(join(root, "assets"), { recursive: true });
		await writeFile(join(root, "assets", "index-abc123.js"), "console.log('hi')", "utf8");
		try {
			await run(root);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	};

	it("根路径给出网页,带哈希的资源可以长缓存", async () => {
		await withWebRoot(async (root) => {
			const server = await startRelayServer({ port: 0, webRoot: root });
			const page = await fetch(`${server.httpUrl}/`);
			assert.equal(page.status, 200);
			assert.match(page.headers.get("content-type") ?? "", /text\/html/);
			// index.html 不能缓存,否则用户会一直拿到旧页面。
			assert.equal(page.headers.get("cache-control"), "no-store");
			assert.match(await page.text(), /Wordless 远程/);

			const asset = await fetch(`${server.httpUrl}/assets/index-abc123.js`);
			assert.equal(asset.status, 200);
			assert.match(asset.headers.get("content-type") ?? "", /javascript/);
			assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
			await server.close();
		});
	});

	it("不让走出托管目录(路径穿越)", async () => {
		await withWebRoot(async (root) => {
			const server = await startRelayServer({ port: 0, webRoot: root });
			for (const attempt of ["/../package.json", "/assets/../../package.json", "/%2e%2e/package.json"]) {
				const response = await fetch(`${server.httpUrl}${attempt}`);
				assert.ok(response.status === 404 || response.status === 400, `${attempt} 应当被挡住,得到 ${response.status}`);
			}
			await server.close();
		});
	});

	it("没配置托管目录时说明情况,而不是给个 404", async () => {
		const server = await startRelayServer({ port: 0 });
		const page = await fetch(`${server.httpUrl}/`);
		assert.equal(page.status, 200);
		assert.match(await page.text(), /还没有部署网页客户端/);
		// 中继本身仍然正常。
		assert.equal((await fetch(`${server.httpUrl}/health`)).status, 200);
		await server.close();
	});

	it("API 路径不受静态托管影响", async () => {
		await withWebRoot(async (root) => {
			const server = await startRelayServer({ port: 0, webRoot: root });
			assert.equal((await fetch(`${server.httpUrl}/health`)).status, 200);
			// 信箱路由仍然按自己的规则回 404(没有那份信封)。
			assert.equal((await fetch(`${server.httpUrl}/v2/invite/${inviteBoxId("K7Q29MXD")}`)).status, 404);
			await server.close();
		});
	});
});

describe("真实 socket 上的拒绝", () => {
	it("桌面端没声明手机密钥哈希就进不去", async () => {
		const server = await startRelayServer({ port: 0 });
		const socket = new WebSocket(relayUrl(server, "desktop"), buildPairingProtocols({ pairingSecret: DESKTOP_SECRET }));
		// 拒绝有两种表现:HTTP 层直接 401(客户端连不上)或升级后被关掉。两种都算"进不去"。
		const outcome = await new Promise<string>((resolve) => {
			socket.on("close", (code) => resolve(`close:${code}`));
			socket.on("error", (error) => resolve(`error:${error.message}`));
		});
		assert.match(outcome, /error:Unexpected server response: 401|close:100[0-9]/);
		assert.doesNotMatch(outcome, /close:1000$/);
		await server.close();
	});

	it("桌面端没注册房间时手机进不去", async () => {
		const server = await startRelayServer({ port: 0 });
		const socket = new WebSocket(relayUrl(server, "mobile"), mobileProtocols());
		const closed = await new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
		assert.notEqual(closed, 1000);
		await server.close();
	});

	it("握手之后发明文会话帧会被断开(4002)", async () => {
		const server = await startRelayServer({ port: 0 });
		// 桌面端先注册房间。
		const desktopSocket = new WebSocket(relayUrl(server, "desktop"), desktopProtocols());
		await new Promise((resolve) => desktopSocket.on("open", resolve));
		const key = toBase64Url(new Uint8Array(32).fill(3));
		desktopSocket.send(
			JSON.stringify({
				type: "hello",
				protocolVersion: REMOTE_PROTOCOL_VERSION,
				role: "desktop",
				deviceId: "desk-1",
				deviceName: "我的电脑",
				capabilities: CAPABILITIES,
				connectionId: "c1",
				identityKey: key,
				ephemeralKey: key,
			}),
		);
		// 明文请求:必须被拒。
		desktopSocket.send(JSON.stringify({ type: "request", requestId: "r1", method: "session.list" }));
		const closed = await new Promise<number>((resolve) => desktopSocket.on("close", (code) => resolve(code)));
		assert.equal(closed, RELAY_CLOSE_INVALID_FRAME);
		await server.close();
	});
});

describe("两个端点经真中继说话", () => {
	const connect = async () => {
		const server = await startRelayServer({ port: 0 });
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktopEvents: RemoteConnectionEvent[] = [];
		const mobileEvents: RemoteConnectionEvent[] = [];
		const desktop = new RemoteConnection({
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			identity: desktopIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: mobileIdentity.publicKey,
		});
		const mobile = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			identity: mobileIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		});
		desktop.onEvent((event) => desktopEvents.push(event));
		mobile.onEvent((event) => mobileEvents.push(event));

		// 两端**并发**连接:桌面端会一直停在那儿等手机出现,它的握手要等手机上线才完成。
		// 所以这里不能先 await 桌面端 —— 那会一直等到超时(这正是它的正常行为,不是故障)。
		const desktopReady = desktop.connect(
			new WebSocketTransport({ url: relayUrl(server, "desktop"), protocols: desktopProtocols(), factory }),
		);
		const mobileReady = mobile.connect(
			new WebSocketTransport({ url: relayUrl(server, "mobile"), protocols: mobileProtocols(), factory }),
		);
		await Promise.all([desktopReady, mobileReady]);
		return { server, desktop, mobile, desktopEvents, mobileEvents };
	};

	it("握手经真 socket 完成,两端互相可见,验证码一致", async () => {
		const { server, desktop, mobile } = await connect();
		assert.equal(desktop.state, "online");
		assert.equal(mobile.state, "online");
		assert.equal(desktop.peerDeviceId, "phone-1");
		assert.equal(mobile.peerDeviceId, "desk-1");
		assert.equal(desktop.getSnapshot().verificationCode, mobile.getSnapshot().verificationCode);
		await teardown(server, desktop, mobile);
	});

	it("请求与响应穿过真中继", async () => {
		const { server, desktop, mobile, desktopEvents } = await connect();
		const answer = mobile.sendRequest("session.list");
		await new Promise((resolve) => setTimeout(resolve, 60));
		const request = desktopEvents.find((event) => event.type === "remote-request");
		const requestId = request?.type === "remote-request" ? request.request.requestId : "";
		await desktop.respondToRequest(requestId, { success: true, payload: { sessions: ["一"] } });
		assert.deepEqual(await answer, { success: true, payload: { sessions: ["一"] } });
		await teardown(server, desktop, mobile);
	});

	it("事件穿过真中继后序号连续,且中继日志里没有会话内容", async () => {
		const lines: string[] = [];
		const server = await startRelayServer({ port: 0, logger: (line) => lines.push(line) });
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktop = new RemoteConnection({
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			identity: desktopIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: mobileIdentity.publicKey,
		});
		const mobile = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			identity: mobileIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		});
		await Promise.all([
			desktop.connect(
				new WebSocketTransport({ url: relayUrl(server, "desktop"), protocols: desktopProtocols(), factory }),
			),
			mobile.connect(
				new WebSocketTransport({ url: relayUrl(server, "mobile"), protocols: mobileProtocols(), factory }),
			),
		]);
		desktop.publishEvent("session.message", { payload: { text: "机密内容" } });
		desktop.publishEvent("session.tool", { payload: { name: "bash" } });
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.equal(mobile.lastEventSequence, 2);
		assert.equal(lines.join("\n").includes("机密内容"), false);
		assert.equal(lines.join("\n").includes(DESKTOP_SECRET), false);
		assert.equal(lines.join("\n").includes(PHONE_SECRET), false);
		await teardown(server, desktop, mobile);
	});

	it("桌面端可以先停在中继上等手机出现,而不会失败", async () => {
		const server = await startRelayServer({ port: 0 });
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktop = new RemoteConnection({
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			identity: desktopIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: mobileIdentity.publicKey,
			requestTimeoutMs: 2_000,
		});
		const desktopReady = desktop.connect(
			new WebSocketTransport({ url: relayUrl(server, "desktop"), protocols: desktopProtocols(), factory }),
		);
		// 手机还没来:桌面端应当仍是"连接中",而不是报错或断开。
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.equal(desktop.state, "connecting");
		const mobile = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			identity: mobileIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		});
		const mobileReady = mobile.connect(
			new WebSocketTransport({ url: relayUrl(server, "mobile"), protocols: mobileProtocols(), factory }),
		);
		await Promise.all([desktopReady, mobileReady]);
		assert.equal(desktop.state, "online");
		assert.equal(mobile.state, "online");
		await teardown(server, desktop, mobile);
	});

	it("中继不认识会话内容:它只转发 sealed", async () => {
		const { server, desktop, mobile } = await connect();
		desktop.publishEvent("session.message", { payload: { text: "机密内容" } });
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.equal(
			server.core.events.some((entry) => entry === "frame_forwarded sealed"),
			true,
		);
		assert.equal(server.core.events.join("\n").includes("机密内容"), false);
		// 连接码与密钥都不在中继的日志里。
		assert.equal(server.core.events.join("\n").includes(PHONE_SECRET), false);
		assert.equal(verificationCode(generateIdentityKeyPair().publicKey, generateIdentityKeyPair().publicKey).length, 6);
		assert.equal(mobile.state, "online");
		await teardown(server, desktop, mobile);
	});

	it("端口被占用时**拒绝**,而不是一直挂着", async () => {
		// 真实踩到过:listen 的 error 事件没人接 → promise 永不 settle + 未处理事件掀掉进程。
		// 桌面端的"端口被占用就换一个"就建立在这条之上。
		const blocker = createServer();
		const busy = await new Promise<number>((resolve) => {
			blocker.listen(0, "127.0.0.1", () => {
				const address = blocker.address();
				resolve(typeof address === "object" && address !== null ? address.port : 0);
			});
		});
		try {
			await assert.rejects(() => startRelayServer({ port: busy, host: "127.0.0.1" }));
		} finally {
			await new Promise<void>((resolve) => blocker.close(() => resolve()));
		}
	});
});
