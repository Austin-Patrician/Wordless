import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createImagesModels, createModels, type Credential, type CredentialStore } from "@wordless/ai";
import { RuntimeModelConfiguration } from "../src/model-configuration.ts";

const credentials: CredentialStore = {
  async delete(): Promise<void> {},
  async modify(_providerId, update): Promise<Credential | undefined> {
    return await update(undefined);
  },
  async read(): Promise<Credential | undefined> {
    return undefined;
  },
};

test("exposes configured thinking levels for custom reasoning models", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-model-thinking-"));
  const modelsPath = join(root, "models.json");
  const settingsPath = join(root, "settings.json");
  await writeFile(modelsPath, JSON.stringify({
    version: 1,
    providers: {
      openai: {
        modelOverrides: {
          "gpt-5.4": {
            thinkingLevelMap: { low: null, max: "max" },
          },
        },
      },
      "company-ai": {
        baseUrl: "https://ai.example.com/v1",
        api: "openai-completions",
        models: [{
          id: "company-reasoner",
          reasoning: true,
          thinkingLevelMap: {
            off: null,
            low: "low",
            medium: null,
            high: "high",
            xhigh: "xhigh",
            max: null,
          },
        }],
      },
    },
    imageProviders: {},
  }), "utf8");
  await writeFile(settingsPath, JSON.stringify({ version: 1, enabledChatModels: ["company-ai/company-reasoner"], enabledImageModels: [] }), "utf8");

  const configuration = new RuntimeModelConfiguration({
    credentials,
    imageModels: createImagesModels({ credentials }),
    models: createModels({ credentials }),
    paths: { extensionsRoot: join(root, "extensions"), modelsPath, settingsPath },
  });

  try {
    await configuration.initialize();
    const model = configuration.snapshot().models.find((candidate) => candidate.providerId === "company-ai" && candidate.modelId === "company-reasoner");
    assert.deepEqual(model?.supportedThinkingLevels, ["low", "high", "xhigh"]);
    const overridden = configuration.snapshot().models.find((candidate) => candidate.providerId === "openai" && candidate.modelId === "gpt-5.4");
    assert.deepEqual(overridden?.supportedThinkingLevels, ["off", "minimal", "medium", "high", "xhigh", "max"]);
  } finally {
    configuration.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("deletes only custom providers and clears their enabled models", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-model-config-"));
  const modelsPath = join(root, "models.json");
  const settingsPath = join(root, "settings.json");
  await writeFile(modelsPath, JSON.stringify({
    version: 1,
    providers: {
      "company-ai": {
        name: "Company AI",
        avatarId: "deepseek",
        baseUrl: "https://ai.example.com/v1",
        api: "openai-completions",
        models: [{ id: "company-chat" }],
      },
    },
    imageProviders: {},
  }), "utf8");
  await writeFile(settingsPath, JSON.stringify({ version: 1, enabledChatModels: ["company-ai/company-chat"], enabledImageModels: [] }), "utf8");

  const configuration = new RuntimeModelConfiguration({
    credentials,
    imageModels: createImagesModels({ credentials }),
    models: createModels({ credentials }),
    paths: { extensionsRoot: join(root, "extensions"), modelsPath, settingsPath },
  });

  try {
    await configuration.initialize();
    const initial = configuration.snapshot();
    assert.equal(initial.providers.find((provider) => provider.id === "company-ai")?.avatarId, "deepseek");
    assert.equal(initial.models.find((model) => model.providerId === "company-ai")?.providerAvatarId, "deepseek");

    await configuration.deleteCustomProvider("chat", "company-ai");

    assert.equal(configuration.snapshot().providers.some((provider) => provider.id === "company-ai"), false);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).enabledChatModels, []);
    await assert.rejects(async () => await configuration.deleteCustomProvider("chat", "openai"), /Only custom providers can be deleted/);
  } finally {
    configuration.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("saves a provider model list and reconciles its enabled references", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-model-save-"));
  const modelsPath = join(root, "models.json");
  const settingsPath = join(root, "settings.json");
  await writeFile(modelsPath, JSON.stringify({ version: 1, providers: { company: { baseUrl: "https://old.example/v1", api: "openai-completions", models: [{ id: "old" }] } }, imageProviders: {} }), "utf8");
  await writeFile(settingsPath, JSON.stringify({ version: 1, enabledChatModels: ["company/old", "openai/gpt-5.4"], enabledImageModels: [] }), "utf8");
  const configuration = new RuntimeModelConfiguration({ credentials, imageModels: createImagesModels({ credentials }), models: createModels({ credentials }), paths: { extensionsRoot: join(root, "extensions"), modelsPath, settingsPath } });
  try {
    await configuration.initialize();
    await configuration.saveProviderConfiguration("chat", "company", { baseUrl: "https://new.example/v1", api: "openai-completions", models: [{ id: "new" }] }, ["new"]);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")).enabledChatModels, ["openai/gpt-5.4", "company/new"]);
    assert.equal(configuration.snapshot().models.some((model) => model.providerId === "company" && model.modelId === "old"), false);
    assert.equal(configuration.snapshot().models.find((model) => model.providerId === "company" && model.modelId === "new")?.enabled, true);
  } finally {
    configuration.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("normalizes custom image capabilities and validates generation options", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-image-config-"));
  const modelsPath = join(root, "models.json");
  const settingsPath = join(root, "settings.json");
  await writeFile(modelsPath, JSON.stringify({
    version: 1,
    providers: {},
    imageProviders: {
      "studio-images": {
        name: "Studio Images",
        baseUrl: "https://images.example.com/v1",
        api: "google-interactions-images",
        models: [{
          id: "studio-image-v1",
          name: "Studio Image",
          input: ["text", "image"],
          capabilities: {
            supportsTextToImage: true,
            supportsReferenceImageEditing: true,
            supportsMaskEditing: false,
            supportsTransparentBackground: false,
            maxReferenceImages: 2,
            maxOutputImages: 1,
            aspectRatios: ["1:1", "16:9"],
            resolutions: ["1K", "2K"],
            outputFormats: ["png", "jpeg"],
            qualityLevels: ["auto"],
          },
        }],
      },
    },
  }), "utf8");
  await writeFile(settingsPath, JSON.stringify({
    version: 1,
    enabledChatModels: [],
    enabledImageModels: ["studio-images/studio-image-v1"],
  }), "utf8");

  const configuration = new RuntimeModelConfiguration({
    credentials,
    imageModels: createImagesModels({ credentials }),
    models: createModels({ credentials }),
    paths: { extensionsRoot: join(root, "extensions"), modelsPath, settingsPath },
  });

  try {
    await configuration.initialize();
    const model = configuration.snapshot().models.find((candidate) => candidate.providerId === "studio-images");
    assert.equal(model?.api, "google-interactions-images");
    assert.deepEqual(model?.imageCapabilities?.resolutions, ["1K", "2K"]);
    assert.equal(model?.imageCapabilities?.maxReferenceImages, 2);

    await assert.rejects(
      configuration.generateImage("studio-images", "studio-image-v1", {
        input: [{ type: "text", text: "A poster" }],
        generation: { aspectRatio: "9:16" },
      }),
      /does not support aspect ratio 9:16/,
    );
    await assert.rejects(
      configuration.generateImage("studio-images", "studio-image-v1", {
        input: [{ type: "text", text: "A poster" }],
        generation: { seed: 42 },
      }),
      /does not support seed control/,
    );
  } finally {
    configuration.dispose();
    await rm(root, { force: true, recursive: true });
  }
});
