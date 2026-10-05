import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	RelayCore,
	RemoteConnection,
	fromBase64Url,
	identityKeyPairFromSecret,
	openInvite,
	sha256Hex,
	type RemoteInviteEnvelope,
} from "@wordless/remote-control";
import {
	EMPTY_REMOTE_ACCESS_PREFERENCES,
	RemoteAccessService,
	type RemoteAccessPreferences,
	type RemoteSecretStore,
} from "../src/main/remote/remote-access-service.ts";
import { createRemoteAccessStore } from "../src/main/remote/remote-access-store.ts";
import type { RemoteSessionSurface } from "../src/main/remote/host-service.ts";

/**
 * 主进程侧的远程访问服务。
 *
 * 这里钉住的是**产品的取舍**:没开就什么都不做、一台设备一个房间、撤销只影响那一台、
 * 密钥不进偏好文件、未领取的邀请不落盘。
 */

const surface: RemoteSessionSurface = {
	listSessions: async () => [],
	openSession: async () => undefined,
	historyPage: async () => ({ messages: [] }),
	prompt: async () => undefined,
	abort: async () => undefined,
	subscribe: () => () => undefined,
};

const createSecrets = (): RemoteSecretStore & { readonly map: Map<string, string> } => {
	const map = new Map<string, string>();
	return {
		map,
		get: async (id) => map.get(id),
		put: async (id, secret) => void map.set(id, secret),
		remove: async (id) => void map.delete(id),
	};
};

const setup = async (options: { readonly enabled?: boolean; readonly lanWebRoot?: string } = {}) => {
	let preferences: RemoteAccessPreferences = {
		...EMPTY_REMOTE_ACCESS_PREFERENCES,
		enabled: options.enabled ?? true,
	};
	const relay = new RelayCore();
	const secrets = createSecrets();
	const mailbox = new Map<string, { envelope: RemoteInviteEnvelope; token: string }>();
	const written: RemoteAccessPreferences[] = [];
	const connected: Array<{ deviceId: string; name: string }> = [];
	const service = new RemoteAccessService({
		surface,
		deviceId: "desk-1",
		deviceName: "我的电脑",
		readPreferences: async () => preferences,
		writePreferences: async (update) => {
			preferences = update(preferences);
			written.push(preferences);
			return preferences;
		},
		secrets,
		createTransport: (url, protocols) => {
			const pairingId = /\/v2\/relay\/([^/]+)\//.exec(url)?.[1] ?? "";
			const relaySecret = secrets.map.get(`relay-secret-${pairingId}`) ?? "";
			const hash = protocols.find((entry) => entry.startsWith("wordless.peer."))?.slice("wordless.peer.".length);
			relay.registerRoom(pairingId, relaySecret, hash);
			return relay.connect({
				pairingId,
				role: "desktop",
				pairingSecret: relaySecret,
				...(hash === undefined ? {} : { peerCredentialHash: hash }),
			});
		},
		mailbox: {
			publish: async (boxUrl, token, envelope) => void mailbox.set(boxUrl, { envelope, token }),
			withdraw: async (boxUrl, token) => {
				if (mailbox.get(boxUrl)?.token === token) mailbox.delete(boxUrl);
			},
		},
		defaultRelayBaseUrl: "ws://127.0.0.1:8787",
		onDeviceConnected: (device) => connected.push(device),
		// 局域网那一档:真起一个中继,但地址列表注入 —— 否则用例会跟着这台机器的网卡跑。
		...(options.lanWebRoot === undefined
			? {}
			: {
					lan: {
						resolveWebRoot: () => options.lanWebRoot,
						port: 0,
						// 两个地址:一个用来默认,一个用来验"换网卡"(真实机器上多网卡很常见)。
						listAddresses: () => [
							{ address: "192.168.1.9", name: "en0" },
							{ address: "10.8.0.2", name: "utun3" },
						],
					},
				}),
	});
	return { service, relay, secrets, mailbox, written, connected, preferences: () => preferences };
};

/**
 * 走一次**真实的领取**:连接码 + 密码 → 中继信箱 → 邀请里的密钥 → 手机连上。
 *
 * 抽出来是因为"领取"这件事现在是好几条用例的前提(钉身份、作废邀请、标记已配对、不再复用……)。
 */
const claimFirstDevice = async (rig: Awaited<ReturnType<typeof setup>>) => {
	const state = rig.service.getState();
	const invite = state.invite;
	assert.ok(invite, "要先有邀请");
	const [record] = rig.preferences().devices;
	assert.ok(record);
	const envelope = [...rig.mailbox.values()][0]?.envelope;
	assert.ok(envelope);
	const uri = await openInvite(envelope, invite.code, invite.password);
	const secret = new URL(uri).searchParams.get("secret");
	assert.ok(secret);
	const phone = new RemoteConnection({
		role: "mobile",
		deviceId: "phone-1",
		deviceName: "我的手机",
		capabilities: { chat: true, sessionRead: true },
		identity: identityKeyPairFromSecret(fromBase64Url(secret)),
		handshake: "initiate",
	});
	await phone.connect(rig.relay.connect({ pairingId: record.id, role: "mobile", pairingSecret: secret }));
	await new Promise((resolve) => setImmediate(resolve));
	return { phone, deviceId: record.id };
};

describe("开关与零代价", () => {
	it("没开的时候:不连中继、不生成任何东西", async () => {
		const { service } = await setup({ enabled: false });
		await service.start();
		const state = service.getState();
		assert.equal(state.enabled, false);
		assert.equal(state.connection, "off");
		assert.deepEqual(state.devices, []);
	});

	it("停在中继上等手机时**不报错**(等不到手机不是故障 —— 这正是用户看到过的那条假警报)", async () => {
		const { service, preferences } = await setup();
		await service.start();
		// 先配对一台(留下设备记录),之后再打开开关 —— 这时没有手机会接入。
		await service.createInvite();
		assert.equal(preferences().devices.length, 1);
		await service.setEnabled(false);
		await service.setEnabled(true);
		// 给足时间:以前这里会在握手超时(15 秒)后冒出一句"连不上中继"。
		await new Promise((resolve) => setTimeout(resolve, 120));
		const state = service.getState();
		assert.equal(state.error, undefined, `不该报错,实际:${state.error ?? ""}`);
		assert.equal(state.connection, "connecting");
	});

	it("打开之后才连中继", async () => {
		const { service } = await setup({ enabled: false });
		await service.start();
		assert.equal(service.getState().connection, "off");
		await service.setEnabled(true);
		assert.equal(service.getState().connection, "connecting");
	});

	it("关掉之后链路全部停掉", async () => {
		const { service } = await setup();
		await service.start();
		await service.createInvite();
		assert.equal(service.getState().devices.length, 1);
		await service.setEnabled(false);
		assert.equal(service.getState().connection, "off");
		assert.equal(service.getState().invite, undefined);
	});
});

describe("配对与设备", () => {
	it("生成邀请:留下一条只有哈希的设备记录,并把加密信封放进中继信箱", async () => {
		const { service, mailbox, preferences } = await setup();
		await service.start();
		const state = await service.createInvite();
		const invite = state.invite;
		assert.ok(invite, "应当给出邀请");
		assert.match(invite.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
		assert.equal(invite.status, "ready");
		assert.equal(mailbox.size, 1);
		// 偏好里只有哈希,没有明文密钥。
		const [record] = preferences().devices;
		assert.ok(record);
		assert.match(record.mobileSecretHash, /^[0-9a-f]{64}$/);
		assert.equal(JSON.stringify(preferences()).includes(invite.password), false);
	});

	it("重新生成二维码**不会多出一台设备**(复用还没被领取的那一台)", async () => {
		// 用户想再拿一次二维码时,设备列表里多出一台"永远不会被领取"的设备,看起来就像"我的手机连不上"。
		// 所以这一次运行里创建过、还没人领取的那一台要复用。
		const { service } = await setup();
		await service.start();
		const first = await service.createInvite();
		const second = await service.createInvite();
		assert.equal(service.getState().devices.length, 1, "只应当有一台待配对设备");
		assert.equal(first.devices[0].id, second.devices[0].id);
		// 但邀请本身是新的:旧的连接码必须失效。
		assert.notEqual(first.invite?.code, second.invite?.code);
	});

	it("配对时**记下是哪一档**:界面按它把设备分成「局域网配的」与「远程配的」", async () => {
		// 真实反馈:一张列表里两种设备混在一起,用户分不出哪台是哪台 —— 而它们的行为根本不同。
		const remote = await setup();
		await remote.service.start();
		await remote.service.createInvite();
		assert.equal(remote.service.getState().devices[0]?.mode, "remote");

		// 局域网那一档(起真中继、地址列表注入)。
		const lan = await setup({ lanWebRoot: "/tmp/web-client" });
		await lan.service.setLanMode(true);
		await lan.service.createInvite();
		assert.equal(lan.service.getState().devices[0]?.mode, "lan");
	});

	it("切档之后再生成二维码:**复用的那台要跟着改方式**(否则会被归错组)", async () => {
		// 上一轮生成、还没被领取的二维码,切档之后再点一次生成 —— 那时二维码指向的是**新那一档**的中继,
		// 记录里还写着旧方式就会把它归错组(界面按这个分组)。
		const rig = await setup({ lanWebRoot: "/tmp/web-client" });
		await rig.service.start();
		const first = await rig.service.createInvite();
		assert.equal(rig.service.getState().devices[0]?.mode, "remote", "默认按远程");
		await rig.service.setLanMode(true);
		const second = await rig.service.createInvite();
		// 还是同一台(复用:这次运行里创建、还没人领取),但方式改了。
		assert.equal(second.devices[0]?.id, first.devices[0]?.id);
		assert.equal(second.devices[0]?.mode, "lan");
	});

	it("还没被领取的设备标成未配对,领取之后标成已配对", async () => {
		const rig = await setup();
		await rig.service.start();
		await rig.service.createInvite();
		assert.equal(rig.service.getState().devices[0].paired, false);
		const { phone } = await claimFirstDevice(rig);
		assert.equal(rig.service.getState().devices[0].paired, true);
		await phone.close();
	});

	it("重新生成二维码不会碰已经配对好的那一台,而是新开一台", async () => {
		// 已配对的设备要保住:它的凭据是手机正在用的,不能被一次"重新生成"顶掉。
		const rig = await setup();
		await rig.service.start();
		await rig.service.createInvite();
		const { phone } = await claimFirstDevice(rig);
		const pairedId = rig.service.getState().devices[0].id;
		const next = await rig.service.createInvite();
		assert.equal(next.devices.length, 2, "已配对的那台保留,另外新开一台等新手机");
		assert.equal(next.devices.some((device) => device.id === pairedId), true);
		await phone.close();
	});

	it("重新生成邀请会先撤回上一份(旧的连接码立刻失效)", async () => {
		const { service, mailbox } = await setup();
		await service.start();
		await service.createInvite();
		const first = service.getState().invite?.code;
		await service.createInvite();
		assert.notEqual(service.getState().invite?.code, first);
		// 信箱里只剩新的一份(旧的信箱已被删除,新的一份是另一个名字)。
		assert.equal(mailbox.size, 1);
	});

	it("撤销一台设备:只作废那一台,并清掉它的密钥", async () => {
		// 两台设备现在的来法是:先配好一台,再生成一次二维码(已配对的那台会保留,另开一台等新手机)。
		const rig = await setup();
		await rig.service.start();
		await rig.service.createInvite();
		const { phone } = await claimFirstDevice(rig);
		await rig.service.createInvite();
		const [first, second] = rig.service.getState().devices;
		assert.ok(first && second);
		await rig.service.revokeDevice(first.id);
		const remaining = rig.service.getState().devices;
		assert.deepEqual(remaining.map((device) => device.id), [second.id]);
		assert.equal(rig.secrets.map.has(`relay-secret-${first.id}`), false);
		assert.equal(rig.secrets.map.has(`relay-secret-${second.id}`), true);
		await phone.close();
	});

	it("手机接上之后能给它改名(设备列表里显示谁在用)", async () => {
		const { service } = await setup();
		await service.start();
		await service.createInvite();
		const [device] = service.getState().devices;
		assert.ok(device);
		assert.equal(device.name, "");
		const state = await service.renameDevice(device.id, "我的手机");
		assert.equal(state.devices[0].name, "我的手机");
	});

	it("密钥丢了的时候如实说明要重新配对,而不是拿错密钥硬连", async () => {
		let preferences: RemoteAccessPreferences = {
			enabled: true,
			devices: [{ id: "d1", name: "旧手机", createdAt: 1, mobileSecretHash: sha256Hex("x") }],
		};
		const secrets = createSecrets();
		const service = new RemoteAccessService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			readPreferences: async () => preferences,
			writePreferences: async (update) => {
				preferences = update(preferences);
				return preferences;
			},
			secrets,
			createTransport: () => {
				throw new Error("不该走到这里");
			},
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
			defaultRelayBaseUrl: "ws://127.0.0.1:8787",
		});
		await service.start();
		assert.match(service.getState().error ?? "", /重新配对/);
	});
});

describe("首个领取者绑定身份", () => {
	it("手机接上之后:钉住身份、记下名字、作废邀请,并通知用户", async () => {
		const { service, relay, mailbox, preferences, connected } = await setup();
		await service.start();
		const state = await service.createInvite();
		const invite = state.invite;
		assert.ok(invite);
		const [record] = preferences().devices;
		assert.ok(record);
		// 手机端完全按用户看到的东西来:连接码 + 密码 -> 中继信箱 -> 邀请里的密钥。
		const envelope = [...mailbox.values()][0]?.envelope;
		assert.ok(envelope);
		const uri = await openInvite(envelope, invite.code, invite.password);
		const secret = new URL(uri).searchParams.get("secret");
		assert.ok(secret);

		const phone = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: { chat: true, sessionRead: true },
			identity: identityKeyPairFromSecret(fromBase64Url(secret)),
			handshake: "initiate",
		});
		await phone.connect(relay.connect({ pairingId: record.id, role: "mobile", pairingSecret: secret }));

		const updated = preferences().devices.find((device) => device.id === record.id);
		assert.ok(updated?.mobileIdentityKey, "首个领取者的身份应当被钉住");
		assert.equal(updated?.name, "我的手机", "设备名应当记下来");
		assert.equal(typeof updated?.lastSeenAt, "number");
		assert.equal(service.getState().invite, undefined, "邀请是一次性的:用过即作废");
		assert.equal(mailbox.size, 0, "作废之后中继信箱里不该还留着它");
		assert.deepEqual(connected, [{ deviceId: record.id, name: "我的手机" }], "用户应当被告知有设备接上来了");

		// 同一台手机再连一次:不重复钉身份,但每次接入都会通知(安全相关的事,宁可多看一眼)。
		const again = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: { chat: true, sessionRead: true },
			identity: identityKeyPairFromSecret(fromBase64Url(secret)),
			handshake: "initiate",
		});
		await again.connect(relay.connect({ pairingId: record.id, role: "mobile", pairingSecret: secret }));
		assert.equal(connected.length, 2);
		assert.equal(preferences().devices.find((device) => device.id === record.id)?.mobileIdentityKey, updated?.mobileIdentityKey);

		await phone.close();
		await again.close();
	});
});

describe("中继地址", () => {
	it("完全没有中继地址时不生成邀请,并说明原因", async () => {
		// 连默认中继都没有的构建(例如自建用户还没填地址)。
		const service = new RemoteAccessService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			readPreferences: async () => ({ enabled: true, devices: [] }),
			writePreferences: async (update) => update({ enabled: true, devices: [] }),
			secrets: createSecrets(),
			createTransport: () => {
				throw new Error("不该走到这里");
			},
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
		});
		await service.start();
		const state = await service.createInvite();
		assert.equal(state.invite, undefined);
		assert.match(state.error ?? "", /中继/);
	});

	it("清空自定义地址会回落到默认中继(而不是变成没有中继)", async () => {
		const { service, written } = await setup();
		await service.start();
		await service.setRelayBaseUrl("wss://relay.example");
		assert.equal(service.getState().relayBaseUrl, "wss://relay.example");
		await service.setRelayBaseUrl(undefined);
		assert.equal(service.getState().relayBaseUrl, "ws://127.0.0.1:8787");
		assert.equal(written.at(-1)?.relayBaseUrl, undefined);
	});

	it("设置中继地址会写进偏好", async () => {
		const { service, written } = await setup();
		await service.start();
		await service.setRelayBaseUrl("wss://relay.example");
		assert.equal(service.getState().relayBaseUrl, "wss://relay.example");
		assert.equal(written.at(-1)?.relayBaseUrl, "wss://relay.example");
	});

describe("局域网模式(一键)", () => {
	it("打开:起服务 + 自动填地址 + 开启,而且地址就是**手机要打开的那个**", async () => {
		const root = await mkdtemp(join(tmpdir(), "wordless-lan-"));
		await writeFile(join(root, "index.html"), "<!doctype html>ok");
		const rig = await setup({ enabled: false, lanWebRoot: root });
		const state = await rig.service.setLanMode(true);
		try {
			assert.equal(state.lan?.running, true);
			assert.ok(state.lan?.port, "要有端口");
			// 中继地址 = 局域网地址 + 端口:二维码、网页地址、本机连接三者一致。
			assert.equal(state.relayBaseUrl, `ws://192.168.1.9:${state.lan?.port}`);
			assert.equal(state.lan?.selectedAddress, "192.168.1.9");
			assert.equal(state.enabled, true, "一键 = 起服务 + 开启");
		} finally {
			await rig.service.setLanMode(false);
		}
		assert.equal(rig.service.getState().enabled, false);
	});

	it("没构建网页客户端时**不开启**,并把原因带回来", async () => {
		// 宁可不给:打开了却什么都没发生,比明确说"还没有网页客户端"糟得多。
		const rig = await setup({ enabled: false, lanWebRoot: join(tmpdir(), "wordless-missing-xyz") });
		const state = await rig.service.setLanMode(true);
		assert.equal(state.lan?.running, false);
		assert.equal(state.enabled, false);
		assert.match(state.error ?? "", /网页客户端/);
	});

	it("换一个网卡地址:中继地址跟着换(否则二维码指向的还是旧地址)", async () => {
		const root = await mkdtemp(join(tmpdir(), "wordless-lan-"));
		await writeFile(join(root, "index.html"), "<!doctype html>ok");
		const rig = await setup({ enabled: false, lanWebRoot: root });
		const started = await rig.service.setLanMode(true);
		try {
			const port = started.lan?.port;
			const state = await rig.service.setLanAddress("10.8.0.2");
			assert.equal(state.relayBaseUrl, `ws://10.8.0.2:${port}`);
			assert.equal(state.lan?.selectedAddress, "10.8.0.2");
		} finally {
			await rig.service.setLanMode(false);
		}
	});

	it("地址不在本机网卡列表里:拒绝,而不是写一个连不上的地址", async () => {
		const root = await mkdtemp(join(tmpdir(), "wordless-lan-"));
		await writeFile(join(root, "index.html"), "<!doctype html>ok");
		const rig = await setup({ enabled: false, lanWebRoot: root });
		const started = await rig.service.setLanMode(true);
		try {
			const state = await rig.service.setLanAddress("8.8.8.8");
			assert.equal(state.lan?.selectedAddress, "192.168.1.9", "还是原来那个");
			assert.match(state.error ?? "", /网卡/);
		} finally {
			await rig.service.setLanMode(false);
		}
	});
});

describe("接入方式两档", () => {
	it("切到局域网:当前地址改成局域网地址;切回远程:**原来填的地址还在**", async () => {
		// 只有一个地址字段的话,切一次模式就把用户填的远程地址冲掉了 —— 切回来发现要重填。
		const root = await mkdtemp(join(tmpdir(), "wordless-lan-"));
		await writeFile(join(root, "index.html"), "<!doctype html>ok");
		const rig = await setup({ enabled: false, lanWebRoot: root });
		await rig.service.setRelayBaseUrl("wss://relay.example.com");
		const remote = await rig.service.setMode("remote");
		assert.equal(remote.mode, "remote");
		assert.equal(remote.relayBaseUrl, "wss://relay.example.com");

		const lan = await rig.service.setMode("lan");
		assert.equal(lan.mode, "lan");
		assert.match(lan.relayBaseUrl ?? "", /^ws:\/\/192\.168\.1\.9:\d+$/, "当前地址换成了局域网地址");

		const back = await rig.service.setMode("remote");
		assert.equal(back.relayBaseUrl, "wss://relay.example.com", "用户填的远程地址必须还在");
		// 局域网服务要停掉:留着它会在用户切走之后还占着端口。
		assert.equal(back.lan?.running, false);
	});

	it("局域网起不来时:保留这一档 + 保留原有地址,并说清原因", async () => {
		// 不静默回退:用户要么去修(构建一次网页客户端),要么自己切回远程 —— 而不是发现设置被改了。
		const rig = await setup({ enabled: false, lanWebRoot: join(tmpdir(), "wordless-missing-abc") });
		await rig.service.setRelayBaseUrl("wss://relay.example.com");
		const state = await rig.service.setMode("lan");
		assert.equal(state.mode, "lan");
		assert.equal(state.relayBaseUrl, "wss://relay.example.com", "原有地址不动");
		assert.equal(state.lan?.running, false);
		assert.match(state.error ?? "", /网页客户端/);
	});

	it("老用户(填过远程地址、没存过模式)不会被悄悄切到局域网", async () => {
		const root = await mkdtemp(join(tmpdir(), "wordless-lan-"));
		await writeFile(join(root, "index.html"), "<!doctype html>ok");
		const rig = await setup({ enabled: false, lanWebRoot: root });
		await rig.service.setRelayBaseUrl("wss://relay.example.com");
		assert.equal(rig.service.getState().mode, "remote");
	});
});

describe("切换接入方式时正在握手的链路(真实抱怨的那一次)", () => {
	it("停掉一条**还在握手**的链路:切换要正常返回,不能把整个切换带崩", async () => {
		/**
		 * 现场:`setMode` → `stop()` → `host.stop()` → `connection.close()`,
		 * 而那条链路正好还在握手 —— 握手 promise 被拒绝,`connect()` 还没来得及把它交回调用方,
		 * 于是这次拒绝没有任何人接:未处理的 promise 拒绝刷满主进程日志。
		 */
		const root = await mkdtemp(join(tmpdir(), "wordless-lan-"));
		await writeFile(join(root, "index.html"), "<!doctype html>ok");
		const rig = await setup({ enabled: true, lanWebRoot: root });
		// 先配一台设备(它的链路会一直停在"握手中":对端手机不在)。
		await rig.service.createInvite();
		await claimFirstDevice(rig);
		const before = rig.service.getState();
		assert.equal(before.devices.length, 1, "要有一台设备");
		// 手机在配对流程里连上过;这里只要"这条链路还活着"就够了 —— 关键是在**它还没断**的时候切模式。
		assert.ok(before.connection !== "off", `链路要在活动状态(现在是 ${before.connection})`);

		const rejections: unknown[] = [];
		const onRejection = (reason: unknown) => rejections.push(reason);
		process.on("unhandledRejection", onRejection);
		try {
			const state = await rig.service.setMode("remote");
			await new Promise((resolve) => setTimeout(resolve, 10));
			assert.equal(state.mode, "remote", "档位要真的切过去");
			assert.deepEqual(rejections, [], "不该有未处理的 promise 拒绝");
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});
});

describe("接入方式要**真的落盘**(真实抱怨的那一次)", () => {
	it("用真存储走一遍:切到远程之后,状态与磁盘上都是远程", async () => {
		/**
		 * 这一条是补"假存储比真存储宽容"的洞。
		 *
		 * 之前的用例用一份内存里的偏好对象当存储,它**什么字段都留得住** ——
		 * 而真实的存储层只认它自己那份清单:内存里加了 `mode` 却忘了加进清单,
		 * 写进去就被丢掉,下一次写回来 `current` 里已经没有 `mode` 了,
		 * 于是档位切过去又弹回来(用户看到的"抖动一下然后没反应")。
		 */
		const directory = await mkdtemp(join(tmpdir(), "wordless-remote-store-"));
		const secrets = createSecrets();
		const vault = {
			read: async (id: string) => secrets.map.get(id),
			write: async (id: string, value: string) => void secrets.map.set(id, value),
			delete: async (id: string) => void secrets.map.delete(id),
		};
		const store = createRemoteAccessStore({ userDataPath: directory, vault });
		const service = new RemoteAccessService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			readPreferences: () => store.readPreferences(),
			writePreferences: (update) => store.writePreferences(update),
			secrets: store.secrets,
			createTransport: () => {
				throw new Error("这一条不连中继");
			},
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
		});
		await service.start();
		// 先填一个远程地址(用户做过的那一步),再切档。
		await service.setRelayBaseUrl("wss://relay.example.com");
		const state = await service.setMode("remote");
		assert.equal(state.mode, "remote", "状态里要是远程");
		assert.equal((await store.readPreferences()).mode, "remote", "磁盘上也要是远程");
		assert.equal((await store.readPreferences()).remoteRelayBaseUrl, "wss://relay.example.com");
	});
});
});
