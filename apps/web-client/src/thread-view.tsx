import { Button, ProviderIcon } from "@wordless/ui-kit";
import {
	AlertTriangle,
	ArrowDown,
	ArrowLeft,
	Brain,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronLeft,
	CircleAlert,
	ChevronUp,
	CircleDot,
	Paperclip,
	Gauge,
	History,
	LoaderCircle,
	Menu,
	MessageSquare,
	Monitor,
	Moon,
	Plug,
	Plus,
	RefreshCw,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Send,
	Square,
	Sun,
	WifiOff,
	X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageActions, MessageMarkdown } from "./markdown";
import type { PlannedMessage } from "./tool-groups";
import type { RemoteClientState, RemoteSession } from "./remote-client";
import type { RemoteEntryOption } from "@wordless/remote-control";
import { isNearBottom, jumpButtonView, nextUnseenCount, scrollBehaviorForSessionChange } from "./scroll-model";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } from "@wordless/remote-control";
import { clampComposerHeight, draftFor, readDrafts, writeDraft, type DraftMap } from "./composer";
import {
	ACCESS_OPTIONS,
	APPROVAL_OPTIONS,
	MODE_OPTIONS,
	COMPOSER_MORE_ENTRIES,
	composerControls,
	connectorRows,
	type ComposerControl,
	type ComposerControlKind,
} from "./composer-controls";
import deepThinkingIcon from "./icons/common-icons/深度思考.svg";
import wordlessBrandIcon from "./icons/common-icons/wordless-brand.svg";
// 工作类型的图标:与桌面端 `AgentEntryIcon` 同一张表(同一份 common-icons)。
import codeDevelopmentIcon from "./icons/common-icons/代码开发.svg";
import spreadsheetIcon from "./icons/common-icons/电子表格.svg";
import everydayOfficeIcon from "./icons/common-icons/日常办公.svg";
import dataAnalysisIcon from "./icons/common-icons/数据分析.svg";
import websiteIcon from "./icons/common-icons/网站.svg";
import innovationIcon from "./icons/common-icons/innovation.svg";
import presentationIcon from "./icons/common-icons/presentation.svg";
import { connectionStatus } from "./connection-status";
import { THEME_OPTIONS, type ThemePreference } from "./theme";
import {
	assistantFooterVisibility,
	contextBreakdown,
	contextPercent,
	currentModelChoice,
	formatTokens,
	groupSessions,
	modelGroups,
	sessionChips,
	turnUserMessageId,
	type ModelChoiceGroup,
} from "./session-model";
import type { RemoteContextUsage, RemoteSessionSummary } from "@wordless/remote-control";
import type { RemoteApproval, RemoteCompactionBlock, RemoteUsageSummary, RemoteUserRequest } from "./remote-client";
import { toolIcon, toolIconName } from "./tool-icons";
import brandIcon from "./icons/wordless-brand.svg";
import {
	formatDuration,
	groupDurationMs,
	groupSummaryParts,
	isGroupExpanded,
	planMessages,
	type ToolCategory,
	type ToolGroup,
} from "./tool-groups";

/**
 * 会话界面:左边会话列表(按「最近」与「空间」分区),右边对话。
 *
 * 与桌面端对齐的几条:
 * - **一条助手输出 = 一个气泡 + 一个复制按钮**(连续的助手消息在状态层就合并了,见 `mergeMessage`);
 * - **思考与工具执行都渲染出来**:思考默认折叠成一行「深度思考」,工具带状态图标与等宽输出;
 * - **不出现页面级横向滚动**:所有 flex 子项 `min-w-0`,长内容自己滚(代码块、工具输出)。
 *
 * 手机上退化成"列表 ⇄ 对话"两屏,而不是把桌面布局硬压窄。
 */

type Entry =
	| { readonly kind: "message"; readonly at: number; readonly planned: PlannedMessage }

export function ThreadView({
	state,
	onOpenSession,
	onSend,
	onAbort,
	onRefresh,
	onSetModel,
	onLoadEarlier,
	onRetry,
	onDismissError,
	onRetryTurn,
	onSetPermissions,
	onSetConnectors,
	onSetMode,
	onResolveApproval,
	onSetPendingSkills,
	onAnswerRequest,
	onCompact,
	onLoadSessionUsage,
	onUploadAttachment,
	onRemoveAttachment,
	onSelectVersion,
	onSetExpert,
	theme,
	onThemeChange,
	onDisconnect,
	onLoadEntries,
	onCreateSession,
	creating,
	entries: entryOptions,
}: {
	readonly state: RemoteClientState;
	readonly onOpenSession: (sessionId: string) => void;
	readonly onSend: (text: string) => void;
	readonly onAbort: () => void;
	readonly onRefresh: () => void;
	/** 换模型:返回失败原因(界面把它显示在选择器里,而不是飘到对话上)。 */
	readonly onSetModel: (
		connectionId: string,
		modelId: string,
		thinkingLevel?: string,
	) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 往回翻更早的消息。 */
	readonly onLoadEarlier: () => void;
	/** 新建会话页的选项(打开那一页时取一次)。 */
	readonly entries?: readonly RemoteEntryOption[];
	/** 取一次新建会话的选项。 */
	readonly onLoadEntries: () => void;
	/** 新建会话并发出第一条消息(技能与连接器随第一条消息一起发)。 */
	readonly onCreateSession: (
		entryId: string,
		text: string,
		options?: { readonly skillIds?: readonly string[]; readonly connectorIds?: readonly string[] },
	) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 正在新建(按钮禁用,避免连点建出两个会话)。 */
	readonly creating?: boolean;
	/** 重发一条发送失败的消息。 */
	readonly onRetry: (at: number) => void;
	/** 关掉错误提示(用户看过了)。 */
	readonly onDismissError: () => void;
	/** 重做某一轮(只在最新一轮上给按钮)。参数是**这一轮的用户消息 id**。 */
	readonly onRetryTurn: (userMessageId: string) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 改权限(访问权限 / 工具确认)。 */
	readonly onSetPermissions: (patch: {
		readonly accessLevel?: "default" | "full";
		readonly toolApprovalMode?: "manual" | "auto" | "bypass";
	}) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 改这个会话用哪些连接器。 */
	readonly onSetConnectors: (connectorIds: readonly string[]) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 改交互模式(默认 / 计划 / 澄清)。 */
	readonly onSetMode: (mode: "default" | "plan" | "clarify") => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 回答一次工具审批 —— 批准之后电脑才会真的执行。 */
	readonly onResolveApproval: (approvalId: string, approved: boolean) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 选这一轮用哪些技能(发出去之后清空)。 */
	readonly onSetPendingSkills: (skillIds: readonly string[]) => void;
	/** 手动压缩上下文。 */
	readonly onCompact: () => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 读会话总计用量(用量详情里的"会话统计")。 */
	/**
	 * 读会话总计。**可以没有** —— 没有就只显示本轮(与桌面端同一条规则:
	 * 会话总计是懒加载的,拿不到就不摆那一块,而不是摆一个必然失败的入口)。
	 */
	readonly onLoadSessionUsage?: () => Promise<{
		readonly ok: boolean;
		readonly chat?: RemoteUsageSummary;
		readonly unmeasuredCalls?: number;
		readonly message?: string;
	}>;
	/** 传一个附件(分片)。 */
	readonly onUploadAttachment: (file: File) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 撤掉一个还没发出去的附件。 */
	readonly onRemoveAttachment: (uploadId: string) => Promise<void>;
	/** 切换某一轮回复的版本。 */
	readonly onSelectVersion: (messageId: string, version: number) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 换专家 / 专家团(null = 不用)。 */
	readonly onSetExpert: (
		selection: { readonly kind: "expert" | "team"; readonly id: string; readonly version: string } | null,
	) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	/** 回答一次提问(提交答案或取消)。 */
	readonly onAnswerRequest: (
		requestId: string,
		resolution: { readonly status: "submitted" | "cancelled"; readonly answers?: Record<string, unknown> },
	) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly theme: ThemePreference;
	readonly onThemeChange: (next: ThemePreference) => void;
	readonly onDisconnect: () => void;
}) {
	const [drawerOpen, setDrawerOpen] = useState(false);
	/** 用户点了"新建会话":即使已经打开着别的会话,也要进新建页。 */
	const [composing, setComposing] = useState(false);
	/** 新建页里选中的工作类型:底部那个输入框据此决定"发出去是新建还是继续对话"。 */
	const [newEntryId, setNewEntryId] = useState<string | undefined>(undefined);
	/** 新建会话时"要连哪些连接器"(本地待选:还没有会话可写,与第一条消息一起发)。 */
	const [newConnectorIds, setNewConnectorIds] = useState<readonly string[]>([]);
	/**
	 * 会话**变了**就离开新建页(新建成功后客户端会打开那个新会话,这里跟着退出来)。
	 *
	 * 判据是"变了"而不是"有会话":用户可能开着别的会话点"新建",那时 `sessionId` 本来就有值 ——
	 * 按"有会话就退出"会让新建页刚打开就自己关掉。
	 */
	const openedSessionRef = useRef(state.sessionId);
	useEffect(() => {
		if (openedSessionRef.current === state.sessionId) return;
		openedSessionRef.current = state.sessionId;
		setComposing(false);
	}, [state.sessionId]);
	const scrollRef = useRef<HTMLDivElement>(null);
	/** 只有"用户本来就在底部"时新内容才自动滚动 —— 否则读历史会被不停拽回去。 */
	const [nearBottom, setNearBottom] = useState(true);
	/** `nearBottom` 的镜像:滚动观察者的回调里要读**当前**值,而订阅不该跟着它重建。 */
	const nearBottomRef = useRef(true);
	const [unseen, setUnseen] = useState(0);
	/** 模型选择器开着没有;以及里面正在发生什么。 */
	const [pickerOpen, setPickerOpen] = useState(false);
	const [pickerBusy, setPickerBusy] = useState(false);
	const [pickerError, setPickerError] = useState<string | undefined>(undefined);
	const [usageOpen, setUsageOpen] = useState(false);
	/** 输入区那一行控件打开的抽屉。 */
	const [controlOpen, setControlOpen] = useState<ComposerControlKind | undefined>(undefined);
	/**
	 * 草稿按会话存(不是"一个全局输入框")。
	 *
	 * 手机上切出去再回来、断线重连、甚至页面被系统回收,打的字都该还在 ——
	 * 所以它落在 `localStorage` 里,而且换会话时**换的是草稿**。
	 */
	const [drafts, setDrafts] = useState<DraftMap>(() =>
		readDrafts(typeof localStorage === "undefined" ? undefined : localStorage),
	);
	const composerRef = useRef<HTMLTextAreaElement>(null);
	const lastEntryCount = useRef(0);

	const activeSession = state.sessions.find((session) => session.id === state.sessionId);
	const draft = draftFor(drafts, state.sessionId);
	const setDraft = useCallback(
		(value: string) => {
			setDrafts((current) =>
				writeDraft(typeof localStorage === "undefined" ? undefined : localStorage, current, state.sessionId, value),
			);
		},
		[state.sessionId],
	);

	/**
	 * **正在新建会话**(还没打开任何会话,或用户主动点了"新建")。
	 *
	 * 提前算出来是因为它决定好几件事:底部输入框发出去是"新建"还是"继续对话"、
	 * 顶部那行说的是哪个会话、以及**别的会话在跑不该影响这一页**。
	 */
	const creatingSession = state.sessionId === undefined || composing;
	/**
	 * **正在打开某个会话**(切换有延迟:要过中继 + 本机读历史)。
	 *
	 * 这时候这一页还没有内容可显示 —— 上一个会话的消息已经被清掉了(留着会变成
	 * "标题是新的、内容是旧的",用户读不出是"还没到"还是"就是这个内容")。
	 */
	const opening = state.opening === true && !creatingSession;
	/**
	 * **这一页的**会话在跑吗。
	 *
	 * 直接看 `state.running` 是错的:那是"当前打开的那个会话"的运行状态 ——
	 * 在新建页上它是**别的会话**的,于是桌面端一有流式输出,新建页的发送键就变成停止键(真实抱怨)。
	 */
	const sessionRunning = creatingSession || opening ? false : state.running;
	const jump = jumpButtonView({ nearBottom, running: sessionRunning, unseen });

	// 输入框长到内容那么高,但不超过上限(超过就内部滚动,不让它吃掉整个屏幕)。
	useLayoutEffect(() => {
		const node = composerRef.current;
		if (!node) return;
		node.style.height = "auto";
		const height = clampComposerHeight(node.scrollHeight);
		node.style.height = height === 0 ? "" : `${height}px`;
	}, [draft, state.sessionId]);
	// 顶部那行状态:重连了几次、是不是该让用户去查点什么,都由它决定。
	const status = connectionStatus(state);
	/**
	 * 实时状态(「正在执行命令」「正在分析工具结果」……,与桌面端同一套措辞)。
	 *
	 * 它**挂在消息底部**(与桌面端同一个位置:那条会"呼吸"的 12px 小字),
	 * 不占顶部那行 —— 顶部说的是连接,这里说的是进度。
	 */
	const runStatus = sessionRunning ? (state.activity ?? "思考中") : undefined;
	// 输入区上方的只读信息:让手机上"看得见自己正在用什么"。
	const chips = sessionChips(activeSession);
	// 能换模型的两个前提:本机给了清单,而且此刻不在回复中(运行时会拒绝,界面先如实关掉)。
	const canPickModel = state.models !== undefined && state.models.length > 0 && !sessionRunning;
	const modelGroups_ = modelGroups(state.models, {
		connectionId: activeSession?.modelConnectionId,
		modelId: activeSession?.modelId,
	});
	/** 现在用的是哪个模型(清单里那一条):模型按钮上显示的就是它的图标。 */
	const currentModel = currentModelChoice(modelGroups_);
	/** 模型:图标按钮(不显示名字 —— 名字太长,手机上会把这一行撑满)。 */
	/** 发送键的配色:与桌面端逐字一致(默认红 / 计划橙 / 澄清蓝)。 */
	const sendButtonTone =
		activeSession?.interactionMode === "plan"
			? "bg-[#d97a2b] hover:bg-[#c76a1f] dark:bg-[#d97a2b] dark:hover:bg-[#e08a40]"
			: activeSession?.interactionMode === "clarify"
				? "bg-[#2f7bd0] hover:bg-[#276bb8] dark:bg-[#2f7bd0] dark:hover:bg-[#3d89dd]"
				: "bg-[#d8443c] hover:bg-[#c23934] dark:bg-[#e0524a] dark:hover:bg-[#ea6258]";
	const modelControl: ComposerControl = {
		kind: "model",
		label: "模型",
		...(activeSession?.modelName === undefined ? {} : { value: activeSession.modelName }),
		editable: canPickModel,
		// 图标与桌面端**同一份**(`ProviderIcon`):手机上和电脑上认出的是同一个标志。
		...(currentModel?.avatarId === undefined ? {} : { avatarId: currentModel.avatarId }),
		...(currentModel?.providerId === undefined ? {} : { providerId: currentModel.providerId }),
	};
	/** 点控件:模型那一个走换模型的抽屉,其余走"只能看"的抽屉。 */
	const openControl = (kind: ComposerControlKind) => {
		if (kind === "model") {
			if (!canPickModel) return;
			setPickerError(undefined);
			setPickerOpen(true);
			return;
		}
		setControlOpen(kind);
	};

	/**
	 * 换模型 / 改思考等级。
	 *
	 * `thinkingLevel` 只带**该模型支持的**档位(界面只列那些):运行时收到不支持的档位会直接抛,
	 * 而那会变成一句用户看不懂的失败。不传 = 让运行时按新模型夹一次(与桌面端同一条规则)。
	 */
	const pickModel = async (connectionId: string, modelId: string, thinkingLevel?: string) => {
		setPickerBusy(true);
		setPickerError(undefined);
		const result = await onSetModel(connectionId, modelId, thinkingLevel);
		setPickerBusy(false);
		if (result.ok) {
			// 改等级**不关抽屉**:用户往往要连着试两档,关掉再打开是白折腾。
			if (thinkingLevel === undefined) setPickerOpen(false);
			return;
		}
		setPickerError(result.message ?? "换模型失败");
	};
	const groups = useMemo(() => groupSessions(state.sessions), [state.sessions]);
	/**
	 * 底部操作行(复制 / 用量 / 重做)的可见性 —— 与桌面端同一套规则。
	 * 正在生成的那一轮不摆操作行:摆着"复制"和用量,用户会以为它已经答完了。
	 */
	const lastAssistantAt = useMemo(() => {
		for (let index = state.messages.length - 1; index >= 0; index -= 1) {
			const candidate = state.messages[index];
			if (candidate?.role === "assistant") return candidate.at;
		}
		return undefined;
	}, [state.messages]);
	const showFooter = assistantFooterVisibility({
		hasPendingInteraction: state.waitingForApproval,
		isStreaming: state.messages.some((message) => message.streaming === true),
		isTurnRunning: sessionRunning && lastAssistantAt !== undefined && lastAssistantAt === state.messages.at(-1)?.at,
		messageCount: state.messages.length,
	});

	// 工具分组只画一次、画在它第一次出现的位置(见 `planMessages`)。
	// **实时工具已经在消息的块里**(客户端把它们写进这一轮的助手消息),所以这里没有第二份数据:
	// 它属于哪一组、折叠没有、什么状态,全部由同一份块算出来。
	const plan = useMemo(() => planMessages(state.messages), [state.messages]);
	/**
	 * 每条助手消息属于哪一轮的用户消息 id —— 重做与版本切换都以它为准。
	 *
	 * 按消息**身份**算(而不是渲染时的位置):渲染计划里的顺序与 `state.messages` 一致,
	 * 但这里显式按对象找,免得将来某次合并把两者弄错位。
	 */
	const turnIds = useMemo(() => {
		const map = new Map<number, string | undefined>();
		state.messages.forEach((message, index) => {
			if (message.role === "assistant") map.set(message.at, turnUserMessageId(state.messages, index));
		});
		return map;
	}, [state.messages]);
	const entries = useMemo<readonly Entry[]>(
		() => plan.map((entry) => ({ kind: "message" as const, at: entry.message.at, planned: entry })),
		[plan]);

	/**
	 * 状态挂在**消息底部**(与桌面端同一个位置),还是落到列表末尾?
	 *
	 * 只有"最后一条就是助手消息"的时候才挂进去 —— 挂在消息底部,它才跟着这条消息走;
	 * 还有实时工具行排在后面时,就落在整段的末尾(与桌面端"工具块在消息里、状态在消息后"同一个顺序)。
	 * 刚发出去、助手还没出声的时候没有消息可挂,也只能落在末尾。
	 */
	const lastEntry = entries.at(-1);
	/** 状态该挂到哪条消息上(undefined = 没有可挂的,落到列表末尾)。 */
	const statusMessageAt =
		runStatus !== undefined && lastEntry?.kind === "message" && lastEntry.planned.message.role === "assistant"
			? lastEntry.planned.message.at
			: undefined;

	const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
		const node = scrollRef.current;
		if (!node) return;
		node.scrollTo({ top: node.scrollHeight, behavior });
		nearBottomRef.current = true;
		setNearBottom(true);
		setUnseen(0);
	}, []);

	const handleScroll = useCallback(() => {
		const node = scrollRef.current;
		if (!node) return;
		const near = isNearBottom({
			scrollTop: node.scrollTop,
			scrollHeight: node.scrollHeight,
			clientHeight: node.clientHeight,
		});
		nearBottomRef.current = near;
		setNearBottom(near);
		if (near) setUnseen(0);
	}, []);

	// 规则一与二:贴底才跟随,离开底部就计数。
	useEffect(() => {
		const appended = entries.length - lastEntryCount.current;
		lastEntryCount.current = entries.length;
		if (appended <= 0) return;
		if (nearBottom) scrollToBottom("smooth");
		else setUnseen((current) => nextUnseenCount(current, { appended, nearBottom }));
	}, [entries.length, nearBottom, scrollToBottom]);

	/**
	 * 规则四:**容器自己变矮也要跟住**。
	 *
	 * 输入区一变高,消息区就变矮 —— 而浏览器不会自己把滚动位置重新贴到底:
	 * 容器矮了 22px,最后一条消息就凭空离底 22px,看起来像"间距被调大了"(实际是输入框长高了两三行)。
	 * 手机键盘弹出是同一个道理。
	 *
	 * 只在**本来就贴着底**的时候重新贴住:用户正在往上翻历史时,不许把他拽回去(与规则一同一条纪律)。
	 * 立刻贴,不平滑 —— 这是布局变了,不是"往下走一点"。
	 */
	useEffect(() => {
		const node = scrollRef.current;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			if (!nearBottomRef.current) return;
			node.scrollTop = node.scrollHeight;
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	// 规则三:换会话立刻到底(不平滑 —— 那是"换了个地方",不是"往下走一点")。
	useEffect(() => {
		scrollToBottom(scrollBehaviorForSessionChange());
	}, [state.sessionId, scrollToBottom]);

	/** 新建页里可用的工作类型(选中项由它决定;没有可选项时下面那个框也不该让人打字)。 */
	const selectedEntry = (entryOptions ?? []).filter((entry) => entry.available).find((entry) => entry.id === newEntryId)
		?? (entryOptions ?? []).find((entry) => entry.available);
	const canCompose = creatingSession
		? selectedEntry !== undefined
		: // 打开中不给发:这一页的会话设置(技能 / 连接器 / 模型)还是**上一个会话**的,发出去会用错那一份。
			state.sessionId !== undefined && !opening;

	const send = () => {
		// **流式输出时不许发送**:那一轮还没答完,发出去只会插到它中间(桌面端也是这个规矩)。
		// 这时候发送键是"停止",不是"发送"。
		if (state.sending || sessionRunning) return;
		const text = draft.trim();
		if (text.length === 0) return;
		if (creatingSession) {
			// 新建页:**同一个输入框**,发出去就是"建会话 + 第一句话"(与桌面端 WelcomeView 同一条路)。
			if (selectedEntry === undefined) return;
			setDraft("");
			void onCreateSession(selectedEntry.id, text, {
				skillIds: state.pendingSkillIds,
				connectorIds: newConnectorIds,
			});
			return;
		}
		onSend(text);
		setDraft("");
		// 自己刚发了消息:无论刚才翻到哪儿,都回到最新。
		scrollToBottom("smooth");
	};

	return (
		// overflow-x-hidden:`pre` 与长单词都不许把整个页面顶出横向滚动条。
		// `pt-[env(safe-area-inset-top)]`:viewport-fit=cover 之后页面会伸到刘海下面,顶部要自己让开。
		<div className="flex h-dvh overflow-x-hidden bg-background pt-[env(safe-area-inset-top)]">
			<aside
				className={`${
					drawerOpen ? "flex" : "hidden"
				} absolute inset-0 z-20 w-full flex-col border-border bg-card md:static md:z-auto md:flex md:w-[300px] md:shrink-0 md:border-r`}
			>
				<header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
					<img src={brandIcon} alt="" aria-hidden className="h-6 w-6 shrink-0 rounded-[6px]" />
					<div className="min-w-0 flex-1">
						<p className="truncate text-[13px] font-semibold text-card-foreground">Wordless 远程</p>
						<p className="truncate text-[11px] text-muted-foreground">
							{state.deviceName ?? "浏览器"} · {phaseLabel(state.phase)}
						</p>
					</div>
					<Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawerOpen(false)}>
						<ArrowLeft className="h-4 w-4" />
					</Button>
				</header>

				<div className="flex items-center justify-between gap-2 px-4 py-2.5">
					<span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">会话</span>
					<div className="flex items-center gap-1">
						{/* 新建会话的入口就在列表上:手机上"先找到某个会话再想办法新建"是反直觉的。 */}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setComposing(true);
								setDrawerOpen(false);
							}}
						>
							<Plus className="h-3.5 w-3.5" />
							新建
						</Button>
						<Button variant="ghost" size="sm" onClick={onRefresh}>
							刷新
						</Button>
					</div>
				</div>

				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 pb-2">
					{state.sessions.length === 0 ? (
						<div className="px-3 py-8 text-center">
							<p className="text-[12px] text-muted-foreground">这台电脑上还没有会话。</p>
							<Button
								variant="outline"
								size="sm"
								className="mt-3"
								onClick={() => {
									setComposing(true);
									setDrawerOpen(false);
								}}
							>
								<Plus className="h-3.5 w-3.5" />
								新建一个
							</Button>
						</div>
					) : (
						groups.map((group) => (
							<section className="mb-3" key={group.key}>
								{/* 吸顶:列表长了以后,滚到中间也知道自己在哪一组。 */}
								<p className="sticky top-0 z-10 flex items-center gap-1.5 bg-card px-3 py-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
									<span className="truncate">{group.label}</span>
									<span className="shrink-0 font-mono text-[9px] opacity-70">{group.sessions.length}</span>
								</p>
								{group.sessions.map((session) => (
									<SessionRow
										key={session.id}
										session={session}
										active={session.id === state.sessionId}
										opening={session.id === state.openingSessionId}
										onOpen={() => {
											/**
											 * **点会话就离开新建页** —— 无条件,不看 id 变没变。
											 *
											 * 以前只靠"会话变了就退出新建页"那一条:用户在会话 A 里点"新建",
											 * 再点回 A 时 `sessionId` 根本没变,于是新建页关不掉(真实抱怨)。
											 */
											setComposing(false);
											onOpenSession(session.id);
											setDrawerOpen(false);
										}}
									/>
								))}
							</section>
						))
					)}
				</div>

				<footer className="border-t border-border px-4 py-3">
					{/*
						外观三档平铺,不做"点一下循环":循环是隐藏状态,用户得试两下才知道自己在哪一档。
						每一档都有文字标签 —— 只给图标的话,"跟随系统"这个档位根本看不出来。
					*/}
					<div className="mb-2 flex items-center gap-1" role="group" aria-label="外观">
						{THEME_OPTIONS.map((option) => {
							const active = theme === option.value;
							return (
								<button
									key={option.value}
									type="button"
									aria-pressed={active}
									title={option.label}
									onClick={() => onThemeChange(option.value)}
									className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] border text-[11px] transition-colors ${
										active
											? "border-border bg-muted text-foreground"
											: "border-transparent text-muted-foreground hover:bg-muted/60"
									}`}
								>
									{(() => {
										const Icon = THEME_ICONS[option.value];
										return <Icon className="h-3.5 w-3.5 shrink-0" />;
									})()}
									<span className="truncate">{option.label}</span>
								</button>
							);
						})}
					</div>
					<button
						type="button"
						onClick={onDisconnect}
						className="text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground"
					>
						断开并清除本机配对
					</button>
				</footer>
			</aside>

			<main className="flex min-w-0 flex-1 flex-col">
				<header
					data-thread-header
					className="flex min-w-0 items-center gap-2 border-b border-border bg-card/60 px-3 py-2.5 backdrop-blur md:px-5"
				>
					<Button variant="ghost" size="icon" className="md:hidden" onClick={() => setDrawerOpen(true)}>
						<Menu className="h-4 w-4" />
					</Button>
					<div className="min-w-0 flex-1">
						<p className="truncate text-[13px] font-medium text-foreground">
							{creatingSession ? "新建会话" : activeSession?.title || "选择一个会话"}
						</p>
						<p
							className={`flex items-center gap-1.5 truncate text-[11px] ${
								status.tone === "attention" ? "text-[#ad7956] dark:text-[#d6a16d]" : "text-muted-foreground"
							}`}
						>
							{status.tone === "attention" ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
							{state.phase === "offline" || state.phase === "error" ? (
								<WifiOff className="h-3 w-3 shrink-0" />
							) : null}
							<span className="truncate">{status.text}</span>
						</p>
					</div>
					{creatingSession || activeSession?.context === undefined ? null : (
						<button
							type="button"
							aria-label="上下文用量"
							title="上下文用量"
							onClick={() => setUsageOpen(true)}
							className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted"
						>
							{/* 环的几何与颜色**照抄桌面端**(conic-gradient + 2px 内边距),两端看到的是同一枚环。 */}
							<span
								aria-hidden
								className="grid h-5 w-5 place-items-center rounded-full p-[2px]"
								style={{ background: `conic-gradient(#7d94b2 ${contextPercent(activeSession.context) * 3.6}deg, #e5e6e2 0deg)` }}
							>
								<span className="h-full w-full rounded-full bg-card" />
							</span>
						</button>
					)}
					{/* 中断在**发送键**上(运行中它变成停止键)—— 与桌面端同一个位置,这里不再重复摆一个。 */}
				</header>

				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				<div
					ref={scrollRef}
					onScroll={handleScroll}
					data-thread-scroll
					className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
				>
					{/*
						错误要**能接着往下走**:光说"出错了"等于把用户留在原地。
						所以给两个出口 —— 重开这个会话(最常见的原因是它没打开成功),以及关掉它。
					*/}
					{state.error ? (
						<div className="mx-auto mb-4 flex max-w-[720px] flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[7px] border border-destructive/25 bg-destructive/5 px-3 py-2">
							<p className="min-w-0 flex-1 text-[11px] break-words text-destructive">{state.error}</p>
							{state.sessionId === undefined ? null : (
								<button
									type="button"
									className="shrink-0 text-[11px] text-destructive underline decoration-dotted"
									onClick={() => onOpenSession(state.sessionId as string)}
								>
									重新打开会话
								</button>
							)}
							<button
								type="button"
								className="shrink-0 text-[11px] text-destructive underline decoration-dotted"
								onClick={onDismissError}
							>
								关闭
							</button>
						</div>
					) : null}
					{state.sessionId === undefined || composing ? (
						<WelcomeView
							creating={creating === true}
							entries={entryOptions}
							entryId={newEntryId}
							onLoad={onLoadEntries}
							onSelect={setNewEntryId}
						/>
					) : opening ? (
						// 加载态要**看得见**:手机上一个会话要读一会儿历史,没提示就只能猜点没点上。
						<div className="mx-auto flex max-w-[720px] flex-col items-center gap-2 py-16">
							<LoaderCircle
								aria-label="正在打开会话"
								role="img"
								className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none"
							/>
							<p className="text-[12px] text-muted-foreground">正在打开会话…</p>
						</div>
					) : entries.length === 0 && state.earlierCursor === undefined ? (
						<p className="mx-auto max-w-[720px] py-16 text-center text-[12px] text-muted-foreground">
							这个会话还没有消息。
						</p>
					) : entries.length === 0 ? (
						// 这一页是空的,但本机说还有更早的 —— 那就把"往回翻"的入口给出来,别只显示"没有消息"。
						<div className="mx-auto flex max-w-[720px] flex-col items-center gap-1.5 py-16">
							<Button variant="outline" size="sm" onClick={onLoadEarlier}>
								<History className="h-3.5 w-3.5" />
								加载更早的消息
							</Button>
							<p className="text-[11px] text-muted-foreground">这一页没有内容,更早的还在电脑上。</p>
						</div>
					) : (
						<div className="mx-auto flex min-w-0 max-w-[720px] flex-col gap-4">
							{/* 更早的消息在电脑上:需要时才往回取,不一次全发过来(大会话会撑爆一帧)。 */}
							{state.earlierCursor === undefined && !state.truncated ? null : (
								<div className="flex flex-col items-center gap-1.5">
									{state.earlierCursor === undefined ? null : (
										<Button variant="outline" size="sm" onClick={onLoadEarlier}>
											<History className="h-3.5 w-3.5" />
											加载更早的消息
										</Button>
									)}
									{state.truncated ? (
										<p className="text-[11px] text-muted-foreground">
											这个会话很长,这里只显示了最近的一部分;更早的内容在电脑上。
										</p>
									) : null}
								</div>
							)}
							{entries.map((entry) => (
								<MessageRow
									key={`m-${entry.planned.message.at}-${entry.planned.message.role}`}
									planned={entry.planned}
									onRetry={onRetry}
									showFooter={showFooter}
									runStatus={entry.planned.message.at === statusMessageAt ? runStatus : undefined}
									isLatestTurn={
										entry.planned.message.at === lastAssistantAt && entry.planned.message.role === "assistant"
									}
									turnUserMessageId={turnIds.get(entry.planned.message.at)}
									identityName={activeSession?.expertName}
									onRetryTurn={onRetryTurn}
									onSelectVersion={onSelectVersion}
									onLoadSessionUsage={onLoadSessionUsage}
								/>
							))}
							{/* 没有消息可挂的时候(刚发出去、助手还没出声),状态才落到这里。
							    文字是**正在做什么**,不是笼统的"电脑正在执行"。 */}
							{runStatus !== undefined && statusMessageAt === undefined ? (
								<RunStatusLine text={runStatus} />
							) : null}
						</div>
					)}
				</div>
				{jump.visible ? (
					<div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
						<button
							type="button"
							onClick={() => scrollToBottom("smooth")}
							aria-label={jump.unseen > 0 ? `跳到最新(${jump.unseen} 条新内容)` : "跳到最新"}
							className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full border border-[#deded8] bg-white text-[#4d4d48] shadow-[0_4px_12px_rgba(0,0,0,0.10)] hover:bg-[#f5f5f2] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
						>
							{jump.showProgress ? (
								<span aria-hidden className="flex h-4 items-center justify-center gap-[2px]">
									{[0, 1, 2].map((index) => (
										<span
											key={index}
											className="h-[3px] w-[3px] animate-pulse rounded-full bg-current motion-reduce:animate-none"
											style={{ animationDelay: `${index * 150}ms` }}
										/>
									))}
								</span>
							) : (
								<ArrowDown className="h-4 w-4" />
							)}
						</button>
						{jump.unseen > 0 ? (
							<span className="pointer-events-none absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-semibold text-accent-foreground">
								{jump.unseen > 99 ? "99+" : jump.unseen}
							</span>
						) : null}
					</div>
				) : null}
				</div>

				<div className="border-t border-border bg-card/60 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:px-6">
					{state.requests.map((request) => (
						<ClarificationCard key={request.requestId} request={request} onAnswer={onAnswerRequest} />
					))}
					{state.approvals.map((approval) => (
						<ApprovalCard
							key={approval.approvalId}
							approval={approval}
							onResolve={onResolveApproval}
						/>
					))}
					{/* 这里原来还有一句"电脑正在执行,发送会插话" —— 顶部已经在说同一件事,删掉。 */}
					{/*
						一张卡片里装着输入与所有控件 —— 与桌面端同一个结构。
						桌面端那行是「+ / 权限 / 连接器 / 模型 / 发送」;手机放不下文字标签,
						所以改成**图标按钮 + 抽屉**,信息量一样,只是换了个摆法。
					*/}
					<div className="mx-auto max-w-[720px] rounded-[12px] border border-border bg-card">
					<div className="flex min-w-0 items-end gap-2 px-2 pt-1.5 pb-2">
						{state.attachments.length === 0 ? null : (
							<div className="flex min-w-0 flex-wrap gap-1.5 border-b border-border px-2 py-1.5">
								{state.attachments.map((attachment) => (
									<span
										key={attachment.uploadId}
										className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-[6px] border border-border bg-muted/50 px-2 text-[11px]"
									>
										<Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
										<span className="min-w-0 max-w-[160px] truncate">{attachment.name}</span>
										{attachment.progress < 1 ? (
											<span className="shrink-0 font-mono text-[10px] text-muted-foreground">
												{Math.round(attachment.progress * 100)}%
											</span>
										) : null}
										<button
											type="button"
											aria-label={`移除 ${attachment.name}`}
											onClick={() => void onRemoveAttachment(attachment.uploadId)}
											className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
										>
											<X className="h-3 w-3" />
										</button>
									</span>
								))}
							</div>
						)}
						<textarea
							ref={composerRef}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
									event.preventDefault();
									send();
								}
							}}
							rows={1}
							placeholder={
								opening
									? "正在打开会话…"
									: creatingSession
										? selectedEntry === undefined
											? "先在上面选一个工作类型"
											: "写下第一句话就开始(Enter 发送)"
										: "说点什么…(Enter 发送,Shift+Enter 换行)"
							}
							disabled={!canCompose}
							// 至少两三行的高度:手机上一行太憋屈,而这一段文字常常不止一行。
							className="max-h-40 min-h-[68px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60"
						/>
					</div>
					{/*
						底行只有三样:模型(图标)、更多(+)、发送(圆形)。
						权限、连接器、模式、技能全在「+」里 —— 手机上每多一个常驻按钮,输入区就挤一分。
					*/}
					{/* 与文字区之间**不画分割线**:同一张卡片里的两部分,淡开就够了。 */}
					<div className="flex min-w-0 items-center gap-1 px-1.5 pt-0.5 pb-1">
						<button
							type="button"
							aria-label="更多"
							title="更多"
							onClick={() => openControl("more")}
							className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
						>
							<Plus className="h-4 w-4" />
						</button>
						<ComposerControlButton control={modelControl} onOpen={() => openControl("model")} />
						<span className="min-w-0 flex-1" />
						{/*
							发送键**按模式配色**,运行中变成停止键 —— 与桌面端逐字一致:
							默认红、计划橙、澄清蓝;停止键保持同一颜色(它按的是同一个东西,只是换了个动作)。
						*/}
						<button
							type="button"
							aria-label={sessionRunning ? "停止" : state.sending ? "发送中" : creatingSession ? "新建并发送" : "发送"}
							title={sessionRunning ? "停止" : "发送"}
							onClick={() => (sessionRunning ? onAbort() : send())}
							disabled={
								sessionRunning ? false : !canCompose || draft.trim().length === 0 || state.sending || creating === true
							}
							className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition-colors disabled:bg-[#b5b5b1] ${sendButtonTone}`}
						>
							{sessionRunning ? (
								<Square className="h-3.5 w-3.5 fill-current" />
							) : state.sending ? (
								<LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" />
							) : (
								<Send className="h-4 w-4" />
							)}
						</button>
					</div>
					</div>
				</div>
			</main>
			{controlOpen === undefined ? null : (
				<ComposerControlSheet
					kind={controlOpen}
					session={activeSession}
					running={sessionRunning}
					pendingSkillIds={state.pendingSkillIds}
					availableSkills={state.skills ?? []}
					availableExperts={state.experts ?? []}
					attachmentCount={state.attachments.length}
					availableConnectors={state.availableConnectors ?? []}
					onUploadAttachment={onUploadAttachment}
					onRemoveAttachment={onRemoveAttachment}
					onSetExpert={onSetExpert}
					onCompact={onCompact}
					onSetMode={onSetMode}
					onSetPendingSkills={onSetPendingSkills}
					creatingSession={creatingSession}
					onSetPermissions={onSetPermissions}
					onSetConnectors={async (ids) => {
						// 新建状态下**不写本机**(还没有会话):存成"这一轮要连的",与第一条消息一起发。
						if (creatingSession) {
							setNewConnectorIds(ids);
							return { ok: true };
						}
						return onSetConnectors(ids);
					}}
					onClose={() => setControlOpen(undefined)}
				/>
			)}
			{usageOpen && activeSession?.context !== undefined ? (
				<ContextUsageSheet usage={activeSession.context} onClose={() => setUsageOpen(false)} />
			) : null}
			{pickerOpen ? (
				<ModelPickerSheet
					groups={modelGroups_}
					busy={pickerBusy}
					error={pickerError}
					onPick={(connectionId, modelId, thinkingLevel) => void pickModel(connectionId, modelId, thinkingLevel)}
					onClose={() => setPickerOpen(false)}
				/>
			) : null}
		</div>
	);
}

/**
 * 换模型的选择器(手机上的底部抽屉)。
 *
 * 三条克制:
 * - **只列本机给的清单**:清单是本机按"已启用 + 与这个会话兼容 + 供应商可用"算出来的,
 *   所以这里不会出现"选了必然失败"的选项;
 * - **当前那个不可再点**(而不是点了再报"已经是它了");
 * - **失败的话就地说**,不飘到对话上方去 —— 用户正在看这个抽屉,答案就该在这儿。
 */
function ModelPickerSheet({
	groups,
	busy,
	error,
	onPick,
	onClose,
}: {
	readonly groups: readonly ModelChoiceGroup[];
	readonly busy: boolean;
	readonly error?: string;
	readonly onPick: (connectionId: string, modelId: string, thinkingLevel?: string) => void;
	readonly onClose: () => void;
}) {
	/** 现在用的是哪个模型 —— 思考档位跟着它走(与桌面端"模型与等级放一起"同一个道理)。 */
	const current = currentModelChoice(groups);
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
			role="presentation"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-label="换模型"
				className="max-h-[80vh] w-full max-w-[560px] min-w-0 overflow-hidden rounded-t-[14px] border border-border bg-card p-4 md:rounded-[14px]"
				onClick={(event) => event.stopPropagation()}
			>
				<p className="text-[13px] font-semibold text-card-foreground">换模型</p>
				<p className="mt-1 text-[11px] text-muted-foreground">改的是这台电脑上的这个会话;正在回复时不能换。</p>
				{error === undefined ? null : (
					<p className="mt-3 rounded-[8px] bg-[#f7e8e1] px-3 py-2 text-[11px] text-[#8a4b2a] dark:bg-[#3a2a22] dark:text-[#e0b394]">
						{error}
					</p>
				)}
				{current?.thinking.length === 0 ? null : (
					<div className="mt-3">
						<p className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">思考等级</p>
						<div className="flex flex-wrap gap-1.5">
							{current?.thinking.map((choice) => (
								<button
									key={choice.level}
									type="button"
									disabled={busy || choice.current}
									onClick={() =>
										onPick(current.connectionId, current.modelId, choice.level)
									}
									className={`h-7 rounded-[7px] border px-2.5 text-[12px] transition-colors ${
										choice.current
											? "border-[#afcb54] bg-[#f2f7e4] text-[#4c5c2a] dark:border-[#4d5a2a] dark:bg-[#26301a] dark:text-[#cbe27f]"
											: "border-border text-foreground enabled:hover:bg-muted"
									} disabled:opacity-100`}
								>
									{choice.label}
								</button>
							))}
						</div>
						<p className="mt-1 text-[10px] text-muted-foreground">
							只列这个模型支持的档位;换模型时会自动夹到新模型支持的档。
						</p>
					</div>
				)}
				<div className="message-code-scroll mt-3 max-h-[55vh] space-y-3 overflow-y-auto">
					{groups.map((group) => (
						<div key={group.key} className="min-w-0">
							<p className="mb-1 flex items-center gap-1.5 text-[10px] tracking-wide text-muted-foreground uppercase">
								{/* 分组的图标与桌面端的模型选择器一致:一眼看出这一组是哪家。 */}
								<ProviderIcon
									avatarId={group.avatarId}
									className="h-3.5 w-3.5 shrink-0 object-contain"
									providerId={group.providerId}
								/>
								<span className="min-w-0 truncate">{group.label}</span>
							</p>
							<div className="space-y-1">
								{group.choices.map((choice) => (
									<button
										key={`${choice.connectionId}/${choice.modelId}`}
										type="button"
										disabled={busy || choice.current}
										onClick={() => onPick(choice.connectionId, choice.modelId)}
										className="flex w-full min-w-0 items-center gap-2 rounded-[8px] border border-border px-3 py-2 text-left text-[12px] text-foreground enabled:hover:bg-muted disabled:opacity-70"
									>
										<span className="min-w-0 flex-1 truncate">{choice.displayName}</span>
										{choice.current ? <span className="shrink-0 text-[10px] text-muted-foreground">当前</span> : null}
									</button>
								))}
							</div>
						</div>
					))}
				</div>
				<Button variant="outline" size="sm" className="mt-3 w-full" disabled={busy} onClick={onClose}>
					关闭
				</Button>
			</div>
		</div>
	);
}

/**
 * 等用户回答的提问卡片。
 *
 * 与审批不同:它是**一份表单**(单选 / 多选 / 文本 / 确认四种字段),所以不能只给两个按钮。
 * 四种字段**一个不少**地渲染 —— 题目是模型按需要出的,少一种就等于把某些问题变成没法回答。
 */
function ClarificationCard({
	request,
	onAnswer,
}: {
	readonly request: RemoteUserRequest;
	readonly onAnswer: (
		requestId: string,
		resolution: { readonly status: "submitted" | "cancelled"; readonly answers?: Record<string, unknown> },
	) => Promise<{ readonly ok: boolean; readonly message?: string }>;
}) {
	/** 草稿答案:按字段 id 记。初值取字段的 `defaultValue`。 */
	const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
		const initial: Record<string, unknown> = {};
		for (const field of request.fields) {
			if (field.type === "text" && field.defaultValue !== undefined) initial[field.id] = field.defaultValue;
			if (field.type === "confirm" && field.defaultValue !== undefined) initial[field.id] = field.defaultValue;
			if (field.type === "select" && field.defaultValue !== undefined) initial[field.id] = field.defaultValue;
			if (field.type === "multi-select" && field.defaultValue !== undefined) initial[field.id] = [...field.defaultValue];
		}
		return initial;
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const missing = request.fields.filter((field) => field.required === true && !hasAnswer(answers[field.id]));
	const submit = async (status: "submitted" | "cancelled") => {
		setBusy(true);
		setError(undefined);
		const result = await onAnswer(request.requestId, {
			status,
			...(status === "submitted" ? { answers } : {}),
		});
		setBusy(false);
		if (!result.ok) setError(result.message ?? "这个提问已经不在了");
	};
	return (
		<div className="mx-auto mb-2 max-w-[720px] rounded-[10px] border border-[#c9d4b4] bg-[#f6f8ef] p-3 dark:border-[#414a35] dark:bg-[#24281d]">
			<p className="text-[12px] font-semibold text-[#4e6238] dark:text-[#c3df8a]">{request.title}</p>
			{request.description === undefined ? null : (
				<p className="mt-1 text-[11px] leading-4 text-muted-foreground">{request.description}</p>
			)}
			<div className="mt-2.5 space-y-3">
				{request.fields.map((field) => (
					<div key={field.id} className="min-w-0">
						<p className="text-[12px] text-foreground/90">
							{field.label}
							{field.required === true ? <span className="text-[#ad7956] dark:text-[#d6a16d]"> *</span> : null}
						</p>
						{field.description === undefined ? null : (
							<p className="text-[11px] leading-4 text-muted-foreground">{field.description}</p>
						)}
						<div className="mt-1.5">
							{field.type === "select" ? (
								// **整行占满宽度**(以前是一排小方块:选项一长就折行,看着像标签墙)。
								<div className="space-y-1.5">
									{field.options.map((option) => {
										const active = answers[field.id] === option.value;
										return (
											<button
												key={option.value}
												type="button"
												aria-pressed={active}
												title={option.description}
												onClick={() => setAnswers((current) => ({ ...current, [field.id]: option.value }))}
												className={`flex w-full min-w-0 items-center gap-2 rounded-[7px] border px-2.5 py-2 text-left text-[12px] ${
													active
														? "border-[#a8bd69] bg-[#f3f6e8] text-foreground dark:border-[#9fba55] dark:bg-[#303c1f]"
														: "border-border bg-card text-muted-foreground enabled:hover:bg-muted"
												}`}
											>
												<span
													aria-hidden
													className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
														active ? "border-[#62772b] bg-[#62772b] dark:border-[#cbe27f] dark:bg-[#cbe27f]" : "border-border"
													}`}
												>
													{active ? <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-[#25291c]" /> : null}
												</span>
												<span className="min-w-0 flex-1">{option.label}</span>
											</button>
										);
									})}
									{field.allowCustom === true ? (
										// **自定义输入**:没有它,模型给的选项不覆盖实际情况时用户就没法回答。
										<CustomAnswerRow
											active={
												typeof answers[field.id] === "string" &&
												!field.options.some((option) => option.value === answers[field.id])
											}
											value={typeof answers[field.id] === "string" ? (answers[field.id] as string) : ""}
											placeholder="其他(自己填)"
											onChange={(text) => setAnswers((current) => ({ ...current, [field.id]: text }))}
										/>
									) : null}
								</div>
							) : null}
							{field.type === "multi-select" ? (
								<div className="space-y-1.5">
									{field.options.map((option) => {
										const selected =
											Array.isArray(answers[field.id]) && (answers[field.id] as string[]).includes(option.value);
										return (
											<button
												key={option.value}
												type="button"
												aria-pressed={selected}
												title={option.description}
												onClick={() =>
													setAnswers((current) => {
														const list = Array.isArray(current[field.id]) ? (current[field.id] as string[]) : [];
														return {
															...current,
															[field.id]: selected
																? list.filter((value) => value !== option.value)
																: [...list, option.value],
														};
													})
												}
												className={`flex w-full min-w-0 items-center gap-2 rounded-[7px] border px-2.5 py-2 text-left text-[12px] ${
													selected
														? "border-[#a8bd69] bg-[#f3f6e8] text-foreground dark:border-[#9fba55] dark:bg-[#303c1f]"
														: "border-border bg-card text-muted-foreground enabled:hover:bg-muted"
												}`}
											>
												<span
													aria-hidden
													className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border ${
														selected ? "border-[#62772b] bg-[#62772b] dark:border-[#cbe27f] dark:bg-[#cbe27f]" : "border-border"
													}`}
												>
													{selected ? <Check className="h-3 w-3 text-white dark:text-[#25291c]" /> : null}
												</span>
												<span className="min-w-0 flex-1">{option.label}</span>
											</button>
										);
									})}
									{field.allowCustom === true ? (
										<CustomAnswerRow
											active={customMultiValue(answers[field.id], field.options).length > 0}
											value={customMultiValue(answers[field.id], field.options).join(",")}
											placeholder="其他(逗号分隔,可填多个)"
											onChange={(text) =>
												setAnswers((current) => {
													const list = Array.isArray(current[field.id]) ? (current[field.id] as string[]) : [];
													const known = field.options.map((option) => option.value);
													const picked = list.filter((value) => known.includes(value));
													const custom = text
														.split(",")
														.map((part) => part.trim())
														.filter((part) => part.length > 0);
													return { ...current, [field.id]: [...picked, ...custom] };
												})
											}
										/>
									) : null}
								</div>
							) : null}
							{field.type === "confirm" ? (
								<div className="flex gap-1.5">
									{[
										{ value: true, label: "是" },
										{ value: false, label: "否" },
									].map((option) => {
										const active = answers[field.id] === option.value;
										return (
											<button
												key={option.label}
												type="button"
												aria-pressed={active}
												onClick={() => setAnswers((current) => ({ ...current, [field.id]: option.value }))}
												className={`h-8 rounded-[7px] border px-3 text-[12px] ${
													active ? "border-border bg-card text-foreground" : "border-transparent bg-card/60 text-muted-foreground"
												}`}
											>
												{option.label}
											</button>
										);
									})}
								</div>
							) : null}
							{field.type === "text" ? (
								field.multiline === true ? (
									<textarea
										value={typeof answers[field.id] === "string" ? (answers[field.id] as string) : ""}
										onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
										placeholder={field.placeholder}
										rows={3}
										className="max-h-40 w-full resize-none rounded-[7px] border border-border bg-card px-2.5 py-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
									/>
								) : (
									<input
										value={typeof answers[field.id] === "string" ? (answers[field.id] as string) : ""}
										onChange={(event) => setAnswers((current) => ({ ...current, [field.id]: event.target.value }))}
										placeholder={field.placeholder}
										className="h-9 w-full rounded-[7px] border border-border bg-card px-2.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
									/>
								)
							) : null}
						</div>
					</div>
				))}
			</div>
			{error === undefined ? null : <p className="mt-2 text-[11px] text-[#8a4b2a] dark:text-[#e0b394]">{error}</p>}
			<div className="mt-2.5 flex flex-wrap items-center gap-2">
				<Button size="sm" disabled={busy || missing.length > 0} onClick={() => void submit("submitted")}>
					<Check className="h-3.5 w-3.5" />
					提交
				</Button>
				<Button variant="outline" size="sm" disabled={busy} onClick={() => void submit("cancelled")}>
					取消
				</Button>
				{missing.length === 0 ? null : (
					<span className="text-[11px] text-muted-foreground">还有必填项没填</span>
				)}
			</div>
		</div>
	);
}

/**
 * 「其他」那一行:一个输入框,填什么就是什么答案。
 *
 * 为什么必须有:模型给的选项是**它猜的**,而现实里总有不在这几个选项里的答案 ——
 * 少了这一行,那些问题就变成"没法回答",用户只能取消。
 */
function CustomAnswerRow({
	active,
	value,
	placeholder,
	onChange,
}: {
	readonly active: boolean;
	readonly value: string;
	readonly placeholder: string;
	readonly onChange: (text: string) => void;
}) {
	return (
		<label
			className={`flex w-full min-w-0 items-center gap-2 rounded-[7px] border px-2.5 py-2 ${
				active
					? "border-[#a8bd69] bg-[#f3f6e8] dark:border-[#9fba55] dark:bg-[#303c1f]"
					: "border-border bg-card"
			}`}
		>
			<span
				aria-hidden
				className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
					active ? "border-[#62772b] bg-[#62772b] dark:border-[#cbe27f] dark:bg-[#cbe27f]" : "border-border"
				}`}
			>
				{active ? <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-[#25291c]" /> : null}
			</span>
			<input
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
			/>
		</label>
	);
}

/** 多选里"自己填的那些"(选项之外的)。 */
function customMultiValue(value: unknown, options: readonly { readonly value: string }[]): readonly string[] {
	if (!Array.isArray(value)) return [];
	const known = options.map((option) => option.value);
	return value.filter((entry): entry is string => typeof entry === "string" && !known.includes(entry));
}

/** 必填判断:`""`、`[]`、`undefined` 都算没填(确认题的 `false` 是**有效答案**)。 */
function hasAnswer(value: unknown): boolean {
	if (value === undefined) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

/**
 * 等用户批准的审批卡片。
 *
 * 这是**唯一一种"电脑停下来等手机"**的状态:不回答它,那一轮就永远停在那儿。
 * 所以它挂在输入区正上方、用警示色,并且把"要执行什么"和参数都摆出来 ——
 * 让人能**看着内容**决定批不批,而不是对着一个"批准?"点确定。
 */
function ApprovalCard({
	approval,
	onResolve,
}: {
	readonly approval: RemoteApproval;
	readonly onResolve: (approvalId: string, approved: boolean) => Promise<{ readonly ok: boolean; readonly message?: string }>;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const decide = async (approved: boolean) => {
		setBusy(true);
		setError(undefined);
		const result = await onResolve(approval.approvalId, approved);
		setBusy(false);
		if (!result.ok) setError(result.message ?? "这条审批已经不在了");
	};
	return (
		<div className="mx-auto mb-2 max-w-[720px] rounded-[10px] border border-[#d8c9a8] bg-[#fdf6e6] p-3 dark:border-[#4a4331] dark:bg-[#2b2820]">
			<p className="flex items-center gap-2 text-[12px] font-semibold text-[#8a6a2a] dark:text-[#e0c48a]">
				<ShieldAlert className="h-3.5 w-3.5 shrink-0" />
				电脑在等你批准
				{approval.severity === undefined ? null : (
					<span className="font-normal">({approval.severity === "high" ? "风险较高" : approval.severity === "medium" ? "中等风险" : "低风险"})</span>
				)}
			</p>
			<p className="mt-1.5 min-w-0 text-[12px] break-words text-foreground/90">
				<span className="font-mono">{approval.toolName}</span>
				{approval.summary.length === 0 ? null : ` · ${approval.summary}`}
			</p>
			{approval.args === undefined ? null : (
				// 一行、可折行:审批要能看清"要执行什么",但不该因此顶出一条横向滚动条。
				<p className="message-code-scroll mt-1.5 max-w-full overflow-x-auto font-mono text-[11px] leading-5 whitespace-pre-wrap break-words text-muted-foreground">
					{approval.args}
				</p>
			)}
			{error === undefined ? null : <p className="mt-2 text-[11px] text-[#8a4b2a] dark:text-[#e0b394]">{error}</p>}
			<div className="mt-2.5 flex flex-wrap gap-2">
				<Button size="sm" disabled={busy} onClick={() => void decide(true)}>
					<Check className="h-3.5 w-3.5" />
					批准
				</Button>
				<Button variant="outline" size="sm" disabled={busy} onClick={() => void decide(false)}>
					<X className="h-3.5 w-3.5" />
					拒绝
				</Button>
			</div>
		</div>
	);
}

/** 输入区那一行的图标按钮:图标 + 可选的值(模型名、连接器数量)。 */
function ComposerControlButton({
	control,
	onOpen,
}: {
	readonly control: ComposerControl;
	readonly onOpen: () => void;
}) {
	// 模型:用**供应商的真图标**(与桌面端同一份 `ProviderIcon`);认不出是哪家时才退回那个通用图标。
	const modelIconKnown = control.providerId !== undefined || control.avatarId !== undefined;
	const Icon =
		control.kind === "model"
			? Sparkles
			: control.kind === "permissions"
				? ShieldCheck
				: control.kind === "connectors"
					? Plug
					: Plus;
	return (
		<button
			type="button"
			// 名字仍要在无障碍标签里 —— 图标按钮不能对读屏用户也"没有名字"。
			aria-label={control.value === undefined ? control.label : `${control.label}:${control.value}`}
			title={control.value === undefined ? control.label : `${control.label}:${control.value}`}
			disabled={control.kind === "model" && !control.editable}
			onClick={onOpen}
			className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
		>
			{control.kind === "model" && modelIconKnown ? (
				<ProviderIcon
					avatarId={control.avatarId}
					className="h-4 w-4 object-contain"
					providerId={control.providerId}
				/>
			) : (
				<Icon className="h-4 w-4" />
			)}
		</button>
	);
}

/**
 * 只能看的控件抽屉(权限 / 连接器 / 更多)。
 *
 * 它们都**没有开关**:远端改权限等于让手机放宽本机执行限制,改连接器等于把 agent 接到第三方服务,
 * 两件事都要单独设计。所以这里如实显示当前值 + 说明在哪改 —— 比给一个点了没用的开关诚实。
 */
function ComposerControlSheet({
	kind,
	session,
	creatingSession = false,
	running,
	pendingSkillIds,
	availableSkills,
	availableExperts,
	attachmentCount,
	availableConnectors,
	onUploadAttachment,
	onRemoveAttachment,
	onSetExpert,
	onCompact,
	onSetMode,
	onSetPendingSkills,
	onSetPermissions,
	onSetConnectors,
	onClose,
}: {
	readonly kind: ComposerControlKind;
	readonly session: RemoteSessionSummary | undefined;
	/**
	 * 正在新建会话(还没有会话)。
	 *
	 * 这时**只摆技能与连接器**:它们本来就是"这一轮怎么干活"的一部分(与桌面端 WelcomeView 一致)。
	 * 权限 / 模式 / 专家 / 压缩都要先有会话 —— 摆着也只能是灰的,不如不摆(宁可不给)。
	 */
	readonly creatingSession?: boolean;
	readonly running: boolean;
	readonly pendingSkillIds: readonly string[];
	readonly availableSkills: readonly { readonly id: string; readonly name: string; readonly description?: string }[];
	readonly attachmentCount: number;
	readonly availableConnectors: readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[];
	readonly onUploadAttachment: (file: File) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onRemoveAttachment: (uploadId: string) => Promise<void>;
	readonly availableExperts: readonly {
		readonly kind: "expert" | "team";
		readonly id: string;
		readonly version: string;
		readonly name: string;
		readonly description?: string;
	}[];
	readonly onSetExpert: (
		selection: { readonly kind: "expert" | "team"; readonly id: string; readonly version: string } | null,
	) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onCompact: () => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onSetMode: (mode: "default" | "plan" | "clarify") => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onSetPendingSkills: (skillIds: readonly string[]) => void;
	readonly onSetPermissions: (patch: {
		readonly accessLevel?: "default" | "full";
		readonly toolApprovalMode?: "manual" | "auto" | "bypass";
	}) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onSetConnectors: (connectorIds: readonly string[]) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onClose: () => void;
}) {
	const title = kind === "permissions" ? "权限" : kind === "connectors" ? "连接器" : "更多";
	const sessionOnly = !creatingSession;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const [draftConnectors, setDraftConnectors] = useState<readonly string[] | undefined>(undefined);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined);
	const atAttachmentLimit = attachmentCount >= ATTACHMENT_MAX_FILES;
	/** 一次选多个就**一个一个传**:分片上传本来就慢,并发只会让两边都更慢,而且失败时更难说清。 */
	const pickFiles = async (files: readonly File[]) => {
		setAttachmentError(undefined);
		for (const file of files) {
			const result = await onUploadAttachment(file);
			if (!result.ok) {
				setAttachmentError(result.message ?? "这个文件发不了");
				return;
			}
		}
	};
	const skillOptions = availableSkills;
	const expertOptions = availableExperts;
	/*
		两件事要分清楚,否则就会出现用户报的那个现象(只连了 1 个,底下却列了 4 个,而选项里"没有可选项"):

		· **能连什么** = `availableConnectors`(这台机器上已启用的那些)—— 选项列表用它;
		· **这个会话已经连了什么** = `session.connectors` —— 已选的小块用它。
		之前把"已选"写成了"可用里所有 enabled 的"(那正好是全部),于是全被当成已选,选项就被清空了。
	*/
	const connectorNames = new Map<string, string>([
		...connectorRows(session?.connectors).map((row) => [row.id, row.name] as const),
		...availableConnectors.map((row) => [row.id, row.name] as const),
	]);
	const selectedConnectors = draftConnectors ?? connectorRows(session?.connectors).map((row) => row.id);
	const connectorChips = selectedConnectors.map((id) => ({ key: id, label: connectorNames.get(id) ?? id }));
	/** 没选中的回到选项里 —— 选过的就不再出现(避免重复添加)。 */
	const connectorChoices = availableConnectors
		.filter((connector) => !selectedConnectors.includes(connector.id))
		.map((connector) => ({ value: connector.id, label: connector.name }));
	const pendingSkills = pendingSkillIds;
	const apply = async (action: () => Promise<{ readonly ok: boolean; readonly message?: string }>) => {
		setBusy(true);
		setError(undefined);
		const result = await action();
		setBusy(false);
		if (!result.ok) setError(result.message ?? "改不了");
	};
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
			role="presentation"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-label={title}
				className="max-h-[80vh] w-full max-w-[480px] min-w-0 overflow-hidden rounded-t-[14px] border border-border bg-card p-4 md:rounded-[14px]"
				onClick={(event) => event.stopPropagation()}
			>
				<p className="text-[13px] font-semibold text-card-foreground">{title}</p>
				{error === undefined ? null : (
					<p className="mt-2 rounded-[8px] bg-[#f7e8e1] px-3 py-2 text-[11px] text-[#8a4b2a] dark:bg-[#3a2a22] dark:text-[#e0b394]">
						{error}
					</p>
				)}
				{kind === "permissions" ? (
					<div className="mt-3 space-y-4 text-[12px]">
						<ChoiceGroup
							label="访问权限"
							options={ACCESS_OPTIONS}
							current={session?.accessLevel}
							disabled={busy || running}
							onPick={(value) => void apply(() => onSetPermissions({ accessLevel: value }))}
						/>
						<ChoiceGroup
							label="工具确认"
							options={APPROVAL_OPTIONS}
							current={session?.toolApprovalMode}
							disabled={busy || running}
							onPick={(value) => void apply(() => onSetPermissions({ toolApprovalMode: value }))}
						/>
						<p className="text-[11px] leading-4 text-muted-foreground">
							{running ? "正在回复中,等它说完再改。" : "与桌面端同样的全量选择;改的是这台电脑上的这个会话。"}
						</p>
					</div>
				) : null}
				{kind === "connectors" ? (
					<div className="mt-3 space-y-2 text-[12px]">
						{connectorRows(session?.connectors).length === 0 ? (
							<p className="text-[11px] leading-4 text-muted-foreground">这个会话没有连接器。</p>
						) : (
							connectorRows(session?.connectors).map((connector) => {
								const selected = draftConnectors === undefined ? connector.enabled : draftConnectors.includes(connector.id);
								return (
									<label key={connector.id} className="flex items-center gap-2.5">
										<input
											type="checkbox"
											checked={selected}
											disabled={busy || running}
											onChange={(event) => {
												const current = draftConnectors ?? connectorRows(session?.connectors).filter((row) => row.enabled).map((row) => row.id);
												const next = event.target.checked
													? [...current, connector.id]
													: current.filter((id) => id !== connector.id);
												setDraftConnectors(next);
											}}
										/>
										<span className="min-w-0 flex-1 truncate text-foreground/90">{connector.name}</span>
										<span className="shrink-0 text-[10px] text-muted-foreground">
											{connector.enabled ? "已启用" : "已停用"}
										</span>
									</label>
								);
							})
						)}
						<div className="flex flex-wrap items-center gap-2 pt-1">
							<Button
								size="sm"
								disabled={busy || running || draftConnectors === undefined}
								onClick={() => void apply(() => onSetConnectors(draftConnectors ?? []))}
							>
								保存
							</Button>
							<span className="text-[11px] leading-4 text-muted-foreground">
								只能在已启用的连接器里挑;增删仍在电脑上。
							</span>
						</div>
					</div>
				) : null}
				{kind === "more" ? (
					<div className="mt-3 space-y-3 text-[12px]">
						{/*
							一律用**原生 select**:手机上它会唤起系统选择器 —— 省空间、能滚动、
							而且滚动由系统负责(option 多的时候不用我们自己搭虚拟列表)。
						*/}
						{creatingSession ? null : (
						<span className="contents">
						<SelectRow
							label="模式"
							value={session?.interactionMode ?? "default"}
							options={MODE_OPTIONS}
							disabled={busy || running}
							onPick={(value) => void apply(() => onSetMode(value))}
						/>
						<SelectRow
							label="访问权限"
							value={session?.accessLevel ?? "default"}
							options={ACCESS_OPTIONS}
							disabled={busy || running}
							onPick={(value) => void apply(() => onSetPermissions({ accessLevel: value }))}
						/>
						<SelectRow
							label="工具确认"
							value={session?.toolApprovalMode ?? "manual"}
							options={APPROVAL_OPTIONS}
							disabled={busy || running}
							onPick={(value) => void apply(() => onSetPermissions({ toolApprovalMode: value }))}
						/>
						</span>
						)}
						{skillOptions.length === 0 ? null : (
							<AddSelectRow
								label="技能"
								placeholder="添加技能…"
								options={skillOptions
									.filter((skill) => !pendingSkills.includes(skill.id))
									.map((skill) => ({ value: skill.id, label: skill.name }))}
								disabled={busy || running}
								chips={skillOptions
									.filter((skill) => pendingSkills.includes(skill.id))
									.map((skill) => ({ key: skill.id, label: skill.name }))}
								onPick={(value) => onSetPendingSkills([...pendingSkills, value])}
								onRemove={(key) => onSetPendingSkills(pendingSkills.filter((id) => id !== key))}
								hint={
									creatingSession
										? "选好之后随第一条消息一起发出去(与桌面端新建页一样)。"
										: "选好之后随下一条消息发出去(与桌面端一样,技能是每一轮的事)。"
								}
							/>
						)}
						{availableConnectors.length === 0 && selectedConnectors.length === 0 ? null : (
							<AddSelectRow
								label="连接器"
								placeholder="添加连接器…"
								options={connectorChoices}
								disabled={busy || running}
								chips={connectorChips}
								onPick={(value) => setDraftConnectors([...selectedConnectors, value])}
								onRemove={(key) => setDraftConnectors(selectedConnectors.filter((id) => id !== key))}
								action={
									draftConnectors === undefined
										? undefined
										: {
												label: creatingSession ? "确定" : "保存连接器",
												// 新建状态下**不写本机**(还没有会话):存成"这一轮要连的",与第一条消息一起发。
												run: () => void apply(() => onSetConnectors(selectedConnectors)),
											}
								}
								hint={
									creatingSession
										? "选好之后随第一条消息一起发出去(与桌面端新建页一样)。"
										: "只能在已启用的连接器里挑;增删仍在电脑上。"
								}
							/>
						)}
						{creatingSession ? null : (
						<span className="contents">
						{expertOptions.length === 0 ? null : (
							<SelectRow
								label="专家 / 专家团"
								value={session?.expertName === undefined ? "" : String(expertOptions.find((expert) => expert.name === session.expertName)?.id ?? "")}
								options={[
									{ value: "", label: "不用" },
									...expertOptions.map((expert) => ({
										value: expert.id,
										label: `${expert.name}(${expert.kind === "team" ? "专家团" : "专家"})`,
									})),
								]}
								disabled={busy || running}
								onPick={(value) => {
									const expert = expertOptions.find((entry) => entry.id === value);
									void apply(() =>
										onSetExpert(expert === undefined ? null : { kind: expert.kind, id: expert.id, version: expert.version }),
									);
								}}
							/>
						)}
						<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
							<input
								ref={fileInputRef}
								type="file"
								multiple
								className="hidden"
								onChange={(event) => {
									const files = [...(event.target.files ?? [])];
									event.currentTarget.value = "";
									void pickFiles(files);
								}}
							/>
							<Button
								variant="outline"
								size="sm"
								disabled={busy || running || atAttachmentLimit}
								onClick={() => fileInputRef.current?.click()}
							>
								<Paperclip className="h-3.5 w-3.5" />
								添加附件
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={busy || running}
								onClick={() => void apply(() => onCompact())}
							>
								压缩上下文
							</Button>
						</div>
						<p className="text-[11px] leading-4 text-muted-foreground">
							{atAttachmentLimit
								? `附件一次最多 ${ATTACHMENT_MAX_FILES} 个。`
								: `附件:图片、文档与文本,单个不超过 ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB;一次最多 ${ATTACHMENT_MAX_FILES} 个。`}
						</p>
						{attachmentError === undefined ? null : (
							<p className="text-[11px] text-[#8a4b2a] dark:text-[#e0b394]">{attachmentError}</p>
						)}
						</span>
						)}
					</div>
				) : null}
				<Button variant="outline" size="sm" className="mt-3 w-full" onClick={onClose}>
					关闭
				</Button>
			</div>
		</div>
	);
}

/** 一行:左边标签,右边一个**有样式的**下拉(原生 select 的 option 列表在手机上不受样式控制)。 */
function SelectRow<T extends string>({
	label,
	value,
	options,
	disabled,
	onPick,
}: {
	readonly label: string;
	readonly value: T;
	readonly options: readonly { readonly value: T; readonly label: string }[];
	readonly disabled: boolean;
	readonly onPick: (value: T) => void;
}) {
	const [open, setOpen] = useState(false);
	const current = options.find((option) => option.value === value);
	return (
		<div className="min-w-0">
			<div className="flex min-w-0 items-center gap-2">
				<span className="w-[76px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
				<div className="relative min-w-0 flex-1">
					<button
						type="button"
						aria-label={label}
						aria-expanded={open}
						disabled={disabled}
						onClick={() => setOpen((value_) => !value_)}
						className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[7px] border border-border bg-card px-2 text-left text-[12px] text-foreground disabled:opacity-50"
					>
						<span className="min-w-0 flex-1 truncate">{current?.label ?? "—"}</span>
						<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					</button>
					{open ? (
						<>
							{/* 点空白处收起:手机上比"再点一次按钮"顺手。 */}
							<div className="fixed inset-0 z-30" role="presentation" onClick={() => setOpen(false)} />
							{/* **限高可滚**:选项多的时候(比如几十个技能)不能把屏幕撑满。 */}
							<div
								role="listbox"
								className="absolute top-full left-0 z-40 mt-1 max-h-56 w-full min-w-0 overflow-y-auto rounded-[7px] border border-border bg-card py-1 shadow-lg"
							>
								{options.map((option) => (
									<button
										key={option.value}
										type="button"
										role="option"
										aria-selected={option.value === value}
										onClick={() => {
											setOpen(false);
											onPick(option.value);
										}}
										className={`flex h-8 w-full min-w-0 items-center gap-2 px-2.5 text-left text-[12px] ${
											option.value === value
												? "bg-muted text-foreground"
												: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
										}`}
									>
										<span className="min-w-0 flex-1 truncate">{option.label}</span>
										{option.value === value ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
									</button>
								))}
							</div>
						</>
					) : null}
				</div>
			</div>
		</div>
	);
}

/**
 * 一行:左边标签,右边一个**用来添加的**下拉,下面是被选中的项(可逐个移除)。
 *
 * 多选为什么不用 `<select multiple>`:手机上它是"按住 Ctrl 点"那种交互,基本没法用。
 * 所以改成"选一个加一个、加进去的以可删的小块列出来" —— 空间一样省,而且能用。
 */
function AddSelectRow({
	label,
	placeholder,
	options,
	chips,
	disabled,
	onPick,
	onRemove,
	action,
	hint,
}: {
	readonly label: string;
	readonly placeholder: string;
	readonly options: readonly { readonly value: string; readonly label: string }[];
	readonly chips: readonly { readonly key: string; readonly label: string }[];
	readonly disabled: boolean;
	readonly onPick: (value: string) => void;
	readonly onRemove: (key: string) => void;
	readonly action?: { readonly label: string; readonly run: () => void };
	readonly hint?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="min-w-0">
			<div className="flex min-w-0 items-center gap-2">
				<span className="w-[76px] shrink-0 text-[11px] text-muted-foreground">{label}</span>
				<div className="relative min-w-0 flex-1">
					<button
						type="button"
						aria-label={label}
						aria-expanded={open}
						disabled={disabled || options.length === 0}
						onClick={() => setOpen((value) => !value)}
						className="flex h-8 w-full min-w-0 items-center gap-2 rounded-[7px] border border-border bg-card px-2 text-left text-[12px] text-muted-foreground disabled:opacity-50"
					>
						<span className="min-w-0 flex-1 truncate">{options.length === 0 ? "没有可选项" : placeholder}</span>
						<ChevronDown className="h-3.5 w-3.5 shrink-0" />
					</button>
					{open ? (
						<>
							<div className="fixed inset-0 z-30" role="presentation" onClick={() => setOpen(false)} />
							<div
								role="listbox"
								className="absolute top-full left-0 z-40 mt-1 max-h-56 w-full min-w-0 overflow-y-auto rounded-[7px] border border-border bg-card py-1 shadow-lg"
							>
								{options.map((option) => (
									<button
										key={option.value}
										type="button"
										role="option"
										aria-selected={false}
										onClick={() => {
											setOpen(false);
											onPick(option.value);
										}}
										className="flex h-8 w-full min-w-0 items-center px-2.5 text-left text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
									>
										<span className="min-w-0 flex-1 truncate">{option.label}</span>
									</button>
								))}
							</div>
						</>
					) : null}
				</div>
			</div>
			{chips.length === 0 ? null : (
				<div className="mt-1.5 ml-[84px] flex flex-wrap gap-1.5">
					{chips.map((chip) => (
						<span
							key={chip.key}
							className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-[6px] border border-border bg-muted/50 px-2 text-[11px]"
						>
							<span className="min-w-0 max-w-[150px] truncate">{chip.label}</span>
							<button
								type="button"
								aria-label={`移除 ${chip.label}`}
								onClick={() => onRemove(chip.key)}
								className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
							>
								<X className="h-3 w-3" />
							</button>
						</span>
					))}
				</div>
			)}
			{action === undefined ? null : (
				<div className="mt-1.5 ml-[84px]">
					<Button size="sm" disabled={disabled} onClick={action.run}>
						{action.label}
					</Button>
				</div>
			)}
			{hint === undefined ? null : (
				<p className="mt-1 ml-[84px] text-[11px] leading-4 text-muted-foreground">{hint}</p>
			)}
		</div>
	);
}

/** 单选组(旧的样子,保留给提问卡片那种"选项很少、要一眼看全"的地方)。 */
function ChoiceGroup<T extends string>({
	label,
	options,
	current,
	disabled,
	onPick,
}: {
	readonly label: string;
	readonly options: readonly { readonly value: T; readonly label: string }[];
	readonly current: T | undefined;
	readonly disabled: boolean;
	readonly onPick: (value: T) => void;
}) {
	return (
		<div className="min-w-0">
			<p className="mb-1.5 text-[11px] text-muted-foreground">{label}</p>
			<div className="flex flex-wrap gap-1.5">
				{options.map((option) => {
					const active = option.value === current;
					return (
						<button
							key={option.value}
							type="button"
							aria-pressed={active}
							disabled={disabled || active}
							onClick={() => onPick(option.value)}
							className={`h-8 rounded-[7px] border px-3 text-[12px] transition-colors ${
								active
									? "border-border bg-muted text-foreground"
									: "border-transparent bg-muted/50 text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-50"
							}`}
						>
							{option.label}
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** 抽屉里的一行:左标签右值。 */
function Row({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className="min-w-0 truncate text-muted-foreground">{label}</span>
			<span className="shrink-0 text-foreground">{value}</span>
		</div>
	);
}

/**
 * 助手回复底部的操作行:**复制、用量、重做、时间**。
 *
 * 与桌面端同一条纪律:**每条**回复都有复制/用量/时间(它们是这条回复自己的属性),
 * 而**重做只在最新一轮** —— 重做是"以这一轮为末端重写之后的历史",对中间的回复做重做
 * 在语义上不成立,还会把后面已经发生的对话丢掉。
 */
function MessageFooter({
	copyText,
	usage,
	onLoadSessionUsage,
	versions,
	turnMessageId,
	at,
	canRetry,
	onRetryTurn,
	onSelectVersion,
}: {
	readonly copyText: string;
	readonly usage?: RemoteUsageSummary;
	/** 读会话总计用量(用量详情里的"会话统计")。 */
	readonly onLoadSessionUsage?: () => Promise<{
		readonly ok: boolean;
		readonly chat?: RemoteUsageSummary;
		readonly unmeasuredCalls?: number;
		readonly message?: string;
	}>;
	/** 重做过几次、现在看的是第几版(只有多版时才给)。 */
	readonly versions?: { readonly active: number; readonly total: number };
	/** 这一轮的用户消息 id:切版本时传给本机(运行时的接口按它查版本)。 */
	readonly turnMessageId?: string;
	readonly at: number;
	readonly canRetry: boolean;
	readonly onRetryTurn: () => void;
	readonly onSelectVersion: (userMessageId: string, version: number) => Promise<{ readonly ok: boolean; readonly message?: string }>;
}) {
	const [usageOpen, setUsageOpen] = useState(false);
	/**
	 * 底部所有图标按钮共用这一套尺寸与对齐方式。
	 *
	 * 之前复制那个是 `MessageActions` 自己的样式(24px)、用量与重做是另一套(28px)——
	 * 尺寸不同就会看起来"没在一个水平线上"。
	 */
	const iconButton =
		"grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground";
	return (
		<div className="mt-3 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
			{/* 图标按钮:与桌面端同尺寸(28px),手机上够点得着,也不占地方。 */}
			{copyText.length === 0 ? null : <MessageActions text={copyText} />}
			{usage === undefined ? null : (
				<button
					type="button"
					aria-label="用量详情"
					title="用量详情"
					onClick={() => setUsageOpen(true)}
					className={iconButton}
				>
					<Gauge className="h-3.5 w-3.5" />
				</button>
			)}
			{canRetry ? (
				<button type="button" aria-label="重新生成" title="重新生成" onClick={onRetryTurn} className={iconButton}>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			) : null}
			{/* 版本切换:重做过才有。只有多版时才出现 —— 摆一个"1/1"没有意义。 */}
			{versions === undefined || turnMessageId === undefined ? null : (
				<span className="flex shrink-0 items-center gap-0.5">
					<button
						type="button"
						aria-label="上一版"
						disabled={versions.active <= 1}
						onClick={() => void onSelectVersion(turnMessageId as string, versions.active - 1)}
						className={`${iconButton} disabled:opacity-40`}
					>
						<ChevronLeft className="h-3.5 w-3.5" />
					</button>
					<span className="font-mono text-[10px] tabular-nums">
						{versions.active}/{versions.total}
					</span>
					<button
						type="button"
						aria-label="下一版"
						disabled={versions.active >= versions.total}
						onClick={() => void onSelectVersion(turnMessageId as string, versions.active + 1)}
						className={`${iconButton} disabled:opacity-40`}
					>
						<ChevronRight className="h-3.5 w-3.5" />
					</button>
				</span>
			)}
			<span className="ml-auto shrink-0 font-mono text-[10px]">{clockTime(at)}</span>
			{usageOpen && usage !== undefined ? (
				<UsageDetailSheet
					usage={usage}
					at={at}
					onLoadSessionUsage={onLoadSessionUsage}
					onClose={() => setUsageOpen(false)}
				/>
			) : null}
		</div>
	);
}

/**
 * 用量详情 —— **与桌面端同一套**:本轮 + 会话统计,每个都有缓存命中率、合计、费用与分段条。
 *
 * 数据也来自同一处:本轮的摘要由本机用桌面端 footer 那个领域函数算好(`summarizeUsageMessages`),
 * 会话总计走 `session.usage`。所以两端对同一个会话显示的是**同一组数**。
 */
function UsageDetailSheet({
	usage,
	at,
	onLoadSessionUsage,
	onClose,
}: {
	readonly usage: RemoteUsageSummary;
	readonly at: number;
	readonly onLoadSessionUsage?: () => Promise<{
		readonly ok: boolean;
		readonly chat?: RemoteUsageSummary;
		readonly unmeasuredCalls?: number;
		readonly message?: string;
	}>;
	readonly onClose: () => void;
}) {
	const [session, setSession] = useState<
		{ readonly chat?: RemoteUsageSummary; readonly unmeasuredCalls?: number } | undefined
	>(undefined);
	// 没有"读会话总计"这个口子时直接算读完:不摆一个读了必然失败的那一块。
	const [loading, setLoading] = useState(onLoadSessionUsage !== undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	useEffect(() => {
		if (onLoadSessionUsage === undefined) return;
		let cancelled = false;
		void onLoadSessionUsage().then((result) => {
			if (cancelled) return;
			setLoading(false);
			if (result.ok) {
				setSession({
					...(result.chat === undefined ? {} : { chat: result.chat }),
					...(result.unmeasuredCalls === undefined ? {} : { unmeasuredCalls: result.unmeasuredCalls }),
				});
				return;
			}
			setError(result.message ?? "读不到会话统计");
		});
		return () => {
			cancelled = true;
		};
	}, [onLoadSessionUsage]);
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
			role="presentation"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-label="用量详情"
				className="max-h-[85vh] w-full max-w-[480px] min-w-0 overflow-y-auto rounded-t-[14px] border border-border bg-card p-4 md:rounded-[14px]"
				onClick={(event) => event.stopPropagation()}
			>
				<p className="text-[13px] font-semibold text-card-foreground">用量详情</p>
				<UsageBlock title={`本轮 · ${clockTime(at)}`} usage={usage} />
				<div className="mt-4 border-t border-border pt-4">
					{loading ? (
						<p className="text-[11px] text-muted-foreground">正在读会话统计…</p>
					) : error !== undefined ? (
						<p className="text-[11px] text-[#8a4b2a] dark:text-[#e0b394]">{error}</p>
					) : session?.chat === undefined ? (
						<p className="text-[11px] text-muted-foreground">这个会话还没有可统计的用量。</p>
					) : (
						<UsageBlock title="会话统计" usage={session.chat} />
					)}
					{session?.unmeasuredCalls === undefined || session.unmeasuredCalls === 0 ? null : (
						<p className="mt-2 text-[11px] leading-4 text-muted-foreground">
							有 {session.unmeasuredCalls} 次调用拿不到用量(那是"不知道",不是 0)。
						</p>
					)}
				</div>
				<Button variant="outline" size="sm" className="mt-4 w-full" onClick={onClose}>
					关闭
				</Button>
			</div>
		</div>
	);
}

/** 一块用量:标题 + 命中率 + 合计 + 提示/费用 + 四段比例条(与桌面端同序同色)。 */
function UsageBlock({
	title,
	usage,
	extras = [],
}: {
	readonly title: string;
	readonly usage: RemoteUsageSummary;
	/** 面板底部的补充项(会话统计用它显示"未测量的调用")。 */
	readonly extras?: readonly (readonly [string, string])[];
}) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const percent = (value: number | null) => (value === null ? undefined : `${(value * 100).toFixed(1)}%`);
	const segments = [
		{ key: "input", label: "输入", value: usage.inputTokens, color: "#7d94b2" },
		{ key: "cacheRead", label: "缓存读", value: usage.cacheReadTokens, color: "#20b896" },
		{ key: "cacheWrite", label: "缓存写", value: usage.cacheWriteTokens, color: "#e8b45d" },
		{ key: "output", label: "输出", value: usage.outputTokens, color: "#8a5cf4" },
	];
	const total = segments.reduce((sum, segment) => sum + segment.value, 0);
	return (
		<section className="mt-3 min-w-0">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-[11px] font-semibold text-foreground">{title}</span>
				<span className="shrink-0 text-[10px] text-muted-foreground">
					{usage.modelCalls} 次调用
					{usage.delegatedCalls > 0 ? ` · 其中委派 ${usage.delegatedCalls} 次` : ""}
				</span>
			</div>
			<div className="mt-2 flex items-end justify-between gap-3 rounded-md bg-muted/50 px-2 py-1.5">
				<div className="min-w-0">
					<p className="text-[10px] text-muted-foreground">缓存命中率</p>
					<p className="mt-0.5 font-mono text-[20px] leading-none font-semibold tabular-nums text-[#397a9d] dark:text-[#9ccce2]">
						{percent(usage.hitRate) ?? "未上报"}
					</p>
					<p className="mt-1 text-[9px] text-muted-foreground">
						{usage.readObservedCalls}/{usage.modelCalls} 次调用可观测
					</p>
				</div>
				<div className="shrink-0 text-right">
					<p className="text-[10px] text-muted-foreground">合计</p>
					<p className="mt-0.5 font-mono text-[13px] leading-none font-semibold tabular-nums text-foreground">
						{formatTokens(usage.totalTokens)}
					</p>
				</div>
			</div>
			<div className="mt-2 flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
				<span>提示 {formatTokens(usage.promptTokens)}</span>
				<span>预估费用 {usage.totalCost.toFixed(4)}</span>
			</div>
			<div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
				{segments
					.filter((segment) => segment.value > 0)
					.map((segment) => (
						<span
							key={segment.key}
							style={{ flexGrow: segment.value, background: segment.color }}
							title={`${segment.label} ${formatTokens(segment.value)}`}
						/>
					))}
				{total === 0 ? <span className="flex-1 bg-muted" /> : null}
			</div>
			<div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
				{segments.map((segment) => (
					<span key={segment.key} className="inline-flex items-center gap-1">
						<span aria-hidden className="h-2 w-2 rounded-full" style={{ background: segment.color }} />
						{segment.label} {formatTokens(segment.value)}
					</span>
				))}
			</div>
			{/* 「更多」—— 与桌面端面板里那一节同一套项(覆盖率与对账)。 */}
			<div className="mt-2 border-t border-border/60 pt-1.5">
				<button
					aria-expanded={detailsOpen}
					className="flex w-full items-center gap-1 text-[10px] text-muted-foreground"
					onClick={() => setDetailsOpen((open) => !open)}
					type="button"
				>
					更多
				</button>
				{detailsOpen ? (
					<dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 text-[10px]">
						<div className="contents">
							<dt className="truncate text-muted-foreground">读取覆盖率</dt>
							<dd className="text-right tabular-nums">
								{percent(usage.readCoverage ?? null) ?? "未上报"}
							</dd>
						</div>
						<div className="contents">
							<dt className="truncate text-muted-foreground">写入覆盖率</dt>
							<dd className="text-right tabular-nums">
								{/*
									没有调用上报过写入时不能写"0%":那会被读成"写入占比 0%"。
									与桌面端同一条判断(`cacheWriteObservation`),这里只挑文案。
								*/}
								{usage.writeObservation === "read-only"
									? "无写入上报"
									: (percent(usage.writeCoverage ?? null) ?? "未上报")}
							</dd>
						</div>
						{(usage.reportedPromptCount ?? 0) > 0 ? (
							<div className="contents">
								<dt className="truncate text-muted-foreground">自报 prompt 对账</dt>
								<dd
									className="text-right tabular-nums"
									title={`自报 ${usage.reportedPromptTokens} / 分量和 ${usage.promptTokens}`}
								>
									{(usage.reportedPromptDriftCount ?? 0) > 0
										? `${usage.reportedPromptDriftCount} 条不一致(最大 ${usage.reportedPromptMaxDrift})`
										: "一致"}
								</dd>
							</div>
						) : null}
						{extras.map(([label, value]) => (
							<div className="contents" key={label}>
								<dt className="truncate text-muted-foreground">{label}</dt>
								<dd className="text-right tabular-nums text-foreground">{value}</dd>
							</div>
						))}
					</dl>
				) : null}
			</div>
		</section>
	);
}

/** 时分秒(桌面端也是这个粒度:同一条消息的时间要看得出先后)。 */
function clockTime(at: number): string {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 上下文用量(手机上的底部抽屉)。
 *
 * 与桌面端**同一份数据、同一条百分比规则、同一套分类颜色**。
 * 唯一的差别是它标明"分类是估算":桌面端有 hover 卡片慢慢解释,手机上没有那个余地,
 * 所以这句话必须写在明面上。
 */
function ContextUsageSheet({ usage, onClose }: { readonly usage: RemoteContextUsage; readonly onClose: () => void }) {
	const percent = contextPercent(usage);
	const rows = contextBreakdown(usage);
	return (
		<div
			className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center"
			role="presentation"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-label="上下文用量"
				className="max-h-[80vh] w-full max-w-[560px] min-w-0 overflow-hidden rounded-t-[14px] border border-border bg-card p-4 md:rounded-[14px]"
				onClick={(event) => event.stopPropagation()}
			>
				<p className="text-[13px] font-semibold text-card-foreground">上下文用量</p>
				<p className="mt-1 font-mono text-[11px] text-muted-foreground">
					已用 {formatTokens(usage.usedTokens)} / {formatTokens(usage.contextWindow)}({Math.round(percent)}%)
				</p>
				{rows.length === 0 ? null : (
					<div className="mt-3 space-y-2">
						{rows.map((row) => (
							<div key={row.key} className="min-w-0">
								<div className="flex min-w-0 items-center gap-2 text-[11px]">
									<span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
									<span className="min-w-0 flex-1 truncate text-foreground/90">{row.label}</span>
									<span className="shrink-0 font-mono text-muted-foreground">{formatTokens(row.tokens)}</span>
								</div>
								{/* 条形图只是把"谁占得多"说清楚:数字已经在上面了,所以它不承担唯一表达。 */}
								<div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
									<div className="h-full rounded-full" style={{ width: `${row.percent}%`, background: row.color }} />
								</div>
							</div>
						))}
					</div>
				)}
				<p className="mt-3 text-[11px] leading-4 text-muted-foreground">
					{usage.source === "provider"
						? "数字来自模型供应商的实际用量。"
						: usage.source === "tokenizer"
							? "数字由本机分词器算出。"
							: "数字是本机估算的,分类明细也是估算值。"}
				</p>
				<Button variant="outline" size="sm" className="mt-3 w-full" onClick={onClose}>
					关闭
				</Button>
			</div>
		</div>
	);
}

/** 折叠起来只留这么多行(与桌面端同一个数:它那边是 72px,也就是三行)。 */
const USER_MESSAGE_COLLAPSED_LINES = 3;

/**
 * 过长的**用户消息**默认折叠 —— 与桌面端同一套。
 *
 * 三条规矩:
 * 1. 折的是**超过三行的那部分**:留着的是整行,不把字切一半(硬截到某个像素高会把第四行切一半,
 *    看上去像"被盖住了")。
 * 2. 按钮在**卡片底部**、只有图标(桌面端也是这个形状):一张卡片上多"展开"两个字,比图标吵。
 * 3. 量高度必须**在没有折的时候量** —— 折着量到的是折后的高度,判断会来回抖。
 *
 * 为什么是用户消息:助手的长回答有结构(markdown、工具组),而用户那条往往是一整段粘贴进来的东西,
 * 摊开着会把后面的对话顶下去。
 */
function CollapsibleUserMessage({
	className,
	contentKey,
	text,
}: {
	readonly className: string;
	readonly contentKey: string;
	readonly text: string;
}) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [truncated, setTruncated] = useState(false);
	const clamped = !expanded && truncated;

	useLayoutEffect(() => {
		// 换了内容就重新量:先把"折"放开,这一帧量到的才是真实高度。
		setExpanded(false);
		setTruncated(false);
	}, [contentKey]);

	useLayoutEffect(() => {
		const element = bodyRef.current;
		if (!element) return;
		// 折着的时候不量 —— 量到的是折后的高度,会让"要不要折"来回抖。
		if (clamped) return;
		const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
		// 行高读不出来时按卡片自己的 24px 算(也就是桌面端那个 72px)。
		const limit = (Number.isFinite(lineHeight) ? lineHeight : 24) * USER_MESSAGE_COLLAPSED_LINES;
		setTruncated(element.scrollHeight > limit + 1);
	}, [clamped, contentKey]);

	return (
		<div className={className}>
			<div className={clamped ? "line-clamp-3" : undefined} ref={bodyRef}>
				{text}
			</div>
			{truncated ? (
				<div className="mt-0.5 flex justify-center">
					<button
						type="button"
						aria-expanded={expanded}
						aria-label={expanded ? "收起" : "展开"}
						onClick={() => setExpanded((value) => !value)}
						className="grid h-4 w-4 place-items-center rounded-[4px] text-[#6d7f53] hover:bg-black/5 hover:text-[#45582f] dark:text-[#b8d98e] dark:hover:bg-white/10 dark:hover:text-[#d6edaf]"
					>
						{expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
					</button>
				</div>
			) : null}
		</div>
	);
}

/** 三档的图标(与桌面端同一套字形):只在视图层出现,纯逻辑模块里不放 JSX。 */
const THEME_ICONS: Record<ThemePreference, typeof Monitor> = {
	system: Monitor,
	light: Sun,
	dark: Moon,
};

/** 会话行:标题 + 时间 + 运行中标记。 */
function SessionRow({
	session,
	active,
	opening,
	onOpen,
}: {
	readonly session: RemoteSession;
	readonly active: boolean;
	/** 正在打开这一条:它自己转圈(切换有延迟,点了得看得见反应)。 */
	readonly opening: boolean;
	readonly onOpen: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-current={active ? "true" : undefined}
			className={`relative mb-0.5 flex w-full min-w-0 items-center gap-2.5 rounded-[7px] px-3 py-2.5 text-left transition-colors ${
				active ? "bg-muted" : "hover:bg-muted/60"
			}`}
		>
			{/* 当前这一条:左边一道竖线(桌面端也是这么标的) —— 手机上"背景色差一点"看不出来。 */}
			{active ? <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-[#6d8438] dark:bg-[#cbe27f]" /> : null}
			{/* 图标按**工作类型**走(与桌面端侧栏同一张表),不再是"所有会话都是一个气泡"。 */}
			<AgentEntryIcon iconKey={entryIconKey(session.entryId)} className="mt-0.5 h-4 w-4" />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[13px] font-medium text-foreground">{session.title || "未命名会话"}</span>
				<span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					{/* 打开中优先说"正在打开":这一条是用户刚点的,他要的是"点上了没有"。 */}
					{opening ? (
						<>
							<LoaderCircle
								aria-label="正在打开"
								role="img"
								className="h-3 w-3 animate-spin text-[#89957a] motion-reduce:animate-none dark:text-[#9aa88a]"
							/>
							<span className="truncate">正在打开…</span>
						</>
					) : session.running ? (
						<>
							<LoaderCircle
								aria-label="运行中"
								role="img"
								className="h-3 w-3 animate-spin text-[#89957a] motion-reduce:animate-none dark:text-[#9aa88a]"
							/>
							<span className="truncate">运行中</span>
						</>
					) : (
						<>
							<span className="shrink-0">{relativeTime(session.updatedAt)}</span>
							{session.workspaceName === undefined ? null : (
								<span className="truncate">· {session.workspaceName}</span>
							)}
						</>
					)}
				</span>
			</span>
		</button>
	);
}

/** 工作类型 → 图标(与桌面端 `AgentEntryIcon` 同一张表:同一个入口,两端同一个图标)。 */
const ENTRY_ICONS: Record<string, string> = {
	sparkles: everydayOfficeIcon,
	presentation: presentationIcon,
	table: spreadsheetIcon,
	chart: dataAnalysisIcon,
	code: codeDevelopmentIcon,
	palette: websiteIcon,
	image: innovationIcon,
};

/** 入口 id → 图标 key(新建页给的是 id,列表里只有 id)。 */
const ENTRY_ICON_BY_ID: Record<string, string> = {
	"general-work": "sparkles",
	presentation: "presentation",
	spreadsheet: "table",
	"data-analysis": "chart",
	"code-development": "code",
	"ui-design": "palette",
	"image-generation": "image",
};

function entryIconKey(entryId: string | undefined): string | undefined {
	return entryId === undefined ? undefined : ENTRY_ICON_BY_ID[entryId];
}

function AgentEntryIcon({ className, iconKey }: { readonly className?: string; readonly iconKey?: string }) {
	const source = ENTRY_ICONS[iconKey ?? "sparkles"] ?? everydayOfficeIcon;
	// 与桌面端同一个判据:这两类图标在深色下要反色。
	const needsDarkContrast = iconKey === undefined || iconKey === "sparkles" || iconKey === "code";
	return (
		<img
			alt=""
			aria-hidden
			draggable={false}
			src={source}
			className={`shrink-0 object-contain ${needsDarkContrast ? "dark:invert" : ""} ${className ?? ""}`}
		/>
	);
}

/**
 * 消息:用户是简单气泡,助手按"渲染计划"画(正文 / 思考 / **工具分组**)。
 *
 * 助手输出已经在上层按轮合并过,所以复制按钮**一轮只有一个** ——
 * 之前每个分片都挂一个,看起来像是"每段文字底下都有个按钮"。
 */
function MessageRow({
	planned,
	onRetry,
	showFooter,
	runStatus,
	isLatestTurn,
	identityName,
	turnUserMessageId: turnId,
	onRetryTurn,
	onSelectVersion,
	onLoadSessionUsage,
}: {
	readonly planned: PlannedMessage;
	readonly onRetry: (at: number) => void;
	/** 底部操作行是否显示(正在生成的那一轮不显示)。 */
	readonly showFooter: boolean;
	/** 电脑正在做什么(挂在消息底部;见 `RunStatusLine`)。只有正在跑的那一轮才有。 */
	readonly runStatus?: string;
	/** 这一条是不是最新一轮的回复:重做只对它有意义。 */
	readonly isLatestTurn: boolean;
	/** 这条回答是谁给的:专家团会话用牵头专家,其余就是 Wordless 自己(与桌面端同一条规则)。 */
	readonly identityName?: string;
	/** 这一轮的用户消息 id:重做与版本切换都以它为准(运行时的接口就是这么定义的)。 */
	readonly turnUserMessageId?: string;
	readonly onRetryTurn: (messageId: string) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onSelectVersion: (messageId: string, version: number) => Promise<{ readonly ok: boolean; readonly message?: string }>;
	readonly onLoadSessionUsage?: () => Promise<{
		readonly ok: boolean;
		readonly chat?: RemoteUsageSummary;
		readonly unmeasuredCalls?: number;
		readonly message?: string;
	}>;
}) {
	const message = planned.message;
	// 压缩那一行不是"谁说的话":没有身份行、没有底部操作行,整条消息就是这一行。
	if (message.role === "compaction") {
		return (
			<article className="flex min-w-0 flex-col">
				{planned.blocks.map((block, index) =>
					block.type === "compaction" ? (
						<CompactionBlock key={`compaction-${index}`} compaction={block.compaction} />
					) : null,
				)}
			</article>
		);
	}
	if (message.role === "user") {
		return (
			<article
				className={`flex min-w-0 flex-col items-end gap-1 ${message.pending === true ? "message-enter" : ""}`}
			>
				<CollapsibleUserMessage
					contentKey={`${message.at}:${message.text.length}`}
					text={message.text}
					className={`w-fit max-w-[88%] rounded-[10px] bg-[#f0f0ed] px-3.5 py-2.5 text-[14px] leading-6 break-words whitespace-pre-wrap text-[#343431] dark:bg-muted dark:text-foreground sm:max-w-[560px] ${
						message.pending === true ? "opacity-60" : ""
					}`}
				/>
				{/* 状态用文字说,不只靠"变淡":用户要能分清"在路上"和"没发出去"。 */}
				{message.pending === true ? (
					<p className="text-[10px] text-muted-foreground">发送中…</p>
				) : message.failed === true ? (
					<p className="flex items-center gap-1.5 text-[10px] text-[#ad7956] dark:text-[#d6a16d]">
						发送失败
						<button type="button" className="underline decoration-dotted" onClick={() => onRetry(message.at)}>
							重试
						</button>
					</p>
				) : null}
			</article>
		);
	}
	// 只把**看得见的正文**拿去复制:空白文本块不该让按钮出现。
	const copyText = planned.blocks
		.filter((block): block is { readonly type: "text"; readonly text: string } => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
	return (
		// 助手消息**占满宽度**:它是"回答",不是"某人说的话"。桌面端也是直接排在背景上,没有气泡。
		<article
			className={`flex min-w-0 max-w-full justify-start ${message.streaming === true ? "message-enter" : ""}`}
			data-message-role="assistant"
		>
			<div className="min-w-0 flex-1 text-[13px] leading-5 text-foreground">
				{/* 第一行:品牌图标 + 名字 —— 与桌面端同一个形状(`AssistantIdentityHeader`)。 */}
				<AssistantIdentityHeader name={identityName} />
				<div className="mt-2 flex min-w-0 flex-col gap-2">
					{planned.blocks.map((block, index) =>
						block.type === "group" ? (
							<ToolGroupBlock key={`${block.group.id}-${index}`} group={block.group} />
						) : block.type === "reasoning" ? (
							<ReasoningBlock key={`reasoning-${index}`} text={block.text} />
						) : block.type === "compaction" ? (
							<CompactionBlock key={`compaction-${index}`} compaction={block.compaction} />
						) : (
							<MessageMarkdown
								key={`text-${index}`}
								text={block.text}
								streaming={message.streaming === true}
							/>
						),
					)}
				</div>
				{/*
					底部操作行:复制 + 用量 + 重做 + 时间 —— 与桌面端同一个位置、同一套规则。
					两个"不显示"的理由各自独立:
					  · `showFooter` 为假 = 这一轮还没答完(摆着"复制"和用量会让人以为答完了);
					  · 没有看得见的正文 = 这条消息只是一段工具执行,没什么可复制的。
				*/}
				{/*
					实时状态挂在**消息底部**(与桌面端同一个位置):这条消息还没答完的时候,
					底下的操作行是收起来的(见 `assistantFooterVisibility`),这里就是它该站的地方。
				*/}
				{runStatus === undefined ? null : <RunStatusLine text={runStatus} />}
				{showFooter && (copyText.length > 0 || message.usage !== undefined) ? (
					<MessageFooter
						copyText={copyText}
						usage={message.usage}
						onLoadSessionUsage={onLoadSessionUsage}
						versions={message.versions}
						turnMessageId={turnId}
						at={message.at}
						// 重做与版本切换都按**这一轮的用户消息 id**走:没有它就不给按钮(点了必然被拒)。
						canRetry={isLatestTurn && turnId !== undefined}
						onRetryTurn={() => void onRetryTurn(turnId as string)}
						onSelectVersion={onSelectVersion}
					/>
				) : null}
			</div>
		</article>
	);
}

/**
 * 电脑现在在做什么(「正在执行命令」「正在分析工具结果」……)。
 *
 * **照抄桌面端的 `AssistantRunStatus`**:12px、`mt-3`、文字自己会"呼吸"(shimmer)。
 * 位置也一样 —— 在消息正文之后、操作行之前。
 */
function RunStatusLine({ text }: { readonly text: string }) {
	return (
		<div className="mt-3 min-h-5 text-[12px] leading-5">
			<p className="assistant-run-status-shimmer">{text}</p>
		</div>
	);
}

/** 深度思考:默认折叠成一行,点开看内容(桌面端也是低调的灰色小字)。 */
function ReasoningBlock({ text, streaming = false }: { readonly text: string; readonly streaming?: boolean }) {
	/**
	 * 「深度思考」块 —— 与桌面端的 `ThinkingBlock` 同一个样子:
	 * 图标 + 标题 + 会转的箭头 + **markdown 正文**(不是纯文本,思考里也会有列表与代码)。
	 *
	 * 默认收起(桌面端只在流式时默认展开),用户点过就以用户为准。
	 */
	const [open, setOpen] = useState(streaming);
	return (
		<section className="mt-4 min-w-0 border-b border-border pb-3">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-label="深度思考"
				title="深度思考"
				className="flex min-h-8 w-full items-center gap-2 text-left select-none"
			>
				<img src={deepThinkingIcon} alt="" aria-hidden className="h-4 w-4 shrink-0 dark:invert" />
				<span className="text-[12px] font-semibold text-[#5a6250] dark:text-[#c3cbb4]">深度思考</span>
				<ChevronDown
					aria-hidden
					className={`h-3.5 w-3.5 text-[#89957a] transition-transform duration-150 ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open ? (
				<div className="message-markdown-reasoning mt-2 text-[12px] leading-5 text-[#74746d] dark:text-muted-foreground">
					<MessageMarkdown streaming={streaming} text={text} />
				</div>
			) : null}
		</section>
	);
}

const CATEGORY_LABELS: Record<ToolCategory, string> = {
	read: "读取 {count}",
	edit: "编辑 {count}",
	command: "命令 {count}",
	research: "调研 {count}",
	extension: "扩展 {count}",
	other: "其他 {count}",
};

/**
 * 工具执行**分组**:几十次调用只占一个折叠块。
 *
 * 折叠默认值与桌面端一致:正文封闭过、且没有工具在跑 → 收起;否则展开;用户点过以用户为准。
 * **长输出只在展开时渲染** —— 这是这个分组存在的主要理由(不展开就不进 DOM)。
 */
function ToolGroupBlock({ group }: { readonly group: ToolGroup }) {
	const [override, setOverride] = useState<boolean | undefined>(undefined);
	const expanded = isGroupExpanded(group, override);
	const duration = groupDurationMs(group);
	const failed = group.errorCount > 0;
	const label = group.processing
		? `正在执行 ${group.toolCount} 项`
		: `已处理 ${group.toolCount} 项 · ${groupSummaryParts(group, CATEGORY_LABELS, "等其他 {count} 项")}`;

	return (
		// 与桌面端同一套:`divide-y border-y` 的细线,不是圆角卡片 —— 卡片会把"执行过程"从对话里割出去。
		<section className="mt-4 min-w-0 border-y border-border">
			<button
				type="button"
				onClick={() => setOverride(!expanded)}
				aria-expanded={expanded}
				className="flex min-h-[34px] w-full min-w-0 items-center gap-2 py-1.5 text-left select-none"
			>
				{failed ? (
					<AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#ad7956] dark:text-[#d6a16d]" />
				) : group.processing ? (
					<LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[#89957a] motion-reduce:animate-none dark:text-[#9aa88a]" />
				) : (
					<Check className="h-3.5 w-3.5 shrink-0 text-[#6c8542] dark:text-[#93a878]" />
				)}
				<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">{label}</span>
				{duration === undefined ? null : (
					<span className="shrink-0 font-mono text-[10px] text-[#aaa9a1] dark:text-muted-foreground">
						{formatDuration(duration)}
					</span>
				)}
				{expanded ? (
					<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				)}
			</button>
			{expanded ? (
				<div className="flex min-w-0 flex-col divide-y divide-border border-t border-border">
					{/* 按**本来的顺序**画:模型先想还是先动手,那个顺序本身是信息,不重排。 */}
					{group.items.map((item, index) =>
						item.kind === "reasoning" ? (
							// 组里的思考也是**同一个可折叠的块**,不是一段裸文本。
							<ReasoningBlock key={`reasoning-${index}`} text={item.text} />
						) : (
							<ToolRow key={item.tool.callId} tool={item.tool} />
						),
					)}
				</div>
			) : null}
		</section>
	);
}

/** 工具执行行:工具自己的图标(与桌面端同一张表) + 名字 + 命令 + 状态图标。 */
/** 工具行只用到这几个字段 —— 历史里的条目与实时活动都能喂给它。 */
function ToolRow({
	tool,
}: {
	readonly tool: {
		readonly name: string;
		readonly state?: "running" | "done" | "failed";
		readonly args?: string;
		readonly detail?: string;
	};
}) {
	const [outputOpen, setOutputOpen] = useState(false);
	return (
		// 桌面端的样子:**一行**里放下 图标 / 工具名 / 参数(命令) / 状态。
		// 状态**只用图标**:桌面端在窄屏(手机上)也是把"执行中/完成"那行字收起来的
		// (`.hidden ... sm:block`)—— 一行里塞四个元素,文字会把命令挤掉。含义放进 aria/title。
		<article className="min-w-0 py-2">
			<p className="flex min-h-[18px] min-w-0 items-center gap-2 text-[12px] font-medium text-foreground/90">
				{/* 两个图标与桌面端一一对应:**左边是"这是什么工具",右边是"它现在怎么样"。 */}
				<ToolIcon name={tool.name} />
				<span className="shrink-0">{tool.name}</span>
				{tool.args ? (
					// 太长就省略号(标题里带全文)。
					<span
						className="min-w-0 flex-1 truncate font-mono text-[11px] font-normal text-muted-foreground"
						title={tool.args}
					>
						{tool.args}
					</span>
				) : (
					<span className="min-w-0 flex-1" />
				)}
				<ToolStatusIcon state={tool.state} />
			</p>
			{/*
				输出**默认不展开**:桌面端也只给命令与完成状态,结果要另外去取。
				一屏几十次调用的输出会把整段对话淹掉,而多数时候用户只想知道"跑了什么、成了没有"。
			*/}
			{tool.detail ? (
				<div className="mt-1">
					<button
						type="button"
						aria-expanded={outputOpen}
						onClick={() => setOutputOpen((value) => !value)}
						className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
					>
						{outputOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
						{outputOpen ? "收起输出" : "查看输出"}
					</button>
					{/* 输出比正文再小一档:它是**给眼睛扫一眼**的,占屏幕的面积却最大(用户提的)。 */}
					{outputOpen ? (
						<pre className="message-code-scroll mt-1.5 max-h-64 max-w-full overflow-auto font-mono text-[10px] leading-[18px] whitespace-pre text-foreground/80">
							{tool.detail}
						</pre>
					) : null}
				</div>
			) : null}
		</article>
	);
}

/**
 * **新建会话页** —— 桌面端 WelcomeView 的手机版。
 *
 * 只留最要紧的两样:**做什么**(工作类型)+ **第一句话**。桌面端那一页还有目录、模型、权限、
 * 专家团……手机上摆不下,而且"先建一个空会话再慢慢配"本来就是电脑上的用法。
 * 不做的事也照实说:不能建的那类会禁用并给出原因(宁可不给,也不给一个点了会失败的)。
 */
function WelcomeView({
	entries,
	entryId,
	creating,
	onLoad,
	onSelect,
}: {
	readonly entries: readonly RemoteEntryOption[] | undefined;
	/** 选中的工作类型(由上层持有:底部那个输入框要用它来决定"发出去是新建还是继续对话")。 */
	readonly entryId: string | undefined;
	readonly creating: boolean;
	readonly onLoad: () => void;
	readonly onSelect: (entryId: string) => void;
}) {
	useEffect(() => onLoad(), [onLoad]);
	const available = entries?.filter((entry) => entry.available) ?? [];
	const selected = available.find((entry) => entry.id === entryId) ?? available[0];
	return (
		<div className="mx-auto flex w-full max-w-[720px] min-w-0 flex-col px-1 py-6">
			<div className="flex items-center gap-3">
				<img alt="" aria-hidden draggable={false} src={wordlessBrandIcon} className="h-9 w-9 shrink-0 rounded-[20%] object-cover ring-1 ring-black/10 dark:ring-white/15" />
				<div className="min-w-0">
					<p className="text-[15px] font-semibold text-foreground">今天想做什么?</p>
					<p className="text-[11px] text-muted-foreground">选一个工作类型,然后写下第一句话。</p>
				</div>
			</div>

			<div className="mt-5 space-y-1.5">
				{(entries ?? []).map((entry) => {
					const active = entry.id === selected?.id;
					return (
						<button
							key={entry.id}
							type="button"
							aria-pressed={active}
							disabled={!entry.available || creating}
							onClick={() => onSelect(entry.id)}
							className={`flex w-full min-w-0 items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
								active
									? "border-[#a8bd69] bg-[#f3f6e8] dark:border-[#9fba55] dark:bg-[#303c1f]"
									: "border-border bg-card enabled:hover:bg-muted"
							} disabled:opacity-60`}
						>
							<AgentEntryIcon iconKey={entry.iconKey} className="mt-0.5 h-4 w-4" />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-[13px] font-medium text-foreground">{entry.name}</span>
								{entry.description === undefined ? null : (
									<span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{entry.description}</span>
								)}
								{/* 不能建时**照实说原因**,而不是让用户点一下才知道。 */}
								{entry.note === undefined ? null : (
									<span className="mt-0.5 block text-[11px] leading-4 text-[#ad7956] dark:text-[#d6a16d]">{entry.note}</span>
								)}
							</span>
						</button>
					);
				})}
				{entries === undefined ? <p className="py-6 text-center text-[12px] text-muted-foreground">正在读取可用的工作类型…</p> : null}
			</div>

			{/*
				这里**不再自带输入框**:底部已经有一个,而且它更完整(模型、权限、附件都在那儿)。
				摆两个输入框只会让人犹豫"该在哪个里打字"。
			*/}
			<p className="mt-4 text-[11px] text-muted-foreground">
				{selected === undefined
					? "选一个工作类型,然后在下面写下第一句话。"
					: `选好了「${selected.name}」—— 在下面写下第一句话就开始。`}
			</p>
		</div>
	);
}

/**
 * 压缩上下文那一行。
 *
 * 与桌面端**同一条信息**:为什么压(手动/自动/超上限)、压缩前后多少 token、用的哪个模型、摘要正文。
 * 少任何一条都会让用户以为"我的上下文丢了" —— 所以不省。
 */
function CompactionBlock({ compaction }: { readonly compaction: RemoteCompactionBlock }) {
	const reason =
		compaction.trigger === "manual"
			? "已压缩上下文"
			: compaction.trigger === "automatic"
				? "上下文接近上限,已自动压缩"
				: "上下文超出上限,已压缩";
	return (
		<div className="my-1 w-full min-w-0 overflow-hidden rounded-[10px] border border-[#dfe3d5] bg-[#f7f8f3] px-3 py-2.5 dark:border-border dark:bg-muted">
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-medium text-[#5d694d] dark:text-[#c1cfb2]">
				<span>{reason}</span>
				{compaction.tokensAfter > 0 ? (
					<span className="text-[11px] font-normal tabular-nums opacity-80">
						{formatTokens(compaction.tokensBefore)} → {formatTokens(compaction.tokensAfter)} tokens
					</span>
				) : null}
				{compaction.modelId === undefined ? null : (
					<span className="text-[11px] font-normal opacity-70" title={compaction.modelId}>
						{compaction.modelId}
					</span>
				)}
			</div>
			{compaction.summary.trim().length === 0 ? null : (
				<div className="mt-1.5 min-w-0 overflow-hidden text-[12px] leading-5 text-[#5d694d] dark:text-[#c1cfb2]">
					<MessageMarkdown text={compaction.summary} />
				</div>
			)}
		</div>
	);
}

/**
 * 助手消息的第一行:品牌图标 + 名字。
 *
 * 与桌面端的 `AssistantIdentityHeader` 同一个形状(尺寸、圆角、描边、字号都一样):
 * 桌面端那里在有专家团时显示牵头专家的头像与名字,没有时显示品牌图标 + `assistantName`。
 * 远端拿不到专家头像(协议里没有头像,只有名字),所以这里固定用品牌图标,名字仍按同一条规则取。
 */
function AssistantIdentityHeader({ name }: { readonly name?: string }) {
	// `data-assistant-identity`:渲染测试用它数"这一页有几条助手身份行"(压缩那一行不该有)。
	return (
		<header data-assistant-identity className="flex h-7 items-center gap-3">
			<img
				alt=""
				aria-hidden
				draggable={false}
				src={wordlessBrandIcon}
				className="h-7 w-7 shrink-0 rounded-[20%] object-cover ring-1 ring-black/10 dark:ring-white/15"
			/>
			<span className="text-[14px] font-semibold">{name ?? "Wordless"}</span>
		</header>
	);
}

/**
 * 工具状态图标 —— **与桌面端同一套**:
 * 在跑 = 转圈,完成 = 对勾,失败 = 感叹号圆(不只靠颜色区分,色盲用户也分得清)。
 */
function ToolStatusIcon({ state }: { readonly state?: "running" | "done" | "failed" }) {
	const label = state === "failed" ? "执行失败" : state === undefined || state === "running" ? "执行中" : "已完成";
	const icon =
		state === "failed" ? (
			<CircleAlert className="h-3.5 w-3.5 shrink-0 text-[#ad7956] dark:text-[#d6a16d]" />
		) : state === undefined || state === "running" ? (
			<LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[#89957a] motion-reduce:animate-none dark:text-[#9aa88a]" />
		) : (
			<Check className="h-3.5 w-3.5 shrink-0 text-[#6c8542] dark:text-[#93a878]" />
		);
	// 文字收起来了,含义就不能也收起来 —— 读屏与长按都要读得出来(桌面端也是这么做的)。
	return (
		<span aria-label={label} className="shrink-0" role="img" title={label}>
			{icon}
		</span>
	);
}

/** 工具图标:自绘 SVG 用 `<img>`(深色下需要反色),lucide 那种直接用组件。 */
function ToolIcon({ name }: { readonly name: string }) {
	const source = toolIcon(toolIconName(name));
	if (source.kind === "component") {
		const Icon = source.Icon;
		return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
	}
	return (
		<img
			src={source.src}
			alt=""
			aria-hidden
			className={`h-3.5 w-3.5 shrink-0 ${source.invertOnDark ? "dark:invert" : ""}`}
		/>
	);
}


function phaseLabel(phase: RemoteClientState["phase"]): string {
	switch (phase) {
		case "online":
			return "已连接";
		case "connecting":
		case "pairing":
			return "连接中";
		case "offline":
			return "重连中";
		case "error":
			return "出错";
		default:
			return "未连接";
	}
}

function relativeTime(at: number): string {
	const diff = Date.now() - at;
	if (diff < 60_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
	return `${Math.floor(diff / 86_400_000)} 天前`;
}
