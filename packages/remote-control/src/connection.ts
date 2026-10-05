import {
	bytesEqual,
	decodePublicKey,
	defaultRandomBytes,
	deriveSessionKeys,
	generateEphemeralKeyPair,
	openFrame,
	randomToken,
	sealFrame,
	toBase64Url,
	verificationCode,
	type RemoteRandomBytes,
	type RemoteSessionKeys,
} from "./crypto.ts";
import { RemoteEventJournal } from "./event-journal.ts";
import { MAX_REMOTE_FRAME_CHARS, RemoteProtocolError, encodeRemoteFrame, isSessionFrame } from "./protocol.ts";
import {
	REMOTE_PROTOCOL_VERSION,
	type RemoteCapabilities,
	type RemoteConnectionEvent,
	type RemoteConnectionOptions,
	type RemoteConnectionSnapshot,
	type RemoteConnectionState,
	type RemoteError,
	type RemoteErrorCode,
	type RemoteEvent,
	type RemoteEventJournalPort,
	type RemoteEventName,
	type RemoteFrame,
	type RemoteHello,
	type RemoteHelloAck,
	type RemoteIdentityKeyPair,
	type RemoteRequest,
	type RemoteRequestMethod,
	type RemoteRequestResult,
	type RemoteSessionFrame,
	type RemoteTransport,
} from "./types.ts";

/**
 * 一条远程连接。
 *
 * 它负责协议里最容易出错的三件事:
 *
 * 1. **握手**:交换身份与临时公钥 → 派生方向密钥。身份对不上就**在派生密钥之前**拒绝。
 * 2. **请求/响应关联**:`requestId` 幂等 —— 重复的响应不得再次完成请求。
 * 3. **事件序号**:单调递增;重复的忽略,跳号的**丢弃并请求补发**;断线不静默丢掉待处理请求。
 *
 * 它**不**负责:UI、链路怎么建(那是 `RemoteTransport`)、会话怎么执行(那在本机服务里)。
 * 临时密钥**每次连接都重新生成**,所以重连不会复用上一次的会话密钥。
 */

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** 重连退避:先快后慢,最后一次一直重复 —— 网络恢复时不该让用户等半分钟。 */
const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000] as const;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000;
/** 握手期间最多缓冲多少帧密封帧(防止对端在握手未完成时无限灌数据)。 */
const MAX_BUFFERED_SEALED_FRAMES = 64;

interface PendingRequest {
	readonly method: RemoteRequestMethod;
	readonly resolve: (result: RemoteRequestResult) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

interface HandshakeWaiter {
	resolve: () => void;
	/** 一律是 Error:裸对象到了上层会变成"未知失败",连原因都印不出来。 */
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

export class RemoteConnection {
	private readonly options: RemoteConnectionOptions;
	private readonly journal: RemoteEventJournalPort;
	private readonly listeners = new Set<(event: RemoteConnectionEvent) => void>();
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly randomBytes: RemoteRandomBytes;
	private readonly requestPrefix: string;

	private ephemeral: RemoteIdentityKeyPair;
	private sessionKeys: RemoteSessionKeys | undefined;
	private transport: RemoteTransport | undefined;
	private stateValue: RemoteConnectionState = "idle";
	private readonly connectionIdValue: string;
	private peerDeviceIdValue: string | undefined;
	private peerDeviceNameValue: string | undefined;
	private peerCapabilitiesValue: RemoteCapabilities | undefined;
	private peerIdentityKeyValue: string | undefined;
	private verificationCodeValue: string | undefined;
	private lastEventSequenceValue: number;
	private lastAckSequenceValue = 0;
	private reconnectCountValue = 0;
	/** 待重试的定时器,以及"用户主动关掉了"这个标记(它必须能压住重试)。 */
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private reconnectAttempt = 0;
	private closedByLocal = false;
	private lastErrorCodeValue: RemoteErrorCode | undefined;
	private handshakeWaiter: HandshakeWaiter | undefined;
	private bufferedSealed: RemoteFrame[] = [];
	private requestCounter = 0;

	constructor(options: RemoteConnectionOptions) {
		this.options = options;
		this.randomBytes = options.randomBytes ?? defaultRandomBytes;
		this.journal = options.journal ?? new RemoteEventJournal();
		this.ephemeral = generateEphemeralKeyPair(this.randomBytes);
		this.connectionIdValue = options.connectionId ?? randomToken(12, this.randomBytes);
		this.requestPrefix = randomToken(6, this.randomBytes);
		this.lastEventSequenceValue = options.resumeFrom ?? 0;
	}

	get state(): RemoteConnectionState {
		return this.stateValue;
	}

	/** 已经从对端收到（并已交付）的最大事件序号。重连时把它作为 `resume` 的起点。 */
	get lastEventSequence(): number {
		return this.lastEventSequenceValue;
	}

	get peerDeviceId(): string | undefined {
		return this.peerDeviceIdValue;
	}

	/** 对端自报的名字。经中继连接时由中继抄进 `hello_ack`,所以两端都能读到。 */
	get peerDeviceName(): string | undefined {
		return this.peerDeviceNameValue;
	}

	onEvent(listener: (event: RemoteConnectionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * 建链并完成握手。可以重复调用(重连):临时密钥会重新生成,但**事件日志与序号延续**,
	 * 所以对端只需要补发缺失的尾部。
	 */
	async connect(transport: RemoteTransport): Promise<void> {
		if (this.transport && this.stateValue !== "closed" && this.stateValue !== "reconnecting") {
			throw new Error("connection is already active");
		}
		if (this.stateValue !== "idle") this.reconnectCountValue += 1;
		// 重新建链成功之后,重试节奏回到最快那一档;而且这次是"有人要它连",不再是"被关掉了"。
		this.reconnectAttempt = 0;
		this.closedByLocal = false;
		this.ephemeral = generateEphemeralKeyPair(this.randomBytes);
		this.sessionKeys = undefined;
		this.transport = transport;
		this.setState("connecting");
		const waiting = this.expectHandshake();
		/**
		 * **先给这个 promise 挂一个处理器。**
		 *
		 * 它会在这两种情况下被拒绝:握手失败,以及**握手还没结束就有人 `close()`**
		 * (关掉一个正在连接的连接 —— 切换接入方式时就会这样)。
		 * 而 `connect()` 要等 `transport.connect()` 才把 `waiting` 交回调用方 ——
		 * 在那之前被拒绝的话,这一次拒绝**没有任何人接**,于是变成"未处理的 promise 拒绝":
		 * 主进程日志被刷满,而且调用方的 await 也跟着崩。
		 *
		 * 挂一个空的处理器只是"标记已处理",`connect()` 仍然把同一个 promise 交回去,语义不变。
		 */
		waiting.catch(() => undefined);
		await transport.connect({
			onFrame: (frame) => this.handleFrame(frame),
			onClose: (reason) => this.handleTransportClose(reason),
		});
		if (this.options.handshake === "accept") {
			// 接受方先等对端的 hello,由 handleHello 完成后续。
			return waiting;
		}
		await this.sendHello();
		return waiting;
	}

	async close(reason = "closed by local endpoint"): Promise<void> {
		// 主动关闭要**取消待重试的那一次**:否则"我关掉了它"之后它自己又连回来。
		this.cancelReconnect();
		const transport = this.transport;
		this.transport = undefined;
		const closedError: RemoteError = { code: "transport_closed", message: reason, retryable: true };
		this.failHandshake(closedError);
		this.failPendingRequests(closedError);
		this.sessionKeys = undefined;
		this.bufferedSealed = [];
		this.setState("closed");
		await transport?.close(reason);
	}

	getSnapshot(): RemoteConnectionSnapshot {
		return {
			state: this.stateValue,
			deviceId: this.options.deviceId,
			connectionId: this.connectionIdValue,
			lastEventSequence: this.lastEventSequenceValue,
			lastAckSequence: this.lastAckSequenceValue,
			pendingRequestCount: this.pendingRequests.size,
			reconnectCount: this.reconnectCountValue,
			...(this.lastErrorCodeValue === undefined ? {} : { lastErrorCode: this.lastErrorCodeValue }),
			...(this.peerDeviceIdValue === undefined ? {} : { peerDeviceId: this.peerDeviceIdValue }),
			...(this.peerDeviceNameValue === undefined ? {} : { peerDeviceName: this.peerDeviceNameValue }),
			...(this.peerCapabilitiesValue === undefined ? {} : { peerCapabilities: this.peerCapabilitiesValue }),
			...(this.peerIdentityKeyValue === undefined ? {} : { peerIdentityKey: this.peerIdentityKeyValue }),
			...(this.verificationCodeValue === undefined ? {} : { verificationCode: this.verificationCodeValue }),
		};
	}

	// ── 请求 ────────────────────────────────────────────────────────────────────

	/**
	 * 发一次请求并等响应。失败**不抛异常** —— 远端错误是结果,不是异常;调用方按 `retryable` 决定要不要重试。
	 */
	sendRequest(
		method: RemoteRequestMethod,
		input: { readonly sessionId?: string; readonly payload?: unknown; readonly timeoutMs?: number } = {},
	): Promise<RemoteRequestResult> {
		const transport = this.requireTransport();
		this.requestCounter += 1;
		const requestId = `${this.requestPrefix}-${this.requestCounter}`;
		const request: RemoteRequest = {
			type: "request",
			requestId,
			method,
			...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
			...(input.payload === undefined ? {} : { payload: input.payload }),
		};
		return new Promise<RemoteRequestResult>((resolve) => {
			const timeoutMs = input.timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
			const timer = setTimer(() => {
				this.pendingRequests.delete(requestId);
				resolve({
					success: false,
					error: { code: "request_timeout", message: `request ${method} timed out`, retryable: true },
				});
			}, timeoutMs);
			this.pendingRequests.set(requestId, { method, resolve, timer });
			void this.sendSealed(request, transport);
		});
	}

	/** 应答对端发来的请求(应用侧处理完 `remote-request` 之后调用)。 */
	async respondToRequest(requestId: string, result: RemoteRequestResult): Promise<void> {
		const transport = this.requireTransport();
		if (!result.success && result.error === undefined) {
			// 协议要求失败必须带错误;调用方漏了就补一个,而不是发一个不合规的帧出去。
			await this.sendSealed(
				{
					type: "response",
					requestId,
					success: false,
					error: { code: "internal_error", message: "responder did not supply an error", retryable: false },
				},
				transport,
			);
			return;
		}
		await this.sendSealed(
			{
				type: "response",
				requestId,
				success: result.success,
				...(result.payload === undefined ? {} : { payload: result.payload }),
				...(result.error === undefined ? {} : { error: result.error }),
			},
			transport,
		);
	}

	// ── 事件 ────────────────────────────────────────────────────────────────────

	/**
	 * 发一个事件:序号由日志分配并记住,所以重连之后对端能补上缺的那些。
	 *
	 * **链路不在时不抛错**:事件照常进日志,只是暂时发不出去 —— 对端重连时会按序号补。
	 * 这正是"序号跨链路连续"的落点,也是"未配对时零代价"能成立的原因(本机照常记录,不需要对端在场)。
	 */
	publishEvent(
		name: RemoteEventName,
		input: { readonly sessionId?: string; readonly payload?: unknown } = {},
	): RemoteEvent {
		const event: RemoteEvent = {
			type: "event",
			eventId: randomToken(9, this.randomBytes),
			sequence: this.journal.nextSequence(),
			name,
			...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
			...(input.payload === undefined ? {} : { payload: input.payload }),
		};
		this.journal.remember(event);
		void this.sendSealed(event);
		return event;
	}

	// ── 内部:握手 ──────────────────────────────────────────────────────────────

	private async sendHello(): Promise<void> {
		const transport = this.requireTransport();
		const hello: RemoteHello = {
			type: "hello",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			role: this.options.role,
			deviceId: this.options.deviceId,
			deviceName: this.options.deviceName,
			capabilities: this.options.capabilities,
			connectionId: this.connectionIdValue,
			identityKey: toBase64Url(this.options.identity.publicKey),
			ephemeralKey: toBase64Url(this.ephemeral.publicKey),
		};
		await transport.send(hello);
	}

	private expectHandshake(): Promise<void> {
		const configured = this.options.handshakeTimeoutMs;
		const timeoutMs = configured ?? this.options.requestTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
		return new Promise<void>((resolve, reject) => {
			// `0` 表示不超时:停在中继上等对端是长期状态(见选项注释),不该被当成"卡住了"。
			if (timeoutMs === 0) {
				this.handshakeWaiter = { resolve, reject, timer: undefined };
				return;
			}
			const timer = setTimer(() => {
				this.handshakeWaiter = undefined;
				// 抛 Error 而不是裸对象:裸对象会被上层当成"未知失败",连原因都印不出来。
				const error = new RemoteProtocolError("握手超时:对端没有在预期时间内出现", "request_timeout");
				this.fail({ code: "request_timeout", message: error.message, retryable: true });
				reject(error);
			}, timeoutMs);
			this.handshakeWaiter = { resolve, reject, timer };
		});
	}

	/** 握手以失败告终:清掉定时器并**立刻**让 `connect()` 的 promise 落地。 */
	private failHandshake(error: RemoteError): void {
		const waiter = this.handshakeWaiter;
		if (!waiter) return;
		this.handshakeWaiter = undefined;
		if (waiter.timer !== undefined) clearTimeout(waiter.timer);
		waiter.reject(new RemoteProtocolError(error.message, error.code));
	}

	private completeHandshake(): void {
		const waiter = this.handshakeWaiter;
		if (!waiter) return;
		this.handshakeWaiter = undefined;
		if (waiter.timer !== undefined) clearTimeout(waiter.timer);
		this.setState("online");
		waiter.resolve();
		this.drainBufferedSealed();
	}

	/** 握手完成后再处理先前到达的密封帧,顺序与到达顺序一致。 */
	private drainBufferedSealed(): void {
		if (this.bufferedSealed.length === 0) return;
		const buffered = this.bufferedSealed;
		this.bufferedSealed = [];
		for (const frame of buffered) this.handleFrame(frame);
	}

	/** 接受方处理对端 hello。 */
	private async handleHello(hello: RemoteHello): Promise<void> {
		if (hello.role === this.options.role) {
			this.fail({ code: "unauthorized", message: "peer declared the same role", retryable: false });
			return;
		}
		const peerIdentityKey = decodePublicKey(hello.identityKey, "hello.identityKey");
		const pinned = this.options.expectedPeerIdentityKey;
		if (pinned && !bytesEqual(pinned, peerIdentityKey)) {
			this.fail({ code: "unauthorized", message: "peer identity does not match the pinned key", retryable: false });
			return;
		}
		const decision = await this.decideHello(hello);
		if (decision === "reject") {
			this.fail({ code: "approval_rejected", message: "pairing was rejected", retryable: false });
			return;
		}
		this.peerDeviceIdValue = hello.deviceId;
		this.peerDeviceNameValue = hello.deviceName;
		this.peerCapabilitiesValue = hello.capabilities;
		this.peerIdentityKeyValue = hello.identityKey;
		this.verificationCodeValue = verificationCode(this.options.identity.publicKey, peerIdentityKey);
		const ack: RemoteHelloAck = {
			type: "hello_ack",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			connectionId: hello.connectionId,
			peerDeviceId: this.options.deviceId,
			peerIdentityKey: toBase64Url(this.options.identity.publicKey),
			peerEphemeralKey: toBase64Url(this.ephemeral.publicKey),
		};
		await this.requireTransport().send(ack);
		this.deriveKeys(hello.identityKey, hello.ephemeralKey);
		this.completeHandshake();
		await this.sendResume();
	}

	/** 默认只放行已钉住身份的对端;未知对端交给应用决定(可能要人核对验证码)。 */
	private async decideHello(hello: RemoteHello): Promise<"approve" | "reject"> {
		if (this.options.onHello) {
			const decision = await this.options.onHello(hello);
			if (decision.kind === "approve") return "approve";
			if (decision.kind === "reject") return "reject";
			this.setState("pending_approval");
			await this.requireTransport().send({
				type: "pairing_pending",
				connectionId: hello.connectionId,
				peerDeviceId: hello.deviceId,
				peerIdentityKey: hello.identityKey,
			});
			const approved = await decision.approval;
			return approved ? "approve" : "reject";
		}
		return this.options.expectedPeerIdentityKey === undefined ? "reject" : "approve";
	}

	private handleHelloAck(ack: RemoteHelloAck): void {
		const peerIdentityKey = decodePublicKey(ack.peerIdentityKey, "hello_ack.peerIdentityKey");
		const reconnecting = this.handshakeWaiter === undefined;
		const pinned = this.options.expectedPeerIdentityKey;
		if (pinned && !bytesEqual(pinned, peerIdentityKey)) {
			this.fail({ code: "unauthorized", message: "peer identity does not match the pinned key", retryable: false });
			return;
		}
		this.peerDeviceIdValue = ack.peerDeviceId;
		if (ack.peerDeviceName !== undefined) this.peerDeviceNameValue = ack.peerDeviceName;
		this.peerIdentityKeyValue = ack.peerIdentityKey;
		this.verificationCodeValue = verificationCode(this.options.identity.publicKey, peerIdentityKey);
		this.deriveKeys(ack.peerIdentityKey, ack.peerEphemeralKey);
		this.completeHandshake();
		// 对端重连时会再来一次 hello_ack:状态没有变化(还是 online),但"对端来了"这件事发生了 ——
		// 上层要靠它弹通知、把身份钉住、作废邀请。所以这里补一条 peer-status。
		if (reconnecting) this.emit({ type: "peer-status", online: true });
		void this.sendResume();
	}

	private deriveKeys(peerIdentityKey: string, peerEphemeralKey: string): void {
		this.sessionKeys = deriveSessionKeys({
			role: this.options.role,
			identity: this.options.identity,
			ephemeral: this.ephemeral,
			peerIdentityKey: decodePublicKey(peerIdentityKey, "peerIdentityKey"),
			peerEphemeralKey: decodePublicKey(peerEphemeralKey, "peerEphemeralKey"),
		});
	}

	/** 握手一完成就告诉对端"我收到哪儿了",让它只补缺失的尾部。 */
	private async sendResume(): Promise<void> {
		await this.sendSealed({ type: "resume", lastEventSequence: this.lastEventSequenceValue });
	}

	// ── 内部:帧分发 ────────────────────────────────────────────────────────────

	private handleFrame(frame: RemoteFrame): void {
		switch (frame.type) {
			case "hello":
				void this.handleHello(frame);
				return;
			case "hello_ack":
				this.handleHelloAck(frame);
				return;
			case "pairing_pending":
				this.peerDeviceIdValue = frame.peerDeviceId;
				this.setState("pending_approval");
				return;
			case "peer_status":
				if (!frame.online) this.setState("reconnecting");
				else if (this.stateValue === "reconnecting") this.setState("online");
				this.emit({ type: "peer-status", online: frame.online });
				return;
			case "sealed":
				this.handleSealed(frame);
				return;
			default:
				// 握手之后出现明文会话帧:和我们对中继的要求一样,端点自己也拒绝。
				if (isSessionFrame(frame)) {
					this.fail({ code: "invalid_frame", message: "session frame arrived in clear", retryable: false });
					return;
				}
				this.fail({ code: "invalid_frame", message: "unexpected frame", retryable: false });
		}
	}

	private handleSealed(sealed: Extract<RemoteFrame, { type: "sealed" }>): void {
		const keys = this.sessionKeys;
		if (!keys) {
			// 对端可能比我们更早完成握手(它一发完 hello_ack 就会发第一个密封帧)。
			// 这是真实网络的常态,所以要**缓冲**而不是判为非法 —— 但只在握手还在进行时缓冲。
			if (this.stateValue === "connecting" || this.stateValue === "pending_approval") {
				if (this.bufferedSealed.length >= MAX_BUFFERED_SEALED_FRAMES) {
					this.fail({ code: "invalid_frame", message: "too many frames before the handshake completed", retryable: false });
					return;
				}
				this.bufferedSealed.push(sealed);
				return;
			}
			this.fail({ code: "unauthorized", message: "sealed frame outside an active handshake", retryable: false });
			return;
		}
		let frame: RemoteSessionFrame;
		try {
			frame = openFrame(keys.receiveKey, sealed);
		} catch (error) {
			const code = error instanceof RemoteProtocolError ? error.code : "invalid_frame";
			this.fail({ code, message: "sealed frame could not be opened", retryable: false });
			return;
		}
		switch (frame.type) {
			case "request":
				this.emit({ type: "remote-request", request: frame });
				return;
			case "response":
				this.handleResponse(frame);
				return;
			case "event":
				this.handleEvent(frame);
				return;
			case "ack":
				this.journal.acknowledge(frame.sequence);
				this.lastAckSequenceValue = Math.max(this.lastAckSequenceValue, frame.sequence);
				return;
			case "resume":
				this.handleResume(frame.lastEventSequence);
				return;
			default:
				return;
		}
	}

	private handleResponse(response: Extract<RemoteSessionFrame, { type: "response" }>): void {
		const pending = this.pendingRequests.get(response.requestId);
		// 未知或重复的响应直接忽略 —— 重复响应不得再次完成请求(协议不变量)。
		if (!pending) return;
		this.pendingRequests.delete(response.requestId);
		if (pending.timer !== undefined) clearTimeout(pending.timer);
		pending.resolve({
			success: response.success,
			...(response.payload === undefined ? {} : { payload: response.payload }),
			...(response.error === undefined ? {} : { error: response.error }),
		});
	}

	private handleEvent(event: RemoteEvent): void {
		if (event.sequence <= this.lastEventSequenceValue) return; // 重复事件忽略
		if (event.name === "session.resync") {
			// 对端在说"补不上了,忘掉你现在的进度整体重拉"。**不能按跳号处理**:重拉指令本身就带一个
			// 跳号的序号,若再要求补发,双方会互相要求补发,陷入死循环。
			this.lastEventSequenceValue = event.sequence;
			if (this.stateValue === "recovering") this.setState("online");
			this.emit({ type: "remote-event", event });
			void this.sendSealed({ type: "ack", sequence: event.sequence });
			return;
		}
		if (event.sequence > this.lastEventSequenceValue + 1) {
			// 跳号:不按乱序交付,先请求补发;补回来的事件会把缺口填上。
			this.setState("recovering");
			void this.sendResume();
			return;
		}
		this.lastEventSequenceValue = event.sequence;
		if (this.stateValue === "recovering") this.setState("online");
		this.emit({ type: "remote-event", event });
		void this.sendSealed({ type: "ack", sequence: event.sequence });
	}

	private handleResume(afterSequence: number): void {
		const missing = this.journal.replay(afterSequence);
		if (missing === undefined) {
			// 补不上:明确要求对端整体重拉,而不是让它把后续事件当成已见过的丢掉。
			this.publishEvent("session.resync", { payload: { reason: "journal-evicted" } });
			return;
		}
		const transport = this.transport;
		if (!transport) return;
		for (const event of missing) void this.sendSealed(event, transport);
	}

	// ── 内部:收发与状态 ────────────────────────────────────────────────────────

	private async sendSealed(frame: RemoteSessionFrame, transport = this.transport): Promise<void> {
		const keys = this.sessionKeys;
		if (!keys || !transport) return;
		const sealed = sealFrame(keys.sendKey, frame);
		/**
		 * 发之前先量一下。
		 *
		 * 对端收到超长帧会判为非法帧并**关掉链路**,而用户看到的是"连不上" —— 一次过大的载荷
		 * 不该以整条链路陪葬收场。所以这里直接不发,把结果变成"这一次请求失败",链路继续活着。
		 * 事件也一样:丢掉这一条,后面的照常发。
		 */
		// 量的是**上线的编码长度**(对端的判断也在这上面),而不是内存里的对象。
		const encodedLength = encodeRemoteFrame(sealed).length;
		if (encodedLength > MAX_REMOTE_FRAME_CHARS) {
			const error: RemoteError = {
				code: "payload_too_large",
				message: `frame is too large (${encodedLength} > ${MAX_REMOTE_FRAME_CHARS})`,
				retryable: false,
			};
			if (frame.type === "request") {
				const pending = this.pendingRequests.get(frame.requestId);
				if (pending) {
					this.pendingRequests.delete(frame.requestId);
					if (pending.timer !== undefined) clearTimeout(pending.timer);
					pending.resolve({ success: false, error });
				}
			}
			/**
			 * **丢掉一条事件不能只留一个洞**。
			 *
			 * 事件的序号在 `publishEvent` 里已经用掉了,而对端是按"连续序号"收的:它发现跳号就会
			 * 停下来等这一条,并且**把它后面的一切都扣住**(`handleEvent` 里的 recovering)。
			 * 于是"少发一条"变成了"从此什么都收不到" —— 而且双方都不会报错。
			 * 所以这里明确说一句"补不上,整体重拉":对端会重新拉一次会话与列表,界面自己回到一致。
			 */
			if (frame.type === "event")
				this.publishEvent("session.resync", { payload: { reason: "frame-too-large" } });
			this.emit({ type: "error", error });
			return;
		}
		try {
			await transport.send(sealed);
		} catch (error) {
			this.emit({
				type: "error",
				error: {
					code: "transport_closed",
					message: error instanceof Error ? error.message : "transport send failed",
					retryable: true,
				},
			});
		}
	}

	private handleTransportClose(reason?: string): void {
		this.transport = undefined;
		this.sessionKeys = undefined;
		// 待处理请求不能被静默丢掉:它们以可重试的错误收尾,由调用方决定要不要重发。
		const closedError: RemoteError = { code: "transport_closed", message: reason ?? "transport closed", retryable: true };
		this.failHandshake(closedError);
		this.failPendingRequests(closedError);
		if (this.stateValue === "online" || this.stateValue === "recovering" || this.stateValue === "pending_approval") {
			this.setState("reconnecting");
			// 状态之后必须**真的去连**:否则这就是一句空话(用户会一直看到"正在重连")。
			this.scheduleReconnect();
			return;
		}
		this.setState("closed");
	}

	/**
	 * 安排下一次重连。
	 *
	 * 序号与事件日志**跨链路延续**(`connect` 里不改它们),所以重连成功之后对端只需要补发缺失的尾部,
	 * 不需要整体重拉 —— 这正是 `resume` 存在的意义。
	 */
	private scheduleReconnect(): void {
		const factory = this.options.reconnect;
		if (!factory || this.reconnectTimer !== undefined || this.closedByLocal) return;
		const delays = this.options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
		const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)] ?? 1_000;
		this.reconnectAttempt += 1;
		this.reconnectTimer = setTimer(() => {
			this.reconnectTimer = undefined;
			void this.runReconnect(factory);
		}, delay);
	}

	private async runReconnect(factory: () => Promise<RemoteTransport>): Promise<void> {
		if (this.closedByLocal) return;
		try {
			const transport = await factory();
			if (this.closedByLocal) {
				await transport.close("closed by local endpoint");
				return;
			}
			await this.connect(transport);
		} catch {
			// 连不上不是异常,是"再试一次":中继可能正在重启、手机可能刚回到前台。
			if (this.stateValue !== "closed") this.scheduleReconnect();
		}
	}

	private cancelReconnect(): void {
		if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
		this.reconnectAttempt = 0;
		this.closedByLocal = true;
	}

	private failPendingRequests(error: RemoteError): void {
		for (const [requestId, pending] of this.pendingRequests) {
			this.pendingRequests.delete(requestId);
			if (pending.timer !== undefined) clearTimeout(pending.timer);
			pending.resolve({ success: false, error });
		}
	}

	/** 协议层面的致命错误:记诊断、通知监听者,然后关闭链路。 */
	private fail(error: RemoteError): void {
		this.lastErrorCodeValue = error.code;
		this.emit({ type: "error", error });
		this.failHandshake(error);
		void this.close(error.message);
	}

	private setState(state: RemoteConnectionState): void {
		if (this.stateValue === state) return;
		this.stateValue = state;
		this.emit({ type: "state", state });
	}

	private emit(event: RemoteConnectionEvent): void {
		for (const listener of this.listeners) listener(event);
	}

	private requireTransport(): RemoteTransport {
		if (!this.transport) throw new Error("connection has no transport");
		return this.transport;
	}
}

/**
 * 刻意**不** unref:一个挂起的请求或握手必须让宿主等它出结果(超时或失败),而不是悄悄丢掉。
 * 想退出时应当显式 `close()`,那会清掉所有定时器并把待处理请求以可重试错误收尾。
 */
function setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
	return setTimeout(callback, ms);
}
