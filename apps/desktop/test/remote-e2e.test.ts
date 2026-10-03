import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import {
	RemoteConnection,
	WebSocketTransport,
	buildPairingProtocols,
	fromBase64Url,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	inviteBoxId,
	inviteBoxUrl,
	nodeWebSocketFactory,
	openInvite,
	randomToken,
	readInviteEnvelope,
	sha256Hex,
	type RemoteConnectionEvent,
} from "@wordless/remote-control";
import { startRelayServer } from "@wordless/relay/server";
import { RemoteHostService, type RemoteSessionSurface, type RemoteSurfaceEvent } from "../src/main/remote/host-service.ts";

/**
 * 整条链路:真中继(真 socket、真 HTTP)+ 本机服务 + 手机。
 *
 * 这是 P0-b 的验收:**不经过 Electron、不经过任何云账号**,把"手机上配对 → 列会话 → 发消息 →
 * 看到本机执行 → 中断"整条走一遍。缺的只有浏览器界面与隧道(那两步在 P1)。
 */

const CAPABILITIES = { chat: true, sessionRead: true } as const;
// 中继凭据是不透明字符串;而**手机密钥同时是手机的身份密钥**,所以必须是 32 字节的 base64url。
const RELAY_SECRET = "desktop-secret-0123456789abcdefghijklmnop";
const MOBILE_SECRET = randomToken(32);
const PAIRING_ID = "pairing-abcdefghijklmnop";
const factory = nodeWebSocketFactory(WebSocket as never);

const createSurface = () => {
	const listeners = new Set<(event: RemoteSurfaceEvent) => void>();
	const prompts: string[] = [];
	const aborts: string[] = [];
	let running = false;
	const surface: RemoteSessionSurface = {
		listSessions: async () => [{ id: "s1", title: "修一下登录页", updatedAt: 1_700_000_000_000, running }],
		openSession: async (sessionId) =>
			sessionId === "s1"
				? {
						summary: { id: "s1", title: "修一下登录页", updatedAt: 1_700_000_000_000, running },
						messages: [{ role: "user" as const, text: "登录页报错了", at: 1 }],
					}
				: undefined,
		historyPage: async () => ({ messages: [] }),
		prompt: async (_sessionId, text) => {
			prompts.push(text);
			running = true;
			// 本机开始干活:先报状态,再报一次工具执行 —— 就像真实运行时那样。
			for (const listener of listeners) listener({ type: "state", sessionId: "s1", running: true });
			for (const listener of listeners) listener({ type: "tool", sessionId: "s1", name: "bash", detail: "npm test" });
			for (const listener of listeners)
				listener({ type: "message", sessionId: "s1", message: { role: "assistant", text: "跑完了,测试通过。", at: 2 } });
		},
		abort: async () => {
			aborts.push("s1");
			running = false;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return { surface, prompts, aborts };
};

describe("整条链路(真中继 + 本机服务 + 手机)", () => {
	it("配对 → 列会话 → 发消息 → 看到执行 → 中断", async () => {
		const relay = await startRelayServer({ port: 0 });
		const { surface, prompts, aborts } = createSurface();
		// 信箱走**中继的 HTTP 端点**:真实桌面端就是这么做的,所以这里也照做,把令牌与过期都测进去。
		const mailbox = {
			publish: async (boxUrl: string, token: string, envelope: unknown): Promise<void> => {
				const response = await fetch(boxUrl, {
					method: "PUT",
					headers: { "x-wordless-invite-token": token },
					body: JSON.stringify(envelope),
				});
				assert.equal(response.status, 201, `信箱写入失败:${response.status}`);
			},
			withdraw: async (boxUrl: string, token: string): Promise<void> => {
				await fetch(boxUrl, { method: "DELETE", headers: { "x-wordless-invite-token": token } });
			},
		};

		const host = new RemoteHostService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			identity: generateIdentityKeyPair(),
			pairingId: PAIRING_ID,
			relaySecret: RELAY_SECRET,
			mobileSecretHash: sha256Hex(MOBILE_SECRET),
			mobileSecret: MOBILE_SECRET,
			relayBaseUrl: relay.url,
			createTransport: (url, protocols) =>
				new WebSocketTransport({ url, protocols: [...protocols], factory }),
			mailbox,
		});

		// 本机先连上中继(它连上就是注册房间),然后停在那儿等手机。
		const hostReady = host.start();
		const invite = await host.createInvite();
		assert.match(invite.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);

		// 手机这一侧完全按"用户看到的东西"来:只有连接码与密码,以及页面所在的中继。
		const response = await fetch(inviteBoxUrl(relay.url, inviteBoxId(invite.code)));
		assert.equal(response.status, 200);
		const envelope = readInviteEnvelope(await response.json());
		assert.ok(envelope);
		const uri = await openInvite(envelope, invite.code, invite.password);
		const params = new URL(uri).searchParams;
		const pairingId = params.get("pairingId");
		const secret = params.get("secret");
		assert.equal(pairingId, PAIRING_ID);
		assert.equal(secret, MOBILE_SECRET);

		const phoneEvents: RemoteConnectionEvent[] = [];
		const phone = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			// 手机的身份密钥就是邀请里带的那把 —— 中继只认它的哈希。
			identity: identityKeyPairFromSecret(fromBase64Url(secret as string)),
			handshake: "initiate",
		});
		phone.onEvent((event) => phoneEvents.push(event));
		const phoneReady = phone.connect(
			new WebSocketTransport({
				url: `${relay.url}/v2/relay/${pairingId}/mobile`,
				protocols: buildPairingProtocols({ pairingSecret: secret as string }),
				factory,
			}),
		);
		await Promise.all([hostReady, phoneReady]);
		assert.equal(phone.state, "online");

		// 列会话
		const listed = await phone.sendRequest("session.list");
		assert.equal(listed.success, true);
		const sessions = (listed.payload as { sessions: Array<{ id: string; title: string }> }).sessions;
		assert.deepEqual(sessions.map((session) => session.title), ["修一下登录页"]);

		// 打开会话
		const opened = await phone.sendRequest("session.open", { sessionId: "s1" });
		assert.equal((opened.payload as { summary: { id: string } }).summary.id, "s1");

		// 发消息:本机真的收到,并且开始执行
		const prompted = await phone.sendRequest("session.prompt", { sessionId: "s1", payload: { text: "帮我看一下" } });
		assert.equal(prompted.success, true);
		assert.deepEqual(prompts, ["帮我看一下"]);

		// 执行过程经事件流回到手机
		await new Promise((resolve) => setTimeout(resolve, 120));
		const remoteEvents = phoneEvents.flatMap((event) => (event.type === "remote-event" ? [event.event] : []));
		const names = remoteEvents.map((event) => event.name);
		assert.ok(names.includes("session.state"), "应当收到运行状态");
		assert.ok(names.includes("session.tool"), "应当收到工具执行");
		assert.ok(names.includes("session.message"), "应当收到助手消息");
		assert.deepEqual(
			remoteEvents.map((event) => event.sequence),
			remoteEvents.map((_, index) => index + 1),
			"序号必须连续(断线后只补缺失尾部靠它)",
		);
		assert.equal(
			remoteEvents.find((event) => event.name === "session.message")?.payload &&
				(remoteEvents.find((event) => event.name === "session.message")?.payload as { text: string }).text,
			"跑完了,测试通过。",
		);

		// 中断
		const aborted = await phone.sendRequest("session.abort", { sessionId: "s1" });
		assert.equal(aborted.success, true);
		assert.deepEqual(aborts, ["s1"]);

		// 中继始终没有看到任何会话内容
		const relayLog = relay.core.events.join("\n");
		assert.equal(relayLog.includes("帮我看一下"), false);
		assert.equal(relayLog.includes("跑完了"), false);
		assert.equal(relayLog.includes(MOBILE_SECRET), false);
		assert.equal(relayLog.includes(RELAY_SECRET), false);

		await phone.close();
		await host.stop();
		await relay.close();
	});

	it("没有连接码的人进不来(中继只认那台手机的密钥哈希)", async () => {
		const relay = await startRelayServer({ port: 0 });
		const { surface } = createSurface();
		const host = new RemoteHostService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			identity: generateIdentityKeyPair(),
			pairingId: PAIRING_ID,
			relaySecret: RELAY_SECRET,
			mobileSecretHash: sha256Hex(MOBILE_SECRET),
			mobileSecret: MOBILE_SECRET,
			relayBaseUrl: relay.url,
			createTransport: (url, protocols) => new WebSocketTransport({ url, protocols: [...protocols], factory }),
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
		});
		const hostReady = host.start();
		await new Promise((resolve) => setTimeout(resolve, 80));

		// 陌生人拿一把自己的密钥来敲门。
		const stranger = new RemoteConnection({
			role: "mobile",
			deviceId: "attacker",
			deviceName: "陌生设备",
			capabilities: CAPABILITIES,
			identity: generateIdentityKeyPair(),
			handshake: "initiate",
			requestTimeoutMs: 800,
		});
		const socket = new WebSocket(
			`${relay.url}/v2/relay/${PAIRING_ID}/mobile`,
			buildPairingProtocols({ pairingSecret: randomToken(32) }),
		);
		const rejected = await new Promise<boolean>((resolve) => {
			socket.on("close", () => resolve(true));
			socket.on("error", () => resolve(true));
		});
		assert.equal(rejected, true);
		assert.notEqual(stranger.state, "online");

		await host.stop().catch(() => undefined);
		void hostReady.catch(() => undefined);
		await relay.close();
	});
});
