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
            minimal: null,
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
