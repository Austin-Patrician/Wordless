import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { getModel } from "../src/compat.ts";
import type { Context } from "../src/types.ts";

/**
 * 缓存观测级别。判定的关键是**按响应里字段是否存在**,而不是按协议写死:
 * "报了个 0"是真未命中,"没这个字段"是我们无从判断 —— 这两件事一旦被压成同一个 0,
 * 界面上就会出现一个假的"命中率 0%"。
 */

const context: Context = { messages: [{ role: "user", content: "hi", timestamp: Date.now() }] };

function createSseResponse(events: Array<{ event: string; data: string }>): Response {
	const body = events.map(({ event, data }) => `event: ${event}\ndata: ${data}\n`).join("\n");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function createFakeAnthropicClient(response: Response): Anthropic {
	return {
		messages: { create: () => ({ asResponse: async () => response }) },
	} as unknown as Anthropic;
}

function anthropicEvents(startUsage: Record<string, unknown>): Array<{ event: string; data: string }> {
	return [
		{
			event: "message_start",
			data: JSON.stringify({ type: "message_start", message: { id: "msg_test", usage: startUsage } }),
		},
		{
			event: "content_block_start",
			data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
		},
		{
			event: "content_block_delta",
			data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
		},
		{ event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: 0 }) },
		// 增量事件里**不带**任何缓存字段:判定必须保留 message_start 的结论,而不是退回 unavailable。
		{
			event: "message_delta",
			data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }),
		},
		{ event: "message_stop", data: JSON.stringify({ event: "message_stop" }) },
	];
}

describe("anthropic 缓存观测级别", () => {
	it("上报了读写字段(即使都是 0)→ read-write,并且不被增量事件抹掉", async () => {
		const model = getModel("anthropic", "claude-opus-4-8");
		const result = await streamAnthropic(model, context, {
			client: createFakeAnthropicClient(
				createSseResponse(
					anthropicEvents({
						input_tokens: 100,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					}),
				),
			),
		}).result();

		expect(result.usage.cacheUsageReporting).toBe("read-write");
		expect(result.usage.cacheRead).toBe(0);
	});

	it("只上报读 → read-only", async () => {
		const model = getModel("anthropic", "claude-opus-4-8");
		const result = await streamAnthropic(model, context, {
			client: createFakeAnthropicClient(
				createSseResponse(anthropicEvents({ input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 40 })),
			),
		}).result();

		expect(result.usage.cacheUsageReporting).toBe("read-only");
		expect(result.usage.cacheRead).toBe(40);
	});

	it("一个缓存字段都没给 → unavailable(不是 0% 命中)", async () => {
		const model = getModel("anthropic", "claude-opus-4-8");
		const result = await streamAnthropic(model, context, {
			client: createFakeAnthropicClient(
				createSseResponse(anthropicEvents({ input_tokens: 100, output_tokens: 0 })),
			),
		}).result();

		expect(result.usage.cacheUsageReporting).toBe("unavailable");
		expect(result.usage.cacheRead).toBe(0);
	});
});

interface FakeStreamUsage {
	prompt_tokens: number;
	completion_tokens: number;
	prompt_tokens_details?: { cached_tokens: number };
}

const mockState = vi.hoisted(() => ({ usage: undefined as FakeStreamUsage | undefined }));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield { choices: [{ delta: {}, finish_reason: "stop" }], usage: mockState.usage };
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{ data: typeof stream; response: { status: number; headers: Headers } }>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}
	return { default: FakeOpenAI };
});

describe("openai-completions 缓存观测级别与对账值", () => {
	it("给了 prompt_tokens_details(即使 cached_tokens 为 0)→ read-only,并留下 provider 自报的 prompt 总数", async () => {
		mockState.usage = { prompt_tokens: 1_000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 } };
		const model = getModel("openai", "gpt-4o-mini");
		const result = await streamOpenAICompletions(model, context, { apiKey: "test-key" }).result();

		expect(result.usage.cacheUsageReporting).toBe("read-only");
		expect(result.usage.cacheRead).toBe(0);
		// 自报总数是**未减过**的 prompt 总数,用来对账我们的归一化。
		expect(result.usage.reportedPromptTokens).toBe(1_000);
		// 归一化:input = 1000 - 0。
		expect(result.usage.input).toBe(1_000);
	});

	it("没给 prompt_tokens_details → unavailable", async () => {
		mockState.usage = { prompt_tokens: 1_000, completion_tokens: 10 };
		const model = getModel("openai", "gpt-4o-mini");
		const result = await streamOpenAICompletions(model, context, { apiKey: "test-key" }).result();

		expect(result.usage.cacheUsageReporting).toBe("unavailable");
	});
});
