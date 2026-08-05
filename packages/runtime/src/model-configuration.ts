import { execFileSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import {
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_MODELS_CONFIGURATION,
  modelReferenceKey,
  parseModelSettings,
  parseModelsConfiguration,
  type ImageModelDefinition,
  type ImageProviderConfiguration,
  type ModelSettings,
  type ModelsConfiguration,
  type ProviderConfiguration,
} from "@wordless/model-config";
import type { ProviderExtension, ProviderExtensionApi } from "@wordless/provider-sdk";
import { anthropicMessagesApi } from "@wordless/ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@wordless/ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@wordless/ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@wordless/ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@wordless/ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@wordless/ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@wordless/ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@wordless/ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@wordless/ai/api/openai-responses.lazy";
import { openrouterImagesApi } from "@wordless/ai/api/openrouter-images.lazy";
import { openaiImagesApi } from "@wordless/ai/api/openai-images";
import {
  createImagesProvider,
  createProvider,
  getSupportedThinkingLevels,
  type Api,
  type AssistantImages,
  type ApiKeyAuth,
  type CredentialStore,
  type ImagesModel,
  type ImagesContext,
  type ImagesProvider,
  type Model,
  type MutableImagesModels,
  type MutableModels,
  type Provider,
  type ProviderAuth,
  type ProviderHeaders,
  type ProviderImages,
  type ProviderStreams,
} from "@wordless/ai";
import { builtinImagesProviders, builtinProviders } from "@wordless/ai/providers/all";
import type { ConfiguredModelSummary, ConfiguredProviderSummary, ModelConfigurationSnapshot, ProviderAvatarId } from "@wordless/domain";

type ModelKind = "chat" | "image";

export type ModelConfigurationPaths = {
  extensionsRoot: string;
  modelsPath: string;
  settingsPath: string;
};

type RuntimeModelConfigurationOptions = {
  credentials: CredentialStore;
  imageModels: MutableImagesModels;
  models: MutableModels;
  paths: ModelConfigurationPaths;
};

type ConfigurationListener = (snapshot: ModelConfigurationSnapshot) => void;

const CHAT_PROTOCOLS = new Map<string, ProviderStreams>([
  ["anthropic-messages", anthropicMessagesApi() as ProviderStreams],
  ["azure-openai-responses", azureOpenAIResponsesApi() as ProviderStreams],
  ["bedrock-converse-stream", bedrockConverseStreamApi() as ProviderStreams],
  ["google-generative-ai", googleGenerativeAIApi() as ProviderStreams],
  ["google-vertex", googleVertexApi() as ProviderStreams],
  ["mistral-conversations", mistralConversationsApi() as ProviderStreams],
  ["openai-codex-responses", openAICodexResponsesApi() as ProviderStreams],
  ["openai-completions", openAICompletionsApi() as ProviderStreams],
  ["openai-responses", openAIResponsesApi() as ProviderStreams],
]);

const IMAGE_PROTOCOLS = new Map<string, ProviderImages>([
  ["openai-images", openaiImagesApi() as ProviderImages],
  ["openrouter-images", openrouterImagesApi() as ProviderImages],
]);
// The Electron main bundle is CommonJS, where Rolldown lowers import.meta.url to an empty
// object. Prefer the native CommonJS filename and keep the ESM fallback for package consumers.
const requireExtension = createRequire(typeof __filename === "string" ? __filename : import.meta.url);

function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      result += character;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    result += character;
  }
  return result;
}

function resolveConfigValue(value: string): string | undefined {
  if (value.startsWith("!")) {
    const command = value.slice(1);
    try {
      const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
      const arguments_ = process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-lc", command];
      const output = execFileSync(shell, arguments_, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, windowsHide: true });
      return output.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  const resolved = value.replace(/\$\$|\$!|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced: string | undefined, bare: string | undefined) => {
    if (match === "$$") return "$";
    if (match === "$!") return "!";
    return process.env[braced ?? bare ?? ""] ?? "";
  });
  return resolved || undefined;
}

function resolveHeaders(headers: Record<string, string> | undefined): ProviderHeaders | undefined {
  if (!headers) return undefined;
  const resolved: ProviderHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const current = resolveConfigValue(value);
    if (current) resolved[name] = current;
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function mergeHeaders(...sources: Array<ProviderHeaders | undefined>): ProviderHeaders | undefined {
  const result: ProviderHeaders = {};
  for (const source of sources) {
    if (source) Object.assign(result, source);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function modelHeaders(configuration: ProviderConfiguration | ImageProviderConfiguration, modelId: string): ProviderHeaders | undefined {
  const override = "modelOverrides" in configuration ? configuration.modelOverrides?.[modelId] : undefined;
  return mergeHeaders(resolveHeaders(configuration.headers), resolveHeaders(override?.headers));
}

function sourceFrom(id: string, builtins: ReadonlyMap<string, unknown>, extensions: ReadonlyMap<string, unknown>): "builtin" | "extension" | "custom" {
  if (extensions.has(id)) return "extension";
  return builtins.has(id) ? "builtin" : "custom";
}

function avatarFrom(source: "builtin" | "extension" | "custom", configuration: ProviderConfiguration | ImageProviderConfiguration | null | undefined): ProviderAvatarId | null {
  return source === "custom" ? configuration?.avatarId ?? null : null;
}

function isProviderExtension(value: unknown): value is ProviderExtension {
  return typeof value === "object" && value !== null && "activate" in value && typeof value.activate === "function";
}

function configuredAuth(source: ProviderAuth, configuration: ProviderConfiguration | ImageProviderConfiguration): ProviderAuth {
  const sourceApiKey = source.apiKey;
  const configApiKey: ApiKeyAuth = {
    name: sourceApiKey?.name ?? "Configured API key",
    login: sourceApiKey?.login,
    resolve: async (input) => {
      const headers = mergeHeaders(resolveHeaders(configuration.headers), modelHeaders(configuration, input.model.id));
      if (input.credential?.key) {
        if (sourceApiKey) return await sourceApiKey.resolve(input);
        return { auth: { apiKey: input.credential.key, headers }, source: "stored credential" };
      }
      const apiKey = configuration.apiKey ? resolveConfigValue(configuration.apiKey) : undefined;
      if (apiKey) {
        const configuredHeaders = configuration.authHeader ? { ...headers, Authorization: `Bearer ${apiKey}` } : headers;
        return { auth: { apiKey, headers: configuredHeaders }, source: "models.json" };
      }
      if (sourceApiKey) {
        const resolved = await sourceApiKey.resolve(input);
        if (!resolved) return headers ? { auth: { headers }, source: "models.json" } : undefined;
        return { ...resolved, auth: { ...resolved.auth, headers: mergeHeaders(headers, resolved.auth.headers) } };
      }
      return headers ? { auth: { headers }, source: "models.json" } : undefined;
    },
  };
  return { apiKey: configApiKey, oauth: source.oauth };
}

function applyChatConfiguration(model: Model<Api>, configuration: ProviderConfiguration): Model<Api> {
  const override = configuration.modelOverrides?.[model.id];
  return {
    ...model,
    name: override?.name ?? model.name,
    baseUrl: configuration.baseUrl ?? model.baseUrl,
    reasoning: override?.reasoning ?? model.reasoning,
    input: override?.input ?? model.input,
    contextWindow: override?.contextWindow ?? model.contextWindow,
    maxTokens: override?.maxTokens ?? model.maxTokens,
    thinkingLevelMap: override?.thinkingLevelMap
      ? { ...(model.thinkingLevelMap ?? {}), ...override.thinkingLevelMap }
      : model.thinkingLevelMap,
    compat: { ...(model.compat ?? {}), ...(configuration.compat ?? {}), ...(override?.compat ?? {}) },
  };
}

function customChatModel(providerId: string, configuration: ProviderConfiguration, definition: NonNullable<ProviderConfiguration["models"]>[number]): Model<Api> | undefined {
  const api = definition.api ?? configuration.api;
  const baseUrl = definition.baseUrl ?? configuration.baseUrl;
  if (!api || !baseUrl) return undefined;
  return {
    id: definition.id,
    name: definition.name ?? definition.id,
    api,
    provider: providerId,
    baseUrl,
    reasoning: definition.reasoning ?? false,
    input: definition.input ?? ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: definition.contextWindow ?? 128_000,
    maxTokens: definition.maxTokens ?? 16_384,
    thinkingLevelMap: definition.thinkingLevelMap,
    compat: definition.compat,
  };
}

function applyImageConfiguration(model: ImagesModel, configuration: ImageProviderConfiguration): ImagesModel {
  return { ...model, baseUrl: configuration.baseUrl ?? model.baseUrl };
}

function customImageModel(providerId: string, configuration: ImageProviderConfiguration, definition: ImageModelDefinition): ImagesModel | undefined {
  const api = definition.api ?? configuration.api;
  const baseUrl = definition.baseUrl ?? configuration.baseUrl;
  if (!api || !baseUrl) return undefined;
  return {
    id: definition.id,
    name: definition.name ?? definition.id,
    api,
    provider: providerId,
    baseUrl,
    input: definition.input ?? ["text"],
    output: definition.output ?? ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    capabilities: {
      supportsMaskEditing: definition.capabilities?.supportsMaskEditing ?? false,
      supportsTransparentBackground: definition.capabilities?.supportsTransparentBackground ?? false,
    },
  };
}

export class RuntimeModelConfiguration {
  private readonly chatExtensions = new Map<string, Provider>();
  private readonly imageExtensions = new Map<string, ImagesProvider>();
  private diagnostics: string[] = [];
  private imageBuiltins = new Map<string, ImagesProvider>();
  private listeners = new Set<ConfigurationListener>();
  private modelsConfiguration: ModelsConfiguration = DEFAULT_MODELS_CONFIGURATION;
  private readonly options: RuntimeModelConfigurationOptions;
  private chatBuiltins = new Map<string, Provider>();
  private readonly configuredProviderIds = new Set<string>();
  private settings: ModelSettings = DEFAULT_MODEL_SETTINGS;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private watchers: Array<ReturnType<typeof watch>> = [];

  constructor(options: RuntimeModelConfigurationOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.options.paths.modelsPath), { recursive: true });
    await mkdir(this.options.paths.extensionsRoot, { recursive: true });
    await this.ensureFile(this.options.paths.modelsPath, DEFAULT_MODELS_CONFIGURATION);
    await this.ensureFile(this.options.paths.settingsPath, DEFAULT_MODEL_SETTINGS);
    this.chatBuiltins = new Map(builtinProviders().map((provider) => [provider.id, provider]));
    this.imageBuiltins = new Map(builtinImagesProviders().map((provider) => [provider.id, provider]));
    await this.loadExtensions();
    await this.reload();
    await this.refreshCredentialStatuses();
    this.watchers = [watch(this.options.paths.modelsPath, () => this.scheduleReload()), watch(this.options.paths.settingsPath, () => this.scheduleReload())];
  }

  dispose(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.watchTimer) clearTimeout(this.watchTimer);
  }

  subscribe(listener: ConfigurationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ModelConfigurationSnapshot {
    const chatEnabled = new Set(this.settings.enabledChatModels);
    const imageEnabled = new Set(this.settings.enabledImageModels);
    const providers: ConfiguredProviderSummary[] = [];
    const models: ConfiguredModelSummary[] = [];
    for (const provider of this.options.models.getProviders()) {
      const providerModels = provider.getModels();
      const configuration = this.modelsConfiguration.providers[provider.id] ?? null;
      const source = sourceFrom(provider.id, this.chatBuiltins, this.chatExtensions);
      const avatarId = avatarFrom(source, configuration);
      providers.push({
        id: provider.id,
        displayName: provider.name,
        kind: "chat",
        source,
        avatarId,
        baseUrl: provider.baseUrl ?? providerModels[0]?.baseUrl ?? null,
        authStatus: this.authStatus(provider.id, configuration),
        enabledModelCount: providerModels.filter((model) => chatEnabled.has(modelReferenceKey(provider.id, model.id))).length,
        modelCount: providerModels.length,
        apiKeyConfigured: this.apiKeyConfigured(configuration),
        supportsOAuth: provider.auth.oauth !== undefined,
        configuration,
      });
      for (const model of providerModels) models.push({ providerId: provider.id, providerAvatarId: avatarId, modelId: model.id, displayName: model.name, kind: "chat", enabled: chatEnabled.has(modelReferenceKey(provider.id, model.id)), supportsVision: model.input.includes("image"), supportsReasoning: model.reasoning, supportedThinkingLevels: getSupportedThinkingLevels(model), contextWindow: model.contextWindow, api: model.api, imageCapabilities: null });
    }
    for (const provider of this.options.imageModels.getProviders()) {
      const providerModels = provider.getModels();
      const configuration = this.modelsConfiguration.imageProviders?.[provider.id] ?? null;
      const source = sourceFrom(provider.id, this.imageBuiltins, this.imageExtensions);
      const avatarId = avatarFrom(source, configuration);
      providers.push({
        id: provider.id,
        displayName: provider.name,
        kind: "image",
        source,
        avatarId,
        baseUrl: providerModels[0]?.baseUrl ?? null,
        authStatus: this.authStatus(provider.id, configuration),
        enabledModelCount: providerModels.filter((model) => imageEnabled.has(modelReferenceKey(provider.id, model.id))).length,
        modelCount: providerModels.length,
        apiKeyConfigured: this.apiKeyConfigured(configuration),
        supportsOAuth: provider.auth.oauth !== undefined,
        configuration,
      });
      for (const model of providerModels) models.push({ providerId: provider.id, providerAvatarId: avatarId, modelId: model.id, displayName: model.name, kind: "image", enabled: imageEnabled.has(modelReferenceKey(provider.id, model.id)), supportsVision: model.input.includes("image"), supportsReasoning: false, supportedThinkingLevels: ["off"], contextWindow: null, api: model.api, imageCapabilities: { supportsMaskEditing: model.capabilities?.supportsMaskEditing ?? false, supportsTransparentBackground: model.capabilities?.supportsTransparentBackground ?? false } });
    }
    for (const [id, configuration] of Object.entries(this.modelsConfiguration.providers)) {
      if (providers.some((provider) => provider.kind === "chat" && provider.id === id)) continue;
      providers.push({ id, displayName: configuration.name ?? id, kind: "chat", source: "custom", avatarId: configuration.avatarId ?? null, baseUrl: configuration.baseUrl ?? null, authStatus: this.authStatus(id, configuration), enabledModelCount: 0, modelCount: 0, apiKeyConfigured: this.apiKeyConfigured(configuration), supportsOAuth: false, configuration });
    }
    for (const [id, configuration] of Object.entries(this.modelsConfiguration.imageProviders ?? {})) {
      if (providers.some((provider) => provider.kind === "image" && provider.id === id)) continue;
      providers.push({ id, displayName: configuration.name ?? id, kind: "image", source: "custom", avatarId: configuration.avatarId ?? null, baseUrl: configuration.baseUrl ?? null, authStatus: this.authStatus(id, configuration), enabledModelCount: 0, modelCount: 0, apiKeyConfigured: this.apiKeyConfigured(configuration), supportsOAuth: false, configuration });
    }
    return { providers, models, diagnostics: this.diagnostics };
  }

  enabledChatModels(): Model<Api>[] {
    const enabled = new Set(this.settings.enabledChatModels);
    return this.options.models.getModels().filter((model) => enabled.has(modelReferenceKey(model.provider, model.id))) as Model<Api>[];
  }

  async generateImage(providerId: string, modelId: string, context: ImagesContext, options?: { signal?: AbortSignal }): Promise<AssistantImages> {
    const key = modelReferenceKey(providerId, modelId);
    if (!this.settings.enabledImageModels.includes(key)) {
      throw new Error("The selected image model is not enabled");
    }
    const model = this.options.imageModels.getModel(providerId, modelId);
    if (!model) throw new Error("The selected image model is no longer available");
    if (context.input.some((item) => item.type === "image") && !model.input.includes("image")) {
      throw new Error("The selected image model does not support reference images");
    }
    if (context.edit?.mask && !model.capabilities?.supportsMaskEditing) throw new Error("The selected image model does not support mask editing");
    if (context.edit?.background === "transparent" && !model.capabilities?.supportsTransparentBackground) throw new Error("The selected image model does not support transparent backgrounds");
    return await this.options.imageModels.generateImages(model, context, { signal: options?.signal });
  }

  async saveProviderConfiguration(kind: ModelKind, providerId: string, configuration: Record<string, unknown>): Promise<void> {
    if (kind === "chat") {
      const next = { ...this.modelsConfiguration, providers: { ...this.modelsConfiguration.providers, [providerId]: configuration } };
      this.modelsConfiguration = parseModelsConfiguration(next);
    } else {
      const next = { ...this.modelsConfiguration, imageProviders: { ...(this.modelsConfiguration.imageProviders ?? {}), [providerId]: configuration } };
      this.modelsConfiguration = parseModelsConfiguration(next);
    }
    await this.writeJson(this.options.paths.modelsPath, this.modelsConfiguration);
    await this.rebuild();
  }

  async deleteCustomProvider(kind: ModelKind, providerId: string): Promise<void> {
    const configurations = kind === "chat" ? this.modelsConfiguration.providers : this.modelsConfiguration.imageProviders ?? {};
    const builtins = kind === "chat" ? this.chatBuiltins : this.imageBuiltins;
    const extensions = kind === "chat" ? this.chatExtensions : this.imageExtensions;
    if (!Object.hasOwn(configurations, providerId) || sourceFrom(providerId, builtins, extensions) !== "custom") {
      throw new Error("Only custom providers can be deleted");
    }

    if (kind === "chat") {
      const providers = { ...this.modelsConfiguration.providers };
      delete providers[providerId];
      this.modelsConfiguration = parseModelsConfiguration({ ...this.modelsConfiguration, providers });
    } else {
      const imageProviders = { ...(this.modelsConfiguration.imageProviders ?? {}) };
      delete imageProviders[providerId];
      this.modelsConfiguration = parseModelsConfiguration({ ...this.modelsConfiguration, imageProviders });
    }

    const referencePrefix = `${providerId}/`;
    const current = kind === "chat" ? this.settings.enabledChatModels : this.settings.enabledImageModels;
    const enabledModels = current.filter((reference) => !reference.startsWith(referencePrefix));
    if (enabledModels.length !== current.length) {
      this.settings = kind === "chat"
        ? { ...this.settings, enabledChatModels: enabledModels }
        : { ...this.settings, enabledImageModels: enabledModels };
    }

    await this.writeJson(this.options.paths.modelsPath, this.modelsConfiguration);
    if (enabledModels.length !== current.length) await this.writeJson(this.options.paths.settingsPath, this.settings);
    await this.rebuild();
  }

  async setEnabled(kind: ModelKind, providerId: string, modelId: string, enabled: boolean): Promise<void> {
    const key = modelReferenceKey(providerId, modelId);
    const current = kind === "chat" ? this.settings.enabledChatModels : this.settings.enabledImageModels;
    const next = enabled ? [...new Set([...current, key])] : current.filter((reference) => reference !== key);
    this.settings = kind === "chat" ? { ...this.settings, enabledChatModels: next } : { ...this.settings, enabledImageModels: next };
    await this.writeJson(this.options.paths.settingsPath, this.settings);
    this.emit();
  }

  async loginOAuth(providerId: string, callbacks: unknown): Promise<void> {
    const provider = this.options.models.getProvider(providerId) ?? this.options.imageModels.getProvider(providerId);
    const oauth = provider?.auth.oauth;
    if (!oauth) throw new Error(`Provider ${providerId} does not support OAuth.`);
    const credential = await oauth.login(callbacks);
    await this.options.credentials.modify(providerId, async () => credential);
    this.configuredProviderIds.add(providerId);
    this.emit();
  }

  private async ensureFile(path: string, value: unknown): Promise<void> {
    if (!existsSync(path)) await this.writeJson(path, value);
  }

  private async loadExtensions(): Promise<void> {
    const entries = await readdir(this.options.paths.extensionsRoot, { withFileTypes: true });
    const api: ProviderExtensionApi = {
      registerChatProvider: (provider) => this.chatExtensions.set(provider.id, provider),
      registerImageProvider: (provider) => this.imageExtensions.set(provider.id, provider),
      registerChatProtocol: (id, streams) => CHAT_PROTOCOLS.set(id, streams),
      registerImageProtocol: (id, images) => IMAGE_PROTOCOLS.set(id, images),
    };
    for (const entry of entries) {
      const file = entry.isFile() && extname(entry.name) === ".cjs" ? join(this.options.paths.extensionsRoot, entry.name) : entry.isDirectory() ? join(this.options.paths.extensionsRoot, entry.name, "index.cjs") : undefined;
      if (!file || !existsSync(file)) continue;
      try {
        const module = requireExtension(file) as ProviderExtension | ((extensionApi: ProviderExtensionApi) => void | Promise<void>) | { default?: ProviderExtension | ((extensionApi: ProviderExtensionApi) => void | Promise<void>) };
        const extension = typeof module === "object" && module !== null && "default" in module ? module.default : module;
        if (typeof extension === "function") await extension(api);
        else if (isProviderExtension(extension)) await extension.activate(api);
        else this.diagnostics.push(`Extension ${basename(file)} has no valid default export.`);
      } catch (error) {
        this.diagnostics.push(`Extension ${basename(file)} failed to load: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async reload(): Promise<void> {
    try {
      const modelsValue = JSON.parse(stripJsonComments(await readFile(this.options.paths.modelsPath, "utf8"))) as unknown;
      const settingsValue = JSON.parse(stripJsonComments(await readFile(this.options.paths.settingsPath, "utf8"))) as unknown;
      this.modelsConfiguration = parseModelsConfiguration(modelsValue);
      this.settings = parseModelSettings(settingsValue);
      await this.rebuild();
    } catch (error) {
      this.diagnostics = [`Model configuration reload failed: ${error instanceof Error ? error.message : String(error)}`];
      this.emit();
    }
  }

  private async refreshCredentialStatuses(): Promise<void> {
    const providerIds = new Set([
      ...this.options.models.getProviders().map((provider) => provider.id),
      ...this.options.imageModels.getProviders().map((provider) => provider.id),
    ]);
    this.configuredProviderIds.clear();
    for (const providerId of providerIds) {
      const credential = await this.options.credentials.read(providerId);
      if (credential?.type === "oauth" || (credential?.type === "api_key" && Boolean(credential.key))) this.configuredProviderIds.add(providerId);
    }
  }

  private async rebuild(): Promise<void> {
    this.diagnostics = this.diagnostics.filter((diagnostic) => diagnostic.startsWith("Extension "));
    this.options.models.clearProviders();
    this.options.imageModels.clearProviders();
    const chatSources = new Map([...this.chatBuiltins, ...this.chatExtensions]);
    const imageSources = new Map([...this.imageBuiltins, ...this.imageExtensions]);
    for (const [id, source] of chatSources) this.options.models.setProvider(this.buildChatProvider(id, source, this.modelsConfiguration.providers[id]));
    for (const [id, configuration] of Object.entries(this.modelsConfiguration.providers)) {
      if (chatSources.has(id)) continue;
      const provider = this.buildCustomChatProvider(id, configuration);
      if (provider) this.options.models.setProvider(provider);
    }
    for (const [id, source] of imageSources) this.options.imageModels.setProvider(this.buildImageProvider(id, source, this.modelsConfiguration.imageProviders?.[id]));
    for (const [id, configuration] of Object.entries(this.modelsConfiguration.imageProviders ?? {})) {
      if (imageSources.has(id)) continue;
      const provider = this.buildCustomImageProvider(id, configuration);
      if (provider) this.options.imageModels.setProvider(provider);
    }
    this.emit();
  }

  private buildChatProvider(id: string, source: Provider, configuration: ProviderConfiguration | undefined): Provider {
    if (!configuration) return source;
    const models = source.getModels().map((model) => applyChatConfiguration(model as Model<Api>, configuration));
    return {
      ...source,
      id,
      name: configuration.name ?? source.name,
      baseUrl: configuration.baseUrl ?? source.baseUrl,
      auth: configuredAuth(source.auth, configuration),
      getModels: () => models,
    };
  }

  private buildImageProvider(id: string, source: ImagesProvider, configuration: ImageProviderConfiguration | undefined): ImagesProvider {
    if (!configuration) return source;
    const models = source.getModels().map((model) => applyImageConfiguration(model, configuration));
    return { ...source, id, name: configuration.name ?? source.name, auth: configuredAuth(source.auth, configuration), getModels: () => models };
  }

  private buildCustomChatProvider(id: string, configuration: ProviderConfiguration): Provider | undefined {
    const models = (configuration.models ?? []).map((model) => customChatModel(id, configuration, model)).filter((model): model is Model<Api> => model !== undefined);
    const api = configuration.api ? CHAT_PROTOCOLS.get(configuration.api) : undefined;
    if (!api || models.length === 0 || !configuration.baseUrl) {
      this.diagnostics.push(`Custom chat provider ${id} needs baseUrl, api, and at least one model.`);
      return undefined;
    }
    return createProvider({ id, name: configuration.name ?? id, baseUrl: configuration.baseUrl, auth: configuredAuth({}, configuration), models, api });
  }

  private buildCustomImageProvider(id: string, configuration: ImageProviderConfiguration): ImagesProvider | undefined {
    const models = (configuration.models ?? []).map((model) => customImageModel(id, configuration, model)).filter((model): model is ImagesModel => model !== undefined);
    const api = configuration.api ? IMAGE_PROTOCOLS.get(configuration.api) : undefined;
    if (!api || models.length === 0 || !configuration.baseUrl) {
      this.diagnostics.push(`Custom image provider ${id} needs baseUrl, api, and at least one model.`);
      return undefined;
    }
    return createImagesProvider({ id, name: configuration.name ?? id, auth: configuredAuth({}, configuration), models, api });
  }

  private scheduleReload(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => void this.reload(), 150);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private authStatus(providerId: string, configuration: Record<string, unknown> | null): "configured" | "missing" {
    return this.configuredProviderIds.has(providerId) || (configuration !== null && Object.keys(configuration).length > 0) ? "configured" : "missing";
  }

  private apiKeyConfigured(configuration: Record<string, unknown> | null): boolean {
    return typeof configuration?.apiKey === "string";
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  }
}
