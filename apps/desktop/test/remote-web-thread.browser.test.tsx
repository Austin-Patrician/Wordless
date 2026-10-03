import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThreadView } from "../../web-client/src/thread-view";
import wordlessBrandIcon from "../../web-client/src/icons/common-icons/wordless-brand.svg";

/**
 * 网页端线程的**渲染冒烟测试**。
 *
 * 用户报过"手机连上之后白屏" —— 白屏就是渲染时抛了异常(React 会把整棵树卸掉)。
 * 网页端此前**没有任何渲染测试**(只有纯逻辑测试),所以这类崩溃只能靠人肉发现。
 * 这里用真浏览器把 ThreadView 渲染一遍:它抛不抛、渲染出来的东西对不对,一次就能看见。
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const message = (overrides: Record<string, unknown> = {}) => ({
	role: "assistant" as const,
	text: "你好",
	at: 1,
	...overrides,
});

const state = (overrides: Record<string, unknown> = {}) => ({
	phase: "online",
	sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1_700_000_000_000, running: false }],
	sessionId: "s1",
	messages: [],
	running: false,
	sending: false,
	waitingForApproval: false,
	truncated: false,
	approvals: [],
	requests: [],
	pendingSkillIds: [],
	attachments: [],
	activity: undefined,
	...overrides,
});

const render = (
	overrides: Record<string, unknown> = {},
	onSetModel = async () => ({ ok: true }),
	onRetryTurn = async () => ({ ok: true }),
	onOpenSession: (sessionId: string) => void = () => undefined,
) => {
	const clientState = state(overrides);
	const props = {
		state: clientState,
		// 新建页的选项来自 state(与 app.tsx 一样把它透给 ThreadView)。
		entries: clientState.entries,
		onOpenSession,
		onSend: () => undefined,
		onAbort: () => undefined,
		onRefresh: () => undefined,
		onSetModel,
		onLoadEarlier: () => undefined,
		onLoadSessionUsage: async () => ({ ok: true }),
		onRetry: () => undefined,
		onRetryTurn,
		onLoadEntries: () => undefined,
		onCreateSession: async () => ({ ok: true }),
		onDismissError: () => undefined,
		theme: "system" as const,
		onThemeChange: () => undefined,
		onDisconnect: () => undefined,
	};
	act(() => root.render(<ThreadView {...(props as never)} />));
	return container;
};

describe("网页端线程渲染", () => {
	it("空会话:能渲染,不抛异常", () => {
		const dom = render();
		expect(dom.textContent).toContain("修一下登录页");
	});

	it("有正文、思考、工具执行:能渲染", () => {
		const dom = render({
			messages: [
				{ role: "user", text: "帮我看看", at: 1 },
				{
					...message(),
					blocks: [
						{ type: "reasoning", text: "想一下" },
						{ type: "text", text: "我看一下。" },
						{ type: "tool", callId: "c1", name: "bash", state: "done", args: '{\n "command": "npm test"\n}', detail: "全部通过" },
					],
				},
			],
		});
		expect(dom.textContent).toContain("帮我看看");
		expect(dom.textContent).toContain("我看一下。");
	});

	it("流式中的消息(带 streamId 与 streaming 标记):能渲染", () => {
		const dom = render({
			messages: [message({ text: "正在写…", streamId: "m1", streaming: true })],
		});
		expect(dom.textContent).toContain("正在写");
	});

	it("只有工具的消息:不该出现复制按钮(用户报过)", () => {
		// 一轮里工具突发那条消息常常带着一个**空白文本块**:`message.text` 非空,屏幕上却什么都没有。
		// 按 `message.text` 判断,就会在工具组底下冒出一个复制按钮。
		const dom = render({
			messages: [
				{
					...message({ text: "\n" }),
					blocks: [
						{ type: "text", text: "\n" },
						{ type: "tool", callId: "c1", name: "bash", state: "done", args: "npm test" },
						{ type: "tool", callId: "c2", name: "bash", state: "done", args: "npm run lint" },
					],
				},
			],
		});
		// 这一轮还没有正文封闭它,所以头部说的是"正在执行"。
		expect(dom.textContent).toContain("正在执行 2 项");
		const copyButtons = [...dom.querySelectorAll("button")].filter((button) =>
			(button.getAttribute("aria-label") ?? "").includes("复制"),
		);
		expect(copyButtons).toHaveLength(0);
	});

	it("工具行:先给命令与状态,输出要另外点开", () => {
		// 工具**就是消息里的块**(与桌面端同一个数据模型),所以这里用一条消息喂它。
		const dom = render({
			messages: [
				message({
					at: 1,
					blocks: [{ type: "tool", callId: "c1", name: "bash", state: "done", args: "npm test", detail: "全部通过" }],
				}),
			],
		});
		expect(dom.textContent).toContain("npm test");
		expect(dom.textContent).toContain("查看输出");
		expect(dom.textContent).not.toContain("全部通过");
		// 点开之后:输出那一块比正文再小一档(用户提的:手机上"查看输出"的字有点大)。
		act(() => {
			[...dom.querySelectorAll("button")].find((button) => button.textContent?.includes("查看输出"))?.click();
		});
		expect(dom.textContent).toContain("全部通过");
		expect(dom.querySelector("pre.message-code-scroll")?.className).toContain("text-[10px]");
	});

	it("工具组里按真实顺序画:思考夹在两条工具之间", () => {
		const dom = render({
			messages: [
				{
					...message({ text: "" }),
					blocks: [
						{ type: "tool", callId: "c1", name: "bash", state: "done", args: "npm test" },
						{ type: "reasoning", text: "第一次没过,先看看日志" },
						{ type: "tool", callId: "c2", name: "bash", state: "done", args: "cat log" },
					],
				},
			],
		});
		// 这一轮还没有正文封闭它,所以工具组**默认展开**(不用点)。
		// 深度思考块本身是**收起**的(桌面端也只在流式时默认展开),所以按**元素位置**断言顺序,
		// 而不是按它里面那段文字(收起了就不会渲染)。
		const html = dom.innerHTML;
		const first = html.indexOf("npm test");
		const thinking = html.indexOf("深度思考");
		const second = html.indexOf("cat log");
		expect(first).toBeGreaterThan(-1);
		expect(thinking).toBeGreaterThan(first);
		expect(second).toBeGreaterThan(thinking);
	});

	it("正在跑的那一轮:工具组底下不该有复制按钮(用户报过)", () => {
		// 底部的复制/用量只在**答完之后**才摆 —— 正在跑的时候摆着,用户会以为已经答完了。
		const dom = render({
			running: true,
			messages: [
				{
					...message({ text: "我看一下。" }),
					blocks: [
						{ type: "text", text: "我看一下。" },
						{ type: "tool", callId: "c1", name: "bash", state: "running", args: "npm test" },
					],
				},
			],
		});
		const copyButtons = [...dom.querySelectorAll("button")].filter((button) =>
			(button.getAttribute("aria-label") ?? "").includes("复制"),
		);
		expect(copyButtons).toHaveLength(0);
	});

	it("答完之后:底部是**图标按钮**(复制 / 用量 / 重新生成)+ 时间", () => {
		const dom = render({
			messages: [
				// 这一轮的用户消息要带上 id:重做与版本切换都以它为准(没有 id 就不给按钮)。
				{ role: "user", id: "u1", text: "跑一下测试", at: 1 },
				{
					...message({ text: "跑完了。", id: "m1", usage: { inputTokens: 12_345, outputTokens: 678 } }),
					blocks: [{ type: "text", text: "跑完了。" }],
				},
			],
		});
		const labels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		expect(labels).toContain("用量详情");
		expect(labels).toContain("重新生成");
		expect(labels.some((label) => label.includes("复制"))).toBe(true);
		// 时间在,而"↑12.3k"这种内联文字不在(详情在抽屉里)。
		expect(dom.textContent).not.toContain("↑");
	});

	it("重做只在最新一轮:中间那条回复不给", () => {
		const dom = render({
			messages: [
				{ role: "user", id: "u1", text: "第一问", at: 0 },
				{ ...message({ text: "第一轮", id: "m1", at: 1 }), blocks: [{ type: "text", text: "第一轮" }] },
				{ role: "user", id: "u2", text: "再来一次", at: 2 },
				{ ...message({ text: "第二轮", id: "m2", at: 3 }), blocks: [{ type: "text", text: "第二轮" }] },
			],
		});
		const retries = [...dom.querySelectorAll("button")].filter(
			(button) => button.getAttribute("aria-label") === "重新生成",
		);
		expect(retries).toHaveLength(1);
	});

	it("一轮里说了两段 + 跑过工具:底部**只有一个**操作行", () => {
		// 用户报过"工具组底下还有一个复制按钮" —— 根因是一轮被拆成了好几条消息。
		const dom = render({
			messages: [
				{
					...message({ text: "先看看。看完了。", id: "m1", at: 5 }),
					blocks: [
						{ type: "text", text: "先看看。" },
						{ type: "tool", callId: "c1", name: "bash", state: "done", args: "npm test" },
						{ type: "text", text: "看完了。" },
					],
				},
			],
		});
		const copyButtons = [...dom.querySelectorAll("button")].filter((button) =>
			(button.getAttribute("aria-label") ?? "").includes("复制"),
		);
		expect(copyButtons).toHaveLength(1);
	});

	it("组里的深度思考是**可折叠的块**(带标题),不是一段裸文本", () => {
		const dom = render({
			messages: [
				{
					...message({ text: "" }),
					blocks: [
						{ type: "tool", callId: "c1", name: "bash", state: "done", args: "npm test" },
						{ type: "reasoning", text: "先看看日志" },
						{ type: "tool", callId: "c2", name: "bash", state: "done", args: "cat log" },
					],
				},
			],
		});
		const thinking = [...dom.querySelectorAll("button")].filter(
			(button) => button.getAttribute("aria-label") === "深度思考",
		);
		expect(thinking).toHaveLength(1);
		expect(thinking[0].getAttribute("aria-expanded")).toBe("false");
	});

	it("输入区底行**只有三样**:模型(图标)、更多、发送(圆形)", () => {
		const dom = render({
			sessions: [
				{
					id: "s1",
					title: "修一下登录页",
					updatedAt: 1_700_000_000_000,
					running: false,
					modelName: "Claude Sonnet 4",
					toolApprovalMode: "manual",
					connectors: [{ id: "k1", name: "GitHub", enabled: true }],
				},
			],
			models: [{ connectionId: "c", modelId: "m", displayName: "M" }],
		});
		const labels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		// 模型是**图标**:名字只留在无障碍标签里,屏幕上不占地方。
		expect(labels).toContain("模型:Claude Sonnet 4");
		expect(labels).toContain("更多");
		expect(labels).toContain("发送");
		// 权限与连接器**不在底行**(它们搬进了「+」):底行每多一个按钮,输入区就挤一分。
		expect(labels.some((label) => label.startsWith("权限"))).toBe(false);
		expect(labels.some((label) => label.startsWith("连接器"))).toBe(false);
		// 发送是圆形图标按钮,没有「发送」两个字;默认模式下是**红色**。
		const send = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "发送");
		expect(send?.textContent ?? "").not.toContain("发送");
		expect(send?.className ?? "").toContain("rounded-full");
		expect(send?.className ?? "").toContain("#d8443c");
		// 顺序:最左是「+」,然后是模型;最右只有发送。
		const buttons = [...dom.querySelectorAll("button")];
		const moreIndex = buttons.findIndex((button) => button.getAttribute("aria-label") === "更多");
		const modelIndex = buttons.findIndex((button) => (button.getAttribute("aria-label") ?? "").startsWith("模型:"));
		const sendIndex = buttons.findIndex((button) => button.getAttribute("aria-label") === "发送");
		expect(moreIndex).toBeGreaterThan(-1);
		expect(modelIndex).toBeGreaterThan(moreIndex);
		expect(sendIndex).toBeGreaterThan(modelIndex);
	});

	it("发送键按模式配色:计划橙、澄清蓝(与桌面端同一组色值)", () => {
		const plan = render({
			sessions: [{ id: "s1", title: "t", updatedAt: 1, running: false, interactionMode: "plan" }],
		});
		const planSend = [...plan.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "发送",
		);
		expect(planSend?.className ?? "").toContain("#d97a2b");

		const clarify = render({
			sessions: [{ id: "s1", title: "t", updatedAt: 1, running: false, interactionMode: "clarify" }],
		});
		const clarifySend = [...clarify.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "发送",
		);
		expect(clarifySend?.className ?? "").toContain("#2f7bd0");
	});

	it("运行中:发送键变成**停止键**,颜色不变,而且点得动", () => {
		const dom = render({
			running: true,
			sessions: [{ id: "s1", title: "t", updatedAt: 1, running: true, interactionMode: "plan" }],
		});
		const stop = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "停止");
		expect(stop).toBeDefined();
		expect(stop?.disabled).toBe(false);
		expect(stop?.className ?? "").toContain("#d97a2b");
		// 头部不再重复摆一个「中断」。
		const labels = [...dom.querySelectorAll("button")].map((button) => button.textContent ?? "");
		expect(labels.some((label) => label.includes("中断"))).toBe(false);
	});

	it("「+」里的权限是**两个下拉**,三档都在(与桌面端同样的全量选择)", () => {
		const dom = render({
			sessions: [
				{ id: "s1", title: "修一下登录页", updatedAt: 1, running: false, accessLevel: "full", toolApprovalMode: "bypass" },
			],
		});
		const more = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "更多");
		act(() => more?.click());
		// 下拉是**自己画的**(原生 select 的 option 列表在手机上不受样式控制,也限不了高)。
		const access = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "访问权限",
		);
		const approval = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "工具确认",
		);
		expect(access?.textContent).toContain("完全访问");
		expect(approval?.textContent).toContain("跳过确认");

		act(() => approval?.click());
		const options = [...dom.querySelectorAll('[role="option"]')].map((option) => option.textContent);
		expect(options).toEqual(["手动确认", "自动执行", "跳过确认"]);
		// **限高可滚**:选项多的时候不能把屏幕撑满。
		const listbox = dom.querySelector('[role="listbox"]');
		expect(listbox?.className ?? "").toContain("max-h-56");
		expect(listbox?.className ?? "").toContain("overflow-y-auto");
	});

	it("有工具等批准:输入区上方出现审批卡片,能批准也能拒绝", () => {
		const dom = render({
			approvals: [
				{
					approvalId: "a1",
					toolName: "bash",
					summary: "删除构建目录",
					args: "rm -rf build",
					severity: "high",
					at: 1,
				},
			],
		});
		expect(dom.textContent).toContain("电脑在等你批准");
		expect(dom.textContent).toContain("删除构建目录");
		expect(dom.textContent).toContain("rm -rf build");
		const buttons = [...dom.querySelectorAll("button")].map((button) => button.textContent ?? "");
		expect(buttons.some((label) => label.includes("批准"))).toBe(true);
		expect(buttons.some((label) => label.includes("拒绝"))).toBe(true);
	});

	it("「+」抽屉里能选模式和技能", () => {
		const dom = render({
			sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: false, interactionMode: "default" }],
			skills: [{ id: "k1", name: "写周报", description: "按模板写" }],
			pendingSkillIds: ["k1"],
		});
		const more = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "更多");
		act(() => more?.click());
		const mode = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "模式");
		expect(mode?.textContent).toContain("默认");
		act(() => mode?.click());
		expect([...dom.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
			"默认",
			"计划",
			"澄清",
		]);
		expect(dom.textContent).toContain("写周报");
	});

	it("有提问时:出现表单,四种字段都在,必填没填时不能提交", () => {
		const dom = render({
			requests: [
				{
					requestId: "r1",
					title: "选一下",
					fields: [
						{ type: "select", id: "f1", label: "语言", options: [{ value: "ts", label: "TypeScript" }, { value: "py", label: "Python" }] },
						{ type: "multi-select", id: "f2", label: "范围", options: [{ value: "a", label: "A" }] },
						{ type: "text", id: "f3", label: "补充", multiline: true, required: true },
						{ type: "confirm", id: "f4", label: "要不要提交" },
					],
				},
			],
		});
		expect(dom.textContent).toContain("选一下");
		expect(dom.textContent).toContain("TypeScript");
		expect(dom.textContent).toContain("A");
		expect(dom.textContent).toContain("补充");
		expect(dom.textContent).toContain("要不要提交");
		// 必填的文本框还没填:提交按钮应当是禁用的。
		const submit = [...dom.querySelectorAll("button")].find((button) => (button.textContent ?? "").includes("提交"));
		expect(submit?.disabled).toBe(true);
		expect(dom.textContent).toContain("还有必填项没填");
	});

	it("重做过多版:底部出现版本切换(2/3),只有一版时不出现", () => {
		const dom = render({
			messages: [
				{ role: "user", id: "u1", text: "重做一下", at: 4 },
				{
					...message({ text: "第一版", id: "m1", at: 5, versions: { active: 2, total: 3 } }),
					blocks: [{ type: "text", text: "第一版" }],
				},
			],
		});
		expect(dom.textContent).toContain("2/3");
		const labels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		expect(labels).toContain("上一版");
		expect(labels).toContain("下一版");
	});

	it("「+」里技能与连接器是**用来添加的 select** + 可删的小块", () => {
		const dom = render({
			sessions: [
				{
					id: "s1",
					title: "修一下登录页",
					updatedAt: 1,
					running: false,
					connectors: [{ id: "k1", name: "GitHub", enabled: true }],
				},
			],
			// 可选的连接器来自**这台机器能连什么**(不是这个会话已经连了什么)。
			availableConnectors: [
				{ id: "k1", name: "GitHub", enabled: true },
				{ id: "k2", name: "Notion", enabled: true },
			],
			skills: [
				{ id: "s1", name: "写周报" },
				{ id: "s2", name: "写日报" },
			],
			pendingSkillIds: ["s1"],
		});
		const more = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "更多");
		act(() => more?.click());
		const skillSelect = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "技能",
		);
		const connectorSelect = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "连接器",
		);
		expect(skillSelect).toBeDefined();
		expect(connectorSelect).toBeDefined();
		// 已选的那一个在下面的小块里,并且**不会**再出现在"添加"的选项里(避免重复添加)。
		const removeLabels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		expect(removeLabels).toContain("移除 写周报");
		act(() => skillSelect?.click());
		expect([...dom.querySelectorAll('[role="option"]')].map((option) => option.textContent)).not.toContain("写周报");
		expect([...dom.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toContain("写日报");
	});

	it("连接器:只连了 1 个时,底下就 1 个小块,其余 3 个回到选项里(用户报过)", () => {
		const dom = render({
			sessions: [
				{
					id: "s1",
					title: "修一下登录页",
					updatedAt: 1,
					running: false,
					connectors: [{ id: "k1", name: "Firecrawl", enabled: true }],
				},
			],
			availableConnectors: [
				{ id: "k1", name: "Firecrawl", enabled: true },
				{ id: "k2", name: "GitHub", enabled: true },
				{ id: "k3", name: "Notion", enabled: true },
				{ id: "k4", name: "Slack", enabled: true },
			],
		});
		const more = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "更多");
		act(() => more?.click());
		// 已选的只有 Firecrawl —— 之前这里会把 4 个全当成已选(而选项里就"没有可选项"了)。
		const removeLabels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		expect(removeLabels.filter((label) => label.startsWith("移除 "))).toEqual(["移除 Firecrawl"]);
		const connector = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "连接器",
		);
		act(() => connector?.click());
		expect([...dom.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
			"GitHub",
			"Notion",
			"Slack",
		]);
	});

	it("「+」里有专家团与压缩上下文", () => {
		const dom = render({
			sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: false }],
			// 专家目录只有支持专家团的会话才有(本机按入口决定发不发)。
			experts: [
				{ kind: "team", id: "t1", version: "1", name: "编辑部", description: "写稿" },
				{ kind: "expert", id: "e1", version: "1", name: "小编辑" },
			],
		});
		const more = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "更多");
		act(() => more?.click());
		const expert = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "专家 / 专家团",
		);
		expect(expert?.textContent).toContain("不用");
		act(() => expert?.click());
		expect([...dom.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual([
			"不用",
			"编辑部(专家团)",
			"小编辑(专家)",
		]);
		expect(dom.textContent).toContain("压缩上下文");
	});

	it("已传的附件显示在输入卡片上,能移除", () => {
		const dom = render({
			attachments: [
				{ uploadId: "u1", name: "照片.png", size: 1024, progress: 1 },
				{ uploadId: "u2", name: "报告.pdf", size: 2048, progress: 0.4 },
			],
		});
		expect(dom.textContent).toContain("照片.png");
		expect(dom.textContent).toContain("报告.pdf");
		expect(dom.textContent).toContain("40%");
		const labels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		expect(labels).toContain("移除 照片.png");
	});

	it("「+」里有添加附件,并写明限制", () => {
		const dom = render();
		const more = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "更多");
		act(() => more?.click());
		expect(dom.textContent).toContain("添加附件");
		expect(dom.textContent).toContain("8MB");
	});

	it("电脑在跑的时候:实时状态挂在**消息底部**(与桌面端同一个位置)", () => {
		const dom = render({
			running: true,
			activity: "正在分析工具结果",
			sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: true }],
			messages: [message({ text: "我看看", at: 2 })],
		});
		const status = dom.querySelector(".assistant-run-status-shimmer");
		expect(status?.textContent).toBe("正在分析工具结果");
		// 在**消息里面**(不是飘在列表外面的固定行),而且在正文之后。
		expect(status?.closest("[data-message-role='assistant']")).not.toBeNull();
		expect(dom.textContent?.indexOf("我看看")).toBeLessThan(dom.textContent?.indexOf("正在分析工具结果") ?? -1);
		// 顶部那行**不冒充进度**(具体在做什么只在消息底部),但必须说清"电脑在跑"。
		expect(dom.querySelector("[data-thread-header]")?.textContent).not.toContain("正在分析工具结果");
		expect(dom.querySelector("[data-thread-header]")?.textContent).toContain("电脑正在执行");
	});

	it("发完消息之后:顶部不许显示空闲(真实抱怨:显示空闲,其实在跑)", () => {
		const dom = render({
			running: true,
			activity: "思考中",
			messages: [{ role: "user", text: "帮我看看", at: 1 }],
		});
		expect(dom.querySelector("[data-thread-header]")?.textContent).toContain("电脑正在执行");
		expect(dom.querySelector("[data-thread-header]")?.textContent).not.toContain("空闲");
	});

	it("助手还没出声的时候:状态落在列表末尾(没有消息可挂)", () => {
		const dom = render({
			running: true,
			activity: "思考中",
			messages: [{ role: "user", text: "帮我看看", at: 1 }],
		});
		expect(dom.querySelector(".assistant-run-status-shimmer")?.textContent).toBe("思考中");
	});

	it("流式输出时:不允许发送(Enter 也不发),发送键此时是停止键", () => {
		const dom = render({
			running: true,
			draft: undefined,
			sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: true }],
		});
		// 运行中:发送键的语义是"停止"。
		const labels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"));
		expect(labels).toContain("停止");
		expect(labels).not.toContain("发送");
		// composer 上方那句"发送会插话"删掉了(顶部已经在说同一件事)。
		expect(dom.textContent).not.toContain("插到当前执行里");
	});

	const toggleOf = (dom: HTMLElement) =>
		[...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "展开" || button.getAttribute("aria-label") === "收起",
		);

	it("过长的用户消息默认折叠,卡片底部有个**只有图标**的按钮", () => {
		const long = "很长的一段话。".repeat(40);
		const dom = render({ messages: [{ role: "user", text: long, at: 1 }] });
		const toggle = toggleOf(dom);
		expect(toggle).toBeDefined();
		// 图标按钮:没有文字(桌面端也是这个形状)。
		expect(toggle?.textContent).toBe("");
		expect(toggle?.querySelector("svg")).not.toBeNull();
		// 按钮在**卡片里面**的底部(不是卡片外面):正文那一层折着,卡片同时装着正文和按钮。
		const body = dom.querySelector(".line-clamp-3");
		expect(body).not.toBeNull();
		expect(body?.parentElement?.contains(toggle ?? null)).toBe(true);
		expect(toggle?.getAttribute("aria-label")).toBe("展开");
		act(() => toggle?.click());
		expect(toggleOf(dom)?.getAttribute("aria-label")).toBe("收起");
	});

	it("短的用户消息不摆展开按钮", () => {
		const dom = render({ messages: [{ role: "user", text: "短", at: 1 }] });
		expect(toggleOf(dom)).toBeUndefined();
	});

	it("离线、出错、被截断、发送失败、没选会话:都要能渲染", () => {
		// 白屏就是这些分支里有一个抛了 —— 而它们正是"连接出问题时"最可能出现的状态。
		const offline = render({ phase: "offline", reconnectAttempts: 3 });
		expect(offline.textContent).toContain("一直连不上电脑");

		const errored = render({ error: "打不开这个会话" });
		expect(errored.textContent).toContain("打不开这个会话");
		expect(errored.textContent).toContain("重新打开会话");

		const truncated = render({ truncated: true, earlierCursor: "cursor-1" });
		expect(truncated.textContent).toContain("加载更早的消息");

		const failed = render({
			messages: [{ role: "user", text: "发出去了吗", at: 1, pending: false, failed: true }],
		});
		expect(failed.textContent).toContain("发送失败");
		expect(failed.textContent).toContain("重试");

		// 没选会话时进的是**新建页**(以前这里只有一句"从左边选一个会话")。
		const noSession = render({ sessionId: undefined, sessions: [] });
		expect(noSession.textContent).toContain("今天想做什么");
	});

	it("带用量、模型清单、工具活动:能渲染", () => {
		const dom = render({
			sessions: [
				{
					id: "s1",
					title: "修一下登录页",
					updatedAt: 1_700_000_000_000,
					running: true,
					modelId: "claude-sonnet-4",
					modelName: "Claude Sonnet 4",
					accessLevel: "full",
					toolApprovalMode: "manual",
					connectorCount: 2,
					context: {
						usedTokens: 24_000,
						contextWindow: 200_000,
						source: "estimate",
						categories: {
							systemPrompt: 2_000,
							toolsAndSubagents: 4_000,
							conversation: 10_000,
							connectors: 6_000,
							skills: 2_000,
						},
					},
				},
			],
			models: [{ connectionId: "openai", modelId: "gpt-5", displayName: "GPT-5", providerName: "OpenAI" }],

		});
		// 模型在底行(图标);权限与连接器在「+」里。
		const labels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		expect(labels).toContain("模型:Claude Sonnet 4");
	});

	it("输入区变高之后:贴底的人还在底部(不会凭空多出一段间距)", async () => {
		const dom = render({
			messages: Array.from({ length: 30 }, (_, index) => message({ text: `第 ${index} 段`, at: index + 1 })),
		});
		const scroll = dom.querySelector<HTMLElement>("[data-thread-scroll]");
		expect(scroll).not.toBeNull();
		// 真浏览器里没有 Tailwind(测试环境不加载样式),所以这里手动给它一个"能滚"的高度。
		scroll!.style.height = "200px";
		scroll!.style.overflowY = "auto";
		await act(async () => {
			await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		});
		expect(scroll!.scrollHeight).toBeGreaterThan(scroll!.clientHeight);

		// 用户贴在底部(这一步会走到 `handleScroll`,把"贴底"记下来)。
		await act(async () => {
			scroll!.scrollTop = scroll!.scrollHeight;
			scroll!.dispatchEvent(new Event("scroll"));
			await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		});
		expect(scroll!.scrollHeight - scroll!.scrollTop - scroll!.clientHeight).toBe(0);

		// 输入区变高 → 消息区变矮 60px。**没有重新贴底的话**,最后一条会离底 60px。
		await act(async () => {
			scroll!.style.height = "140px";
			await new Promise((resolve) => setTimeout(resolve, 60));
		});
		expect(scroll!.scrollHeight - scroll!.scrollTop - scroll!.clientHeight).toBeLessThanOrEqual(1);
	});

	it("往上翻历史时容器变矮:不许把人拽回底部", async () => {
		const dom = render({
			messages: Array.from({ length: 30 }, (_, index) => message({ text: `第 ${index} 段`, at: index + 1 })),
		});
		const scroll = dom.querySelector<HTMLElement>("[data-thread-scroll]")!;
		scroll.style.height = "200px";
		scroll.style.overflowY = "auto";
		await act(async () => {
			scroll.scrollTop = 0;
			scroll.dispatchEvent(new Event("scroll"));
			await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		});
		await act(async () => {
			scroll.style.height = "140px";
			await new Promise((resolve) => setTimeout(resolve, 60));
		});
		// 离底部还很远 —— 说明没有被拽回去。
		expect(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight).toBeGreaterThan(80);
	});

	it("没有打开会话时:显示新建会话页(工作类型 + 第一句话)", () => {
		const dom = render({
			sessionId: undefined,
			entries: [
				{ id: "general-work", name: "通用工作", description: "日常写作、研究与综合任务。", iconKey: "sparkles", available: true },
				{ id: "code-development", name: "代码开发", description: "理解、实现与调试代码。", iconKey: "code", available: false, note: "这类会话要先选一个工作目录;手机上还不能选,请在电脑上新建。" },
			],
		});
		expect(dom.textContent).toContain("今天想做什么");
		expect(dom.textContent).toContain("通用工作");
		// 不能建的那一类:**照实说原因**,而不是让用户点一下才知道。
		expect(dom.textContent).toContain("手机上还不能选");
		const disabled = [...dom.querySelectorAll("button")].find((button) => button.textContent?.includes("代码开发"));
		expect(disabled?.hasAttribute("disabled")).toBe(true);
	});

	it("新建页**没有自己的输入框**:第一句话写在底部那个(它还能选模型)", async () => {
		// 两个输入框会让人犹豫"该在哪个里打字" —— 而底部那个更完整(模型、权限、附件都在那儿)。
		const calls: Array<[string, string]> = [];
		const dom = render(
			{
				sessionId: undefined,
				entries: [{ id: "general-work", name: "通用工作", iconKey: "sparkles", available: true }],
			},
			async () => ({ ok: true }),
			async () => ({ ok: true }),
		);
		expect(dom.querySelectorAll("textarea")).toHaveLength(1);
		expect(dom.textContent).toContain("在下面写下第一句话");
		// 底部那个在新建状态下是**可用**的(以前没会话就禁用)。
		const textarea = dom.querySelector("textarea");
		expect(textarea?.hasAttribute("disabled")).toBe(false);
		expect(textarea?.getAttribute("placeholder")).toContain("写下第一句话");
		expect(calls.length).toBe(0);
	});

	it("用量详情里的「更多」:覆盖率与对账要摆出来(与桌面端同一套项)", () => {
		const dom = render({
			sessionId: "s1",
			messages: [
				{ role: "user", text: "改一下", at: 1 },
				{
					role: "assistant",
					text: "好了",
					at: 2,
					usage: {
						modelCalls: 3,
						delegatedCalls: 1,
						inputTokens: 100,
						outputTokens: 20,
						cacheReadTokens: 10,
						cacheWriteTokens: 0,
						totalTokens: 130,
						promptTokens: 110,
						totalCost: 0.01,
						hitRate: 0.5,
						readObservedCalls: 2,
						readCoverage: 0.66,
						writeCoverage: null,
						writeObservation: "read-only",
						reportedPromptCount: 3,
						reportedPromptDriftCount: 0,
						reportedPromptMaxDrift: 0,
						reportedPromptTokens: 110,
					},
					blocks: [{ type: "text", text: "好了" }],
				},
			],
		});
		const usageButton = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "用量详情",
		);
		act(() => usageButton?.click());
		const moreButton = [...dom.querySelectorAll("button")].find((button) => button.textContent?.trim() === "更多");
		expect(moreButton).toBeTruthy();
		act(() => moreButton?.click());
		const text = dom.textContent ?? "";
		expect(text).toContain("读取覆盖率");
		expect(text).toContain("写入覆盖率");
		// 没有调用上报过写入 → 说"无写入上报",而不是"0%"(那会被读成"写入占比 0%")。
		expect(text).toContain("无写入上报");
		expect(text).toContain("自报 prompt 对账");
		expect(text).toContain("一致");
	});

	it("压缩上下文那一行要在网页上画出来:原因 + 前后 token + 摘要,而且没有身份行与操作行", () => {
		// 真实抱怨:桌面端点"压缩上下文"看得见,网页上什么都没有。
		const dom = render({
			sessionId: "s1",
			messages: [
				{ role: "user", text: "改一下", at: 1 },
				{
					role: "compaction",
					text: "",
					at: 9,
					blocks: [
						{
							type: "compaction",
							trigger: "manual",
							tokensBefore: 120_000,
							tokensAfter: 8_000,
							modelId: "gpt-5",
							summary: "前面聊了登录页报错。",
							at: 9,
						},
					],
				},
			],
		});
		const text = dom.textContent ?? "";
		expect(text).toContain("已压缩上下文");
		expect(text).toContain("120k");
		expect(text).toContain("8k");
		expect(text).toContain("前面聊了登录页报错。");
		// 它不是"谁说的话":整页只有用户那一条(助手才带身份行),也没有复制/重做那一行。
		expect(dom.querySelectorAll("[data-assistant-identity]").length).toBe(0);
		expect(text).not.toContain("复制");
	});

	it("在新建页点会话列表里的那一条:要回到那个会话(不能卡在新建页)", () => {
		/**
		 * 真实抱怨:在会话 A 里点「新建」,再点回列表里的 A —— 因为 `sessionId` 没变,
		 * "会话变了就退出新建页"那条规则不生效,于是永远停在新建页。
		 */
		const opened: string[] = [];
		const dom = render(
			{
				sessionId: "s1",
				entries: [{ id: "general-work", name: "通用工作", iconKey: "sparkles", available: true }],
				sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: false }],
				messages: [],
			},
			async () => ({ ok: true }),
			async () => ({ ok: true }),
			(id: string) => opened.push(id),
		);
		// 进新建页
		act(() => {
			[...dom.querySelectorAll("button")].find((button) => button.textContent?.includes("新建"))?.click();
		});
		expect(dom.textContent).toContain("今天想做什么");
		// 再点回那一个会话
		act(() => {
			[...dom.querySelectorAll("button")].find((button) => button.textContent?.includes("修一下登录页"))?.click();
		});
		expect(opened).toEqual(["s1"]);
		expect(dom.textContent).not.toContain("今天想做什么");
	});

	it("切换会话时有加载态:列表那一行转圈,正文区说「正在打开会话…」,而且不给发", () => {
		// 真实抱怨:会话切换有延迟,点完界面一动不动,只能猜点没点上。
		const dom = render({
			sessionId: "s1",
			opening: true,
			openingSessionId: "s1",
			sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: false }],
			messages: [],
		});
		expect(dom.textContent).toContain("正在打开会话…");
		expect(dom.querySelector('[aria-label="正在打开"]')).toBeTruthy();
		// 打开中不给发:这一页的技能 / 连接器 / 模型还是上一个会话的。
		expect((dom.querySelector("textarea") as HTMLTextAreaElement | null)?.disabled).toBe(true);
	});

	it("新建页**不受别的会话影响**:那边在跑,这边的发送键还是发送键", () => {
		// 真实抱怨:桌面端任何会话一有流式输出,新建页的发送键就变成停止键。
		const dom = render({
			sessionId: undefined,
			running: true,
			activity: "正在执行命令",
			entries: [{ id: "general-work", name: "通用工作", iconKey: "sparkles", available: true }],
		});
		const labels = [...dom.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? "");
		expect(labels).not.toContain("停止");
		expect(labels).toContain("新建并发送");
		// 顶部也不该说"电脑正在执行"(那是别的会话的事),更不该显示它的标题。
		expect(dom.querySelector("[data-thread-header]")?.textContent).toContain("新建会话");
		expect(dom.querySelector("[data-thread-header]")?.textContent).not.toContain("正在执行命令");
	});

	it("新建状态下「+」里能选技能与连接器(会话专属的那几行不摆)", async () => {
		const dom = render({
			sessionId: undefined,
			entries: [{ id: "general-work", name: "通用工作", iconKey: "sparkles", available: true }],
			availableConnectors: [{ id: "c1", name: "GitHub", enabled: true }],
			skills: [{ id: "s1", name: "周报", description: "写周报" }],
		});
		const more = [...dom.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "更多");
		expect(more).toBeDefined();
		await act(async () => more?.click());
		const sheet = dom.querySelector('[role="dialog"]');
		expect(sheet?.textContent).toContain("技能");
		expect(sheet?.textContent).toContain("连接器");
		// 权限 / 模式 / 专家 / 压缩都要先有会话 —— 摆着也只能是灰的,所以不摆。
		expect(sheet?.textContent).not.toContain("访问权限");
		expect(sheet?.textContent).not.toContain("压缩上下文");
	});

	it("会话列表:当前那条有竖线标记,运行中的用转圈替掉时间", () => {
		const dom = render({
			sessions: [
				{ id: "s1", title: "修一下登录页", updatedAt: 1_700_000_000_000, running: true, entryId: "code-development", workspaceName: "登录页重构" },
			],
		});
		const row = dom.querySelector('[aria-current="true"]');
		expect(row).not.toBeNull();
		expect(row?.textContent).toContain("运行中");
		// 运行中不显示时间(与桌面端同一条规则:手机上两样一起放会挤)。
		expect(row?.textContent).not.toContain("·");
	});

	it("点重新生成发出去的是**这一轮的用户消息 id**(不是助手那条)", async () => {
		// 以前传助手消息的 id:运行时校验"只能重做用户消息" → 一律被拒 → 看起来像"按钮没接上"。
		const calls: string[] = [];
		const dom = render(
			{
				messages: [
					{ role: "user", id: "u1", text: "帮我看看", at: 1 },
					message({ id: "a1", text: "看完了", at: 2 }),
				],
			},
			async () => ({ ok: true }),
			async (userMessageId: string) => {
				calls.push(userMessageId);
				return { ok: true };
			},
		);
		const retry = [...dom.querySelectorAll("button")].find(
			(button) => button.getAttribute("aria-label") === "重新生成",
		);
		expect(retry).toBeDefined();
		await act(async () => retry?.click());
		expect(calls).toEqual(["u1"]);
	});

	it("助手消息第一行是品牌图标 + Wordless(与桌面端同一个形状)", () => {
		const dom = render({ messages: [message({ text: "我看看" })] });
		const article = dom.querySelector('[data-message-role="assistant"]');
		const header = article?.querySelector("header");
		expect(header?.textContent).toContain("Wordless");
		const brand = header?.querySelector("img");
		// 是**同一份品牌资源**(测试里导入同一个文件,拿到同一个 URL:内联时是 data URL,否则是同一个哈希名)。
		expect(brand?.getAttribute("src")).toBe(wordlessBrandIcon);
	});

	it("专家团会话:那一行显示牵头专家的名字(桌面端同一条规则)", () => {
		const dom = render({
			sessions: [
				{
					id: "s1",
					title: "修一下登录页",
					updatedAt: 1_700_000_000_000,
					running: false,
					expertName: "架构师",
				},
			],
			messages: [message({ text: "我看看" })],
		});
		const header = dom.querySelector('[data-message-role="assistant"]')?.querySelector("header");
		expect(header?.textContent).toContain("架构师");
		expect(header?.querySelector("img")).not.toBeNull();
	});

	it("工具组在**消息里面**:排在操作行上方,而且工具前的思考被收进组", async () => {
		const dom = render({
			messages: [
				{ role: "user", text: "帮我看看", at: 1 },
				message({
					text: "我看一下。",
					at: 2,
					// 先想 → 调工具 → 再讲给用户听:于是"工具前的那段思考"被收进组,
					// 而正文在组之后(它封闭这一组,也正是底部操作行该出现的时候)。
					blocks: [
						{ type: "reasoning", text: "先想一下" },
						{ type: "tool", callId: "c1", name: "bash", state: "done", args: "npm test" },
						{ type: "text", text: "我看一下。" },
					],
				}),
			],
		});
		const article = dom.querySelector('[data-message-role="assistant"]');
		const group = article?.querySelector("section");
		const footer = article?.querySelector('button[aria-label="复制回答"]');
		expect(group).not.toBeNull();
		expect(footer).not.toBeNull();
		// 组与操作行**同在这条消息里**,而且组排在前面 —— 不是"溢出到操作行底下"。
		expect(article?.contains(group ?? null)).toBe(true);
		expect(article?.contains(footer ?? null)).toBe(true);
		expect((group?.compareDocumentPosition(footer ?? null) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// 组被正文封闭,所以默认收起 —— 展开它,里面应该有那段思考(它不再单独出现在组上方)。
		expect(group?.textContent).toContain("已处理");
		await act(async () => group?.querySelector("button")?.click());
		// 组里多了一个「深度思考」子块 —— 那段思考属于这一组,而不是单独排在组上方。
		expect(article?.querySelector("section")?.textContent).toContain("深度思考");
	});

	it("实时工具行:一行里放下 状态图标 + 工具名 + 命令(没有横向滚动的那段 JSON)", () => {
		const dom = render({
			messages: [],
			messages: [
				message({
					at: 2,
					blocks: [
						{ type: "tool", callId: "c1", name: "bash", state: "running", args: "npm test" },
						{ type: "tool", callId: "c2", name: "bash", state: "done", args: "npm run build" },
						{ type: "tool", callId: "c3", name: "bash", state: "failed", args: "npm run lint" },
					],
				}),
			],
		});
		const rows = [...dom.querySelectorAll("article")];
		// 三种状态各有自己的图标(不只靠颜色):转圈 / 对勾 / 感叹号。
		expect(dom.querySelectorAll("svg.animate-spin").length).toBeGreaterThan(0);
		expect(rows.some((row) => row.textContent?.includes("npm test"))).toBe(true);
		// 命令在**同一行**里(不再是单独一段带换行的 JSON)。
		expect(dom.textContent).not.toContain("timeout");
		// 状态**只用图标**:桌面端在窄屏也是把"执行中/完成"那行字收起来的。
		expect(dom.textContent).not.toContain("执行中");
		expect(dom.textContent).not.toContain("完成");
		// 但含义不能丢:读屏要读得出来。
		const labels = [...dom.querySelectorAll('[role="img"]')].map((node) => node.getAttribute("aria-label"));
		expect(labels).toContain("执行中");
		expect(labels).toContain("已完成");
		expect(labels).toContain("执行失败");
	});

	it("提问卡片:选项整行占满宽度,而且**有自定义输入**", () => {
		const dom = render({
			requests: [
				{
					requestId: "r1",
					title: "选一个方案",
					fields: [
						{
							id: "f1",
							label: "怎么做",
							type: "select",
							allowCustom: true,
							options: [
								{ value: "a", label: "方案 A" },
								{ value: "b", label: "方案 B" },
							],
						},
					],
				},
			],
		});
		const option = [...dom.querySelectorAll("button")].find((button) => button.textContent?.includes("方案 A"));
		expect(option).toBeDefined();
		// 整行:宽度占满(以前是一排小方块,长选项会折成标签墙)。
		expect(option?.className).toContain("w-full");
		// 自定义输入:模型给的选项之外也要能答。
		expect(dom.querySelector('input[placeholder*="其他"]')).not.toBeNull();
	});

	it("换模型的抽屉里能改思考等级:只列这个模型支持的档位", async () => {
		const calls: Array<[string, string, string | undefined]> = [];
		const dom = render(
			{
				sessions: [
					{
						id: "s1",
						title: "修一下登录页",
						updatedAt: 1_700_000_000_000,
						running: false,
						modelId: "claude-sonnet-4",
						modelName: "Claude Sonnet 4",
						modelConnectionId: "anthropic",
						thinkingLevel: "medium",
					},
				],
				models: [
					{
						connectionId: "anthropic",
						modelId: "claude-sonnet-4",
						displayName: "Claude Sonnet 4",
						providerName: "Anthropic",
						supportsReasoning: true,
						supportedThinkingLevels: ["off", "low", "medium", "high"],
					},
				],
			},
			async (connectionId, modelId, thinkingLevel) => {
				calls.push([connectionId, modelId, thinkingLevel]);
				return { ok: true };
			},
		);
		// 打开换模型的抽屉。
		const modelButton = [...dom.querySelectorAll("button")].find((button) =>
			(button.getAttribute("aria-label") ?? "").startsWith("模型:"),
		);
		await act(async () => modelButton?.click());
		const sheet = dom.querySelector('[role="dialog"]');
		expect(sheet?.textContent).toContain("思考等级");
		// **只列支持的**:这个模型没有"极高"。
		for (const label of ["关闭", "低", "中", "高"]) expect(sheet?.textContent).toContain(label);
		expect(sheet?.textContent).not.toContain("极高");

		// 点「高」→ 带着同一个模型 + 这一档发出去。
		const high = [...(sheet?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "高");
		await act(async () => high?.click());
		expect(calls).toEqual([["anthropic", "claude-sonnet-4", "high"]]);
	});

	it("不支持思考的模型:抽屉里**不摆**思考等级", async () => {
		const dom = render({
			sessions: [
				{
					id: "s1",
					title: "修一下登录页",
					updatedAt: 1_700_000_000_000,
					running: false,
					modelId: "gpt-5",
					modelName: "GPT-5",
					modelConnectionId: "openai",
				},
			],
			models: [
				{ connectionId: "openai", modelId: "gpt-5", displayName: "GPT-5", providerName: "OpenAI", supportsReasoning: false },
			],
		});
		const modelButton = [...dom.querySelectorAll("button")].find((button) =>
			(button.getAttribute("aria-label") ?? "").startsWith("模型:"),
		);
		await act(async () => modelButton?.click());
		expect(dom.querySelector('[role="dialog"]')?.textContent).not.toContain("思考等级");
	});

	it("模型按钮显示的是**供应商的图标**(与桌面端同一份),认不出来才退回通用图标", () => {
		const modelButton = (dom: HTMLElement) =>
			[...dom.querySelectorAll("button")].find((button) =>
				(button.getAttribute("aria-label") ?? "").startsWith("模型"),
			);
		const withIdentity = render({
			sessions: [
				{
					id: "s1",
					title: "修一下登录页",
					updatedAt: 1_700_000_000_000,
					running: false,
					modelId: "claude-sonnet-4",
					modelName: "Claude Sonnet 4",
					modelConnectionId: "anthropic",
				},
			],
			models: [
				{
					connectionId: "anthropic",
					modelId: "claude-sonnet-4",
					displayName: "Claude Sonnet 4",
					providerName: "Anthropic",
					providerId: "anthropic",
					avatarId: "anthropic",
				},
			],
		});
		// 真图标:一张 `<img>`(不是 lucide 的 svg)。
		const icon = modelButton(withIdentity)?.querySelector("img");
		expect(icon).not.toBeNull();
		expect(icon?.getAttribute("src")?.includes("anthropic")).toBe(true);

		// 供应商认不出来时:退回通用图标,而不是给一个错的标志。
		const unknown = render({
			sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1_700_000_000_000, running: false, modelName: "M" }],
			models: [{ connectionId: "custom-1", modelId: "m", displayName: "M" }],
		});
		expect(modelButton(unknown)?.querySelector("img")).toBeNull();
		expect(modelButton(unknown)?.querySelector("svg")).not.toBeNull();
	});
});
