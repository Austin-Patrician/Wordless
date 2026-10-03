import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebSocket } from "ws";
import {
	RemoteConnection,
	WebSocketTransport,
	buildPairingProtocols,
	fromBase64Url,
	identityKeyPairFromSecret,
	inviteBoxId,
	inviteBoxUrl,
	nodeWebSocketFactory,
	openInvite,
	readInviteEnvelope,
	type RemoteConnectionEvent,
	type RemoteIdentityKeyPair,
} from "@wordless/remote-control";
import { startRelayServer } from "@wordless/relay/server";
import { RemoteAccessService, type RemoteAccessPreferences } from "../src/main/remote/remote-access-service.ts";
import type { RemoteSessionSurface, RemoteSurfaceEvent } from "../src/main/remote/host-service.ts";

/**
 * **设置页那条路**的端到端:真中继 + `RemoteAccessService` + 手机。
 *
 * 与 `remote-e2e.test.ts` 的区别很重要:那条测的是 `RemoteHostService`(单台设备、参数直接给),
 * 这条测的是**用户真实会走的路径** —— 生成二维码、手机扫、`claimDevice` 落库、二维码收起、
 * 重启后自己连回来。用户报的两个现象(电脑这一侧"不在线"、二维码不收起)都只在这条路上。
 */

const factory = nodeWebSocketFactory(WebSocket as never);

const createSurface = (): RemoteSessionSurface => {
	const listeners = new Set<(event: RemoteSurfaceEvent) => void>();
	return {
		listSessions: async () => [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: false }],
		openSession: async (sessionId) =>
			sessionId === "s1"
				? { summary: { id: "s1", title: "修一下登录页", updatedAt: 1, running: false }, messages: [] }
				: undefined,
		historyPage: async () => ({ messages: [] }),
		prompt: async () => undefined,
		abort: async () => undefined,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};

/** 一台"机器":偏好与凭据库。两次 `createHarness` 共用同一台机器 = 模拟"重启应用"。 */
interface Machine {
	preferences: RemoteAccessPreferences;
	readonly secrets: Map<string, string>;
}

const createMachine = (): Machine => ({
	preferences: { enabled: true, devices: [] },
	secrets: new Map(),
});

interface Harness {
	readonly service: RemoteAccessService;
	readonly machine: Machine;
}

/**
 * 服务 + 真中继。
 *
 * 偏好与凭据都在内存里(测的是链路,不是文件);**信箱走真中继的 HTTP 端点** ——
 * 那正是桌面端在跑的东西,所以"二维码发出去、被领取、再收起"整条都测到了。
 */
const createHarness = async (relayUrl: string, machine: Machine = createMachine()): Promise<Harness> => {
	const { secrets } = machine;
	const service = new RemoteAccessService({
		surface: createSurface(),
		deviceId: "desk-1",
		deviceName: "我的电脑",
		readPreferences: async () => machine.preferences,
		writePreferences: async (update) => {
			machine.preferences = update(machine.preferences);
			return machine.preferences;
		},
		secrets: {
			get: async (id) => secrets.get(id),
			put: async (id, secret) => void secrets.set(id, secret),
			remove: async (id) => void secrets.delete(id),
		},
		createTransport: (url, protocols) => new WebSocketTransport({ url, protocols: [...protocols], factory }),
		mailbox: {
			publish: async (boxUrl, token, envelope) => {
				const response = await fetch(boxUrl, {
					method: "PUT",
					headers: { "x-wordless-invite-token": token },
					body: JSON.stringify(envelope),
				});
				assert.equal(response.status, 201, `信箱写入失败:${response.status}`);
			},
			withdraw: async (boxUrl, token) => {
				await fetch(boxUrl, { method: "DELETE", headers: { "x-wordless-invite-token": token } });
			},
		},
		defaultRelayBaseUrl: relayUrl,
	});
	await service.start();
	return { service, machine };
};

/** 手机侧只按"用户看到的东西"来:连接码 + 密码 + 中继地址。 */
const pairPhone = async (relayUrl: string, invite: { readonly code: string; readonly password: string }) => {
	const boxUrl = inviteBoxUrl(relayUrl, inviteBoxId(invite.code));
	const response = await fetch(boxUrl);
	assert.equal(response.status, 200, "二维码里的邀请应当还在中继信箱上");
	const envelope = readInviteEnvelope(await response.json());
	assert.ok(envelope, "邀请信封应当能解析");
	const params = new URL(await openInvite(envelope, invite.code, invite.password)).searchParams;
	const pairingId = params.get("pairingId") ?? "";
	const secret = params.get("secret") ?? "";
	const identity: RemoteIdentityKeyPair = identityKeyPairFromSecret(fromBase64Url(secret));
	const connect = async (): Promise<{ readonly phone: RemoteConnection; readonly events: RemoteConnectionEvent[] }> => {
		const events: RemoteConnectionEvent[] = [];
		const phone = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: { chat: true, sessionRead: true },
			identity,
			handshake: "initiate",
		});
		phone.onEvent((event) => events.push(event));
		await phone.connect(
			new WebSocketTransport({
				url: `${relayUrl}/v2/relay/${pairingId}/mobile`,
				protocols: buildPairingProtocols({ pairingSecret: secret }),
				factory,
			}),
		);
		return { phone, events };
	};
	return { connect };
};

const sleep = async (ms: number): Promise<void> => await new Promise((resolve) => setTimeout(resolve, ms));

describe("设置页那条路(真中继 + 服务 + 手机)", () => {
	it("手机配对之后:电脑这一侧保持在线,二维码自动收起", async () => {
		const relay = await startRelayServer({ port: 0 });
		const { service } = await createHarness(relay.url);
		const invited = await service.createInvite();
		const invite = invited.invite;
		assert.ok(invite, "生成二维码后应当能看到它");

		const { connect } = await pairPhone(relay.url, invite);
		const { phone } = await connect();
		assert.equal(phone.state, "online");

		// 电脑这一侧:设备在线、连接在线、二维码收起。
		await sleep(200);
		const state = service.getState();
		assert.equal(state.connection, "online", "配对之后电脑这一侧必须是在线");
		assert.equal(state.devices.length, 1);
		assert.equal(state.devices[0].online, true, "设备列表里这一台必须显示在线");
		assert.equal(state.invite, undefined, "被领取之后二维码要自动收起");

		// 再过一会儿:链路不能自己掉(用户看到的就是"正在重连")。
		await sleep(1_200);
		assert.equal(service.getState().connection, "online", "配对之后不应该掉线");
		assert.equal(service.getState().devices[0].online, true);

		// 而且链路真的能用。
		const listed = await phone.sendRequest("session.list");
		assert.equal(listed.success, true, JSON.stringify(listed.error));

		// 手机走掉之后,电脑这一侧也要变成"不在线" —— 界面靠推送跟着变,不能一直显示在线。
		await phone.close("手机走了");
		await sleep(400);
		assert.equal(service.getState().devices[0].online, false, "手机断开后设备应当显示不在线");

		// 收尾要**按顺序**:先关手机、再停服务、最后关中继 —— 少关一个 socket,测试进程就不会退出。
		await phone.close("test finished");
		await service.stop();
		await relay.close();
	});

	it("已经配过对的设备:重启之后自己连回来,不需要再生成二维码", async () => {
		const relay = await startRelayServer({ port: 0 });
		const machine = createMachine();
		const first = await createHarness(relay.url, machine);
		const invited = await first.service.createInvite();
		const invite = invited.invite;
		assert.ok(invite);
		const { connect } = await pairPhone(relay.url, invite);
		const paired = await connect();
		await sleep(200);
		assert.equal(first.service.getState().devices[0].online, true);
		await paired.phone.close("restart the desktop");
		await first.service.stop();

		// 第二次:模拟"用户下次打开应用" —— 偏好与凭据都还在,内存里的邀请已经没了。
		const second = await createHarness(relay.url, machine);
		const restarted = second.service.getState();
		assert.equal(restarted.devices.length, 1, "重启不该多出一台设备");
		assert.equal(restarted.invite, undefined, "已配对的设备不需要二维码");
		// 电脑已经主动连回中继等着了:手机直接连上来就行。
		const again = await connect();
		await sleep(300);
		assert.equal(again.phone.state, "online", "已配对的手机不需要二维码就能连回来");
		assert.equal(second.service.getState().devices[0].online, true);

		await again.phone.close("test finished");
		await second.service.stop();
		await relay.close();
	});
});
