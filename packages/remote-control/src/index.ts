/**
 * `@wordless/remote-control` 的公开面。
 *
 * 分三块:**协议与加密**(谁都要用)、**连接**(端点用)、**配对材料**(桌面端与手机端用),
 * 外加两个**测试替身**(假传输、假中继) —— 它们不是"测试专用代码",而是"在没有真手机、没有云账号时
 * 也能把协议测通"这个要求的实现。
 */

export * from "./types.ts";
export * from "./attachments.ts";
export {
	MAX_REMOTE_FRAME_CHARS,
	RemoteProtocolError,
	buildPairingProtocols,
	decodeError,
	decodeRemoteFrame,
	decodeSessionFrame,
	encodeRemoteFrame,
	isHandshakeFrame,
	isKeepalive,
	isSessionFrame,
	parseOfferedProtocols,
	parseRemoteFrame,
} from "./protocol.ts";
export {
	SESSION_ASSOCIATED_DATA,
	bytesEqual,
	decodePublicKey,
	defaultRandomBytes,
	deriveSessionKeys,
	fromBase64Url,
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	openFrame,
	randomToken,
	sealFrame,
	sha256Hex,
	toBase64Url,
	verificationCode,
	type DeriveSessionKeysInput,
	type RemoteRandomBytes,
	type RemoteSessionKeys,
} from "./crypto.ts";
export { RemoteEventJournal, type RemoteEventJournalOptions } from "./event-journal.ts";
export { RemoteConnection } from "./connection.ts";
export {
	INVITE_ASSOCIATED_DATA,
	INVITE_CODE_LENGTH,
	INVITE_KDF_ITERATIONS,
	INVITE_PASSWORD_LENGTH,
	MAX_INVITE_ENVELOPE_CHARS,
	buildInviteQr,
	formatInviteCode,
	generateInviteCode,
	generateInvitePassword,
	inviteBoxId,
	inviteBoxUrl,
	isValidInvitePassword,
	normalizeInviteCode,
	openInvite,
	parseInviteQr,
	readInviteEnvelope,
	sealInvite,
	type InviteQr,
	type RemoteInviteEnvelope,
} from "./invite-code.ts";
export { FakeTransport, FakeTransportPair } from "./fake-transport.ts";
export {
	WebSocketTransport,
	nodeWebSocketFactory,
	type WebSocketFactory,
	type WebSocketLike,
	type WebSocketTransportOptions,
} from "./websocket-transport.ts";
export {
	RELAY_CLOSE_INVALID_FRAME,
	RELAY_CLOSE_SUPERSEDED,
	RelayCore,
	RelayTransport,
	type RelayClose,
	type RelayCredentials,
	type RelayCoreOptions,
	type RelayHandle,
	type RelaySink,
} from "./relay-core.ts";
