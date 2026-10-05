import {
	KEEPALIVE_PING,
	KEEPALIVE_PONG,
	REMOTE_PROTOCOL_VERSION,
	REMOTE_WEBSOCKET_PROTOCOL,
	type RemoteAck,
	type RemoteCapabilities,
	type RemoteError,
	type RemoteErrorCode,
	type RemoteEvent,
	type RemoteEventName,
	type RemoteFrame,
	type RemoteHandshakeFrame,
	type RemoteHello,
	type RemoteHelloAck,
	type RemotePairingPending,
	type RemotePeerStatus,
	type RemoteRequest,
	type RemoteRequestMethod,
	type RemoteResponse,
	type RemoteResume,
	type RemoteSealed,
	type RemoteSessionFrame,
} from "./types.ts";

/**
 * 边界校验。
 *
 * 这一层存在的理由只有一个:**非法的东西必须在门口被拒绝,而不是被下游当成正常帧处理**。
 * 所以它做严格校验(版本、角色、帧类型、id 形状、序号类型、方法/事件白名单),并且对长度设上限。
 *
 * 与 `crypto.ts` 的分工:本文件不导入加密,加密导入本文件的错误类型 —— 避免循环依赖。
 */

/** 单帧最大长度。密封帧会有几倍膨胀,所以给得宽,但**必须**有上限。 */
export const MAX_REMOTE_FRAME_CHARS = 1_500_000;

const MAX_ID_CHARS = 128;
const MAX_REQUEST_ID_CHARS = 64;
/** XChaCha20-Poly1305 的 nonce 长度。**字节数**,不是 base64url 之后的字符数。 */
const SEALED_NONCE_BYTES = 24;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const REQUEST_METHODS: readonly RemoteRequestMethod[] = [
	"device.status",
	"session.list",
	"session.open",
	"session.history",
	"session.prompt",
	"session.abort",
	// b 档:远端可以换模型(只能换,不能改权限模式 —— 那是 c 档)。
	"session.model",
	"session.retry-turn",
	"session.permissions",
	"session.connectors",
	"session.mode",
	"session.approval",
	"session.user-request",
	"session.compact",
	"session.usage",
	"session.version",
	"session.expert",
	"session.attachment",
	"session.workspace-files",
	"session.resync",
	"diagnostics.snapshot",
	// 新建会话:先取一份"能用的东西"(工作类型 / 连接器 / 技能),再把第一条消息和入口一起发过去
	// (与桌面端 WelcomeView 同一个流程)。
	"catalog.list",
	"session.create",
];

const EVENT_NAMES: readonly RemoteEventName[] = [
	"device.status",
	"device.paired",
	"device.revoked",
	"session.list",
	"session.state",
	"session.message",
	"session.message.delta",
	"session.approval",
	"session.user-request",
	"session.tool",
	"session.input",
	"session.resync",
	"diagnostics.updated",
];

const ERROR_CODES: readonly RemoteErrorCode[] = [
	"invalid_frame",
	"unsupported_version",
	"unauthorized",
	"approval_rejected",
	"not_found",
	"busy",
	"model_unavailable",
	"payload_too_large",
	"request_timeout",
	"transport_closed",
	"internal_error",
];

export class RemoteProtocolError extends Error {
	readonly code: RemoteErrorCode;

	constructor(message: string, code: RemoteErrorCode = "invalid_frame") {
		super(message);
		this.name = "RemoteProtocolError";
		this.code = code;
	}
}

export function encodeRemoteFrame(frame: RemoteFrame): string {
	return JSON.stringify(frame);
}

/**
 * 解析并校验一帧。任何不合规都抛 `RemoteProtocolError` —— 调用方(中继或端点)应当据此关闭链路,
 * 而不是"尽量理解"。
 */
export function parseRemoteFrame(text: string): RemoteFrame {
	if (typeof text !== "string" || text.length === 0) throw new RemoteProtocolError("frame must be a non-empty string");
	if (text.length > MAX_REMOTE_FRAME_CHARS) throw new RemoteProtocolError("frame is too large");
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new RemoteProtocolError("frame is not valid JSON");
	}
	return decodeRemoteFrame(value);
}

export function decodeRemoteFrame(value: unknown): RemoteFrame {
	const record = asRecord(value, "frame");
	const type = readString(record.type, "frame.type");
	switch (type) {
		case "hello":
			return decodeHello(record);
		case "hello_ack":
			return decodeHelloAck(record);
		case "pairing_pending":
			return decodePairingPending(record);
		case "peer_status":
			return decodePeerStatus(record);
		case "sealed":
			return decodeSealed(record);
		default:
			return decodeSessionFrame(value);
	}
}

/** 解密之后的载荷仍要过一遍校验:加密保证来源,校验保证内容。 */
export function decodeSessionFrame(value: unknown): RemoteSessionFrame {
	const record = asRecord(value, "session frame");
	const type = readString(record.type, "session frame.type");
	switch (type) {
		case "request":
			return decodeRequest(record);
		case "response":
			return decodeResponse(record);
		case "event":
			return decodeEvent(record);
		case "ack":
			return decodeAck(record);
		case "resume":
			return decodeResume(record);
		default:
			throw new RemoteProtocolError(`unknown frame type: ${type}`);
	}
}

export function isHandshakeFrame(frame: RemoteFrame): frame is RemoteHandshakeFrame {
	return (
		frame.type === "hello" ||
		frame.type === "hello_ack" ||
		frame.type === "pairing_pending" ||
		frame.type === "peer_status"
	);
}

export function isSessionFrame(frame: RemoteFrame): frame is RemoteSessionFrame {
	return (
		frame.type === "request" ||
		frame.type === "response" ||
		frame.type === "event" ||
		frame.type === "ack" ||
		frame.type === "resume"
	);
}

export function isKeepalive(text: string): boolean {
	return text === KEEPALIVE_PING || text === KEEPALIVE_PONG;
}

/**
 * 子协议:配对密钥走这里而**不走 URL**,所以代理、日志、浏览器历史里都只有 pairingId。
 * 桌面端额外声明手机密钥的哈希,中继据此只知道"该房间绑的是哪把密钥",拿不到密钥本身。
 */
export function buildPairingProtocols(input: {
	readonly pairingSecret: string;
	readonly peerCredentialHash?: string;
}): string[] {
	const protocols = [REMOTE_WEBSOCKET_PROTOCOL, `wordless.pairing.${input.pairingSecret}`];
	if (input.peerCredentialHash !== undefined) protocols.push(`wordless.peer.${input.peerCredentialHash}`);
	return protocols;
}

export interface OfferedProtocols {
	readonly protocolVersion?: string;
	readonly pairingSecret?: string;
	readonly peerCredentialHash?: string;
	readonly all: readonly string[];
}

export function parseOfferedProtocols(header: string | null | undefined): OfferedProtocols {
	const all = (header ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	const result: { protocolVersion?: string; pairingSecret?: string; peerCredentialHash?: string } = {};
	for (const protocol of all) {
		if (protocol.startsWith("wordless.pairing.")) result.pairingSecret = protocol.slice("wordless.pairing.".length);
		else if (protocol.startsWith("wordless.peer.")) result.peerCredentialHash = protocol.slice("wordless.peer.".length);
		else if (protocol === REMOTE_WEBSOCKET_PROTOCOL) result.protocolVersion = protocol;
	}
	return { ...result, all };
}

function decodeHello(record: Record<string, unknown>): RemoteHello {
	assertVersion(record.protocolVersion);
	const role = readString(record.role, "hello.role");
	if (role !== "mobile" && role !== "desktop") throw new RemoteProtocolError(`hello.role must be mobile or desktop`);
	return {
		type: "hello",
		protocolVersion: REMOTE_PROTOCOL_VERSION,
		role,
		deviceId: readId(record.deviceId, "hello.deviceId"),
		deviceName: readId(record.deviceName, "hello.deviceName"),
		capabilities: readCapabilities(record.capabilities),
		connectionId: readId(record.connectionId, "hello.connectionId"),
		identityKey: readPublicKey(record.identityKey, "hello.identityKey"),
		ephemeralKey: readPublicKey(record.ephemeralKey, "hello.ephemeralKey"),
	};
}

function decodeHelloAck(record: Record<string, unknown>): RemoteHelloAck {
	assertVersion(record.protocolVersion);
	const peerDeviceName = readOptionalId(record.peerDeviceName, "hello_ack.peerDeviceName");
	return {
		type: "hello_ack",
		protocolVersion: REMOTE_PROTOCOL_VERSION,
		connectionId: readId(record.connectionId, "hello_ack.connectionId"),
		peerDeviceId: readId(record.peerDeviceId, "hello_ack.peerDeviceId"),
		...(peerDeviceName === undefined ? {} : { peerDeviceName }),
		peerIdentityKey: readPublicKey(record.peerIdentityKey, "hello_ack.peerIdentityKey"),
		peerEphemeralKey: readPublicKey(record.peerEphemeralKey, "hello_ack.peerEphemeralKey"),
	};
}

function decodePairingPending(record: Record<string, unknown>): RemotePairingPending {
	return {
		type: "pairing_pending",
		connectionId: readId(record.connectionId, "pairing_pending.connectionId"),
		peerDeviceId: readId(record.peerDeviceId, "pairing_pending.peerDeviceId"),
		peerIdentityKey: readPublicKey(record.peerIdentityKey, "pairing_pending.peerIdentityKey"),
	};
}

function decodePeerStatus(record: Record<string, unknown>): RemotePeerStatus {
	if (typeof record.online !== "boolean") throw new RemoteProtocolError("peer_status.online must be a boolean");
	return { type: "peer_status", online: record.online };
}

function decodeSealed(record: Record<string, unknown>): RemoteSealed {
	return {
		type: "sealed",
		nonce: readBase64Url(record.nonce, "sealed.nonce", SEALED_NONCE_BYTES),
		ciphertext: readBase64Url(record.ciphertext, "sealed.ciphertext"),
	};
}

function decodeRequest(record: Record<string, unknown>): RemoteRequest {
	const method = readString(record.method, "request.method") as RemoteRequestMethod;
	if (!REQUEST_METHODS.includes(method)) throw new RemoteProtocolError(`unknown request method: ${method}`);
	const requestId = readId(record.requestId, "request.requestId", MAX_REQUEST_ID_CHARS);
	const sessionId = readOptionalId(record.sessionId, "request.sessionId");
	return {
		type: "request",
		requestId,
		method,
		...(sessionId === undefined ? {} : { sessionId }),
		...(record.payload === undefined ? {} : { payload: record.payload }),
	};
}

function decodeResponse(record: Record<string, unknown>): RemoteResponse {
	const requestId = readId(record.requestId, "response.requestId", MAX_REQUEST_ID_CHARS);
	if (typeof record.success !== "boolean") throw new RemoteProtocolError("response.success must be a boolean");
	const error = record.error === undefined ? undefined : decodeError(record.error);
	if (!record.success && error === undefined) throw new RemoteProtocolError("a failed response must carry an error");
	return {
		type: "response",
		requestId,
		success: record.success,
		...(record.payload === undefined ? {} : { payload: record.payload }),
		...(error === undefined ? {} : { error }),
	};
}

function decodeEvent(record: Record<string, unknown>): RemoteEvent {
	const name = readString(record.name, "event.name") as RemoteEventName;
	if (!EVENT_NAMES.includes(name)) throw new RemoteProtocolError(`unknown event name: ${name}`);
	const sequence = readSequence(record.sequence, "event.sequence");
	if (sequence < 1) throw new RemoteProtocolError("event.sequence must be at least 1");
	const sessionId = readOptionalId(record.sessionId, "event.sessionId");
	return {
		type: "event",
		eventId: readId(record.eventId, "event.eventId"),
		sequence,
		name,
		...(sessionId === undefined ? {} : { sessionId }),
		...(record.payload === undefined ? {} : { payload: record.payload }),
	};
}

function decodeAck(record: Record<string, unknown>): RemoteAck {
	return { type: "ack", sequence: readSequence(record.sequence, "ack.sequence") };
}

function decodeResume(record: Record<string, unknown>): RemoteResume {
	return { type: "resume", lastEventSequence: readSequence(record.lastEventSequence, "resume.lastEventSequence") };
}

export function decodeError(value: unknown): RemoteError {
	const record = asRecord(value, "error");
	const code = readString(record.code, "error.code") as RemoteErrorCode;
	if (!ERROR_CODES.includes(code)) throw new RemoteProtocolError(`unknown error code: ${code}`);
	if (typeof record.retryable !== "boolean") throw new RemoteProtocolError("error.retryable must be a boolean");
	return { code, message: readString(record.message, "error.message"), retryable: record.retryable };
}

function assertVersion(value: unknown): void {
	if (value === undefined) throw new RemoteProtocolError("frame is missing protocolVersion");
	if (value !== REMOTE_PROTOCOL_VERSION) {
		throw new RemoteProtocolError(`unsupported protocol version: ${String(value)}`, "unsupported_version");
	}
}

function readCapabilities(value: unknown): RemoteCapabilities {
	const record = asRecord(value, "hello.capabilities");
	if (typeof record.chat !== "boolean" || typeof record.sessionRead !== "boolean") {
		throw new RemoteProtocolError("hello.capabilities must declare chat and sessionRead booleans");
	}
	return { chat: record.chat, sessionRead: record.sessionRead };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RemoteProtocolError(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) throw new RemoteProtocolError(`${field} must be a non-empty string`);
	return value;
}

function readId(value: unknown, field: string, max = MAX_ID_CHARS): string {
	const text = readString(value, field);
	if (text.length > max) throw new RemoteProtocolError(`${field} is too long`);
	return text;
}

function readOptionalId(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	return readId(value, field);
}

function readSequence(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new RemoteProtocolError(`${field} must be a non-negative integer`);
	}
	return value;
}

/** base64url 无填充。`byteLength` 给定时同时校验长度(公钥 32 字节、nonce 24 字节)。 */
function readBase64Url(value: unknown, field: string, byteLength?: number): string {
	const text = readString(value, field);
	if (!BASE64URL_PATTERN.test(text)) throw new RemoteProtocolError(`${field} must be base64url`);
	if (byteLength !== undefined && text.length !== expectedBase64UrlLength(byteLength)) {
		throw new RemoteProtocolError(`${field} must encode ${byteLength} bytes`);
	}
	return text;
}

function readPublicKey(value: unknown, field: string): string {
	return readBase64Url(value, field, 32);
}

export function expectedBase64UrlLength(byteLength: number): number {
	return Math.ceil((byteLength * 4) / 3);
}
