import { describe, expect, it } from "vitest";
import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { isOpenCodeEndpoint, openCodeSessionHeadersFor, withOpenCodeSessionHeader } from "../src/providers/opencode-headers.ts";
import type { Api, Context, Model, ProviderStreams, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const model: Model<Api> = {
	id: "test-model",
	name: "Test model",
	api: "test-api",
	provider: "opencode",
	baseUrl: "https://opencode.ai/zen/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};
const context: Context = { messages: [{ role: "user", content: "hi", timestamp: 0 }] };

function completedStream(): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	const message = fauxAssistantMessage("ok");
	stream.push({ type: "start", partial: message });
	stream.push({ type: "done", reason: "stop", message });
	stream.end(message);
	return stream;
}

function recordingStreams(capture: (options: StreamOptions | undefined) => void): ProviderStreams {
	return {
		stream: (_model, _context, options) => {
			capture(options);
			return completedStream();
		},
		streamSimple: (_model, _context, options) => {
			capture(options);
			return completedStream();
		},
	};
}

describe("OpenCode provider headers", () => {
	// The gateway rejects a request without a session identity with
	// `MissingSessionID`, and summarization requests disable cache retention, so
	// the mapping must not depend on caching being enabled.
	it.each(["stream", "streamSimple"] as const)(
		"maps sessionId for %s requests even without cache retention",
		(method) => {
			let captured: StreamOptions | undefined;
			const streams = withOpenCodeSessionHeader(
				recordingStreams((options) => {
					captured = options;
				}),
			);

			streams[method](model, context, { sessionId: "conversation-1", cacheRetention: "none" });

			expect(captured?.headers).toEqual({ "x-opencode-session": "conversation-1" });
		},
	);

	it.each([
		{ headers: { "X-OpenCode-Session": "caller-value" }, expected: { "X-OpenCode-Session": "caller-value" } },
		{ headers: { "X-OpenCode-Session": null }, expected: { "X-OpenCode-Session": null } },
	] as const)("preserves a case-insensitive caller override", ({ headers, expected }) => {
		let captured: StreamOptions | undefined;
		const streams = withOpenCodeSessionHeader(
			recordingStreams((options) => {
				captured = options;
			}),
		);

		streams.streamSimple(model, context, { sessionId: "generated-value", headers });

		expect(captured?.headers).toEqual(expected);
	});

	it("treats a user-configured provider on the OpenCode host as an OpenCode endpoint", () => {
		// The rule is shared with runtime-side dispatch points so a provider the
		// user added themselves behaves exactly like the built-in one.
		expect(openCodeSessionHeadersFor({ provider: "my-gateway", baseUrl: "https://opencode.ai/zen/go/v1" }, { sessionId: "s-1" })).toEqual({
			"x-opencode-session": "s-1",
		});
		expect(isOpenCodeEndpoint({ provider: "my-gateway", baseUrl: "https://opencode.ai/zen/go/v1" })).toBe(true);
	});

	it("does not treat a lookalike host as an OpenCode endpoint", () => {
		// Exact host comparison, so a suffix or prefix cannot inherit the rule.
		expect(isOpenCodeEndpoint({ provider: "my-gateway", baseUrl: "https://opencode.ai.evil.example/v1" })).toBe(false);
		expect(isOpenCodeEndpoint({ provider: "my-gateway", baseUrl: "https://not-opencode.ai/v1" })).toBe(false);
		expect(openCodeSessionHeadersFor({ provider: "my-gateway", baseUrl: "https://opencode.ai.evil.example/v1" }, { sessionId: "s-1" })).toBeUndefined();
		expect(isOpenCodeEndpoint({ provider: "my-gateway", baseUrl: "not a url" })).toBe(false);
	});

	it("leaves unrelated providers and session-less requests alone", () => {
		expect(openCodeSessionHeadersFor({ provider: "openai", baseUrl: "https://api.openai.com/v1" }, { sessionId: "s-1" })).toBeUndefined();
		expect(openCodeSessionHeadersFor({ provider: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1" }, {})).toBeUndefined();
	});

	it("never overrides a session header the caller already configured", () => {
		expect(openCodeSessionHeadersFor(
			{ provider: "opencode", baseUrl: "https://opencode.ai/zen/go/v1" },
			{ sessionId: "generated", headers: { "X-OpenCode-Session": "configured" } },
		)).toBeUndefined();
	});

	it("does not fabricate a session header when sessionId is absent", () => {
		let captured: StreamOptions | undefined;
		const streams = withOpenCodeSessionHeader(
			recordingStreams((options) => {
				captured = options;
			}),
		);

		streams.streamSimple(model, context, { headers: { "x-custom": "value" } });

		expect(captured?.headers).toEqual({ "x-custom": "value" });
	});
});
