import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildToolGroupLayout,
	buildToolGroups,
	groupDurationMs,
	isGroupExpanded,
	planMessages,
} from "../src/tool-groups.ts";

/**
 * 工具执行的聚合规则 —— 移植自桌面端,规则边界也一样。
 *
 * 这些规则只有肉眼能发现坏掉:一次任务几十次工具调用,分组错了就是"聊天记录被工具刷屏",
 * 或者"折叠块永远转圈"。
 */

const tool = (callId: string, name: string, state: "running" | "done" | "failed" = "done", output?: string) => ({
	type: "tool" as const,
	callId,
	name,
	state,
	...(output === undefined ? {} : { detail: output }),
});

const assistant = (blocks: readonly unknown[], status: "complete" | "error" | "aborted" = "complete") => ({
	role: "assistant" as const,
	text: "",
	at: 1,
	status,
	blocks: blocks as never,
});

describe("分组", () => {
	it("相邻的工具合并成一个突发", () => {
		const groups = buildToolGroups([assistant([tool("c1", "read"), tool("c2", "grep"), tool("c3", "bash")])]);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].toolCount, 3);
	});

	it("一段非空正文会把它切成两个突发", () => {
		const groups = buildToolGroups([
			assistant([tool("c1", "read"), { type: "text", text: "找到了" }, tool("c2", "edit")]),
		]);
		assert.equal(groups.length, 2);
		assert.equal(groups[0].phase, "sealed-by-text");
		assert.equal(groups[1].phase, "open");
	});

	it("空白正文不切(流式过程中会出现空文本块)", () => {
		const groups = buildToolGroups([assistant([tool("c1", "read"), { type: "text", text: "   " }, tool("c2", "edit")])]);
		assert.equal(groups.length, 1);
	});

	it("只用思考不切:工具之间夹着思考仍算同一次执行", () => {
		const groups = buildToolGroups([
			assistant([tool("c1", "read"), { type: "reasoning", text: "想一下" }, tool("c2", "edit")]),
		]);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].toolCount, 2);
	});

	it("出错与中断都会封闭突发(否则它永远转圈)", () => {
		const errored = buildToolGroups([assistant([tool("c1", "bash", "running")], "error")]);
		assert.equal(errored[0].phase, "sealed-by-error");
		const aborted = buildToolGroups([assistant([tool("c1", "bash", "running")], "aborted")]);
		assert.equal(aborted[0].phase, "sealed-by-error");
	});

	it("聚合出状态:还在跑 / 失败数 / 分类计数", () => {
		const [group] = buildToolGroups([
			assistant([tool("c1", "read"), tool("c2", "bash", "running"), tool("c3", "read", "failed")]),
		]);
		assert.equal(group.hasActiveTool, true);
		assert.equal(group.errorCount, 1);
		assert.deepEqual(
			group.categoryCounts.map((entry) => [entry.category, entry.count]),
			[
				["read", 2],
				["command", 1],
			],
		);
	});
});

describe("折叠默认值", () => {
	it("正文封闭且没有活跃工具时默认收起", () => {
		const [group] = buildToolGroups([assistant([tool("c1", "read"), { type: "text", text: "做完了" }])]);
		assert.equal(isGroupExpanded(group), false);
	});

	it("还有工具在跑就保持展开", () => {
		const [group] = buildToolGroups([assistant([tool("c1", "bash", "running"), { type: "text", text: "先看" }])]);
		assert.equal(isGroupExpanded(group), true);
	});

	it("用户点过就以用户为准", () => {
		const [group] = buildToolGroups([assistant([tool("c1", "read"), { type: "text", text: "做完了" }])]);
		assert.equal(isGroupExpanded(group, true), true);
	});
});

describe("耗时", () => {
	it("有起止时间就给出耗时", () => {
		const [group] = buildToolGroups([
			assistant([
				{ ...tool("c1", "bash"), startedAt: 1_000, completedAt: 3_400 },
			]),
		]);
		assert.equal(groupDurationMs(group), 2_400);
	});

	it("没有时间就不给(而不是显示 0 秒)", () => {
		const [group] = buildToolGroups([assistant([tool("c1", "bash")])]);
		assert.equal(groupDurationMs(group), undefined);
	});
});

describe("渲染计划", () => {
	it("工具分组只在第一次出现的位置画一次", () => {
		const plan = planMessages([
			assistant([tool("c1", "read"), tool("c2", "grep")]),
			assistant([tool("c3", "bash")]),
		]);
		const kinds = plan.flatMap((entry) => entry.blocks.map((block) => block.type));
		// 三个工具同属一个突发:只在第一条消息里画一次。
		assert.deepEqual(kinds, ["group"]);
	});

	it("正文与分组按顺序交替", () => {
		const plan = planMessages([assistant([tool("c1", "read"), { type: "text", text: "找到了" }, tool("c2", "edit")])]);
		assert.deepEqual(plan[0].blocks.map((block) => block.type), ["group", "text", "group"]);
	});

describe("深度思考折进工具组", () => {
	const message = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
		role: "assistant" as const,
		text: "",
		at: 1,
		blocks,
		...extra,
	});
	const tool = (callId: string) => ({ type: "tool", callId, name: "bash", state: "done" });
	const reasoning = (text: string) => ({ type: "reasoning", text });

	it("夹在工具之间的思考归它所属的那一组(与桌面端一样:一起收起来)", () => {
		const groups = buildToolGroups([message([tool("c1"), reasoning("先看看有没有相关文件"), tool("c2")])] as never);
		assert.equal(groups.length, 1);
		assert.deepEqual(groups[0].reasoning, ["先看看有没有相关文件"]);
	});

	it("已经归组的思考不再单独出现在对话流里", () => {
		const planned = planMessages([
			message([tool("c1"), reasoning("先看看有没有相关文件"), tool("c2")]),
		] as never);
		const types = planned[0].blocks.map((block) => block.type);
		assert.deepEqual(types, ["group"], "只剩组:思考在里面");
		assert.deepEqual(planned[0].blocks[0].type === "group" ? planned[0].blocks[0].group.reasoning : [], [
			"先看看有没有相关文件",
		]);
	});

	it("工具**之前**那段思考被收进组里:组因此跑到思考上方(与桌面端一致)", () => {
		// 以前这里让"开头那段总述留在外面",结果组排到了思考下面 —— 真实抱怨就是这个。
		// 桌面端的规则是:还没遇到工具的思考先扣着,等工具来了把它收进这一组(组的起点因此挪到那段思考上)。
		const planned = planMessages([message([reasoning("我先理一下思路"), tool("c1")])] as never);
		assert.deepEqual(
			planned[0].blocks.map((block) => block.type),
			["group"],
			"思考在组里面,不再单独出现在组上方",
		);
		const group = planned[0].blocks[0];
		assert.deepEqual(group.type === "group" ? group.group.reasoning : [], ["我先理一下思路"]);
	});

	it("被**正文**隔开的思考不进组:那一段是讲给用户听的", () => {
		const planned = planMessages([
			message([reasoning("我先理一下思路"), { type: "text", text: "我先看一下代码" }, tool("c1")]),
		] as never);
		assert.deepEqual(
			planned[0].blocks.map((block) => block.type),
			["reasoning", "text", "group"],
		);
	});
});

describe("组里保持真实顺序", () => {
	const message = (blocks: unknown[]) => ({ role: "assistant" as const, text: "", at: 1, blocks });
	const tool = (callId: string) => ({ type: "tool", callId, name: "bash", state: "done" });
	const reasoning = (text: string) => ({ type: "reasoning", text });

	it("思考与工具交错时,按原样保留(不重排成思考在前)", () => {
		// 模型先想还是先动手,那个顺序本身携带信息,排一下就把所有执行弄成同一个样子了。
		const groups = buildToolGroups([
			message([tool("c1"), reasoning("第一次的结果不太对"), tool("c2"), reasoning("换个思路"), tool("c3")]),
		] as never);
		assert.deepEqual(
			groups[0].items.map((item) => (item.kind === "reasoning" ? `想:${item.text}` : `做:${item.tool.callId}`)),
			["做:c1", "想:第一次的结果不太对", "做:c2", "想:换个思路", "做:c3"],
		);
	});

	it("先想后做也照原样", () => {
		const groups = buildToolGroups([message([tool("c1"), reasoning("看一下再改"), tool("c2")])] as never);
		assert.deepEqual(
			groups[0].items.map((item) => item.kind),
			["tool", "reasoning", "tool"],
		);
	});

	it("工具条目也带参数(界面上先给命令再给结果)", () => {
		const groups = buildToolGroups([
			message([{ type: "tool", callId: "c1", name: "bash", state: "done", args: "npm test", detail: "通过" }]),
		] as never);
		const item = groups[0].items[0];
		assert.equal(item.kind === "tool" ? item.tool.args : undefined, "npm test");
	});
});


describe("一轮的边界就是突发的边界", () => {
	const user = (text: string) => ({ role: "user" as const, text, at: 1 });
	const assistant = (blocks: unknown[]) => ({ role: "assistant" as const, text: "", at: 2, blocks });
	const tool = (callId: string) => ({ type: "tool", callId, name: "bash", state: "done" });

	it("上一轮末尾的工具与下一轮开头的工具**不会**合成同一组", () => {
		// 真实抱怨:"上一轮的 tool group 溢出到下一轮"。桌面端的分组输入就是一轮的消息,
		// 所以它天然不跨轮;网页端拿整个会话,少这一条就会把两轮的工具并成一组。
		const layout = buildToolGroupLayout([
			assistant([tool("a1")]),
			user("再改一下"),
			assistant([tool("b1")]),
		] as never);
		assert.equal(layout.groups.length, 2, "两轮两组");
		assert.deepEqual(layout.groups.map((group) => group.tools.map((entry) => entry.callId)), [["a1"], ["b1"]]);
	});

	it("换轮之后那一组不再算\"进行中\"(头部不该写着正在执行)", () => {
		const layout = buildToolGroupLayout([assistant([tool("a1")]), user("再改一下")] as never);
		const group = layout.groups[0];
		assert.equal(group?.phase, "sealed-by-turn");
		assert.equal(group?.processing, false);
		assert.equal(isGroupExpanded(group!), false, "历史里的组默认收起");
	});

	it("同一轮里跨消息的工具仍然是一组(两段正文之间没有换轮)", () => {
		const layout = buildToolGroupLayout([
			assistant([tool("a1")]),
			assistant([tool("a2")]),
		] as never);
		assert.equal(layout.groups.length, 1);
		assert.equal(layout.groups[0]?.toolCount, 2);
	});
});

	it("压缩那一行要透传到渲染计划里,而且不参与工具分组", () => {
		const compaction = {
			type: "compaction" as const,
			trigger: "manual" as const,
			tokensBefore: 120_000,
			tokensAfter: 8_000,
			modelId: "gpt-5",
			summary: "前面聊了登录页报错。",
			at: 9,
		};
		const plan = planMessages([
			{ role: "user", text: "改一下", at: 1 },
			{ role: "compaction", text: "", at: 9, blocks: [compaction] },
			{ role: "assistant", text: "好了", at: 10, blocks: [{ type: "text", text: "好了" }] },
		] as never);
		// 用户那条退回"一整段正文",压缩那条是压缩块,助手那条是正文。
		assert.deepEqual(plan.map((entry) => entry.blocks.map((block) => block.type)), [["text"], ["compaction"], ["text"]]);
		// 分组只认工具与"工具前的思考":压缩块既不是工具,也不该把分组拆开。
		assert.equal(plan.some((entry) => entry.blocks.some((block) => block.type === "group")), false);
	});
});
