import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODEL_SETTINGS,
  modelReferenceKey,
  parseModelSettings,
  parseModelsConfiguration,
} from "../src/index.ts";

test("parses Pi-style provider overrides and custom models", () => {
  const configuration = parseModelsConfiguration({
    version: 1,
    providers: {
      openai: {
        baseUrl: "https://proxy.example.com/v1",
        headers: { "X-Route": "$OPENAI_ROUTE" },
        modelOverrides: {
          "gpt-4.1-mini": {
            contextWindow: 200000,
            thinkingLevelMap: { off: null, low: "low", medium: null, high: "high" },
          },
        },
      },
      "company-ai": {
        baseUrl: "https://ai.example.com/v1",
        api: "openai-completions",
        models: [{
          id: "company-chat",
          name: "Company Chat",
          reasoning: true,
          thinkingLevelMap: { off: "none", minimal: null, low: "low", medium: null, high: "high" },
        }],
      },
    },
    imageProviders: {},
  });
  assert.equal(configuration.providers.openai?.baseUrl, "https://proxy.example.com/v1");
  assert.deepEqual(configuration.providers.openai?.modelOverrides?.["gpt-4.1-mini"]?.thinkingLevelMap, {
    off: null,
    low: "low",
    medium: null,
    high: "high",
  });
  assert.equal(configuration.providers["company-ai"]?.models?.[0]?.id, "company-chat");
  assert.deepEqual(configuration.providers["company-ai"]?.models?.[0]?.thinkingLevelMap, {
    off: "none",
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
  });
});

test("rejects invalid thinking-level mappings", () => {
  const configuration = (thinkingLevelMap: Record<string, unknown>) => ({
    version: 1,
    providers: {
      "company-ai": {
        baseUrl: "https://ai.example.com/v1",
        api: "openai-completions",
        models: [{ id: "company-chat", reasoning: true, thinkingLevelMap }],
      },
    },
    imageProviders: {},
  });

  assert.throws(() => parseModelsConfiguration(configuration({ turbo: "turbo" })), /thinkingLevelMap.*"turbo"/);
  assert.throws(() => parseModelsConfiguration(configuration({ high: 3 })), /thinkingLevelMap/);
});

test("keeps exact enabled model references in settings", () => {
  const settings = parseModelSettings({ ...DEFAULT_MODEL_SETTINGS, enabledChatModels: [modelReferenceKey("openai", "gpt-4.1-mini")] });
  assert.deepEqual(settings.enabledChatModels, ["openai/gpt-4.1-mini"]);
});

test("accepts only built-in provider avatar identifiers", () => {
  const configuration = parseModelsConfiguration({
    version: 1,
    providers: {
      "company-ai": {
        avatarId: "deepseek",
        baseUrl: "https://ai.example.com/v1",
        api: "openai-completions",
        models: [{ id: "company-chat" }],
      },
    },
    imageProviders: {},
  });
  assert.equal(configuration.providers["company-ai"]?.avatarId, "deepseek");
  assert.throws(() => parseModelsConfiguration({
    version: 1,
    providers: { "company-ai": { avatarId: "uploaded-image" } },
    imageProviders: {},
  }));
});
