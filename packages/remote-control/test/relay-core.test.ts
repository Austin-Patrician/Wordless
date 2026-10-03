import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RemoteConnection } from "../src/connection.ts";
import { generateIdentityKeyPair, sha256Hex } from "../src/crypto.ts";
import {
	RELAY_CLOSE_INVALID_FRAME,
	RELAY_CLOSE_SUPERSEDED,
	RelayCore,
	type RelayCredentials,
} from "../src/relay-core.ts";
import { sealInvite } from "../src/invite-code.ts";
import { KEEPALIVE_PING, KEEPALIVE_PONG, type RemoteConnectionEvent } from "../src/types.ts";

/**
 * 中继的规则。
 *
 * 中继是**唯一需要我们运维**的东西,而它的规则全是安全边界:谁能进房间、什么帧能转发、
 * 什么时候必须断开、信箱怎么过期。所以这一层测得最细 —— 真中继必须表现一致。
 */

const PAIRING_ID = "pairing-abcdefghijklmnop";
const DESKTOP_SECRET = "desktop-secret-0123456789abcdefghijklmnop";
const PHONE_SECRET = "phone-secret-0123456789abcdefghijklmnopqrst";

const credentials = (role: "desktop" | "mobile"): RelayCredentials => ({
	pairingId: PAIRING_ID,
	role,
	pairingSecret: role === "desktop" ? DESKTOP_SECRET : PHONE_SECRET,
	...(role === "desktop" ? { peerCredentialHash: sha256Hex(PHONE_SECRET) } : {}),
});

const registeredRelay = (): RelayCore => {
	const relay = new RelayCore();
	relay.registerRoom(PAIRING_ID, DESKTOP_SECRET, sha256Hex(PHONE_SECRET));
	return relay;
};

/** 中继是即时投递的,所以这里只是"让异步处理器跑完"。 */
const settle = async (_relay: RelayCore, rounds = 8): Promise<void> => {
	for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

const CAPABILITIES = { chat: true, sessionRead: true } as const;

const events = (list: RemoteConnectionEvent[]) => list;

describe("谁能进房间", () => {
	it("没注册过的房间进不去", () => {
		const relay = new RelayCore();
		assert.throws(() => relay.connect(credentials("mobile")), /unauthorized/);
	});

	it("手机密钥不对进不去", () => {
		const relay = registeredRelay();
		assert.throws(() => relay.connect({ ...credentials("mobile"), pairingSecret: "wrong-secret" }), /unauthorized/);
	});

	it("桌面端密钥不对进不去", () => {
		const relay = registeredRelay();
		assert.throws(() => relay.connect({ ...credentials("desktop"), pairingSecret: "wrong-secret" }), /unauthorized/);
	});

	it("桌面端声明了手机密钥的哈希,中继只存哈希", () => {
		const relay = registeredRelay();
		// 桌面端若报了一个对不上的哈希,说明它注册的不是这台手机 —— 拒绝。
		assert.throws(
			() => relay.connect({ ...credentials("desktop"), peerCredentialHash: sha256Hex("other-phone") }),
			/unauthorized/,
		);
	});

	it("日志里不出现任何密钥、内容或配对信息", () => {
		const relay = registeredRelay();
		relay.connect(credentials("desktop"));
		const log = relay.events.join("\n");
		assert.equal(log.includes(DESKTOP_SECRET), false);
		assert.equal(log.includes(PHONE_SECRET), false);
		assert.equal(log.includes(PAIRING_ID), false);
	});
});

describe("帧规则", () => {
	it("第一帧必须是 hello,而且角色要对得上", async () => {
		const relay = registeredRelay();
		const transport = relay.connect(credentials("mobile"));
		await transport.connect({ onFrame: () => undefined, onClose: () => undefined });
		// 用桌面端的角色发 hello:中继必须拒绝。
		await transport.send({
			type: "hello",
			protocolVersion: 2,
			role: "desktop",
			deviceId: "x",
			deviceName: "x",
			capabilities: CAPABILITIES,
			connectionId: "c",
			identityKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			ephemeralKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		});
		assert.deepEqual(relay.closes.map((entry) => entry.code), [RELAY_CLOSE_INVALID_FRAME]);
		assert.equal(relay.closes[0]?.reason, "invalid_handshake");
	});

	it("握手之后出现明文会话帧就断开", async () => {
		const relay = registeredRelay();
		const desktop = relay.connect(credentials("desktop"));
		const mobile = relay.connect(credentials("mobile"));
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktopReady = new RemoteConnection({
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			identity: desktopIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: mobileIdentity.publicKey,
		}).connect(desktop);
		const mobileReady = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			identity: mobileIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: desktopIdentity.publicKey,
		}).connect(mobile);
		await settle(relay);
		await Promise.all([desktopReady, mobileReady]);
		// 绕过加密层直接发一个明文请求:中继必须拒绝,而不是转发。
		await mobile.send({ type: "request", requestId: "r1", method: "session.list" });
		assert.deepEqual(relay.closes.map((entry) => entry.code), [RELAY_CLOSE_INVALID_FRAME]);
		assert.equal(relay.closes[0]?.reason, "plaintext_after_handshake");
	});

	it("同一角色再次连接会顶掉旧连接(旧连接收到 4001)", async () => {
		const relay = registeredRelay();
		const first = relay.connect(credentials("desktop"));
		const closes: string[] = [];
		await first.connect({ onFrame: () => undefined, onClose: (reason) => closes.push(reason ?? "") });
		relay.connect(credentials("desktop"));
		assert.equal(closes.length, 1);
		assert.match(closes[0] ?? "", new RegExp(String(RELAY_CLOSE_SUPERSEDED)));
	});

	it("对端不在线时,发来的密封帧被回一句不在线,但发送方不被断开", async () => {
		const relay = registeredRelay();
		const mobile = relay.connect(credentials("mobile"));
		const received: string[] = [];
		await mobile.connect({
			onFrame: (frame) => received.push(frame.type),
			onClose: () => received.push("closed"),
		});
		// 手机先握手(桌面端不在),然后发一个密封帧。
		await mobile.send({
			type: "hello",
			protocolVersion: 2,
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			connectionId: "c1",
			identityKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			ephemeralKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		});
		await mobile.send({ type: "sealed", nonce: "A".repeat(32), ciphertext: "B".repeat(30) });
		assert.deepEqual(received, ["peer_status"]);
		assert.equal(received.includes("closed"), false);
	});

	it("对端断开时,剩下的一侧收到不在线", async () => {
		const relay = registeredRelay();
		const desktop = relay.connect(credentials("desktop"));
		const desktopFrames: string[] = [];
		await desktop.connect({ onFrame: (frame) => desktopFrames.push(frame.type), onClose: () => undefined });
		const mobile = relay.connect(credentials("mobile"));
		await mobile.connect({ onFrame: () => undefined, onClose: () => undefined });
		await desktop.send({
			type: "hello",
			protocolVersion: 2,
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			connectionId: "c1",
			identityKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			ephemeralKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		});
		await mobile.send({
			type: "hello",
			protocolVersion: 2,
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			connectionId: "c2",
			identityKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			ephemeralKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		});
		desktopFrames.length = 0;
		await mobile.close();
		assert.deepEqual(desktopFrames, ["peer_status"]);
	});

	it("心跳由中继自动应答,不产生任何转发", () => {
		const relay = registeredRelay();
		assert.equal(relay.keepalive(KEEPALIVE_PING), KEEPALIVE_PONG);
		assert.equal(relay.keepalive("something else"), "something else");
		assert.equal(relay.events.length, 1); // 只有注册那一条
	});
});

describe("连接码信箱", () => {
	const envelopeOf = () => sealInvite("wordless://pair?v=2", "K7Q29MXD", "123456");

	it("写入后能取回(取回的就是写进去的那一份)", async () => {
		const relay = registeredRelay();
		// 信封每次密封都有新 nonce,所以这里只密封一次再比较 —— 否则比的是两个不同的信封。
		const envelope = await envelopeOf();
		relay.putInvite("BOX", "writer-token", envelope);
		assert.deepEqual(relay.getInvite("BOX"), envelope);
	});

	it("形状不合规的信封写不进去", () => {
		const relay = registeredRelay();
		assert.throws(() => relay.putInvite("BOX", "t", { v: 1, nonce: "x", ciphertext: "y" } as never), /invalid/);
	});

	it("最多被读 10 次,读完即消失", async () => {
		const relay = registeredRelay();
		relay.putInvite("BOX", "t", await envelopeOf());
		for (let index = 0; index < 10; index += 1) assert.ok(relay.getInvite("BOX"));
		assert.equal(relay.getInvite("BOX"), undefined);
	});

	it("超过时限就取不到(默认 10 分钟)", async () => {
		let now = 0;
		const relay = new RelayCore({ now: () => now });
		relay.registerRoom(PAIRING_ID, DESKTOP_SECRET, sha256Hex(PHONE_SECRET));
		relay.putInvite("BOX", "t", await envelopeOf());
		assert.ok(relay.getInvite("BOX"));
		now = 11 * 60_000;
		assert.equal(relay.getInvite("BOX"), undefined);
	});

	it("撤回需要写入令牌:令牌不对就撤不掉", async () => {
		const relay = registeredRelay();
		relay.putInvite("BOX", "t", await envelopeOf());
		assert.equal(relay.deleteInvite("BOX", "wrong"), false);
		assert.ok(relay.getInvite("BOX"));
		assert.equal(relay.deleteInvite("BOX", "t"), true);
		assert.equal(relay.getInvite("BOX"), undefined);
	});
});

describe("端到端:两个端点经中继说话", () => {
	const buildPair = async () => {
		const relay = registeredRelay();
		const desktopIdentity = generateIdentityKeyPair();
		const mobileIdentity = generateIdentityKeyPair();
		const desktopEvents: RemoteConnectionEvent[] = [];
		const mobileEvents: RemoteConnectionEvent[] = [];

		// 两端都主动连中继(中继不是端点,它只撮合与转发)。
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

		const desktopReady = desktop.connect(relay.connect(credentials("desktop")));
		const mobileReady = mobile.connect(relay.connect(credentials("mobile")));
		await settle(relay);
		await Promise.all([desktopReady, mobileReady]);
		return { relay, desktop, mobile, desktopEvents, mobileEvents };
	};

	it("握手完成,两端都能看到对端", async () => {
		const { desktop, mobile } = await buildPair();
		assert.equal(desktop.state, "online");
		assert.equal(mobile.state, "online");
		assert.equal(desktop.peerDeviceId, "phone-1");
		assert.equal(mobile.peerDeviceId, "desk-1");
		// 名字也要能读到:两端都主动连中继,hello 不会被转发,所以由中继抄进 hello_ack。
		assert.equal(desktop.peerDeviceName, "我的手机");
		assert.equal(mobile.peerDeviceName, "我的电脑");
	});

	it("请求与响应能穿过中继", async () => {
		const { relay, desktop, mobile, desktopEvents } = await buildPair();
		const answer = mobile.sendRequest("session.list");
		await settle(relay);
		const request = desktopEvents.find((event) => event.type === "remote-request");
		const requestId = request?.type === "remote-request" ? request.request.requestId : "";
		await desktop.respondToRequest(requestId, { success: true, payload: { sessions: ["一"] } });
		await settle(relay);
		assert.deepEqual(await answer, { success: true, payload: { sessions: ["一"] } });
	});

	it("事件穿过去之后序号连续,并且中继只转发密封帧", async () => {
		const { relay, desktop, mobile } = await buildPair();
		mobile.publishEvent("session.message", { payload: { text: "你好" } });
		mobile.publishEvent("session.tool", { payload: { name: "bash" } });
		await settle(relay);
		assert.equal(desktop.lastEventSequence, 2);
		// 中继的日志里只有"转发了 sealed",没有任何会话内容。
		assert.equal(relay.events.filter((entry) => entry === "frame_forwarded sealed").length >= 2, true);
		assert.equal(relay.events.join("\n").includes("你好"), false);
		assert.equal(relay.events.join("\n").includes("bash"), false);
	});
});
