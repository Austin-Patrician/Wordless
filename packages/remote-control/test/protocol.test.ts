import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	MAX_REMOTE_FRAME_CHARS,
	RemoteProtocolError,
	buildPairingProtocols,
	decodeRemoteFrame,
	decodeSessionFrame,
	encodeRemoteFrame,
	isHandshakeFrame,
	isKeepalive,
	isSessionFrame,
	parseOfferedProtocols,
	parseRemoteFrame,
} from "../src/protocol.ts";
import { toBase64Url } from "../src/crypto.ts";
import { REMOTE_THINKING_LEVELS, isRemoteThinkingLevel } from "../src/types.ts";
import { KEEPALIVE_PING, KEEPALIVE_PONG, REMOTE_PROTOCOL_VERSION, type RemoteFrame } from "../src/types.ts";

/**
 * 边界校验。
 *
 * 这一层的价值全在"拒绝"上:任何不合规的帧都必须在门口被拒,而不是被下游当正常帧处理。
 * 所以这里的用例大多是**应当失败**的输入。
 */

const key = toBase64Url(new Uint8Array(32).fill(7));
const nonce = toBase64Url(new Uint8Array(24).fill(9));
const ciphertext = toBase64Url(new Uint8Array(48).fill(3));

const hello = {
	type: "hello",
	protocolVersion: REMOTE_PROTOCOL_VERSION,
	role: "mobile",
	deviceId: "phone-1",
	deviceName: "我的手机",
	capabilities: { chat: true, sessionRead: true },
	connectionId: "conn-1",
	identityKey: key,
	ephemeralKey: key,
} as const;

const sealed = { type: "sealed", nonce, ciphertext } as const;

const roundtrip = (frame: RemoteFrame) => parseRemoteFrame(encodeRemoteFrame(frame));

describe("握手帧", () => {
	it("hello 原样往返", () => {
		assert.deepEqual(roundtrip(hello), hello);
	});

	it("角色只能是 mobile 或 desktop", () => {
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...hello, role: "relay" })), RemoteProtocolError);
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...hello, role: "phone" })), RemoteProtocolError);
	});

	it("版本不对时给出 unsupported_version(而不是当成非法帧)", () => {
		const error = (() => {
			try {
				parseRemoteFrame(JSON.stringify({ ...hello, protocolVersion: 1 }));
				return undefined;
			} catch (caught) {
				return caught as RemoteProtocolError;
			}
		})();
		assert.equal(error?.code, "unsupported_version");
	});

	it("缺 protocolVersion 也拒绝", () => {
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...hello, protocolVersion: undefined })), RemoteProtocolError);
	});

	it("能力必须显式声明两项布尔值", () => {
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...hello, capabilities: { chat: true } })), RemoteProtocolError);
		assert.throws(
			() => parseRemoteFrame(JSON.stringify({ ...hello, capabilities: { chat: "yes", sessionRead: true } })),
			RemoteProtocolError,
		);
	});

	it("公钥必须正好 32 字节的 base64url", () => {
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...hello, identityKey: "短" })), RemoteProtocolError);
		assert.throws(
			() => parseRemoteFrame(JSON.stringify({ ...hello, ephemeralKey: toBase64Url(new Uint8Array(31)) })),
			RemoteProtocolError,
		);
	});

	it("hello_ack 与 pairing_pending 也校验公钥", () => {
		const ack = {
			type: "hello_ack",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			connectionId: "conn-1",
			peerDeviceId: "desktop-1",
			peerIdentityKey: key,
			peerEphemeralKey: key,
		};
		assert.deepEqual(roundtrip(ack), ack);
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...ack, peerIdentityKey: "x" })), RemoteProtocolError);
	});

	it("peer_status 必须是布尔", () => {
		assert.deepEqual(roundtrip({ type: "peer_status", online: false }), { type: "peer_status", online: false });
		assert.throws(() => parseRemoteFrame(JSON.stringify({ type: "peer_status", online: "no" })), RemoteProtocolError);
	});
});

describe("密封帧", () => {
	it("原样往返", () => {
		assert.deepEqual(roundtrip(sealed), sealed);
	});

	it("nonce 必须正好 24 字节", () => {
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...sealed, nonce: toBase64Url(new Uint8Array(12)) })), RemoteProtocolError);
	});

	it("密文不能是空串,也不能带非 base64url 字符", () => {
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...sealed, ciphertext: "" })), RemoteProtocolError);
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...sealed, ciphertext: "abc=def" })), RemoteProtocolError);
	});
});

describe("会话帧", () => {
	it("请求只认白名单里的方法", () => {
		assert.deepEqual(roundtrip({ type: "request", requestId: "r1", method: "session.list" }), {
			type: "request",
			requestId: "r1",
			method: "session.list",
		});
		assert.throws(
			() => parseRemoteFrame(JSON.stringify({ type: "request", requestId: "r1", method: "file.read" })),
			RemoteProtocolError,
		);
	});

	it("请求必须带 requestId(否则响应无法关联)", () => {
		assert.throws(() => parseRemoteFrame(JSON.stringify({ type: "request", requestId: "", method: "session.list" })), RemoteProtocolError);
	});

	it("失败响应必须带错误对象", () => {
		assert.throws(
			() => parseRemoteFrame(JSON.stringify({ type: "response", requestId: "r1", success: false })),
			RemoteProtocolError,
		);
		assert.deepEqual(
			roundtrip({
				type: "response",
				requestId: "r1",
				success: false,
				error: { code: "busy", message: "正在忙", retryable: true },
			}),
			{
				type: "response",
				requestId: "r1",
				success: false,
				error: { code: "busy", message: "正在忙", retryable: true },
			},
		);
	});

	it("错误码只认白名单", () => {
		assert.throws(
			() =>
				parseRemoteFrame(
					JSON.stringify({
						type: "response",
						requestId: "r1",
						success: false,
						error: { code: "whatever", message: "x", retryable: false },
					}),
				),
			RemoteProtocolError,
		);
	});

	it("事件序号必须是从 1 开始的整数", () => {
		const event = { type: "event", eventId: "e1", sequence: 1, name: "session.message" };
		assert.deepEqual(roundtrip(event), event);
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...event, sequence: 0 })), RemoteProtocolError);
		assert.throws(() => parseRemoteFrame(JSON.stringify({ ...event, sequence: 1.5 })), RemoteProtocolError);
	});

	it("事件名只认白名单", () => {
		assert.throws(
			() => parseRemoteFrame(JSON.stringify({ type: "event", eventId: "e1", sequence: 1, name: "session.screen" })),
			RemoteProtocolError,
		);
	});

	it("ack 与 resume 的序号可以是从 0 开始的整数", () => {
		assert.deepEqual(roundtrip({ type: "ack", sequence: 0 }), { type: "ack", sequence: 0 });
		assert.deepEqual(roundtrip({ type: "resume", lastEventSequence: 12 }), { type: "resume", lastEventSequence: 12 });
	});
});

describe("整体拒绝", () => {
	it("不是 JSON、不是对象、类型未知都拒绝", () => {
		assert.throws(() => parseRemoteFrame("{"), RemoteProtocolError);
		assert.throws(() => parseRemoteFrame("[]"), RemoteProtocolError);
		assert.throws(() => parseRemoteFrame(JSON.stringify({ type: "nope" })), RemoteProtocolError);
		assert.throws(() => parseRemoteFrame(""), RemoteProtocolError);
	});

	it("超过长度上限的帧拒绝", () => {
		const huge = JSON.stringify({ type: "request", requestId: "r", method: "session.list", payload: "x".repeat(MAX_REMOTE_FRAME_CHARS) });
		assert.throws(() => parseRemoteFrame(huge), RemoteProtocolError);
	});

	it("解密后的载荷也要过同一套校验", () => {
		assert.throws(() => decodeSessionFrame({ type: "request", requestId: "r", method: "session.nope" }), RemoteProtocolError);
		assert.equal(isSessionFrame({ type: "ack", sequence: 1 }), true);
		assert.equal(isHandshakeFrame({ type: "peer_status", online: true }), true);
		assert.equal(isSessionFrame({ type: "sealed", nonce, ciphertext }), false);
	});

	it("心跳是独立于帧的裸文本", () => {
		assert.equal(isKeepalive(KEEPALIVE_PING), true);
		assert.equal(isKeepalive(KEEPALIVE_PONG), true);
		assert.equal(isKeepalive(JSON.stringify(sealed)), false);
		assert.throws(() => parseRemoteFrame(KEEPALIVE_PING), RemoteProtocolError);
	});
});

describe("子协议(配对密钥的载体)", () => {
	it("密钥进子协议,不进 URL", () => {
		const protocols = buildPairingProtocols({ pairingSecret: "secret-value", peerCredentialHash: "a".repeat(64) });
		assert.deepEqual(protocols, [
			"wordless.remote.v2",
			"wordless.pairing.secret-value",
			"wordless.peer." + "a".repeat(64),
		]);
	});

	it("手机端不带 peer 哈希", () => {
		assert.deepEqual(buildPairingProtocols({ pairingSecret: "s" }), ["wordless.remote.v2", "wordless.pairing.s"]);
	});

	it("解析回来能拿到密钥与哈希", () => {
		const offered = parseOfferedProtocols("wordless.remote.v2, wordless.pairing.abc, wordless.peer." + "b".repeat(64));
		assert.equal(offered.protocolVersion, "wordless.remote.v2");
		assert.equal(offered.pairingSecret, "abc");
		assert.equal(offered.peerCredentialHash, "b".repeat(64));
	});

	it("没有配对密钥时解析结果里没有它", () => {
		assert.equal(parseOfferedProtocols("wordless.remote.v2").pairingSecret, undefined);
		assert.equal(parseOfferedProtocols(null).pairingSecret, undefined);
	});

	it("认得出 session.model,并照旧拒绝白名单外的方法", () => {
		const request = { type: "request", requestId: "r1", method: "session.model", sessionId: "s1", payload: { connectionId: "c1", modelId: "m1" } };
		const decoded = decodeRemoteFrame(request);
		assert.equal(decoded.type, "request");
		assert.throws(
			() => decodeRemoteFrame({ ...request, method: "session.set-access-level" }),
			/unknown request method/,
		);
	});

describe("事件名白名单", () => {
	/**
	 * 类型联合与运行时白名单是**两个地方**。改了一个忘了另一个,症状是"发得出去、收不到" ——
	 * 排查起来极费劲(踩过两次:一次是错误码,一次是事件名)。
	 * 这里把每一个事件名都真的解一遍:漏了谁,它就过不了。
	 */
	const NAMES = [
		"device.status",
		"device.paired",
		"device.revoked",
		"session.list",
		"session.state",
		"session.message",
		"session.message.delta",
		"session.approval",
		"session.tool",
		"session.input",
		"session.resync",
		"diagnostics.updated",
	] as const;

	for (const name of NAMES) {
		it(`认得出 ${name}`, () => {
			const decoded = decodeRemoteFrame({ type: "event", eventId: "e1", sequence: 1, name, sessionId: "s1" });
			assert.equal(decoded.type, "event");
			assert.equal(decoded.type === "event" ? decoded.name : undefined, name);
		});
	}

	it("白名单外的名字照旧被拒", () => {
		assert.throws(
			() => decodeRemoteFrame({ type: "event", eventId: "e1", sequence: 1, name: "session.whatever" }),
			/unknown event name/,
		);
	});
});

describe("请求方法白名单", () => {
	/**
	 * 与方法名同理:**类型联合与运行时白名单是两个地方**。
	 * 这次加 `session.retry-turn` 时又把两个都改了,但下次不一定记得 —— 所以逐个解一遍。
	 */
	const METHODS = [
		"device.status",
		"session.list",
		"session.open",
		"session.history",
		"session.prompt",
		"session.abort",
		"session.model",
		"session.retry-turn",
		"session.permissions",
		"session.connectors",
		"session.mode",
		"session.approval",
		"session.compact",
		"session.version",
		"session.expert",
		"session.attachment",
		"session.usage",
		"session.version",
		"session.expert",
		"session.user-request",
		"catalog.list",
		"session.create",
		"session.workspace-files",
		"session.resync",
		"diagnostics.snapshot",
	] as const;

	for (const method of METHODS) {
		it(`认得出 ${method}`, () => {
			const decoded = decodeRemoteFrame({ type: "request", requestId: "r1", method, sessionId: "s1" });
			assert.equal(decoded.type, "request");
			assert.equal(decoded.type === "request" ? decoded.method : undefined, method);
		});
	}
});

describe("思考等级的值域(P18)", () => {
	it("认得出七档,认不出别的", () => {
		for (const level of REMOTE_THINKING_LEVELS) assert.equal(isRemoteThinkingLevel(level), true);
		for (const value of ["", "OFF", "ultra", 1, null, undefined, {}])
			assert.equal(isRemoteThinkingLevel(value), false);
	});

	it("值域与桌面端一致(两边不一致就会出现\"手机上选了、电脑上拒绝\")", () => {
		assert.deepEqual([...REMOTE_THINKING_LEVELS], ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
	});
});
});
