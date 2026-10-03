import type { SentState } from "./composer";
import type {
	RemoteContextUsage,
	RemoteMessageBlock,
	RemoteModelOption,
	RemoteSessionMessage,
	RemoteSessionSummary,
} from "@wordless/remote-control";

/**
 * 网页端的两个纯逻辑:**消息合并**与**会话分区**。
 *
 * 抽出来是因为它们各自对应一个真实抱怨:
 * - 不合并连续助手消息,每个分片都会单独成一个气泡 —— 看起来像"每段文字底下挂一个复制按钮";
 * - 会话列表不分区,所有会话堆在一起,手机上根本找不到"我刚在用的那个"。
 *
 * 纯函数,所以可以用 `node --test` 直接测(不依赖 React 与浏览器)。
 */

/**
 * 把新到的消息并入消息列表。
 *
 * 与上一条**同角色且连续**时合并成一条:运行时会把一轮助手输出拆成多条消息(正文/工具/正文),
 * 不合并的话每一片都会单独成一个气泡。
 */
/** 消息上"这一端"的标记:发送状态 + 是否还在流式接收。 */
export type LocalMessageFlags = SentState & {
	readonly streaming?: boolean;
	readonly streamId?: string;
	/**
	 * 正在流的那一块**在哪个位置、是什么类型**。
	 *
	 * 为什么非要记它:本机是**一段一段**发完成帧的(说完一段 → 调工具 → 再说一段),而这一端
	 * 把一轮的段都放进同一条消息里。完成帧到达时要替换的是"这一段流出来的草稿"——
	 * 以前是"只要这一帧带正文,就把**所有**非工具块都丢掉",于是更早那几段的正文被吞掉,
	 * 而"一段正文封闭一个工具突发"这条规则也就失去了依据:本该切开的两组工具挨到了一起(真实抱怨)。
	 */
	readonly streamBlock?: { readonly kind: "text" | "reasoning"; readonly index: number };
};

/**
 * 流式帧。
 *
 * **一条助手消息 = 一整轮**(与桌面端的数据模型一致):模型一轮里可能说一段、跑几个工具、再说一段,
 * 桌面端把这些合进同一条消息,所以底部操作行**一轮只有一个**。
 * 这里也照做:流式只是往"当前这一段正文"里追加/替换,不新开消息。
 *
 * 载荷是**累积文本**(不是增量):增量丢一帧,远端拼出来的句子就永远缺一块,而它无从察觉。
 */
export function applyStream(
	messages: readonly (RemoteSessionMessage & LocalMessageFlags)[],
	delta: {
		readonly messageId: string;
		readonly role: "user" | "assistant";
		/** 正文还是思考。思考也要能流式长出来 —— 以前只能等整段写完。 */
		readonly kind?: "text" | "reasoning";
		readonly turnId?: string;
		readonly text: string;
	},
): readonly (RemoteSessionMessage & LocalMessageFlags)[] {
	if (delta.text.length === 0) return messages;
	const kind = delta.kind === "reasoning" ? ("reasoning" as const) : ("text" as const);

	const streamingIndex = messages.findIndex((message) => message.streamId === delta.messageId);
	if (streamingIndex >= 0) return withStreamedSegment(messages, streamingIndex, delta.messageId, delta.text, kind);

	// 这一轮还没说完:把新的一段接在**这一轮**的助手消息里(不是"最后一条消息" —— 那可能属于别的轮)。
	const currentIndex = assistantIndexForTurn(messages, delta.turnId);
	const current = currentIndex < 0 ? undefined : messages[currentIndex];
	if (currentIndex >= 0 && current?.role === "assistant" && current.streaming !== true) {
		return withStreamedSegment(messages, currentIndex, delta.messageId, delta.text, kind);
	}
	return [
		...messages,
		{
			role: delta.role,
			...(delta.turnId === undefined ? {} : { turnId: delta.turnId }),
			// 思考帧不占正文:正文留给后面真的开始写的时候。
			text: kind === "text" ? delta.text : "",
			at: Date.now(),
			streamId: delta.messageId,
			streaming: true,
			blocks: [{ type: kind, text: delta.text }],
			// 新开的一条也要记下"正在流的是哪一块"(见 `LocalMessageFlags.streamBlock`)。
			streamBlock: { kind, index: 0 },
		},
	];
}

/**
 * **这一轮的助手消息**:最后一条用户消息**之后**的那条助手消息;没有就返回 `-1`。
 *
 * 桌面端是按**轮**存消息的(store 里每一轮一个 key),网页端的消息是一条平铺的列表 ——
 * 所以"当前这一轮"必须自己划出来。少了这条规则,"最后一条消息"在两种时序下都会指错轮:
 * 上一轮的回答末尾(新的用户消息还没到)和刚发出去的下一轮 —— 于是内容会被写进**别的轮**
 * (真实抱怨:"上一轮的 tool group 溢出到下一轮")。
 */
export function currentTurnAssistantIndex(
	messages: readonly (RemoteSessionMessage & LocalMessageFlags)[],
): number {
	for (let position = messages.length - 1; position >= 0; position -= 1) {
		const candidate = messages[position];
		if (!candidate) continue;
		if (candidate.role === "user") return -1;
		if (candidate.role === "assistant") return position;
	}
	return -1;
}

/**
 * 这一轮对应的**用户消息 id** —— 重做与版本切换都以它为准。
 *
 * 运行时的两个接口都是这么定义的(`retrySessionTurn` 会校验"只能重做用户消息",
 * `selectSessionTurnVersion` 也是按这一轮的用户消息 id 查版本)。网页端以前把**助手消息**的 id
 * 传过去 —— 于是本机一律拒绝,界面看起来就像"这个按钮没接上"(真实抱怨)。
 *
 * 取法:从这条助手消息往回找最近的一条**用户**消息,用它的 id。
 * 没有 id(这一端自己画的乐观消息、或还没落位的)就不给按钮 —— 宁可不给,也不给一个点了会失败的。
 */
export function turnUserMessageId(
	messages: readonly (RemoteSessionMessage & LocalMessageFlags)[],
	assistantIndex: number,
): string | undefined {
	for (let position = assistantIndex - 1; position >= 0; position -= 1) {
		const candidate = messages[position];
		if (candidate?.role !== "user") continue;
		return candidate.id;
	}
	return undefined;
}

/**
 * 这一轮要写进哪条助手消息 —— **优先按 turn id 找**,找不到再退回"顺序"那一条规则。
 *
 * 有 turn id 时不存在猜:本机把每一轮的 id 一起发过来,与桌面端 store 里"每一轮一个 key"是同一个模型。
 * 没有它(旧版本的本机、或历史消息)才退回 `currentTurnAssistantIndex` —— 那条规则在
 * "下一轮的用户消息还没到"这种时序下会指错轮,所以只能当兜底。
 */
function assistantIndexForTurn(
	messages: readonly (RemoteSessionMessage & LocalMessageFlags)[],
	turnId: string | undefined,
): number {
	if (turnId !== undefined) {
		for (let position = messages.length - 1; position >= 0; position -= 1) {
			const candidate = messages[position];
			if (candidate?.role === "assistant" && candidate.turnId === turnId) return position;
		}
		/**
		 * 没有认领过的**无 turn id** 助手消息:那是这一端自己画的那条。
		 *
		 * 时序是:工具/流式先到(那时还不知道这一轮的 id) → 完成帧后到(它带 id)。
		 * 认领它是安全的 —— 它按"最后一条用户消息之后"建的,本来就是这一轮的;
		 * **不认领**就会在同一轮里画出两条助手消息,于是出现两个「品牌图标 + Wordless」(真实抱怨)。
		 * 而带 id 的别的轮次的那些**不碰**:宁可新开一条,也不把内容写进别的轮。
		 */
		const unclaimed = currentTurnAssistantIndex(messages);
		if (unclaimed >= 0 && messages[unclaimed]?.turnId === undefined) return unclaimed;
		return -1;
	}
	return currentTurnAssistantIndex(messages);
}

/**
 * **实时工具事件 → 消息里的一个工具块**。
 *
 * 这是与桌面端对齐的关键一步:桌面端那边,实时工具事件就是写进消息的块里(存储层同一个模型),
 * 所以"这一行属于哪一组、折叠没有、什么状态"全部由**同一份数据**算出来。
 * 网页端以前把它们放在另一个列表(`state.tools`)里,于是同一批工具会有**两份**:
 * 消息里的那份(来自完成帧)与实时那份(来自事件)—— 一份说完成、一份还在转圈,
 * 而且实时那份排在消息外面(看起来"溢出到操作行底下")。两个都是真实抱怨。
 *
 * 认领规则:**最后一条用户消息之后的那条助手消息**(就是这一轮);还没有就**新建一条** ——
 * 工具调用属于这一轮,不能写进上一轮的回答里。
 */
export function upsertLiveTool(
	messages: readonly (RemoteSessionMessage & LocalMessageFlags)[],
	tool: {
		readonly callId: string;
		/** 这一次调用属于哪一轮(见 `assistantIndexForTurn`)。 */
		readonly turnId?: string;
		/**
		 * 工具名。**可能没有** —— 运行时的更新/完成帧只带 `callId`(名字在"开始"那一帧里)。
		 * 那种帧照样要能更新到那一块上,否则界面上的"执行中"永远不结束(真实抱怨)。
		 */
		readonly name?: string;
		readonly state?: "running" | "done" | "failed";
		readonly args?: string;
		readonly detail?: string;
	},
): readonly (RemoteSessionMessage & LocalMessageFlags)[] {
	const block: RemoteMessageBlock = {
		type: "tool",
		callId: tool.callId,
		// 没有名字时先占位,落到已存在的那一块上时会被它自己的名字盖掉(见下面的合并)。
		name: tool.name ?? "",
		state: tool.state ?? "running",
		...(tool.args === undefined ? {} : { args: tool.args }),
		...(tool.detail === undefined ? {} : { detail: tool.detail }),
	};
	const index = assistantIndexForTurn(messages, tool.turnId);
	if (index < 0) {
		// 助手还没出声,但工具已经在跑了:先立一条(它属于这一轮)。
		// 没有名字就**不立**:摆一行没有名字的工具比不摆更糟。
		if (tool.name === undefined) return messages;
		return [
			...messages,
			{
				role: "assistant",
				...(tool.turnId === undefined ? {} : { turnId: tool.turnId }),
				text: "",
				at: Date.now(),
				streaming: true,
				blocks: [block],
			},
		];
	}
	const message = messages[index] as RemoteSessionMessage & LocalMessageFlags;
	const blocks = [...(message.blocks ?? [])];
	const existing = blocks.findIndex((candidate) => candidate.type === "tool" && candidate.callId === tool.callId);
	if (existing >= 0) {
		const previous = blocks[existing] as Extract<RemoteMessageBlock, { type: "tool" }>;
		// 名字以**已有的那个**为准(新帧没有名字时不能把名字抹成空)。
		blocks[existing] = { ...previous, ...block, name: tool.name ?? previous.name };
	} else {
		// 认不出是哪一次调用、又没有名字:不新建一行。
		if (tool.name === undefined) return messages;
		blocks.push(block);
	}
	return messages.map((candidate, position) => (position === index ? { ...candidate, blocks } : candidate));
}

/**
 * 合并两边的块 —— 本机是**一段一段**发完成帧的,而这一端把一轮的段都放在同一条消息里。
 *
 * 三条规则,合起来刚好覆盖真实的三种情况:
 *
 * 1. **工具块按 `callId` 覆盖**:同一个调用以新帧为准(状态、输出都更权威);
 * 2. **新帧带了正文时,上一段流式正文由它替换**:它们是**同一段**(流式是草稿、完成帧是定稿);
 * 3. **新帧没带正文时,上一段的正文留着**:那说明这一帧是"只调工具的那一段"——
 *    抹掉它就回到"上一轮的回答展示不全"那个真实抱怨。
 *
 * 剩下的(更早的段留下的工具、正文)一律保留在**前面**,新帧的块按它自己的顺序接在后面。
 */
function mergeBlocks(
	previous: readonly RemoteMessageBlock[] | undefined,
	incoming: readonly RemoteMessageBlock[] | undefined,
	draft?: { readonly kind: "text" | "reasoning"; readonly index: number },
): RemoteMessageBlock[] | undefined {
	if (incoming === undefined) return previous === undefined ? undefined : [...previous];
	if (previous === undefined) return [...incoming];
	const incomingTools = new Set(
		incoming.flatMap((block) => (block.type === "tool" ? [block.callId] : [])),
	);
	/**
	 * **只丢掉那一段流出来的草稿**,别的一律留着。
	 *
	 * 这一帧是"这一段"的定稿:它替换的是这一段流出来的草稿(同类型),而不是整条消息里的正文。
	 * 更早几段的正文必须留下 —— 它既是要显示的内容,**也是"一段正文封闭一个工具突发"的依据**:
	 * 丢掉它,本该切开的两组工具就挨到了一起,看起来像"没分割"(真实抱怨)。
	 */
	const draftIndex = (() => {
		if (draft !== undefined) return incoming.some((block) => block.type === draft.kind) ? draft.index : -1;
		// 没有记号(理论上不会发生)时退回一个保守的判断:只丢**最后一块**同类型的草稿。
		const last = previous.length - 1;
		const tail = previous[last];
		if (tail !== undefined && (tail.type === "text" || tail.type === "reasoning")) {
			return incoming.some((block) => block.type === tail.type) ? last : -1;
		}
		return -1;
	})();
	const kept = previous.filter((block, index) => {
		if (index === draftIndex) return false;
		if (block.type === "tool") return !incomingTools.has(block.callId);
		return true;
	});
	return [...kept, ...incoming];
}


/**
 * 把"当前这一段"写进某条消息:没有这一段就追加一个块,有就替换它。
 *
 * 块类型跟着 `kind` 走:思考写进思考块,正文写进文本块 —— 两者交替出现时各写各的,
 * 而不是把思考拼进正文里(桌面端也是分开的)。
 */
function withStreamedSegment(
	messages: readonly (RemoteSessionMessage & LocalMessageFlags)[],
	index: number,
	messageId: string,
	text: string,
	kind: "text" | "reasoning",
): readonly (RemoteSessionMessage & LocalMessageFlags)[] {
	return messages.map((message, position) => {
		if (position !== index) return message;
		const blocks = [...(message.blocks ?? [])];
		const lastBlock = blocks[blocks.length - 1];
		if (lastBlock?.type === kind && message.streamId === messageId) {
			blocks[blocks.length - 1] = { type: kind, text };
		} else {
			blocks.push({ type: kind, text });
		}
		return {
			...message,
			streamId: messageId,
			streaming: true,
			blocks,
			// 记下"正在流的是哪一块":完成帧到达时只替换它(见 `LocalMessageFlags.streamBlock`)。
			streamBlock: { kind, index: blocks.length - 1 },
			...(kind === "text" ? { text } : {}),
		};
	});
}

export function mergeMessage(
	messages: readonly (RemoteSessionMessage & LocalMessageFlags)[],
	incoming: RemoteSessionMessage,
): readonly (RemoteSessionMessage & LocalMessageFlags)[] {
	/**
	 * 用户消息的**回显去重**。
	 *
	 * 本机也会把用户消息发回来(它要出现在所有设备的同一份历史里),而这一端在按下发送时
	 * 已经乐观地画了一条 —— 不去重就是两条一模一样的用户消息。
	 *
	 * 认的是"**这一端自己画的那一条**":它没有运行时的消息 id(`id === undefined`),
	 * 或者还挂着 `pending` / `failed`。以前只认 `pending`/`failed`,而真实时序是
	 * `session.prompt` 的响应**先**回来(把乐观那条标成已发出),回显**后**才到 ——
	 * 于是去重条件不成立,页面上就出现两条一样的用户消息,过一会儿才合成一条(真实抱怨)。
	 */
	if (incoming.role === "user") {
		const from = Math.max(0, messages.length - 5);
		/** 这一端自己画的:没有运行时 id,或者还挂着发送状态。 */
		const locallyDrawn = (candidate: RemoteSessionMessage & LocalMessageFlags) =>
			candidate.id === undefined || candidate.pending === true || candidate.failed === true;
		// 先找文本完全相同的;没有再退一步认"前缀相同"(带附件时本机会把附件说明**接在**正文后面)。
		for (const match of ["exact", "prefix"] as const) {
			for (let index = messages.length - 1; index >= from; index -= 1) {
				const candidate = messages[index] as (RemoteSessionMessage & LocalMessageFlags) | undefined;
				if (!candidate || candidate.role !== "user") continue;
				if (!locallyDrawn(candidate)) continue;
				const same =
					match === "exact"
						? candidate.text === incoming.text
						: candidate.text.length > 0 && incoming.text.startsWith(candidate.text);
				if (!same) continue;
				// 用本机那份(它带 blocks、时间更准),但保留这一端已经落位的状态。
				return messages.map((message, position) =>
					position === index ? { ...incoming, pending: false, failed: false } : message,
				);
			}
		}
	}
	/**
	 * **同一条运行时消息只画一次**。
	 *
	 * 本机可能把它再送一遍(重连后补发、事件重放)。没有这一道,页面上就会出现两条一模一样的消息,
	 * 而它们谁也去不掉谁 —— 与"回显去重"是同一类问题的另一半。
	 */
	if (incoming.id !== undefined) {
		const duplicate = messages.findIndex((message) => message.id === incoming.id);
		if (duplicate >= 0) {
			return messages.map((message, position) => (position === duplicate ? { ...message, ...incoming } : message));
		}
	}
	// 完成帧认领它自己那一段流式文本(靠消息 id 对上):换成最终内容,而不是再拼一遍。
	if (incoming.role === "assistant" && incoming.id !== undefined) {
		const owner = messages.findIndex((message) => message.streamId === incoming.id);
		if (owner >= 0) {
			return messages.map((message, position) =>
				position === owner
					? {
							...message,
							/**
							 * 完成帧**没有正文**时(只调工具的那一段)不能把已经流出来的正文抹掉 ——
							 * 抹掉就是"上一轮的回答展示不全"那个真实抱怨:文本流到一半,收尾帧一到,它没了。
							 * 块同理:流出来的那段正文是块里的文本块,直接换成完成帧的块会让它一起消失。
							 */
							text: incoming.text.length > 0 ? incoming.text : message.text,
							streamId: undefined,
							streaming: false,
							...(() => {
								const blocks = mergeBlocks(message.blocks, incoming.blocks, message.streamBlock);
								return blocks === undefined ? {} : { blocks };
							})(),
							...(incoming.usage === undefined ? {} : { usage: incoming.usage }),
						}
					: message,
			);
		}
	}
	const turnIndex = assistantIndexForTurn(messages, incoming.turnId);
	const last = (turnIndex < 0 ? undefined : messages[turnIndex]) as
		| (RemoteSessionMessage & LocalMessageFlags)
		| undefined;
	// 还在流的那一条:完成时替换它,而不是把最终文本再拼一遍(拼了就是两份)。
	if (last?.streaming === true && incoming.role === "assistant") {
		const keepStreamedText = incoming.text.length === 0 && last.text.length > 0;
		const blocks = mergeBlocks(last.blocks, incoming.blocks, last.streamBlock);
		return messages.map((message, position) =>
			position === turnIndex
				? {
						...incoming,
						...(keepStreamedText ? { text: last.text } : {}),
						...(blocks === undefined ? {} : { blocks }),
					}
				: message,
		);
	}
	// 用户消息的回显可能比这一轮的助手内容**后**到(工具先跑起来了)。插到它自己那一轮之前,
	// 而不是无条件追加 —— 否则顺序会变成"助手的回答在用户的话上面"。
	if (incoming.role === "user" && incoming.id !== undefined) {
		const owner = messages.findIndex((message) => message.role === "assistant" && message.turnId === `turn:${incoming.id}`);
		if (owner >= 0) return [...messages.slice(0, owner), incoming, ...messages.slice(owner)];
	}
	if (!last || last.role !== incoming.role || last.role !== "assistant") return [...messages, incoming];
	const blocks = [...(last.blocks ?? []), ...(incoming.blocks ?? [])];
	return messages.map((message, position) =>
		position === turnIndex
			? {
					...last,
					text: [last.text, incoming.text].filter((part) => part.length > 0).join(""),
					...(blocks.length === 0 ? {} : { blocks }),
				}
			: message,
	);
}

export interface SessionGroup {
	readonly key: string;
	readonly label: string;
	readonly sessions: readonly RemoteSessionSummary[];
}

/**
 * 会话列表分区:**最近**在前,**按空间**在后。
 *
 * 与桌面端同一个意图:用户大部分时间在最近几个会话里,剩下按项目找。
 * 没有空间归属的会话单独归到「其他会话」,而不是硬塞进某个空间。
 */
export function groupSessions(
	sessions: readonly RemoteSessionSummary[],
	recentLimit = 5,
): readonly SessionGroup[] {
	if (sessions.length === 0) return [];
	const sorted = [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
	const recent = sorted.slice(0, recentLimit);
	const recentIds = new Set(recent.map((session) => session.id));
	const rest = sorted.filter((session) => !recentIds.has(session.id));

	const byWorkspace = new Map<string, { label: string; sessions: RemoteSessionSummary[] }>();
	for (const session of rest) {
		const key = session.workspaceId ?? "";
		const label = session.workspaceName ?? "其他会话";
		const bucket = byWorkspace.get(key) ?? { label, sessions: [] };
		bucket.sessions.push(session);
		byWorkspace.set(key, bucket);
	}

	return [
		{ key: "recent", label: "最近", sessions: recent },
		...[...byWorkspace.entries()]
			.sort(([, left], [, right]) => left.label.localeCompare(right.label))
			.map(([key, bucket]) => ({ key: `workspace-${key}`, label: bucket.label, sessions: bucket.sessions })),
	];
}

export interface SessionChip {
	readonly key: string;
	readonly label: string;
	/** 机器文本(模型名)用等宽显示。 */
	readonly mono: boolean;
}

const ACCESS_LABELS: Record<string, string> = {
	default: "默认权限",
	full: "完全访问",
};

const APPROVAL_LABELS: Record<string, string> = {
	manual: "手动确认",
	auto: "自动执行",
	bypass: "跳过确认",
};

/**
 * 输入区上方那行**只读**信息:当前模型、权限、连接器数量。
 *
 * 这一批的意义是"在手机上看得见自己正在用什么"。**没有交互**是刻意的 ——
 * 让远端能改权限等于"手机可以放宽本机执行 shell 的限制",那是安全边界,要单独设计
 * (见 `docs/architecture/remote-web-client.md` 的分档表)。
 */
export function sessionChips(session: RemoteSessionSummary | undefined): readonly SessionChip[] {
	if (!session) return [];
	const chips: SessionChip[] = [];
	if (session.modelId) chips.push({ key: "model", label: session.modelId, mono: true });
	const access = session.accessLevel === undefined ? undefined : ACCESS_LABELS[session.accessLevel];
	if (access) chips.push({ key: "access", label: access, mono: false });
	const approval = session.toolApprovalMode === undefined ? undefined : APPROVAL_LABELS[session.toolApprovalMode];
	if (approval) chips.push({ key: "approval", label: approval, mono: false });
	if ((session.connectorCount ?? 0) > 0) {
		chips.push({ key: "connectors", label: `${session.connectorCount} 个连接器`, mono: false });
	}
	return chips;
}

/**
 * 把一条会话摘要合进列表。
 *
 * 换模型之后本机会回一条**新的**摘要(而不是让界面自己猜),两个来源都走这里:
 * 请求的返回值(立刻更新)与列表事件(其他设备/桌面端改了之后)。
 * 列表里还没有它时直接补上 —— 否则"从通知点进来"的会话会缺一条。
 */
export function mergeSessionSummary(
	sessions: readonly RemoteSessionSummary[],
	summary: RemoteSessionSummary,
): readonly RemoteSessionSummary[] {
	const existing = sessions.findIndex((session) => session.id === summary.id);
	if (existing === -1) return [summary, ...sessions];
	return sessions.map((session, index) => (index === existing ? summary : session));
}

/**
 * 思考等级的**中文标签** —— 与桌面端同一套说法(`i18n.ts` 的 `thinkingLevel_*`)。
 *
 * 值域来自协议(`RemoteThinkingLevel`),标签在这里;两者都是"值",改一个要改另一个。
 */
export const THINKING_LEVEL_LABELS: Record<string, string> = {
	off: "关闭",
	minimal: "极低",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "极高",
	max: "最大",
};

export interface ThinkingChoice {
	readonly level: string;
	readonly label: string;
	/** 现在就是这一档。 */
	readonly current: boolean;
}

/**
 * 这个模型能选哪些思考档位。
 *
 * **只列它支持的** —— 与桌面端一致,也是"宁可不给,也不给一个点了会失败的选项":
 * 运行时收到不支持的档位会直接抛(`setSessionModel` 里那句 "does not support this thinking depth")。
 * 不支持思考的模型返回空数组:界面上就**不摆**这个控件,而不是摆一个全是灰的。
 */
export function thinkingChoices(
	model: { readonly supportsReasoning?: boolean; readonly supportedThinkingLevels?: readonly string[] } | undefined,
	current: string | undefined,
): readonly ThinkingChoice[] {
	if (model?.supportsReasoning === false) return [];
	const levels = model?.supportedThinkingLevels ?? [];
	return levels
		.filter((level) => THINKING_LEVEL_LABELS[level] !== undefined)
		.map((level) => ({ level, label: THINKING_LEVEL_LABELS[level] as string, current: level === current }));
}

export interface ModelChoice {
	readonly connectionId: string;
	readonly modelId: string;
	readonly displayName: string;
	/** 供应商身份:只用来挑图标(与桌面端同一个 `ProviderIcon`)。 */
	readonly providerId?: string;
	readonly avatarId?: string;
	/** 这个模型支持哪些思考档位(空 = 不摆那个控件)。 */
	readonly thinking: readonly ThinkingChoice[];
	/** 就是当前这个模型。 */
	readonly current: boolean;
}

export interface ModelChoiceGroup {
	readonly key: string;
	/** 供应商的名字;没有名字时退回连接 id(不编造)。 */
	readonly label: string;
	/** 这一组的图标(组里每条都挂在同一个连接上,所以取第一条的就行)。 */
	readonly providerId?: string;
	readonly avatarId?: string;
	readonly choices: readonly ModelChoice[];
}

/**
 * 清单里"现在用的是哪一个"。
 *
 * 认它必须**同时**看 connectionId 与 modelId:不同供应商可以有同名的模型,
 * 只按 modelId 认会把别人的模型标成"当前"。
 */
export function currentModelChoice(groups: readonly ModelChoiceGroup[]): ModelChoice | undefined {
	for (const group of groups) {
		const found = group.choices.find((choice) => choice.current);
		if (found !== undefined) return found;
	}
	return undefined;
}

/**
 * 把可选模型按供应商分组,并标出当前那个。
 *
 * 分组的键用 connectionId(唯一),标签优先用供应商的人类名字。
 * 排序沿用本机给的顺序 —— 本机已经按"供应商 + 名字"排好了,远端再排一次只会让两端不一样。
 */
export function modelGroups(
	models: readonly RemoteModelOption[] | undefined,
	current:
		| { readonly connectionId?: string; readonly modelId?: string; readonly thinkingLevel?: string }
		| undefined,
): readonly ModelChoiceGroup[] {
	if (!models || models.length === 0) return [];
	const groups = new Map<string, ModelChoiceGroup>();
	for (const model of models) {
		const current_ =
			model.connectionId === current?.connectionId && model.modelId === current?.modelId;
		const choice: ModelChoice = {
			connectionId: model.connectionId,
			modelId: model.modelId,
			displayName: model.displayName,
			...(model.providerId === undefined ? {} : { providerId: model.providerId }),
			...(model.avatarId === undefined ? {} : { avatarId: model.avatarId }),
			thinking: thinkingChoices(model, current?.thinkingLevel),
			current: current_,
		};
		const existing = groups.get(model.connectionId);
		if (existing) {
			groups.set(model.connectionId, { ...existing, choices: [...existing.choices, choice] });
			continue;
		}
		groups.set(model.connectionId, {
			key: model.connectionId,
			label: model.providerName ?? model.connectionId,
			...(model.providerId === undefined ? {} : { providerId: model.providerId }),
			...(model.avatarId === undefined ? {} : { avatarId: model.avatarId }),
			choices: [choice],
		});
	}
	return [...groups.values()];
}

/**
 * 把更早的一页拼到前面。
 *
 * 按时间去重排序,而不是直接拼接 —— 分页边界上同一条消息可能既在旧页又在新页,
 * 拼重了会出现"同一段话连着两份"。
 */
export function mergeEarlier(
	current: readonly RemoteSessionMessage[],
	older: readonly RemoteSessionMessage[],
): readonly RemoteSessionMessage[] {
	const seen = new Set<string>();
	const merged: RemoteSessionMessage[] = [];
	for (const message of [...older, ...current]) {
		const key = `${message.role}:${message.at}:${message.text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(message);
	}
	return merged.sort((left, right) => left.at - right.at);
}

/**
 * 用量的百分比。
 *
 * 与桌面端**同一条规则**(`Math.min(100, used / window * 100)`),不是"差不多":
 * 两端对同一个会话显示的数字必须一样,否则用户会以为哪边算错了。
 * 窗口为 0 时返回 0 而不是 `Infinity`。
 */
export function contextPercent(usage: RemoteContextUsage | undefined): number {
	if (!usage || usage.contextWindow <= 0) return 0;
	return Math.min(100, (usage.usedTokens / usage.contextWindow) * 100);
}

/** 千位缩写:`24k`、`1.2M` —— 手机上横向空间最紧张。 */
export function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
	return String(tokens);
}

export interface ContextBreakdownRow {
	readonly key: string;
	readonly label: string;
	/** 与桌面端同一套颜色。 */
	readonly color: string;
	readonly tokens: number;
	readonly percent: number;
}

/** 分类明细的标签与颜色**照抄桌面端** —— 两端对同一份数据必须给出同一个说法。 */
const CONTEXT_CATEGORIES = [
	{ key: "systemPrompt", label: "系统提示词", color: "#20b896" },
	{ key: "toolsAndSubagents", label: "工具及子智能体", color: "#e8b45d" },
	{ key: "conversation", label: "对话消息", color: "#8a5cf4" },
	{ key: "connectors", label: "连接器及 MCP", color: "#36bdd0" },
	{ key: "skills", label: "技能", color: "#547ee8" },
] as const;

export function contextBreakdown(usage: RemoteContextUsage | undefined): readonly ContextBreakdownRow[] {
	if (!usage?.categories || usage.contextWindow <= 0) return [];
	const categories = usage.categories;
	return CONTEXT_CATEGORIES.map((category) => {
		const tokens = categories[category.key];
		return {
			key: category.key,
			label: category.label,
			color: category.color,
			tokens,
			percent: Math.min(100, (tokens / usage.contextWindow) * 100),
		};
	});
}

/**
 * 把一条 `session.state` 载荷合进列表。
 *
 * **只覆盖载荷里真的有的字段**:用量事件不带 `running`,如果写成 `running: payload.running ?? false`,
 * 那么"只更新用量"会顺手把会话标成"没在跑",用户看到状态闪一下。
 */
export function mergeSessionState(
	sessions: readonly RemoteSessionSummary[],
	sessionId: string,
	payload: { readonly running?: boolean; readonly context?: RemoteContextUsage },
): readonly RemoteSessionSummary[] {
	return sessions.map((session) => {
		if (session.id !== sessionId) return session;
		return {
			...session,
			...(payload.running === undefined ? {} : { running: payload.running }),
			...(payload.context === undefined ? {} : { context: payload.context }),
		};
	});
}

/**
 * 助手回复底部操作行的可见性 —— **与桌面端同一套规则**(`assistant-message-footer.ts`)。
 *
 * 四种情况不显示:还没有消息 / 这一行就是正在生成的那一轮 / 还有消息在流 / 有待处理的交互。
 * 这不是洁癖:一条正在跑的回复底下摆着"复制"与用量,用户会以为它已经答完了。
 */
export function assistantFooterVisibility(input: {
	readonly hasPendingInteraction: boolean;
	readonly isStreaming: boolean;
	readonly isTurnRunning: boolean;
	readonly messageCount: number;
}): boolean {
	if (input.messageCount === 0) return false;
	if (input.isTurnRunning) return false;
	if (input.isStreaming) return false;
	if (input.hasPendingInteraction) return false;
	return true;
}
