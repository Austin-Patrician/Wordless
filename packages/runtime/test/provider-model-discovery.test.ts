import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderModelFetcherId } from "@wordless/domain";
import type { Api, Model } from "@wordless/ai";
import { discoverProviderModels, enrichProviderModelCandidates } from "../src/provider-model-discovery.ts";

const cases: Array<{ fetcher: ProviderModelFetcherId; body: unknown; expectedId?: string }> = [
  { fetcher: "aihubmix", body: { data: [{ model_id: "chat-aihub" }] }, expectedId: "chat-aihub" },
  { fetcher: "ollama", body: { models: [{ name: "llama3.3" }] }, expectedId: "llama3.3" },
  { fetcher: "gemini", body: { models: [{ name: "models/gemini-test", displayName: "Gemini Test" }] }, expectedId: "gemini-test" },
  { fetcher: "vertex", body: { publisherModels: [{ name: "publishers/google/models/gemini-vertex" }] }, expectedId: "gemini-vertex" },
  { fetcher: "github", body: [{ id: "github-chat" }], expectedId: "github-chat" },
  { fetcher: "copilot", body: { data: [{ id: "copilot-chat" }] }, expectedId: "copilot-chat" },
  { fetcher: "ovms", body: { "ovms-chat": { model_version_status: [{ state: "AVAILABLE" }] } }, expectedId: "ovms-chat" },
  { fetcher: "together", body: [{ id: "together-chat" }], expectedId: "together-chat" },
  { fetcher: "new-api", body: { data: [{ id: "new-api-chat" }] }, expectedId: "new-api-chat" },
  { fetcher: "openrouter", body: { data: [{ id: "openrouter/chat" }] }, expectedId: "openrouter/chat" },
  { fetcher: "ppio", body: { data: [{ id: "ppio-chat" }] }, expectedId: "ppio-chat" },
  { fetcher: "vercel-gateway", body: { models: [{ id: "provider/vercel-chat" }] }, expectedId: "provider/vercel-chat" },
  { fetcher: "anthropic", body: { data: [{ id: "claude-test", display_name: "Claude Test" }] }, expectedId: "claude-test" },
  { fetcher: "jina", body: { data: [{ id: "jina-ai/jina-chat" }] }, expectedId: "jina-chat" },
  { fetcher: "openai", body: { data: [{ id: "gpt-test" }] }, expectedId: "gpt-test" },
  { fetcher: "openai-compatible", body: { data: [{ id: "company-chat" }] }, expectedId: "company-chat" },
];

for (const entry of cases) {
  test(`discovers models with the ${entry.fetcher} strategy`, async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const models = await discoverProviderModels({
      providerId: "company-ai",
      providerFamily: null,
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret-token",
      modelFetcher: entry.fetcher,
    }, {
      fetch: async (input, init) => {
        requests.push({ url: String(input), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify(entry.body), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    assert.equal(models[0]?.id, entry.expectedId);
    assert.ok(requests.length >= 1);
    if (entry.fetcher === "gemini") assert.equal(requests[0]?.headers.get("x-goog-api-key"), "secret-token");
    else if (entry.fetcher === "anthropic") assert.equal(requests[0]?.headers.get("x-api-key"), "secret-token");
    else assert.equal(requests[0]?.headers.get("authorization"), "Bearer secret-token");
  });
}

test("deduplicates results and filters non-chat model families", async () => {
  const models = await discoverProviderModels({
    providerId: "company-ai",
    providerFamily: null,
    baseUrl: "https://models.example.com/v1",
    modelFetcher: "openai-compatible",
  }, {
    fetch: async () => new Response(JSON.stringify({ data: [
      { id: "chat-model" },
      { id: "chat-model", name: "duplicate" },
      { id: "text-embedding-3-large" },
      { id: "whisper-1" },
    ] }), { status: 200 }),
  });
  assert.deepEqual(models.map((model) => model.id), ["chat-model"]);
});

test("does not expose response credentials in HTTP errors", async () => {
  await assert.rejects(
    discoverProviderModels({
      providerId: "company-ai",
      providerFamily: null,
      baseUrl: "https://models.example.com/v1",
      apiKey: "sk-super-secret",
      modelFetcher: "openai-compatible",
    }, { fetch: async () => new Response('{"error":"sk-super-secret"}', { status: 401 }) }),
    (error: unknown) => error instanceof Error && /HTTP 401/.test(error.message) && !error.message.includes("sk-super-secret"),
  );
});

test("enriches a provider-prefixed remote model from the built-in catalog", () => {
  const builtin = {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    thinkingLevelMap: { off: null, high: "high" },
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200_000,
    maxTokens: 64_000,
  } as Model<Api>;
  const [model] = enrichProviderModelCandidates([
    { id: "gateway/claude-sonnet-4-6", name: "Remote Claude", ownedBy: "anthropic" },
  ], [{ providerId: "anthropic", model: builtin }]);
  assert.equal(model?.id, "gateway/claude-sonnet-4-6");
  assert.equal(model?.name, "Remote Claude");
  assert.deepEqual(model?.configuration, {
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
    thinkingLevelMap: { off: null, high: "high" },
  });
});
