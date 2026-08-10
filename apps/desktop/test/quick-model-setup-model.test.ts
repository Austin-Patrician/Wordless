import assert from "node:assert/strict";
import test from "node:test";
import type { ConfiguredModelSummary, ModelConfigurationSnapshot } from "@wordless/domain";
import {
  carouselOffset,
  hasEnabledChatModel,
  mergeQuickProviderConfiguration,
  QUICK_MODEL_PROVIDERS,
  recommendedQuickModel,
} from "../src/renderer/features/workbench/quick-model-setup-model.ts";

function model(providerId: string, modelId: string, enabled = false): ConfiguredModelSummary {
  return {
    providerId,
    providerAvatarId: null,
    modelId,
    displayName: modelId,
    kind: "chat",
    enabled,
    supportsVision: false,
    supportsReasoning: false,
    supportedThinkingLevels: ["off"],
    contextWindow: 128_000,
    api: "openai-completions",
    imageCapabilities: null,
  };
}

function snapshot(models: ConfiguredModelSummary[]): ModelConfigurationSnapshot {
  return { providers: [], models, diagnostics: [] };
}

test("quick setup maps domestic GLM and Moonshot providers", () => {
  assert.equal(QUICK_MODEL_PROVIDERS.find((provider) => provider.name === "智谱 GLM")?.providerId, "zai-coding-cn");
  assert.equal(QUICK_MODEL_PROVIDERS.find((provider) => provider.name === "Moonshot AI")?.providerId, "moonshotai-cn");
});

test("recommended model falls back to the first available model", () => {
  const models = [model("provider", "first"), model("provider", "recommended")];
  assert.equal(recommendedQuickModel(models, "recommended")?.modelId, "recommended");
  assert.equal(recommendedQuickModel(models, "missing")?.modelId, "first");
});

test("API key merge preserves advanced provider configuration", () => {
  assert.deepEqual(mergeQuickProviderConfiguration({ baseUrl: "https://example.com", headers: { "X-Test": "yes" } }, "  secret  "), {
    baseUrl: "https://example.com",
    headers: { "X-Test": "yes" },
    apiKey: "secret",
  });
});

test("enabled model detection ignores disabled chat models", () => {
  assert.equal(hasEnabledChatModel(snapshot([model("openai", "one")])), false);
  assert.equal(hasEnabledChatModel(snapshot([model("openai", "one", true)])), true);
});

test("carousel offsets wrap in both directions", () => {
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => carouselOffset(index, 0, 6)), [0, 1, 2, 3, -2, -1]);
  assert.equal(carouselOffset(0, 5, 6), 1);
  assert.equal(carouselOffset(5, 0, 6), -1);
});
