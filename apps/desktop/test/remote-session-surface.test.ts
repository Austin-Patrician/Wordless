import assert from "node:assert/strict";
import { describe, it } from "node:test";
// 期望值由**桌面端那一个实现**算出来 —— 两端各算一遍迟早会出现"同一个会话两个数"。
import { summarizeUsageMessages } from "@wordless/domain";
import {
	createRuntimeSessionSurface,
	mapRuntimeEvent,
	type RemoteRuntimePort,
	type RuntimeEnvelopeLike,
	type RuntimeSessionViewLike,
} from "../src/main/remote/session-surface.ts";
import type { RemoteSurfaceEvent } from "../src/main/remote/host-service.ts";

/**
 * 运行时适配器。
 *
 * 这里钉住三件事:**远端看到的是哈希而不是路径**、**只有对话相关的事被映射出去**、
 * **消息文本从块的类型里正确取出来**。
 */

const SESSION_PATH = "/Users/someone/Documents/机密项目/sessions/2026-10-01_abc.jsonl";

const record = (
	overrides: Partial<{
		id: string;
		title: string;
		updatedAt: number;
		journalPath: string;
		workspaceId: string | null;
		model: { connectionId?: string; modelId?: string };
		thinkingLevel: string;
		accessLevel: string;
		toolApprovalMode: string;
		connectorIds: readonly string[];
	}> = {},
) => ({
	id: "s1",
	title: "修一下登录页",
	updatedAt: 1_700_000_000_000,
	journalPath: SESSION_PATH,
	workspaceId: "w1",
	model: { connectionId: "anthropic", modelId: "claude-sonnet-4" },
	thinkingLevel: "medium",
	accessLevel: "full",
	toolApprovalMode: "manual",
	connectorIds: ["c1"],
	...overrides,
});

const view = (running = false): RuntimeSessionViewLike => ({
	session: record(),
	isRunning: running,
	history: {
		items: [
			{
				type: "turn",
				turn: {
					messages: [
						{ role: "user", timestamp: 1, blocks: [{ type: "text", text: "登录页报错了" }] },
						{
							role: "assistant",
							timestamp: 2,
							usage: {
								inputTokens: 10,
								outputTokens: 5,
								cacheReadTokens: 0,
								cacheWriteTokens: 0,
								totalTokens: 15,
								totalCost: 0.0005,
								modelId: "gpt-5",
							},
							blocks: [
								{ type: "reasoning", text: "想一下" },
								{ type: "text", text: "我看一下。" },
								{
									type: "tool",
									callId: "c1",
									name: "bash",
									state: "complete",
									output: "ok",
									// 委派(子代理/专家团)的用量挂在工具块上,算**同一轮**。
									usage: {
										inputTokens: 100,
										outputTokens: 20,
										cacheReadTokens: 0,
										cacheWriteTokens: 0,
										totalTokens: 120,
										totalCost: 0.001,
										modelId: "gpt-5",
									},
								},
								{ type: "tool", callId: "c2", name: "python", state: "error", output: "boom" },
								{ type: "tool", callId: "c3", name: "read", state: "running" },
								{ type: "attachment", text: "不该发出去" },
							],
						},
					],
				},
			},
			{
				type: "compaction",
				compaction: {
					trigger: "manual",
					tokensBefore: 120_000,
					tokensAfter: 8_000,
					model: { modelId: "gpt-5" },
					summary: "前面聊了登录页报错。",
					timestamp: 9,
				},
			},
		],
	},
});

interface FakeRuntime extends RemoteRuntimePort {
	readonly prompts: Array<{ sessionId: string; prompt: string }>;
	readonly cancels: string[];
	readonly created: Array<{ draft: Record<string, unknown>; prompt: string }>;
	readonly modelChanges: Array<{
		sessionId: string;
		connectionId: string;
		modelId: string;
		thinkingLevel?: string;
	}>;
	/** 换模型时抛错,模拟"运行时拒绝了"。 */
	setModelThrows: boolean;
	/** 正在跑的会话(可变:换模型的用例需要它空着)。 */
	runningSessionIds: string[];
}

const createFakeRuntime = (): FakeRuntime => {
	const prompts: Array<{ sessionId: string; prompt: string }> = [];
	const cancels: string[] = [];
	const created: Array<{ draft: Record<string, unknown>; prompt: string }> = [];
	const modelChanges: Array<{
		sessionId: string;
		connectionId: string;
		modelId: string;
		thinkingLevel?: string;
	}> = [];
	const runtime: FakeRuntime = {
		prompts,
		cancels,
		modelChanges,
		created,
		setModelThrows: false,
		runningSessionIds: ["s1"],
		createAndPrompt: async (draft, prompt) => {
			created.push({ draft, prompt });
			return record({ id: "s2" });
		},
		getSnapshot: () => ({
			entries: [
				{ id: "general-work", mode: "everyday", labelKey: "entryGeneralWork", descriptionKey: "entryGeneralWorkDescription", iconKey: "sparkles", workbenchId: "conversation", availability: "available" },
				{ id: "code-development", mode: "code", labelKey: "entryCodeDevelopment", descriptionKey: "entryCodeDevelopmentDescription", iconKey: "code", workbenchId: "code", availability: "available" },
				{ id: "image-generation", mode: "create", labelKey: "entryImageGeneration", descriptionKey: "entryImageGenerationDescription", iconKey: "image", workbenchId: "media-canvas", availability: "available", internal: true },
			],
			sessions: [record()],
			runningSessionIds: runtime.runningSessionIds,
			workspaces: [{ id: "w1", name: "登录页重构" }],
			connectors: {
				connectors: [
					{ id: "c1", name: "GitHub", enabled: true },
					{ id: "c2", name: "停用的", enabled: false },
				],
			},
			skills: { skills: [{ id: "s1", name: "周报", description: "写周报" }] },
			models: [
				{
					connectionId: "anthropic",
					modelId: "claude-sonnet-4",
					displayName: "Claude Sonnet 4",
					capabilities: { supportsReasoning: true, supportedThinkingLevels: ["off", "low", "medium", "high"] },
				},
				{ connectionId: "openai", modelId: "gpt-5", displayName: "GPT-5", capabilities: { supportsReasoning: false, supportedThinkingLevels: [] } },
			],
			connections: [
				{ id: "anthropic", displayName: "Anthropic", providerId: "anthropic", avatarId: "anthropic" },
				{ id: "openai", displayName: "OpenAI", providerId: "openai", avatarId: null },
			],
		}),
		getSessionView: async () => view(),
		setSessionInteractionMode: async () => undefined,
		resolveOperationApproval: async () => undefined,
		getSessionHistoryPage: async () => ({ items: view().history.items, nextBeforeCursor: "cursor-1" }),
		promptSession: async (sessionId, prompt) => {
			prompts.push({ sessionId, prompt });
		},
		cancelSession: async (sessionId) => {
			cancels.push(sessionId);
		},
		retrySessionTurn: async () => undefined,
		listExperts: () => [],
		getSessionTurnVersions: async () => ({}),
		compactSession: async () => undefined,
		selectSessionTurnVersion: async () => undefined,
		setSessionExpert: () => undefined,
		setSessionModel: async (sessionId, model, thinkingLevel) => {
			if (runtime.setModelThrows) throw new Error("The selected model is not enabled");
			modelChanges.push({ sessionId, ...model, ...(thinkingLevel === undefined ? {} : { thinkingLevel }) });
		},
		listSelectableSessionModels: () => [
			{
				connectionId: "anthropic",
				modelId: "claude-sonnet-4",
				displayName: "Claude Sonnet 4",
				capabilities: { supportsReasoning: true, supportedThinkingLevels: ["off", "low", "medium", "high"] },
			},
			{
				connectionId: "openai",
				modelId: "gpt-5",
				displayName: "GPT-5",
				capabilities: { supportsReasoning: false, supportedThinkingLevels: [] },
			},
		],
	};
	return runtime;
};

const createStream = () => {
	const listeners = new Set<(envelope: RuntimeEnvelopeLike) => void>();
	return {
		stream: {
			subscribe: (listener: (envelope: RuntimeEnvelopeLike) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		emit: (envelope: RuntimeEnvelopeLike) => {
			for (const listener of listeners) listener(envelope);
		},
	};
};

const setup = () => {
	const runtime = createFakeRuntime();
	const { stream, emit } = createStream();
	const surface = createRuntimeSessionSurface({
		runtime,
		events: stream,
		// 设计风格目录由主进程直接给(它是一份静态目录,不经过运行时)。
		designStyles: () => [{ id: "precise-dark", name: "深色精密", tagline: "密集、克制", vibe: "dark" as const }],
	});
	return { runtime, surface, emit };
};

describe("会话列表", () => {
	it("列出会话,顺序按最近更新在前", async () => {
		const { surface } = setup();
		const sessions = await surface.listSessions();
		assert.equal(sessions.length, 1);
		assert.equal(sessions[0].title, "修一下登录页");
		assert.equal(sessions[0].running, true);
	});

	it("对外的会话 id 是路径哈希,不是路径", async () => {
		const { surface } = setup();
		const [session] = await surface.listSessions();
		assert.match(session.id, /^[0-9a-f]{32}$/);
		assert.equal(session.id.includes("机密项目"), false);
		assert.equal(JSON.stringify(session).includes("/Users/"), false);
	});

	it("同一个会话每次都得到同一个 id(远端才能稳定引用它)", async () => {
		const { surface } = setup();
		const first = await surface.listSessions();
		const second = await surface.listSessions();
		assert.equal(first[0].id, second[0].id);
	});
});

describe("打开会话", () => {
	it("只取文本块作为消息正文(思考块不进正文)", async () => {
		const { surface } = setup();
		const [session] = await surface.listSessions();
		const detail = await surface.openSession(session.id);
		assert.deepEqual(
			detail?.messages.filter((message) => message.role !== "compaction").map((message) => message.text),
			["登录页报错了", "我看一下。"],
		);
		assert.deepEqual(
			detail?.messages.filter((message) => message.role !== "compaction").map((message) => message.role),
			["user", "assistant"],
		);
	});

	it("思考与工具执行也要发出去 —— 远端内容不完整就是这里漏的", async () => {
		const { surface } = setup();
		const [session] = await surface.listSessions();
		const detail = await surface.openSession(session.id);
		const blocks = detail?.messages.find((message) => message.role === "assistant")?.blocks ?? [];
		assert.deepEqual(
			blocks.map((block) => block.type),
			["reasoning", "text", "tool", "tool", "tool"],
		);
		// 三种工具状态归一到远端只关心的三种。
		assert.deepEqual(
			blocks.flatMap((block) => (block.type === "tool" ? [block.state] : [])),
			["done", "failed", "running"],
		);
		// 远端不做的块(附件等)不发 —— 发过去它只会渲染出一堆自己解释不了的东西。
		assert.equal(JSON.stringify(blocks).includes("不该发出去"), false);
	});

	it("本轮用量**按整轮**算,而且与桌面端是同一个实现(含委派调用)", async () => {
		// 真实抱怨:同一轮在两端数字不一样。根因是这里只算了助手消息自己的用量,
		// 而委派(子代理 / 专家团)的用量挂在**工具块**上 —— 桌面端把它算进同一轮。
		const { surface } = setup();
		const [session] = await surface.listSessions();
		const detail = await surface.openSession(session.id);
		const assistant = detail?.messages.find((message) => message.role === "assistant");
		assert.ok(assistant?.usage, "本轮用量要有");
		// 期望值由**桌面端那一个实现**算出来(不是这边手写的数字)。
		const expected = summarizeUsageMessages([
			{
				role: "assistant",
				timestamp: 2,
				usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15, totalCost: 0.0005, modelId: "gpt-5" },
				blocks: [
					{
						type: "tool",
						callId: "c1",
						name: "bash",
						state: "complete",
						usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 120, totalCost: 0.001, modelId: "gpt-5" },
					},
				],
			},
		] as never);
		assert.equal(assistant.usage.modelCalls, expected?.summary.modelCalls);
		assert.equal(assistant.usage.delegatedCalls, 1, "委派那一次要算进来");
		assert.equal(assistant.usage.inputTokens, expected?.summary.inputTokens);
		assert.equal(assistant.usage.totalTokens, expected?.summary.totalTokens);
		assert.equal(assistant.usage.totalCost, expected?.summary.totalCost);
	});

	it("压缩上下文那一行要发出去:原因、前后 token、模型、摘要", async () => {
		// 桌面端把它画成时间线上的一行;远端原来**整条丢掉** —— 用户在手机上点了"压缩上下文"什么也看不见。
		const { surface } = setup();
		const [session] = await surface.listSessions();
		const detail = await surface.openSession(session.id);
		const compaction = detail?.messages.find((message) => message.role === "compaction");
		assert.ok(compaction, "压缩那一行必须存在");
		const block = compaction.blocks?.[0];
		assert.equal(block?.type, "compaction");
		assert.equal(block?.type === "compaction" ? block.trigger : undefined, "manual");
		assert.equal(block?.type === "compaction" ? block.tokensBefore : undefined, 120_000);
		assert.equal(block?.type === "compaction" ? block.tokensAfter : undefined, 8_000);
		assert.equal(block?.type === "compaction" ? block.modelId : undefined, "gpt-5");
		// 它不是"谁说的话":没有身份行、没有底部操作行。
		assert.equal(compaction.text, "");
	});

	it("自动压缩(没人会去重拉)也要**主动推**一条", async () => {
		const { surface, emit } = setup();
		// 先列一次会话:会话面按"列出来的那些"建真实 id ↔ 公开 id 的映射,事件才认得出是哪个会话。
		await surface.listSessions();
		const seen: unknown[] = [];
		surface.subscribe((event) => seen.push(event));
		emit({
			sessionId: "s1",
			event: {
				type: "context.compaction.completed",
				compaction: {
					trigger: "overflow",
					tokensBefore: 200_000,
					tokensAfter: 9_000,
					model: { modelId: "gpt-5" },
					summary: "摘要",
					timestamp: 12,
				},
			},
		});
		const pushed = seen.find((event) => (event as { type: string }).type === "message");
		assert.ok(pushed, "必须推一条 message 事件");
		const message = (pushed as { message: { role: string; blocks?: readonly { type: string }[] } }).message;
		assert.equal(message.role, "compaction");
		assert.equal(message.blocks?.[0]?.type, "compaction");
	});

	it("读不出来的压缩记录不发(宁可不发,也不发一行读不出来的)", async () => {
		const { surface, emit } = setup();
		await surface.listSessions();
		const seen: unknown[] = [];
		surface.subscribe((event) => seen.push(event));
		emit({ sessionId: "s1", event: { type: "context.compaction.completed", compaction: { trigger: "??" } } });
		assert.equal(seen.length, 0);
	});

	it("正文仍然只由 text 块组成(便于快速复制与降级显示)", async () => {
		const { surface } = setup();
		const [session] = await surface.listSessions();
		const detail = await surface.openSession(session.id);
		assert.equal(detail?.messages.find((message) => message.role === "assistant")?.text, "我看一下。");
	});

	it("会话设置只读透出:模型 / 权限模式 / 连接器数量", async () => {
		const { surface } = setup();
		const [session] = await surface.listSessions();
		assert.equal(session.modelId, "claude-sonnet-4");
		assert.equal(session.accessLevel, "full");
		assert.equal(session.toolApprovalMode, "manual");
		assert.equal(session.connectorCount, 1);
		// 连接器只给数量,不给 id —— 远端不需要知道具体连了谁。
		// 注意:不能用 `includes("c1")` 这种子串断言 —— 会话 id 是哈希,碰巧会包含 "c1"。
		assert.equal("connectorIds" in session, false);
		assert.equal(Object.values(session).includes("c1" as never), false);
	});

	it("认不出来的取值不发出去(而不是原样透传)", async () => {
		const runtime = {
			listExperts: () => [],
			getSessionTurnVersions: async () => ({}),
			getSnapshot: () => ({
				sessions: [record({ accessLevel: "whatever", toolApprovalMode: "nonsense" } as never)],
				runningSessionIds: [],
			}),
			getSessionView: async () => view(),
			getSessionHistoryPage: async () => ({ items: view().history.items }),
			promptSession: async () => undefined,
			cancelSession: async () => undefined,
		};
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({ runtime, events: stream });
		const [session] = await surface.listSessions();
		assert.equal(session.accessLevel, undefined);
		assert.equal(session.toolApprovalMode, undefined);
	});

	it("会话带上空间归属,但**不带路径**", async () => {
		const { surface } = setup();
		const [session] = await surface.listSessions();
		assert.equal(session.workspaceId, "w1");
		assert.equal(session.workspaceName, "登录页重构");
		assert.equal(JSON.stringify(session).includes("/Users/"), false);
		assert.equal(JSON.stringify(session).includes("机密项目"), false);
	});

	it("用哈希 id 就能打开(适配器自己换回真实 id)", async () => {
		const { surface, runtime } = setup();
		const [session] = await surface.listSessions();
		const detail = await surface.openSession(session.id);
		assert.equal(detail?.summary.id, session.id);
		assert.equal(runtime.prompts.length, 0);
	});

	it("未知会话返回 undefined,不抛错", async () => {
		const { surface } = setup();
		assert.equal(await surface.openSession("0".repeat(32)), undefined);
	});

	it("分页返回游标", async () => {
		const { surface } = setup();
		const [session] = await surface.listSessions();
		const page = await surface.historyPage(session.id);
		assert.equal(page.cursor, "cursor-1");
		// 两条消息 + 压缩那一行(压缩也是时间线上的一条)。
		assert.equal(page.messages.length, 3);
	});
});

describe("发消息与中断", () => {
	it("发消息走运行时的 promptSession,用真实 id", async () => {
		const { surface, runtime } = setup();
		const [session] = await surface.listSessions();
		await surface.prompt(session.id, "帮我看一下");
		assert.deepEqual(runtime.prompts, [{ sessionId: "s1", prompt: "帮我看一下" }]);
	});

	it("中断走运行时的 cancelSession", async () => {
		const { surface, runtime } = setup();
		const [session] = await surface.listSessions();
		await surface.abort(session.id);
		assert.deepEqual(runtime.cancels, ["s1"]);
	});
});

describe("事件映射", () => {
	it("运行状态、助手消息、工具执行会被映射出去", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		const [session] = await surface.listSessions();

		emit({ sessionId: "s1", event: { type: "run.started" } });
		emit({
			sessionId: "s1",
			event: {
				type: "message.completed",
				message: { role: "assistant", timestamp: 5, blocks: [{ type: "text", text: "跑完了" }] },
			},
		});
		emit({ sessionId: "s1", event: { type: "tool.started", name: "bash" } });
		emit({ sessionId: "s1", event: { type: "tool.completed", name: "bash", output: "ok" } });
		emit({ sessionId: "s1", event: { type: "run.completed" } });

		assert.deepEqual(
			received.map((event) => event.type),
			["state", "message", "tool", "tool", "state"],
		);
		assert.deepEqual(
			received.map((event) => ("sessionId" in event ? event.sessionId : "")),
			[session.id, session.id, session.id, session.id, session.id],
		);
		assert.equal(received[0].type === "state" ? received[0].running : undefined, true);
		// 工具事件带上状态:开始/更新是 running,完成是 done。
		const toolStates = received.flatMap((event) => (event.type === "tool" ? [event.state] : []));
		assert.deepEqual(toolStates, ["running", "done"]);
		assert.equal(received[4].type === "state" ? received[4].running : undefined, false);
	});

	it("只调工具、没有正文的那一段**也要发**:远端靠它收尾", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({
			sessionId: "s1",
			event: {
				type: "message.completed",
				message: {
					id: "m1",
					role: "assistant",
					status: "complete",
					timestamp: 5,
					blocks: [{ type: "tool", callId: "c1", name: "bash", state: "complete", input: { command: "npm test" }, output: "ok" }],
				},
			},
		});
		const message = received.find((event) => event.type === "message");
		assert.ok(message && message.type === "message");
		// 正文是空的,但**块在** —— 远端据此画出这一段,并把那条流式文本收尾。
		assert.equal(message.message.text, "");
		assert.equal(message.message.blocks?.length, 1);
	});

	it("既没有正文也没有块:那才是真的没内容,不发", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({
			sessionId: "s1",
			event: { type: "message.completed", message: { id: "m1", role: "assistant", timestamp: 5, blocks: [] } },
		});
		assert.deepEqual(received, []);
	});

	it("超长正文会被封顶(整条超了单帧上限就会被丢,而对端会一直等它)", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({
			sessionId: "s1",
			event: {
				type: "message.completed",
				message: { id: "m1", role: "assistant", timestamp: 5, blocks: [{ type: "text", text: "字".repeat(200_000) }] },
			},
		});
		const message = received.find((event) => event.type === "message");
		assert.ok(message && message.type === "message");
		assert.ok(message.message.text.length <= 20_100, `正文没有被封顶:${message.message.text.length}`);
		assert.ok(JSON.stringify(message.message).length <= 130_000);
	});

	it("工具更新/完成帧没有名字:按 callId 补上(以前一律显示成\"工具\")", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		// 运行时的"开始"帧带名字与 callId,"完成"帧**只有 callId**。
		emit({ sessionId: "s1", event: { type: "tool.started", callId: "c1", name: "bash", input: { command: "npm test", timeout: 30 } } });
		emit({ sessionId: "s1", event: { type: "tool.completed", callId: "c1", output: "ok" } });
		const tools = received.filter((event) => event.type === "tool");
		assert.deepEqual(
			tools.map((event) => (event.type === "tool" ? [event.name, event.callId, event.state] : [])),
			[
				["bash", "c1", "running"],
				["bash", "c1", "done"],
			],
		);
		// 参数**只发一行、只发命令**:以前是带换行的 JSON(连 timeout 一起),手机上顶出横向滚动条。
		assert.equal(tools[0].type === "tool" ? tools[0].args : undefined, "npm test");
	});

	it("名字与 callId 都没有:不发这一条(远端认不出是哪一次调用,只能摆一行\"工具\")", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({ sessionId: "s1", event: { type: "tool.completed", output: "ok" } });
		assert.deepEqual(received, []);
	});

	it("有 callId 但没有名字:照发 —— 远端按 callId 认领它已经画出来的那一行", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({ sessionId: "s1", event: { type: "tool.completed", callId: "c9", output: "ok" } });
		const tool = received.find((event) => event.type === "tool");
		assert.ok(tool && tool.type === "tool");
		assert.equal(tool.name, undefined);
		assert.equal(tool.callId, "c9");
		assert.equal(tool.state, "done");
	});

	it("实时事件带上 turn id:远端靠它把内容归到正确的一轮", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({
			sessionId: "s1",
			turnId: "turn:u2",
			event: { type: "message.completed", message: { id: "m1", role: "assistant", timestamp: 5, blocks: [{ type: "text", text: "新一轮" }] } },
		});
		emit({ sessionId: "s1", turnId: "turn:u2", event: { type: "message.started", message: { id: "m1", role: "assistant" } } });
		emit({ sessionId: "s1", turnId: "turn:u2", event: { type: "message.text.delta", messageId: "m1", delta: "写" } });
		emit({ sessionId: "s1", turnId: "turn:u2", event: { type: "tool.started", callId: "c1", name: "bash" } });
		assert.deepEqual(
			received.map((event) =>
				event.type === "message" ? event.message.turnId
					: event.type === "delta" ? event.turnId
						: event.type === "tool" ? event.turnId
							: undefined,
			),
			["turn:u2", "turn:u2", "turn:u2"],
		);
	});

	it("思考也能流式:带 kind,而且与正文各算各的", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({ sessionId: "s1", event: { type: "message.started", message: { id: "m1", role: "assistant" } } });
		emit({ sessionId: "s1", event: { type: "message.reasoning.delta", messageId: "m1", delta: "想一下" } });
		emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "开始写" } });
		const deltas = received.filter((event) => event.type === "delta");
		assert.deepEqual(
			deltas.map((event) => (event.type === "delta" ? [event.kind, event.text] : [])),
			[
				["reasoning", "想一下"],
				["text", "开始写"],
			],
		);
	});

	it("语义不确定的事件一律不映射(远端只做对话)", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		for (const type of [
			"context.compaction.started",
			"context.compaction.completed",
			"model.retry.scheduled",
			"artifact.changed",
			"expert-member.tool.started",
			"preferences.changed",
		]) {
			emit({ sessionId: "s1", event: { type } });
		}
		assert.deepEqual(received, []);
	});

	it("没有会话归属的事件不会被当成某个会话的事", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		emit({ sessionId: null, event: { type: "run.started" } });
		emit({ sessionId: "unknown-session", event: { type: "run.started" } });
		assert.deepEqual(received, []);
	});

	it("映射是纯函数,可以直接断言", () => {
		const map = new Map([["s1", "hash-1"]]);
		assert.deepEqual(mapRuntimeEvent({ sessionId: "s1", event: { type: "run.started" } }, map), {
			type: "state",
			sessionId: "hash-1",
			running: true,
			activity: "思考中",
		});
		assert.equal(mapRuntimeEvent({ sessionId: "s1", event: { type: "context.usage.updated" } }, map), undefined);
	});

	it("取消订阅之后不再收到事件", async () => {
		const { surface, emit } = setup();
		const received: RemoteSurfaceEvent[] = [];
		const unsubscribe = surface.subscribe((event) => received.push(event));
		await surface.listSessions();
		unsubscribe();
		emit({ sessionId: "s1", event: { type: "run.started" } });
		assert.deepEqual(received, []);
	});

describe("换模型(b 档)", () => {
	it("打开会话时带上可选模型清单:只有 id、显示名、供应商名", async () => {
		const { surface } = setup();
		// 远端只认它在列表里见过的 id,所以先列一次再打开。
		const [listed] = await surface.listSessions();
		const opened = await surface.openSession(listed.id);
		assert.deepEqual(opened?.models, [
			// 供应商身份只用来挑图标:`avatarId` 是用户挑的,`providerId` 是按供应商取的默认。
			{
				connectionId: "anthropic",
				modelId: "claude-sonnet-4",
				displayName: "Claude Sonnet 4",
				providerName: "Anthropic",
				providerId: "anthropic",
				avatarId: "anthropic",
				// 思考档位:远端据此"只列这个模型支持的"。
				supportsReasoning: true,
				supportedThinkingLevels: ["off", "low", "medium", "high"],
			},
			// 用户没挑头像(avatarId 为空)时就只有 providerId —— 远端按默认图标显示。
			// 不支持思考的模型带上 `supportsReasoning: false`,界面据此**不摆**那个控件。
			{
				connectionId: "openai",
				modelId: "gpt-5",
				displayName: "GPT-5",
				providerName: "OpenAI",
				providerId: "openai",
				supportsReasoning: false,
			},
		]);
		// 清单里**不该有**供应商地址之类的私密东西。
		assert.equal(JSON.stringify(opened?.models).includes("http"), false);
	});

	it("新建会话页的那一份:不摆 internal 的入口,需要工作目录的**标出来**(而不是标成不可用)", async () => {
		const { surface } = setup();
		const { entries } = await surface.listCatalog();
		assert.deepEqual(
			entries.map((entry) => [entry.id, entry.name, entry.available, entry.requiresWorkspace ?? false]),
			[
				// 代码开发必须有工作目录 —— 远端**现在能选目录了**(见 `workspaces`),
				// 所以入口本身是可用的,只是要等用户挑一个目录(界面据此先摆着)。
				["code-development", "代码开发", true, true],
				["general-work", "通用工作", true, false],
			],
		);
		// `internal` 的那个(媒体工作台按 id 取它建会话)不该出现在新建页。
		assert.equal(entries.some((entry) => entry.id === "image-generation"), false);
	});

	it("新建会话页带上**分栏**:只发真有入口的那些(空标签页比没有更糟)", async () => {
		const { surface } = setup();
		const { entries, modes } = await surface.listCatalog();
		// 夹具里只有 everyday 与 code 两个模式有入口,create 不该出现。
		assert.deepEqual(modes, [
			{ id: "everyday", name: "日常工作", iconKey: "sparkles" },
			{ id: "code", name: "写代码", iconKey: "code" },
		]);
		// 每个入口自己带着属于哪一栏(远端据此分组)。
		assert.deepEqual(entries.map((entry) => entry.mode), ["code", "everyday"]);
	});

	it("新建会话页带上**能选的模型**(与「这个会话能换哪些」不是同一份:那份要按入口筛)", async () => {
		const { surface } = setup();
		const catalog = await surface.listCatalog();
		// 只给显示需要的几样 + 能力(思考档位按值域收一道)—— 不给地址、不给密钥。
		assert.deepEqual(
			catalog.models.map((model) => [model.connectionId, model.modelId, model.displayName]),
			[
				["anthropic", "claude-sonnet-4", "Claude Sonnet 4"],
				["openai", "gpt-5", "GPT-5"],
			],
		);
	});

	it("新建会话页也带上**能选的工作目录**与**设计风格**(与桌面端 WelcomeView 同一份来源)", async () => {
		const { surface } = setup();
		const catalog = await surface.listCatalog();
		// 只给 id / 名字 / 还在不在 —— **路径不出本机**。
		assert.deepEqual(catalog.workspaces, [{ id: "w1", name: "登录页重构", available: true }]);
		// 设计风格:只给 id / 名字 / 一句话 / 明暗(那套 theme.css 好几 KB,手机不画真示例页)。
		assert.deepEqual(catalog.designStyles, [
			{ id: "precise-dark", name: "深色精密", tagline: "密集、克制", vibe: "dark" },
		]);
	});

	it("新建会话页也带上连接器与技能(它们本来就是\"这一轮怎么干活\"的一部分)", async () => {
		const { surface } = setup();
		const catalog = await surface.listCatalog();
		// 连接器只列**已启用**的(与"这个会话能连什么"同一份判断)。
		assert.deepEqual(catalog.connectors.map((connector) => connector.id), ["c1"]);
		assert.deepEqual(catalog.skills.map((skill) => skill.name), ["周报"]);
	});

	it("新建会话:**带工作目录**(代码这一类必须有,本机校验它存在且可用)", async () => {
		const { runtime, surface } = setup();
		const [general] = (await surface.listSessions()).slice(0, 1);
		assert.ok(general);
		const created = await surface.createSession({
			entryId: "code-development",
			text: "看一下这个仓库",
			workspaceId: "w1",
		});
		assert.ok(created, "给了可用目录就该建得出来");
		assert.equal(runtime.created.at(-1)?.draft.workspaceId, "w1");
	});

	it("需要目录的那一类:**没给目录就不建**(而不是随便挑一个)", async () => {
		const { runtime, surface } = setup();
		assert.equal(await surface.createSession({ entryId: "code-development", text: "看一下" }), undefined);
		// 给一个本机不认识的 id 也一样 —— 猜一个目录等于把活干在别的地方。
		assert.equal(
			await surface.createSession({ entryId: "code-development", text: "看一下", workspaceId: "没有这个目录" }),
			undefined,
		);
		assert.deepEqual(runtime.created, []);
	});

	it("设计风格:**随首条消息**发出去(与桌面端 WelcomeView 同一条路)", async () => {
		const { runtime, surface } = setup();
		// 认不出来的风格 id 当"没选"(而不是整条拒掉)。
		await surface.createSession({ entryId: "general-work", text: "做个页面", designStyleId: "没有这个风格" });
		assert.equal(runtime.created.at(-1)?.prompt, "做个页面");
	});

	it("新建会话:两条路合成一次调用(入口 + 第一条消息),并回读新会话的摘要", async () => {
		const { runtime, surface } = setup();
		const summary = await surface.createSession({ entryId: "general-work", text: "帮我写周报" });
		assert.equal(summary?.id, "eb1cc1f920d9c261d6fa33f6fabeb620");
		assert.equal(runtime.created.length, 1);
		assert.equal(runtime.created[0]?.prompt, "帮我写周报");
		// 模式跟着入口走(运行时会校验"入口属于这个模式");目录与权限**不替用户决定**。
		assert.equal(runtime.created[0]?.draft.mode, "everyday");
		assert.equal(runtime.created[0]?.draft.workspaceId, null);
		assert.equal(runtime.created[0]?.draft.accessLevel, "default");
	});

	it("新建会话:需要工作目录的那类**不发请求**,如实回 undefined", async () => {
		const { runtime, surface } = setup();
		const summary = await surface.createSession({ entryId: "code-development", text: "改个 bug" });
		assert.equal(summary, undefined);
		assert.equal(runtime.created.length, 0, "不该真的去建");
	});

	it("思考等级会真的传给运行时(不然就是\"界面上选了、电脑上没变\")", async () => {
		const { runtime, surface } = setup();
		runtime.runningSessionIds = [];
		const [listed] = await surface.listSessions();
		const result = await surface.setModel(listed.id, { connectionId: "anthropic", modelId: "claude-sonnet-4" }, "high");
		assert.equal(result.ok, true);
		assert.deepEqual(runtime.modelChanges.at(-1), {
			sessionId: "s1",
			connectionId: "anthropic",
			modelId: "claude-sonnet-4",
			thinkingLevel: "high",
		});
	});

	it("摘要里带上当前的思考等级", async () => {
		const { surface } = setup();
		const [listed] = await surface.listSessions();
		assert.equal(listed.thinkingLevel, "medium");
	});

	it("摘要里带上模型的人类名字,以及它挂在哪个连接上", async () => {
		const { surface } = setup();
		const [listed] = await surface.listSessions();
		assert.equal(listed.modelId, "claude-sonnet-4");
		assert.equal(listed.modelName, "Claude Sonnet 4");
		// 连接 id 是给远端"认出清单里哪个是当前"用的(只按 modelId 认会认错同名模型)。
		assert.equal(listed.modelConnectionId, "anthropic");
	});

	it("换成功时回读真实状态,而不是把请求参数当结果", async () => {
		const { runtime, surface } = setup();
		runtime.runningSessionIds = [];
		const [listed] = await surface.listSessions();
		const result = await surface.setModel(listed.id, { connectionId: "openai", modelId: "gpt-5" });
		assert.equal(result.ok, true);
		assert.deepEqual(runtime.modelChanges, [{ sessionId: "s1", connectionId: "openai", modelId: "gpt-5" }]);
		assert.equal(result.ok && result.summary.modelId, "claude-sonnet-4");
	});

	it("正在回复中:说 busy,而不是去动运行时", async () => {
		const { runtime, surface } = setup();
		const [listed] = await surface.listSessions();
		const result = await surface.setModel(listed.id, { connectionId: "openai", modelId: "gpt-5" });
		assert.deepEqual(result, { ok: false, reason: "busy" });
		assert.deepEqual(runtime.modelChanges, []);
	});

	it("清单里没有的模型:说 unavailable,也不去动运行时", async () => {
		const { runtime, surface } = setup();
		runtime.runningSessionIds = [];
		const [listed] = await surface.listSessions();
		const result = await surface.setModel(listed.id, { connectionId: "anthropic", modelId: "没见过的模型" });
		assert.deepEqual(result, { ok: false, reason: "unavailable" });
		assert.deepEqual(runtime.modelChanges, []);
	});

	it("运行时真的抛错时:说 failed(而不是把它说成模型不可用)", async () => {
		const { runtime, surface } = setup();
		runtime.runningSessionIds = [];
		runtime.setModelThrows = true;
		const [listed] = await surface.listSessions();
		const result = await surface.setModel(listed.id, { connectionId: "openai", modelId: "gpt-5" });
		assert.deepEqual(result, { ok: false, reason: "failed" });
	});

	it("远端拿没见过的 id 来换模型:not_found(哈希这层不兜底)", async () => {
		const { surface } = setup();
		assert.deepEqual(await surface.setModel("not-a-real-hash", { connectionId: "openai", modelId: "gpt-5" }), {
			ok: false,
			reason: "not_found",
		});
	});

	it("会话列表变了会被映射出去 —— 否则远端会一直显示旧模型", () => {
		// 这一类事件的 sessionId 是 null,所以必须能穿过"必须带 sessionId"那道门。
		assert.deepEqual(mapRuntimeEvent({ sessionId: null, event: { type: "sessions.changed" } }, new Map()), {
			type: "sessions-changed",
		});
	});
});

describe("大会话不能把一帧撑爆(用户报过:一打开大会话就掉线)", () => {
	/** 造一个"很大"的历史:每条消息都带一大段正文和思考。 */
	const bigView = (): RuntimeSessionViewLike => ({
		session: record(),
		isRunning: false,
		history: {
			items: [
				{
					type: "turn",
					turn: {
						messages: Array.from({ length: 80 }, (_, index) => ({
							role: "assistant" as const,
							timestamp: index + 1,
							blocks: [
								{ type: "text", text: "正文".repeat(20_000) },
								{ type: "reasoning", text: "思考".repeat(20_000) },
							],
						})),
					},
				},
			],
		},
	});

	it("打开会话只发最近一段,并且整包**远低于**单帧上限", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionView: async () => bigView(),
				getSessionHistoryPage: async () => ({ items: bigView().history.items, nextBeforeCursor: "更早的游标" }),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.ok(detail);
		// 这一条断言就是那个 bug 的回归:超过 1_500_000 的话,对端会判为非法帧并断开链路。
		const size = JSON.stringify(detail).length;

		assert.ok(size < 1_500_000, `一帧装不下:${size}`);
		assert.ok(size <= 600_000, `留足密封膨胀的余量:${size}`);
		// 预算之内能装多少装多少;关键是**不是全部**,而且体积安全。
		assert.ok(detail.messages.length > 0, "至少留一条(一条都没有的话远端只能显示空白)");
		assert.ok(detail.messages.length < 80, "不能把整段历史都发过去");
		assert.equal(detail.truncated, true, "要**明说**只发了最近一部分");
	});

	it("超长的单块会被截断,并且明说截断了", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionView: async () => bigView(),
				getSessionHistoryPage: async () => ({ items: bigView().history.items }),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		const block = detail?.messages[0]?.blocks[0];
		assert.equal(block?.type, "text");
		assert.ok((block?.text ?? "").length < 30_000, "单块必须被截断");
		assert.match(block?.text ?? "", /已截断/);
	});

	it("整页都发得下时:把运行时的游标交出去,远端可以往回翻", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionHistoryPage: async () => ({
					items: view().history.items,
					nextBeforeCursor: "cursor-1",
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.equal(detail?.cursor, "cursor-1");
		assert.equal(detail?.truncated, undefined);
	});
});

describe("上下文用量(P4)", () => {
	const usage = {
		usedTokens: 24_000,
		contextWindow: 200_000,
		source: "estimate",
		categories: { systemPrompt: 2_000, toolsAndSubagents: 4_000, conversation: 10_000, connectors: 6_000, skills: 2_000 },
	};

	it("打开会话带上用量(视图里本来就带着,不用再问一次)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, getSessionView: async () => ({ ...view(), contextUsage: usage }) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.equal(detail?.summary.context?.usedTokens, 24_000);
		assert.equal(detail?.summary.context?.contextWindow, 200_000);
		assert.equal(detail?.summary.context?.categories?.conversation, 10_000);
	});

	it("认不出来的来源不发出去(界面会照它写文案)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, getSessionView: async () => ({ ...view(), contextUsage: { ...usage, source: "猜的" } }) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.equal(detail?.summary.context?.source, undefined);
		assert.equal(detail?.summary.context?.usedTokens, 24_000, "来源认不出来,但数字照发");
	});

	it("窗口为 0 时干脆不给用量(否则百分比会算出 Infinity)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, getSessionView: async () => ({ ...view(), contextUsage: { ...usage, contextWindow: 0 } }) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.equal(detail?.summary.context, undefined);
	});

	it("本机更新用量时会推一条事件出去", async () => {
		const { surface, emit } = setup();
		const seen: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => seen.push(event));
		// 先让远端"见过"这个会话(哈希映射只认自己发出去的 id)。
		const [listed] = await surface.listSessions();
		emit({ sessionId: "s1", event: { type: "context.usage.updated", contextUsage: usage } });
		assert.deepEqual(seen, [{ type: "context", sessionId: listed.id, context: usage }]);
	});

	it("用量更新里的坏数据不发(窗口 0)", async () => {
		const { surface, emit } = setup();
		const seen: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => seen.push(event));
		await surface.listSessions();
		emit({ sessionId: "s1", event: { type: "context.usage.updated", contextUsage: { ...usage, contextWindow: 0 } } });
		assert.deepEqual(seen, []);
	});
});

describe("流式文字(P7)", () => {
	const setupStream = () => {
		let clock = 0;
		const runtime = createFakeRuntime();
		const { stream, emit } = createStream();
		const surface = createRuntimeSessionSurface({ runtime, events: stream, now: () => clock });
		const seen: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => seen.push(event));
		return {
			surface,
			emit,
			seen,
			advance: (ms: number) => {
				clock += ms;
			},
		};
	};

	it("吐字期间发的是**累积文本**,不是增量", async () => {
		const rig = setupStream();
		const [listed] = await rig.surface.listSessions();
		rig.emit({ sessionId: "s1", event: { type: "message.started", message: { id: "m1", role: "assistant" } } });
		rig.advance(200);
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "你" } });
		rig.advance(200);
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "好" } });
		rig.advance(200);
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "呀" } });
		const texts = rig.seen.filter((event) => event.type === "delta").map((event) => event.text);
		// 起始帧**不发**(空帧会在远端留下空气泡):第一帧就是第一个字。
		assert.deepEqual(texts, ["你", "你好", "你好呀"]);
		assert.deepEqual(
			rig.seen.filter((event) => event.type === "delta").map((event) => event.messageId),
			["m1", "m1", "m1"],
		);
		assert.equal(rig.seen[0]?.sessionId, listed.id, "对外只用哈希过的会话 id");
	});

	it("节流:100ms 内的多帧只发一帧,但内容不丢(下一帧带上全部)", async () => {
		const rig = setupStream();
		await rig.surface.listSessions();
		rig.emit({ sessionId: "s1", event: { type: "message.started", message: { id: "m1", role: "assistant" } } });
		rig.advance(200);
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "一" } });
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "二" } });
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "三" } });
		const texts = rig.seen.filter((event) => event.type === "delta").map((event) => event.text);
		assert.deepEqual(texts, ["一"], "被闸门挡住的帧不发");
		rig.advance(200);
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "四" } });
		assert.equal(rig.seen.filter((event) => event.type === "delta").at(-1)?.text, "一二三四", "下一帧带上被挡住的全部内容");
	});

	it("完成之后累积器清掉:下一条消息从头开始,不会接在上一句后面", async () => {
		const rig = setupStream();
		await rig.surface.listSessions();
		rig.emit({ sessionId: "s1", event: { type: "message.started", message: { id: "m1", role: "assistant" } } });
		rig.advance(200);
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m1", delta: "第一句" } });
		rig.emit({
			sessionId: "s1",
			event: {
				type: "message.completed",
				message: { role: "assistant", timestamp: 5, blocks: [{ type: "text", text: "第一句" }] },
			},
		});
		rig.advance(200);
		rig.emit({ sessionId: "s1", event: { type: "message.text.delta", messageId: "m2", delta: "第二句" } });
		const last = rig.seen.filter((event) => event.type === "delta").at(-1);
		assert.equal(last?.text, "第二句", "不能变成 第一句第二句");
	});
});

describe("工具参数(P7 修:先命令、再参数、再输出)", () => {
	it("消息里的工具块带上参数(压成一段可读文本)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionHistoryPage: async () => ({
					items: [
						{
							type: "turn",
							turn: {
								messages: [
									{
										role: "assistant",
										timestamp: 1,
										blocks: [
											{
												type: "tool",
												callId: "c1",
												name: "bash",
												state: "complete",
												input: { command: "npm test" },
												output: "全部通过",
											},
										],
									},
								],
							},
						},
					],
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		const block = detail?.messages[0]?.blocks[0];
		assert.equal(block?.type, "tool");
		assert.match(block?.type === "tool" ? (block.args ?? "") : "", /npm test/);
		assert.equal(block?.type === "tool" ? block.detail : undefined, "全部通过");
	});

	it("没有参数时不硬塞一个空串", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionHistoryPage: async () => ({
					items: [
						{
							type: "turn",
							turn: {
								messages: [
									{
										role: "assistant",
										timestamp: 1,
										blocks: [{ type: "tool", callId: "c1", name: "ls", state: "complete", input: {} }],
									},
								],
							},
						},
					],
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		const block = detail?.messages[0]?.blocks[0];
		assert.equal(block?.type === "tool" ? block.args : "x", undefined);
	});

	it("流式不再发空的起始帧(空气泡就是这么来的)", async () => {
		const { surface, emit } = setup();
		const seen: RemoteSurfaceEvent[] = [];
		surface.subscribe((event) => seen.push(event));
		await surface.listSessions();
		emit({ sessionId: "s1", event: { type: "message.started", message: { id: "m1", role: "assistant" } } });
		assert.deepEqual(seen, [], "只登记,不发帧");
	});
});

describe("重做某一轮(P7.8)", () => {
	it("把消息 id 与用量一起发给远端(底部操作行要用)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionHistoryPage: async () => ({
					items: [
						{
							type: "turn",
							turn: {
								messages: [
									{
										id: "m1",
										role: "assistant",
										timestamp: 1,
										usage: {
											inputTokens: 12_345,
											outputTokens: 678,
											cacheReadTokens: 0,
											cacheWriteTokens: 0,
											totalTokens: 13_023,
											totalCost: 0.01,
										},
										blocks: [{ type: "text", text: "跑完了。" }],
									},
								],
							},
						},
					],
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.equal(detail?.messages[0]?.id, "m1");
		const usage = detail?.messages[0]?.usage;
		assert.equal(usage?.inputTokens, 12_345);
		assert.equal(usage?.outputTokens, 678);
		assert.equal(usage?.totalTokens, 13_023);
		assert.equal(usage?.modelCalls, 1);
		assert.equal(usage?.hitRate, null, "没有可观测的缓存调用时是 null,不是 0");
	});

	it("重做走运行时的对应方法", async () => {
		const runtime = createFakeRuntime();
		const retried: Array<{ sessionId: string; messageId: string }> = [];
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, retrySessionTurn: async (sessionId, messageId) => void retried.push({ sessionId, messageId }) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		await surface.retryTurn(listed.id, "m1");
		assert.deepEqual(retried, [{ sessionId: "s1", messageId: "m1" }]);
	});
});

describe("审批、模式、技能(P9)", () => {
	it("有工具等批准:映射成远端事件(不发的话远端根本不知道电脑在等它)", () => {
		const mapped = mapRuntimeEvent(
			{
				sessionId: "s1",
				event: {
					type: "approval.requested",
					messageId: "m1",
					approval: {
						approvalId: "a1",
						callId: "c1",
						toolName: "bash",
						input: { command: "rm -rf build" },
						severity: "high",
						summary: "删除构建目录",
					},
				},
			},
			new Map([["s1", "hash-1"]]),
		);
		assert.equal(mapped?.type, "approval");
		assert.equal(mapped?.type === "approval" ? mapped.approvalId : undefined, "a1");
		assert.equal(mapped?.type === "approval" ? mapped.toolName : undefined, "bash");
		assert.match(mapped?.type === "approval" ? (mapped.args ?? "") : "", /rm -rf build/);
		assert.equal(mapped?.type === "approval" ? mapped.severity : undefined, "high");
	});

	it("审批被解决(任何一端):也发出去,好让手机把卡片收掉", () => {
		const mapped = mapRuntimeEvent(
			{ sessionId: "s1", event: { type: "approval.resolved", messageId: "m1", resolution: { approvalId: "a1", approved: true } } },
			new Map([["s1", "hash-1"]]),
		);
		assert.deepEqual(mapped, { type: "approval-resolved", sessionId: "hash-1", approvalId: "a1" });
	});

	it("认不出来的风险等级不发(界面会照它写文案)", () => {
		const mapped = mapRuntimeEvent(
			{
				sessionId: "s1",
				event: { type: "approval.requested", approval: { approvalId: "a1", toolName: "bash", severity: "灾难" } },
			},
			new Map([["s1", "hash-1"]]),
		);
		assert.equal(mapped?.type === "approval" ? mapped.severity : "x", undefined);
	});

	it("摘要里带上交互模式", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			// 列表走的是**快照**里的会话记录,所以要改那一边。
			runtime: { ...runtime, getSnapshot: () => ({ ...runtime.getSnapshot(), sessions: [{ ...record(), interactionMode: "plan" }] }) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		assert.equal(listed.interactionMode, "plan");
	});

	it("打开会话带上技能目录(只给 id、名字与一句话说明)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSnapshot: () => ({
					...runtime.getSnapshot(),
					skills: { skills: [{ id: "s1", name: "写周报", description: "按模板写" }, { name: "没有 id 的" }] },
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.deepEqual(detail?.skills, [{ id: "s1", name: "写周报", description: "按模板写" }]);
	});

	it("发一轮时把技能一起带下去", async () => {
		const runtime = createFakeRuntime();
		const prompts: Array<{ sessionId: string; prompt: string; skillIds?: readonly string[] }> = [];
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, promptSession: async (sessionId, prompt, skillIds) => void prompts.push({ sessionId, prompt, skillIds }) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		await surface.prompt(listed.id, "写一份", ["s1"]);
		assert.deepEqual(prompts, [{ sessionId: "s1", prompt: "写一份", skillIds: ["s1"] }]);
	});
});

describe("`@` 工作区文件(P28)", () => {
	it("搜的是**这个会话**的工作区,而且只回三样", async () => {
		const runtime = createFakeRuntime();
		const queries: Array<{ sessionId: string; query: string }> = [];
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				searchSessionWorkspace: async (sessionId, query) => {
					queries.push({ sessionId, query });
					return [
						{ path: "src/app.tsx", name: "app.tsx", kind: "file" as const, size: 1234, modifiedAt: 1 },
						{ path: "src", name: "src", kind: "directory" as const, size: 0, modifiedAt: 0 },
					];
				},
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const entries = await surface.searchWorkspaceFiles(listed.id, "app");
		assert.deepEqual(queries, [{ sessionId: "s1", query: "app" }]);
		// 体积与修改时间不发 —— 这一条链路上没人用它们。
		assert.deepEqual(entries, [
			{ path: "src/app.tsx", name: "app.tsx", kind: "file" },
			{ path: "src", name: "src", kind: "directory" },
		]);
	});

	it("路径或名字空的条目直接丢掉(发出去也画不出东西)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				searchSessionWorkspace: async () => [
					{ path: "", name: "空的", kind: "file" as const },
					{ path: "ok.ts", name: "", kind: "file" as const },
					{ path: "ok.ts", name: "ok.ts", kind: "file" as const },
				],
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		assert.deepEqual(await surface.searchWorkspaceFiles(listed.id, ""), [{ path: "ok.ts", name: "ok.ts", kind: "file" }]);
	});

	it("引用不拼进正文,而是变成与桌面端同一份标记", async () => {
		const runtime = createFakeRuntime();
		const prompts: string[] = [];
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, promptSession: async (_sessionId, prompt) => void prompts.push(prompt) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		await surface.prompt(listed.id, "看一下这个", [], undefined, [
			{ path: "src/app.tsx", name: "app.tsx", kind: "file" },
		]);
		const prompt = prompts[0] ?? "";
		// 正文还是正文(用户打的字没有被改写)。
		assert.match(prompt, /^看一下这个/);
		// 引用是一段**给程序读的**编码 JSON,桌面端序列化器就是这个格式。
		const marker = /<wordless-workspace-reference>([^<]*)<\/wordless-workspace-reference>/.exec(prompt);
		assert.ok(marker, "引用必须以标记形式出现");
		const parsed = JSON.parse(decodeURIComponent(marker?.[1] ?? "")) as Record<string, unknown>;
		assert.equal(parsed.version, 1);
		assert.equal(parsed.path, "src/app.tsx");
		assert.equal(parsed.name, "app.tsx");
		assert.equal(parsed.kind, "file");
	});

	it("没有引用时不留下任何标记(老路径逐字不变)", async () => {
		const runtime = createFakeRuntime();
		const prompts: string[] = [];
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, promptSession: async (_sessionId, prompt) => void prompts.push(prompt) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		await surface.prompt(listed.id, "你好");
		assert.equal(prompts[0], "你好");
	});

	it("用户消息里的引用块会被映射出去(否则手机上看不见自己 @ 了什么)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				// 打开会话走的是**单独那一页历史**(不是快照里的整段),所以要改这一边。
				getSessionHistoryPage: async () => ({
					items: [
						{
							type: "turn" as const,
							turn: {
								messages: [
									{
										role: "user" as const,
										timestamp: 1,
										blocks: [
											{ type: "workspace-reference", id: "ref-1", path: "src/app.tsx", name: "app.tsx", kind: "file" },
											{ type: "text", text: "看一下这个" },
										],
									},
								],
							},
						},
					],
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		const blocks = detail?.messages[0]?.blocks ?? [];
		assert.deepEqual(blocks[0], {
			type: "workspace-reference",
			id: "ref-1",
			path: "src/app.tsx",
			name: "app.tsx",
			kind: "file",
		});
	});

	it("认不出的引用块(没有路径)整块丢掉,而不是画一枚空芯片", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionHistoryPage: async () => ({
					items: [
						{
							type: "turn" as const,
							turn: {
								messages: [
									{
										role: "user" as const,
										timestamp: 1,
										blocks: [
											{ type: "workspace-reference", id: "ref-1", name: "没有路径" },
											{ type: "text", text: "正文" },
										],
									},
								],
							},
						},
					],
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.deepEqual(detail?.messages[0]?.blocks, [{ type: "text", text: "正文" }]);
	});
});

describe("提问(P9.1)", () => {
	const envelope = (fields: unknown[]) => ({
		sessionId: "s1",
		event: { type: "user-request.requested", messageId: "m1", request: { requestId: "r1", title: "选一下", fields } },
	});

	it("四种字段原样带过去(少一种就等于把某些问题变成没法回答)", () => {
		const mapped = mapRuntimeEvent(
			envelope([
				{ type: "select", id: "f1", label: "语言", options: [{ value: "ts", label: "TypeScript" }] },
				{ type: "multi-select", id: "f2", label: "范围", options: [{ value: "a", label: "A" }] },
				{ type: "text", id: "f3", label: "补充", multiline: true },
				{ type: "confirm", id: "f4", label: "要不要提交", defaultValue: true },
			]),
			new Map([["s1", "hash-1"]]),
		);
		assert.equal(mapped?.type, "user-request");
		const fields = mapped?.type === "user-request" ? mapped.request.fields : [];
		assert.deepEqual(
			fields.map((field) => field.type),
			["select", "multi-select", "text", "confirm"],
		);
		assert.equal(fields[3]?.type === "confirm" ? fields[3].defaultValue : undefined, true);
		assert.equal(fields[2]?.type === "text" ? fields[2].multiline : undefined, true);
	});

	it("认不出来的字段类型整条丢掉(猜成文本会让答案带着错的意思回去)", () => {
		const mapped = mapRuntimeEvent(
			envelope([
				{ type: "range", id: "f1", label: "滑条" },
				{ type: "text", id: "f2", label: "补充" },
			]),
			new Map([["s1", "hash-1"]]),
		);
		const fields = mapped?.type === "user-request" ? mapped.request.fields : [];
		assert.deepEqual(fields.map((field) => field.id), ["f2"]);
	});

	it("选项一个都没有的选择题也丢掉(渲染出来是个没法答的题)", () => {
		const mapped = mapRuntimeEvent(envelope([{ type: "select", id: "f1", label: "语言", options: [] }]), new Map([["s1", "h"]]));
		assert.equal(mapped, undefined);
	});

	it("被解决时发一条 resolved,好让手机把表单收掉", () => {
		const mapped = mapRuntimeEvent(
			{ sessionId: "s1", event: { type: "user-request.resolved", messageId: "m1", resolution: { requestId: "r1", status: "submitted" } } },
			new Map([["s1", "hash-1"]]),
		);
		assert.deepEqual(mapped, { type: "user-request-resolved", sessionId: "hash-1", requestId: "r1" });
	});
});

describe("压缩、版本、专家团(P10)", () => {
	it("多版的回复带上 active/total(只有一版时不带 —— 摆 1/1 没意义)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSessionTurnVersions: async () => ({ m1: { active: 2, total: 3 }, m2: { active: 1, total: 1 } }),
				getSessionHistoryPage: async () => ({
					items: [
						{
							type: "turn",
							turn: {
								messages: [
									{ id: "m1", role: "assistant", timestamp: 1, blocks: [{ type: "text", text: "第一版" }] },
									{ id: "m2", role: "assistant", timestamp: 2, blocks: [{ type: "text", text: "只有一版" }] },
								],
							},
						},
					],
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.deepEqual(detail?.messages[0]?.versions, { active: 2, total: 3 });
		assert.equal(detail?.messages[1]?.versions, undefined);
	});

	it("压缩走运行时的对应方法", async () => {
		const runtime = createFakeRuntime();
		const compacted: string[] = [];
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: { ...runtime, compactSession: async (sessionId) => void compacted.push(sessionId) },
			events: stream,
		});
		const [listed] = await surface.listSessions();
		await surface.compact(listed.id);
		assert.deepEqual(compacted, ["s1"]);
	});

	it("切版本:把消息 id 与第几版传给运行时", async () => {
		const runtime = createFakeRuntime();
		const picked: Array<{ sessionId: string; messageId: string; version: number }> = [];
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				selectSessionTurnVersion: async (sessionId, messageId, version) => void picked.push({ sessionId, messageId, version }),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		await surface.selectVersion(listed.id, "m1", 2);
		assert.deepEqual(picked, [{ sessionId: "s1", messageId: "m1", version: 2 }]);
	});

	it("专家目录与当前选中项都带出来(只给名字,不给定义)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				listExperts: () => [
					{ kind: "team", id: "t1", version: "1", name: "编辑部", description: "写稿" },
					{ kind: "expert", id: "e1", version: "1", name: "小编辑" },
				],
				getSnapshot: () => ({
					...runtime.getSnapshot(),
					sessions: [{ ...record(), entryId: "general-work", expertSelection: { kind: "team", id: "t1" } }],
				}),
				getSessionView: async () => ({ ...view(), session: { ...record(), entryId: "general-work" } }),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		assert.equal(listed.expertName, "编辑部");
		const detail = await surface.openSession(listed.id);
		assert.deepEqual(detail?.experts?.map((expert) => expert.name), ["编辑部", "小编辑"]);
		assert.equal(detail?.experts?.[0]?.kind, "team");
	});
});

describe("专家只在支持它的入口给(P14)", () => {
	const withEntry = (entryId: string) => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		return createRuntimeSessionSurface({
			runtime: {
				...runtime,
				listExperts: () => [{ kind: "team" as const, id: "t1", version: "1", name: "编辑部" }],
				getSessionView: async () => ({ ...view(), session: { ...record(), entryId } }),
			},
			events: stream,
		});
	};

	it("general-work:给专家目录", async () => {
		const surface = withEntry("general-work");
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.deepEqual(detail?.experts?.map((expert) => expert.name), ["编辑部"]);
	});

	it("别的入口:**不给**这一项(给一个点了会失败的比不给更糟)", async () => {
		const surface = withEntry("data-analysis");
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.equal(detail?.experts, undefined);
	});
});

describe("可连的连接器来自目录,不是会话已有的(P14)", () => {
	it("列的是**这台机器能连什么**(已启用的)", async () => {
		const runtime = createFakeRuntime();
		const { stream } = createStream();
		const surface = createRuntimeSessionSurface({
			runtime: {
				...runtime,
				getSnapshot: () => ({
					...runtime.getSnapshot(),
					// 会话一个连接器都没连 —— 但机器上有两个可连的。
					sessions: [{ ...record(), connectorIds: [] }],
					connectors: {
						connectors: [
							{ id: "k1", name: "GitHub", enabled: true },
							{ id: "k2", name: "Notion", enabled: true },
							{ id: "k3", name: "停用的", enabled: false },
						],
					},
				}),
			},
			events: stream,
		});
		const [listed] = await surface.listSessions();
		const detail = await surface.openSession(listed.id);
		assert.deepEqual(detail?.availableConnectors?.map((connector) => connector.name), ["GitHub", "Notion"]);
	});
});

describe("现在在做什么(P16)", () => {
	const activityOf = (event: Record<string, unknown>) =>
		mapRuntimeEvent({ sessionId: "s1", event }, new Map([["s1", "hash-1"]]));

	it("状态文字附在**已有事件**上(一个信封只映射一个事件)", () => {
		// 工具事件照旧是 `tool`(不能因为加状态文字就把工具事件挡掉)。
		const started = activityOf({ type: "tool.started", name: "bash" }) as { type?: string; activity?: string };
		assert.equal(started.type, "tool");
		assert.equal(started.activity, "正在执行命令");
		assert.equal(
			(activityOf({ type: "tool.started", name: "grep" }) as { activity?: string }).activity,
			"正在搜索",
		);
		assert.equal(
			(activityOf({ type: "tool.completed", name: "bash" }) as { activity?: string }).activity,
			"正在分析工具结果",
		);
	});

	it("运行开始/结束:附在运行状态上", () => {
		assert.equal((activityOf({ type: "run.started" }) as { activity?: string }).activity, "思考中");
		assert.equal((activityOf({ type: "run.completed" }) as { activity?: string }).activity, "");
	});
});
});
