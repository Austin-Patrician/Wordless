import type { RemoteMessageBlock, RemoteSessionMessage } from "@wordless/remote-control";
import type { RemoteCompactionBlock, RemoteMessage } from "./remote-client";

/**
 * 工具执行的分组与折叠规则 —— **移植自桌面端**(`features/thread/tool-activity-groups.ts`
 * 与 `ToolActivityGroup.tsx` 的折叠 hook),只去掉远端用不到的两类:研究委派与工件。
 *
 * 规则(桌面端用测试钉住过,这里照抄):
 *
 * 1. **相邻的工具块合并成一个突发(burst)** —— 一次任务里几十次工具调用只占一个折叠块;
 * 2. **一段非空正文封闭它**:用户读到文字时,上面的工具执行已经"讲完了",默认收起来;
 * 3. **只用思考不拆开**:工具之间夹着思考仍然算同一个突发;
 * 4. **出错或中断也封闭**(不然它永远转圈,看起来像"还卡着");
 * 5. 聚合出 `processing` / `errorCount` / `toolCount` / 分类计数供头部显示;
 * 6. 折叠默认值:**没有正文封闭且还有工具在跑时展开**;正文封闭它就默认收起;用户点过就以用户为准。
 *
 * 纯函数,所以能用 `node --test` 直接测 —— 这些规则恰恰是"只有肉眼才发现坏了"的那类。
 */

export type ToolGroupPhase = "open" | "sealed-by-text" | "sealed-by-turn" | "sealed-by-error";

/** 组里的一项:**保持原本的先后**。 */
export type ToolGroupItem =
	| { readonly kind: "reasoning"; readonly text: string }
	| { readonly kind: "tool"; readonly tool: RemoteToolEntry };

export type ToolCategory = "read" | "edit" | "command" | "research" | "extension" | "other";

export interface RemoteToolEntry {
	readonly callId: string;
	readonly name: string;
	readonly state: "running" | "done" | "failed";
	/** 参数(命令、路径……):桌面端先给命令再给结果,这里也一样。 */
	readonly args?: string;
	readonly detail?: string;
	/** 有就显示耗时;历史消息里可能没有(那时不显示,而不是显示 0 秒)。 */
	readonly startedAt?: number;
	readonly completedAt?: number;
}

export interface ToolGroup {
	readonly id: string;
	readonly tools: readonly RemoteToolEntry[];
	/**
	 * 组里的内容,**按本来的顺序**(思考与工具交错)。
	 *
	 * 不重排:桌面端就是按块的真实顺序画的 —— 先思考再工具、还是先工具再思考,是模型自己决定的,
	 * 那个顺序本身携带信息("我先想了想才动手" vs "我试了一下,然后想了想")。
	 * 把它们排成"思考在前、工具在后"会让所有执行看起来都像同一种。
	 */
	readonly items: readonly ToolGroupItem[];
	/** 组里收着的思考文本(用于判断哪段思考已归组,不必再单独出现)。 */
	readonly reasoning: readonly string[];
	readonly phase: ToolGroupPhase;
	/** 还有工具在跑,或者突发仍未封闭。 */
	readonly processing: boolean;
	readonly hasActiveTool: boolean;
	readonly errorCount: number;
	readonly categoryCounts: readonly { readonly category: ToolCategory; readonly count: number }[];
	/** 工具总数(头部显示"已处理 N 项")。 */
	readonly toolCount: number;
}

interface ToolGroupDraft {
	readonly id: string;
	readonly tools: RemoteToolEntry[];
	readonly items: ToolGroupItem[];
	readonly reasoning: string[];
	phase: ToolGroupPhase;
}

/** 工具名 → 类别。与桌面端同一张表,所以汇总的措辞一致。 */
const TOOL_CATEGORY_BY_NAME: Partial<Record<string, ToolCategory>> = {
	read: "read",
	ls: "read",
	grep: "read",
	find: "read",
	edit: "edit",
	write: "edit",
	write_verify: "edit",
	bash: "command",
	research_delegate: "research",
};

export function toolCategory(name: string): ToolCategory {
	return TOOL_CATEGORY_BY_NAME[name] ?? (name.startsWith("mcp_") ? "extension" : "other");
}

/** 出错与中断都要封闭突发。 */
function messageSealsBurst(message: RemoteSessionMessage): boolean {
	return message.status === "error" || message.status === "aborted";
}

function toEntry(block: Extract<RemoteMessageBlock, { type: "tool" }>): RemoteToolEntry {
	return {
		callId: block.callId,
		name: block.name,
		state: block.state,
		...(block.args === undefined ? {} : { args: block.args }),
		...(block.detail === undefined ? {} : { detail: block.detail }),
		...(block.startedAt === undefined ? {} : { startedAt: block.startedAt }),
		...(block.completedAt === undefined ? {} : { completedAt: block.completedAt }),
	};
}

/**
 * 分组布局 —— **与桌面端同构**(`tool-activity-groups.ts` 的 `ToolActivityLayout`)。
 *
 * 桌面端除了"有哪些组",还给出两张表:`groupsByMessageId` 与 `groupsByBlock`(按**块的身份**,
 * 也就是"第几条消息的第几块")。网页端以前用**思考文本**去认"这一段归哪一组" ——
 * 文本会重复(模型可能两次想出同一句话),那是猜;块的身份不会重复,那才是事实。
 *
 * `groupsByBlock` 的键用**消息下标 + 块下标**(桌面端用消息 id —— 网页端的实时消息还没有 id)。
 * 两张表都在同一次遍历里生成,下标天然一致。
 */
export interface ToolGroupLayout {
	readonly groups: readonly ToolGroup[];
	/** `消息下标:块下标` → 它所属的那一组(组的**每一个成员**都在里面,起点也在)。 */
	readonly groupsByBlock: ReadonlyMap<string, ToolGroup>;
}

function blockKey(messageIndex: number, blockIndex: number): string {
	return `${messageIndex}:${blockIndex}`;
}

/** 一轮对话里,把工具执行切成"相邻突发",并给出"哪一块属于哪一组"。 */
export function buildToolGroupLayout(messages: readonly RemoteSessionMessage[]): ToolGroupLayout {
	// 先攒草稿(工具要按顺序攒进去),最后统一算聚合值。
	const drafts: ToolGroupDraft[] = [];
	const draftMembers = new Map<string, ToolGroupDraft>();
	let current: ToolGroupDraft | undefined;
	/**
	 * **还没遇到工具的那些思考**:先扣着。
	 *
	 * 这是桌面端的规则,也是"深度思考结束后直接调工具"那一段该有的样子:
	 * 思考先扣着,等工具真的来了,把它**收进这一组**(组的起点因此挪到那段思考上)——
	 * 于是组在思考的**上方**,思考成了组的子块。
	 * 以前这里是"直接跳过":那段思考既没进组、也没标记,于是组跑到思考下面去了(真实抱怨)。
	 */
	const pendingReasoning: Array<{ readonly messageIndex: number; readonly blockIndex: number; readonly text: string }> = [];
	/** 记下"这一块属于这一组" —— 组的每一个成员都登记(起点因此也在里面)。 */
	const addMember = (group: ToolGroupDraft, messageIndex: number, blockIndex: number): void => {
		draftMembers.set(blockKey(messageIndex, blockIndex), group);
	};

	const close = (phase: Exclude<ToolGroupPhase, "open">): void => {
		if (current) current.phase = phase;
		current = undefined;
		// 没有工具来接的那些思考:留在外面自己显示(它们不属于任何一组)。
		pendingReasoning.length = 0;
	};

	messages.forEach((message, messageIndex) => {
		/**
		 * **一轮的边界就是突发的边界**。
		 *
		 * 桌面端的分组函数**输入就是一轮的消息**,所以它天然不会跨轮;网页端拿的是整个会话的消息,
		 * 少了这一条就会:上一轮末尾的工具与下一轮开头的工具被合成**同一组** ——
		 * 于是上一轮的组里混着下一轮的调用(真实抱怨:"上一轮的 tool group 溢出到下一轮")。
		 */
		if (message.role === "user") close("sealed-by-turn");
		if (messageSealsBurst(message)) close("sealed-by-error");
		const blocks = blocksOf(message);
		for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
			const block = blocks[blockIndex] as RemoteMessageBlock;
			if (block.type === "text") {
				// 只有**非空正文**才算"讲完了":流式过程中会出现空文本块。
				if (block.text.trim().length > 0) close("sealed-by-text");
				continue;
			}
			if (block.type === "reasoning") {
				// 思考不拆开突发(工具之间夹着思考仍算同一次执行),并且**按原顺序**收进这一组。
				if (block.text.trim().length === 0) continue;
				if (current !== undefined) {
					current.items.push({ kind: "reasoning", text: block.text });
					current.reasoning.push(block.text);
					addMember(current, messageIndex, blockIndex);
				} else {
					// 还没有组:先扣着 —— 下一个工具会把它收进去(见 `pendingReasoning` 的注释)。
					pendingReasoning.push({ messageIndex, blockIndex, text: block.text });
				}
				continue;
			}
			// 压缩块不是工具:它不参与分组(分组只认工具与"工具前的思考")。
			if (block.type !== "tool") continue;
			const entry = toEntry(block);
			if (!current) {
				current = { id: `tools-${entry.callId}`, tools: [], items: [], reasoning: [], phase: "open" };
				drafts.push(current);
				// 把刚才扣着的思考**收进这一组**,而且放在最前面 —— 它们本来就是这一组的前半段。
				for (const pending of pendingReasoning) {
					current.items.push({ kind: "reasoning", text: pending.text });
					current.reasoning.push(pending.text);
					addMember(current, pending.messageIndex, pending.blockIndex);
				}
				pendingReasoning.length = 0;
			}
			current.tools.push(entry);
			current.items.push({ kind: "tool", tool: entry });
			addMember(current, messageIndex, blockIndex);
		}
		if (messageSealsBurst(message)) close("sealed-by-error");
	});

	const groups = drafts.map((draft) =>
		finalizeGroup(draft.id, draft.tools, draft.items, draft.reasoning, draft.phase),
	);
	const byId = new Map(drafts.map((draft, index) => [draft.id, groups[index] as ToolGroup]));
	const groupsByBlock = new Map<string, ToolGroup>();
	for (const [key, draft] of draftMembers) {
		const group = byId.get(draft.id);
		if (group !== undefined) groupsByBlock.set(key, group);
	}
	return { groups, groupsByBlock };
}

/** 只要组的那一份(渲染计划用它;需要"哪一块属于哪一组"时用 `buildToolGroupLayout`)。 */
export function buildToolGroups(messages: readonly RemoteSessionMessage[]): readonly ToolGroup[] {
	return buildToolGroupLayout(messages).groups;
}

function finalizeGroup(
	id: string,
	tools: readonly RemoteToolEntry[],
	items: readonly ToolGroupItem[],
	reasoning: readonly string[],
	phase: ToolGroupPhase,
): ToolGroup {
	const hasActiveTool = tools.some((tool) => tool.state === "running");
	const counts = new Map<ToolCategory, number>();
	for (const tool of tools) {
		const category = toolCategory(tool.name);
		counts.set(category, (counts.get(category) ?? 0) + 1);
	}
	return {
		id,
		tools,
		items,
		reasoning,
		phase,
		// 未封闭的突发即使此刻没有活跃工具也仍在进行(相邻两次工具调用之间有网络与推理的空档)。
		// 封闭之后(正文/换轮/出错)只有**真的还有工具在跑**才继续算"进行中" ——
		// 否则一轮早就结束了,头部还写着"正在执行 N 项"(那是一句假话)。
		processing: phase === "open" || hasActiveTool,
		hasActiveTool,
		errorCount: tools.filter((tool) => tool.state === "failed").length,
		categoryCounts: [...counts.entries()]
			.map(([category, count]) => ({ category, count }))
			.sort((left, right) => right.count - left.count || left.category.localeCompare(right.category)),
		toolCount: tools.length,
	};
}

/** 折叠默认值 + 用户覆盖。与桌面端同一套判断(那边没有"等待确认"这类状态,所以规则更简单)。 */
export function isGroupExpanded(group: ToolGroup, override?: boolean): boolean {
	if (override !== undefined) return override;
	// 只有"还在进行"(突发未封闭,或真的还有工具在跑)才默认展开;封闭之后就是历史,默认收起。
	return group.phase === "open" || group.hasActiveTool;
}

/** 头部那句话:分类汇总(最多三类,其余并成"等其他 N 项")。 */
export function groupSummaryParts(
	group: ToolGroup,
	labels: Record<ToolCategory, string>,
	moreLabel: string,
): string {
	const shown = group.categoryCounts.slice(0, 3);
	if (shown.length === 0) return "";
	const shownCount = shown.reduce((sum, part) => sum + part.count, 0);
	const remaining = group.toolCount - shownCount;
	const text = shown.map((part) => labels[part.category].replaceAll("{count}", String(part.count))).join(" · ");
	return remaining > 0 ? `${text} · ${moreLabel.replaceAll("{count}", String(remaining))}` : text;
}

/** 耗时:有开始与结束时间才给(历史消息可能没有),并且不显示 0 秒。 */
export function groupDurationMs(group: ToolGroup): number | undefined {
	const starts = group.tools.flatMap((tool) => (tool.startedAt === undefined ? [] : [tool.startedAt]));
	const ends = group.tools.flatMap((tool) => (tool.completedAt === undefined ? [] : [tool.completedAt]));
	if (starts.length === 0 || ends.length === 0) return undefined;
	const start = Math.min(...starts);
	const end = Math.max(...ends);
	if (end <= start) return undefined;
	return end - start;
}

/** 人读的耗时:`3 秒` / `1 分 12 秒`。 */
export function formatDuration(ms: number): string {
	const seconds = Math.max(1, Math.round(ms / 1_000));
	if (seconds < 60) return `${seconds} 秒`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes} 分 ${seconds % 60} 秒`;
}

/** 渲染计划:一条消息里要画什么(正文 / 思考 / 一个工具分组)。 */
export type RenderBlock =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "reasoning"; readonly text: string }
	| { readonly type: "group"; readonly group: ToolGroup }
	/** 压缩上下文那一行(与桌面端同一条信息:原因、前后 token、模型、摘要)。 */
	| { readonly type: "compaction"; readonly compaction: RemoteCompactionBlock };

export interface PlannedMessage {
	/** 用网页端自己的消息类型:它多带"发送中/发送失败"两个**只存在于这一端**的标记。 */
	readonly message: RemoteMessage;
	readonly blocks: readonly RenderBlock[];
}

/**
 * 把消息列表变成"怎么画":工具分组只在**它第一次出现的位置**画一次,其余工具块跳过。
 *
 * 抽成纯函数是因为这一个映射决定了整个视图的结构(哪儿是文字、哪儿是折叠块),
 * 而它很容易写错 —— 分组没画、或者画了两次,肉眼要翻很久才看得出来。
 */
/**
 * 一条消息的块。
 *
 * **没有 `blocks` 时退回"一整段正文"** —— 渲染走的是块,没有块的消息画出来是空的,
 * 而"空消息"和"没有消息"在用户眼里一样:他会以为电脑没在回答。
 * (流式消息、以及将来某个忘了带块的路径,都靠这一条兜住。)
 */
function blocksOf(message: RemoteMessage): readonly RemoteMessageBlock[] {
	if (message.blocks !== undefined && message.blocks.length > 0) return message.blocks;
	return message.text.trim().length === 0 ? [] : [{ type: "text", text: message.text }];
}


export function planMessages(messages: readonly RemoteMessage[]): readonly PlannedMessage[] {
	const layout = buildToolGroupLayout(messages);
	const emitted = new Set<string>();

	return messages.map((message, messageIndex) => {
		const blocks: RenderBlock[] = [];
		const source = blocksOf(message);
		for (let blockIndex = 0; blockIndex < source.length; blockIndex += 1) {
			const block = source[blockIndex] as RemoteMessageBlock;
			/**
			 * **按块的身份**问"这一块归哪一组"。
			 *
			 * 组的每一个成员都登记在 `groupsByBlock` 里(工具、以及被收进组的思考),所以这里只需:
			 * 遇到组的第一块就把它画出来,其余成员由组自己画(顺序、折叠都在组里)。
			 * 组的**起点**可能是那段思考 —— 于是组就画在思考原来的位置(在思考上方),与桌面端一致。
			 */
			const group = layout.groupsByBlock.get(`${messageIndex}:${blockIndex}`);
			if (group !== undefined) {
				if (emitted.has(group.id)) continue;
				emitted.add(group.id);
				blocks.push({ type: "group", group });
				continue;
			}
			if (block.type === "text") {
				if (block.text.length > 0) blocks.push({ type: "text", text: block.text });
				continue;
			}
			if (block.type === "reasoning") {
				if (block.text.length === 0) continue;
				blocks.push({ type: "reasoning", text: block.text });
				continue;
			}
			if (block.type === "compaction") {
				blocks.push({ type: "compaction", compaction: block });
				continue;
			}
		}
		return { message, blocks };
	});
}
