import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	RelayCore,
	RemoteConnection,
	generateIdentityKeyPair,
	openInvite,
	toBase64Url,
	sha256Hex,
	inviteBoxId,
	type RemoteConnectionEvent,
	type RemoteInviteEnvelope,
	type RemoteTransport,
} from "@wordless/remote-control";
import {
	RemoteHostService,
	type RemoteSessionSurface,
	type RemoteSurfaceEvent,
} from "../src/main/remote/host-service.ts";

/**
 * 本机服务(桌面端这一侧)。
 *
 * 这里钉住的是**远端到底能做什么**:只有对话那几件事,其余一律拒绝;以及本机发生的事会不会被推出去。
 * 全部用假会话面 + 内存中继 —— 不需要 Electron、不需要真模型、不需要云账号。
 */

const PAIRING_ID = "pairing-abcdefghijklmnop";
const RELAY_SECRET = "desktop-secret-0123456789abcdefghijklmnop";
const MOBILE_SECRET = "phone-secret-0123456789abcdefghijklmnopqrst";
const CAPABILITIES = { chat: true, sessionRead: true } as const;

interface FakeSurface extends RemoteSessionSurface {
	readonly prompts: Array<{ sessionId: string; text: string }>;
	readonly aborts: string[];
	/** 换模型的结果由用例决定:成功、忙、不可用、真出错。 */
	setModelResult: { readonly ok: true; readonly summary: RemoteSessionSummary } | { readonly ok: false; readonly reason: "not_found" | "busy" | "unavailable" | "failed" };
	readonly modelRequests: Array<{
		sessionId: string;
		connectionId: string;
		modelId: string;
		thinkingLevel?: string;
	}>;
	readonly permissionPatches: Array<Record<string, unknown>>;
	readonly connectorPatches: Array<{ sessionId: string; connectorIds: readonly string[] }>;
	readonly approvalDecisions: Array<Record<string, unknown>>;
	readonly modePatches: Array<Record<string, unknown>>;
	readonly skillIdsByPrompt: Array<readonly string[] | undefined>;
	readonly requestAnswers: Array<Record<string, unknown>>;
	readonly usageReads: string[];
	readonly compacted: string[];
	readonly versionPicks: Array<Record<string, unknown>>;
	readonly expertPicks: Array<Record<string, unknown>>;
	readonly referencePrompts: Array<readonly { readonly path: string; readonly name: string; readonly kind: "file" | "directory" }[]>;
	readonly workspaceSearches: Array<{ readonly sessionId: string; readonly query: string }>;
	/** 搜工作区时本机给回来的那几条(用例自己定)。 */
	workspaceResults: readonly { readonly path: string; readonly name: string; readonly kind: "file" | "directory" }[];
	/** 每一次新建会话交给本机的入参。 */
	readonly createdSessions: Array<Record<string, unknown>>;
	emit(event: RemoteSurfaceEvent): void;
}

const createFakeSurface = (): FakeSurface => {
	const listeners = new Set<(event: RemoteSurfaceEvent) => void>();
	const prompts: Array<{ sessionId: string; text: string }> = [];
	const aborts: string[] = [];
	const modelRequests: Array<{
		sessionId: string;
		connectionId: string;
		modelId: string;
		thinkingLevel?: string;
	}> = [];
	const permissionPatches: Array<Record<string, unknown>> = [];
	const connectorPatches: Array<{ sessionId: string; connectorIds: readonly string[] }> = [];
	const approvalDecisions: Array<Record<string, unknown>> = [];
	const modePatches: Array<Record<string, unknown>> = [];
	const skillIdsByPrompt: Array<readonly string[] | undefined> = [];
	const requestAnswers: Array<Record<string, unknown>> = [];
	const usageReads: string[] = [];
	const attachmentPrompts: Array<
		readonly { readonly name: string; readonly mediaType: string; readonly size: number; readonly base64: string }[]
	> = [];
	/** 每一次发消息带的工作区引用(远端 `@` 挑的那些)。 */
	const referencePrompts: Array<readonly { readonly path: string; readonly name: string; readonly kind: "file" | "directory" }[]> = [];
	/** 每一次工作区搜索:`{ sessionId, query }`。 */
	const workspaceSearches: Array<{ readonly sessionId: string; readonly query: string }> = [];
	const compacted: string[] = [];
	const versionPicks: Array<Record<string, unknown>> = [];
	const expertPicks: Array<Record<string, unknown>> = [];
	const createdSessions: Array<Record<string, unknown>> = [];
	const surface: FakeSurface = {
		prompts,
		aborts,
		createdSessions,
		createSession: async (input) => {
			createdSessions.push(input);
			return { id: "s1", title: "新的", updatedAt: 1, running: false };
		},
		modelRequests,
		permissionPatches,
		connectorPatches,
		approvalDecisions,
		modePatches,
		requestAnswers,
		usageReads,
		sessionUsage: async (sessionId) => {
			usageReads.push(sessionId);
			return {
				chat: {
					modelCalls: 2,
					delegatedCalls: 0,
					inputTokens: 10_000,
					outputTokens: 3_023,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalTokens: 13_023,
					promptTokens: 10_000,
					totalCost: 0.02,
					hitRate: null,
					readObservedCalls: 0,
				},
				unmeasuredCalls: 2,
			};
		},
		attachmentPrompts,
		referencePrompts,
		workspaceSearches,
		workspaceResults: [
			{ path: "src/app.tsx", name: "app.tsx", kind: "file" as const },
			{ path: "src", name: "src", kind: "directory" as const },
		],
		compacted,
		versionPicks,
		expertPicks,
		compact: async (sessionId) => void compacted.push(sessionId),
		selectVersion: async (sessionId, messageId, version) => void versionPicks.push({ sessionId, messageId, version }),
		setExpert: async (sessionId, selection) => void expertPicks.push({ sessionId, selection }),
		resolveUserRequest: async (sessionId, requestId, resolution) => {
			requestAnswers.push({ sessionId, requestId, status: resolution.status, answers: resolution.answers ?? {} });
		},
		skillIdsByPrompt,
		resolveApproval: async (sessionId, approvalId, approved, feedback) => {
			approvalDecisions.push({ sessionId, approvalId, approved, ...(feedback === undefined ? {} : { feedback }) });
		},
		searchWorkspaceFiles: async (sessionId, query) => {
			workspaceSearches.push({ sessionId, query });
			return surface.workspaceResults;
		},
		setMode: async (sessionId, mode) => {
			modePatches.push({ sessionId, mode });
		},
		setPermissions: async (sessionId, patch) => {
			permissionPatches.push({ sessionId, ...patch });
		},
		setConnectors: async (sessionId, connectorIds) => {
			connectorPatches.push({ sessionId, connectorIds: [...connectorIds] });
		},
		setModelResult: { ok: true, summary: { id: "s1", title: "第一个会话", updatedAt: 2, running: false, modelId: "gpt-5", modelName: "GPT-5" } },
		setModel: async (sessionId, model, thinkingLevel) => {
			modelRequests.push({ sessionId, ...model, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) });
			return surface.setModelResult;
		},
		emit: (event) => {
			for (const listener of listeners) listener(event);
		},
		listSessions: async () => [{ id: "s1", title: "第一个会话", updatedAt: 1, running: false }],
		openSession: async (sessionId) =>
			sessionId === "s1"
				? {
						summary: { id: "s1", title: "第一个会话", updatedAt: 1, running: false },
						messages: [{ role: "user" as const, text: "你好", at: 1 }],
						models: [{ connectionId: "openai", modelId: "gpt-5", displayName: "GPT-5" }],
					}
				: undefined,
		historyPage: async () => ({ messages: [{ role: "assistant" as const, text: "在", at: 2 }] }),
		prompt: async (sessionId, text, skillIds, attachments, references) => {
			prompts.push({ sessionId, text });
			skillIdsByPrompt.push(skillIds);
			attachmentPrompts.push(attachments === undefined ? [] : [...attachments]);
			referencePrompts.push(references === undefined ? [] : [...references]);
		},
		abort: async (sessionId) => {
			aborts.push(sessionId);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return surface;
};

interface Rig {
	readonly relay: RelayCore;
	readonly host: RemoteHostService;
	readonly phone: RemoteConnection;
	readonly phoneEvents: RemoteConnectionEvent[];
	readonly surface: FakeSurface;
	readonly mailbox: Map<string, { envelope: RemoteInviteEnvelope; token: string }>;
}

const connect = async (options: { readonly now?: () => number } = {}): Promise<Rig> => {
	const relay = new RelayCore();
	relay.registerRoom(PAIRING_ID, RELAY_SECRET, sha256Hex(MOBILE_SECRET));
	const surface = createFakeSurface();
	const mailbox = new Map<string, { envelope: RemoteInviteEnvelope; token: string }>();
	const hostIdentity = generateIdentityKeyPair();
	const phoneIdentity = generateIdentityKeyPair();

	const host = new RemoteHostService({
		surface,
		deviceId: "desk-1",
		deviceName: "我的电脑",
		identity: hostIdentity,
		pairingId: PAIRING_ID,
		relaySecret: RELAY_SECRET,
		mobileSecretHash: sha256Hex(MOBILE_SECRET),
		mobileSecret: MOBILE_SECRET,
		relayBaseUrl: "ws://127.0.0.1:8787",
		...(options.now === undefined ? {} : { now: options.now }),
		createTransport: (_url, protocols): RemoteTransport => {
			// 直接接内存中继:协议与真实中继完全一致,只是不经过 socket。
			assert.ok(protocols.includes(`wordless.peer.${sha256Hex(MOBILE_SECRET)}`), "桌面端必须声明手机密钥哈希");
			return relay.connect({
				pairingId: PAIRING_ID,
				role: "desktop",
				pairingSecret: RELAY_SECRET,
				peerCredentialHash: sha256Hex(MOBILE_SECRET),
			});
		},
		mailbox: {
			publish: async (boxUrl, token, envelope) => {
				mailbox.set(boxUrl, { envelope, token });
			},
			withdraw: async (boxUrl, token) => {
				const stored = mailbox.get(boxUrl);
				if (stored?.token === token) mailbox.delete(boxUrl);
			},
		},
	});

	const phone = new RemoteConnection({
		role: "mobile",
		deviceId: "phone-1",
		deviceName: "我的手机",
		capabilities: CAPABILITIES,
		identity: phoneIdentity,
		handshake: "initiate",
		expectedPeerIdentityKey: hostIdentity.publicKey,
	});
	const phoneEvents: RemoteConnectionEvent[] = [];
	phone.onEvent((event) => phoneEvents.push(event));

	// 桌面端会停在等手机;所以两端并发连接。
	const hostReady = host.start();
	const phoneReady = phone.connect(
		relay.connect({ pairingId: PAIRING_ID, role: "mobile", pairingSecret: MOBILE_SECRET }),
	);
	await Promise.all([hostReady, phoneReady]);
	return { relay, host, phone, phoneEvents, surface, mailbox };
};

const settle = async (rounds = 6): Promise<void> => {
	for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

const payloadOf = async (phone: RemoteConnection, method: Parameters<RemoteConnection["sendRequest"]>[0], options = {}) => {
	const result = await phone.sendRequest(method, options);
	assert.equal(result.success, true, JSON.stringify(result.error));
	return result.payload as never;
};

describe("远端能做什么", () => {
	it("列出会话", async () => {
		const { phone } = await connect();
		const payload = (await payloadOf(phone, "session.list")) as { sessions: Array<{ id: string; title: string }> };
		assert.deepEqual(payload.sessions, [{ id: "s1", title: "第一个会话", updatedAt: 1, running: false }]);
	});

	it("打开会话能看到消息", async () => {
		const { phone } = await connect();
		const payload = (await payloadOf(phone, "session.open", { sessionId: "s1" })) as {
			summary: { id: string };
			messages: Array<{ text: string }>;
		};
		assert.equal(payload.summary.id, "s1");
		assert.deepEqual(payload.messages.map((message) => message.text), ["你好"]);
	});

	it("发消息会落到本机", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.prompt", { sessionId: "s1", payload: { text: "帮我看看这个" } });
		assert.deepEqual(surface.prompts, [{ sessionId: "s1", text: "帮我看看这个" }]);
	});

	it("中断会落到本机", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.abort", { sessionId: "s1" });
		assert.deepEqual(surface.aborts, ["s1"]);
	});

	it("会话不存在时给 not_found,而不是假装成功", async () => {
		const { phone } = await connect();
		const result = await phone.sendRequest("session.open", { sessionId: "不存在" });
		assert.equal(result.success, false);
		assert.equal(result.error?.code, "not_found");
	});

	it("缺 sessionId 或没有正文时明确报错", async () => {
		const { phone } = await connect();
		const noSession = await phone.sendRequest("session.prompt", { payload: { text: "你好" } });
		assert.equal(noSession.error?.code, "invalid_frame");
		const noText = await phone.sendRequest("session.prompt", { sessionId: "s1", payload: { text: "   " } });
		assert.equal(noText.error?.code, "invalid_frame");
	});

	it("诊断快照只给连接元数据,不含会话内容与凭据", async () => {
		const { phone } = await connect();
		const payload = await payloadOf(phone, "diagnostics.snapshot");
		const serialized = JSON.stringify(payload);
		assert.match(serialized, /"state":"online"/);
		assert.equal(serialized.includes("你好"), false);
		assert.equal(serialized.includes(MOBILE_SECRET), false);
		assert.equal(serialized.includes(RELAY_SECRET), false);
	});

	it("设备状态如实回答", async () => {
		const { phone } = await connect();
		const payload = (await payloadOf(phone, "device.status")) as { deviceId: string; online: boolean };
		assert.equal(payload.deviceId, "desk-1");
		assert.equal(payload.online, true);
	});
});

describe("本机的事会被推给远端", () => {
	const eventsOf = (list: readonly RemoteConnectionEvent[], name: string) =>
		list.flatMap((event) => (event.type === "remote-event" && event.event.name === name ? [event.event] : []));

	it("消息、工具、状态都会推出去,序号连续", async () => {
		const { phone, phoneEvents, surface } = await connect();
		surface.emit({ type: "message", sessionId: "s1", message: { role: "assistant", text: "好的", at: 3 } });
		surface.emit({ type: "tool", sessionId: "s1", name: "bash", state: "done", detail: "ls" });
		surface.emit({ type: "state", sessionId: "s1", running: true });
		await settle();
		assert.deepEqual(
			phoneEvents.flatMap((event) => (event.type === "remote-event" ? [event.event.sequence] : [])),
			[1, 2, 3, 4], // 第 1 条是 device.paired(手机刚上线时发的)
		);
		assert.deepEqual(
			eventsOf(phoneEvents, "session.message").map((event) => (event.payload as { text: string }).text),
			["好的"],
		);
		assert.deepEqual(eventsOf(phoneEvents, "session.tool").map((event) => (event.payload as { name: string }).name), ["bash"]);
		assert.deepEqual(
			eventsOf(phoneEvents, "session.tool").map((event) => (event.payload as { state: string }).state),
			["done"],
		);
		assert.deepEqual(
			eventsOf(phoneEvents, "session.state").map((event) => (event.payload as { running: boolean }).running),
			[true],
		);
	});

	it("手机上线时本机发出 device.paired(界面据此提示有人接入)", async () => {
		const { phoneEvents } = await connect();
		await settle();
		assert.equal(eventsOf(phoneEvents, "device.paired").length, 1);
	});

	it("会话列表变化也会通知远端", async () => {
		const { phoneEvents, surface } = await connect();
		surface.emit({ type: "sessions-changed" });
		await settle();
		assert.equal(eventsOf(phoneEvents, "session.list").length, 1);
	});
});

describe("身份绑定", () => {
	it("钉住身份之后,换了一把身份密钥的来者会被拒(中继之外的第二道)", async () => {
		const relay = new RelayCore();
		relay.registerRoom(PAIRING_ID, RELAY_SECRET, sha256Hex(MOBILE_SECRET));
		const surface = createFakeSurface();
		const hostIdentity = generateIdentityKeyPair();
		// 桌面端钉住的是"真手机"的身份,而这次连上来的是另一把密钥 —— 相当于中继被换掉/被攻破。
		const realPhone = generateIdentityKeyPair();
		const host = new RemoteHostService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			identity: hostIdentity,
			pairingId: PAIRING_ID,
			relaySecret: RELAY_SECRET,
			mobileSecretHash: sha256Hex(MOBILE_SECRET),
			mobileSecret: MOBILE_SECRET,
			relayBaseUrl: "ws://127.0.0.1:8787",
			expectedPeerIdentityKey: realPhone.publicKey,
			createTransport: () =>
				relay.connect({
					pairingId: PAIRING_ID,
					role: "desktop",
					pairingSecret: RELAY_SECRET,
					peerCredentialHash: sha256Hex(MOBILE_SECRET),
				}),
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
		});
		const impostor = new RemoteConnection({
			role: "mobile",
			deviceId: "impostor",
			deviceName: "陌生设备",
			capabilities: CAPABILITIES,
			identity: generateIdentityKeyPair(),
			handshake: "initiate",
			requestTimeoutMs: 300,
		});
		void host.start().catch(() => undefined);
		await impostor.connect(relay.connect({ pairingId: PAIRING_ID, role: "mobile", pairingSecret: MOBILE_SECRET })).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.notEqual(host.state, "online");
	});

	it("接入回调带出身份与名字,并且只在真的接上时触发", async () => {
		const relay = new RelayCore();
		relay.registerRoom(PAIRING_ID, RELAY_SECRET, sha256Hex(MOBILE_SECRET));
		const surface = createFakeSurface();
		const hostIdentity = generateIdentityKeyPair();
		const connected: Array<{ identityKey: string; deviceName?: string }> = [];
		const host = new RemoteHostService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			identity: hostIdentity,
			pairingId: PAIRING_ID,
			relaySecret: RELAY_SECRET,
			mobileSecretHash: sha256Hex(MOBILE_SECRET),
			mobileSecret: MOBILE_SECRET,
			relayBaseUrl: "ws://127.0.0.1:8787",
			onDeviceConnected: (device) => connected.push(device),
			createTransport: () =>
				relay.connect({
					pairingId: PAIRING_ID,
					role: "desktop",
					pairingSecret: RELAY_SECRET,
					peerCredentialHash: sha256Hex(MOBILE_SECRET),
				}),
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
		});
		const phoneIdentity = generateIdentityKeyPair();
		const phone = new RemoteConnection({
			role: "mobile",
			deviceId: "phone-1",
			deviceName: "我的手机",
			capabilities: CAPABILITIES,
			identity: phoneIdentity,
			handshake: "initiate",
			expectedPeerIdentityKey: hostIdentity.publicKey,
		});
		const hostReady = host.start();
		const phoneReady = phone.connect(relay.connect({ pairingId: PAIRING_ID, role: "mobile", pairingSecret: MOBILE_SECRET }));
		await Promise.all([hostReady, phoneReady]);
		assert.equal(connected.length, 1);
		// 身份就是手机的公钥 —— 服务据此把它钉进设备记录。
		assert.equal(connected[0]?.identityKey, toBase64Url(phoneIdentity.publicKey));
		assert.equal(connected[0]?.deviceName, "我的手机");
	});

	it("没接上时不触发接入回调", async () => {
		const relay = new RelayCore();
		relay.registerRoom(PAIRING_ID, RELAY_SECRET, sha256Hex(MOBILE_SECRET));
		const connected: unknown[] = [];
		const host = new RemoteHostService({
			surface: createFakeSurface(),
			deviceId: "desk-1",
			deviceName: "我的电脑",
			identity: generateIdentityKeyPair(),
			pairingId: PAIRING_ID,
			relaySecret: RELAY_SECRET,
			mobileSecretHash: sha256Hex(MOBILE_SECRET),
			mobileSecret: MOBILE_SECRET,
			relayBaseUrl: "ws://127.0.0.1:8787",
			onDeviceConnected: (device) => connected.push(device),
			createTransport: () =>
				relay.connect({
					pairingId: PAIRING_ID,
					role: "desktop",
					pairingSecret: RELAY_SECRET,
					peerCredentialHash: sha256Hex(MOBILE_SECRET),
				}),
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
		});
		void host.start().catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.deepEqual(connected, []);
	});
});

describe("配对材料", () => {
	it("生成连接码与密码,并把加密信封放进中继信箱", async () => {
		const { host, mailbox } = await connect();
		const invite = await host.createInvite();
		assert.match(invite.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
		assert.match(invite.password, /^\d{6}$/);
		assert.equal(invite.formattedCode, `${invite.code.slice(0, 4)}-${invite.code.slice(4)}`);
		// 二维码是**网页地址**(手机相机能直接打开),而不是自定义协议。
		assert.equal(invite.qrText, `http://127.0.0.1:8787/#/PAIR/${invite.code}/${invite.password}`);
		// 信箱里只有一份加密信封:中继看不到连接码、密码与配对信息。
		assert.equal(mailbox.size, 1);
		const [entry] = [...mailbox.values()];
		const serialized = JSON.stringify(entry.envelope);
		assert.equal(serialized.includes(invite.code), false);
		assert.equal(serialized.includes(invite.password), false);
		// 手机凭连接码 + 密码能解出同一份配对信息。
		const uri = await openInvite(entry.envelope, invite.code, invite.password);
		assert.match(uri, /^wordless:\/\/pair\?v=2&pairingId=/);
		assert.equal(uri.includes(PAIRING_ID), true);
		// 邀请里带着手机自己的长期密钥 —— 手机拿到它才有资格进中继(中继只认它的哈希)。
		assert.equal(uri.includes(`secret=${MOBILE_SECRET}`), true);
	});

	it("信箱名是连接码的哈希", async () => {
		const { host, mailbox } = await connect();
		const invite = await host.createInvite();
		const expected = `http://127.0.0.1:8787/v2/invite/${inviteBoxId(invite.code)}`;
		assert.deepEqual([...mailbox.keys()], [expected]);
	});

	it("撤回之后信箱里不再有它", async () => {
		const { host, mailbox } = await connect();
		await host.createInvite();
		assert.equal(mailbox.size, 1);
		await host.withdrawInvite();
		assert.equal(mailbox.size, 0);
	});

	it("邀请自带过期时间(默认 10 分钟)", async () => {
		const now = 1_000;
		const { host } = await connect({ now: () => now });
		const invite = await host.createInvite();
		assert.equal(invite.expiresAt, now + 10 * 60_000);
	});

describe("远端换模型 + 思考等级(P18)", () => {
	it("思考等级会跟着模型一起传下去", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.model", {
			sessionId: "s1",
			payload: { connectionId: "openai", modelId: "gpt-5", thinkingLevel: "high" },
		});
		assert.deepEqual(surface.modelRequests, [
			{ sessionId: "s1", connectionId: "openai", modelId: "gpt-5", thinkingLevel: "high" },
		]);
	});

	it("认不出来的档位当作**没指定**(让运行时按模型夹一次),而不是把请求整条拒掉", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.model", {
			sessionId: "s1",
			payload: { connectionId: "openai", modelId: "gpt-5", thinkingLevel: "ultra" },
		});
		// 透到运行时的档位必须是空的:透一个它不认识的值过去,它会直接抛,而用户看到的是失败。
		assert.deepEqual(surface.modelRequests, [{ sessionId: "s1", connectionId: "openai", modelId: "gpt-5" }]);
	});
});

describe("远端换模型(b 档)", () => {
	it("换成功:回给远端**本机现在的**状态,并把这次选择传给本机", async () => {
		const { phone, surface } = await connect();
		const payload = (await payloadOf(phone, "session.model", {
			sessionId: "s1",
			payload: { connectionId: "openai", modelId: "gpt-5" },
		})) as { summary: { modelId?: string; modelName?: string } };
		assert.deepEqual(surface.modelRequests, [{ sessionId: "s1", connectionId: "openai", modelId: "gpt-5" }]);
		assert.equal(payload.summary.modelId, "gpt-5");
		assert.equal(payload.summary.modelName, "GPT-5");
	});

	it("正在回复中:告诉用户等它说完,而不是含糊的未知错误", async () => {
		const { phone, surface } = await connect();
		surface.setModelResult = { ok: false, reason: "busy" };
		const result = await phone.sendRequest("session.model", {
			sessionId: "s1",
			payload: { connectionId: "openai", modelId: "gpt-5" },
		});
		assert.equal(result.success, false);
		assert.equal(result.error?.code, "busy");
		assert.equal(result.error?.retryable, false);
	});

	it("模型用不了:说清楚是模型的问题", async () => {
		const { phone, surface } = await connect();
		surface.setModelResult = { ok: false, reason: "unavailable" };
		const result = await phone.sendRequest("session.model", {
			sessionId: "s1",
			payload: { connectionId: "openai", modelId: "gpt-5" },
		});
		assert.equal(result.error?.code, "model_unavailable");
	});

	it("本机真出错:标成可以重试,而不是赖到模型头上", async () => {
		const { phone, surface } = await connect();
		surface.setModelResult = { ok: false, reason: "failed" };
		const result = await phone.sendRequest("session.model", {
			sessionId: "s1",
			payload: { connectionId: "openai", modelId: "gpt-5" },
		});
		assert.equal(result.error?.code, "internal_error");
		assert.equal(result.error?.retryable, true);
	});

	it("选择不完整(缺 modelId):当帧错误拒掉,不落到本机", async () => {
		const { phone, surface } = await connect();
		const result = await phone.sendRequest("session.model", { sessionId: "s1", payload: { connectionId: "openai" } });
		assert.equal(result.error?.code, "invalid_frame");
		assert.deepEqual(surface.modelRequests, []);
	});

	it("手机靠清单知道能不能换模型(能力声明这个方向手机看不到)", async () => {
		// 经中继时两端都是主动连,`hello` 不被转发,`hello_ack` 也不带 capabilities ——
		// 所以"本机允许远端做什么"只能靠**清单本身有没有发出来**来判断。
		const { phone } = await connect();
		const opened = (await payloadOf(phone, "session.open", { sessionId: "s1" })) as { models?: unknown };
		assert.equal(Array.isArray(opened.models), true);
	});
});

describe("上下文用量(P4)", () => {
	const usage = { usedTokens: 24_000, contextWindow: 200_000, source: "estimate" as const };

	it("用量更新会推到手机,而且**不夹带**运行状态", async () => {
		const { phone, phoneEvents, surface } = await connect();
		surface.emit({ type: "context", sessionId: "s1", context: usage });
		await settle();
		const events = phoneEvents.flatMap((event) => (event.type === "remote-event" ? [event.event] : []));
		const state = events.find((event) => event.name === "session.state");
		assert.ok(state, "应当收到一条 session.state");
		assert.deepEqual(state.payload, { context: usage }, "只带用量:夹带 running 会让手机上的状态闪一下");
		assert.equal(phone.getSnapshot().state, "online");
	});

	it("运行状态与用量是两条独立的事", async () => {
		const { phoneEvents, surface } = await connect();
		surface.emit({ type: "state", sessionId: "s1", running: true });
		surface.emit({ type: "context", sessionId: "s1", context: usage });
		await settle();
		const payloads = phoneEvents
			.flatMap((event) => (event.type === "remote-event" ? [event.event] : []))
			.filter((event) => event.name === "session.state")
			.map((event) => event.payload);
		assert.deepEqual(payloads, [{ running: true }, { context: usage }]);
	});
});

describe("流式文字(P7)", () => {
	it("正在写的帧会推到手机,而且带的是累积文本", async () => {
		const { phone, phoneEvents, surface } = await connect();
		surface.emit({ type: "delta", sessionId: "s1", messageId: "m1", role: "assistant", text: "" });
		surface.emit({ type: "delta", sessionId: "s1", messageId: "m1", role: "assistant", text: "你好" });
		await settle();
		const deltas = phoneEvents
			.flatMap((event) => (event.type === "remote-event" ? [event.event] : []))
			.filter((event) => event.name === "session.message.delta")
			.map((event) => event.payload);
		assert.deepEqual(deltas, [
			{ messageId: "m1", role: "assistant", text: "" },
			{ messageId: "m1", role: "assistant", text: "你好" },
		]);
		assert.equal(phone.getSnapshot().state, "online");
	});
});

describe("远端改权限与连接器(P8)", () => {
	it("改工具确认:本机收到,并把**回读后的**摘要给远端", async () => {
		const { phone, surface } = await connect();
		const payload = (await payloadOf(phone, "session.permissions", {
			sessionId: "s1",
			payload: { toolApprovalMode: "bypass" },
		})) as { summary?: { id?: string } };
		assert.deepEqual(surface.permissionPatches, [{ sessionId: "s1", toolApprovalMode: "bypass" }]);
		assert.equal(payload.summary?.id, "s1");
	});

	it("认不出来的取值不发下去(猜错等于替用户放宽了权限)", async () => {
		const { phone, surface } = await connect();
		const result = await phone.sendRequest("session.permissions", {
			sessionId: "s1",
			payload: { toolApprovalMode: "whatever" },
		});
		assert.equal(result.error?.code, "invalid_frame");
		assert.deepEqual(surface.permissionPatches, []);
	});

	it("两个字段可以一起给", async () => {
		const { phone, surface } = await connect();
		await phone.sendRequest("session.permissions", {
			sessionId: "s1",
			payload: { accessLevel: "full", toolApprovalMode: "auto" },
		});
		assert.deepEqual(surface.permissionPatches, [
			{ sessionId: "s1", accessLevel: "full", toolApprovalMode: "auto" },
		]);
	});

	it("改连接器:空数组是合法值(意思是这个会话不用连接器)", async () => {
		const { phone, surface } = await connect();
		await phone.sendRequest("session.connectors", { sessionId: "s1", payload: { connectorIds: [] } });
		assert.deepEqual(surface.connectorPatches, [{ sessionId: "s1", connectorIds: [] }]);
	});

	it("连接器列表不是数组时当帧错误拒掉", async () => {
		const { phone, surface } = await connect();
		const result = await phone.sendRequest("session.connectors", { sessionId: "s1", payload: { connectorIds: "k1" } });
		assert.equal(result.error?.code, "invalid_frame");
		assert.deepEqual(surface.connectorPatches, []);
	});
});

describe("审批、模式、技能(P9)", () => {
	it("有工具等批准时:推一条 session.approval 给手机", async () => {
		const { phoneEvents, surface } = await connect();
		surface.emit({
			type: "approval",
			sessionId: "s1",
			approvalId: "a1",
			toolName: "bash",
			summary: "删除构建目录",
			args: "rm -rf build",
			severity: "high",
		});
		await settle();
		const approval = phoneEvents
			.flatMap((event) => (event.type === "remote-event" ? [event.event] : []))
			.find((event) => event.name === "session.approval");
		assert.deepEqual(approval?.payload, {
			approvalId: "a1",
			toolName: "bash",
			summary: "删除构建目录",
			args: "rm -rf build",
			severity: "high",
		});
	});

	it("手机批准:本机收到那个 approvalId 与决定", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.approval", {
			sessionId: "s1",
			payload: { approvalId: "a1", approved: true },
		});
		assert.deepEqual(surface.approvalDecisions, [{ sessionId: "s1", approvalId: "a1", approved: true }]);
	});

	it("拒绝也走得通(而且不带 feedback 时不硬塞一个空串)", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.approval", { sessionId: "s1", payload: { approvalId: "a2", approved: false } });
		assert.deepEqual(surface.approvalDecisions, [{ sessionId: "s1", approvalId: "a2", approved: false }]);
	});

	it("决定不完整(缺 approved)时当帧错误拒掉", async () => {
		const { phone, surface } = await connect();
		const result = await phone.sendRequest("session.approval", { sessionId: "s1", payload: { approvalId: "a1" } });
		assert.equal(result.error?.code, "invalid_frame");
		assert.deepEqual(surface.approvalDecisions, []);
	});

	it("改模式:三档都认,别的拒掉", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.mode", { sessionId: "s1", payload: { mode: "plan" } });
		assert.deepEqual(surface.modePatches, [{ sessionId: "s1", mode: "plan" }]);
		const bad = await phone.sendRequest("session.mode", { sessionId: "s1", payload: { mode: "whatever" } });
		assert.equal(bad.error?.code, "invalid_frame");
	});

	it("发一轮时把技能带下去", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.prompt", { sessionId: "s1", payload: { text: "写一份", skillIds: ["s1"] } });
		assert.deepEqual(surface.skillIdsByPrompt, [["s1"]]);
	});
});

describe("提问(P9.1)", () => {
	it("有提问时推给手机", async () => {
		const { phoneEvents, surface } = await connect();
		surface.emit({
			type: "user-request",
			sessionId: "s1",
			request: { requestId: "r1", title: "选一下", fields: [{ type: "text", id: "f1", label: "补充" }] },
		});
		await settle();
		const pushed = phoneEvents
			.flatMap((event) => (event.type === "remote-event" ? [event.event] : []))
			.find((event) => event.name === "session.user-request");
		assert.equal((pushed?.payload as { request?: { requestId?: string } })?.request?.requestId, "r1");
	});

	it("提交答案:本机收到答案", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.user-request", {
			sessionId: "s1",
			payload: { requestId: "r1", status: "submitted", answers: { f1: "用 TypeScript", f2: ["a"], f3: true } },
		});
		assert.deepEqual(surface.requestAnswers, [
			{ sessionId: "s1", requestId: "r1", status: "submitted", answers: { f1: "用 TypeScript", f2: ["a"], f3: true } },
		]);
	});

	it("取消也走得通", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.user-request", { sessionId: "s1", payload: { requestId: "r1", status: "cancelled" } });
		assert.deepEqual(surface.requestAnswers, [{ sessionId: "s1", requestId: "r1", status: "cancelled", answers: {} }]);
	});

	it("答案里混进别的形状时**丢掉那一项**,而不是整条拒绝", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.user-request", {
			sessionId: "s1",
			payload: { requestId: "r1", status: "submitted", answers: { ok: "好", bad: { nested: true }, list: ["a", 1] } },
		});
		assert.deepEqual(surface.requestAnswers, [{ sessionId: "s1", requestId: "r1", status: "submitted", answers: { ok: "好" } }]);
	});
});

describe("压缩、版本、专家团(P10)", () => {
	it("压缩:本机收到", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.compact", { sessionId: "s1" });
		assert.deepEqual(surface.compacted, ["s1"]);
	});

	it("切版本:把消息 id 与第几版传下去", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.version", { sessionId: "s1", payload: { messageId: "m1", version: 2 } });
		assert.deepEqual(surface.versionPicks, [{ sessionId: "s1", messageId: "m1", version: 2 }]);
	});

	it("版本号必须是正整数(0 与小数都拒掉)", async () => {
		const { phone, surface } = await connect();
		for (const version of [0, 1.5, "2"]) {
			const result = await phone.sendRequest("session.version", { sessionId: "s1", payload: { messageId: "m1", version } });
			assert.equal(result.error?.code, "invalid_frame");
		}
		assert.deepEqual(surface.versionPicks, []);
	});

	it("选专家 / 取消专家:null 是合法值", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.expert", { sessionId: "s1", payload: { selection: { kind: "team", id: "t1", version: "1" } } });
		await payloadOf(phone, "session.expert", { sessionId: "s1", payload: { selection: null } });
		assert.deepEqual(surface.expertPicks, [
			{ sessionId: "s1", selection: { kind: "team", id: "t1", version: "1" } },
			{ sessionId: "s1", selection: null },
		]);
	});

	it("专家选择形状不对时拒掉(猜错等于替用户换了一个团队)", async () => {
		const { phone, surface } = await connect();
		const result = await phone.sendRequest("session.expert", { sessionId: "s1", payload: { selection: { kind: "whatever", id: "x" } } });
		assert.equal(result.error?.code, "invalid_frame");
		assert.deepEqual(surface.expertPicks, []);
	});
});

describe("附件上传(P11)", () => {
	/** 把一段内容按本机给的 chunkBytes 切成片发过去。 */
	const upload = async (phone: Awaited<ReturnType<typeof connect>>["phone"], name: string, content: string) => {
		const uploadId = `u-${name}`;
		const begin = (await payloadOf(phone, "session.attachment", {
			payload: { phase: "begin", uploadId, name, mediaType: "text/plain", size: Buffer.byteLength(content) },
		})) as { chunkBytes?: number };
		const chunkBytes = begin.chunkBytes ?? 0;
		const buffer = Buffer.from(content, "utf8");
		const total = Math.max(1, Math.ceil(buffer.byteLength / chunkBytes));
		for (let index = 0; index < total; index += 1) {
			await payloadOf(phone, "session.attachment", {
				payload: {
					phase: "chunk",
					uploadId,
					index,
					base64: buffer.subarray(index * chunkBytes, (index + 1) * chunkBytes).toString("base64"),
				},
			});
		}
		return uploadId;
	};

	it("分片传完之后:发消息时把它交给本机(base64,原样)", async () => {
		const { phone, surface } = await connect();
		const uploadId = await upload(phone, "note.txt", "这是一段附件内容");
		await payloadOf(phone, "session.prompt", {
			sessionId: "s1",
			payload: { text: "看这个", attachments: [{ uploadId }] },
		});
		const attachments = surface.attachmentPrompts.at(-1) ?? [];
		assert.equal(attachments.length, 1);
		assert.equal(attachments[0]?.name, "note.txt");
		assert.equal(Buffer.from(attachments[0]?.base64 ?? "", "base64").toString("utf8"), "这是一段附件内容");
		assert.equal(attachments[0]?.size, Buffer.byteLength("这是一段附件内容"));
	});

	it("传一半就发:拒掉,而不是悄悄少发一个文件", async () => {
		const { phone } = await connect();
		await payloadOf(phone, "session.attachment", {
			payload: { phase: "begin", uploadId: "u1", name: "half.txt", mediaType: "text/plain", size: 100 },
		});
		const result = await phone.sendRequest("session.prompt", {
			sessionId: "s1",
			payload: { text: "看这个", attachments: [{ uploadId: "u1" }] },
		});
		assert.equal(result.error?.code, "not_found");
	});

	it("类型不对在 begin 就拦下来(不用等传完)", async () => {
		const { phone } = await connect();
		const result = await phone.sendRequest("session.attachment", {
			payload: { phase: "begin", uploadId: "u1", name: "tool.exe", mediaType: "application/octet-stream", size: 10 },
		});
		assert.equal(result.success, false);
		assert.match(result.error?.message ?? "", /exe/);
	});

	it("超过上限也在 begin 拦下来", async () => {
		const { phone } = await connect();
		const result = await phone.sendRequest("session.attachment", {
			payload: { phase: "begin", uploadId: "u1", name: "big.png", mediaType: "image/png", size: 9 * 1024 * 1024 },
		});
		assert.equal(result.success, false);
		assert.match(result.error?.message ?? "", /8MB/);
	});

	it("abort 之后那个 id 就不认了", async () => {
		const { phone } = await connect();
		await payloadOf(phone, "session.attachment", {
			payload: { phase: "begin", uploadId: "u1", name: "a.txt", mediaType: "text/plain", size: 4 },
		});
		await payloadOf(phone, "session.attachment", { payload: { phase: "abort", uploadId: "u1" } });
		const result = await phone.sendRequest("session.prompt", {
			sessionId: "s1",
			payload: { text: "x", attachments: [{ uploadId: "u1" }] },
		});
		assert.equal(result.error?.code, "not_found");
	});

	it("多出来的字节说明对端算错了:整条作废", async () => {
		const { phone } = await connect();
		await payloadOf(phone, "session.attachment", {
			payload: { phase: "begin", uploadId: "u1", name: "a.txt", mediaType: "text/plain", size: 4 },
		});
		const result = await phone.sendRequest("session.attachment", {
			payload: { phase: "chunk", uploadId: "u1", index: 0, base64: Buffer.from("太长太长太长").toString("base64") },
		});
		assert.equal(result.success, false);
	});
});

describe("会话统计(P14)", () => {
	it("读会话总计:交给手机", async () => {
		const { phone, surface } = await connect();
		const payload = (await payloadOf(phone, "session.usage", { sessionId: "s1" })) as {
			chat?: { totalTokens?: number };
			unmeasuredCalls?: number;
		};
		assert.equal(payload.chat?.totalTokens, 13_023);
		assert.equal(payload.unmeasuredCalls, 2);
		assert.ok(surface.usageReads.includes("s1"));
	});
});

describe("新建会话时选目录与设计风格(P31)", () => {
	it("工作目录与设计风格**原样交给本机**(认不出来的值当没给,由会话面判断该不该要)", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.create", {
			payload: {
				entryId: "code-development",
				text: "看一下这个仓库",
				workspaceId: "w1",
				designStyleId: "precise-dark",
			},
		});
		assert.deepEqual(surface.createdSessions.at(-1), {
			entryId: "code-development",
			text: "看一下这个仓库",
			workspaceId: "w1",
			designStyleId: "precise-dark",
		});
	});

	it("没给就不带(而不是塞一个空串 —— 那会被当成「给了一个空目录」)", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.create", { payload: { entryId: "general-work", text: "你好" } });
		assert.deepEqual(surface.createdSessions.at(-1), { entryId: "general-work", text: "你好" });
	});
});

describe("`@` 搜工作区文件(P28)", () => {
	it("查什么、在哪个会话里查:原样交给本机", async () => {
		const { phone, surface } = await connect();
		const payload = (await payloadOf(phone, "session.workspace-files", {
			sessionId: "s1",
			payload: { query: "app" },
		})) as { entries?: readonly unknown[] };
		assert.deepEqual(surface.workspaceSearches, [{ sessionId: "s1", query: "app" }]);
		// 只发三样:相对路径、显示名、是不是目录(体积与修改时间不发)。
		assert.deepEqual(payload.entries, [
			{ path: "src/app.tsx", name: "app.tsx", kind: "file" },
			{ path: "src", name: "src", kind: "directory" },
		]);
	});

	it("空查询是合法值:刚敲下 @ 就该有东西出来", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.workspace-files", { sessionId: "s1", payload: { query: "" } });
		assert.deepEqual(surface.workspaceSearches, [{ sessionId: "s1", query: "" }]);
	});

	it("查询串不是字符串:拒掉", async () => {
		const { phone, surface } = await connect();
		const result = await phone.sendRequest("session.workspace-files", { sessionId: "s1", payload: { query: 42 } });
		assert.equal(result.error?.code, "invalid_frame");
		assert.deepEqual(surface.workspaceSearches, []);
	});

	it("没有 sessionId:拒掉(搜索必须知道「在哪个工作区里」)", async () => {
		const { phone } = await connect();
		const result = await phone.sendRequest("session.workspace-files", { payload: { query: "app" } });
		assert.equal(result.error?.code, "invalid_frame");
	});

	it("超长的查询串被截断(单帧可以到 1.5M 字符,不能整条塞给搜索)", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.workspace-files", { sessionId: "s1", payload: { query: "x".repeat(5_000) } });
		assert.equal(surface.workspaceSearches[0]?.query.length, 200);
	});

	it("条数封顶:本机给再多也不超过 50", async () => {
		const { phone, surface } = await connect();
		surface.workspaceResults = Array.from({ length: 80 }, (_value, index) => ({
			path: `src/f${index}.ts`,
			name: `f${index}.ts`,
			kind: "file" as const,
		}));
		const payload = (await payloadOf(phone, "session.workspace-files", {
			sessionId: "s1",
			payload: { query: "f" },
		})) as { entries?: readonly unknown[] };
		assert.equal(payload.entries?.length, 50);
	});

	it("引用随消息一起交给本机(形状原样)", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.prompt", {
			sessionId: "s1",
			payload: {
				text: "看一下这个",
				references: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }],
			},
		});
		assert.deepEqual(surface.referencePrompts.at(-1), [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }]);
	});

	it("只有引用、没有正文:能发(挑一个文件就是在问「这个怎么了」)", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.prompt", {
			sessionId: "s1",
			payload: { text: "", references: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }] },
		});
		assert.deepEqual(surface.referencePrompts.at(-1), [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }]);
		assert.equal(surface.prompts.at(-1)?.text, "");
	});

	it("正文、引用、附件**三者都空**:仍然拒掉(那是调用方搞错了,不是用户在说话)", async () => {
		const { phone, surface } = await connect();
		const result = await phone.sendRequest("session.prompt", { sessionId: "s1", payload: { text: "   " } });
		assert.equal(result.error?.code, "invalid_frame");
		assert.deepEqual(surface.prompts, []);
	});

	it("正文根本不是字符串:拒掉", async () => {
		const { phone } = await connect();
		const result = await phone.sendRequest("session.prompt", {
			sessionId: "s1",
			payload: { text: 42, references: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }] },
		});
		assert.equal(result.error?.code, "invalid_frame");
	});

	it("不发引用时是空数组(而不是 undefined:调用方少写一个分支)", async () => {
		const { phone, surface } = await connect();
		await payloadOf(phone, "session.prompt", { sessionId: "s1", payload: { text: "你好" } });
		assert.deepEqual(surface.referencePrompts.at(-1), []);
	});

	it("引用形状不对:整条拒掉,而不是丢掉那一条继续发", async () => {
		const { phone, surface } = await connect();
		for (const references of [
			[{ path: "src/app.tsx", name: "app.tsx", kind: "symlink" }],
			[{ path: "", name: "app.tsx", kind: "file" }],
			[{ path: "src/app.tsx", kind: "file" }],
			[{ path: "x".repeat(600), name: "app.tsx", kind: "file" }],
			"src/app.tsx",
		]) {
			const result = await phone.sendRequest("session.prompt", {
				sessionId: "s1",
				payload: { text: "看一下这个", references },
			});
			assert.equal(result.error?.code, "invalid_frame");
		}
		// 超过上限单独一句**人话**(它和"形状不对"不是一回事,而用户要能照着做)。
		const tooMany = await phone.sendRequest("session.prompt", {
			sessionId: "s1",
			payload: {
				text: "看一下这些",
				references: Array.from({ length: 21 }, (_value, index) => ({ path: `f${index}.ts`, name: `f${index}.ts`, kind: "file" })),
			},
		});
		assert.match(tooMany.error?.message ?? "", /最多带 20 个文件引用/);
		// 一条都没发出去 —— 半个引用比一次明确的失败糟得多。
		assert.deepEqual(surface.referencePrompts, []);
	});
});

describe("现在在做什么(P16)", () => {
	it("工具事件带着状态文字(顶部那行据此说话)", async () => {
		const { phoneEvents, surface } = await connect();
		surface.emit({ type: "tool", sessionId: "s1", name: "bash", state: "running", activity: "正在执行命令" });
		await settle();
		const tool = phoneEvents
			.flatMap((event) => (event.type === "remote-event" ? [event.event] : []))
			.find((event) => event.name === "session.tool");
		assert.equal((tool?.payload as { activity?: string })?.activity, "正在执行命令");
	});

	it("运行状态带着状态文字;结束时是空字符串", async () => {
		const { phoneEvents, surface } = await connect();
		surface.emit({ type: "state", sessionId: "s1", running: true, activity: "思考中" });
		surface.emit({ type: "state", sessionId: "s1", running: false, activity: "" });
		await settle();
		const payloads = phoneEvents
			.flatMap((event) => (event.type === "remote-event" ? [event.event] : []))
			.filter((event) => event.name === "session.state")
			.map((event) => event.payload);
		assert.deepEqual(payloads, [
			{ running: true, activity: "思考中" },
			{ running: false, activity: "" },
		]);
	});
});
});
