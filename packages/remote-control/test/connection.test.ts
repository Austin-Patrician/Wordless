import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RemoteConnection } from "../src/connection.ts";
import { generateIdentityKeyPair } from "../src/crypto.ts";
import { RemoteEventJournal } from "../src/event-journal.ts";
import { FakeTransportPair } from "../src/fake-transport.ts";
import type { RemoteConnectionEvent, RemoteEvent, RemoteHelloDecision, RemoteIdentityKeyPair } from "../src/types.ts";

/**
 * 连接层:握手、请求/响应、事件序号、断线恢复。
 *
 * 这一层是协议里最容易写错的地方,所以用例集中在**异常路径**上:身份不符、响应重复、请求超时、
 * 跳号、断线、补不上要整体重拉、明文帧。
 *
 * 全部跑在假传输上 —— 不需要真手机、不需要任何云账号。
 */

const CAPABILITIES = { chat: true, sessionRead: true } as const;

interface Rig {
	readonly mobile: RemoteConnection;
	readonly desktop: RemoteConnection;
	readonly pair: FakeTransportPair;
	readonly mobileEvents: RemoteConnectionEvent[];
	readonly desktopEvents: RemoteConnectionEvent[];
	readonly desktopJournal: RemoteEventJournal;
	readonly mobileJournal: RemoteEventJournal;
	readonly mobileIdentity: RemoteIdentityKeyPair;
	readonly desktopIdentity: RemoteIdentityKeyPair;
}

const makeRig = (options: {
	readonly mobileJournal?: RemoteEventJournal;
	readonly desktopJournal?: RemoteEventJournal;
	readonly requestTimeoutMs?: number;
	readonly onHello?: () => RemoteHelloDecision;
	readonly mobileIdentity?: RemoteIdentityKeyPair;
	readonly desktopIdentity?: RemoteIdentityKeyPair;
	readonly pair?: FakeTransportPair;
} = {}): Rig => {
	const mobileIdentity = options.mobileIdentity ?? generateIdentityKeyPair();
	const desktopIdentity = options.desktopIdentity ?? generateIdentityKeyPair();
	const pair = options.pair ?? new FakeTransportPair();
	const mobileJournal = options.mobileJournal ?? new RemoteEventJournal();
	const desktopJournal = options.desktopJournal ?? new RemoteEventJournal();
	const mobileEvents: RemoteConnectionEvent[] = [];
	const desktopEvents: RemoteConnectionEvent[] = [];

	const mobile = new RemoteConnection({
		role: "mobile",
		deviceId: "phone-1",
		deviceName: "我的手机",
		capabilities: CAPABILITIES,
		identity: mobileIdentity,
		handshake: "initiate",
		expectedPeerIdentityKey: desktopIdentity.publicKey,
		journal: mobileJournal,
		...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
	});
	const desktop = new RemoteConnection({
		role: "desktop",
		deviceId: "desk-1",
		deviceName: "我的电脑",
		capabilities: CAPABILITIES,
		identity: desktopIdentity,
		handshake: "accept",
		expectedPeerIdentityKey: mobileIdentity.publicKey,
		journal: desktopJournal,
		...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
		...(options.onHello === undefined ? {} : { onHello: options.onHello }),
	});
	mobile.onEvent((event) => mobileEvents.push(event));
	desktop.onEvent((event) => desktopEvents.push(event));
	return {
		mobile,
		desktop,
		pair,
		mobileEvents,
		desktopEvents,
		mobileJournal,
		desktopJournal,
		mobileIdentity,
		desktopIdentity,
	};
};

/** 让排队中的帧投递完,并给异步处理器机会把新帧排进队列。 */
const settle = async (pair: FakeTransportPair, rounds = 8): Promise<void> => {
	for (let index = 0; index < rounds; index += 1) {
		pair.flush();
		await new Promise((resolve) => setImmediate(resolve));
	}
};

const handshake = async (rig: Rig): Promise<void> => {
	const desktopReady = rig.desktop.connect(rig.pair.b);
	const mobileReady = rig.mobile.connect(rig.pair.a);
	await settle(rig.pair);
	await Promise.all([mobileReady, desktopReady]);
};

const eventsOf = (events: readonly RemoteConnectionEvent[]): RemoteEvent[] =>
	events.flatMap((event) => (event.type === "remote-event" ? [event.event] : []));

const errorsOf = (events: readonly RemoteConnectionEvent[]) =>
	events.flatMap((event) => (event.type === "error" ? [event.error] : []));

/** 人工放行的开关:测试自己决定"电脑前的用户"什么时候点允许。 */
const approvalGate = () => {
	let settle: (value: boolean) => void = () => undefined;
	const approval = new Promise<boolean>((resolve) => {
		settle = resolve;
	});
	return { approval, approve: settle };
};

describe("握手", () => {
	it("两端都上线,接受方能看到对端自报的名字与能力", async () => {
		const rig = makeRig();
		await handshake(rig);
		assert.equal(rig.mobile.state, "online");
		assert.equal(rig.desktop.state, "online");
		assert.equal(rig.mobile.peerDeviceId, "desk-1");
		assert.equal(rig.desktop.peerDeviceId, "phone-1");
		assert.equal(rig.desktop.getSnapshot().peerDeviceName, "我的手机");
		assert.deepEqual(rig.desktop.getSnapshot().peerCapabilities, CAPABILITIES);
	});

	it("两端算出同一个 6 位验证码(手动配对时用它防中间人)", async () => {
		const rig = makeRig();
		await handshake(rig);
		const a = rig.mobile.getSnapshot().verificationCode;
		const b = rig.desktop.getSnapshot().verificationCode;
		assert.match(a ?? "", /^\d{6}$/);
		assert.equal(a, b);
	});

	it("身份对不上就在派生密钥之前拒绝,而且双方都不会上线", async () => {
		const rig = makeRig();
		const stranger = generateIdentityKeyPair();
		const desktopEvents: RemoteConnectionEvent[] = [];
		const desktop = new RemoteConnection({
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			identity: rig.desktopIdentity,
			handshake: "accept",
			// 钉住的是另一台手机 —— 来者不是它。
			expectedPeerIdentityKey: stranger.publicKey,
			requestTimeoutMs: 30,
		});
		desktop.onEvent((event) => desktopEvents.push(event));
		void desktop.connect(rig.pair.b).catch(() => undefined);
		void rig.mobile.connect(rig.pair.a).catch(() => undefined);
		await settle(rig.pair);
		assert.deepEqual(errorsOf(desktopEvents).map((error) => error.code), ["unauthorized"]);
		assert.equal(desktop.state, "closed");
		// 让手机端的握手超时落地,避免留下悬挂的 promise 影响后续用例。
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.notEqual(rig.mobile.state, "online");
	});

	it("握手可以设成不超时:停在中继上等对端是长期状态,不该被当成卡住", async () => {
		const pair = new FakeTransportPair();
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
			// 关键:不设超时。否则"等手机"会在 15 秒后被误报成失败并断开。
			handshakeTimeoutMs: 0,
			requestTimeoutMs: 20,
		});
		const desktopReady = desktop.connect(pair.b);
		await settle(pair, 3);
		// 远超过 requestTimeoutMs:应当是"还在等",而不是失败或关闭。
		await new Promise((resolve) => setTimeout(resolve, 60));
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
		const mobileReady = mobile.connect(pair.a);
		await settle(pair);
		await Promise.all([mobileReady, desktopReady]);
		assert.equal(desktop.state, "online");
	});

	it("未知对端可以走人工放行:先进入等待放行,放行后才上线", async () => {
		const gate = approvalGate();
		const rig = makeRig();
		const desktopEvents: RemoteConnectionEvent[] = [];
		const desktop = new RemoteConnection({
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			identity: rig.desktopIdentity,
			handshake: "accept",
			onHello: () => ({ kind: "pending", approval: gate.approval }),
		});
		desktop.onEvent((event) => desktopEvents.push(event));
		const desktopReady = desktop.connect(rig.pair.b);
		const mobileReady = rig.mobile.connect(rig.pair.a);
		await settle(rig.pair);
		// 手机收到 pairing_pending,所以它知道"在等电脑放行",而不是一直转圈。
		assert.equal(rig.mobile.state, "pending_approval");
		assert.equal(desktop.state, "pending_approval");
		gate.approve(true);
		await settle(rig.pair);
		await Promise.all([mobileReady, desktopReady]);
		assert.equal(rig.mobile.state, "online");
		assert.equal(desktop.state, "online");
	});
});

describe("请求与响应", () => {
	it("请求到达对端,响应回到发起方", async () => {
		const rig = makeRig();
		await handshake(rig);
		const answer = rig.mobile.sendRequest("session.list");
		await settle(rig.pair);
		const received = rig.desktopEvents.find((event) => event.type === "remote-request");
		assert.equal(received?.type === "remote-request" ? received.request.method : undefined, "session.list");
		const requestId = received?.type === "remote-request" ? received.request.requestId : "";
		await rig.desktop.respondToRequest(requestId, { success: true, payload: { sessions: ["a", "b"] } });
		await settle(rig.pair);
		assert.deepEqual(await answer, { success: true, payload: { sessions: ["a", "b"] } });
		assert.equal(rig.mobile.getSnapshot().pendingRequestCount, 0);
	});

	it("重复的响应不会再次完成请求(幂等)", async () => {
		const rig = makeRig();
		await handshake(rig);
		const answer = rig.mobile.sendRequest("session.list");
		await settle(rig.pair);
		const received = rig.desktopEvents.find((event) => event.type === "remote-request");
		const requestId = received?.type === "remote-request" ? received.request.requestId : "";
		await rig.desktop.respondToRequest(requestId, { success: true, payload: "first" });
		await rig.desktop.respondToRequest(requestId, { success: true, payload: "second" });
		await settle(rig.pair);
		assert.deepEqual(await answer, { success: true, payload: "first" });
		// 第二个响应被忽略,不会冒出第二个结果,也不会有错误。
		assert.equal(errorsOf(rig.mobileEvents).length, 0);
	});

	it("对端不回时请求以可重试的超时收尾,而不是一直挂着", async () => {
		const rig = makeRig({ requestTimeoutMs: 20 });
		await handshake(rig);
		const result = await rig.mobile.sendRequest("session.list");
		assert.equal(result.success, false);
		assert.equal(result.error?.code, "request_timeout");
		assert.equal(result.error?.retryable, true);
	});

	it("失败响应必须带错误:应用漏了也会被补成 internal_error", async () => {
		const rig = makeRig();
		await handshake(rig);
		const answer = rig.mobile.sendRequest("session.open");
		await settle(rig.pair);
		const received = rig.desktopEvents.find((event) => event.type === "remote-request");
		const requestId = received?.type === "remote-request" ? received.request.requestId : "";
		await rig.desktop.respondToRequest(requestId, { success: false });
		await settle(rig.pair);
		const result = await answer;
		assert.equal(result.success, false);
		assert.equal(result.error?.code, "internal_error");
	});
});

describe("事件序号", () => {
	it("序号从 1 开始、单调递增,并且被对端确认", async () => {
		const rig = makeRig();
		await handshake(rig);
		rig.mobile.publishEvent("session.message", { payload: { text: "一" } });
		rig.mobile.publishEvent("session.message", { payload: { text: "二" } });
		rig.mobile.publishEvent("session.tool", { payload: { name: "bash" } });
		await settle(rig.pair);
		assert.deepEqual(
			eventsOf(rig.desktopEvents).map((event) => event.sequence),
			[1, 2, 3],
		);
		assert.equal(rig.desktop.lastEventSequence, 3);
		// 桌面端收到就回 ack,所以手机端可以把已确认的事件扔掉。
		assert.equal(rig.mobile.getSnapshot().lastAckSequence, 3);
		assert.deepEqual(rig.mobileJournal.replay(3), []);
	});

	it("链路重传同一帧时不会交付两次", async () => {
		const rig = makeRig();
		await handshake(rig);
		rig.mobile.publishEvent("session.message", { payload: { text: "一" } });
		await settle(rig.pair);
		const delivered = eventsOf(rig.desktopEvents);
		assert.equal(delivered.length, 1);
		// 把刚才那一帧原样再投一次(模拟链路重传)。
		const sealed = rig.pair.rawFrames.at(-1) ?? "";
		rig.pair.reinjectRaw(sealed, "b");
		await settle(rig.pair);
		assert.equal(eventsOf(rig.desktopEvents).length, 1);
	});

	it("密文在途中被改动就打不开,并且关闭链路", async () => {
		const rig = makeRig();
		await handshake(rig);
		rig.mobile.publishEvent("session.message");
		await settle(rig.pair);
		const tampered = JSON.parse(rig.pair.rawFrames.at(-1) ?? "{}");
		const bytes = Buffer.from(tampered.ciphertext, "base64url");
		bytes[2] ^= 0x01;
		tampered.ciphertext = bytes.toString("base64url");
		rig.pair.reinjectRaw(JSON.stringify(tampered), "b");
		await settle(rig.pair);
		assert.deepEqual(errorsOf(rig.desktopEvents).map((error) => error.code), ["invalid_frame"]);
		assert.equal(rig.desktop.state, "closed");
	});

	it("跳号时进入恢复状态并请求补发,补回来的事件按序交付", async () => {
		const rig = makeRig();
		await handshake(rig);
		rig.mobile.publishEvent("session.message", { payload: { text: "一" } });
		rig.pair.dropNext(1); // 第二条丢掉
		rig.mobile.publishEvent("session.message", { payload: { text: "二" } });
		rig.mobile.publishEvent("session.message", { payload: { text: "三" } });
		await settle(rig.pair);
		// 桌面端拿到 1 与 3 → 发现跳号 → 请求补发 → 手机端从日志补 2 与 3。
		assert.deepEqual(
			eventsOf(rig.desktopEvents).map((event) => event.sequence),
			[1, 2, 3],
		);
		assert.equal(rig.desktop.state, "online");
		assert.equal(rig.desktop.lastEventSequence, 3);
	});

	it("补不上时要求整体重拉,而且不会互相要求补发(死循环)", async () => {
		// 手机端的日志只留 1 条,所以当桌面端要求"从 0 开始补"时已经补不上了。
		const mobileJournal = new RemoteEventJournal({ capacity: 1 });
		const rig = makeRig({ mobileJournal });
		await handshake(rig);
		rig.pair.dropNext(2); // 前两条丢在路上
		rig.mobile.publishEvent("session.message");
		rig.mobile.publishEvent("session.message");
		rig.mobile.publishEvent("session.message");
		await settle(rig.pair);
		const resync = eventsOf(rig.desktopEvents).filter((event) => event.name === "session.resync");
		// 恰好一条:如果重拉指令本身又被当成"跳号",双方会互相要求补发,这里会变成很多条。
		assert.equal(resync.length, 1);
		assert.equal(rig.desktop.lastEventSequence, resync[0]?.sequence);
		assert.equal(rig.desktop.state, "online");
	});
});

describe("断线与重连", () => {
	it("断线时待处理请求以可重试错误收尾,不会被静默丢掉", async () => {
		const rig = makeRig();
		await handshake(rig);
		const answer = rig.mobile.sendRequest("session.list");
		await settle(rig.pair);
		rig.pair.disconnect("cable pulled");
		await settle(rig.pair);
		const result = await answer;
		assert.equal(result.success, false);
		assert.equal(result.error?.code, "transport_closed");
		assert.equal(result.error?.retryable, true);
		assert.equal(rig.mobile.state, "reconnecting");
		assert.equal(rig.mobile.getSnapshot().pendingRequestCount, 0);
	});

	it("重连后序号连续,只补缺失的尾部", async () => {
		const rig = makeRig();
		await handshake(rig);
		rig.mobile.publishEvent("session.message", { payload: { text: "一" } });
		await settle(rig.pair);
		assert.equal(rig.desktop.lastEventSequence, 1);

		// 两边都掉线,手机端继续发 —— 这些事件只进日志(链路不在,发不出去,也不该报错)。
		rig.pair.closeSide("a");
		rig.pair.closeSide("b");
		await settle(rig.pair);
		assert.equal(rig.mobile.state, "reconnecting");
		rig.mobile.publishEvent("session.message", { payload: { text: "二" } });
		rig.mobile.publishEvent("session.message", { payload: { text: "三" } });
		assert.equal(rig.mobileJournal.lastSequence, 3);

		// 换一条链路重连:桌面端带上"我收到 1 了",所以只需要补 2 与 3。
		const pair = new FakeTransportPair();
		const desktopReady = rig.desktop.connect(pair.b);
		const mobileReady = rig.mobile.connect(pair.a);
		await settle(pair);
		await Promise.all([mobileReady, desktopReady]);

		assert.deepEqual(
			eventsOf(rig.desktopEvents).map((event) => event.sequence),
			[1, 2, 3],
		);
		assert.equal(rig.mobile.getSnapshot().reconnectCount, 1);
		assert.equal(rig.desktop.lastEventSequence, 3);
	});

	it("握手之后出现明文会话帧会被拒绝", async () => {
		const rig = makeRig();
		await handshake(rig);
		await rig.pair.a.send({ type: "request", requestId: "r1", method: "session.list" });
		await settle(rig.pair);
		const codes = errorsOf(rig.desktopEvents).map((error) => error.code);
		assert.deepEqual(codes, ["invalid_frame"]);
		assert.equal(rig.desktop.state, "closed");
	});

describe("掉线之后真的会重连", () => {
	/**
	 * 这里钉住的是一个**真 bug**:以前只有 `reconnecting` 这个状态、没有重连动作 ——
	 * 任何一次掉线(手机切后台、Wi-Fi 抖动、中继重启)都会让手机永远停在"正在重连"、
	 * 电脑永远显示"不在线"。状态是给用户看的,动作才是真的在做事。
	 */
	/**
	 * 一个像中继一样的"房间":两侧各自来取自己那一半,谁先来都拿到**同一对**假传输。
	 * 掉线之后 `resetRoom()` 一次,两边的重连就会落到同一个新房子里(真实中继就是这么配对的)。
	 */
	const reconnectRig = (options: { readonly failTimes?: number } = {}) => {
		let room: FakeTransportPair | undefined;
		let failures = options.failTimes ?? 0;
		const mobileEvents: RemoteConnectionEvent[] = [];
		const mobileIdentity = generateIdentityKeyPair();
		const desktopIdentity = generateIdentityKeyPair();
		const roomFor = (side: "a" | "b") => {
			room ??= new FakeTransportPair();
			return room[side];
		};
		const mobile = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			identity: mobileIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: desktopIdentity.publicKey,
			reconnectDelaysMs: [1],
			reconnect: async () => {
				if (failures > 0) {
					failures -= 1;
					throw new Error("中继还没起来");
				}
				return roomFor("a");
			},
		});
		const desktop = new RemoteConnection({
			role: "desktop",
			deviceId: "desk-1",
			deviceName: "我的电脑",
			capabilities: CAPABILITIES,
			identity: desktopIdentity,
			handshake: "accept",
			expectedPeerIdentityKey: mobileIdentity.publicKey,
			reconnectDelaysMs: [1],
			reconnect: async () => roomFor("b"),
		});
		mobile.onEvent((event) => mobileEvents.push(event));
		return {
			mobile,
			desktop,
			mobileEvents,
			currentPair: () => room ?? new FakeTransportPair(),
			resetRoom: () => {
				room = undefined;
			},
		};
	};

	it("链路断了会自己接回来(而不是停在一句「正在重连」)", async () => {
		const rig = reconnectRig();
		const first = rig.currentPair();
		const desktopReady = rig.desktop.connect(first.b);
		const mobileReady = rig.mobile.connect(first.a);
		await settle(first);
		await Promise.all([mobileReady, desktopReady]);
		assert.equal(rig.mobile.state, "online");

		// 网络断了:两侧都会进入重连。
		first.disconnect();
		rig.resetRoom();
		assert.equal(rig.mobile.state, "reconnecting");

		// 等到重连完成:新的一对传输,两侧都回到 online。
		for (let attempt = 0; attempt < 40 && rig.mobile.state !== "online"; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 5));
			await settle(rig.currentPair());
		}
		assert.equal(rig.mobile.state, "online", "掉线之后必须真的连回来");
		assert.equal(rig.desktop.state, "online");

		await rig.mobile.close();
		await rig.desktop.close();
	});

	it("连不上就继续试(中继重启的几秒里不该放弃)", async () => {
		const rig = reconnectRig({ failTimes: 2 });
		const first = rig.currentPair();
		const desktopReady = rig.desktop.connect(first.b);
		const mobileReady = rig.mobile.connect(first.a);
		await settle(first);
		await Promise.all([mobileReady, desktopReady]);
		first.disconnect();
		rig.resetRoom();

		for (let attempt = 0; attempt < 60 && rig.mobile.state !== "online"; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 5));
			await settle(rig.currentPair());
		}
		assert.equal(rig.mobile.state, "online", "前两次失败之后第三次应当连上");

		await rig.mobile.close();
		await rig.desktop.close();
	});

	it("主动关掉之后不许自己连回来", async () => {
		const rig = reconnectRig();
		const first = rig.currentPair();
		const desktopReady = rig.desktop.connect(first.b);
		const mobileReady = rig.mobile.connect(first.a);
		await settle(first);
		await Promise.all([mobileReady, desktopReady]);

		await rig.mobile.close("用户关掉了页面");
		first.disconnect();
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(rig.mobile.state, "closed", "主动关闭之后必须停住,不能被重连悄悄拉起来");

		await rig.desktop.close();
	});
});

describe("过大的载荷不该以整条链路陪葬", () => {
	/**
	 * 真实故障:手机上打开一个**大会话**,电脑一次把整段历史发过去 → 超过单帧上限 →
	 * 手机判为非法帧并关掉链路 → 用户看到"正在重连",再打开就"这个会话还没有消息"。
	 *
	 * 所以发送端要先量一下:发不出去就**只让这一次请求失败**,链路继续活着。
	 */
	it("超长请求:这一次失败,链路还在", async () => {
		const rig = makeRig();
		await handshake(rig);
		assert.equal(rig.mobile.state, "online");

		// 一个必然超过单帧上限的载荷(上限 1_500_000)。
		// 密封层不压缩(只加密 + base64),所以这一串编码后约 2.1M,稳稳超过 1_500_000 的上限。
		const huge = "x".repeat(1_600_000);
		const request = rig.mobile.sendRequest("session.prompt", { sessionId: "s1", payload: { text: huge } });
		await settle(rig.pair);
		const result = await request;
		assert.equal(result.success, false);
		assert.equal(result.error?.code, "payload_too_large");
		assert.equal(result.error?.retryable, false);

		// **关键**:链路没有因此断掉,而且还能继续用 —— 再发一次同样是"只失败这一次",
		// 而不是像以前那样把链路关掉、让用户看到"正在重连"。
		assert.equal(rig.mobile.state, "online");
		const second = await rig.mobile.sendRequest("session.prompt", { sessionId: "s1", payload: { text: huge } });
		assert.equal(second.error?.code, "payload_too_large");
		assert.equal(rig.mobile.state, "online");
	});

	it("超长事件:丢掉那一条,链路还活着,而且**不留一个洞**", async () => {
		const rig = makeRig();
		await handshake(rig);
		const mobileEvents: string[] = [];
		rig.mobile.onEvent((event) => {
			if (event.type === "remote-event") mobileEvents.push(event.event.name);
		});
		rig.desktop.publishEvent("session.message", { payload: { text: "y".repeat(1_600_000) } });
		await settle(rig.pair);
		// 那一条发不出去,但**链路不能因此断掉** —— 断掉的话用户看到的是"正在重连",
		// 而真正的原因只是一次过大的载荷。
		assert.equal(rig.mobile.state, "online");
		/**
		 * **过大的那一条不到,但必须跟一句"补不上,整体重拉"**。
		 *
		 * 事件的序号在发送前就用掉了,而对端按连续序号收:它发现跳号就会停下来等这一条,
		 * 并把它后面的一切都扣住 —— 于是"少发一条"变成"从此什么都收不到",而且两端都不报错。
		 */
		assert.deepEqual(mobileEvents, ["session.resync"], "过大的事件本身不该到达,但要告诉对端整体重拉");
	});

	it("超长事件之后:后面的小事件照样到得了(没有被一个洞扣住)", async () => {
		const rig = makeRig();
		await handshake(rig);
		const mobileEvents: string[] = [];
		rig.mobile.onEvent((event) => {
			if (event.type === "remote-event") mobileEvents.push(event.event.name);
		});
		rig.desktop.publishEvent("session.message", { payload: { text: "y".repeat(1_600_000) } });
		rig.desktop.publishEvent("session.state", { payload: { running: true } });
		await settle(rig.pair);
		// resync 之后序号从这一条接着走,所以下一条能正常到达 —— 这正是"不留洞"的意义。
		assert.deepEqual(mobileEvents, ["session.resync", "session.state"]);
	});

});

	it("握手还没结束就 close():那一次拒绝**不能**变成未处理的 promise 拒绝", async () => {
		/**
		 * 真实踩到过:切换接入方式时先停旧的链路,而那条链路正好还在握手 ——
		 * `close()` 拒绝了握手 promise,而 `connect()` 还没把它交回调用方,
		 * 于是这次拒绝没有任何人接:主进程日志被刷满,调用方的 await 也跟着崩。
		 */
		const rejections: unknown[] = [];
		const onRejection = (reason: unknown) => rejections.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			const connection = new RemoteConnection({ role: "desktop", deviceId: "d1", deviceName: "电脑" });
			// 链路能建起来,但**握手还没完成** —— 正是"关掉一条正在握手的连接"那一刻。
			const transport = {
				connect: async () => {
					await new Promise((resolve) => setTimeout(resolve, 0));
				},
				close: async () => undefined,
				send: async () => undefined,
			};
			// 立刻挂上处理器:调用方在生产代码里也是这么做的(`startHost` 的 .catch)。
			const settled = connection.connect(transport as never).then(
				() => "ok" as const,
				(error: unknown) => error,
			);
			await connection.close("切换接入方式");
			await new Promise((resolve) => setTimeout(resolve, 5));
			assert.deepEqual(rejections, [], "不该有未处理的拒绝");
			// 调用方仍然拿得到失败(它自己会 catch 掉,不会变成未处理拒绝)。
			const outcome = await settled;
			assert.notEqual(outcome, "ok", "关掉之后不该报告连接成功");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});
});
