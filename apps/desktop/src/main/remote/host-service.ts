import type { RemoteSetModelResult } from "./session-surface.ts";
import {
	ATTACHMENT_CHUNK_BYTES,
	ATTACHMENT_MAX_FILES,
	ATTACHMENT_UPLOAD_TTL_MS,
	attachmentChunkCount,
	checkAttachment,
} from "@wordless/remote-control";
import {
	RemoteConnection,
	buildInviteQr,
	formatInviteCode,
	generateInviteCode,
	generateInvitePassword,
	inviteBoxId,
	inviteBoxUrl,
	isRemoteThinkingLevel,
	randomToken,
	sealInvite,
	type RemoteConnectionEvent,
	type RemoteError,
	type RemoteEntryOption,
	type RemoteHistoryPage,
	type RemoteIdentityKeyPair,
	type RemoteMessageBlock,
	type RemoteSessionDetail,
	type RemoteSessionMessage,
	type RemoteSessionSummary,
	type RemoteSurfaceEvent,
	type RemoteInviteEnvelope,
	type RemoteLogger,
	type RemoteRequest,
	type RemoteRequestResult,
	type RemoteThinkingLevel,
	type RemoteTransport,
	type RemoteModeOption,
	type RemoteWorkspaceOption,
	type RemoteDesignStyleOption,
	type RemoteWorkspaceReference,
} from "@wordless/remote-control";

/**
 * 本机服务:桌面端这一侧。
 *
 * 它做三件事:
 *
 * 1. **回答远端请求** —— 只做对话所需的那几个,其余一律 `not_found`(不扩大攻击面);
 * 2. **把本机发生的事推给远端** —— 会话消息、工具执行、运行状态;
 * 3. **生成配对材料** —— 连接码 + 密码,并把加密后的邀请放进中继信箱。
 *
 * 它**不碰**会话执行语义:那些通过 `RemoteSessionSurface` 端口进来(本机运行时实现它),
 * 于是这一层可以完全用假端口测,不需要 Electron、不需要真模型。
 */

/**
 * 会话面端口。本机运行时实现它,本机服务只依赖这五个方法 ——
 * 于是"远端能做什么"是一份显式清单,而不是"整个运行时都暴露出去"。
 */
export interface RemoteSessionSurface {
	/** 新建会话时能选哪些工作类型(桌面端"今天想做什么"那一排)。 */
	listCatalog(): Promise<{
		readonly entries: readonly RemoteEntryOption[];
		/** 新建页最上面那一栏(日常工作 / 写代码 / 创作):只发真有入口的那些。 */
		readonly modes: readonly RemoteModeOption[];
		readonly connectors: readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[];
		readonly skills: readonly { readonly id: string; readonly name: string; readonly description?: string }[];
	}>;
	/** 新建会话并发出第一条消息。返回新会话的摘要;入口不可用时 `undefined`。 */
	createSession(input: {
		readonly entryId: string;
		readonly text: string;
		readonly model?: { readonly connectionId: string; readonly modelId: string };
		readonly thinkingLevel?: RemoteThinkingLevel;
		readonly interactionMode?: "default" | "plan" | "clarify";
		readonly skillIds?: readonly string[];
		readonly connectorIds?: readonly string[];
		/** 工作目录:需要它的入口**必须**给(本机会校验它存在且可用)。 */
		readonly workspaceId?: string;
		/** 设计风格:只有设计那一类用得上(与桌面端 WelcomeView 同一条路)。 */
		readonly designStyleId?: string;
	}): Promise<RemoteSessionSummary | undefined>;
	listSessions(): Promise<readonly RemoteSessionSummary[]>;
	openSession(sessionId: string): Promise<RemoteSessionDetail | undefined>;
	historyPage(sessionId: string, cursor?: string): Promise<RemoteHistoryPage>;
	retryTurn(sessionId: string, messageId: string): Promise<void>;
	/**
	 * 发一轮。`skillIds` 决定这一轮用哪些技能;附件走 `options`(与运行时同形 ——
	 * 运行时本来就收 base64 附件,所以不需要另造一条传输路径);
	 * `references` 是用户在输入框里 `@` 挑的工作区文件。
	 */
	prompt(
		sessionId: string,
		text: string,
		skillIds?: readonly string[],
		attachments?: readonly {
			readonly name: string;
			readonly mediaType: string;
			readonly size: number;
			readonly base64: string;
		}[],
		references?: readonly RemoteWorkspaceReference[],
	): Promise<void>;
	abort(sessionId: string, text?: never): Promise<void>;
	/** 改权限(访问权限 / 工具确认)。 */
	setPermissions(
		sessionId: string,
		patch: { readonly accessLevel?: "default" | "full"; readonly toolApprovalMode?: "manual" | "auto" | "bypass" },
	): Promise<void>;
	/** 改这个会话用哪些连接器。 */
	setConnectors(sessionId: string, connectorIds: readonly string[]): Promise<void>;
	/** 改交互模式。 */
	setMode(sessionId: string, mode: "default" | "plan" | "clarify"): Promise<void>;
	/** 回答一次工具审批 —— 批准之后本机才会真的执行。 */
	resolveApproval(sessionId: string, approvalId: string, approved: boolean, feedback?: string): Promise<void>;
	/** 手动压缩上下文。 */
	compact(sessionId: string): Promise<void>;
	/** 这个会话的总计用量。 */
	sessionUsage(
		sessionId: string,
	): Promise<{ readonly chat: unknown; readonly unmeasuredCalls: number } | undefined>;
	/** 切换某一轮回复的版本。 */
	selectVersion(sessionId: string, messageId: string, version: number): Promise<void>;
	/** 换这个会话的专家 / 专家团(null = 不用)。 */
	setExpert(
		sessionId: string,
		selection: { readonly kind: "expert" | "team"; readonly id: string; readonly version: string } | null,
	): Promise<void>;
	/** 回答一次提问(提交答案,或取消)。 */
	resolveUserRequest(
		sessionId: string,
		requestId: string,
		resolution: { readonly status: "submitted" | "cancelled"; readonly answers?: Record<string, unknown> },
	): Promise<void>;
	/**
	 * 在这个会话的工作区里搜文件与目录(输入框里的 `@`)。
	 *
	 * **只读**,所以"正在回复"时也能用(与桌面端一样:那一轮在跑,不影响用户先把下一句话写好)。
	 * 查询串由本机交给**已经建好索引**的工作区搜索,远端不做任何过滤 —— 过滤规则(忽略哪些目录、
	 * 隐藏文件怎么算)只应该有一份,放在本机。
	 */
	searchWorkspaceFiles(sessionId: string, query: string): Promise<readonly RemoteWorkspaceReference[]>;
	/** 换模型。返回**分类好的结果**而不是异常 —— 远端要区分"等它说完"和"这个模型用不了"。 */
	setModel(
		sessionId: string,
		model: { readonly connectionId: string; readonly modelId: string },
		thinkingLevel?: RemoteThinkingLevel,
	): Promise<RemoteSetModelResult>;
	subscribe(listener: (event: RemoteSurfaceEvent) => void): () => void;
}

/** 中继信箱:桌面端写入加密后的邀请,手机端凭连接码取回。 */
export interface RemoteMailbox {
	publish(boxUrl: string, token: string, envelope: RemoteInviteEnvelope): Promise<void>;
	withdraw(boxUrl: string, token: string): Promise<void>;
}

export interface RemoteInvite {
	readonly pairingId: string;
	readonly code: string;
	/** 展示给用户的样子:`K7Q2-9MXD`。 */
	readonly formattedCode: string;
	readonly password: string;
	readonly qrText: string;
	readonly expiresAt: number;
}

export interface RemoteHostServiceOptions {
	readonly surface: RemoteSessionSurface;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly identity: RemoteIdentityKeyPair;
	readonly pairingId: string;
	/** 桌面端自己在中继上的密钥。 */
	readonly relaySecret: string;
	/** 手机密钥的哈希(中继据此只认那一台手机)。 */
	readonly mobileSecretHash: string;
	/**
	 * 手机密钥本身。桌面端生成它(`randomToken(32)`)、只把哈希交给中继,明文放进邀请里(二维码或中继信箱)等手机来领。
	 *
	 * 注意它**同时是手机的身份密钥**(X25519),所以必须是 32 字节的 base64url,不能是任意口令。
	 * 它**不落盘、不进日志**;被领取之后应当从内存里清掉。
	 */
	readonly mobileSecret: string;
	readonly relayBaseUrl: string;
	readonly createTransport: (url: string, protocols: readonly string[]) => RemoteTransport;
	/**
	 * 重连间隔。测试里调小,生产用默认(0.5s→15s 退避)。
	 *
	 * 桌面端**必须能自己重连**:它停在中继上等手机,中继重启、网络抖动都会断开;
	 * 断了不重连的话,手机那头会一直"正在重连",而电脑显示"不在线"。
	 */
	readonly reconnectDelaysMs?: readonly number[];
	readonly mailbox: RemoteMailbox;
	/**
	 * 已钉住的对端身份(首次配对成功之后由服务写下来)。
	 * 给了它,换了一把身份密钥的来者会在**派生任何密钥之前**被拒 —— 中继那层之外的第二道身份校验。
	 */
	readonly expectedPeerIdentityKey?: Uint8Array;
	/**
	 * 链路状态变了(连上中继、掉了、手机走了)就回调一次。
	 *
	 * 少了它,界面只在"有人接上来"时更新:手机关掉之后设备列表还显示"在线",用户以为还连着。
	 */
	readonly onStateChanged?: () => void;
	/** 有一台设备接上来时回调(服务据此弹系统通知、把身份钉住、并作废邀请)。 */
	readonly onDeviceConnected?: (device: { readonly identityKey: string; readonly deviceName?: string }) => void;
	readonly logger?: RemoteLogger;
	readonly now?: () => number;
	readonly inviteTtlMs?: number;
}

const DEFAULT_INVITE_TTL_MS = 10 * 60_000;
/**
 * `@` 搜出来的最多几条。
 *
 * 与桌面端同一个量级(它取 50):一次按键给回来的东西必须**能一眼扫完** ——
 * 手机上滚三屏还没到底,那就不叫"搜到了"。本机侧也有一道夹取,这里再夹一次。
 */
const MAX_WORKSPACE_RESULTS = 50;
/** 查询串最多这么长。再长已经不是"找文件",是误粘贴。 */
const MAX_WORKSPACE_QUERY_CHARS = 200;
/** 一条消息最多带这么多引用。 */
const MAX_WORKSPACE_REFERENCES = 20;
/** 单个路径 / 名字的长度上限(与协议里的 id 上限同一个量级)。 */
const MAX_WORKSPACE_REFERENCE_CHARS = 512;
// 能力声明:远端据此知道"这台机器允许我做什么"。b 档只放行"换模型";
// 权限模式(c 档)是安全边界,必须另立一项,不能借这一项顺带放行。
const CAPABILITIES = {
	chat: true,
	sessionRead: true,
	sessionModel: true,
	sessionPermissions: true,
	sessionConnectors: true,
} as const;

export class RemoteHostService {
	private readonly options: RemoteHostServiceOptions;
	private readonly connection: RemoteConnection;
	private unsubscribeSurface: (() => void) | undefined;
	private invite: { readonly invite: RemoteInvite; readonly boxUrl: string; readonly token: string } | undefined;
	private started = false;

	constructor(options: RemoteHostServiceOptions) {
		this.options = options;
		this.connection = new RemoteConnection({
			role: "desktop",
			deviceId: options.deviceId,
			deviceName: options.deviceName,
			capabilities: CAPABILITIES,
			identity: options.identity,
			// 桌面端主动连中继,然后**停在那儿等手机出现** —— 所以握手要等手机上线才完成,
			// 而且**不能给它设超时**(`0` = 不超时):那会把"在等手机"误报成"连不上中继",并莫名断开。
			handshake: "initiate",
			handshakeTimeoutMs: 0,
			// 断了就自己接回来:地址与凭据都在手上,不需要用户做任何事。
			reconnect: async () =>
				this.options.createTransport(
					`${this.options.relayBaseUrl}/v2/relay/${this.options.pairingId}/desktop`,
					[
						"wordless.remote.v2",
						`wordless.pairing.${this.options.relaySecret}`,
						`wordless.peer.${this.options.mobileSecretHash}`,
					],
				),
			...(this.options.reconnectDelaysMs === undefined
				? {}
				: { reconnectDelaysMs: this.options.reconnectDelaysMs }),
			...(options.expectedPeerIdentityKey === undefined
				? {}
				: { expectedPeerIdentityKey: options.expectedPeerIdentityKey }),
			...(options.logger === undefined ? {} : { logger: options.logger }),
		});
		this.connection.onEvent((event) => this.handleConnectionEvent(event));
	}

	get state(): string {
		return this.connection.state;
	}

	/** 连上中继并开始把本机事件推出去。可以重复调用(重连)。 */
	async start(): Promise<void> {
		const protocols = [
			"wordless.remote.v2",
			`wordless.pairing.${this.options.relaySecret}`,
			`wordless.peer.${this.options.mobileSecretHash}`,
		];
		this.unsubscribeSurface ??= this.options.surface.subscribe((event) => this.publishSurfaceEvent(event));
		this.started = true;
		await this.connection.connect(
			this.options.createTransport(`${this.options.relayBaseUrl}/v2/relay/${this.options.pairingId}/desktop`, protocols),
		);
	}

	async stop(): Promise<void> {
		this.unsubscribeSurface?.();
		this.unsubscribeSurface = undefined;
		this.started = false;
		await this.connection.close("desktop service stopped");
	}

	/**
	 * 生成一次配对材料:8 位连接码 + 6 位密码,二维码只装这两样;
	 * 真正的配对信息用它们加密后放进中继信箱(中继只看到连接码的哈希)。
	 */
	async createInvite(): Promise<RemoteInvite> {
		const now = this.options.now?.() ?? Date.now();
		const code = generateInviteCode();
		const password = generateInvitePassword();
		const expiresAt = now + (this.options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS);
		const invite: RemoteInvite = {
			pairingId: this.options.pairingId,
			code,
			formattedCode: formatInviteCode(code),
			password,
			// 二维码默认指向**中继上的网页**:手机相机扫到直接打开并自动配对,一个字都不用敲。
			// 中继与网页同域,所以从 ws:// 换成 http:// 就是网页地址。
			qrText: buildInviteQr({ code, password, webBaseUrl: webBaseUrl(this.options.relayBaseUrl) }),
			expiresAt,
		};
		const boxUrl = inviteBoxUrl(this.options.relayBaseUrl, inviteBoxId(code));
		const token = randomToken(32);
		const envelope = await sealInvite(this.inviteUri(), code, password);
		await this.options.mailbox.publish(boxUrl, token, envelope);
		this.invite = { invite, boxUrl, token };
		return invite;
	}

	/** 撤回当前邀请(用户点了刷新,或邀请被领取之后)。 */
	async withdrawInvite(): Promise<void> {
		const current = this.invite;
		if (!current) return;
		this.invite = undefined;
		await this.options.mailbox.withdraw(current.boxUrl, current.token).catch(() => undefined);
	}

	/**
	 * 手机上配对时用的那份信息:配对 id、中继地址、以及**手机自己的长期密钥**。
	 * 它只经加密信封(信箱)或二维码流动,不直接展示给用户;手机拿到它就等于"这台机器的凭据"。
	 */
	private inviteUri(): string {
		const params = new URLSearchParams({
			v: "2",
			pairingId: this.options.pairingId,
			relay: this.options.relayBaseUrl,
			secret: this.options.mobileSecret,
		});
		return `wordless://pair?${params.toString()}`;
	}

	private handleConnectionEvent(event: RemoteConnectionEvent): void {
		if (event.type === "remote-request") {
			void this.answer(event.request);
			return;
		}
		// 任何链路状态变化都要说一声(掉线也算),否则界面会停在旧状态。
		if (event.type === "state" || event.type === "peer-status") this.options.onStateChanged?.();
		// `state online` 是首次上线,`peer-status online` 是对端重连 —— 两者都算"有设备在用我"。
		if ((event.type === "state" && event.state === "online") || (event.type === "peer-status" && event.online)) {
			// 手机接上了:通知本机界面(它据此弹"有设备正在远程连接"),并让上层把身份钉住、作废邀请。
			const snapshot = this.connection.getSnapshot();
			this.connection.publishEvent("device.paired", {
				payload: { deviceId: this.connection.peerDeviceId ?? "unknown" },
			});
			if (snapshot.peerIdentityKey !== undefined) {
				this.options.onDeviceConnected?.({
					identityKey: snapshot.peerIdentityKey,
					...(this.connection.peerDeviceName === undefined ? {} : { deviceName: this.connection.peerDeviceName }),
				});
			}
		}
	}

	/**
	 * 附件上传的暂存区。
	 *
	 * 放在内存里、有大小上限、有存活时间 —— 三样都要有:
	 * 内存是因为**不落盘**;上限是因为手机可能传一半就没影了;存活时间是因为没人来收的半截文件
	 * 不该一直占着地方。清理**不用定时器**(定时器要么泄漏、要么让进程不肯退出),而是在每次
	 * 收到新的上传请求时顺手扫一遍。
	 */
	private readonly uploads = new Map<
		string,
		{ readonly name: string; readonly mediaType: string; readonly size: number; readonly chunks: Map<number, Buffer>; readonly startedAt: number; received: number }
	>();

	private handleAttachment(
		payload: unknown,
	):
		| { readonly ok: true; readonly payload: unknown }
		| { readonly ok: false; readonly code: "invalid_frame" | "model_unavailable"; readonly message: string } {
		this.sweepUploads();
		if (typeof payload !== "object" || payload === null) {
			return { ok: false, code: "invalid_frame", message: "attachment payload is required" };
		}
		const phase = (payload as { phase?: unknown }).phase;
		const uploadId = (payload as { uploadId?: unknown }).uploadId;
		if (typeof uploadId !== "string" || uploadId.length === 0 || uploadId.length > 128) {
			return { ok: false, code: "invalid_frame", message: "uploadId is required" };
		}
		if (phase === "begin") {
			const record = payload as { name?: unknown; mediaType?: unknown; size?: unknown };
			if (typeof record.name !== "string" || typeof record.size !== "number") {
				return { ok: false, code: "invalid_frame", message: "name and size are required" };
			}
			const rejection = checkAttachment({ name: record.name, size: record.size });
			if (rejection) return { ok: false, code: "model_unavailable", message: rejection.message };
			if (this.uploads.size >= ATTACHMENT_MAX_FILES) {
				return { ok: false, code: "model_unavailable", message: `一次最多发 ${ATTACHMENT_MAX_FILES} 个文件,先把这一轮发出去。` };
			}
			this.uploads.set(uploadId, {
				name: record.name,
				mediaType: typeof record.mediaType === "string" && record.mediaType.length > 0 ? record.mediaType : "application/octet-stream",
				size: record.size,
				chunks: new Map(),
				startedAt: this.now(),
				received: 0,
			});
			return { ok: true, payload: { accepted: true, chunkBytes: ATTACHMENT_CHUNK_BYTES } };
		}
		const upload = this.uploads.get(uploadId);
		if (!upload) return { ok: false, code: "invalid_frame", message: "upload is not started" };
		if (phase === "abort") {
			this.uploads.delete(uploadId);
			return { ok: true, payload: { accepted: true } };
		}
		if (phase !== "chunk") return { ok: false, code: "invalid_frame", message: "unknown attachment phase" };
		const chunk = payload as { index?: unknown; base64?: unknown };
		if (typeof chunk.index !== "number" || !Number.isInteger(chunk.index) || chunk.index < 0) {
			return { ok: false, code: "invalid_frame", message: "chunk index must be a non-negative integer" };
		}
		if (typeof chunk.base64 !== "string" || chunk.base64.length === 0) {
			return { ok: false, code: "invalid_frame", message: "chunk base64 is required" };
		}
		const data = Buffer.from(chunk.base64, "base64");
		if (upload.received + data.byteLength > upload.size) {
			// 多出来的字节说明对端算错了(或有人塞东西):整条作废,而不是截断着收下。
			this.uploads.delete(uploadId);
			return { ok: false, code: "invalid_frame", message: "attachment is larger than declared" };
		}
		upload.chunks.set(chunk.index, data);
		upload.received += data.byteLength;
		return { ok: true, payload: { accepted: true, received: upload.received, total: upload.size } };
	}

	/** 把引用换成真正的附件(按顺序拼好分片)。引用不上就返回 "unknown"。 */
	private resolveAttachments(
		references: readonly { readonly uploadId: string }[],
	):
		| readonly { readonly name: string; readonly mediaType: string; readonly size: number; readonly base64: string }[]
		| "unknown" {
		const resolved: Array<{ readonly name: string; readonly mediaType: string; readonly size: number; readonly base64: string }> = [];
		for (const reference of references) {
			const upload = this.uploads.get(reference.uploadId);
			if (!upload || upload.received !== upload.size) return "unknown";
			const parts: Buffer[] = [];
			for (let index = 0; index < attachmentChunkCount(upload.size); index += 1) {
				const part = upload.chunks.get(index);
				if (!part) return "unknown";
				parts.push(part);
			}
			resolved.push({
				name: upload.name,
				mediaType: upload.mediaType,
				size: upload.size,
				base64: Buffer.concat(parts).toString("base64"),
			});
			this.uploads.delete(reference.uploadId);
		}
		return resolved;
	}

	/** 清掉过期与半截的上传。顺手做,不另设定时器。 */
	private sweepUploads(): void {
		const now = this.now();
		for (const [uploadId, upload] of this.uploads) {
			if (now - upload.startedAt > ATTACHMENT_UPLOAD_TTL_MS) this.uploads.delete(uploadId);
		}
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}

	private async answer(request: RemoteRequest): Promise<void> {
		let result: RemoteRequestResult;
		try {
			result = await this.dispatch(request);
		} catch (error) {
			result = {
				success: false,
				error: {
					code: "internal_error",
					message: error instanceof Error ? error.message : "unknown failure",
					retryable: false,
				},
			};
		}
		await this.connection.respondToRequest(request.requestId, result);
	}

	private async dispatch(request: RemoteRequest): Promise<RemoteRequestResult> {
		const sessionId = request.sessionId;
		switch (request.method) {
			case "device.status":
				return {
					success: true,
					payload: {
						deviceId: this.options.deviceId,
						deviceName: this.options.deviceName,
						online: this.connection.state === "online",
					},
				};
			case "diagnostics.snapshot":
				// 只给连接诊断元数据:不含凭据、不含会话内容。
				return { success: true, payload: this.connection.getSnapshot() };
			case "session.list":
				return { success: true, payload: { sessions: await this.options.surface.listSessions() } };
			case "session.resync": {
				const sessions = await this.options.surface.listSessions();
				if (sessionId === undefined) return { success: true, payload: { sessions } };
				const detail = await this.options.surface.openSession(sessionId);
				if (!detail) return notFound(sessionId);
				return { success: true, payload: { sessions, session: detail } };
			}
			case "session.open": {
				if (sessionId === undefined) return missingSession();
				const detail = await this.options.surface.openSession(sessionId);
				if (!detail) return notFound(sessionId);
				return { success: true, payload: detail };
			}
			case "session.history": {
				if (sessionId === undefined) return missingSession();
				const cursor = readCursor(request.payload);
				return { success: true, payload: await this.options.surface.historyPage(sessionId, cursor) };
			}
			case "session.prompt": {
				if (sessionId === undefined) return missingSession();
				const text = readPromptText(request.payload);
				if (text === "invalid") {
					return { success: false, error: { code: "invalid_frame", message: "prompt text must be a string", retryable: false } };
				}
				const skillIds = readSkillIds(request.payload);
				// 引用:形状不对就**整条拒掉**,而不是丢掉那一条继续发 —— 少一个文件而用户不知道,
				// 比报错糟得多(与附件同一条纪律)。
				const references = readWorkspaceReferences(request.payload);
				if (references === "too_many") {
					return {
						success: false,
						error: { code: "invalid_frame", message: `一条消息最多带 ${MAX_WORKSPACE_REFERENCES} 个文件引用`, retryable: false },
					};
				}
				if (references === "invalid") {
					return {
						success: false,
						error: { code: "invalid_frame", message: "references must be a list of { path, name, kind }", retryable: false },
					};
				}
				// 附件:把已上传的分片交回本机(引用不上就直接拒,而不是悄悄少发一个文件)。
				const attachments = this.resolveAttachments(readAttachmentReferences(request.payload));
				if (attachments === "unknown") {
					return {
						success: false,
						error: { code: "not_found", message: "有附件没传完或已经过期,请重新发送", retryable: false },
					};
				}
				/*
					**正文可以为空** —— 但那时候必须有引用或附件撑着。
					
					一条只挑了文件、一个字都没打的消息是合法的(桌面端也允许:挑一个文件就是在问
					"这个怎么了")。但**三者都空**的消息没有意义,仍然拒掉 —— 那是调用方搞错了,
					不是用户在说话。
				*/
				if (text.trim().length === 0 && references.length === 0 && attachments.length === 0) {
					return { success: false, error: { code: "invalid_frame", message: "prompt text is required", retryable: false } };
				}
				await this.options.surface.prompt(sessionId, text, skillIds, attachments, references);
				return { success: true, payload: { accepted: true } };
			}
			case "session.mode": {
				if (sessionId === undefined) return missingSession();
				const mode = readMode(request.payload);
				if (mode === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "mode must be default, plan or clarify", retryable: false },
					};
				}
				try {
					await this.options.surface.setMode(sessionId, mode);
				} catch {
					return { success: false, error: { code: "busy", message: "正在回复中,等它说完再改", retryable: false } };
				}
				const detail = await this.options.surface.openSession(sessionId);
				return detail === undefined ? notFound(sessionId) : { success: true, payload: { summary: detail.summary } };
			}
			case "session.approval": {
				if (sessionId === undefined) return missingSession();
				const decision = readApprovalDecision(request.payload);
				if (decision === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "approvalId and approved are required", retryable: false },
					};
				}
				try {
					await this.options.surface.resolveApproval(sessionId, decision.approvalId, decision.approved, decision.feedback);
				} catch {
					// 审批可能已经被电脑上的人回答了(或者超时了)—— 那是"这条已经不在了",不是失败。
					return {
						success: false,
						error: { code: "not_found", message: "这条审批已经不在了(可能已在电脑上处理)", retryable: false },
					};
				}
				return { success: true, payload: { accepted: true } };
			}
			case "session.attachment": {
				const result = this.handleAttachment(request.payload);
				if (result.ok) return { success: true, payload: result.payload };
				return { success: false, error: { code: result.code, message: result.message, retryable: false } };
			}
			case "session.workspace-files": {
				if (sessionId === undefined) return missingSession();
				const query = readWorkspaceQuery(request.payload);
				if (query === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "query must be a string", retryable: false },
					};
				}
				const entries = await this.options.surface.searchWorkspaceFiles(sessionId, query);
				// 本机给的条数**再夹一次**:上限只有一处会漂,而漂了就是"手机上滚不到头"。
				return { success: true, payload: { entries: entries.slice(0, MAX_WORKSPACE_RESULTS) } };
			}
			case "session.usage": {
				if (sessionId === undefined) return missingSession();
				const usage = await this.options.surface.sessionUsage(sessionId);
				return usage === undefined ? notFound(sessionId) : { success: true, payload: usage };
			}
			case "session.compact": {
				if (sessionId === undefined) return missingSession();
				try {
					await this.options.surface.compact(sessionId);
				} catch {
					return { success: false, error: { code: "busy", message: "正在回复中,等它说完再压缩", retryable: false } };
				}
				return { success: true, payload: { accepted: true } };
			}
			case "session.version": {
				if (sessionId === undefined) return missingSession();
				const selection = readVersionSelection(request.payload);
				if (selection === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "messageId and version are required", retryable: false },
					};
				}
				try {
					await this.options.surface.selectVersion(sessionId, selection.messageId, selection.version);
				} catch {
					return {
						success: false,
						error: { code: "busy", message: "换不了这一版(可能正在回复,或者这一轮没有别的版本)", retryable: false },
					};
				}
				return { success: true, payload: { accepted: true } };
			}
			case "session.expert": {
				if (sessionId === undefined) return missingSession();
				const selection = readExpertSelection(request.payload);
				if (selection === "invalid") {
					return {
						success: false,
						error: { code: "invalid_frame", message: "selection must be null or { kind, id, version }", retryable: false },
					};
				}
				try {
					await this.options.surface.setExpert(sessionId, selection);
				} catch {
					return {
						success: false,
						error: { code: "busy", message: "换不了专家(可能正在回复,或这个会话不支持专家团)", retryable: false },
					};
				}
				const detail = await this.options.surface.openSession(sessionId);
				return detail === undefined ? notFound(sessionId) : { success: true, payload: { summary: detail.summary } };
			}
			case "session.user-request": {
				if (sessionId === undefined) return missingSession();
				const resolution = readUserRequestResolution(request.payload);
				if (resolution === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "requestId and status are required", retryable: false },
					};
				}
				try {
					await this.options.surface.resolveUserRequest(sessionId, resolution.requestId, {
						status: resolution.status,
						...(resolution.answers === undefined ? {} : { answers: resolution.answers }),
					});
				} catch {
					return {
						success: false,
						error: { code: "not_found", message: "这个提问已经不在了(可能已在电脑上回答)", retryable: false },
					};
				}
				return { success: true, payload: { accepted: true } };
			}
			case "session.permissions": {
				if (sessionId === undefined) return missingSession();
				const patch = readPermissions(request.payload);
				if (patch === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "accessLevel or toolApprovalMode is required", retryable: false },
					};
				}
				try {
					await this.options.surface.setPermissions(sessionId, patch);
				} catch {
					return {
						success: false,
						error: { code: "busy", message: "正在回复中,等它说完再改", retryable: false },
					};
				}
				const detail = await this.options.surface.openSession(sessionId);
				return detail === undefined ? notFound(sessionId) : { success: true, payload: { summary: detail.summary } };
			}
			case "session.connectors": {
				if (sessionId === undefined) return missingSession();
				const connectorIds = readConnectorIds(request.payload);
				if (connectorIds === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "connectorIds must be an array of ids", retryable: false },
					};
				}
				try {
					await this.options.surface.setConnectors(sessionId, connectorIds);
				} catch {
					// 本机只会在"连接器没启用/不存在"或"正在回复"时拒绝 —— 两句都归到"现在改不了"。
					return {
						success: false,
						error: { code: "model_unavailable", message: "这些连接器现在用不了(可能没启用,或正在回复)", retryable: false },
					};
				}
				const detail = await this.options.surface.openSession(sessionId);
				return detail === undefined ? notFound(sessionId) : { success: true, payload: { summary: detail.summary } };
			}
			case "session.retry-turn": {
				if (sessionId === undefined) return missingSession();
				const messageId = readMessageId(request.payload);
				if (messageId === undefined) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "messageId is required", retryable: false },
					};
				}
				try {
					await this.options.surface.retryTurn(sessionId, messageId);
				} catch {
					// 本机只会在"不是最新一轮"或"正在跑"时拒绝 —— 那是用户要听懂的两件事之一。
					return {
						success: false,
						error: { code: "busy", message: "只能重做最新一轮,而且要在它跑完之后", retryable: false },
					};
				}
				return { success: true, payload: { accepted: true } };
			}
			case "catalog.list": {
				// 新建会话页要的那一份:工作类型 + 连接器 + 技能(与桌面端 WelcomeView 同一份来源)。
				return { success: true, payload: await this.options.surface.listCatalog() };
			}
			case "session.create": {
				const input = readCreateSession(request.payload);
				if (!input) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "entryId and text are required", retryable: false },
					};
				}
				let summary: RemoteSessionSummary | undefined;
				try {
					summary = await this.options.surface.createSession(input);
				} catch {
					// 运行时会因为"入口不可用 / 没配到合适的模型"拒绝 —— 对用户是同一件事:现在建不了。
					return {
						success: false,
						error: {
							code: "model_unavailable",
							message: "这个工作类型现在用不了(可能入口没配好,或者没有可用的模型)",
							retryable: false,
						},
					};
				}
				if (!summary) {
					return {
						success: false,
						error: { code: "model_unavailable", message: "这个工作类型现在用不了", retryable: false },
					};
				}
				return { success: true, payload: { summary } };
			}
			case "session.model": {
				if (sessionId === undefined) return missingSession();
				const selection = readModelSelection(request.payload);
				if (!selection) {
					return {
						success: false,
						error: { code: "invalid_frame", message: "connectionId and modelId are required", retryable: false },
					};
				}
				const result = await this.options.surface.setModel(
					sessionId,
					{ connectionId: selection.connectionId, modelId: selection.modelId },
					selection.thinkingLevel,
				);
				if (result.ok) return { success: true, payload: { summary: result.summary } };
				switch (result.reason) {
					case "not_found":
						return notFound(sessionId);
					case "busy":
						return {
							success: false,
							error: { code: "busy", message: "正在回复中,等它说完再换模型", retryable: false },
						};
					case "unavailable":
						return {
							success: false,
							error: {
								code: "model_unavailable",
								message: "这个模型在这个会话里用不了(可能已停用,或与这个会话的工作类型不兼容)",
								retryable: false,
							},
						};
					default:
						// 真的出错了(写盘失败之类):告诉用户可以重试,而不是把它说成"模型用不了"。
						return {
							success: false,
							error: { code: "internal_error", message: "换模型失败", retryable: true },
						};
				}
			}
			case "session.abort": {
				if (sessionId === undefined) return missingSession();
				await this.options.surface.abort(sessionId);
				return { success: true, payload: { aborted: true } };
			}
			default:
				// 只做对话:其余方法一律拒绝,而不是"先答应再报错"。
				return {
					success: false,
					error: { code: "not_found", message: `unsupported method: ${request.method}`, retryable: false },
				};
		}
	}

	private publishSurfaceEvent(event: RemoteSurfaceEvent): void {
		if (!this.started) return;
		switch (event.type) {
			case "message":
				this.connection.publishEvent("session.message", {
					sessionId: event.sessionId,
					payload: event.message,
				});
				return;
			case "tool":
				this.connection.publishEvent("session.tool", {
					sessionId: event.sessionId,
					payload: {
						...(event.name === undefined ? {} : { name: event.name }),
						...(event.callId === undefined ? {} : { callId: event.callId }),
						...(event.turnId === undefined ? {} : { turnId: event.turnId }),
						state: event.state,
						...(event.args === undefined ? {} : { args: event.args }),
						...(event.activity === undefined ? {} : { activity: event.activity }),
						...(event.detail === undefined ? {} : { detail: event.detail }),
					},
				});
				return;
			case "state":
				this.connection.publishEvent("session.state", {
					sessionId: event.sessionId,
					payload: {
						running: event.running,
						...(event.activity === undefined ? {} : { activity: event.activity }),
					},
				});
				return;
			case "delta":
				this.connection.publishEvent("session.message.delta", {
					sessionId: event.sessionId,
					payload: {
						messageId: event.messageId,
						role: event.role,
						...(event.kind === undefined ? {} : { kind: event.kind }),
						...(event.turnId === undefined ? {} : { turnId: event.turnId }),
						text: event.text,
					},
				});
				return;
			case "approval":
				this.connection.publishEvent("session.approval", {
					sessionId: event.sessionId,
					payload: {
						approvalId: event.approvalId,
						toolName: event.toolName,
						summary: event.summary,
						...(event.args === undefined ? {} : { args: event.args }),
						...(event.severity === undefined ? {} : { severity: event.severity }),
					},
				});
				return;
			case "user-request":
				this.connection.publishEvent("session.user-request", {
					sessionId: event.sessionId,
					payload: { request: event.request },
				});
				return;
			case "user-request-resolved":
				this.connection.publishEvent("session.user-request", {
					sessionId: event.sessionId,
					payload: { requestId: event.requestId, resolved: true },
				});
				return;
			case "approval-resolved":
				// 任何一端解决了都要告诉所有设备:否则手机上的卡片会一直挂着(而它早就被批准了)。
				this.connection.publishEvent("session.approval", {
					sessionId: event.sessionId,
					payload: { approvalId: event.approvalId, resolved: true },
				});
				return;
			case "context":
				// 用量单独发一条:`running` 与用量是两个独立的事实,合在一起会让"只更新用量"
				// 变成"顺带把运行状态改成 false"(远端那行状态会闪一下)。
				this.connection.publishEvent("session.state", {
					sessionId: event.sessionId,
					payload: { context: event.context },
				});
				return;
			case "sessions-changed":
				this.connection.publishEvent("session.list", { payload: { changed: true } });
				return;
			default:
				return;
		}
	}
}

function notFound(sessionId: string): RemoteRequestResult {
	return {
		success: false,
		error: { code: "not_found", message: `session not found: ${sessionId}`, retryable: false },
	};
}

function missingSession(): RemoteRequestResult {
	return {
		success: false,
		error: { code: "invalid_frame", message: "sessionId is required for this method", retryable: false },
	};
}

function readText(payload: unknown): string | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const text = (payload as { text?: unknown }).text;
	return typeof text === "string" && text.trim().length > 0 ? text : undefined;
}

/**
 * 消息正文。
 *
 * 与 `readText` 的差别只有一处:**空串是合法值**。一条只挑了工作区文件、一个字都没打的消息
 * 就是这样(与桌面端一样),所以这里不能把"空"当成"没有" —— 那会把合法的消息说成非法。
 * 但"根本不是字符串"仍然要拒:那说明调用方搞错了,不是用户在说话。
 */
function readPromptText(payload: unknown): string | "invalid" {
	if (typeof payload !== "object" || payload === null) return "invalid";
	const text = (payload as { text?: unknown }).text;
	return typeof text === "string" ? text : "invalid";
}

/**
 * 权限补丁。
 *
 * **严格按白名单取值**:认不出来的值不猜(猜错等于替用户放宽了权限)。
 * 两个字段都可以给,但至少要有一个 —— 空补丁说明调用方搞错了。
 */
function readPermissions(
	payload: unknown,
): { readonly accessLevel?: "default" | "full"; readonly toolApprovalMode?: "manual" | "auto" | "bypass" } | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const record = payload as { accessLevel?: unknown; toolApprovalMode?: unknown };
	const patch: { accessLevel?: "default" | "full"; toolApprovalMode?: "manual" | "auto" | "bypass" } = {};
	if (record.accessLevel === "default" || record.accessLevel === "full") patch.accessLevel = record.accessLevel;
	if (record.toolApprovalMode === "manual" || record.toolApprovalMode === "auto" || record.toolApprovalMode === "bypass") {
		patch.toolApprovalMode = record.toolApprovalMode;
	}
	return Object.keys(patch).length === 0 ? undefined : patch;
}

/** 连接器 id 列表:必须是字符串数组(空数组是合法值 —— 意思是"这个会话不用连接器")。 */
function readConnectorIds(payload: unknown): readonly string[] | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const connectorIds = (payload as { connectorIds?: unknown }).connectorIds;
	if (!Array.isArray(connectorIds)) return undefined;
	return connectorIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/**
 * 提问的回答。
 *
 * 答案的值只允许 `string | string[] | boolean`(与协议一致):别的形状一律丢掉 ——
 * 答案要回到模型那里,形状错了就是"答非所问"。
 */
function readUserRequestResolution(
	payload: unknown,
): { readonly requestId: string; readonly status: "submitted" | "cancelled"; readonly answers?: Record<string, unknown> } | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const record = payload as { requestId?: unknown; status?: unknown; answers?: unknown };
	if (typeof record.requestId !== "string" || record.requestId.length === 0) return undefined;
	if (record.status !== "submitted" && record.status !== "cancelled") return undefined;
	if (record.answers === undefined) return { requestId: record.requestId, status: record.status };
	if (typeof record.answers !== "object" || record.answers === null || Array.isArray(record.answers)) return undefined;
	const answers: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record.answers as Record<string, unknown>)) {
		if (typeof value === "string" || typeof value === "boolean") answers[key] = value;
		else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) answers[key] = value;
	}
	return { requestId: record.requestId, status: record.status, answers };
}

/** 附件引用:一个 `uploadId` 数组(缺省就是没有附件)。 */
function readAttachmentReferences(payload: unknown): readonly { readonly uploadId: string }[] {
	if (typeof payload !== "object" || payload === null) return [];
	const attachments = (payload as { attachments?: unknown }).attachments;
	if (!Array.isArray(attachments)) return [];
	return attachments
		.map((entry) => {
			if (typeof entry !== "object" || entry === null) return undefined;
			const uploadId = (entry as { uploadId?: unknown }).uploadId;
			return typeof uploadId === "string" && uploadId.length > 0 ? { uploadId } : undefined;
		})
		.filter((entry): entry is { readonly uploadId: string } => entry !== undefined);
}

/** 切哪一版:`{ messageId, version }`,版本从 1 开始。 */
function readVersionSelection(payload: unknown): { readonly messageId: string; readonly version: number } | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const record = payload as { messageId?: unknown; version?: unknown };
	if (typeof record.messageId !== "string" || record.messageId.length === 0) return undefined;
	if (typeof record.version !== "number" || !Number.isInteger(record.version) || record.version < 1) return undefined;
	return { messageId: record.messageId, version: record.version };
}

/** 专家选择:`null`(不用)或 `{ kind, id, version }`。 */
function readExpertSelection(
	payload: unknown,
): { readonly kind: "expert" | "team"; readonly id: string; readonly version: string } | null | "invalid" {
	if (typeof payload !== "object" || payload === null) return "invalid";
	const selection = (payload as { selection?: unknown }).selection;
	if (selection === null) return null;
	if (typeof selection !== "object" || selection === undefined) return "invalid";
	const record = selection as { kind?: unknown; id?: unknown; version?: unknown };
	if (record.kind !== "expert" && record.kind !== "team") return "invalid";
	if (typeof record.id !== "string" || record.id.length === 0) return "invalid";
	if (typeof record.version !== "string" || record.version.length === 0) return "invalid";
	return { kind: record.kind, id: record.id, version: record.version };
}

/** 交互模式:三档之一。 */
function readMode(payload: unknown): "default" | "plan" | "clarify" | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const mode = (payload as { mode?: unknown }).mode;
	return mode === "default" || mode === "plan" || mode === "clarify" ? mode : undefined;
}

/** 审批决定:`{ approvalId, approved, feedback? }`。 */
function readApprovalDecision(
	payload: unknown,
): { readonly approvalId: string; readonly approved: boolean; readonly feedback?: string } | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const record = payload as { approvalId?: unknown; approved?: unknown; feedback?: unknown };
	if (typeof record.approvalId !== "string" || record.approvalId.length === 0) return undefined;
	if (typeof record.approved !== "boolean") return undefined;
	return {
		approvalId: record.approvalId,
		approved: record.approved,
		...(typeof record.feedback === "string" && record.feedback.length > 0 ? { feedback: record.feedback } : {}),
	};
}

/** 这一轮用哪些技能:缺省是空数组(不选技能),给了就必须是字符串数组。 */
function readSkillIds(payload: unknown): readonly string[] | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const skillIds = (payload as { skillIds?: unknown }).skillIds;
	if (!Array.isArray(skillIds)) return undefined;
	return skillIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/**
 * `@` 的查询串。
 *
 * **空串是合法值**(意思是"还没打字,给我看这个工作区里有什么"),所以这里不能用
 * `readText` 那一套"空就是没有"的判断 —— 那会让刚敲下 `@` 的那一刻什么都不发生。
 * 长度必须封顶:查询串会一路交给本机的搜索,而单帧可以到 1.5M 字符。
 */
function readWorkspaceQuery(payload: unknown): string | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const query = (payload as { query?: unknown }).query;
	if (typeof query !== "string") return undefined;
	return query.slice(0, MAX_WORKSPACE_QUERY_CHARS);
}

/**
 * 随消息一起发的工作区引用。
 *
 * 与附件同一条纪律:**形状不对就整条拒**,不做"尽量理解"。猜错一个路径等于让模型去读另一个文件,
 * 而用户完全看不出来 —— 那种错比一次明确的失败贵得多。
 */
function readWorkspaceReferences(payload: unknown): readonly RemoteWorkspaceReference[] | "invalid" | "too_many" {
	if (typeof payload !== "object" || payload === null) return [];
	const value = (payload as { references?: unknown }).references;
	if (value === undefined) return [];
	if (!Array.isArray(value)) return "invalid";
	// 超量单独给一句人话:它和"形状不对"不是一回事,而用户看到的消息要能照着做。
	if (value.length > MAX_WORKSPACE_REFERENCES) return "too_many";
	const references: RemoteWorkspaceReference[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) return "invalid";
		const record = entry as { path?: unknown; name?: unknown; kind?: unknown };
		if (record.kind !== "file" && record.kind !== "directory") return "invalid";
		if (!isUsableReferenceText(record.path) || !isUsableReferenceText(record.name)) return "invalid";
		references.push({ path: record.path, name: record.name, kind: record.kind });
	}
	return references;
}

function isUsableReferenceText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_WORKSPACE_REFERENCE_CHARS;
}

/** 重做哪一轮:`{ messageId }`。 */
function readMessageId(payload: unknown): string | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const messageId = (payload as { messageId?: unknown }).messageId;
	return typeof messageId === "string" && messageId.length > 0 ? messageId : undefined;
}

/** 换模型的选择:`{ connectionId, modelId }`,两者都必须是非空字符串。 */
function readModelSelection(
	payload: unknown,
):
	| { readonly connectionId: string; readonly modelId: string; readonly thinkingLevel?: RemoteThinkingLevel }
	| undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const connectionId = (payload as { connectionId?: unknown }).connectionId;
	const modelId = (payload as { modelId?: unknown }).modelId;
	if (typeof connectionId !== "string" || connectionId.length === 0) return undefined;
	if (typeof modelId !== "string" || modelId.length === 0) return undefined;
	// 思考等级**按值域收一道**:运行时收到不认识的档位会直接抛,而那会变成一句用户看不懂的失败。
	// 不认识的档位当作"没指定"(让运行时按模型夹一次),而不是把请求整条拒掉。
	const thinkingLevel = (payload as { thinkingLevel?: unknown }).thinkingLevel;
	return {
		connectionId,
		modelId,
		...(isRemoteThinkingLevel(thinkingLevel) ? { thinkingLevel } : {}),
	};
}

/**
 * 新建会话的入参。
 *
 * 值域照例**收一道**:`entryId`/`text` 必填;模型、思考等级、交互模式都是可选的,
 * 认不出来的取值当作"没指定"(让运行时按默认走),而不是把请求整条拒掉 ——
 * 拒掉的话用户看到的是"新建失败",而他什么都没做错。
 */
function readCreateSession(
	payload: unknown,
): Parameters<RemoteSessionSurface["createSession"]>[0] | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const record = payload as Record<string, unknown>;
	const entryId = record.entryId;
	const text = record.text;
	if (typeof entryId !== "string" || entryId.length === 0) return undefined;
	if (typeof text !== "string" || text.trim().length === 0) return undefined;
	const selection = readModelSelection(record.model);
	const thinkingLevel = record.thinkingLevel;
	const interactionMode = record.interactionMode;
	// 技能与连接器:只留字符串 id,其余一律当"没选"(而不是把请求整条拒掉)。
	const skillIds = Array.isArray(record.skillIds)
		? record.skillIds.filter((id): id is string => typeof id === "string" && id.length > 0)
		: [];
	const connectorIds = Array.isArray(record.connectorIds)
		? record.connectorIds.filter((id): id is string => typeof id === "string" && id.length > 0)
		: [];
	// 工作目录与设计风格:认不出来的值当"没给"(而不是整条拒)—— 与上面技能/连接器同一条规矩,
	// 真正该不该给由**会话面**判断(它才知道这个入口需不需要目录)。
	const workspaceId = typeof record.workspaceId === "string" && record.workspaceId.length > 0 ? record.workspaceId : undefined;
	const designStyleId =
		typeof record.designStyleId === "string" && record.designStyleId.length > 0 ? record.designStyleId : undefined;
	return {
		entryId,
		text: text.trim(),
		...(skillIds.length === 0 ? {} : { skillIds }),
		...(connectorIds.length === 0 ? {} : { connectorIds }),
		...(workspaceId === undefined ? {} : { workspaceId }),
		...(designStyleId === undefined ? {} : { designStyleId }),
		...(selection === undefined
			? {}
			: { model: { connectionId: selection.connectionId, modelId: selection.modelId } }),
		...(isRemoteThinkingLevel(thinkingLevel) ? { thinkingLevel } : {}),
		...(interactionMode === "default" || interactionMode === "plan" || interactionMode === "clarify"
			? { interactionMode }
			: {}),
	};
}

function readCursor(payload: unknown): string | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const cursor = (payload as { cursor?: unknown }).cursor;
	return typeof cursor === "string" && cursor.length > 0 ? cursor : undefined;
}

/** `wss://relay.example` → `https://relay.example`(中继与网页客户端同域)。 */
function webBaseUrl(relayBaseUrl: string): string {
	return relayBaseUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

/** 只给测试与日志用的错误整形:把 `RemoteError` 变成一行可读文本。 */
export function describeRemoteError(error: RemoteError): string {
	return `${error.code}: ${error.message}`;
}
