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

test("parses custom image protocols, connections, and capability declarations", () => {
  const configuration = parseModelsConfiguration({
    version: 1,
    providers: {},
    imageProviders: {
      "studio-images": {
        name: "Studio Images",
        baseUrl: "https://images.example.com/v1",
        api: "google-interactions-images",
        connection: { region: "cn-beijing", workspaceId: "workspace-1" },
        models: [{
          id: "studio-image-v1",
          input: ["text", "image"],
          output: ["image"],
          capabilities: {
            supportsTextToImage: true,
            supportsReferenceImageEditing: true,
            supportsMaskEditing: false,
            supportsTransparentBackground: false,
            maxReferenceImages: 3,
            maxOutputImages: 1,
            aspectRatios: ["1:1", "16:9"],
            resolutions: ["1K", "2K"],
            outputFormats: ["png", "jpeg"],
            qualityLevels: ["auto"],
          },
        }],
      },
    },
  });

  const provider = configuration.imageProviders?.["studio-images"];
  assert.equal(provider?.connection?.workspaceId, "workspace-1");
  assert.deepEqual(provider?.models?.[0]?.capabilities?.aspectRatios, ["1:1", "16:9"]);
  assert.deepEqual(provider?.models?.[0]?.capabilities?.outputFormats, ["png", "jpeg"]);
});
