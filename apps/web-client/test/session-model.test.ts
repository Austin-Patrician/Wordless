import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyStream,
	assistantFooterVisibility,
	contextBreakdown,
	contextPercent,
	formatTokens,
	groupSessions,
	mergeEarlier,
	mergeMessage,
	mergeSessionState,
	mergeSessionSummary,
	currentModelChoice,
	currentTurnAssistantIndex,
	modelGroups,
	thinkingChoices,
	turnUserMessageId,
	upsertLiveTool,
	sessionChips,
} from "../src/session-model.ts";
import { buildToolGroupLayout } from "../src/tool-groups.ts";

/**
 * 网页端的两个纯逻辑。
 *
 * 它们各自对应一个真实抱怨:每个分片挂一个复制按钮、会话列表不分区。
 * 这里钉住的是**行为**,不是渲染细节 —— 渲染由人眼验收。
 */

const message = (role: "user" | "assistant", text: string, blocks?: unknown[]) => ({
	role,
	text,
	at: 1,
	...(blocks === undefined ? {} : { blocks }),
});

describe("消息合并", () => {
	it("连续的助手消息合成一条(否则每片都挂一个复制按钮)", () => {
		const first = message("assistant", "先看一下", [{ type: "text", text: "先看一下" }]);
		const second = message("assistant", "然后改这里", [{ type: "text", text: "然后改这里" }]);
		const merged = mergeMessage([first], second as never);
		assert.equal(merged.length, 1);
		assert.equal(merged[0].text, "先看一下然后改这里");
		assert.equal(merged[0].blocks?.length, 2);
	});

	it("用户消息永远不合并(两条提问是两件事)", () => {
		const merged = mergeMessage([message("user", "一")], message("user", "二"));
		assert.equal(merged.length, 2);
	});

	it("角色交替时不合并", () => {
		const merged = mergeMessage([message("user", "一")], message("assistant", "二"));
		assert.equal(merged.length, 2);
	});

	it("合并时保留原有的 at 与角色", () => {
		const merged = mergeMessage([message("assistant", "一")], message("assistant", "二"));
		assert.equal(merged[0].role, "assistant");
		assert.equal(merged[0].at, 1);
	});
});

describe("只读的会话设置", () => {
	const base = { id: "s1", title: "t", updatedAt: 1, running: false };

	it("模型 / 权限 / 连接器都显示出来,机器文本标成等宽", () => {
		const chips = sessionChips({
			...base,
			modelId: "claude-sonnet-4",
			accessLevel: "full",
			toolApprovalMode: "manual",
			connectorCount: 2,
		});
		assert.deepEqual(chips.map((chip) => chip.key), ["model", "access", "approval", "connectors"]);
		assert.equal(chips[0].mono, true);
		assert.deepEqual(chips.map((chip) => chip.label), ["claude-sonnet-4", "完全访问", "手动确认", "2 个连接器"]);
	});

	it("认不出来的取值不显示(而不是原样透出去)", () => {
		const chips = sessionChips({ ...base, accessLevel: "whatever" as never });
		assert.deepEqual(chips, []);
	});

	it("没有连接器时不显示这一项", () => {
		const chips = sessionChips({ ...base, connectorCount: 0 });
		assert.deepEqual(chips, []);
	});

	it("没有会话时什么都不显示", () => {
		assert.deepEqual(sessionChips(undefined), []);
	});
});

describe("会话分区", () => {
	const session = (id: string, updatedAt: number, workspaceId?: string, workspaceName?: string) => ({
		id,
		title: id,
		updatedAt,
		running: false,
		...(workspaceId === undefined ? {} : { workspaceId }),
		...(workspaceName === undefined ? {} : { workspaceName }),
	});

	it("最近在前,其余按空间分组", () => {
		const groups = groupSessions(
			[
				session("a", 10, "w1", "登录页重构"),
				session("b", 9, "w2", "数据看板"),
				session("c", 8, "w1", "登录页重构"),
			],
			1,
		);
		assert.deepEqual(groups.map((group) => group.label), ["最近", "登录页重构", "数据看板"]);
		assert.deepEqual(groups[0].sessions.map((entry) => entry.id), ["a"]);
		assert.deepEqual(groups[1].sessions.map((entry) => entry.id), ["c"]);
	});

	it("没有空间归属的会话归到「其他会话」,而不是硬塞进某个空间", () => {
		const groups = groupSessions([session("a", 10), session("b", 9, "w1", "登录页重构")], 1);
		assert.deepEqual(groups.map((group) => group.label), ["最近", "登录页重构"]);
		// a 在"最近"里;给一个更老的没空间的会话,应当落到"其他会话"。
		const withOrphan = groupSessions([session("a", 10, "w1", "登录页重构"), session("z", 1)], 1);
		assert.deepEqual(withOrphan.map((group) => group.label), ["最近", "其他会话"]);
	});

	it("没有会话时不给空分区", () => {
		assert.deepEqual(groupSessions([]), []);
	});

	it("最近里出现过的不再重复出现在空间分区里", () => {
		const groups = groupSessions([session("a", 10, "w1", "登录页重构"), session("b", 9, "w1", "登录页重构")], 1);
		const allIds = groups.flatMap((group) => group.sessions.map((entry) => entry.id));
		assert.deepEqual(allIds, ["a", "b"]);
		assert.equal(new Set(allIds).size, allIds.length);
	});

describe("合并会话摘要", () => {
	const base = { id: "s1", title: "t", updatedAt: 1, running: false };

	it("同一个会话:整条替换,而不是拼起来", () => {
		const merged = mergeSessionSummary([base, { ...base, id: "s2" }], { ...base, modelId: "gpt-5" });
		assert.equal(merged.length, 2);
		assert.equal(merged[0].modelId, "gpt-5");
	});

	it("列表里还没有它:补上(从通知点进来的会话不能缺一条)", () => {
		const merged = mergeSessionSummary([{ ...base, id: "s2" }], base);
		assert.deepEqual(merged.map((session) => session.id), ["s1", "s2"]);
	});
});

describe("重做与版本切换按哪条消息的 id", () => {
	const user = (id: string, at: number) => ({ role: "user" as const, id, text: "改一下", at });
	const assistant = (id: string, at: number) => ({ role: "assistant" as const, id, text: "答", at, blocks: [] });

	it("取的是**这一轮的用户消息 id**(运行时就是这么定义的)", () => {
		// 以前传的是**助手消息**的 id —— 本机一律拒绝,界面看起来就像"这个按钮没接上"(真实抱怨)。
		const messages = [user("u1", 1), assistant("a1", 2), user("u2", 3), assistant("a2", 4)];
		assert.equal(turnUserMessageId(messages, 1), "u1");
		assert.equal(turnUserMessageId(messages, 3), "u2");
	});

	it("这一轮的用户消息还没落位(没有 id):不给 id,界面据此不摆按钮", () => {
		const messages = [{ role: "user" as const, text: "刚发的", at: 1, pending: true }, assistant("a1", 2)];
		assert.equal(turnUserMessageId(messages, 1), undefined);
	});
});

describe("轮边界(内容不许写进别的轮)", () => {
	const user = (text: string, at: number) => ({ role: "user" as const, text, at });
	const assistant = (text: string, at: number, turnId: string) => ({
		role: "assistant" as const,
		text,
		at,
		turnId,
		blocks: [{ type: "text" as const, text }],
	});

	it("按 turn id 认轮:新一轮的内容**不会**写进上一轮的回答里", () => {
		// 时序:电脑上已经发了下一轮,但那条用户消息还没回到这一端 ——
		// 按"顺序"猜就会写进上一轮;按 turn id 不会(桌面端 store 就是按轮存的)。
		const messages = applyStream([user("一", 1), assistant("上一轮的回答", 2, "turn:u1")], {
			messageId: "a2",
			role: "assistant",
			turnId: "turn:u2",
			text: "新一轮开始",
		});
		assert.equal(messages.length, 3, "新开一条,而不是接在上一轮上");
		assert.equal(messages.at(-1)?.text, "新一轮开始");
		assert.equal(messages.at(-1)?.turnId, "turn:u2");
		assert.equal(messages[1]?.text, "上一轮的回答", "上一轮原样不动");
	});

	it("新一轮的完成帧**不会**并进上一轮的回答里", () => {
		const messages = mergeMessage([user("一", 1), assistant("上一轮的回答", 2, "turn:u1")], {
			role: "assistant",
			text: "新一轮的回答",
			at: 5,
			id: "a2",
			turnId: "turn:u2",
		});
		assert.equal(messages.length, 3);
		assert.equal(messages.at(-1)?.text, "新一轮的回答");
	});

	it("同一轮里的多段仍然合成一条(靠同一个 turn id)", () => {
		const first = applyStream([user("一", 1)], { messageId: "a1", role: "assistant", turnId: "turn:u1", text: "第一段" });
		const second = applyStream(first, {
			messageId: "a1",
			role: "assistant",
			turnId: "turn:u1",
			text: "第一段第二段",
		});
		assert.equal(second.length, 2);
		assert.equal(second.at(-1)?.text, "第一段第二段");
	});

	it("工具事件也按 turn id 认轮", () => {
		const previous = assistant("上一轮的回答", 2, "turn:u1");
		const messages = upsertLiveTool([user("一", 1), previous, user("二", 3)], {
			callId: "c1",
			turnId: "turn:u2",
			name: "bash",
		});
		assert.equal(messages.length, 4, "新开一条,而不是塞进上一轮");
		assert.equal(messages.at(-1)?.turnId, "turn:u2");
		assert.equal(messages[1]?.blocks?.length, 1, "上一轮原样不动");
	});

	it("先到的那条(还没 turn id)会被完成帧**认领**:同一轮不画两条(两个 brand 行)", () => {
		// 时序:工具先跑起来(那时这一端还不知道这一轮的 id)→ 完成帧后到(带 id)。
		// 不认领就会在同一轮里出现两条助手消息 —— 界面上就是两个「品牌图标 + Wordless」(真实抱怨)。
		let messages = upsertLiveTool([user("一", 1)], { callId: "c1", name: "bash" });
		assert.equal(messages.at(-1)?.turnId, undefined, "这一端自己画的:还没有 id");
		messages = mergeMessage(messages, {
			role: "assistant",
			id: "a1",
			turnId: "turn:u1",
			text: "跑完了",
			at: 5,
			blocks: [{ type: "text", text: "跑完了" }],
		});
		assert.equal(messages.filter((message) => message.role === "assistant").length, 1, "只能有一条");
		assert.equal(messages.at(-1)?.turnId, "turn:u1", "认领之后带上这一轮的 id");
	});

	it("用户消息的回显比助手内容**后**到:插在自己那一轮前面(顺序不能反过来)", () => {
		// 工具先跑起来 → 用户消息的回显才到。无条件追加会让"助手的回答排在用户的话上面"。
		const withTool = upsertLiveTool([{ role: "user", id: "u1", text: "改一下", at: 1 }], { callId: "c1", turnId: "turn:u1", name: "bash" });
		const messages = mergeMessage([withTool.at(-1)!], { role: "user", id: "u1", text: "改一下", at: 2 });
		assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
	});

	it("旧版本的本机没有 turn id 时:退回\"最后一条用户消息之后\"那条规则", () => {
		const messages = applyStream([user("一", 1), assistant("上一轮的回答", 2, "turn:u1")], {
			messageId: "a2",
			role: "assistant",
			text: "接着写",
		});
		// 没有 turn id 就认不出这是新的一轮 —— 这是兜底路径的已知代价(有 id 时不会发生)。
		assert.equal(messages.length, 2, "并进了同一条消息");
		assert.deepEqual(
			messages.at(-1)?.blocks?.map((block) => (block.type === "text" ? block.text : "")),
			["上一轮的回答", "接着写"],
			"两段都在(显示按块走,所以正文不会被覆盖)",
		);
	});
});

describe("实时工具写进消息里(一份真相)", () => {
	const tool = (callId: string, state: "running" | "done" = "running") => ({
		callId,
		name: "bash",
		state,
		args: "npm test",
	});

	it("同一轮里:开始/更新/完成都改**同一个块**(不再有第二份列表)", () => {
		let messages = upsertLiveTool([message("user", "帮我改一下")], tool("c1"));
		messages = upsertLiveTool(messages, tool("c1", "done"));
		const assistant = messages.at(-1);
		assert.equal(messages.length, 2, "只有一条助手消息");
		assert.equal(assistant?.blocks?.length, 1, "只有一个工具块");
		assert.equal(assistant?.blocks?.[0]?.type === "tool" ? assistant.blocks[0].state : undefined, "done");
	});

	it("助手还没出声也要有个家:新建这一轮的助手消息", () => {
		const messages = upsertLiveTool([message("user", "帮我改一下")], tool("c1"));
		assert.equal(messages.length, 2);
		assert.equal(messages.at(-1)?.role, "assistant");
	});

	it("完成帧**没有名字**也要更新到那一块上(否则永远停在执行中)", () => {
		// 运行时的更新/完成帧只带 callId —— 真实抱怨就是这里:状态一直不变。
		let messages = upsertLiveTool([message("user", "帮我改一下")], tool("c1"));
		messages = upsertLiveTool(messages, { callId: "c1", state: "done" });
		const block = messages.at(-1)?.blocks?.[0];
		assert.equal(block?.type === "tool" ? block.state : undefined, "done");
		assert.equal(block?.type === "tool" ? block.name : undefined, "bash", "名字不能被抹成空");
	});

	it("没有名字又没有对得上的那一块:不立新行(摆一行没名字的工具比不摆更糟)", () => {
		const messages = upsertLiveTool([message("user", "帮我改一下")], { callId: "c1", state: "running" });
		assert.equal(messages.length, 1, "没有名字就不立新行");
	});

	it("不写进**上一轮**的回答里(用户消息是边界)", () => {
		const previous = message("assistant", "上一轮答完了", [{ type: "text", text: "上一轮答完了" }]);
		const messages = upsertLiveTool([previous, message("user", "再改一下")], tool("c1"));
		assert.equal(messages.length, 3, "新开一条,而不是塞进上一轮");
		assert.equal(messages[0]?.blocks?.length, 1);
	});
});

describe("思考也要能流式长出来", () => {
	it("思考帧写进思考块,正文帧写进文本块,各写各的", () => {
		let messages = applyStream([message("user", "帮我改一下")], {
			messageId: "a1",
			role: "assistant",
			kind: "reasoning",
			text: "先想一下",
		});
		messages = applyStream(messages, {
			messageId: "a1",
			role: "assistant",
			kind: "reasoning",
			text: "先想一下思路",
		});
		messages = applyStream(messages, { messageId: "a1", role: "assistant", kind: "text", text: "开始改" });
		const assistant = messages.at(-1);
		assert.deepEqual(
			assistant?.blocks?.map((block) => [block.type, block.text]),
			[
				["reasoning", "先想一下思路"],
				["text", "开始改"],
			],
		);
		// 思考**不占正文**:正文那一栏留给真的开始写的时候。
		assert.equal(assistant?.text, "开始改");
	});

	it("没有 kind 的老帧按正文处理(不会把正文写进思考块)", () => {
		const messages = applyStream([message("user", "帮我改一下")], {
			messageId: "a1",
			role: "assistant",
			text: "正文",
		});
		assert.deepEqual(messages.at(-1)?.blocks?.map((block) => block.type), ["text"]);
	});
});

describe("一整轮的收尾(真实抱怨:上一轮的回答展示不全)", () => {
	it("流到一半 → 只调工具的收尾帧(没有正文):已流出的正文不能被抹掉", () => {
		let messages = applyStream([message("user", "帮我改一下")], {
			messageId: "a1",
			role: "assistant",
			text: "我先看一下代码",
		});
		// 收尾帧只带工具块、**没有正文** —— 真实运行时里"只调工具的那一段"就是这样。
		messages = mergeMessage(messages, {
			role: "assistant",
			text: "",
			at: 2,
			id: "a1",
			status: "complete",
			blocks: [{ type: "tool", callId: "c1", name: "bash", state: "complete" }],
		} as never);
		const assistant = messages.at(-1);
		assert.equal(assistant?.text, "我先看一下代码", "正文被收尾帧抹掉了");
		assert.equal(assistant?.streaming, false, "该收尾了");
		// 块要并起来:流出来的正文块 + 收尾帧的工具块,一个不少。
		assert.deepEqual(
			assistant?.blocks?.map((block) => block.type),
			["text", "tool"],
		);
	});

	it("收尾帧有正文:以它为准(流式的分片可能不完整)", () => {
		let messages = applyStream([message("user", "帮我改一下")], {
			messageId: "a1",
			role: "assistant",
			text: "我先看",
		});
		messages = mergeMessage(messages, {
			role: "assistant",
			text: "我先看一下代码,然后改",
			at: 2,
			id: "a1",
			status: "complete",
			blocks: [{ type: "text", text: "我先看一下代码,然后改" }],
		} as never);
		assert.equal(messages.at(-1)?.text, "我先看一下代码,然后改");
		assert.deepEqual(messages.at(-1)?.blocks?.map((block) => block.type), ["text"]);
	});
});

describe("模型分组", () => {
	const option = (
		connectionId: string,
		modelId: string,
		displayName: string,
		providerName?: string,
		identity?: { readonly providerId?: string; readonly avatarId?: string },
	) => ({
		connectionId,
		modelId,
		displayName,
		...(providerName === undefined ? {} : { providerName }),
		...identity,
	});

	it("按供应商分组,并标出当前那个", () => {
		const groups = modelGroups(
			[option("anthropic", "m1", "Claude", "Anthropic"), option("openai", "m2", "GPT-5", "OpenAI")],
			{ connectionId: "openai", modelId: "m2" },
		);
		assert.deepEqual(groups.map((group) => group.label), ["Anthropic", "OpenAI"]);
		assert.equal(groups[1].choices[0].current, true);
		assert.equal(groups[0].choices[0].current, false);
	});

	it("同一个供应商的多个模型合成一组,顺序不变", () => {
		const groups = modelGroups([option("openai", "a", "A"), option("openai", "b", "B")], undefined);
		assert.equal(groups.length, 1);
		assert.deepEqual(groups[0].choices.map((choice) => choice.modelId), ["a", "b"]);
	});

	it("供应商没有名字时退回连接 id,不编造", () => {
		const groups = modelGroups([option("custom-1", "a", "A")], undefined);
		assert.equal(groups[0].label, "custom-1");
	});

	it("没有清单(这台机器不支持远端换模型)时什么都没有", () => {
		assert.deepEqual(modelGroups(undefined, undefined), []);
		assert.deepEqual(modelGroups([], undefined), []);
	});

	it("把供应商身份带到分组与每一条上(图标要用它)", () => {
		const groups = modelGroups(
			[option("anthropic", "m1", "Claude", "Anthropic", { providerId: "anthropic", avatarId: "anthropic" })],
			undefined,
		);
		assert.equal(groups[0].providerId, "anthropic");
		assert.equal(groups[0].avatarId, "anthropic");
		assert.equal(groups[0].choices[0].providerId, "anthropic");
	});

	it("供应商身份缺了就不带(界面据此退回通用图标,而不是猜一个)", () => {
		const groups = modelGroups([option("custom-1", "a", "A")], undefined);
		assert.equal(groups[0].providerId, undefined);
		assert.equal(groups[0].avatarId, undefined);
		assert.equal("providerId" in groups[0].choices[0], false);
	});

	it("认当前那一个要**同时**看连接与模型(不同供应商会有同名模型)", () => {
		const models = [option("anthropic", "shared", "A"), option("openai", "shared", "B")];
		const groups = modelGroups(models, { connectionId: "openai", modelId: "shared" });
		// 只按 modelId 认的话,第一条也会被标成"当前"。
		assert.equal(groups[0].choices[0].current, false);
		assert.equal(groups[1].choices[0].current, true);
		assert.equal(currentModelChoice(groups)?.connectionId, "openai");
	});

	it("思考档位只列**这个模型支持的**,并标出当前那一档", () => {
		const choices = thinkingChoices(
			{ supportsReasoning: true, supportedThinkingLevels: ["off", "low", "medium", "high"] },
			"low",
		);
		assert.deepEqual(choices.map((choice) => choice.level), ["off", "low", "medium", "high"]);
		assert.deepEqual(choices.map((choice) => choice.label), ["关闭", "低", "中", "高"]);
		assert.equal(choices.find((choice) => choice.current)?.level, "low");
	});

	it("不支持思考的模型:一档都不列(界面据此**不摆**那个控件)", () => {
		assert.deepEqual(thinkingChoices({ supportsReasoning: false, supportedThinkingLevels: [] }, "medium"), []);
		assert.deepEqual(thinkingChoices(undefined, "medium"), []);
	});

	it("认不出来的档位不列(远端可能比我们新)", () => {
		const choices = thinkingChoices(
			{ supportsReasoning: true, supportedThinkingLevels: ["low", "ultra", "max"] },
			"low",
		);
		assert.deepEqual(choices.map((choice) => choice.level), ["low", "max"]);
	});

	it("没有当前模型时不给图标(而不是给一个错的)", () => {
		assert.equal(currentModelChoice(modelGroups([option("openai", "a", "A")], undefined)), undefined);
	});
});

describe("拼更早的一页", () => {
	const message = (at: number, text: string) => ({ role: "assistant" as const, text, at });

	it("按时间排好,旧的在前", () => {
		const merged = mergeEarlier([message(3, "c")], [message(1, "a"), message(2, "b")]);
		assert.deepEqual(merged.map((entry) => entry.text), ["a", "b", "c"]);
	});

	it("分页边界上的同一条不重复出现", () => {
		// 旧页的末尾与新页的开头常常是同一条:直接拼会显示两份。
		const merged = mergeEarlier([message(2, "b"), message(3, "c")], [message(1, "a"), message(2, "b")]);
		assert.deepEqual(merged.map((entry) => entry.text), ["a", "b", "c"]);
	});
});

describe("上下文用量", () => {
	const usage = (overrides: Record<string, unknown> = {}) => ({
		usedTokens: 24_000,
		contextWindow: 200_000,
		...overrides,
	});

	it("百分比与桌面端同一条规则", () => {
		assert.equal(contextPercent(usage()), 12);
		assert.equal(contextPercent(usage({ usedTokens: 400_000 })), 100, "超过窗口也只到 100");
	});

	it("窗口为 0 时给 0,而不是 Infinity", () => {
		assert.equal(contextPercent(usage({ contextWindow: 0 })), 0);
		assert.equal(contextPercent(undefined), 0);
	});

	it("数字缩写按手机上的空间来", () => {
		assert.equal(formatTokens(950), "950");
		assert.equal(formatTokens(24_000), "24k");
		assert.equal(formatTokens(1_200_000), "1.2M");
		assert.equal(formatTokens(2_000_000), "2M");
	});

	it("分类明细:标签与颜色与桌面端一致", () => {
		const rows = contextBreakdown(
			usage({
				categories: { systemPrompt: 2_000, toolsAndSubagents: 4_000, conversation: 10_000, connectors: 6_000, skills: 2_000 },
			}),
		);
		assert.deepEqual(rows.map((row) => row.label), ["系统提示词", "工具及子智能体", "对话消息", "连接器及 MCP", "技能"]);
		assert.equal(rows[0].color, "#20b896");
		assert.equal(rows[2].percent, 5);
	});

	it("没有分类时不编造", () => {
		assert.deepEqual(contextBreakdown(usage()), []);
	});

	it("只带来用量的状态事件**不能**顺手把会话标成没在跑", () => {
		const sessions = [{ id: "s1", title: "t", updatedAt: 1, running: true }];
		const merged = mergeSessionState(sessions, "s1", { context: usage() });
		assert.equal(merged[0].running, true, "running 不在载荷里就必须原样保留");
		assert.equal(merged[0].context?.usedTokens, 24_000);
	});

	it("只带来运行状态的事件不动用量", () => {
		const sessions = [{ id: "s1", title: "t", updatedAt: 1, running: false, context: usage() }];
		const merged = mergeSessionState(sessions, "s1", { running: true });
		assert.equal(merged[0].running, true);
		assert.equal(merged[0].context?.usedTokens, 24_000);
	});
});

describe("流式文字", () => {
	const delta = (messageId: string, text: string, role: "user" | "assistant" = "assistant") => ({ messageId, text, role });

	it("第一帧新建一条,后面每一帧**替换**它(不是拼)", () => {
		let messages = applyStream([], delta("m1", "你"));
		messages = applyStream(messages, delta("m1", "你好"));
		messages = applyStream(messages, delta("m1", "你好,我在"));
		assert.equal(messages.length, 1);
		assert.equal(messages[0].text, "你好,我在");
		assert.equal(messages[0].streaming, true);
	});

	it("用 messageId 认人:两条并发写的消息不会互相覆盖", () => {
		let messages = applyStream([], delta("m1", "A"));
		messages = applyStream(messages, delta("m2", "B"));
		messages = applyStream(messages, delta("m1", "AA"));
		assert.deepEqual(messages.map((message) => message.text), ["AA", "B"]);
	});

	it("完成时**替换**那条流式消息,而不是把最终文本再拼一遍", () => {
		// 这是最容易踩的坑:拼了就会出现两份一样的回答。
		const streaming = applyStream([], delta("m1", "你好,我在"));
		const settled = mergeMessage(streaming, { role: "assistant", text: "你好,我在。", at: 10 });
		assert.equal(settled.length, 1);
		assert.equal(settled[0].text, "你好,我在。");
		assert.equal(settled[0].streaming, undefined, "完成之后不再标着流式");
	});

	it("普通的两条助手消息照旧合并(流式那条没有标记时不受影响)", () => {
		const merged = mergeMessage([{ role: "assistant", text: "前半", at: 1 }], {
			role: "assistant",
			text: "后半",
			at: 2,
		});
		assert.equal(merged.length, 1);
		assert.equal(merged[0].text, "前半后半");
	});
});

describe("用户消息回显去重", () => {
	it("本机把刚发的用户消息发回来时,不出现第二条", () => {
		// 这一端按下发送时已经乐观画了一条;本机也会发一条(所有设备要看到同一份历史)。
		const optimistic = { role: "user" as const, text: "帮我看看登录页", at: 1, pending: true };
		const merged = mergeMessage([optimistic], { role: "user", text: "帮我看看登录页", at: 5 });
		assert.equal(merged.length, 1, "只能有一条");
		assert.equal(merged[0].at, 5, "用本机那份(它更准)");
		assert.equal(merged[0].pending, false, "落位之后不再标着发送中");
	});

	it("文本不同的用户消息不会被误吞", () => {
		const merged = mergeMessage([{ role: "user", text: "第一句", at: 1 }], { role: "user", text: "第二句", at: 2 });
		assert.equal(merged.length, 2);
	});

	it("回显比发送成功晚到:也只会有一条(真实抱怨:先出现两条,过一会儿才合成一条)", () => {
		// 真实时序:session.prompt 的响应**先**回来(乐观那条被标成已发出),
		// 回显**后**到 —— 那时它既不是 pending 也不是 failed。
		const settled = { role: "user" as const, text: "帮我看看登录页", at: 1, pending: false };
		const merged = mergeMessage([settled], { role: "user", text: "帮我看看登录页", at: 5, id: "u1" });
		assert.equal(merged.length, 1, "只能有一条");
		assert.equal(merged[0].id, "u1", "用本机那份");
	});

	it("带附件时本机把附件说明接在正文后面:也要认出来(前缀相同)", () => {
		const optimistic = { role: "user" as const, text: "看看这个", at: 1, pending: true };
		const echo = {
			role: "user" as const,
			text: "看看这个\n\n<attachments>report.pdf</attachments>",
			at: 5,
			id: "u2",
		};
		const merged = mergeMessage([optimistic], echo);
		assert.equal(merged.length, 1, "只能有一条");
	});

	it("同一条运行时消息被补发两次:也只画一次", () => {
		// 重连后补发、事件重放都会走到这里 —— 没有这一道,两条一模一样的消息谁也去不掉谁。
		const once = mergeMessage([], { role: "assistant", text: "答完了", at: 1, id: "a1" });
		const twice = mergeMessage(once, { role: "assistant", text: "答完了", at: 1, id: "a1" });
		assert.equal(twice.length, 1);
	});

	it("已经落位的旧消息不会被后来的同文本消息顶掉", () => {
		// 用户可能真的把同一句话发两遍 —— 那是两条消息,不是回显。
		// 已经落位的那一条**带运行时的消息 id**(它来自本机),所以不会被当成"这一端自己画的"。
		const merged = mergeMessage([{ role: "user", text: "再试一次", at: 1, id: "u1" }], { role: "user", text: "再试一次", at: 9, id: "u2" });
		assert.equal(merged.length, 2);
	});
});

describe("流式的空帧", () => {
	it("一个字都没有时不画消息(否则会出现没有正文却挂着复制按钮的气泡)", () => {
		const messages = applyStream([], { messageId: "m1", role: "assistant", text: "" });
		assert.deepEqual(messages, []);
	});

	it("有字了才出现,并且继续替换同一条", () => {
		let messages = applyStream([], { messageId: "m1", role: "assistant", text: "你" });
		messages = applyStream(messages, { messageId: "m1", role: "assistant", text: "你好" });
		assert.equal(messages.length, 1);
		assert.equal(messages[0].text, "你好");
	});
});

describe("底部操作行的可见性", () => {
	const base = { hasPendingInteraction: false, isStreaming: false, isTurnRunning: false, messageCount: 3 };

	it("答完了才摆操作行", () => {
		assert.equal(assistantFooterVisibility(base), true);
	});

	it("这一轮还在跑就不摆(摆着复制和用量,用户会以为答完了)", () => {
		assert.equal(assistantFooterVisibility({ ...base, isTurnRunning: true }), false);
	});

	it("还有消息在流也不摆", () => {
		assert.equal(assistantFooterVisibility({ ...base, isStreaming: true }), false);
	});

	it("有待处理的交互(审批/提问)也不摆", () => {
		assert.equal(assistantFooterVisibility({ ...base, hasPendingInteraction: true }), false);
	});

	it("还没有消息时不摆", () => {
		assert.equal(assistantFooterVisibility({ ...base, messageCount: 0 }), false);
	});
});

describe("一轮助手输出 = 一条消息", () => {
	const delta = (messageId: string, text: string) => ({ messageId, text, role: "assistant" as const });
	const userMessage = { role: "user" as const, text: "开始吧", at: 1 };

	it("说一段、跑工具、再说一段:仍然是**同一条**消息(所以底部操作行一轮只有一个)", () => {
		let messages = applyStream([userMessage], delta("m1", "我先看看。"));
		messages = mergeMessage(messages, { role: "assistant", text: "我先看看。", at: 2, id: "m1" });
		// 第二段(工具之后)
		messages = applyStream(messages, delta("m2", "看完了,没问题。"));
		messages = mergeMessage(messages, { role: "assistant", text: "看完了,没问题。", at: 3, id: "m2" });
		assert.equal(messages.length, 2, "一条用户 + 一条助手");
		const assistant = messages[1];
		assert.deepEqual(
			(assistant.blocks ?? []).filter((block) => block.type === "text").map((block) => block.text),
			["我先看看。", "看完了,没问题。"],
			"两段正文都在同一条消息里,顺序不变",
		);
	});

	it("用户又发了一条:新的一轮另起一条消息", () => {
		let messages = applyStream([userMessage], delta("m1", "第一轮"));
		messages = mergeMessage(messages, { role: "assistant", text: "第一轮", at: 2, id: "m1" });
		messages = [...messages, { role: "user", text: "再来一次", at: 3 }];
		messages = applyStream(messages, delta("m2", "第二轮"));
		assert.equal(messages.length, 4);
		assert.equal(messages[3].text, "第二轮");
	});

	it("完成帧认领自己那一段:不会把流式的字再拼一遍", () => {
		let messages = applyStream([userMessage], delta("m1", "我在写"));
		messages = mergeMessage(messages, {
			role: "assistant",
			text: "我在写完了。",
			at: 2,
			id: "m1",
			blocks: [{ type: "text", text: "我在写完了。" }],
		});
		assert.equal(messages[1].text, "我在写完了。");
		assert.equal(messages[1].streaming, false);
		assert.deepEqual(
			(messages[1].blocks ?? []).map((block) => (block.type === "text" ? block.text : "")),
			["我在写完了。"],
		);
	});
});

	it("一段一段发完成帧:更早那几段的正文不能被吞掉(吞掉就分不出两组工具了)", () => {
		/**
		 * 真实抱怨:网页端的工具分组"该切开的地方没切开"。
		 *
		 * 根因在合并规则:完成帧只要带了正文,就把**所有**非工具块丢掉 ——
		 * 于是第二段说完,第一段的正文没了。而"一段非空正文封闭一个工具突发"这条规则
		 * 正是靠那段正文成立的:它没了,两组工具就挨成了一组。
		 */
		let messages: ReturnType<typeof mergeMessage> = [];
		// 第一段:流出一段正文 → 跑一个工具 → 这一段的完成帧
		messages = applyStream(messages as never, { messageId: "a1", role: "assistant", turnId: "turn:u1", text: "先看一下" });
		messages = upsertLiveTool(messages, { callId: "c1", turnId: "turn:u1", name: "bash", state: "running" });
		messages = mergeMessage(messages, {
			role: "assistant",
			id: "a1",
			turnId: "turn:u1",
			text: "先看一下",
			at: 3,
			blocks: [
				{ type: "text", text: "先看一下" },
				{ type: "tool", callId: "c1", name: "bash", state: "done" },
			],
		} as never);
		// 第二段:再流出一段正文 → 再跑一个工具 → 这一段的完成帧
		messages = applyStream(messages as never, { messageId: "a2", role: "assistant", turnId: "turn:u1", text: "再看第二个" });
		messages = upsertLiveTool(messages, { callId: "c2", turnId: "turn:u1", name: "python", state: "running" });
		messages = mergeMessage(messages, {
			role: "assistant",
			id: "a2",
			turnId: "turn:u1",
			text: "再看第二个",
			at: 6,
			blocks: [
				{ type: "text", text: "再看第二个" },
				{ type: "tool", callId: "c2", name: "python", state: "done" },
			],
		} as never);

		const assistant = messages.at(-1);
		assert.deepEqual(
			(assistant?.blocks ?? []).map((block) => (block.type === "text" ? `text:${block.text}` : `tool:${block.callId}`)),
			["text:先看一下", "tool:c1", "text:再看第二个", "tool:c2"],
			"两段正文都必须在,顺序也要对",
		);
		// 分组的判据:两段正文把突发切开 → 两组。
		assert.equal(buildToolGroupLayout(messages).groups.length, 2);
	});
});
