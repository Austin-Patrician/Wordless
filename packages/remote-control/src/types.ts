/**
 * 远程访问的线路合同。
 *
 * 这份文件是"两端怎么说话"的**唯一定义**:本机服务、中继、浏览器客户端都从这里取类型。
 * 之所以独立成包(而不是塞进 `@wordless/protocol`),是因为它要能被浏览器实现 —— 不能依赖 Electron、
 * 不能依赖 Node 专有 API、也不能依赖会话执行语义。
 *
 * 设计文档:`docs/architecture/remote-access.md`。
 */

/** 版本号是常量而不是配置:非法版本必须在边界被拒(见 `parseRemoteFrame`)。 */
export const REMOTE_PROTOCOL_VERSION = 2 as const;

/** WebSocket 子协议名。配对密钥也走子协议,因此**永不进 URL**(代理与日志只看得到 pairingId)。 */
export const REMOTE_WEBSOCKET_PROTOCOL = "wordless.remote.v2";

/**
 * 心跳。中继侧对它的应答由运行时自动完成,所以闲置配对**不会唤醒休眠对象、不产生计费时长**。
 */
export const KEEPALIVE_PING = "ping";
export const KEEPALIVE_PONG = "pong";

export type RemoteRole = "mobile" | "desktop" | "relay";
/** 真正参与握手的两种端点角色。中继不是端点。 */
export type RemoteEndpointRole = Exclude<RemoteRole, "relay">;

export type RemoteConnectionState =
	| "idle"
	| "connecting"
	| "pending_approval"
	| "online"
	| "recovering"
	| "reconnecting"
	| "closed"
	| "failed";

/**
 * 端点自报能力。远端据此隐藏做不到的操作,而不是让用户点了才失败。
 * 只做对话,所以目前只有两项。
 */
export interface RemoteCapabilities {
	readonly chat: boolean;
	readonly sessionRead: boolean;
	/**
	 * 远端能不能**改**会话设置(目前只有"换模型"这一件事)。
	 *
	 * 单独列一项而不是混进 `chat`:换模型会改变"谁在回答、花谁的钱",和"能不能发消息"不是一回事,
	 * 而且将来 c 档(权限模式)必须另立一项 —— 那是安全边界,不能靠这一项顺带放行。
	 * 可选是为了兼容:老版本不发它,远端就按"只能看"处理。
	 */
	readonly sessionModel?: boolean;
	/** 能不能改权限(访问权限 + 工具确认)。**默认关闭**:没有这一项的老实现只当只读。 */
	readonly sessionPermissions?: boolean;
	/** 能不能改这个会话用哪些连接器。 */
	readonly sessionConnectors?: boolean;
}

/**
 * 明文握手帧。身份公钥与临时公钥都是 X25519 公钥的 base64url(无填充)。
 * 中继读这一帧**只做两件事**:校验声明的角色、把公钥抄进对端的 `hello_ack`。
 */
export interface RemoteHello {
	readonly type: "hello";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly role: RemoteEndpointRole;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly connectionId: string;
	readonly identityKey: string;
	readonly ephemeralKey: string;
}

export interface RemoteHelloAck {
	readonly type: "hello_ack";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly connectionId: string;
	readonly peerDeviceId: string;
	/**
	 * 对端自报的名字。
	 *
	 * 之所以由中继抄进来:中继两端都**主动连**,hello 不会被转发,所以只有接受方能听到名字 ——
	 * 而经中继连接时双方都是发起方,桌面端就永远不知道"是哪台手机在用我"。
	 * 可选字段:旧实现忽略它,新实现容忍它缺席。
	 */
	readonly peerDeviceName?: string;
	readonly peerIdentityKey: string;
	readonly peerEphemeralKey: string;
}

/**
 * 接受方(本机服务)在需要**人在电脑前核对验证码**时发出。
 * 手动配对才用得上;扫码配对走的是钉住身份公钥。
 */
export interface RemotePairingPending {
	readonly type: "pairing_pending";
	readonly connectionId: string;
	readonly peerDeviceId: string;
	readonly peerIdentityKey: string;
}

/** 中继或接受方在对端来/走时发出。 */
export interface RemotePeerStatus {
	readonly type: "peer_status";
	readonly online: boolean;
}

/** 握手之后所有会话帧的外壳。中继只能转发它,打不开。 */
export interface RemoteSealed {
	readonly type: "sealed";
	readonly nonce: string;
	readonly ciphertext: string;
}

/** 只做对话所需的请求面(8 个)。新增方法要同时改这里与 `parseRemoteFrame` 的白名单。 */
export type RemoteRequestMethod =
	| "device.status"
	| "session.list"
	| "session.open"
	| "session.history"
	| "session.prompt"
	| "session.abort"
	/** b 档:换模型。**只换模型** —— 权限模式是 c 档,要单独设计。 */
	| "catalog.list"
	| "session.create"
	| "session.model"
	/** 重做某一轮(以它为末端重写之后的历史)。只在最新一轮上成立,由本机校验。 */
	| "session.retry-turn"
	/** 改权限(访问权限 + 工具确认)。**与桌面端同样的全量选择**,由本机校验。 */
	| "session.permissions"
	/** 改这个会话用哪些连接器(只能在**已启用**的里面挑,由本机校验)。 */
	| "session.connectors"
	/** 改交互模式(默认 / 计划 / 澄清)。 */
	| "session.mode"
	/** 回答一次工具审批(批准 / 拒绝 + 说明)。 */
	| "session.approval"
	/** 回答一次提问(提交答案,或取消)。 */
	| "session.user-request"
	/** 手动压缩上下文(把这一轮之前的对话收成摘要)。 */
	| "session.compact"
	/** 读这个会话的**总计**用量(桌面端用量详情里的"会话统计")。 */
	| "session.usage"
	/** 切换某一轮回复的版本。 */
	| "session.version"
	/** 换这个会话的专家 / 专家团(传 null = 不用)。 */
	| "session.expert"
	/**
	 * 上传一个附件(分片)。
	 *
	 * 为什么分片:单帧上限 1.5M 字符,而手机照片是几 MB —— 一帧装不下。
	 * 为什么走这条路而不是另开一个 HTTP 上传口:那条路上中继能看到明文,端到端加密就白做了。
	 */
	| "session.attachment"
	| "session.resync"
	| "diagnostics.snapshot";

export interface RemoteRequest {
	readonly type: "request";
	readonly requestId: string;
	readonly method: RemoteRequestMethod;
	/** 会话在协议里是**不透明 id**(本机侧用会话文件路径的哈希),不泄露路径。 */
	readonly sessionId?: string;
	readonly payload?: unknown;
}

/**
 * 附件上传的三个阶段。
 *
 * 用**一个方法 + 阶段**而不是三个方法:三者的校验都在同一处,而且"上传到一半"的状态
 * 只有一个来源。
 */
export type RemoteAttachmentPhase =
	| { readonly phase: "begin"; readonly uploadId: string; readonly name: string; readonly mediaType: string; readonly size: number }
	| { readonly phase: "chunk"; readonly uploadId: string; readonly index: number; readonly base64: string }
	| { readonly phase: "abort"; readonly uploadId: string };

/** 发消息时引用已上传的附件(按 uploadId)。 */
export interface RemoteAttachmentReference {
	readonly uploadId: string;
}

export interface RemoteResponse {
	readonly type: "response";
	readonly requestId: string;
	readonly success: boolean;
	readonly payload?: unknown;
	readonly error?: RemoteError;
}

export type RemoteEventName =
	| "device.status"
	/** 一台新设备配对成功(本机侧据此弹通知)。 */
	| "device.paired"
	/** 本机解除了这台设备的配对;发出后链路关闭。 */
	| "device.revoked"
	| "session.list"
	| "session.state"
	| "session.message"
	/** 助手正在写:同一条消息的**累积文本**(不是增量 —— 增量丢一帧就永远接不上)。 */
	| "session.message.delta"
	/** 有一个工具在等用户批准(远端据此弹卡片,批准后本机才会真的执行)。 */
	| "session.approval"
	/** 有一个提问等用户回答(不回答的话那一轮就停在那儿)。 */
	| "session.user-request"
	| "session.tool"
	| "session.input"
	/** 事件日志已补不上缺口,对端要整体重拉。 */
	| "session.resync"
	| "diagnostics.updated";

export interface RemoteEvent {
	readonly type: "event";
	readonly eventId: string;
	/** 单调递增。跨链路、跨重连都连续 —— 这是"只补缺失尾部"的前提。 */
	readonly sequence: number;
	readonly name: RemoteEventName;
	readonly sessionId?: string;
	readonly payload?: unknown;
}

export interface RemoteAck {
	readonly type: "ack";
	readonly sequence: number;
}

export interface RemoteResume {
	readonly type: "resume";
	readonly lastEventSequence: number;
}

export type RemoteErrorCode =
	| "invalid_frame"
	| "unsupported_version"
	| "unauthorized"
	| "approval_rejected"
	| "not_found"
	| "busy"
	/** 这个模型在这个会话里用不了(没启用 / 与工作类型不兼容 / 供应商没配好)。 */
	| "model_unavailable"
	/** 载荷超过单帧上限。**只让这一次请求失败,不关链路** —— 关链路会让用户以为"连不上"。 */
	| "payload_too_large"
	| "request_timeout"
	| "transport_closed"
	| "internal_error";

export interface RemoteError {
	readonly code: RemoteErrorCode;
	readonly message: string;
	/** 调用方据此决定"自动重试"还是"告诉用户"。 */
	readonly retryable: boolean;
}

/** 允许明文传输的帧:只有握手与中继自有状态。 */
export type RemoteHandshakeFrame = RemoteHello | RemoteHelloAck | RemotePairingPending | RemotePeerStatus;

/** 握手之后必须封在 `sealed` 里的帧。 */
export type RemoteSessionFrame = RemoteRequest | RemoteResponse | RemoteEvent | RemoteAck | RemoteResume;

export type RemoteFrame = RemoteHandshakeFrame | RemoteSealed | RemoteSessionFrame;

/** 诊断快照:只放"排查连接"需要的元数据,**绝不放凭据、prompt 或文件内容**。 */
export interface RemoteDiagnostics {
	readonly state: RemoteConnectionState;
	readonly deviceId: string;
	readonly connectionId: string;
	readonly lastEventSequence: number;
	readonly lastAckSequence: number;
	readonly pendingRequestCount: number;
	readonly reconnectCount: number;
	readonly lastRttMs?: number;
	readonly lastErrorCode?: RemoteErrorCode;
}

export interface RemoteLogger {
	debug(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
	info(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
	warn(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
}

export const NOOP_REMOTE_LOGGER: RemoteLogger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
};

/**
 * 传输层的**窄接口**:只有三个动作。WebSocket、WebRTC DataChannel、假传输都实现它,
 * 所以协议本身与"用哪条链路"无关。
 */
export interface RemoteTransport {
	connect(handlers: RemoteTransportHandlers): Promise<void>;
	send(frame: RemoteFrame): Promise<void>;
	/** `reason` 会尽量带给对端(WebSocket 关闭原因)。 */
	close(reason?: string): Promise<void>;
}

export interface RemoteTransportHandlers {
	onFrame(frame: RemoteFrame): void;
	onClose(reason?: string): void;
}

export interface RemoteIdentityKeyPair {
	readonly publicKey: Uint8Array;
	readonly secretKey: Uint8Array;
}

/**
 * 接受方对未知对端 `hello` 的裁决:`approve` 直接完成握手;`pending` 先让人核对验证码;
 * `reject` 关闭链路。默认只放行已钉住身份的对端。
 */
export type RemoteHelloDecision =
	| { readonly kind: "approve" }
	| { readonly kind: "pending"; readonly approval: Promise<boolean> }
	| { readonly kind: "reject"; readonly reason: string };

export interface RemoteEventJournalPort {
	nextSequence(): number;
	remember(event: RemoteEvent): void;
	acknowledge(sequence: number): void;
	/** 比 `afterSequence` 新的事件;已被淘汰时返回 `undefined`(对端必须整体重拉)。 */
	replay(afterSequence: number): readonly RemoteEvent[] | undefined;
	readonly lastSequence: number;
}

export interface RemoteConnectionOptions {
	readonly role: RemoteEndpointRole;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly identity: RemoteIdentityKeyPair;
	/**
	 * `initiate` 主动发 `hello` 并等 `hello_ack`(中继两端都是这种);
	 * `accept` 等对端 `hello` 再回 `hello_ack`(本机服务在被直连时用)。
	 */
	readonly handshake?: "initiate" | "accept";
	/** 已钉住的对端身份。换了身份的来者会在派生任何密钥之前被拒。 */
	readonly expectedPeerIdentityKey?: Uint8Array;
	/** 接受方钩子:未知对端能否配对。默认只放行已钉住的对端。 */
	readonly onHello?: (hello: RemoteHello) => Promise<RemoteHelloDecision> | RemoteHelloDecision;
	/** 与连接共用的出站事件日志(换链路时序号才不会断)。默认每连接一份。 */
	readonly journal?: RemoteEventJournalPort;
	/** 已经从对端收到的最大事件序号;握手后发给对端,让它补发更新的那些。 */
	readonly resumeFrom?: number;
	readonly connectionId?: string;
	readonly requestTimeoutMs?: number;
	/**
	 * 掉线之后怎么重新建链 —— **给了它才会真的重连**。
	 *
	 * 之前只有 `reconnecting` 这个状态、没有重连动作:任何一次掉线(手机切后台、Wi-Fi 抖动、
	 * 中继重启)都会让手机永远停在"正在重连"、电脑永远显示"不在线"。状态是给用户看的,
	 * 动作才是真的在做事 —— 两者必须一起有。
	 *
	 * 由调用方提供,因为只有它知道地址与凭据;`RemoteConnection` 只管重试节奏与握手。
	 */
	readonly reconnect?: () => Promise<RemoteTransport>;
	/** 重试间隔(毫秒),用完最后一个就一直用它。默认 0.5s→1s→2s→4s→8s→15s。 */
	readonly reconnectDelaysMs?: readonly number[];
	/**
	 * 握手超时(毫秒)。省略 = 默认 15 秒;**`0` = 不超时**。
	 *
	 * 为什么需要这个:桌面端连上中继后是**停在那儿等手机出现** —— 那是一种长期状态,不是"卡住了"。
	 * 给它设超时会导致"等不到手机就报错并断开",而用户看到的是"连不上中继"(一个假警报)。
	 * 手机端反过来:它应当超时并告诉用户,不能一直转圈。
	 */
	readonly handshakeTimeoutMs?: number;
	readonly logger?: RemoteLogger;
	readonly now?: () => number;
	readonly randomBytes?: (length: number) => Uint8Array;
}

export interface RemoteConnectionSnapshot extends RemoteDiagnostics {
	readonly peerDeviceId?: string;
	/** 对端在 `hello` 里自报的名字;**只有接受方**能听到。 */
	readonly peerDeviceName?: string;
	readonly peerCapabilities?: RemoteCapabilities;
	readonly peerIdentityKey?: string;
	/** 手动配对时两端对显的 6 位验证码。 */
	readonly verificationCode?: string;
}

export type RemoteConnectionEvent =
	| { readonly type: "state"; readonly state: RemoteConnectionState }
	| { readonly type: "remote-request"; readonly request: RemoteRequest }
	| { readonly type: "remote-event"; readonly event: RemoteEvent }
	| { readonly type: "peer-status"; readonly online: boolean }
	| { readonly type: "error"; readonly error: RemoteError };

// ── 会话载荷(远端看到的内容形状) ─────────────────────────────────────────────
//
// 这些类型放在**平台中立的协议包**里,而不是 `@wordless/protocol`(`@wordless/domain` 会被拖进浏览器包):
// 它们同时是主进程与网页端要读的形状,网页端只依赖这一个包。

/** 消息里的一段内容。远端要能看到**完整**的一条消息:正文、思考、工具执行。 */
export type RemoteMessageBlock =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "reasoning"; readonly text: string }
	| {
			readonly type: "tool";
			readonly callId: string;
			readonly name: string;
			/** 运行中的工具会由 `session.tool` 事件持续更新;这里的 state 是消息里的那一份快照。 */
			readonly state: "running" | "done" | "failed";
			/**
			 * 参数(命令行 / 文件路径 / 查询条件……),已经压成一段可读文本。
			 *
			 * 桌面端是"先命令、再参数、再输出";没有它,远端就只能显示一个工具名和一个结果,
			 * 用户看不出**它到底做了什么**。
			 */
			readonly args?: string;
			readonly detail?: string;
			/** 工具执行的时间(有就显示耗时)。 */
			readonly startedAt?: number;
			readonly completedAt?: number;
	  }
	| {
			/**
			 * 上下文被压缩了(用户手动点、或超出上限自动触发)。
			 *
			 * 桌面端把它画成时间线上的一行(压缩原因、压缩前后 token 数、用的哪个模型、摘要正文)。
			 * 远端原来**整条丢掉** —— 于是用户在手机上点了"压缩上下文"什么也看不见(真实抱怨)。
			 */
			readonly type: "compaction";
			/** 为什么压:用户点的 / 到阈值自动 / 超出上限。 */
			readonly trigger: "manual" | "automatic" | "overflow";
			readonly tokensBefore: number;
			readonly tokensAfter: number;
			readonly modelId?: string;
			/** 压缩出来的摘要正文(markdown)。 */
			readonly summary: string;
			readonly at: number;
	  };

export interface RemoteSessionMessage {
	/** 本机的消息 id。远端用它发起"重做这一轮"(`session.retry-turn`)。 */
	readonly id?: string;
	/** 这一轮的**回复版本**:重做过几次、现在看的是第几版(桌面端 footer 里有 1/3 那种切换)。 */
	readonly versions?: { readonly active: number; readonly total: number };
	/** 这一轮的用量摘要(与桌面端 footer 里的**同一份**数据)。 */
	readonly usage?: RemoteUsageSummary;
	/**
	 * `compaction` 不是"谁说的话",而是时间线上的一行 ——
	 * 它没有身份行、没有底部操作行,也不能被流式内容当成"这一轮的助手消息"写进去。
	 */
	readonly role: "user" | "assistant" | "compaction";
	/**
	 * 这一条属于**哪一轮**(运行时的 turn id)。
	 *
	 * 桌面端是按轮存消息的(store 里每一轮一个 key),所以它从不需要"猜"某条内容属于哪一轮。
	 * 远端只有一条平铺的消息列表 —— 没有这个 id 就只能按顺序猜,而顺序会错:
	 * 下一轮的助手内容可能在下一轮的用户消息**之前**到达,于是被写进上一轮(真实抱怨)。
	 */
	readonly turnId?: string;
	/** 纯文本正文(只有 text 块)。保留它是为了兼容与"快速复制"。 */
	readonly text: string;
	readonly at: number;
	/**
	 * 这条消息的状态。`error`/`aborted` 用来封闭工具执行突发 ——
	 * 不封闭的话它会永远转圈,看起来像"还卡着"。
	 */
	readonly status?: "streaming" | "complete" | "error" | "aborted";
	/** 完整内容。没有它时(旧实现)退化成只用 `text`。 */
	readonly blocks?: readonly RemoteMessageBlock[];
}

export interface RemoteSessionSummary {
	/** 不透明 id(本机侧用会话文件路径的哈希),不泄露路径。 */
	readonly id: string;
	readonly title: string;
	readonly updatedAt: number;
	readonly running: boolean;
	/** 所属空间。远端据此分区;只有 id 与名字,**没有路径**。 */
	readonly workspaceId?: string;
	readonly workspaceName?: string;
	/**
	 * 会话当前的设置,**只读**。
	 *
	 * 这一批是为了让手机上"看得见自己正在用什么":哪个模型、什么权限、连了几个连接器。
	 * 远端目前**不能改**它们(改是安全边界,见 docs/architecture/remote-web-client.md 的分档表)。
	 */
	readonly modelId?: string;
	/** 模型的人类名字(`displayName`)。没有它时远端只能显示 modelId。 */
	readonly modelName?: string;
	/**
	 * 当前模型挂在哪个连接上。
	 *
	 * 只为了**认出"清单里哪个是现在这个"** —— 没有它,远端只能拿 modelId 去猜(同名模型会认错),
	 * 也就没法在清单里标出"当前",更没法显示"这个模型是哪家"。
	 */
	readonly modelConnectionId?: string;
	/** 这个会话是哪种工作类型(新建页选的那个)。列表用它显示对应的图标。 */
	readonly entryId?: string;
	/** 这个会话现在的思考等级(只读地透出,与模型同一个道理)。 */
	readonly thinkingLevel?: RemoteThinkingLevel;
	readonly accessLevel?: "default" | "full";
	readonly toolApprovalMode?: "manual" | "auto" | "bypass";
	readonly connectorCount?: number;
	/**
	 * 这个会话连着的连接器。
	 *
	 * **只给名字与"开没开"**:远端目前不能改它们(改等于让手机把 agent 接到第三方服务上,
	 * 那是权限边界,要单独设计)。但没有名字的话,用户连"它现在能碰什么"都看不到。
	 */
	readonly connectors?: readonly RemoteConnectorSummary[];
	/** 可以在这个会话里用的技能(给「+」里的技能选择用)。 */
	readonly skills?: readonly RemoteSkillOption[];
	/** 这个会话选的专家 / 专家团(只给名字,不给定义)。 */
	readonly expertName?: string;
	/** 交互模式(默认 / 计划 / 澄清)。 */
	readonly interactionMode?: "default" | "plan" | "clarify";
	/** 上下文用量。没有它时界面不显示那枚环(而不是显示 0%)。 */
	readonly context?: RemoteContextUsage;
}

/** 本机侧发生的事。远端不区分它们来自"本机界面"还是"远端自己发的"。 */
export type RemoteSurfaceEvent =
	| { readonly type: "message"; readonly sessionId: string; readonly message: RemoteSessionMessage }
	| {
			readonly type: "tool";
			readonly sessionId: string;
			/**
			 * 工具名。**可能没有**:运行时只有"开始"那一帧带名字,更新/完成帧只带 `callId` ——
			 * 名字由会话面按 `callId` 记着补上,真的不知道时宁可不发这一条(摆一行"工具"没有意义)。
			 */
			readonly name?: string;
			/**
			 * 这一次调用的 id。
			 *
			 * 远端**必须按它合并**:同一个工具会先后发开始/更新/完成三帧,而"按名字合并"在同名工具
			 * (连着跑两条 bash)或无名帧上都会合错 —— 后果是那一行永远停在"执行中"。
			 */
			readonly callId?: string;
			/** 这一次调用属于哪一轮(见 `RemoteSessionMessage.turnId`)。 */
			readonly turnId?: string;
			readonly state: "running" | "done";
			/** 参数(压成一段文本)。 */
			readonly args?: string;
			/** 现在在做什么(附在工具事件上,免得再发一条)。 */
			readonly activity?: string;
			readonly detail?: string;
	  }
	| {
			readonly type: "state";
			readonly sessionId: string;
			readonly running: boolean;
			/** 现在在做什么(与桌面端同一套措辞)。空字符串 = 这一轮结束了。 */
			readonly activity?: string;
	  }
	/**
	 * 助手正在写。
	 *
	 * 载荷是**累积文本**,不是增量:增量一旦丢一帧(链路抖动、事件被丢弃),
	 * 远端拼出来的句子就永远缺一块,而它无从察觉。发累积文本的代价是每帧更大,
	 * 但换来的是"任何一帧到达都能独立还原出正确的样子"。
	 */
	| {
			readonly type: "delta";
			readonly sessionId: string;
			readonly messageId: string;
			readonly role: "user" | "assistant";
			/** 这一帧是正文还是思考。少了它,思考就没法流式显示(远端只能等整段写完)。 */
			readonly kind?: "text" | "reasoning";
			/** 这一帧属于哪一轮(见 `RemoteSessionMessage.turnId`)。 */
			readonly turnId?: string;
			readonly text: string;
	  }
	/** 上下文用量更新了(本机估算完就会发)。 */
	| { readonly type: "context"; readonly sessionId: string; readonly context: RemoteContextUsage }
	/** 等用户批准的工具调用。 */
	| {
			readonly type: "approval";
			readonly sessionId: string;
			readonly approvalId: string;
			readonly toolName: string;
			/** 要执行什么(压成一段可读文本)。 */
			readonly summary: string;
			/** 参数(与工具行一样:先命令、再参数)。 */
			readonly args?: string;
			/** 本机判定的风险等级;界面据此换措辞。 */
			readonly severity?: "low" | "medium" | "high";
	  }
	/** 审批被解决(任何一端解决的都算)。 */
	| { readonly type: "approval-resolved"; readonly sessionId: string; readonly approvalId: string }
	/** 等用户回答的提问。 */
	| { readonly type: "user-request"; readonly sessionId: string; readonly request: RemoteUserRequest }
	/** 提问被解决(任何一端解决的都算)。 */
	| { readonly type: "user-request-resolved"; readonly sessionId: string; readonly requestId: string }
	/** 会话列表变了(新建/删除/改名/换模型……)。远端据此重拉列表。 */
	| { readonly type: "sessions-changed" };

/**
 * 上下文用量。
 *
 * 手机上看的是"还剩多少余地",所以给**算好的数**就够了;分类明细一起给,
 * 是因为"为什么占了这么多"是用户最常问的下一个问题(与桌面端同一份分类)。
 * 分类是**估算**(`source` 会说明),所以界面要如实标注,不能说得像精确值。
 */
/**
 * 提问的一个字段。
 *
 * **四种类型就是桌面端的四种**(单选 / 多选 / 文本 / 确认),远端照着原样渲染 ——
 * 不合并、不简化:题目是模型按需要出的,少一种就等于把某些问题变成没法回答。
 */
export type RemoteUserRequestField =
	| {
			readonly type: "select";
			readonly id: string;
			readonly label: string;
			readonly description?: string;
			readonly required?: boolean;
			readonly options: readonly { readonly value: string; readonly label: string; readonly description?: string }[];
			readonly allowCustom?: boolean;
			readonly defaultValue?: string;
	  }
	| {
			readonly type: "multi-select";
			readonly id: string;
			readonly label: string;
			readonly description?: string;
			readonly required?: boolean;
			readonly options: readonly { readonly value: string; readonly label: string; readonly description?: string }[];
			readonly allowCustom?: boolean;
			readonly defaultValue?: readonly string[];
	  }
	| {
			readonly type: "text";
			readonly id: string;
			readonly label: string;
			readonly description?: string;
			readonly required?: boolean;
			readonly placeholder?: string;
			readonly multiline?: boolean;
			readonly defaultValue?: string;
	  }
	| {
			readonly type: "confirm";
			readonly id: string;
			readonly label: string;
			readonly description?: string;
			readonly required?: boolean;
			readonly defaultValue?: boolean;
	  };

/**
 * 用量摘要 —— 桌面端底部"用量详情"里显示的那份数据。
 *
 * **只给界面要显示的字段**:调用数、四类 token、合计、费用、缓存命中率与它的覆盖情况。
 * 命中率是**领域层算好的**(`tokenHitRate`):两端各算一遍,迟早会出现"同一个会话两个数"。
 * `hitRate: null` 表示没有可观测的调用 —— 与"命中率 0%"是两件事,界面要说清。
 */
export interface RemoteUsageSummary {
	readonly modelCalls: number;
	readonly delegatedCalls: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly totalTokens: number;
	readonly promptTokens: number;
	readonly totalCost: number;
	readonly hitRate: number | null;
	/** 命中率覆盖了几次调用(界面据此说清"这个率算得准不准")。 */
	readonly readObservedCalls: number;
	/**
	 * 「更多」里那几项。桌面端的用量面板有它们(读/写覆盖率、对账结果),
	 * 而"覆盖率"与"命中率"是**两个数**:一个说这个率覆盖了几次调用,一个说命中了多少。
	 * 少给一个,远端就只能显示一个没有依据的百分比。
	 */
	readonly readCoverage?: number | null;
	readonly writeCoverage?: number | null;
	/** 写入是否可观测:`read-only` 时不能显示"0%" —— 那会被读成"写入占比 0%"。 */
	readonly writeObservation?: "reported" | "read-only" | "unavailable";
	/** 对账:有多少条记录带 provider 自报的 prompt 总数、其中几条与分量和对不上、最大差额。 */
	readonly reportedPromptCount?: number;
	readonly reportedPromptDriftCount?: number;
	readonly reportedPromptMaxDrift?: number;
	readonly reportedPromptTokens?: number;
	/** 有助手消息但拿不到用量的调用数 —— "我们不知道",与"花了 0"不同。 */
	readonly unmeasuredCalls?: number;
}

/** 远端能选的专家 / 专家团(只给 id、版本、名字与一句话说明)。 */
export interface RemoteExpertOption {
	readonly kind: "expert" | "team";
	readonly id: string;
	readonly version: string;
	readonly name: string;
	readonly description?: string;
}

/** 一次提问:标题 + 若干字段。 */
export interface RemoteUserRequest {
	readonly requestId: string;
	readonly title: string;
	readonly description?: string;
	readonly fields: readonly RemoteUserRequestField[];
}

/** 回答:`string | string[] | boolean`,按字段类型来。 */
export type RemoteUserRequestAnswer = string | readonly string[] | boolean;

/** 远端能选的技能(只给 id、名字与一句话说明)。 */
export interface RemoteSkillOption {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
}

export interface RemoteConnectorSummary {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
}

export interface RemoteConnectorSummary {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
}

export interface RemoteContextUsage {
	readonly usedTokens: number;
	readonly contextWindow: number;
	readonly source?: "provider" | "tokenizer" | "estimate";
	readonly categories?: {
		readonly systemPrompt: number;
		readonly toolsAndSubagents: number;
		readonly conversation: number;
		readonly connectors: number;
		readonly skills: number;
	};
}

/**
 * 思考等级。**与桌面端同一套值域**(`ThinkingLevel`)。
 *
 * 远端要能"只列这个模型支持的档位",所以值域必须与桌面端一致 ——
 * 不一致就会出现"手机上选了、电脑上拒绝"。
 */
export type RemoteThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const REMOTE_THINKING_LEVELS: readonly RemoteThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** 载荷里来的值先按值域收一道,别把不认识的字符串透进运行时(它会抛)。 */
export function isRemoteThinkingLevel(value: unknown): value is RemoteThinkingLevel {
	return typeof value === "string" && (REMOTE_THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * 新建会话时能选的**工作类型**(桌面端"今天想做什么"那一排)。
 *
 * `available` 为假的不摆出来:入口存在、但这个 profile 的驱动还没配好 ——
 * 点了必然失败,而"宁可不给"是这台机器上一条固定的纪律。
 */
export interface RemoteEntryOption {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly iconKey?: string;
	/** 现在能不能在远端建这类会话。 */
	readonly available: boolean;
	/** 不能建时的一句原因(界面照它说,而不是让用户猜)。 */
	readonly note?: string;
}

/** 远端可以选的模型。**只给显示所需的三样**,不给供应商地址、不给密钥。 */
export interface RemoteModelOption {
	readonly connectionId: string;
	readonly modelId: string;
	readonly displayName: string;
	/** 供应商/连接的人类名字(用于分组)。同样只是名字。 */
	readonly providerName?: string;
	/**
	 * 供应商身份,只用于**挑图标**(`ProviderIcon`)。
	 *
	 * `avatarId` 是用户在设置里给这个供应商挑的图标,`providerId` 是按供应商取的默认图标 ——
	 * 两者都只是**名字**(像 `"anthropic"`),不是地址、不是密钥。
	 */
	readonly providerId?: string;
	readonly avatarId?: string;
	/**
	 * 这个模型支不支持思考,以及支持哪些档。
	 *
	 * 不给的话远端只能"七档全列" —— 而不支持的档位选了会被运行时拒绝(`setSessionModel` 会抛)。
	 * 与"清单只列可用的模型"同一条纪律:**不摆一个点了会失败的选项**。
	 */
	readonly supportsReasoning?: boolean;
	readonly supportedThinkingLevels?: readonly RemoteThinkingLevel[];
}

export interface RemoteSessionDetail {
	readonly summary: RemoteSessionSummary;
	readonly messages: readonly RemoteSessionMessage[];
	/**
	 * 这个会话能换成哪些模型。
	 *
	 * 清单由**本机**算(已启用 + 与这个会话的用途兼容 + 供应商已配置 + 运行时真的有这个模型),
	 * 所以远端不会看到一个"选了必然失败"的选项。
	 * 没有这一项 = 这台机器不支持远端换模型,远端就老老实实只显示不能改。
	 */
	readonly models?: readonly RemoteModelOption[];
	/**
	 * 还有更早的消息时给出游标(拿去问 `session.history`)。
	 *
	 * 打开会话**不能**把整段历史一次发过去:大会话的载荷会超过单帧上限,对端判为非法帧并断开 ——
	 * 用户看到的是"连不上",而不是"这个会话很大"。
	 */
	readonly cursor?: string;
	/** 因为体积限制只发了最近的一部分(更早的仍在电脑上)。 */
	readonly truncated?: boolean;
	/** 可以在这个会话里用的技能(「+」里的技能选择用它)。 */
	readonly skills?: readonly RemoteSkillOption[];
	/** 可以选的专家与专家团。**只有支持专家团的会话才有这一项**。 */
	readonly experts?: readonly RemoteExpertOption[];
	/**
	 * 这台机器上**可以连**的连接器(已启用的)。
	 *
	 * 与 `summary.connectors`(这个会话**已经**连的)是两回事:选择器要列的是"能选什么",
	 * 会话已有的那几项只用来显示"现在选了什么"。混在一起就会出现"一个都列不出来"。
	 */
	readonly availableConnectors?: readonly RemoteConnectorSummary[];
}

export interface RemoteHistoryPage {
	readonly messages: readonly RemoteSessionMessage[];
	/** 还有更早的消息时给出下一页游标。 */
	readonly cursor?: string;
}

/** 一次请求的返回:成功带 `payload`,失败带 `error`(而不是抛异常 —— 远端错误不是异常,是结果)。 */
export interface RemoteRequestResult {
	readonly success: boolean;
	readonly payload?: unknown;
	readonly error?: RemoteError;
}
