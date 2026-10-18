import { describe, expect, it } from "vitest";
import { getModel, getModels } from "../src/compat.ts";
import { getSupportedThinkingLevels } from "../src/models.ts";

/**
 * DeepSeek 是这个目录里**手工策展**的 provider —— `scripts/generate-models.ts` 里没有
 * models.dev 的 deepseek 分支,型号来自 `deepseekV4Models` 那段常量。所以"上游发了新模型"
 * 不会自动出现在这里,而漏掉的表现是**静默的**:模型就是不存在,没有任何报错。
 *
 * 这里钉住 V4.1 Flash(`deepseek-flash`,2026-09-10 发布)。它同时是这条线的名字变更:
 * 官方文档说明 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已退役并被路由到它。
 */
describe("DeepSeek models", () => {
	it("registers V4.1 Flash under its production id, with native vision", () => {
		const model = getModel("deepseek", "deepseek-flash");

		expect(model).toBeDefined();
		expect(model.name).toBe("DeepSeek V4.1 Flash");
		// 官方文档:V4.1 Flash 原生多模态,vision 不再是单独的 exp 型号。
		expect(model.input).toEqual(["text", "image"]);
		expect(model.reasoning).toBe(true);
		expect(model.contextWindow).toBe(1_000_000);
		expect(model.maxTokens).toBe(384_000);
		expect(model.cost).toEqual({ input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 });
	});

	it("keeps the DeepSeek wire compat the other DeepSeek entries use", () => {
		const model = getModel("deepseek", "deepseek-flash");

		expect(model.compat).toMatchObject({
			supportsStore: false,
			supportsDeveloperRole: false,
			maxTokensField: "max_tokens",
			requiresReasoningContentOnAssistantMessages: true,
			thinkingFormat: "deepseek",
		});
	});

	it("exposes the low/high/max effort levels V4.1 Flash documents", () => {
		// 新 id 不带 `deepseek-v4` 前缀,如果档位规则只按前缀匹配,这里会退化成 ["off"]。
		expect(getSupportedThinkingLevels(getModel("deepseek", "deepseek-flash"))).toEqual(["off", "low", "high", "max"]);
	});

	it("still lists the retired Flash id it replaced", () => {
		expect(getModels("deepseek").map((model) => model.id)).toEqual(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"]);
	});
});
