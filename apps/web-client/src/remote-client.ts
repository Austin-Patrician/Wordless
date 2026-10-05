import {
	ATTACHMENT_CHUNK_BYTES,
	ATTACHMENT_MAX_FILES,
	checkAttachment,
} from "@wordless/remote-control";
import { settleSent, type SentState } from "./composer";
import { isUnsupportedMethod } from "./workspace-search";
import {
	applyStream,
	upsertLiveTool,
	mergeEarlier,
	mergeMessage,
	mergeSessionState,
	mergeSessionSummary,
	type LocalMessageFlags,
} from "./session-model";
import {
	RemoteConnection,
	WebSocketTransport,
	buildPairingProtocols,
	fromBase64Url,
	generateIdentityKeyPair,
	identityKeyPairFromSecret,
	inviteBoxId,
	inviteBoxUrl,
	isValidInvitePassword,
	normalizeInviteCode,
	openInvite,
	parseInviteQr,
	readInviteEnvelope,
	type RemoteConnectionEvent,
	type RemoteIdentityKeyPair,
	type RemoteMessageBlock as RemoteMessageBlockType,
	type RemoteContextUsage,
	type RemoteEntryOption,
	type RemoteModelOption,
	type RemoteExpertOption,
	type RemoteSkillOption,
	type RemoteConnectorSummary,
	type RemoteUsageSummary as RemoteUsageSummaryType,
	type RemoteUserRequest as RemoteUserRequestType,
	type RemoteSessionMessage,
	type RemoteSessionSummary,
	type RemoteModeOption,
	type RemoteWorkspaceOption,
	type RemoteDesignStyleOption,
	type RemoteWorkspaceReference,
} from "@wordless/remote-control";

/**
 * 浏览器客户端的状态层。
 *
 * 它只做三件事:把"连接码 + 密码"换成一条中继连接、把协议事件翻译成界面状态、把状态持久化到本机
 * (下次打开不用再输码)。
 *
 * 这里**没有**任何业务判断 —— 会话内容、执行结果全在本机,浏览器只是遥控器。
 */

export type RemotePhase = "idle" | "pairing" | "connecting" | "online" | "recovering" | "offline" | "error";

export type RemoteSession = RemoteSessionSummary;

/** 直接复用协议包里的形状:主进程发什么、网页端读什么,是同两份类型。 */
/** 消息 + 这一端自己的标记(发送状态、是否还在流式接收):本机不知道这些,所以只存在于网页端。 */
export type RemoteMessage = RemoteSessionMessage & LocalMessageFlags;
export type RemoteMessageBlock = RemoteMessageBlockType;

/** 压缩上下文那一块(渲染层要按它取字段,单独点个名)。 */
export type RemoteCompactionBlock = Extract<RemoteMessageBlockType, { readonly type: "compaction" }>;

/** 已经传到本机、等着随下一条消息发出去的附件。 */
export interface RemotePendingAttachment {
	readonly uploadId: string;
	readonly name: string;
	readonly size: number;
	/** 上传进度 0..1(传完就是 1)。 */
	readonly progress: number;
}

/** 一条等用户批准的工具调用。 */
export interface RemoteApproval {
	readonly approvalId: string;
	readonly toolName: string;
	readonly summary: string;
	readonly args?: string;
	readonly severity?: "low" | "medium" | "high";
	readonly at: number;
}

/** 用量摘要(协议形状):视图与客户端共用一份。 */
export type RemoteUsageSummary = RemoteUsageSummaryType;

/** 对外就这个名字:视图里要用它渲染表单。 */
export type RemoteUserRequest = RemoteUserRequestType;

export interface RemoteClientState {
	readonly phase: RemotePhase;
	readonly error?: string;
	readonly deviceName?: string;
	readonly sessions: readonly RemoteSession[];
	/** 新建会话页的选项(打开那一页时取一次)。 */
	readonly entries?: readonly RemoteEntryOption[];
	/** 新建页最上面那一栏(日常工作 / 写代码 / 创作)。 */
	readonly modes?: readonly RemoteModeOption[];
	/**
	 * 新建会话时能选哪些模型。
	 *
	 * 与 `models` **分开存**:那个是"这个会话能换成哪些"(随会话打开而变),
	 * 这个是"这台机器上已启用的全部"(新建页还没有会话)。
	 */
	readonly catalogModels?: readonly RemoteModelOption[];
	/** 新建会话时能选的工作目录(代码 / 数据分析这类必须先挑一个)。 */
	readonly workspaces?: readonly RemoteWorkspaceOption[];
	/** 新建会话时能选的设计风格(只有设计那一类用得上)。 */
	readonly designStyles?: readonly RemoteDesignStyleOption[];
	/** 正在新建(界面上禁用按钮,避免连点建出两个会话)。 */
	readonly creating?: boolean;
	/**
	 * 正在**打开某个会话**(会话切换在手机上有明显延迟:要走一趟中继 + 本机读历史)。
	 *
	 * 少了它,用户点完那一行之后界面**一动不动**,只能猜自己点没点上(真实抱怨)。
	 */
	readonly opening?: boolean;
	/** 正在打开的是哪一个:列表里那一行显示转圈,而不是让整页只有一个笼统的提示。 */
	readonly openingSessionId?: string;
	readonly sessionId?: string;
	readonly messages: readonly RemoteMessage[];
	readonly running: boolean;
	/** 有一条消息正在发出去(按钮据此转圈、并防重复点击)。 */
	readonly sending: boolean;
	/** 电脑现在在做什么(与桌面端同一套措辞)。空 = 这一轮结束了。 */
	readonly activity?: string;
	/** 已经重连了几次(从连接的快照里读)。界面据此区分"抖一下"和"连不上"。 */
	readonly reconnectAttempts?: number;
	/** 可以在这个会话里用的技能(「+」里的技能选择用它)。 */
	readonly skills?: readonly RemoteSkillOption[];
	/** 可以选的专家与专家团(**只有支持专家团的会话才有**)。 */
	readonly experts?: readonly RemoteExpertOption[];
	/** 这台机器上可以连的连接器(已启用的)。 */
	readonly availableConnectors?: readonly RemoteConnectorSummary[];
	/** 等用户批准的审批。批准之后本机才会真的执行那个工具。 */
	readonly approvals: readonly RemoteApproval[];
	/** 等用户回答的提问(不回答的话那一轮就停在那儿)。 */
	readonly requests: readonly RemoteUserRequestType[];
	/** 已经传完、随下一条消息发出去的附件。 */
	readonly attachments: readonly RemotePendingAttachment[];
	/** 这个会话能换成哪些模型。**缺席 = 这台机器不支持远端换模型**(不是空清单)。 */
	readonly models?: readonly RemoteModelOption[];
	/** 还有更早的消息时可以往回翻。 */
	readonly earlierCursor?: string;
	/** 因为体积限制,只显示了最近的一部分。 */
	readonly truncated: boolean;
	/** 正在等待本机放行(手动配对时)。 */
	readonly waitingForApproval: boolean;
}

interface StoredPairing {
	readonly pairingId: string;
	readonly relay: string;
	readonly secret: string;
	readonly deviceName: string;
}

const STORAGE_KEY = "wordless.remote.pairing.v1";
/**
 * 初始状态。
 *
 * **导出**它:测试夹具与页面都要造一个"没连上的客户端状态",两边各抄一份的话,
 * 每次加字段都会漏(已经漏了三回 —— 每回都是"某处读 undefined.map")。
 */
export const INITIAL_REMOTE_STATE: RemoteClientState = {
	phase: "idle",
	sessions: [],
	messages: [],
	running: false,
	sending: false,
	approvals: [],
	requests: [],
	attachments: [],
	waitingForApproval: false,
	truncated: false,
};

export class RemoteClient {
	private state: RemoteClientState = INITIAL_REMOTE_STATE;
	private connection: RemoteConnection | undefined;
	private transport: WebSocketTransport | undefined;
	private listeners = new Set<() => void>();
	private toolCounter = 0;

	private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;

	// 注意:`erasableSyntaxOnly` 不允许参数属性,所以这里显式声明再赋值。
	constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = globalThis.localStorage) {
		this.storage = storage;
	}

	/** React 的 `useSyncExternalStore` 用它订阅。 */
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getState = (): RemoteClientState => this.state;

	/** 上次配对过就直接恢复 —— 用户不用每次输码。 */
	async restore(): Promise<boolean> {
		const stored = this.readStored();
		if (!stored) return false;
		await this.connect(stored);
		return true;
	}

	/**
	 * 用连接码 + 密码配对:从本机留下的加密信封里取回配对信息。
	 * 中继只见到连接码的哈希,看不到码、密码与内容。
	 */
	async pairWithCode(input: {
		readonly code: string;
		readonly password: string;
		readonly relayBaseUrl?: string;
	}): Promise<void> {
		const code = normalizeInviteCode(input.code);
		if (!code) {
			this.fail("连接码不对:应为 8 位(不含 I、L、O、U)。");
			return;
		}
		if (!isValidInvitePassword(input.password)) {
			this.fail("密码不对:应为 6 位数字。");
			return;
		}
		const relay = input.relayBaseUrl ?? defaultRelayBaseUrl();
		this.setState({ ...this.state, phase: "pairing", error: undefined });
		try {
			const boxUrl = inviteBoxUrl(relay, inviteBoxId(code));
			const response = await fetch(boxUrl);
			if (!response.ok) throw new Error("这台机器没有留下可用的邀请(可能已过期或被领取)。");
			const envelope = readInviteEnvelope(await response.json());
			if (!envelope) throw new Error("中继上的邀请格式不对。");
			const uri = await openInvite(envelope, code, input.password);
			const pairing = parsePairingUri(uri);
			if (!pairing) throw new Error("邀请内容无法解析。");
			await this.connect({ ...pairing, deviceName: browserDeviceName() });
		} catch (error) {
			this.fail(error instanceof Error ? error.message : "配对失败。");
		}
	}

	/** 直接粘贴二维码里的文本(手机相机扫码得到的就是它)。 */
	async pairWithQrText(text: string): Promise<void> {
		const parsed = parseInviteQr(text);
		if (!parsed) {
			this.fail("这不是 Wordless 的配对码。");
			return;
		}
		await this.pairWithCode({
			code: parsed.code,
			password: parsed.password,
			...(parsed.relayBaseUrl === undefined ? {} : { relayBaseUrl: parsed.relayBaseUrl }),
		});
	}

	async disconnect(): Promise<void> {
		await this.connection?.close("用户断开");
		this.connection = undefined;
		this.transport = undefined;
		this.storage?.removeItem(STORAGE_KEY);
		this.setState({ ...INITIAL_REMOTE_STATE, phase: "idle" });
	}

	async listSessions(): Promise<void> {
		const result = await this.request("session.list");
		const sessions = (result.payload as { sessions?: RemoteSession[] } | undefined)?.sessions ?? [];
		this.setState({ ...this.state, sessions });
	}

	async openSession(sessionId: string): Promise<void> {
		/**
		 * **先把"正在打开"摆出去,再把消息清空。**
		 *
		 * 清空是刻意的:留着上一个会话的消息,界面会变成"标题是新会话、内容还是旧的",
		 * 而用户读不出这是"还没到"还是"就是这个内容"。清空 + 一个明确的加载态,两件事都不含糊。
		 */
		this.setState({
			...this.state,
			sessionId,
			opening: true,
			openingSessionId: sessionId,
			error: undefined,
			messages: [],
		});
		const result = await this.request("session.open", { sessionId });
		if (!result.success) {
			// **失败就说失败**。以前这里不看结果,直接写一个空数组 ——
			// 于是"打开失败"被显示成"这个会话还没有消息",用户以为会话是空的。
			this.setState({
				...this.state,
				sessionId,
				opening: false,
				openingSessionId: undefined,
				error: result.error?.message ?? "打不开这个会话",
			});
			return;
		}
		const payload = result.payload as
			| {
					summary?: RemoteSession;
					messages?: RemoteMessage[];
					models?: readonly RemoteModelOption[];
					skills?: readonly RemoteSkillOption[];
					experts?: readonly RemoteExpertOption[];
					availableConnectors?: readonly RemoteConnectorSummary[];
					cursor?: string;
					truncated?: boolean;
			  }
			| undefined;
		const summary = payload?.summary;
		this.setState({
			...this.state,
			sessionId,
			opening: false,
			openingSessionId: undefined,
			error: undefined,
			messages: payload?.messages ?? [],
			running: summary?.running ?? false,
			// 清单随会话一起来:这台机器支不支持换模型,看这一项在不在。
			models: payload?.models,
			skills: payload?.skills,
			experts: payload?.experts,
			availableConnectors: payload?.availableConnectors,
			approvals: [],
			requests: [],
			attachments: [],
			earlierCursor: payload?.cursor,
			truncated: payload?.truncated ?? false,
			...(summary === undefined ? {} : { sessions: mergeSessionSummary(this.state.sessions, summary) }),
		});
	}

	/** 往上翻:取更早的一页,拼到前面(不覆盖现在已经看到的内容)。 */
	async loadEarlier(): Promise<void> {
		const sessionId = this.state.sessionId;
		const cursor = this.state.earlierCursor;
		if (!sessionId || cursor === undefined) return;
		const result = await this.request("session.history", { sessionId, payload: { cursor } });
		if (!result.success) {
			this.setState({ ...this.state, error: result.error?.message ?? "取不到更早的消息" });
			return;
		}
		const payload = result.payload as { messages?: RemoteMessage[]; cursor?: string } | undefined;
		this.setState({
			...this.state,
			messages: mergeEarlier(this.state.messages, payload?.messages ?? []),
			earlierCursor: payload?.cursor,
		});
	}

	/**
	 * 换模型。
	 *
	 * 失败**不写全局错误条**,而是把话交回给调用方 —— 换模型的失败发生在选择器里,
	 * 提示就该出现在选择器里,而不是飘到对话上面去。
	 */
	async setModel(
		connectionId: string,
		modelId: string,
		thinkingLevel?: string,
	): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.model", {
			sessionId,
			payload: { connectionId, modelId, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) },
		});
		if (!result.success) return { ok: false, message: result.error?.message ?? "换模型失败" };
		// 本机回的是**它现在的真实状态**,直接合进列表(不等事件回来)。
		const summary = (result.payload as { summary?: RemoteSession } | undefined)?.summary;
		if (summary) this.setState({ ...this.state, sessions: mergeSessionSummary(this.state.sessions, summary) });
		return { ok: true };
	}

	/**
	 * 发消息:远端只说"发出去了",真正干活的是本机;结果通过事件流回来。
	 *
	 * 气泡先画出来并标成**发送中** —— 本机确认之前,它不能看起来像"已经发出去了";
	 * 失败时保留文本并标成失败,让用户能重试(而不是让他重打一遍)。
	 */
	async send(
		text: string,
		references: readonly RemoteWorkspaceReference[] = [],
		skillIds: readonly string[] = [],
	): Promise<void> {
		const sessionId = this.state.sessionId;
		const trimmed = text.trim();
		// **只有 token、没有正文**是合法的(与桌面端一样:挑一个文件 / 点一个技能就是在问"用这个")。
		if (!sessionId || (trimmed.length === 0 && references.length === 0 && skillIds.length === 0)) return;
		const at = Date.now();
		const optimistic: RemoteMessage = {
			role: "user",
			text: trimmed,
			at,
			pending: true,
			// 引用**当场就画出来**:它已经定了,不必等本机回话。
			...(references.length === 0 ? {} : { blocks: referenceBlocks(references) }),
		};
		this.setState({
			...this.state,
			messages: [...this.state.messages, optimistic],
			sending: true,
			error: undefined,
		});
		await this.deliver(sessionId, trimmed, at, references, skillIds);
	}

	/** 重发一条失败的消息:把它重新标成"发送中",而不是再插一条新的。 */
	async retry(at: number): Promise<void> {
		const sessionId = this.state.sessionId;
		const message = this.state.messages.find((entry) => entry.at === at && entry.role === "user");
		if (!sessionId || !message) return;
		this.setState({
			...this.state,
			messages: this.state.messages.map((entry) =>
				entry.at === at && entry.role === "user" ? { ...entry, pending: true, failed: false } : entry,
			),
			sending: true,
			error: undefined,
		});
		/*
			重发时**把引用从那条消息自己身上读回来**。
			
			少了这一步,第一次发送失败之后引用已经被清空了 —— 用户点"重试",发出去的是一句
			没有引用的正文,而模型那边就再也看不到那个文件了(用户完全看不出来)。
		*/
		await this.deliver(sessionId, message.text, at, workspaceReferencesOf(message.blocks));
	}

	private async deliver(
		sessionId: string,
		text: string,
		at: number,
		references: readonly RemoteWorkspaceReference[] = [],
		skillIds: readonly string[] = [],
	): Promise<void> {
		const attachments = this.state.attachments;
		const result = await this.request("session.prompt", {
			sessionId,
			payload: {
				text,
				...(skillIds.length === 0 ? {} : { skillIds }),
				...(attachments.length === 0 ? {} : { attachments: attachments.map((entry) => ({ uploadId: entry.uploadId })) }),
				...(references.length === 0 ? {} : { references }),
			},
		});
		if (attachments.length > 0) this.setState({ ...this.state, attachments: [] });
		if (result.success) {
			this.setState({ ...this.state, sending: false, messages: settleSent(this.state.messages, at, { pending: false }) });
			return;
		}
		this.setState({
			...this.state,
			sending: false,
			messages: settleSent(this.state.messages, at, { pending: false, failed: true }),
			error: result.error?.message ?? "发送失败",
		});
	}

	/**
	 * 新建会话页要的那一份:工作类型 + 连接器 + 技能。
	 *
	 * 一次取全(而不是分三次):它们同时被需要,分三次只会让那一页分三次闪。
	 * 连接器与技能**本来就是"这一轮怎么干活"的一部分** —— 建会话时就该能选(与桌面端一致)。
	 */
	async loadCatalog(): Promise<void> {
		const result = await this.request("catalog.list");
		const payload = result.payload as
			| {
					entries?: readonly RemoteEntryOption[];
					connectors?: readonly RemoteConnectorSummary[];
					skills?: readonly RemoteSkillOption[];
					workspaces?: readonly RemoteWorkspaceOption[];
					designStyles?: readonly RemoteDesignStyleOption[];
					modes?: readonly RemoteModeOption[];
					models?: readonly RemoteModelOption[];
			  }
			| undefined;
		this.setState({
			...this.state,
			entries: payload?.entries ?? [],
			modes: payload?.modes ?? [],
			catalogModels: payload?.models ?? [],
			availableConnectors: payload?.connectors ?? [],
			skills: payload?.skills ?? [],
			workspaces: payload?.workspaces ?? [],
			designStyles: payload?.designStyles ?? [],
		});
	}

	/**
	 * 新建一个会话并发出第一条消息。
	 *
	 * 两条路合一次调用(与桌面端 WelcomeView 一样):分开的话中间会留下一个"建好了但没人说话"的空会话,
	 * 而用户看到的只是"点了没反应"。成功后直接打开这个新会话 —— 用户要的是"开始干活",不是"多了一条记录"。
	 */
	async createSession(input: {
		readonly entryId: string;
		readonly text: string;
		/** 这一轮用哪些技能 / 连哪些连接器:与第一条消息一起发(与桌面端 WelcomeView 同一条路)。 */
		readonly skillIds?: readonly string[];
		readonly connectorIds?: readonly string[];
		/** 工作目录(代码 / 数据分析这类必须给)。 */
		readonly workspaceId?: string;
		/** 设计风格(只有设计那一类用得上)。 */
		readonly designStyleId?: string;
	}): Promise<{ readonly ok: boolean; readonly message?: string }> {
		this.setState({ ...this.state, creating: true });
		const result = await this.request("session.create", { payload: input });
		if (!result.success) {
			this.setState({ ...this.state, creating: false });
			return { ok: false, message: result.error?.message ?? "新建失败" };
		}
		const summary = (result.payload as { summary?: RemoteSession } | undefined)?.summary;
		if (!summary) {
			this.setState({ ...this.state, creating: false });
			return { ok: false, message: "新建失败" };
		}
		this.setState({
			...this.state,
			sessions: mergeSessionSummary(this.state.sessions, summary),
			creating: false,
		});
		await this.openSession(summary.id);
		return { ok: true };
	}

	/** 用户看过那条错误了:关掉它。 */
	clearError(): void {
		this.setState({ ...this.state, error: undefined });
	}

	/**
	 * 重做某一轮。
	 *
	 * 只在**最新一轮**上成立(本机也会再校验一次):重做是"以这一轮为末端重写之后的历史",
	 * 对中间的回复做重做在语义上不成立,还会把后面已经发生的对话丢掉。
	 */
	async retryTurn(userMessageId: string): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.retry-turn", { sessionId, payload: { messageId: userMessageId } });
		if (!result.success) {
			// 失败时把**本机那份**拉回来:界面上可能已经乐观地清掉了这一轮的旧回答。
			await this.openSession(sessionId).catch(() => undefined);
			return { ok: false, message: result.error?.message ?? "重做失败" };
		}
		/**
		 * 成功之后**清掉这一轮的旧回答**,并标成"在跑"。
		 *
		 * 本机会以这一轮为末端重写历史:新的回答是一条**新消息**,旧的那条不会自己消失 ——
		 * 不清理就会两条答案并排(看起来像"重做没生效")。桌面端也是这么做的(`beginTurnRetry`)。
		 */
		this.setState({
			...this.state,
			messages: this.state.messages.filter(
				(message) => message.role !== "assistant" || message.turnId !== `turn:${userMessageId}`,
			),
			running: true,
			error: undefined,
		});
		return { ok: true };
	}

	/** 改权限(访问权限 / 工具确认)。只发改动的那一项。 */
	async setPermissions(patch: {
		readonly accessLevel?: "default" | "full";
		readonly toolApprovalMode?: "manual" | "auto" | "bypass";
	}): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.permissions", { sessionId, payload: patch });
		if (!result.success) return { ok: false, message: result.error?.message ?? "改不了" };
		const summary = (result.payload as { summary?: RemoteSession } | undefined)?.summary;
		if (summary) this.setState({ ...this.state, sessions: mergeSessionSummary(this.state.sessions, summary) });
		return { ok: true };
	}

	/** 改这个会话用哪些连接器(只能在已启用的里面挑,本机再校验一次)。 */
	async setConnectors(connectorIds: readonly string[]): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.connectors", { sessionId, payload: { connectorIds } });
		if (!result.success) return { ok: false, message: result.error?.message ?? "改不了" };
		const summary = (result.payload as { summary?: RemoteSession } | undefined)?.summary;
		if (summary) this.setState({ ...this.state, sessions: mergeSessionSummary(this.state.sessions, summary) });
		return { ok: true };
	}

	/** 回答一次审批。**批准之后本机才会真的执行那个工具**。 */
	async resolveApproval(approvalId: string, approved: boolean): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.approval", { sessionId, payload: { approvalId, approved } });
		if (!result.success) return { ok: false, message: result.error?.message ?? "这条审批已经不在了" };
		// 本机也会推一条"已解决",但先把卡片收掉:用户点了就该立刻看到结果。
		this.setState({
			...this.state,
			approvals: this.state.approvals.filter((entry) => entry.approvalId !== approvalId),
		});
		return { ok: true };
	}

	/** 回答一次提问:提交答案或取消。 */
	async answerRequest(
		requestId: string,
		resolution: { readonly status: "submitted" | "cancelled"; readonly answers?: Record<string, unknown> },
	): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.user-request", {
			sessionId,
			payload: { requestId, ...resolution },
		});
		if (!result.success) return { ok: false, message: result.error?.message ?? "这个提问已经不在了" };
		this.setState({
			...this.state,
			requests: this.state.requests.filter((entry) => entry.requestId !== requestId),
		});
		return { ok: true };
	}

	/**
	 * 上传一个附件(分片)。
	 *
	 * 分片大小由**本机**在 begin 时给回来(`chunkBytes`),而不是两端各写一个常量 ——
	 * 上限变了只改一处,不然会出现"网页端切得比本机收得大"这种只有真机上才看得见的错。
	 */
	async uploadAttachment(
		file: File,
		options: { readonly onProgress?: (progress: number) => void } = {},
	): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const rejection = checkAttachment({ name: file.name, size: file.size });
		if (rejection) return { ok: false, message: rejection.message };
		if (this.state.attachments.length >= ATTACHMENT_MAX_FILES) {
			return { ok: false, message: `一次最多发 ${ATTACHMENT_MAX_FILES} 个文件。` };
		}
		const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		const begin = await this.request("session.attachment", {
			payload: {
				phase: "begin",
				uploadId,
				name: file.name,
				mediaType: file.type.length > 0 ? file.type : "application/octet-stream",
				size: file.size,
			},
		});
		if (!begin.success) return { ok: false, message: begin.error?.message ?? "这个文件发不了" };
		const chunkBytes =
			typeof (begin.payload as { chunkBytes?: unknown } | undefined)?.chunkBytes === "number"
				? ((begin.payload as { chunkBytes: number }).chunkBytes)
				: ATTACHMENT_CHUNK_BYTES;
		const total = Math.max(1, Math.ceil(file.size / chunkBytes));
		this.setState({
			...this.state,
			attachments: [...this.state.attachments, { uploadId, name: file.name, size: file.size, progress: 0 }],
		});
		for (let index = 0; index < total; index += 1) {
			const slice = file.slice(index * chunkBytes, Math.min(file.size, (index + 1) * chunkBytes));
			const base64 = await blobToBase64(slice);
			const chunk = await this.request("session.attachment", {
				payload: { phase: "chunk", uploadId, index, base64 },
			});
			if (!chunk.success) {
				// 传一半失败:告诉本机把它丢掉,别让半截文件占着地方。
				await this.request("session.attachment", { payload: { phase: "abort", uploadId } });
				this.setState({
					...this.state,
					attachments: this.state.attachments.filter((entry) => entry.uploadId !== uploadId),
				});
				return { ok: false, message: chunk.error?.message ?? "传到一半失败了" };
			}
			const progress = (index + 1) / total;
			options.onProgress?.(progress);
			this.setState({
				...this.state,
				attachments: this.state.attachments.map((entry) =>
					entry.uploadId === uploadId ? { ...entry, progress } : entry,
				),
			});
		}
		return { ok: true };
	}

	/** 撤掉一个还没发出去的附件。 */
	async removeAttachment(uploadId: string): Promise<void> {
		this.setState({ ...this.state, attachments: this.state.attachments.filter((entry) => entry.uploadId !== uploadId) });
		await this.request("session.attachment", { payload: { phase: "abort", uploadId } });
	}

	/**
	 * 在**这个会话的工作区**里搜文件与目录(输入框里的 `@`)。
	 *
	 * 只读:不改任何状态,也不进"发送中"那条状态机 —— 用户一边打字一边搜,不该让发送键跟着变。
	 * 结果**不进客户端状态**:它是"这一刻那个下拉框里摆什么",而不是会话的一部分
	 * (进了状态就得决定"什么时候清掉",而那种问题最后都会变成"下拉框里是上一个会话的文件")。
	 */
	async searchWorkspaceFiles(query: string): Promise<{
		readonly ok: boolean;
		readonly entries?: readonly RemoteWorkspaceReference[];
		readonly message?: string;
		/** 本机不认识这个方法(老版本桌面端):调用方据此不再摆选择器。 */
		readonly unsupported?: boolean;
	}> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.workspace-files", { sessionId, payload: { query } });
		if (!result.success) {
			return {
				ok: false,
				message: result.error?.message ?? "搜不到工作区文件",
				...(isUnsupportedMethod(result.error) ? { unsupported: true } : {}),
			};
		}
		const entries = (result.payload as { entries?: readonly RemoteWorkspaceReference[] } | undefined)?.entries ?? [];
		return { ok: true, entries };
	}


	/** 读这个会话的**总计**用量(桌面端用量详情里的"会话统计")。 */
	async sessionUsage(): Promise<{
		readonly ok: boolean;
		readonly chat?: RemoteUsageSummary;
		readonly unmeasuredCalls?: number;
		readonly message?: string;
	}> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.usage", { sessionId });
		if (!result.success) return { ok: false, message: result.error?.message ?? "读不到会话统计" };
		const payload = result.payload as { chat?: RemoteUsageSummary; unmeasuredCalls?: number } | undefined;
		return {
			ok: true,
			...(payload?.chat === undefined ? {} : { chat: payload.chat }),
			...(payload?.unmeasuredCalls === undefined ? {} : { unmeasuredCalls: payload.unmeasuredCalls }),
		};
	}

	/** 手动压缩上下文。 */
	async compact(): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.compact", { sessionId });
		if (!result.success) return { ok: false, message: result.error?.message ?? "压缩不了" };
		return { ok: true };
	}

	/**
	 * 切换某一轮回复的版本。
	 *
	 * 参数是**这一轮的用户消息 id**(与重做同一个口径):运行时按它查这一轮的版本,
	 * 传助手消息的 id 会被拒("这一轮没有别的版本")。
	 */
	async selectVersion(userMessageId: string, version: number): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.version", {
			sessionId,
			payload: { messageId: userMessageId, version },
		});
		if (!result.success) return { ok: false, message: result.error?.message ?? "换不了这一版" };
		// 换了版本等于换了这一轮之后的历史:整体重拉,而不是就地改一条消息。
		await this.openSession(sessionId);
		return { ok: true };
	}

	/** 换专家 / 专家团(null = 不用)。 */
	async setExpert(
		selection: { readonly kind: "expert" | "team"; readonly id: string; readonly version: string } | null,
	): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.expert", { sessionId, payload: { selection } });
		if (!result.success) return { ok: false, message: result.error?.message ?? "换不了专家" };
		const summary = (result.payload as { summary?: RemoteSession } | undefined)?.summary;
		if (summary) this.setState({ ...this.state, sessions: mergeSessionSummary(this.state.sessions, summary) });
		return { ok: true };
	}

	/** 改交互模式。 */
	async setMode(mode: "default" | "plan" | "clarify"): Promise<{ readonly ok: boolean; readonly message?: string }> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return { ok: false, message: "还没有打开会话" };
		const result = await this.request("session.mode", { sessionId, payload: { mode } });
		if (!result.success) return { ok: false, message: result.error?.message ?? "改不了" };
		const summary = (result.payload as { summary?: RemoteSession } | undefined)?.summary;
		if (summary) this.setState({ ...this.state, sessions: mergeSessionSummary(this.state.sessions, summary) });
		return { ok: true };
	}


	async abort(): Promise<void> {
		const sessionId = this.state.sessionId;
		if (!sessionId) return;
		await this.request("session.abort", { sessionId });
		this.setState({ ...this.state, running: false });
	}

	// ── 内部 ────────────────────────────────────────────────────────────────────

	private async connect(pairing: StoredPairing): Promise<void> {
		this.setState({ ...this.state, phase: "connecting", error: undefined });
		// 手机的身份密钥就是邀请里带的那把长期密钥:中继只认它的哈希,所以别人拿到码也进不来。
		const identity: RemoteIdentityKeyPair = identityKeyPairFromSecret(fromBase64Url(pairing.secret));
		const url = `${pairing.relay.replace(/^http/, "ws")}/v2/relay/${pairing.pairingId}/mobile`;
		const protocols = buildPairingProtocols({ pairingSecret: pairing.secret });
		const openTransport = () =>
			new WebSocketTransport({
				url,
				protocols,
				factory: { open: (target, offered) => new WebSocket(target, offered) },
			});
		const connection = new RemoteConnection({
			role: "mobile",
			deviceId: pairing.deviceName,
			deviceName: pairing.deviceName,
			capabilities: { chat: true, sessionRead: true },
			identity,
			handshake: "initiate",
			// 手机切后台、Wi-Fi 抖动、中继重启都会断:断了要**自己接回来**,而不是停在一句"正在重连"上。
			reconnect: async () => openTransport(),
		});
		connection.onEvent((event) => this.handleConnectionEvent(event));
		const transport = openTransport();
		this.connection = connection;
		this.transport = transport;
		this.storage?.setItem(STORAGE_KEY, JSON.stringify(pairing));
		try {
			await connection.connect(transport);
		} catch (error) {
			// 失败时给出**可能的原因**,而不是一句"连接失败":这几条覆盖了绝大多数实际情况。
			const reason = error instanceof Error && error.message.length > 0 ? error.message : "未知原因";
			this.fail(
				`${reason}。常见原因:电脑上的中继或隧道没在运行、地址变了、或者这台设备的邀请已经用过/过期。`,
			);
			return;
		}
		this.setState({ ...this.state, phase: "online", deviceName: pairing.deviceName, error: undefined });
		await this.listSessions();
	}

	private handleConnectionEvent(event: RemoteConnectionEvent): void {
		switch (event.type) {
			case "state":
				if (event.state === "reconnecting") {
					this.setState({
						...this.state,
						phase: "offline",
						reconnectAttempts: this.connection?.getSnapshot().reconnectCount ?? 0,
					});
				} else if (event.state === "recovering") {
					// 事件在补(收到了跳号):**说出来**,否则界面看起来跟"空闲"一模一样。
					this.setState({ ...this.state, phase: "recovering" });
				} else if (event.state === "online") {
					this.setState({ ...this.state, phase: "online", waitingForApproval: false, reconnectAttempts: undefined });
				}
				else if (event.state === "pending_approval") this.setState({ ...this.state, waitingForApproval: true });
				return;
			case "peer-status":
				this.setState({
					...this.state,
					phase: event.online ? "online" : "offline",
					reconnectAttempts: event.online ? undefined : (this.connection?.getSnapshot().reconnectCount ?? 0),
				});
				return;
			case "error":
				this.setState({ ...this.state, error: event.error.message });
				return;
			case "remote-event":
				this.handleRemoteEvent(event.event.name, event.event.sessionId, event.event.payload);
				return;
			default:
				return;
		}
	}

	private handleRemoteEvent(name: string, sessionId: string | undefined, payload: unknown): void {
		if (name === "session.list") {
			void this.listSessions();
			return;
		}
		if (sessionId !== undefined && this.state.sessionId !== undefined && sessionId !== this.state.sessionId) return;
		if (name === "session.user-request") {
			const payload_ = payload as
				| { request?: RemoteUserRequestType; requestId?: string; resolved?: boolean }
				| undefined;
			if (payload_?.resolved === true && typeof payload_.requestId === "string") {
				this.setState({
					...this.state,
					requests: this.state.requests.filter((entry) => entry.requestId !== payload_.requestId),
				});
				return;
			}
			const request = payload_?.request;
			if (!request || typeof request.requestId !== "string") return;
			if (this.state.requests.some((entry) => entry.requestId === request.requestId)) return;
			this.setState({ ...this.state, requests: [...this.state.requests, request] });
			return;
		}
		if (name === "session.approval") {
			const payload_ = payload as
				| { approvalId?: string; toolName?: string; summary?: string; args?: string; severity?: "low" | "medium" | "high"; resolved?: boolean }
				| undefined;
			if (typeof payload_?.approvalId !== "string") return;
			if (payload_.resolved === true) {
				// 任何一端解决了都要把卡片收掉 —— 包括电脑上的人先点了批准。
				this.setState({
					...this.state,
					approvals: this.state.approvals.filter((entry) => entry.approvalId !== payload_.approvalId),
				});
				return;
			}
			if (this.state.approvals.some((entry) => entry.approvalId === payload_.approvalId)) return;
			this.setState({
				...this.state,
				approvals: [
					...this.state.approvals,
					{
						approvalId: payload_.approvalId,
						toolName: payload_.toolName ?? "工具",
						summary: payload_.summary ?? "",
						...(payload_.args === undefined ? {} : { args: payload_.args }),
						...(payload_.severity === undefined ? {} : { severity: payload_.severity }),
						at: Date.now(),
					},
				],
			});
			return;
		}
		if (name === "session.message.delta") {
			const delta = payload as
				| {
						messageId?: string;
						role?: "user" | "assistant";
						kind?: "text" | "reasoning";
						turnId?: string;
						text?: string;
					}
				| undefined;
			if (typeof delta?.messageId !== "string" || typeof delta.text !== "string") return;
			// 思考帧不冒充"正在生成回复":它在想,还没开始写。
			const kind = delta.kind === "reasoning" ? ("reasoning" as const) : ("text" as const);
			this.setState({
				...this.state,
				...(kind === "reasoning" ? {} : { activity: "正在生成回复" }),
				messages: applyStream(this.state.messages, {
					messageId: delta.messageId,
					role: delta.role === "user" ? "user" : "assistant",
					kind,
					...(delta.turnId === undefined ? {} : { turnId: delta.turnId }),
					text: delta.text,
				}),
			});
			return;
		}
		if (name === "session.message") {
			const message = payload as RemoteSessionMessage | undefined;
			if (!message) return;
			// 实时工具行**就在消息的块里**(见 `upsertLiveTool`),所以这里只合并这一条消息:
			// 工具块按 `callId` 覆盖,更早的段原样留着 —— 不需要再"撤掉"任何第二个列表。
			this.setState({ ...this.state, messages: mergeMessage(this.state.messages, message) });
			return;
		}
		if (name === "session.tool") {
			const tool = payload as
				| {
						name?: string;
						callId?: string;
						turnId?: string;
						state?: "running" | "done" | "failed";
						args?: string;
						detail?: string;
						activity?: string;
					}
				| undefined;
			// 工具事件也带着"现在在做什么"(顶部那行据此说话)。
			if (tool?.activity !== undefined) {
				this.setState({ ...this.state, activity: tool.activity.length === 0 ? undefined : tool.activity });
			}
			/**
			 * **写进消息的块里** —— 与桌面端同一个数据模型(见 `upsertLiveTool` 的注释)。
			 *
			 * 认不出是哪一次调用(没有 `callId`)或没有名字的帧不画:摆一行"工具"比不摆更糟。
			 */
			// 有 `callId` 就够:更新/完成帧**不带名字**,但按 callId 一样能认领那一块。
			if (typeof tool?.callId !== "string") return;
			this.setState({
				...this.state,
				messages: upsertLiveTool(this.state.messages, {
					callId: tool.callId,
					...(tool.turnId === undefined ? {} : { turnId: tool.turnId }),
					...(tool.name === undefined ? {} : { name: tool.name }),
					...(tool.state === undefined ? {} : { state: tool.state }),
					...(tool.args === undefined ? {} : { args: tool.args }),
					...(tool.detail === undefined ? {} : { detail: tool.detail }),
				}),
			});
			return;
		}
		if (name === "session.state") {
			// 载荷里可能只有用量、只有运行状态,或者两者都有 —— 各自独立,缺的那个**不动**。
			const state = payload as
				| { running?: boolean; context?: RemoteContextUsage; activity?: string }
				| undefined;
			if (state?.running !== undefined) {
				this.setState({ ...this.state, running: state.running });
			}
			/**
			 * 这一轮结束了:还挂着的提问/审批都**不可能**再等了(它们一定是某一轮里的事)。
			 *
			 * 万一那条 resolved 事件没到(断线、跳号被扣),卡片会永远挂在消息末尾 ——
			 * 用户看到的是"电脑还在等我回答",而它早就答完了。所以这里按"轮次结束"兜一次底。
			 */
			if (state?.running === false) {
				this.setState({ ...this.state, approvals: [], requests: [] });
			}
			if (state?.activity !== undefined) {
				this.setState({ ...this.state, activity: state.activity.length === 0 ? undefined : state.activity });
			}
			if (state?.context !== undefined && sessionId !== undefined) {
				this.setState({
					...this.state,
					sessions: mergeSessionState(this.state.sessions, sessionId, { context: state.context }),
				});
			}
			return;
		}
		if (name === "session.resync") {
			void this.listSessions();
			if (this.state.sessionId) void this.openSession(this.state.sessionId);
			return;
		}
	}

	private async request(
		method: Parameters<RemoteConnection["sendRequest"]>[0],
		options: { readonly sessionId?: string; readonly payload?: unknown } = {},
	) {
		if (!this.connection) return { success: false as const, error: { code: "transport_closed" as const, message: "未连接", retryable: true } };
		return this.connection.sendRequest(method, options);
	}

	private readStored(): StoredPairing | undefined {
		const raw = this.storage?.getItem(STORAGE_KEY);
		if (!raw) return undefined;
		try {
			const parsed = JSON.parse(raw) as Partial<StoredPairing>;
			if (!parsed.pairingId || !parsed.relay || !parsed.secret || !parsed.deviceName) return undefined;
			return { pairingId: parsed.pairingId, relay: parsed.relay, secret: parsed.secret, deviceName: parsed.deviceName };
		} catch {
			return undefined;
		}
	}

	private fail(message: string): void {
		this.setState({ ...this.state, phase: "error", error: message });
	}

	private setState(next: RemoteClientState): void {
		this.state = next;
		for (const listener of this.listeners) listener();
	}
}

/** `wordless://pair?v=2&pairingId=…&relay=…&secret=…` */
export function parsePairingUri(uri: string): Omit<StoredPairing, "deviceName"> | undefined {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return undefined;
	}
	const pairingId = url.searchParams.get("pairingId");
	const relay = url.searchParams.get("relay");
	const secret = url.searchParams.get("secret");
	if (!pairingId || !relay || !secret) return undefined;
	return { pairingId, relay, secret };
}

/** 默认中继:页面自己就是从那里来的 —— 用户不必知道中继地址。 */
export function defaultRelayBaseUrl(): string {
	const origin = globalThis.location?.origin ?? "http://127.0.0.1:8787";
	return origin.replace(/^http/, "ws");
}

export function browserDeviceName(): string {
	const ua = globalThis.navigator?.userAgent ?? "";
	if (/iPhone/i.test(ua)) return "iPhone";
	if (/iPad/i.test(ua)) return "iPad";
	if (/Android/i.test(ua)) return "Android 手机";
	if (/Macintosh/i.test(ua)) return "Mac 浏览器";
	if (/Windows/i.test(ua)) return "Windows 浏览器";
	return "浏览器";
}

/** 供测试用:造一把新的手机身份密钥。 */
export const newPhoneIdentity = generateIdentityKeyPair;

/**
 * 引用 → 消息块(乐观画出来的那条用户消息用)。
 *
 * id 在这里是**这一端自己编的**:本机稍后回来的那条消息有自己的 id,整条消息会被它替换掉,
 * 所以这个 id 只需要在"本机回话之前"这一段里够用。
 */
function referenceBlocks(references: readonly RemoteWorkspaceReference[]): readonly RemoteMessageBlockType[] {
	return references.map((reference, index) => ({
		type: "workspace-reference" as const,
		id: `pending-${index}-${reference.path}`,
		path: reference.path,
		name: reference.name,
		kind: reference.kind,
	}));
}

/** 从消息块里读回引用(重发时用)。 */
function workspaceReferencesOf(blocks: readonly RemoteMessageBlockType[] | undefined): readonly RemoteWorkspaceReference[] {
	return (blocks ?? []).flatMap((block) =>
		block.type === "workspace-reference" ? [{ path: block.path, name: block.name, kind: block.kind }] : [],
	);
}

/** Blob → base64(去掉 data URL 的前缀,本机收的是裸 base64)。 */
function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("读不出这个文件"));
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			const comma = result.indexOf(",");
			resolve(comma === -1 ? result : result.slice(comma + 1));
		};
		reader.readAsDataURL(blob);
	});
}
