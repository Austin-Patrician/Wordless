import { readInviteEnvelope, type RemoteInviteEnvelope } from "./invite-code.ts";
import { decodeRemoteFrame } from "./protocol.ts";
import { sha256Hex } from "./crypto.ts";
import {
	KEEPALIVE_PING,
	KEEPALIVE_PONG,
	REMOTE_PROTOCOL_VERSION,
	type RemoteEndpointRole,
	type RemoteFrame,
	type RemoteHelloAck,
	type RemotePeerStatus,
	type RemoteTransport,
	type RemoteTransportHandlers,
} from "./types.ts";

/**
 * 中继规则的**参考实现**(内存版)。
 *
 * 它不是"测试替身",而是中继规则的唯一定义:谁能进房间、什么帧能转发、什么时候必须断开、信箱怎么过期。
 * 本机中继进程(真实 WebSocket 服务)**直接跑它** —— 于是"测试里通过的规则"与"线上跑的规则"是同一份代码,
 * 不存在"两边行为不一致"这种 bug。测试用的是同一实现的另一条投递通道(假传输)。
 */

export interface RelayCredentials {
	readonly pairingId: string;
	readonly role: RemoteEndpointRole;
	readonly pairingSecret: string;
	/** 桌面端注册房间时额外声明"手机密钥的哈希"。中继只存哈希,永远拿不到密钥本身。 */
	readonly peerCredentialHash?: string;
}

export interface RelayClose {
	readonly role: RemoteEndpointRole;
	readonly code: number;
	readonly reason: string;
}

/** WebSocket 关闭码,与真实中继保持一致。 */
export const RELAY_CLOSE_SUPERSEDED = 4001;
export const RELAY_CLOSE_INVALID_FRAME = 4002;

interface RelaySocket {
	readonly role: RemoteEndpointRole;
	readonly secretHash: string;
	authenticated: boolean;
	superseded: boolean;
	deviceId?: string;
	deviceName?: string;
	connectionId?: string;
	identityKey?: string;
	ephemeralKey?: string;
	readonly transport: RelayTransport;
}

interface Room {
	desktopHash: string;
	phoneHash?: string;
	desktop?: RelaySocket;
	mobile?: RelaySocket;
}

interface Mailbox {
	readonly envelope: RemoteInviteEnvelope;
	readonly tokenHash: string;
	reads: number;
	readonly expiresAt: number;
}

export interface RelayCoreOptions {
	readonly now?: () => number;
	readonly mailboxTtlMs?: number;
	readonly mailboxMaxReads?: number;
}

export class RelayCore {
	private readonly rooms = new Map<string, Room>();
	private readonly mailboxes = new Map<string, Mailbox>();
	private readonly sockets = new Set<RelayTransport>();
	private readonly closeLog: RelayClose[] = [];
	private readonly eventLog: string[] = [];
	private readonly now: () => number;
	private readonly mailboxTtlMs: number;
	private readonly mailboxMaxReads: number;

	constructor(options: RelayCoreOptions = {}) {
		this.now = options.now ?? Date.now;
		this.mailboxTtlMs = options.mailboxTtlMs ?? 10 * 60_000;
		this.mailboxMaxReads = options.mailboxMaxReads ?? 10;
	}

	/** 桌面端注册房间:交出自己的密钥(中继只留哈希)与手机密钥的哈希。 */
	registerRoom(pairingId: string, desktopSecret: string, phoneSecretHash?: string): void {
		const existing = this.rooms.get(pairingId);
		this.rooms.set(pairingId, {
			desktopHash: sha256Hex(desktopSecret),
			...(phoneSecretHash === undefined ? {} : { phoneHash: phoneSecretHash }),
			// 重新注册由桌面端拥有:可以替换手机端摘要(凭据轮换),但已连上的套接字不受影响。
			...(existing?.desktop === undefined ? {} : { desktop: existing.desktop }),
			...(existing?.mobile === undefined ? {} : { mobile: existing.mobile }),
		});
		this.eventLog.push(`room_registered ${tag(pairingId)}`);
	}

	/**
	 * 接入一个端点。凭据不对直接拒绝(真实中继返回 401,这里抛错)。
	 * **密钥只存在于内存里的哈希** —— 中继无法出示任何一方的密钥。
	 */
	connect(credentials: RelayCredentials): RelayTransport {
		const room = this.rooms.get(credentials.pairingId);
		if (!room) throw new Error("unauthorized: room is not registered");
		const secretHash = sha256Hex(credentials.pairingSecret);
		if (credentials.role === "desktop") {
			if (secretHash !== room.desktopHash) throw new Error("unauthorized: desktop secret mismatch");
			if (room.phoneHash !== undefined && credentials.peerCredentialHash !== room.phoneHash) {
				throw new Error("unauthorized: phone credential hash mismatch");
			}
		} else {
			if (room.phoneHash === undefined) throw new Error("unauthorized: no phone is registered for this room");
			if (secretHash !== room.phoneHash) throw new Error("unauthorized: phone secret mismatch");
		}

		const transport = new RelayTransport(this, credentials.role);
		const socket: RelaySocket = {
			role: credentials.role,
			secretHash,
			authenticated: false,
			superseded: false,
			transport,
		};
		const previous = credentials.role === "desktop" ? room.desktop : room.mobile;
		if (previous) {
			previous.superseded = true;
			this.close(previous.transport, RELAY_CLOSE_SUPERSEDED, "Connection replaced");
		}
		if (credentials.role === "desktop") room.desktop = socket;
		else room.mobile = socket;
		this.sockets.add(transport);
		this.eventLog.push(`socket_connected ${credentials.role}`);
		return transport;
	}

	/**
	 * 用**任意**投递通道接入一个端点:真实 WebSocket 服务用它,假传输也用它。
	 * 返回的句柄把"收到的帧"与"关闭"转成回调,于是中继规则不需要知道底层是 WebSocket 还是内存队列。
	 */
	attach(credentials: RelayCredentials, sink: RelaySink): RelayHandle {
		const transport = this.connect(credentials);
		const handle: RelayHandle = {
			role: credentials.role,
			send: (frame) => transport.send(frame),
			close: () => transport.close(),
			detach: () => {
				transport.sink = undefined;
			},
		};
		transport.sink = sink;
		return handle;
	}

	// ── 连接码信箱 ─────────────────────────────────────────────────────────────

	/** 桌面端写入信箱;`token` 是只有桌面端知道的写入令牌(用于撤回)。 */
	putInvite(boxId: string, token: string, envelope: RemoteInviteEnvelope): void {
		const valid = readInviteEnvelope(envelope);
		if (!valid) throw new Error("invalid invite envelope");
		this.mailboxes.set(boxId, {
			envelope: valid,
			tokenHash: sha256Hex(token),
			reads: 0,
			expiresAt: this.now() + this.mailboxTtlMs,
		});
		this.eventLog.push(`invite_put ${boxId.slice(0, 8)}`);
	}

	/** 手机端读取:次数与时限都受限,读不到就是 undefined(不区分"没有""过期""读完了")。 */
	getInvite(boxId: string): RemoteInviteEnvelope | undefined {
		const box = this.mailboxes.get(boxId);
		if (!box) return undefined;
		if (box.expiresAt <= this.now() || box.reads >= this.mailboxMaxReads) {
			this.mailboxes.delete(boxId);
			return undefined;
		}
		box.reads += 1;
		return box.envelope;
	}

	/** 撤回;令牌不对就什么都不做(真实中继返回 401)。 */
	deleteInvite(boxId: string, token: string): boolean {
		const box = this.mailboxes.get(boxId);
		if (!box || box.tokenHash !== sha256Hex(token)) return false;
		this.mailboxes.delete(boxId);
		return true;
	}

	/**
	 * 心跳由中继**自动应答**:不唤醒房间、不转发、不产生任何状态变化。
	 * 这正是"闲置配对不产生费用"的落点,所以要能测。
	 */
	keepalive(text: string): string {
		return text === KEEPALIVE_PING ? KEEPALIVE_PONG : text;
	}

	/** 关闭记录(带关闭码),用来断言"非法帧被拒"这类边界。 */
	get closes(): readonly RelayClose[] {
		return this.closeLog;
	}

	/** 诊断日志。**永远不含密钥、prompt 或文件内容** —— 这条不变量本身也要被测。 */
	get events(): readonly string[] {
		return this.eventLog;
	}

	// ── 内部 ────────────────────────────────────────────────────────────────────

	/** 内部:一端发出了一帧。 */
	handleFrame(from: RelayTransport, frame: RemoteFrame): void {
		const socket = this.socketOf(from);
		if (!socket) return;
		let decoded: RemoteFrame;
		try {
			decoded = decodeRemoteFrame(frame);
		} catch {
			this.reject(from, socket, RELAY_CLOSE_INVALID_FRAME, "invalid_frame");
			return;
		}
		if (!socket.authenticated) {
			if (decoded.type !== "hello" || decoded.role !== socket.role) {
				this.reject(from, socket, RELAY_CLOSE_INVALID_FRAME, "invalid_handshake");
				return;
			}
			socket.authenticated = true;
			socket.deviceId = decoded.deviceId;
			socket.deviceName = decoded.deviceName;
			socket.connectionId = decoded.connectionId;
			socket.identityKey = decoded.identityKey;
			socket.ephemeralKey = decoded.ephemeralKey;
			this.eventLog.push(`handshake_accepted ${socket.role}`);
			this.acknowledgePair(socket);
			return;
		}
		if (decoded.type !== "sealed") {
			// 握手之后只允许密封帧 —— 出现明文就说明有东西不对劲,直接断开。
			this.reject(from, socket, RELAY_CLOSE_INVALID_FRAME, "plaintext_after_handshake");
			return;
		}
		const peer = this.peerOf(socket);
		if (!peer) {
			// 对端不在:告诉发送方"他不在线",但**不关闭**发送方 —— 它还会一直在。
			this.deliver(from, { type: "peer_status", online: false } satisfies RemotePeerStatus);
			return;
		}
		// 即时投递:真实中继是一条长连接,没有"稍后 flush"这回事。
		peer.transport.receive(decoded);
		this.eventLog.push(`frame_forwarded ${decoded.type}`);
	}

	/** 内部:一端断开。 */
	handleClose(from: RelayTransport): void {
		const socket = this.socketOf(from);
		if (!socket) return;
		this.sockets.delete(from);
		const room = this.roomOf(from);
		if (room) {
			if (socket.role === "desktop" && room.desktop === socket) room.desktop = undefined;
			if (socket.role === "mobile" && room.mobile === socket) room.mobile = undefined;
		}
		this.eventLog.push(`socket_closed ${socket.role}`);
		// 被顶替的旧连接不再通知对端,否则对端会收到一次假的"离线"。
		if (socket.superseded) return;
		const peer = room ? (socket.role === "desktop" ? room.mobile : room.desktop) : undefined;
		if (peer?.authenticated) peer.transport.receive({ type: "peer_status", online: false });
	}

	private acknowledgePair(socket: RelaySocket): void {
		const peer = this.peerOf(socket);
		if (!peer || !peer.authenticated) return;
		if (!socket.deviceId || !socket.identityKey || !socket.ephemeralKey) return;
		if (!peer.deviceId || !peer.identityKey || !peer.ephemeralKey || !peer.connectionId) return;
		const toPeer: RemoteHelloAck = {
			type: "hello_ack",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			connectionId: peer.connectionId,
			peerDeviceId: socket.deviceId,
			...(socket.deviceName === undefined ? {} : { peerDeviceName: socket.deviceName }),
			peerIdentityKey: socket.identityKey,
			peerEphemeralKey: socket.ephemeralKey,
		};
		if (!socket.connectionId) return;
		const toSelf: RemoteHelloAck = {
			type: "hello_ack",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			connectionId: socket.connectionId,
			peerDeviceId: peer.deviceId,
			...(peer.deviceName === undefined ? {} : { peerDeviceName: peer.deviceName }),
			peerIdentityKey: peer.identityKey,
			peerEphemeralKey: peer.ephemeralKey,
		};
		peer.transport.receive(toPeer);
		socket.transport.receive(toSelf);
		this.eventLog.push(`pair_online ${tag("")}`.trim());
	}

	private peerOf(socket: RelaySocket): RelaySocket | undefined {
		for (const room of this.rooms.values()) {
			const mine = socket.role === "desktop" ? room.desktop : room.mobile;
			if (mine !== socket) continue;
			return socket.role === "desktop" ? room.mobile : room.desktop;
		}
		return undefined;
	}

	private roomOf(transport: RelayTransport): Room | undefined {
		for (const room of this.rooms.values()) {
			if (room.desktop?.transport === transport || room.mobile?.transport === transport) return room;
		}
		return undefined;
	}

	private socketOf(transport: RelayTransport): RelaySocket | undefined {
		for (const room of this.rooms.values()) {
			if (room.desktop?.transport === transport) return room.desktop;
			if (room.mobile?.transport === transport) return room.mobile;
		}
		return undefined;
	}

	private reject(transport: RelayTransport, socket: RelaySocket, code: number, reason: string): void {
		this.eventLog.push(`socket_rejected ${socket.role} ${reason}`);
		this.close(transport, code, reason);
	}

	private close(transport: RelayTransport, code: number, reason: string): void {
		const socket = this.socketOf(transport);
		this.closeLog.push({ role: socket?.role ?? "mobile", code, reason });
		this.sockets.delete(transport);
		transport.closed(code, reason);
	}

	private deliver(target: RelayTransport, frame: RemoteFrame): void {
		target.receive(frame);
	}
}

/** 房间标签:只用于日志,不含密钥。 */
function tag(pairingId: string): string {
	return pairingId.slice(0, 6);
}

/** 中继把帧投给谁:可以是 `RemoteTransport`(测试),也可以是一条真实 WebSocket。 */
export interface RelaySink {
	onFrame(frame: RemoteFrame): void;
	onClose(code: number, reason: string): void;
}

/** 接入之后拿到的句柄:发帧、主动断开、卸载投递通道。 */
export interface RelayHandle {
	readonly role: RemoteEndpointRole;
	send(frame: RemoteFrame): Promise<void>;
	close(): Promise<void>;
	detach(): void;
}

/** 一端连到中继上的那条链路(假传输用)。 */
export class RelayTransport implements RemoteTransport {
	private readonly relay: RelayCore;
	private readonly role: RemoteEndpointRole;
	private handlers: RemoteTransportHandlers | undefined;
	/** 真实投递通道(WebSocket)。设置它就绕开 `handlers`。 */
	sink: RelaySink | undefined;

	constructor(relay: RelayCore, role: RemoteEndpointRole) {
		this.relay = relay;
		this.role = role;
	}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		this.handlers = handlers;
	}

	async send(frame: RemoteFrame): Promise<void> {
		this.relay.handleFrame(this, frame);
	}

	async close(): Promise<void> {
		this.relay.handleClose(this);
	}

	/** 内部:中继投递来的一帧。 */
	receive(frame: RemoteFrame): void {
		if (this.sink) {
			this.sink.onFrame(frame);
			return;
		}
		this.handlers?.onFrame(frame);
	}

	/** 内部:中继关闭了这条链路。 */
	closed(code: number, reason: string): void {
		if (this.sink) {
			this.sink.onClose(code, reason);
			return;
		}
		this.handlers?.onClose(`${code} ${reason}`);
	}

	get side(): RemoteEndpointRole {
		return this.role;
	}
}
