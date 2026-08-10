import assert from "node:assert/strict";
import test from "node:test";
import { applyProviderModelDraftChange, desiredEnabledModelIds, draftConfiguredModels, providerDraftModelIds } from "../src/renderer/features/settings/provider-model-draft.ts";

test("adds remote models while preserving advanced fields and local-only models", () => {
  const raw = JSON.stringify({
    api: "openai-completions",
    headers: { "X-Client": "Wordless" },
    models: [{ id: "existing", reasoning: true }, { id: "local-only", contextWindow: 42_000 }],
  });
  const result = applyProviderModelDraftChange(raw, [
    { id: "existing", name: "Existing" },
    { id: "remote-new", name: "Remote New", contextWindow: 128_000 },
  ], new Set(["existing", "remote-new"]));
  const value = JSON.parse(result.raw) as Record<string, unknown>;
  assert.deepEqual(value.headers, { "X-Client": "Wordless" });
  assert.deepEqual(value.models, [
    { id: "existing", reasoning: true },
    { id: "local-only", contextWindow: 42_000 },
    { id: "remote-new", name: "Remote New", contextWindow: 128_000 },
  ]);
  assert.deepEqual(result.change, { addedIds: ["remote-new"], removedIds: [] });
});

test("removes only fetched models selected for removal", () => {
  const raw = JSON.stringify({ models: [{ id: "remote" }, { id: "local-only" }] });
  const result = applyProviderModelDraftChange(raw, [{ id: "remote", name: "Remote" }], new Set());
  assert.deepEqual(providerDraftModelIds(result.raw), ["local-only"]);
  assert.deepEqual(result.change, { addedIds: [], removedIds: ["remote"] });
});

test("enabled model calculation enables additions and drops removed definitions", () => {
  assert.deepEqual(desiredEnabledModelIds(["kept", "removed"], ["kept", "added"], ["added"]), ["kept", "added"]);
});

test("writes the matched built-in definition with the remote identity", () => {
  const result = applyProviderModelDraftChange("{}", [{
    id: "gateway/claude-sonnet-4-6",
    name: "Gateway Claude",
    configuration: {
      id: "builtin-id-must-not-leak",
      name: "Built-in name must not leak",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200_000,
      maxTokens: 64_000,
      thinkingLevelMap: { off: null, high: "high" },
    },
  }], new Set(["gateway/claude-sonnet-4-6"]));
  assert.deepEqual(JSON.parse(result.raw).models[0], {
    id: "gateway/claude-sonnet-4-6",
    name: "Gateway Claude",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 64_000,
    thinkingLevelMap: { off: null, high: "high" },
  });
});

test("builds enabled model rows immediately from the JSON draft", () => {
  const rows = draftConfiguredModels(JSON.stringify({ api: "openai-responses", models: [{
    id: "new-model",
    name: "New Model",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 32_000,
  }] }), [], ["new-model"], "custom-provider", "openai-responses");
  assert.equal(rows[0]?.enabled, true);
  assert.equal(rows[0]?.displayName, "New Model");
  assert.equal(rows[0]?.supportsVision, true);
  assert.equal(rows[0]?.supportsReasoning, true);
  assert.equal(rows[0]?.contextWindow, 200_000);
  assert.equal(rows[0]?.api, "openai-responses");
});
