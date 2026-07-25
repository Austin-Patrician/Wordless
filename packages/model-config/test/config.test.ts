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
        modelOverrides: { "gpt-4.1-mini": { contextWindow: 200000 } },
      },
      "company-ai": {
        baseUrl: "https://ai.example.com/v1",
        api: "openai-completions",
        models: [{ id: "company-chat", name: "Company Chat" }],
      },
    },
    imageProviders: {},
  });
  assert.equal(configuration.providers.openai?.baseUrl, "https://proxy.example.com/v1");
  assert.equal(configuration.providers["company-ai"]?.models?.[0]?.id, "company-chat");
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
