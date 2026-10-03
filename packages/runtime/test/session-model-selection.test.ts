import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionRecord } from "@wordless/domain";
import { createWordlessSession } from "@wordless/persistence";
import { WordlessRuntime } from "../src/index.ts";

/**
 * 远端能换的模型清单。
 *
 * 这条清单是 b 档诚实性的根:手机上列出来的选项,必须**每一个都能真的换成功** ——
 * 否则用户会看到一个"选了必然被拒"的清单。规则因此必须和本机换模型时的判断同源。
 *
 * 这里不启动整个运行时:`Object.create(WordlessRuntime.prototype)` 只挂上这一条路径需要的那点状态,
 * 于是测的是"清单怎么筛",而不是"运行时怎么组装"。
 */

const record = (entryId = "general-work"): SessionRecord =>
	({
		id: "s1",
		entryId,
	}) as never;

interface ModelShape {
	readonly kind: "chat";
	readonly enabled: boolean;
	readonly providerId: string;
	readonly modelId: string;
	readonly displayName: string;
	readonly supportsVision: boolean;
	readonly supportsReasoning: boolean;
	readonly supportedThinkingLevels: readonly string[];
	readonly contextWindow: number;
}

const model = (overrides: Partial<ModelShape> = {}): ModelShape => ({
	kind: "chat",
	enabled: true,
	providerId: "openai",
	modelId: "gpt-5",
	displayName: "GPT-5",
	supportsVision: false,
	supportsReasoning: true,
	supportedThinkingLevels: ["medium"],
	contextWindow: 200_000,
	...overrides,
});

const setup = (input: {
	readonly models: readonly ModelShape[];
	readonly configured?: readonly string[];
	readonly runtimeHas?: (modelId: string) => boolean;
	readonly entry?: { readonly requiresVision?: boolean };
}) => {
	const runtime = Object.create(WordlessRuntime.prototype) as WordlessRuntime;
	Object.assign(runtime, {
		database: { getSession: () => record() },
		getEntries: () => [{ id: "general-work", modelRequirements: input.entry ?? {} }],
		modelConfiguration: {
			snapshot: () => ({
				providers: [{ kind: "chat", id: "openai", authStatus: "configured" }],
				models: input.models,
			}),
		},
		models: {
			getModel: (_connectionId: string, modelId: string) =>
				(input.runtimeHas ?? (() => true))(modelId) ? {} : undefined,
		},
	});
	return runtime;
};

test("清单只留下真的能换的模型", () => {
	const runtime = setup({
		models: [
			model({ modelId: "ok", displayName: "可用的" }),
			model({ modelId: "disabled", displayName: "停用的", enabled: false }),
			model({ modelId: "gone", displayName: "运行时没有的" }),
		],
		runtimeHas: (modelId) => modelId !== "gone",
	});
	assert.deepEqual(
		runtime.listSelectableSessionModels("s1").map((entry) => entry.modelId),
		["ok"],
	);
});

test("与工作类型不兼容的不进清单(要视觉的会话里不列纯文本模型)", () => {
	const runtime = setup({
		models: [
			model({ modelId: "text-only", displayName: "纯文本", supportsVision: false }),
			model({ modelId: "sees", displayName: "能看图", supportsVision: true }),
		],
		entry: { requiresVision: true },
	});
	assert.deepEqual(
		runtime.listSelectableSessionModels("s1").map((entry) => entry.modelId),
		["sees"],
	);
});

test("清单按供应商 + 显示名排序,两端顺序一致", () => {
	const runtime = setup({
		models: [
			model({ providerId: "openai", modelId: "b", displayName: "B" }),
			model({ providerId: "openai", modelId: "a", displayName: "A" }),
		],
	});
	assert.deepEqual(
		runtime.listSelectableSessionModels("s1").map((entry) => entry.displayName),
		["A", "B"],
	);
});

test("换模型之后会发出 sessions.changed —— 否则远端一直显示旧模型", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "wordless-model-change-"));
	context.after(async () => await rm(root, { force: true, recursive: true }));
	const journalPath = join(root, "sessions", "s1.jsonl");
	await createWordlessSession({
		id: "s1",
		createdAt: new Date(1).toISOString(),
		cwd: root,
		path: journalPath,
		metadata: { workspaceId: null, entryId: "general-work" },
	});

	const emitted: Array<{ readonly type: string }> = [];
	const runtime = Object.create(WordlessRuntime.prototype) as WordlessRuntime;
	Object.assign(runtime, {
		database: {
			getSession: () =>
				({
					id: "s1",
					entryId: "general-work",
					journalPath,
					model: { connectionId: "openai", modelId: "a" },
					thinkingLevel: "medium",
					updatedAt: 1,
				}) as never,
			upsertSession: () => undefined,
		},
		runs: new Map(),
		getEntries: () => [{ id: "general-work", modelRequirements: {} }],
		modelConfiguration: {
			snapshot: () => ({
				providers: [
					{ kind: "chat", id: "openai", authStatus: "configured" },
					{ kind: "chat", id: "anthropic", authStatus: "configured" },
				],
				models: [
					model({ modelId: "a", displayName: "A" }),
					model({ providerId: "anthropic", modelId: "b", displayName: "B" }),
				],
			}),
		},
		models: { getModel: () => ({ reasoning: false }) },
		rememberEntryModel: () => undefined,
		emitApp: (event: { readonly type: string }) => {
			emitted.push(event);
		},
	});

	await runtime.setSessionModel("s1", { connectionId: "anthropic", modelId: "b" });
	assert.deepEqual(
		emitted.map((event) => event.type),
		["sessions.changed"],
	);
});
