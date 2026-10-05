import { formatPromptWithSkillReferences } from "@wordless/agent-driver-sdk";
import { summarizeUsageMessages, type PromptSessionOptions } from "@wordless/domain";
import { MODE_COPY, entryCopy } from "./entry-copy.ts";
import { isRemoteThinkingLevel, sha256Hex } from "@wordless/remote-control";
import type {
	RemoteHistoryPage,
	RemoteContextUsage,
	RemoteUsageSummary,
	RemoteUserRequestField,
	RemoteMessageBlock,
	RemoteModelOption,
	RemoteSessionDetail,
	RemoteSessionMessage,
	RemoteSessionSummary,
	RemoteEntryOption,
	RemoteSurfaceEvent,
	RemoteThinkingLevel,
} from "@wordless/remote-control";
import type { RemoteSessionSurface } from "./host-service.ts";

/**
 * 把本机运行时接到"远端能做什么"这份显式清单上。
 *
 * 两条刻意的设计:
 *
 * 1. **端口只声明我们真正读的字段**(结构化类型,不是 `AppSnapshot` 那一整坨)。
 *    于是"远端能碰到的运行时面"在类型上就是看得见的,而不是"整个 runtime 都暴露出去";
 *    测试也不必造一整份快照。
 * 2. **对外的会话 id 是会话文件路径的哈希**,不是路径本身。
 *    远端永远看不到 `/Users/…` —— 会话 id 只需要"唯一且稳定",不需要可读。
 */

/** 会话记录里我们读的字段。 */
export interface RuntimeSessionRecordLike {
	readonly id: string;
	readonly title: string;
	readonly updatedAt: number;
	readonly journalPath: string;
	/** 所属空间。远端用它分区。 */
	readonly workspaceId?: string | null;
	/** 会话设置(只读透出给远端)。 */
	readonly model?: { readonly connectionId?: string; readonly modelId?: string };
	readonly thinkingLevel?: string;
	readonly accessLevel?: string;
	readonly toolApprovalMode?: string;
	readonly connectorIds?: readonly string[];
	readonly interactionMode?: string;
	/** 工作类型入口:`general-work` 才支持专家团。 */
	readonly entryId?: string;
	readonly expertSelection?: { readonly kind?: string; readonly id?: string };
}

export interface RuntimeMessageBlockLike {
	readonly type: string;
	readonly text?: string;
	/** 引用块才有(`workspace-reference`):用户消息里 `@` 挑的文件。 */
	readonly id?: string;
	readonly path?: string;
	readonly kind?: string;
	/** 工具块才有。 */
	readonly callId?: string;
	/** 工具名;引用块用它当显示名(两边同名字段,读的地方各自按 `type` 区分)。 */
	readonly name?: string;
	readonly state?: string;
	readonly input?: unknown;
	readonly output?: string;
	readonly startedAt?: number;
	readonly completedAt?: number;
	/** 工具块上的用量:委派(子代理 / 专家团)的调用挂在它上面,算**同一轮**。 */
	readonly usage?: unknown;
}

export interface RuntimeMessageLike {
	readonly id?: string;
	readonly role: "user" | "assistant";
	readonly timestamp: number;
	readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
	readonly status?: string;
	readonly blocks: readonly RuntimeMessageBlockLike[];
}

/** 压缩记录:远端只取这几项(原因、前后 token、模型、摘要)。 */
export interface RuntimeCompactionLike {
	readonly trigger: "manual" | "automatic" | "overflow";
	readonly tokensBefore: number;
	readonly tokensAfter: number;
	readonly model?: { readonly modelId?: string };
	readonly summary: string;
	readonly timestamp: number;
}

export interface RuntimeTimelineItemLike {
	readonly type: string;
	readonly turn?: { readonly messages: readonly RuntimeMessageLike[] };
	/** 时间线上独立的一行:上下文被压缩了。 */
	readonly compaction?: RuntimeCompactionLike;
}

export interface RuntimeSessionViewLike {
	readonly session: RuntimeSessionRecordLike;
	readonly isRunning: boolean;
	readonly history: { readonly items: readonly RuntimeTimelineItemLike[] };
	/** 本机估算的上下文用量。视图里本来就带着它,不需要再单独问一次。 */
	readonly contextUsage?: RuntimeContextUsageLike;
}

export interface RuntimeHistoryPageLike {
	readonly items: readonly RuntimeTimelineItemLike[];
	readonly nextBeforeCursor?: string;
}

/** 运行时的窄端口:只有远端用得到的那几件事。 */
export interface RemoteRuntimePort {
	getSnapshot(): {
		readonly sessions: readonly RuntimeSessionRecordLike[];
		readonly runningSessionIds: readonly string[];
		/** 空间列表:远端据此把会话分区、并在新建页里**选工作目录**(只读 id 与名字,不读路径)。 */
		readonly workspaces?: readonly {
			readonly id: string;
			readonly name: string;
			/** 目录还在不在(被删 / 移走的不该能被选中)。 */
			readonly availability?: string;
		}[];
		/** 工作类型(新建会话页的"今天想做什么")。 */
		readonly entries?: readonly {
			readonly id: string;
			readonly mode?: string;
			readonly labelKey?: string;
			readonly descriptionKey?: string;
			readonly iconKey?: string;
			readonly workbenchId?: string;
			readonly availability?: string;
			readonly internal?: boolean;
		}[];
		/** 已启用模型:只取显示名,用于把 modelId 变成人看得懂的名字。 */
		readonly models?: readonly RuntimeModelRecordLike[];
		/** 供应商连接:只取显示名,用于给模型分组。**绝不取 baseUrl**。 */
		readonly connections?: readonly {
		readonly id: string;
		readonly displayName?: string;
		/** 供应商身份,只用于挑图标。 */
		readonly providerId?: string;
		readonly avatarId?: string | null;
	}[];
		/** 技能目录:只取 id、名字与一句话说明。 */
		readonly skills?: {
			readonly skills?: readonly { readonly id?: string; readonly name?: string; readonly description?: string }[];
		};
		/** 连接器目录:只取名字与开关状态(远端不能改,但要让用户看得见)。 */
		readonly connectors?: {
			readonly connectors?: readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[];
		};
	};
	getSessionView(sessionId: string): Promise<RuntimeSessionViewLike>;
	getSessionHistoryPage(
		sessionId: string,
		request?: { readonly before?: string; readonly limit?: number },
	): Promise<RuntimeHistoryPageLike>;
	/** 新建会话并发出第一条消息(与桌面端 WelcomeView 同一个入口)。 */
	createAndPrompt(
		draft: {
			readonly mode: string;
			readonly entryId: string;
			readonly workspaceId: string | null;
			readonly accessLevel: string;
			readonly model: { readonly connectionId: string; readonly modelId: string } | null;
			readonly thinkingLevel?: RemoteThinkingLevel;
			readonly interactionMode?: "default" | "plan" | "clarify";
			readonly connectorIds?: readonly string[];
		},
		prompt: string,
		skillIds?: readonly string[],
	): Promise<RuntimeSessionRecordLike>;
	/** 重做某一轮。本机会校验"它是不是最新一轮"。 */
	retrySessionTurn(sessionId: string, messageId: string): Promise<void>;
	/** 权限的两个 setter(与桌面端同一套)。 */
	setSessionAccess(sessionId: string, accessLevel: "default" | "full"): Promise<unknown> | unknown;
	setSessionToolApprovalMode(sessionId: string, mode: "manual" | "auto" | "bypass"): Promise<unknown> | unknown;
	/** 改这个会话用哪些连接器。 */
	setSessionConnectors(sessionId: string, connectorIds: readonly string[]): Promise<unknown> | unknown;
	/** 改交互模式。 */
	setSessionInteractionMode(sessionId: string, mode: string): Promise<unknown> | unknown;
	/** 回答一次工具审批。**批准之后本机才会真的执行那个工具**。 */
	resolveOperationApproval(sessionId: string, approvalId: string, approved: boolean, feedback?: string): Promise<unknown>;
	/** 手动压缩上下文。 */
	compactSession(sessionId: string): Promise<unknown>;
	/** 这个会话的总计用量。 */
	getSessionUsage(sessionId: string): Promise<{ readonly chat: unknown; readonly unmeasuredCalls: number }> | { readonly chat: unknown; readonly unmeasuredCalls: number };
	/** 切换某一轮回复的版本。 */
	selectSessionTurnVersion(sessionId: string, messageId: string, version: number): Promise<unknown>;
	/** 换这个会话的专家 / 专家团(null = 不用)。 */
	setSessionExpert(
		sessionId: string,
		selection: { readonly kind: "expert" | "team"; readonly id: string; readonly version: string } | null,
	): Promise<unknown> | unknown;
	/**
	 * 在这个会话的工作区里搜文件与目录(输入框里的 `@`)。
	 *
	 * 桌面端输入框用的是**同一个方法** —— 于是两端的"搜得到什么"永远一致
	 * (忽略规则、索引缓存、目录优先这些行为都不需要各写一份)。
	 */
	searchSessionWorkspace(sessionId: string, query: string): Promise<readonly RuntimeWorkspaceEntryLike[]>;
	/** 回答一次提问(提交答案,或取消)。 */
	resolveUserRequest(
		sessionId: string,
		requestId: string,
		resolution: { readonly status: "submitted" | "cancelled"; readonly answers?: Record<string, unknown> },
	): Promise<unknown>;

	/**
	 * 发一轮。`skillIds` 决定这一轮用哪些技能;附件走 `options`(与运行时同形 ——
	 * 运行时本来就收 base64 附件,所以不需要另造一条传输路径)。
	 */
	promptSession(
		sessionId: string,
		prompt: string,
		skillIds?: readonly string[],
		submission?: unknown,
		options?: PromptSessionOptions,
	): Promise<void>;
	cancelSession(sessionId: string): Promise<void>;
	/** 换模型。本机运行时自己会校验(已启用、兼容、存在),远端只负责把选择传下来。 */
	setSessionModel(
		sessionId: string,
		model: { readonly connectionId: string; readonly modelId: string },
		thinkingLevel?: RemoteThinkingLevel,
	): Promise<void>;
	/** 每一轮的回复版本。 */
	getSessionTurnVersions(
		sessionId: string,
	): Promise<Record<string, { readonly active: number; readonly total: number }>>;
	/** 专家与专家团的目录(`kind` 区分两者)。 */
	listExperts(): readonly RuntimeExpertLike[];
	/** 这个会话能换成哪些模型 —— 与 `setSessionModel` 同一套判断,所以清单里的选项一定可用。 */
	listSelectableSessionModels(sessionId: string): readonly RuntimeModelRecordLike[];
}

export interface RuntimeContextUsageLike {
	readonly usedTokens: number;
	readonly contextWindow: number;
	readonly source?: string;
	readonly categories?: {
		readonly systemPrompt: number;
		readonly toolsAndSubagents: number;
		readonly conversation: number;
		readonly connectors: number;
		readonly skills: number;
	};
}

export interface RuntimeModelRecordLike {
	readonly connectionId: string;
	readonly modelId: string;
	readonly displayName: string;
	/** 模型能力:远端要据此"只列这个模型支持的思考档位"。 */
	readonly capabilities?: {
		readonly supportsReasoning?: boolean;
		readonly supportedThinkingLevels?: readonly string[];
	};
}

/**
 * 工作区搜索给回来的一条。
 *
 * 只读这三样:相对路径、显示名、是不是目录。运行时那份还带体积与修改时间 ——
 * 这一条链路上没有任何用途,所以**不读、也不发**。
 */
export interface RuntimeWorkspaceEntryLike {
	readonly path: string;
	readonly name: string;
	readonly kind: "file" | "directory";
}

/**
 * 换模型的结果。
 *
 * **刻意不用异常表达失败**:远端需要的不是"出错了",而是"是哪种错" ——
 * 正在回复中要让用户等,模型不可用要让用户换一个,两者的提示完全不同。
 * 靠解析错误文案来区分太脆,所以在这里就把原因分类好。
 */
export type RemoteSetModelResult =
	| { readonly ok: true; readonly summary: RemoteSessionSummary }
	| { readonly ok: false; readonly reason: "not_found" | "busy" | "unavailable" | "failed" };

/** 运行时事件流(主进程里就是那份发给渲染层的同一个信封流)。 */
export interface RuntimeEventStreamPort {
	subscribe(listener: (envelope: RuntimeEnvelopeLike) => void): () => void;
}

export interface RuntimeEnvelopeLike {
	readonly sessionId: string | null;
	/** 运行时的轮次 id(`turn:<用户消息 id>`):远端靠它把内容归到正确的一轮。 */
	readonly turnId?: string;
	readonly event: { readonly type: string; readonly [key: string]: unknown };
}

export interface RuntimeSessionSurfaceOptions {
	readonly runtime: RemoteRuntimePort;
	/**
	 * 设计风格目录(新建设计会话时能选哪些)。
	 *
	 * 由主进程直接给:风格库是一份**静态目录**(`design/style-catalog.ts`),与运行时无关 ——
	 * 绕一圈从运行时拿,只会多一层什么都不做的转手。
	 */
	readonly designStyles?: () => readonly {
		readonly id: string;
		readonly name: string;
		readonly tagline: string;
		readonly vibe: "light" | "dark";
	}[];
	readonly events: RuntimeEventStreamPort;
	/** 流式节流用。默认 `Date.now`;测试注入它就不必等真实时间。 */
	readonly now?: () => number;
}

/**
 * 流式节流:同一条消息最快每 100ms 发一帧。
 *
 * 模型吐字可以到每秒几十次 —— 每次都发一帧,手机上画得比读得快,还会把事件日志挤满。
 * 这里**刻意不用定时器**:定时器要么泄漏、要么让进程不肯退出(踩过这个坑),
 * 用"上一次发的时间"做个闸门就够了,而且最后一帧由 `message.completed` 兜底。
 */
const STREAM_INTERVAL_MS = 100;

/**
 * 打开会话时最多发多少条消息、单个块最多多少字符、整包最多多少字符。
 *
 * 这三个数是**对着单帧上限倒推**的(`MAX_REMOTE_FRAME_CHARS = 1_500_000`,密封后还会膨胀):
 * 以前 `session.open` 把**整段历史**一次发过去,大会话直接超过上限 —— 对端判为非法帧并断开,
 * 用户看到的是"连不上",而真相是"这个会话很大"。
 *
 * 宁可少发:更早的消息在电脑上跑不掉,而且有游标可以往回翻。
 */
const OPEN_HISTORY_LIMIT = 40;
const MAX_BLOCK_CHARS = 20_000;
/** 参数摘要最多这么长(远端还要用省略号截一次;这里只是不让单帧被一行参数撑大)。 */
const MAX_ARGS_LINE_CHARS = 200;
/**
 * 单条**实时**消息的预算。
 *
 * 与 `MAX_OPEN_PAYLOAD_CHARS`(整包 40 万)是两回事:实时消息是**一条一帧**发的,
 * 它自己超了单帧上限就会被丢掉,而丢掉之后对端会一直等这一条(序号已经用掉了)。
 */
const MAX_LIVE_MESSAGE_CHARS = 120_000;
const MAX_OPEN_PAYLOAD_CHARS = 400_000;

/** 模型名的索引键:供应商 + 模型,两者一起才唯一。 */
function modelKey(connectionId: string | undefined, modelId: string): string {
	return `${connectionId ?? ""}/${modelId}`;
}

/** 从快照里取出"模型 → 显示名"与"连接 → 显示名"。只取名字,不取地址与密钥。 */
/**
 * 专家 / 专家团的目录:本机提供(kind + id + 版本 + 名字)。 */
export interface RuntimeExpertLike {
	readonly kind: "expert" | "team";
	readonly id: string;
	readonly version: string;
	readonly name: string;
	readonly description?: string;
}

/** 名字索引:`kind:id` → 名字。 */
function expertNameIndex(experts: readonly RuntimeExpertLike[]): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const expert of experts) map.set(`${expert.kind}:${expert.id}`, expert.name);
	return map;
}

/**
 * 技能目录。
 *
 * 从快照里取(不额外问运行时):只给 id、名字与一句话说明 —— 远端要的是"能选哪些",
 * 而不是技能的完整定义(那里面有 prompt 与文件路径)。
 */
function skillCatalog(snapshot: {
	readonly skills?: {
		readonly skills?: readonly { readonly id?: string; readonly name?: string; readonly description?: string }[];
	};
}): readonly { readonly id: string; readonly name: string; readonly description?: string }[] {
	return (snapshot.skills?.skills ?? [])
		.filter(
			(skill): skill is { readonly id: string; readonly name: string; readonly description?: string } =>
				typeof skill.id === "string" && skill.id.length > 0 && typeof skill.name === "string",
		)
		.map((skill) => ({
			id: skill.id,
			name: skill.name,
			...(skill.description === undefined ? {} : { description: skill.description.slice(0, 120) }),
		}));
}

/**
 * "正在做什么"的措辞 —— **与桌面端同一套说法**(见 `i18n.ts` 的 `assistant*`)。
 *
 * 桌面端把这套状态算在渲染层(它订阅同一份事件流);远端在会话面算,把**最终那句话**发出去 ——
 * 这样网页端不必再实现一遍状态机,也不会出现"两端说法不一样"。
 */
function activityForTool(name: string, phase: "running"): string {
	if (name === "bash" || name === "python") return "正在执行命令";
	if (name === "read" || name === "read_file" || name === "ls") return "正在读取文件";
	if (name === "grep" || name === "find" || name === "workspace_changes") return "正在搜索";
	if (name === "edit" || name === "write" || name === "write_verify") return "正在写入文件";
	if (name === "delegate_task" || name === "delegate_expert") return "正在委派子任务";
	if (name === "load_skill") return "正在加载技能";
	if (name.startsWith("mcp_")) return "正在调用连接器";
	return phase === "running" ? "正在调用工具" : "正在准备";
}

/** 这台机器上可以连的连接器(已启用的):选择器列的是它。 */
function availableConnectorList(snapshot: {
	readonly connectors?: {
		readonly connectors?: readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[];
	};
}): readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[] {
	return (snapshot.connectors?.connectors ?? [])
		.filter((connector) => connector.enabled)
		.map((connector) => ({ id: connector.id, name: connector.name, enabled: connector.enabled }));
}

/** 连接器目录:只留名字与开关状态。 */
function connectorIndex(snapshot: {
	readonly connectors?: {
		readonly connectors?: readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[];
	};
}): ReadonlyMap<string, { readonly id: string; readonly name: string; readonly enabled: boolean }> {
	const map = new Map<string, { readonly id: string; readonly name: string; readonly enabled: boolean }>();
	for (const connector of snapshot.connectors?.connectors ?? []) {
		map.set(connector.id, { id: connector.id, name: connector.name, enabled: connector.enabled });
	}
	return map;
}

function nameIndexes(snapshot: {
	readonly models?: readonly RuntimeModelRecordLike[];
	readonly connections?: readonly {
		readonly id: string;
		readonly displayName?: string;
		/** 供应商身份,只用于挑图标。 */
		readonly providerId?: string;
		readonly avatarId?: string | null;
	}[];
}): {
	readonly models: ReadonlyMap<string, string>;
	readonly connections: ReadonlyMap<string, string>;
	readonly providerIdentities: ReadonlyMap<string, { readonly providerId?: string; readonly avatarId?: string }>;
} {
	const models = new Map<string, string>();
	for (const model of snapshot.models ?? []) {
		models.set(modelKey(model.connectionId, model.modelId), model.displayName);
	}
	const connections = new Map<string, string>();
	// 供应商身份单独一份:它只服务于"挑图标",与名字的用途不同(名字用于分组与显示)。
	const providerIdentities = new Map<string, { readonly providerId?: string; readonly avatarId?: string }>();
	for (const connection of snapshot.connections ?? []) {
		if (connection.displayName !== undefined) connections.set(connection.id, connection.displayName);
		const identity = {
			...(typeof connection.providerId === "string" && connection.providerId.length > 0
				? { providerId: connection.providerId }
				: {}),
			...(typeof connection.avatarId === "string" && connection.avatarId.length > 0
				? { avatarId: connection.avatarId }
				: {}),
		};
		if (identity.providerId !== undefined || identity.avatarId !== undefined)
			providerIdentities.set(connection.id, identity);
	}
	return { models, connections, providerIdentities };
}

export function createRuntimeSessionSurface(options: RuntimeSessionSurfaceOptions): RemoteSessionSurface {
	const { runtime, events } = options;
	const now = (): number => options.now?.() ?? Date.now();
	const listeners = new Set<(event: RemoteSurfaceEvent) => void>();

	/** 哈希 → 真实会话 id。远端只见到哈希。 */
	const publicToReal = new Map<string, string>();
	const realToPublic = new Map<string, string>();
	/** 已知的用量(打开会话时取过、或本机刚更新过)。列表与详情共用一份,免得两处显示不一样。 */
	const usageByRealId = new Map<string, RemoteContextUsage>();
	/** 正在写的那条消息:按会话记累积文本与上次发出的时间。 */
	const streaming = new Map<string, { messageId: string; role: "user" | "assistant"; text: string; emittedAt: number }>();
	/** `callId → 工具名`:运行时的更新/完成帧不带名字,只能自己记(见工具事件那段注释)。 */
	const toolNames = new Map<string, string>();

	const publicId = (record: RuntimeSessionRecordLike): string => {
		const known = realToPublic.get(record.id);
		if (known) return known;
		const hash = sha256Hex(record.journalPath).slice(0, 32);
		publicToReal.set(hash, record.id);
		realToPublic.set(record.id, hash);
		return hash;
	};

	/**
	 * 只认**我们自己发出去的哈希**。
	 *
	 * 这里刻意不做"找不到就当成真实 id 用"的兜底:那等于远端可以拿任意 id 去问运行时,
	 * 哈希这层间接就白设了。远端只能用它在会话列表里见过的 id。
	 */
	const realId = (sessionId: string): string | undefined => publicToReal.get(sessionId);

	const summarize = (
		record: RuntimeSessionRecordLike,
		running: ReadonlySet<string>,
		workspaceNames?: ReadonlyMap<string, string>,
		modelNames?: ReadonlyMap<string, string>,
		connectors?: ReadonlyMap<string, { readonly id: string; readonly name: string; readonly enabled: boolean }>,
		expertNames?: ReadonlyMap<string, string>,
	): RemoteSessionSummary => {
		const workspaceId = record.workspaceId ?? undefined;
		const workspaceName = workspaceId === undefined ? undefined : workspaceNames?.get(workspaceId);
		const modelId = record.model?.modelId;
		return {
			id: publicId(record),
			title: record.title,
			updatedAt: record.updatedAt,
			running: running.has(record.id),
			// 只有 id 与名字 —— **不把 rootPath 发出去**。
			...(workspaceId === undefined ? {} : { workspaceId }),
			...(workspaceName === undefined ? {} : { workspaceName }),
			// 只读地透出会话设置:远端据此显示"我在用什么",但不提供修改入口。
			...(typeof modelId === "string" && modelId.length > 0 ? { modelId } : {}),
			// 工作类型:列表用它显示对应的图标(与桌面端侧栏同一个图标)。
			...(() => {
				const entryId = record.entryId;
				return typeof entryId === "string" && entryId.length > 0 ? { entryId } : {};
			})(),
			// 现在的思考等级:远端据此把"当前那一档"标出来(与模型名同一个道理)。
			...(() => {
				const level = record.thinkingLevel;
				return isRemoteThinkingLevel(level) ? { thinkingLevel: level } : {};
			})(),
			// 当前模型挂在哪个连接上:远端据此在清单里认出"当前",并显示"这个模型是哪家"。
			...(() => {
				const connectionId = record.model?.connectionId;
				return typeof connectionId === "string" && connectionId.length > 0 ? { modelConnectionId: connectionId } : {};
			})(),
			// 有显示名就带上:远端显示 "Claude Sonnet 4" 而不是 "claude-sonnet-4-20250514"。
			...(() => {
				const name = modelId === undefined ? undefined : modelNames?.get(modelKey(record.model?.connectionId, modelId));
				return name === undefined ? {} : { modelName: name };
			})(),
			...(record.accessLevel === "default" || record.accessLevel === "full"
				? { accessLevel: record.accessLevel }
				: {}),
			...(record.toolApprovalMode === "manual" || record.toolApprovalMode === "auto" || record.toolApprovalMode === "bypass"
				? { toolApprovalMode: record.toolApprovalMode }
				: {}),
			...(record.connectorIds === undefined ? {} : { connectorCount: record.connectorIds.length }),
			...(record.interactionMode === "default" || record.interactionMode === "plan" || record.interactionMode === "clarify"
				? { interactionMode: record.interactionMode }
				: {}),
			...(() => {
				const selection = record.expertSelection;
				const name =
					selection === undefined ? undefined : expertNames?.get(`${selection.kind ?? ""}:${selection.id ?? ""}`);
				return name === undefined ? {} : { expertName: name };
			})(),
			...(() => {
				// 会话连着哪些连接器:按会话记录里的顺序取名字;目录里没有的(已删除)跳过。
				const list = (record.connectorIds ?? [])
					.map((id) => connectors?.get(id))
					.filter(
						(entry): entry is { readonly id: string; readonly name: string; readonly enabled: boolean } =>
							entry !== undefined,
					);
				return list.length === 0 ? {} : { connectors: list };
			})(),
			...(() => {
				const context = usageByRealId.get(record.id);
				return context === undefined ? {} : { context };
			})(),
		};
	};

	/** 可选模型清单:只带 id、显示名与供应商名。 */
	const selectableModels = (
		realSessionId: string,
		providerNames: ReadonlyMap<string, string>,
		providerIdentities: ReadonlyMap<string, { readonly providerId?: string; readonly avatarId?: string }>,
	): RemoteModelOption[] =>
		runtime.listSelectableSessionModels(realSessionId).map((model) => {
			const providerName = providerNames.get(model.connectionId);
			const identity = providerIdentities.get(model.connectionId);
			// 思考档位按值域收一道:运行时里可能多出我们还不认识的档,透出去就会变成一个"点了会失败"的选项。
			const supported = (model.capabilities?.supportedThinkingLevels ?? []).filter(isRemoteThinkingLevel);
			return {
				connectionId: model.connectionId,
				modelId: model.modelId,
				displayName: model.displayName,
				...(providerName === undefined ? {} : { providerName }),
				// 图标:只给供应商身份这两个名字,不给地址。
				...(identity === undefined ? {} : identity),
				...(model.capabilities?.supportsReasoning === undefined
					? {}
					: { supportsReasoning: model.capabilities.supportsReasoning }),
				...(supported.length === 0 ? {} : { supportedThinkingLevels: supported }),
			};
		});

	/**
	 * 每一轮的回复版本:`{ active, total }`,按消息 id。
	 *
	 * 单独问运行时(而不是读会话快照):快照会顺带把上下文、工具、专家协作全建一遍,
	 * 而这里只要版本。只有真的有多版才带 —— 摆一个"1/1"没有意义。
	 */
	const versionsOf = (
		turnVersions: Readonly<Record<string, { readonly active?: number; readonly total?: number }>>,
	): ReadonlyMap<string, { readonly active: number; readonly total: number }> => {
		const map = new Map<string, { readonly active: number; readonly total: number }>();
		for (const [messageId, versions] of Object.entries(turnVersions)) {
			if (typeof versions?.active !== "number" || typeof versions.total !== "number") continue;
			if (versions.total <= 1) continue;
			map.set(messageId, { active: versions.active, total: versions.total });
		}
		return map;
	};

	/**
	 * 流式帧的映射。
	 *
	 * 它**必须**在工厂内部:累积文本、上次发出的时间、哈希映射都在这儿。
	 * (一开始把它写成模块级纯函数,结果看不到这些状态 —— 那是个真错误。)
	 */
	const mapStreamEvent = (envelope: RuntimeEnvelopeLike): RemoteSurfaceEvent | undefined => {
		const event = envelope.event;
		if (
			event.type !== "message.started" &&
			event.type !== "message.text.delta" &&
			event.type !== "message.reasoning.delta" &&
			event.type !== "message.completed"
		) {
			return undefined;
		}
		const sessionId = envelope.sessionId === null ? undefined : realToPublic.get(envelope.sessionId);
		if (sessionId === undefined) return undefined;
		if (event.type === "message.completed") {
			// 写完了:累积器清掉,由那条完整消息收尾(它带的是最终文本)。
			streaming.delete(`${sessionId}:text`);
			streaming.delete(`${sessionId}:reasoning`);
			return undefined;
		}
		if (event.type === "message.started") {
			const message = event.message as { id?: string; role?: string } | undefined;
			const messageId = typeof message?.id === "string" ? message.id : undefined;
			if (messageId === undefined) return undefined;
			const role = message?.role === "user" ? "user" : "assistant";
			// **只登记,不发帧**:一轮里每个消息(正文、工具、又一段正文)都会 started,
			// 每次发一个空帧就会在远端留下一串空气泡 —— 而每个气泡都挂着一个复制按钮。
			streaming.set(`${sessionId}:text`, { messageId, role, text: "", emittedAt: 0 });
			streaming.set(`${sessionId}:reasoning`, { messageId, role, text: "", emittedAt: 0 });
			return undefined;
		}
		const messageId = typeof event.messageId === "string" ? event.messageId : undefined;
		const delta = typeof event.delta === "string" ? event.delta : undefined;
		if (messageId === undefined || delta === undefined) return undefined;
		// 思考与正文各自累积:它们交替出现,共用一份累积器会把两段拼成一段。
		const kind = event.type === "message.reasoning.delta" ? ("reasoning" as const) : ("text" as const);
		const key = `${sessionId}:${kind}`;
		const current = streaming.get(key);
		const next =
			current !== undefined && current.messageId === messageId
				? { ...current, text: current.text + delta }
				: { messageId, role: "assistant" as const, text: delta, emittedAt: 0 };
		if (next.text.length === 0) return undefined;
		const timestamp = now();
		if (timestamp - next.emittedAt < STREAM_INTERVAL_MS) {
			// 闸门没开:只更新累积文本,不发这一帧(下一帧或完成时会带上全部内容)。
			streaming.set(key, next);
			return undefined;
		}
		streaming.set(key, { ...next, emittedAt: timestamp });
		return {
			type: "delta",
			sessionId,
			messageId,
			role: next.role,
			kind,
			...(envelope.turnId === undefined ? {} : { turnId: envelope.turnId }),
			text: next.text,
		};
	};

	/**
	 * 从**最新**往回装,直到体积预算用完。
	 *
	 * 至少保留一条:一条都发不出去的话,远端就只能显示空白 —— 那比"显示被截断的最近一条"更糟。
	 *
	 * **一条消息本身也可能超预算**:合并之后一轮就是一条消息,而一轮里可能有几十次工具调用。
	 * 所以超预算的那一条要能**在内部裁块**(从最早的那块开始丢,并明说被截断了)——
	 * 否则"保留至少一条"就会把整帧撑爆,而后果是对端关掉链路。
	 */
	const tailWithinBudget = (
		messages: readonly RemoteSessionMessage[],
	): { readonly messages: RemoteSessionMessage[]; readonly trimmed: boolean } => {
		let budget = MAX_OPEN_PAYLOAD_CHARS;
		const kept: RemoteSessionMessage[] = [];
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index];
			if (message === undefined) continue;
			const size = JSON.stringify(message).length;
			if (kept.length > 0 && size > budget) break;
			if (kept.length === 0 && size > budget) {
				// 最后一条自己也超预算:裁它内部的块(保留尾部,因为最新发生的在后面)。
				kept.unshift(trimMessageBlocks(message, budget));
				budget = 0;
				continue;
			}
			budget -= size;
			kept.unshift(message);
		}
		return {
			messages: kept,
			trimmed: kept.length < messages.length || kept.some((message) => message.text.includes(BLOCK_TRIM_MARKER)),
		};
	};

	const messagesFrom = (
		items: readonly RuntimeTimelineItemLike[],
		versions?: ReadonlyMap<string, { readonly active: number; readonly total: number }>,
	): RemoteSessionMessage[] => {
		const messages: RemoteSessionMessage[] = [];
		/**
		 * 当前这一轮的原消息(用来算用量摘要)。
		 *
		 * 桌面端 footer 里的"本轮用量"是**这一轮所有调用**的合计,而运行时把一轮拆成好几条消息 ——
		 * 所以这里按轮累计,并把**最新的那份合计**挂在每条上:合并之后留下的就是最后一条。
		 */
		let turnUsages: RuntimeMessageLike[] = [];
		for (const item of items) {
			// 压缩是时间线上独立的一行(不在任何一轮的消息里),单独映射成一条消息。
			const timelineCompaction = item.type === "compaction" ? compactionFrom(item.compaction) : undefined;
			if (timelineCompaction !== undefined) {
				const compaction = timelineCompaction;
				messages.push({
					role: "compaction",
					text: "",
					at: compaction.timestamp,
					blocks: [
						{
							type: "compaction",
							trigger: compaction.trigger,
							tokensBefore: compaction.tokensBefore,
							tokensAfter: compaction.tokensAfter,
							...(compaction.model?.modelId === undefined ? {} : { modelId: compaction.model.modelId }),
							summary: clampBlock(compaction.summary),
							at: compaction.timestamp,
						},
					],
				});
				continue;
			}
			if (item.type !== "turn" || !item.turn) continue;
			for (const message of item.turn.messages) {
				const blocks = blocksFrom(message.blocks);
				// 正文只取 text 块(思考与工具单独成块) —— 它是"快速复制"与降级显示用的那一条。
				const text = blocks
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join("")
					.trim();
				// 只有思考或工具的消息也要发出去:远端正是要看到它们,才不是"不完整"。
				if (blocks.length === 0) continue;
				if (message.role === "user") turnUsages = [];
				turnUsages.push(message);
				const usage = summarizeTurnUsage(turnUsages);
				messages.push({
					role: message.role,
					text,
					at: message.timestamp,
					...(message.id === undefined ? {} : { id: message.id }),
					...(() => {
						const version = message.id === undefined ? undefined : versions?.get(message.id);
						return version === undefined ? {} : { versions: version };
					})(),
					...(usage === undefined ? {} : { usage }),
					...(message.status === undefined ? {} : { status: remoteMessageStatus(message.status) }),
					blocks,
				});
			}
		}
		// **一轮的助手输出合成一条消息**。
		//
		// 运行时把一轮拆成好几条(工具前说一段、工具后再说一段),而底部操作行是**每条消息一个** ——
		// 不合并的话,一个工具组底下就会挂着好几行复制与用量。桌面端也是合并的(它的消息模型就是这样)。
		return mergeAssistantTurns(messages.sort((left, right) => left.at - right.at));
	};

	return {
		listCatalog: async () => {
			const catalogSnapshot = runtime.getSnapshot();
			const names = nameIndexes(catalogSnapshot);
			return {
				entries: (catalogSnapshot.entries ?? [])
				// `internal` 的那些不是"今天想做什么"(媒体工作台按 id 取它们建会话,但不该摆在新建页)。
				.filter((entry) => entry.internal !== true)
				.map((entry) => {
					const copy = entryCopy(entry.labelKey ?? entry.id, entry.descriptionKey ?? "");
					/**
					 * 代码 / 数据分析这两类**必须有工作目录**(运行时会拒绝没有目录的请求)。
					 *
					 * 目录列表已经透出去了,所以这里**不再把它标成不可用** —— 而是带上
					 * `requiresWorkspace`,由远端决定"先摆着,等目录选好再让它可点"
					 * (与桌面端 WelcomeView 同一条规则:能不能建取决于目录选没选)。
					 */
					const needsWorkspace = entry.workbenchId === "code" || entry.workbenchId === "analysis";
					return {
						id: entry.id,
						name: copy.name,
						description: copy.description,
						...(entry.iconKey === undefined ? {} : { iconKey: entry.iconKey }),
						// 属于哪一栏:远端据此把类型分组(与桌面端 WelcomeView 同一处判断)。
						...(entry.mode === undefined ? {} : { mode: entry.mode }),
						available: entry.availability === "available",
						...(needsWorkspace ? { requiresWorkspace: true } : {}),
						// 设计风格只有设计这一类能用 —— **由本机说**,远端不拿 workbenchId 自己判断。
						...(entry.workbenchId === "ui-preview" ? { acceptsDesignStyle: true } : {}),
					};
				})
					// 不可用的排在后面:先看到能用的。
					.sort(
						(left, right) =>
							Number(right.available) - Number(left.available) || left.id.localeCompare(right.id),
					),
				// 连接器与技能:新建会话时就能选(与桌面端 WelcomeView 一致)。
				connectors: (catalogSnapshot.connectors?.connectors ?? []).filter((connector) => connector.enabled),
				skills: (catalogSnapshot.skills?.skills ?? []).flatMap((skill) =>
					skill.id === undefined || skill.name === undefined
						? []
						: [
								{
									id: skill.id,
									name: skill.name,
									...(skill.description === undefined ? {} : { description: skill.description }),
								},
							],
				),
				/**
				 * 模式(那一栏)。**只发真有入口的那些** —— 摆一个点进去空空的标签页,
				 * 用户只会以为坏了(与"不摆一个点了会失败的选项"同一条纪律)。
				 */
				modes: MODE_COPY.filter((mode) =>
					(catalogSnapshot.entries ?? []).some((entry) => entry.mode === mode.id && entry.internal !== true),
				).map((mode) => ({ id: mode.id, name: mode.name, iconKey: mode.iconKey })),
				// 工作目录:只给 id、名字与"还在不在" —— 路径不出本机。
				workspaces: (catalogSnapshot.workspaces ?? []).map((workspace) => ({
					id: workspace.id,
					name: workspace.name,
					available: workspace.availability === undefined || workspace.availability === "available",
				})),
				designStyles: (options.designStyles?.() ?? []).map((style) => ({
					id: style.id,
					name: style.name,
					tagline: style.tagline,
					vibe: style.vibe,
				})),
				/**
				 * 模型:已启用的那些。
				 *
				 * 与"这个会话能换成哪些模型"**不是同一份**:那份要按会话的入口筛,而新建页还没有会话。
				 * 这里给的是**这台机器上已启用的全部模型**(与桌面端 WelcomeView 的模型选择器同一份来源),
				 * 到底能不能用由 `session.create` 在运行时校验 —— 桌面端也是这个规矩。
				 */
				// (运行时给的那份**本来就只含已启用的对话模型** —— 不用再筛一遍。)
				models: (catalogSnapshot.models ?? [])
					.map((model) => {
						const providerName = names.connections.get(model.connectionId);
						const identity = names.providerIdentities.get(model.connectionId);
						const supported = (model.capabilities?.supportedThinkingLevels ?? []).filter(isRemoteThinkingLevel);
						return {
							connectionId: model.connectionId,
							modelId: model.modelId,
							displayName: model.displayName,
							...(providerName === undefined ? {} : { providerName }),
							...(identity === undefined ? {} : identity),
							...(model.capabilities?.supportsReasoning === undefined
								? {}
								: { supportsReasoning: model.capabilities.supportsReasoning }),
							...(supported.length === 0 ? {} : { supportedThinkingLevels: supported }),
						};
					})
					.sort(
						(left, right) =>
							left.connectionId.localeCompare(right.connectionId) ||
							left.displayName.localeCompare(right.displayName),
					),
			};
		},

		createSession: async (input): Promise<RemoteSessionSummary | undefined> => {
			const snapshot = runtime.getSnapshot();
			const entry = (snapshot.entries ?? []).find((candidate) => candidate.id === input.entryId);
			// 入口不认识、或本机说它现在不可用:如实回 undefined(远端据此说"这个入口现在用不了")。
			if (!entry || entry.availability !== "available" || entry.internal === true) return undefined;
			/**
			 * 工作目录:远端可以选了(见 `listCatalog`),所以这里**只认两种情形** ——
			 * 要么这个入口本来就不需要目录,要么给了一个**存在且可用**的目录。
			 * 认不出来的 id 一律当"没给":猜一个目录等于替用户把活干在别的地方。
			 */
			const needsWorkspace = entry.workbenchId === "code" || entry.workbenchId === "analysis";
			const available = (snapshot.workspaces ?? []).filter(
				(workspace) => workspace.availability === undefined || workspace.availability === "available",
			);
			const workspaceId =
				input.workspaceId === undefined
					? undefined
					: available.find((workspace) => workspace.id === input.workspaceId)?.id;
			if (needsWorkspace && workspaceId === undefined) return undefined;
			/**
			 * 设计风格:只有设计这一类用得上(与桌面端 WelcomeView 同一处判断)。
			 *
			 * 它**不落盘**,只往首条消息里放一条 `design-style` 标记 —— 真正的应用由本机的 agent
			 * 把 `styleId` 交给 `design_create`。别的入口传了就当没传(而不是整条拒掉)。
			 */
			const designStyleId =
				entry.workbenchId === "ui-preview" && input.designStyleId !== undefined
					? (options.designStyles?.() ?? []).find((style) => style.id === input.designStyleId)?.id
					: undefined;
			const record = await runtime.createAndPrompt(
				{
					// 运行时会校验"入口属于这个模式",所以模式必须跟着入口走。
					mode: entry.mode ?? "everyday",
					entryId: entry.id,
					// 权限**不替用户决定**:用最保守的那一档(与桌面端默认一致)。
					workspaceId: workspaceId ?? null,
					accessLevel: "default",
					model: input.model ?? null,
					...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
					...(input.interactionMode === undefined ? {} : { interactionMode: input.interactionMode }),
					...(input.connectorIds === undefined ? {} : { connectorIds: [...input.connectorIds] }),
				},
				// 风格标记与技能一样,都是**随首条消息**发出去的一段结构(与桌面端 WelcomeView 同一条路)。
				designStyleId === undefined
					? input.text
					: formatPromptWithSkillReferences([
							{ type: "text" as const, text: input.text },
							{ type: "design-style" as const, styleId: designStyleId },
						]),
				// 技能是"这一轮用哪些" —— 与第一条消息一起发(与桌面端 WelcomeView 同一条路)。
				input.skillIds === undefined ? [] : [...input.skillIds],
			);
			const names = nameIndexes(runtime.getSnapshot());
			// **新会话也要登记哈希映射** —— 不登记的话远端打不开自己刚建的那个会话。
			return summarize(
				record,
				new Set(),
				undefined,
				names.models,
				connectorIndex(runtime.getSnapshot()),
				expertNameIndex(runtime.listExperts()),
			);
		},

		listSessions: async () => {
			const snapshot = runtime.getSnapshot();
			const running = new Set(snapshot.runningSessionIds);
			const workspaceNames = new Map((snapshot.workspaces ?? []).map((workspace) => [workspace.id, workspace.name]));
			const names = nameIndexes(snapshot);
			const connectors = connectorIndex(snapshot);
			return snapshot.sessions
				.map((record) =>
					summarize(record, running, workspaceNames, names.models, connectors, expertNameIndex(runtime.listExperts())),
				)
				.sort((left, right) => right.updatedAt - left.updatedAt);
		},

		openSession: async (sessionId): Promise<RemoteSessionDetail | undefined> => {
			const id = realId(sessionId);
			if (!id) return undefined;
			const view = await runtime.getSessionView(id);
			const snapshot = runtime.getSnapshot();
			const names = nameIndexes(snapshot);
			// 消息**单独取一页**:不能拿 `view.history`(那是整段历史,大会话会把帧撑爆)。
			const page = await runtime.getSessionHistoryPage(id, { limit: OPEN_HISTORY_LIMIT });
			const context = remoteContextUsage(view.contextUsage);
			if (context === undefined) usageByRealId.delete(id);
			else usageByRealId.set(id, context);
			// 版本单独问一次(只有它需要读日志;会话快照那条路顺带建的东西太多)。
			const turnVersions = await runtime.getSessionTurnVersions(id).catch(() => ({}));
			const all = messagesFrom(page.items, versionsOf(turnVersions));
			const { messages, trimmed } = tailWithinBudget(all);
			// 只有"整页都发完了"时才能把运行时的游标交给远端:我们自己裁掉了一部分的话,
			// 那个游标会跳过被裁掉的消息(远端会以为中间没有别的东西)。
			const cursor = page.nextBeforeCursor;
			return {
				summary: summarize(
					view.session,
					view.isRunning ? new Set([view.session.id]) : new Set(),
					undefined,
					names.models,
					connectorIndex(snapshot),
					expertNameIndex(runtime.listExperts()),
				),
				messages,
				models: selectableModels(id, names.connections, names.providerIdentities),
				skills: skillCatalog(snapshot),
				availableConnectors: availableConnectorList(snapshot),
				// 专家团只有 general-work 支持(运行时会拒绝别的入口)—— 不支持就**不给这一项**,
				// 而不是给一个点了会失败的。
				...(view.session.entryId === "general-work"
					? {
							experts: runtime.listExperts().map((entry) => ({
								kind: entry.kind,
								id: entry.id,
								version: entry.version,
								name: entry.name,
								...(entry.description === undefined ? {} : { description: entry.description.slice(0, 120) }),
							})),
						}
					: {}),
				...(trimmed
					? { truncated: true }
					: cursor === undefined
						? {}
						: { cursor }),
			};
		},

		historyPage: async (sessionId, cursor): Promise<RemoteHistoryPage> => {
			const id = realId(sessionId);
			if (!id) return { messages: [] };
			const page = await runtime.getSessionHistoryPage(id, {
				...(cursor === undefined ? {} : { before: cursor }),
				limit: 50,
			});
			return {
				messages: messagesFrom(page.items),
				...(page.nextBeforeCursor === undefined ? {} : { cursor: page.nextBeforeCursor }),
			};
		},

		setPermissions: async (sessionId, patch) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			if (patch.accessLevel !== undefined) await runtime.setSessionAccess(id, patch.accessLevel);
			if (patch.toolApprovalMode !== undefined) await runtime.setSessionToolApprovalMode(id, patch.toolApprovalMode);
		},

		setMode: async (sessionId, mode) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.setSessionInteractionMode(id, mode);
		},

		sessionUsage: async (sessionId) => {
			const id = realId(sessionId);
			if (!id) return undefined;
			const snapshot = await runtime.getSessionUsage(id);
			return {
				chat: summarizeUsageSummary(snapshot.chat as never),
				unmeasuredCalls: snapshot.unmeasuredCalls,
			};
		},

		compact: async (sessionId) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.compactSession(id);
		},

		selectVersion: async (sessionId, messageId, version) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.selectSessionTurnVersion(id, messageId, version);
		},

		setExpert: async (sessionId, selection) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			runtime.setSessionExpert(id, selection as never);
		},

		resolveUserRequest: async (sessionId, requestId, resolution) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.resolveUserRequest(id, requestId, resolution as never);
		},

		resolveApproval: async (sessionId, approvalId, approved, feedback) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.resolveOperationApproval(id, approvalId, approved, feedback);
		},

		setConnectors: async (sessionId, connectorIds) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.setSessionConnectors(id, [...connectorIds]);
		},

		retryTurn: async (sessionId, messageId) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.retrySessionTurn(id, messageId);
		},

		prompt: async (sessionId, text, skillIds, attachments, references) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.promptSession(
				id,
				/*
					引用**不拼进用户打的字里**,而是按桌面端同一份序列化器变成标记
					(桌面端走的是 `formatPromptWithSkillReferences(parts)`,这里走的是同一个函数)。
					好处是两端在模型那边长得**逐字一样**:正文归正文,引用归引用,
					于是"这条消息引用了哪个文件"不是靠模型去正文里猜,而是它直接读得到的一段事实。
				*/
				formatPromptWithSkillReferences(
					[
						{ type: "text" as const, text },
						...(references ?? []).map((reference) => ({
							type: "workspace-reference" as const,
							path: reference.path,
							name: reference.name,
							kind: reference.kind,
						})),
					],
				),
				skillIds === undefined ? [] : [...skillIds],
				undefined,
				attachments === undefined
					? undefined
					: {
							attachments: attachments.map((attachment, index) => ({
								// id 由本机给:运行时会用它给附件编号(远端不需要知道这个 id)。
								id: `remote-${index}-${attachment.name}`.slice(0, 160),
								name: attachment.name,
								mediaType: attachment.mediaType,
								size: attachment.size,
								source: { type: "bytes" as const, base64: attachment.base64 },
							})),
						},
			);
		},

		searchWorkspaceFiles: async (sessionId, query) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			const entries = await runtime.searchSessionWorkspace(id, query);
			return entries
				// 只留这一条链路上真用得着的三样。运行时的形状里有体积与修改时间,这里不读也不发。
				.map((entry) => ({ path: entry.path, name: entry.name, kind: entry.kind }))
				.filter((entry) => entry.path.length > 0 && entry.name.length > 0);
		},

		abort: async (sessionId) => {
			const id = realId(sessionId);
			if (!id) throw new Error(`unknown session: ${sessionId}`);
			await runtime.cancelSession(id);
		},

		setModel: async (sessionId, model, thinkingLevel): Promise<RemoteSetModelResult> => {
			const id = realId(sessionId);
			if (!id) return { ok: false, reason: "not_found" };
			// 正在回复中不能换。运行时会拒绝,但先在这里拦下来 —— 远端要的是"等它说完"这句人话,
			// 而不是一条异常文案。
			if (runtime.getSnapshot().runningSessionIds.includes(id)) return { ok: false, reason: "busy" };
			// 先用**同一份清单**判断,所以 `unavailable` 的含义很明确:清单变了(模型被停用/供应商被断开),
			// 而不是"运行时抛了个我们没读懂的错误"。
			const names = nameIndexes(runtime.getSnapshot());
			const known = selectableModels(id, names.connections, names.providerIdentities).some(
				(option) => option.connectionId === model.connectionId && option.modelId === model.modelId,
			);
			if (!known) return { ok: false, reason: "unavailable" };
			try {
				await runtime.setSessionModel(id, model, thinkingLevel);
			} catch {
				return { ok: false, reason: "failed" };
			}
			// 回读一次:给远端的必须是**本机现在的真实状态**,不是把请求参数当结果回显。
			const view = await runtime.getSessionView(id);
			return {
				ok: true,
				summary: summarize(
					view.session,
					view.isRunning ? new Set([view.session.id]) : new Set(),
					undefined,
					names.models,
				),
			};
		},

		subscribe: (listener) => {
			listeners.add(listener);
			const unsubscribe = events.subscribe((envelope) => {
				const mapped =
				mapStreamEvent(envelope) ?? mapRuntimeEvent(envelope, realToPublic, toolNames);
				if (!mapped) return;
				for (const current of listeners) current(mapped);
			});
			return () => {
				listeners.delete(listener);
				unsubscribe();
			};
		},
	};
}

/**
 * 一轮消息里的内容块。
 *
 * **这里是"推送不完整"那个问题的落点**:以前只取 text 块,于是远端看不到思考与工具执行。
 * 现在三类都发,其余的块(附件、技能引用、设计风格等)仍然不发 —— 远端不做那些事,
 * 发过去只会让它渲染出一堆自己解释不了的东西。
 */
/**
 * 从运行时的压缩记录里取远端要的那几项。
 *
 * 事件那一侧是"宽对象"(`[key: string]: unknown`),所以必须**按值域收一道**:
 * 少一个字段就当没这条(宁可不发,也不发一行读不出来的"已压缩")。
 */
function compactionFrom(value: unknown): RuntimeCompactionLike | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const trigger = record.trigger;
	if (trigger !== "manual" && trigger !== "automatic" && trigger !== "overflow") return undefined;
	if (typeof record.summary !== "string") return undefined;
	const modelId = (record.model as { readonly modelId?: unknown } | undefined)?.modelId;
	return {
		trigger,
		tokensBefore: typeof record.tokensBefore === "number" ? record.tokensBefore : 0,
		tokensAfter: typeof record.tokensAfter === "number" ? record.tokensAfter : 0,
		...(typeof modelId === "string" ? { model: { modelId } } : {}),
		summary: record.summary,
		timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
	};
}

function blocksFrom(blocks: readonly RuntimeMessageBlockLike[]): RemoteMessageBlock[] {
	const mapped: RemoteMessageBlock[] = [];
	for (const block of blocks) {
		if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
			mapped.push({ type: "text", text: clampBlock(block.text) });
			continue;
		}
		if (block.type === "reasoning" && typeof block.text === "string" && block.text.length > 0) {
			mapped.push({ type: "reasoning", text: clampBlock(block.text) });
			continue;
		}
		/*
			用户消息里 `@` 挑的文件。
			
			少了这一条,手机上那条消息只剩用户打的字 —— 引用**从界面上消失**,而模型那边是收到了的。
			两端不一致里最难查的一种:用户以为没发出去,模型却按"读了那个文件"回答。
		*/
		if (block.type === "workspace-reference") {
			const path = typeof block.path === "string" ? block.path : "";
			const name = typeof block.name === "string" && block.name.length > 0 ? block.name : path;
			const kind = block.kind === "directory" ? "directory" : "file";
			if (path.length === 0) continue;
			mapped.push({
				type: "workspace-reference",
				id: typeof block.id === "string" && block.id.length > 0 ? block.id : path,
				path: clampBlock(path),
				name: clampBlock(name),
				kind,
			});
			continue;
		}
		if (block.type === "tool") {
			const detail = typeof block.output === "string" && block.output.length > 0 ? block.output.slice(0, 2_000) : undefined;
			const args = toolArgsLine(typeof block.name === "string" ? block.name : "", block.input);
			mapped.push({
				type: "tool",
				callId: block.callId ?? block.name ?? "tool",
				name: block.name ?? "工具",
				state: toolState(block.state),
				...(args === undefined ? {} : { args }),
				...(detail === undefined ? {} : { detail }),
				...(typeof block.startedAt === "number" ? { startedAt: block.startedAt } : {}),
				...(typeof block.completedAt === "number" ? { completedAt: block.completedAt } : {}),
			});
		}
	}
	return mapped;
}

/**
 * 工具参数压成一段可读文本。
 *
 * 桌面端每个工具有自己的渲染器;远端**不照抄那几十个渲染器**,而是把参数原样(但有上限)
 * 排成一段 —— 至少让用户看出"它到底做了什么"。空对象与空串都当成"没有参数"。
 */
/**
 * 工具参数**压成一行**。
 *
 * 以前这里发的是 `JSON.stringify(input, null, 2)`:远端渲染出来是带换行的 JSON
 * (连 `timeout` 这种用户不关心的字段也在里面),于是手机上出现一条横向滚动条,
 * 命令反而被挤得看不见。
 *
 * 现在按**用户真正想看的那一个字段**取(与桌面端同一条规矩:`command ?? path`),
 * 并且**只发一行** —— 换行与花括号都不发,长的交给远端用省略号截。
 * 认不出来的工具**不发参数**(桌面端也一样):发一堆没人看得懂的东西只会占地方。
 */
function toolArgsLine(name: string, input: unknown): string | undefined {
	const record =
		typeof input === "object" && input !== null && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: undefined;
	// 按"用户最想看到的"排序:命令 > 路径 > 搜索词 > 其它常见字段。
	const preferred = ["command", "cmd", "path", "file_path", "pattern", "query", "url", "prompt", "name"];
	const text = (value: unknown): string | undefined =>
		typeof value === "string" && value.trim().length > 0 ? value : undefined;
	const value =
		(preferred.map((key) => text(record?.[key])).find((candidate) => candidate !== undefined) ??
			(typeof input === "string" ? text(input) : undefined));
	if (value === undefined) return undefined;
	// 一行:换行折成空格,再把首尾空白去掉。
	const line = value.replace(/\s*\n\s*/g, " ").trim();
	if (line.length === 0) return undefined;
	return line.length <= MAX_ARGS_LINE_CHARS ? line : `${line.slice(0, MAX_ARGS_LINE_CHARS)}…`;
}

/**
 * 把一轮里的助手消息合成一条(用户消息不动)。
 *
 * 规则与网页端的 `mergeMessage` 一致:相邻的助手消息合成一条,块按顺序接上。
 * **只影响助手**:用户消息一条就是一条。
 */
function mergeAssistantTurns(messages: readonly RemoteSessionMessage[]): RemoteSessionMessage[] {
	const merged: RemoteSessionMessage[] = [];
	for (const message of messages) {
		const previous = merged[merged.length - 1];
		if (previous === undefined || message.role !== "assistant" || previous.role !== "assistant") {
			merged.push(message);
			continue;
		}
		const index = merged.length - 1;
		merged[index] = {
			...previous,
			// 正文也要**封顶**:合并之后它是整轮的正文,而一帧装不下就会被对端关掉链路。
			text: clampMessageText([previous.text, message.text].filter((part) => part.length > 0).join("")),
			at: message.at,
			...(message.status === undefined ? {} : { status: message.status }),
			blocks: [...(previous.blocks ?? []), ...(message.blocks ?? [])],
			// 用量取**最后一条**:它带着这一轮累计出来的摘要(见 `messagesFrom`)。
			...(message.usage === undefined ? {} : { usage: message.usage }),
			...(previous.id === undefined ? {} : { id: previous.id }),
		};
	}
	return merged;
}

/**
 * 这一轮的用量摘要 —— **用桌面端 footer 同一个领域函数算**。
 *
 * 两端各算一遍迟早会出现"同一个会话两个数",所以命中率、覆盖情况这些派生值一律取自
 * `summarizeUsageMessages`。这里只做形状映射(领域类型 → 协议类型)。
 */
/** 领域层的 `TokenUsageSummary` → 协议形状(两处共用:本轮与会话总计)。 */
function summarizeUsageSummary(summary: {
	readonly modelCalls: number;
	readonly delegatedCalls: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly totalTokens: number;
	readonly promptTokens: number;
	readonly totalCost: number;
	readonly tokenHitRate: number | null;
	readonly cacheReadObservedCalls: number;
	readonly readCallCoverage: number | null;
	readonly writeCallCoverage: number | null;
	readonly cacheWriteObservation: "reported" | "read-only" | "unavailable";
	readonly reportedPromptCount: number;
	readonly reportedPromptDriftCount: number;
	readonly reportedPromptMaxDrift: number;
	readonly reportedPromptTokens: number;
}): RemoteUsageSummary {
	return {
		modelCalls: summary.modelCalls,
		delegatedCalls: summary.delegatedCalls,
		inputTokens: summary.inputTokens,
		outputTokens: summary.outputTokens,
		cacheReadTokens: summary.cacheReadTokens,
		cacheWriteTokens: summary.cacheWriteTokens,
		totalTokens: summary.totalTokens,
		promptTokens: summary.promptTokens,
		totalCost: summary.totalCost,
		hitRate: summary.tokenHitRate,
		readObservedCalls: summary.cacheReadObservedCalls,
		readCoverage: summary.readCallCoverage,
		writeCoverage: summary.writeCallCoverage,
		writeObservation: summary.cacheWriteObservation,
		reportedPromptCount: summary.reportedPromptCount,
		reportedPromptDriftCount: summary.reportedPromptDriftCount,
		reportedPromptMaxDrift: summary.reportedPromptMaxDrift,
		reportedPromptTokens: summary.reportedPromptTokens,
	};
}

function summarizeTurnUsage(messages: readonly RuntimeMessageLike[]): RemoteUsageSummary | undefined {
	/**
	 * **不要求这条消息自己有用量**:委派的用量挂在它的工具块上 ——
	 * 只要这一轮里有任何一处用量,这一轮就该有数字(桌面端的 `summarizeUsageMessages` 就是这么判的)。
	 */
	const usable = messages.filter((message) => message.role === "assistant");
	if (usable.length === 0) return undefined;
	/**
	 * **块要一起传进去** —— 委派(子代理 / 专家团)的用量挂在工具块上,算同一轮。
	 *
	 * 这里原来写的是 `blocks: []`:于是远端"本轮"少了所有委派调用 ——
	 * 与桌面端同一个会话、同一轮,两边的数字对不上(真实抱怨)。
	 * 折算只认 `@wordless/domain` 的那一个实现,所以只要把原料给全,口径就一致。
	 */
	const details = summarizeUsageMessages(
		usable.map((message) => ({ role: "assistant" as const, usage: message.usage, blocks: message.blocks }) as never),
	);
	if (details === undefined) return undefined;
	// 派生值(命中率、覆盖情况)在 `summary` 里;`usage` 是兼容用的旧形状。
	return summarizeUsageSummary(details.summary);
}

/** 合并后的正文上限:整轮的正文可能很长,而一帧只有 1.5M 字符(密封后还要膨胀)。 */
const MAX_MERGED_TEXT_CHARS = 20_000;

/** 正文封顶:保留**尾部**(最新发生的在后面)并明说被截断了。 */
function clampMessageText(text: string): string {
	return text.length <= MAX_MERGED_TEXT_CHARS
		? text
		: `${BLOCK_TRIM_MARKER}\n${text.slice(-MAX_MERGED_TEXT_CHARS)}`;
}

/** 块被裁掉时留在正文末尾的标记 —— 远端据此说"只显示了最近的一部分"。 */
const BLOCK_TRIM_MARKER = "…(更早的内容较长,已省略)";

/**
 * 裁一条消息内部的块(从最早的开始丢),直到装进预算。
 *
 * 保留**尾部**:最新发生的在后面,而用户要看的是"刚才发生了什么"。
 * 正文末尾留一个标记,这样远端能如实说"有内容没显示",而不是假装这就是全部。
 */
function trimMessageBlocks(message: RemoteSessionMessage, budget: number): RemoteSessionMessage {
	const blocks = [...(message.blocks ?? [])];
	const text = clampMessageText(message.text);
	let size = JSON.stringify({ ...message, blocks, text }).length;
	while (blocks.length > 1 && size > budget) {
		blocks.shift();
		size = JSON.stringify({ ...message, blocks, text }).length;
	}
	return { ...message, blocks, text };
}

/** 单块截断:超长的正文/思考只发前一段,并**明说**被截断了(全文仍在电脑上)。 */
function clampBlock(text: string): string {
	return text.length <= MAX_BLOCK_CHARS ? text : `${text.slice(0, MAX_BLOCK_CHARS)}\n\n…(内容较长,已截断)`;
}

/**
 * 用量归一。
 *
 * `认不出来的取值一律不发` 这条纪律同样适用:`source` 不是三种已知值时**整个字段省略**,
 * 而不是把运行时的字符串原样透出去(界面会照它写文案)。
 * 窗口为 0 或负数时直接不给 —— 那会让百分比算出 `Infinity`。
 */
function remoteContextUsage(usage: RuntimeContextUsageLike | undefined): RemoteContextUsage | undefined {
	if (!usage || usage.contextWindow <= 0) return undefined;
	const source =
		usage.source === "provider" || usage.source === "tokenizer" || usage.source === "estimate"
			? usage.source
			: undefined;
	const categories = usage.categories;
	return {
		usedTokens: Math.max(0, usage.usedTokens),
		contextWindow: usage.contextWindow,
		...(source === undefined ? {} : { source }),
		...(categories === undefined
			? {}
			: {
					categories: {
						systemPrompt: categories.systemPrompt,
						toolsAndSubagents: categories.toolsAndSubagents,
						conversation: categories.conversation,
						connectors: categories.connectors,
						skills: categories.skills,
					},
				}),
	};
}

/**
 * 提问的一个字段:严格按四种类型过滤。
 *
 * 认不出来的类型**整条丢掉**(而不是猜成文本)—— 猜错会让用户回答一个根本不是那样的问题,
 * 而答案会带着错的意思回到模型那里。
 */
function userRequestField(raw: unknown): RemoteUserRequestField | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const field = raw as Record<string, unknown>;
	if (typeof field.id !== "string" || field.id.length === 0) return undefined;
	if (typeof field.label !== "string") return undefined;
	const base = {
		id: field.id,
		label: field.label.slice(0, 300),
		...(typeof field.description === "string" ? { description: field.description.slice(0, 300) } : {}),
		...(field.required === true ? { required: true } : {}),
	};
	if (field.type === "text") {
		return {
			...base,
			type: "text",
			...(typeof field.placeholder === "string" ? { placeholder: field.placeholder.slice(0, 200) } : {}),
			...(field.multiline === true ? { multiline: true } : {}),
			...(typeof field.defaultValue === "string" ? { defaultValue: field.defaultValue } : {}),
		};
	}
	if (field.type === "confirm") {
		return {
			...base,
			type: "confirm",
			...(typeof field.defaultValue === "boolean" ? { defaultValue: field.defaultValue } : {}),
		};
	}
	if (field.type !== "select" && field.type !== "multi-select") return undefined;
	const options = (Array.isArray(field.options) ? field.options : [])
		.map((option) => {
			if (typeof option !== "object" || option === null) return undefined;
			const entry = option as { value?: unknown; label?: unknown; description?: unknown };
			if (typeof entry.value !== "string" || typeof entry.label !== "string") return undefined;
			return {
				value: entry.value,
				label: entry.label.slice(0, 200),
				...(typeof entry.description === "string" ? { description: entry.description.slice(0, 200) } : {}),
			};
		})
		.filter(
			(option): option is { readonly value: string; readonly label: string; readonly description?: string } =>
				option !== undefined,
		);
	if (options.length === 0) return undefined;
	const common = { ...base, options, ...(field.allowCustom === true ? { allowCustom: true } : {}) };
	if (field.type === "select") {
		return {
			...common,
			type: "select",
			...(typeof field.defaultValue === "string" ? { defaultValue: field.defaultValue } : {}),
		};
	}
	const defaultValues = Array.isArray(field.defaultValue)
		? field.defaultValue.filter((entry): entry is string => typeof entry === "string")
		: undefined;
	return { ...common, type: "multi-select", ...(defaultValues === undefined ? {} : { defaultValue: defaultValues }) };
}

/** 运行时的消息状态归一:远端只区分"进行中/完成/出错"。 */
function remoteMessageStatus(status: string): "streaming" | "complete" | "error" | "aborted" {
	if (status === "streaming") return "streaming";
	if (status === "error") return "error";
	if (status === "aborted") return "aborted";
	return "complete";
}

/** 运行时有 6 种工具状态,远端只关心三种:还在跑 / 跑完了 / 失败了。 */
function toolState(state: string | undefined): "running" | "done" | "failed" {
	if (state === "complete") return "done";
	if (state === "error") return "failed";
	return "running";
}

/**
 * 运行时事件 → 远端事件。
 *
 * **只映射语义确定的**:运行状态、助手/用户消息、工具执行。
 * 其余(专家团、审批、压缩、重试……)一律不映射 —— 远端只做对话,把不确定的东西猜着发出去,
 * 只会让远端显示错的东西。
 */
export function mapRuntimeEvent(
	envelope: RuntimeEnvelopeLike,
	realToPublic: ReadonlyMap<string, string>,
	/** `callId → 工具名`:更新/完成帧不带名字,只能从"开始"那一帧记下来(可选,便于单测)。 */
	toolNames: Map<string, string> = new Map(),
): RemoteSurfaceEvent | undefined {
	// 列表变了这一类事件的 sessionId 是 null,必须放在"必须带 sessionId"的检查**之前**。
	/**
	 * **当前这一轮**已经发过来的助手消息(按会话)。
	 *
	 * "本轮用量"的口径是**整轮**:运行时把一轮拆成好几条消息(说一段 → 调工具 → 再说一段),
	 * 而桌面端是按这一轮的全部消息算的(`calculateCurrentTurnUsage`)。
	 * 只拿最后那一条算,远端"本轮"就只会显示最后一段的数字 —— 与桌面端对不上(真实抱怨)。
	 */
	const liveTurnMessages = new Map<string, { turnId: string | undefined; messages: RuntimeMessageLike[] }>();

	if (envelope.event.type === "sessions.changed") return { type: "sessions-changed" };
	const sessionId = envelope.sessionId === null ? undefined : realToPublic.get(envelope.sessionId);
	if (sessionId === undefined) return undefined;
	const event = envelope.event;
	switch (event.type) {
		case "context.compaction.completed": {
			/**
			 * 压缩完成要**主动推一条**。
			 *
			 * 只在历史里映射是不够的:手动点的那次可以靠重拉,但**自动触发**的那次没人会去重拉 ——
			 * 用户只会在手机上看到"上下文忽然少了一大截",不知道发生过什么。
			 */
			const compaction = compactionFrom(event.compaction);
			if (compaction === undefined) return undefined;
			return {
				type: "message",
				sessionId,
				message: {
					role: "compaction",
					text: "",
					at: compaction.timestamp,
					blocks: [
						{
							type: "compaction",
							trigger: compaction.trigger,
							tokensBefore: compaction.tokensBefore,
							tokensAfter: compaction.tokensAfter,
							...(compaction.model?.modelId === undefined ? {} : { modelId: compaction.model.modelId }),
							summary: clampBlock(compaction.summary),
							at: compaction.timestamp,
						},
					],
				},
			};
		}
		case "run.started":
			// 新一轮:上一轮的累积作废。
			liveTurnMessages.delete(sessionId);
			// 状态文字**附在运行状态上**(而不是另发一条事件:一个信封只映射一个事件)。
			return { type: "state", sessionId, running: true, activity: "思考中" };
		case "run.completed":
		case "run.failed":
		case "run.cancelled":
			// 空字符串 = 这一轮结束了(远端据此不再显示"正在……")。
			return { type: "state", sessionId, running: false, activity: "" };
		case "approval.requested": {
			// 有工具在等用户批准。**这一条必须发出去**:不发的话,远端根本不知道电脑在等它,
			// 用户会以为"卡住了",而其实只差一个"批准"。
			const approval = event.approval as
				| {
						approvalId?: string;
						toolName?: string;
						input?: unknown;
						severity?: string;
						summary?: string;
				  }
				| undefined;
			if (typeof approval?.approvalId !== "string" || approval.approvalId.length === 0) return undefined;
			const args = toolArgsLine(typeof approval.toolName === "string" ? approval.toolName : "", approval.input);
			const severity =
				approval.severity === "low" || approval.severity === "medium" || approval.severity === "high"
					? approval.severity
					: undefined;
			return {
				type: "approval",
				sessionId,
				approvalId: approval.approvalId,
				toolName: typeof approval.toolName === "string" ? approval.toolName : "工具",
				summary: typeof approval.summary === "string" ? approval.summary.slice(0, 500) : "",
				...(args === undefined ? {} : { args }),
				...(severity === undefined ? {} : { severity }),
			};
		}
		case "approval.resolved": {
			const resolution = event.resolution as { approvalId?: string } | undefined;
			if (typeof resolution?.approvalId !== "string") return undefined;
			return { type: "approval-resolved", sessionId, approvalId: resolution.approvalId };
		}
		case "user-request.requested": {
			// 有提问在等用户回答。与审批一样:**不发的话远端不知道电脑在等它**。
			const request = event.request as
				| { requestId?: string; title?: string; description?: string; fields?: unknown }
				| undefined;
			if (typeof request?.requestId !== "string" || !Array.isArray(request.fields)) return undefined;
			const fields = request.fields
				.map(userRequestField)
				.filter((field): field is RemoteUserRequestField => field !== undefined);
			if (fields.length === 0) return undefined;
			return {
				type: "user-request",
				sessionId,
				request: {
					requestId: request.requestId,
					title: typeof request.title === "string" ? request.title.slice(0, 200) : "需要你确认几件事",
					...(typeof request.description === "string" ? { description: request.description.slice(0, 500) } : {}),
					fields,
				},
			};
		}
		case "user-request.resolved": {
			const resolution = event.resolution as { requestId?: string } | undefined;
			if (typeof resolution?.requestId !== "string") return undefined;
			return { type: "user-request-resolved", sessionId, requestId: resolution.requestId };
		}
		case "context.usage.updated": {
			// 本机估算完用量就会发这一条:远端那枚环跟着动,而不是停在打开会话时的旧值。
			const usage = remoteContextUsage(event.contextUsage as RuntimeContextUsageLike | undefined);
			return usage === undefined ? undefined : { type: "context", sessionId, context: usage };
		}
		case "message.completed": {
			const message = event.message as RuntimeMessageLike | undefined;
			if (!message) return undefined;
			const text = message.blocks
				.filter((block) => block.type === "text" && typeof block.text === "string")
				.map((block) => block.text as string)
				.join("")
				.trim();
			// 带上块:与历史走同一条路,于是"正在发生的"和"翻回去看的"长得一样(思考、工具都在)。
			const blocks = blocksFrom(message.blocks);
			/**
			 * **没有正文也要发**。
			 *
			 * 一轮里助手会写好几段:有正文的、只有工具调用的。以前"正文为空就不发",于是
			 * (1) 只调工具的那一段在远端**完全不存在**,那一轮看起来像"用户说完就没下文";
			 * (2) 远端那条流式文本**永远收不了尾** —— 收尾靠的就是这一条(按消息 id 认领),
			 *     收不到就停在最后一次节流发出的那半句上(真实抱怨:"展示不全")。
			 * 两块都没有(既没正文也没块)才不发 —— 那才是真的没内容。
			 */
			if (text.length === 0 && blocks.length === 0) return undefined;
			const trimmed = trimMessageBlocks(
				{
					role: message.role,
					text,
					at: message.timestamp,
					...(message.id === undefined ? {} : { id: message.id }),
					...(() => {
						// 把这一条累进"这一轮",再按整轮算 —— 与桌面端同一个口径。
						const turn = liveTurnMessages.get(sessionId);
						if (turn === undefined || turn.turnId !== envelope.turnId) {
							liveTurnMessages.set(sessionId, { turnId: envelope.turnId, messages: [message] });
						} else {
							turn.messages.push(message);
						}
						const usage = summarizeTurnUsage(liveTurnMessages.get(sessionId)?.messages ?? [message]);
						return usage === undefined ? {} : { usage };
					})(),
					...(message.status === undefined ? {} : { status: remoteMessageStatus(message.status) }),
					...(blocks.length === 0 ? {} : { blocks }),
				},
				// 单条消息也要装进预算:整帧超限时发送方**只能丢掉它**,而对端会因此永远等这一条。
				MAX_LIVE_MESSAGE_CHARS,
			);
			return {
				type: "message",
				sessionId,
				message: {
					...trimmed,
					...(envelope.turnId === undefined ? {} : { turnId: envelope.turnId }),
				},
			};
		}
		case "tool.started":
		case "tool.updated":
		case "tool.completed": {
			/**
			 * 名字要**自己记**:运行时的 `tool.updated` / `tool.completed` **不带 name**
			 * (只有 `callId`),照原来的写法会一律显示成"工具" —— 于是
			 * (1) 对话里凭空多出一行"工具",(2) 完成帧因为名字对不上而**更新不到**那一行,
			 * 界面上的"执行中"永远不结束。这两个都是真实抱怨。
			 */
			const callId = typeof event.callId === "string" ? event.callId : undefined;
			const explicitName = typeof event.name === "string" ? event.name : undefined;
			const name = explicitName ?? (callId === undefined ? undefined : toolNames.get(callId));
			if (callId !== undefined && explicitName !== undefined) toolNames.set(callId, explicitName);
			const detail = typeof event.output === "string" && event.output.length > 0 ? event.output : undefined;
			const args = toolArgsLine(name ?? "", event.input);
			// 状态要一起带上:远端否则只能显示"有个工具",分不出"还在跑"和"已经跑完"。
			const state = event.type === "tool.completed" ? "done" : "running";
			if (name === undefined && callId === undefined) return undefined;
			return {
				type: "tool",
				sessionId,
				...(envelope.turnId === undefined ? {} : { turnId: envelope.turnId }),
				// 名字与 callId **都没有**时才不发:那种帧远端认不出是哪一次调用,只能摆一行"工具"。
				// 有 callId 就够了 —— 远端按它认领已经画出来的那一行(名字它自己有)。
				...(name === undefined ? {} : { name }),
				...(callId === undefined ? {} : { callId }),
				state,
				// 措辞按**工具类别**分(与桌面端同一套说法)。
				activity: event.type === "tool.completed" ? "正在分析工具结果" : activityForTool(name ?? "", "running"),
				...(args === undefined ? {} : { args }),
				...(detail === undefined ? {} : { detail: detail.slice(0, 2_000) }),
			};
		}
		default:
			return undefined;
	}
}
