import assert from "node:assert/strict";
import test from "node:test";
import { createModels, fauxAssistantMessage, fauxProvider, type Provider, type StreamOptions } from "@wordless/ai";
import { withModelRequestHeaders } from "../src/model-request-headers.ts";

const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
const UNRELATED_BASE_URL = "https://api.example.com/v1";

function message(text = "ok") {
	return { messages: [{ role: "user" as const, content: "summarize this", timestamp: 0 }], systemPrompt: "s" };
}

/** Captures the options the provider finally receives for one request. */
function withCapture(providerId: string, baseUrl: string) {
	const faux = fauxProvider({ provider: providerId, models: [{ id: "model-1", contextWindow: 200_000, maxTokens: 8_192 }] });
	const registry = createModels();
	registry.setProvider(faux.provider);
	const model = { ...faux.getModel(), baseUrl };
	const seen: Array<StreamOptions | undefined> = [];
	faux.setResponses([
		(_context, options) => {
			seen.push(options);
			return fauxAssistantMessage("ok");
		},
		(_context, options) => {
			seen.push(options);
			return fauxAssistantMessage("ok");
		},
	]);
	return { faux, model, registry, seen, wrapped: withModelRequestHeaders(registry) };
}

test("wrapped registry delegates every call to the registry it wraps", () => {
	const faux = fauxProvider({ provider: "delegate-provider", models: [{ id: "model-1", contextWindow: 1_000, maxTokens: 100 }] });
	const registry = createModels();
	const wrapped = withModelRequestHeaders(registry);

	// Mutations issued through the wrapper must reach the real registry, which is
	// what keeps `RuntimeModelConfiguration.rebuild()` working.
	wrapped.setProvider(faux.provider);
	assert.equal(registry.getProvider("delegate-provider"), faux.provider);
	assert.deepEqual(wrapped.getModels("delegate-provider").map((model) => model.id), ["model-1"]);
	assert.deepEqual(registry.getModels("delegate-provider").map((model) => model.id), ["model-1"]);
	assert.equal(wrapped.getModel("delegate-provider", "model-1")?.provider, "delegate-provider");
	assert.equal(wrapped.getModel("delegate-provider", "missing-model"), undefined);
	assert.deepEqual(wrapped.getProviders().map((provider: Provider) => provider.id), ["delegate-provider"]);

	wrapped.clearProviders();
	assert.equal(registry.getProviders().length, 0);
});

test("adds the session header for a built-in OpenCode provider", async () => {
	const { seen, wrapped, model } = withCapture("opencode-go", OPENCODE_GO_BASE_URL);

	await wrapped.completeSimple(model, message(), { sessionId: "conversation-1" });

	assert.equal(seen[0]?.headers?.["x-opencode-session"], "conversation-1");
});

test("adds the session header for a user-configured provider on the OpenCode host", async () => {
	// The reason the policy runs at the registry: a provider the user added
	// themselves never goes through the built-in OpenCode provider wrapper.
	const { seen, wrapped, model } = withCapture("my-gateway", OPENCODE_GO_BASE_URL);

	await wrapped.completeSimple(model, message(), { sessionId: "conversation-2" });

	assert.equal(seen[0]?.headers?.["x-opencode-session"], "conversation-2");
});

test("covers the compaction path, which issues a bare completeSimple request", async () => {
	// `generateSummary` in the agent package calls `models.completeSimple` with
	// only `{ maxTokens, sessionId }`; nothing else in that path can add headers.
	const { seen, wrapped, model } = withCapture("my-gateway", OPENCODE_GO_BASE_URL);

	const response = await wrapped.completeSimple(model, message(), { maxTokens: 512, sessionId: "summary-1" });

	assert.equal(response.stopReason, "stop");
	assert.equal(seen[0]?.headers?.["x-opencode-session"], "summary-1");
});

test("leaves unrelated providers and session-less requests untouched", async () => {
	const unrelated = withCapture("opencode-like", UNRELATED_BASE_URL);
	await unrelated.wrapped.completeSimple(unrelated.model, message(), { sessionId: "conversation-3" });
	assert.equal(unrelated.seen[0]?.headers?.["x-opencode-session"], undefined);

	const anonymous = withCapture("my-gateway", OPENCODE_GO_BASE_URL);
	await anonymous.wrapped.completeSimple(anonymous.model, message(), {});
	assert.equal(anonymous.seen[0]?.headers?.["x-opencode-session"], undefined);
});

test("keeps a session header the caller already configured", async () => {
	const { seen, wrapped, model } = withCapture("my-gateway", OPENCODE_GO_BASE_URL);

	await wrapped.completeSimple(model, message(), {
		sessionId: "generated-value",
		headers: { "X-OpenCode-Session": "configured-value" },
	});

	assert.equal(seen[0]?.headers?.["x-opencode-session"], undefined);
	assert.equal(seen[0]?.headers?.["X-OpenCode-Session"], "configured-value");
});
