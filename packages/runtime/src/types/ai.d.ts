export type Api = string;
export type ImagesApi = string;
export type ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ProviderHeaders {
  [name: string]: string | null;
}

export interface Model<TApi extends Api = Api> {
  id: string;
  name: string;
  api: TApi;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ModelThinkingLevel, string | null>>;
  input: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  headers?: ProviderHeaders;
  compat?: Record<string, unknown>;
}

export function getSupportedThinkingLevels(model: Model): ModelThinkingLevel[];
export function clampThinkingLevel(model: Model, level: ModelThinkingLevel): ModelThinkingLevel;

export interface AssistantMessage {
  role: "assistant";
  content: unknown;
  api: Api;
  provider: string;
  model: string;
  stopReason: string;
  errorMessage?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
  };
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  mimeType: string;
  data: string;
}

export interface ImagesContext {
  input: Array<TextContent | ImageContent>;
  edit?: {
    mask?: ImageContent;
    background?: "transparent" | "opaque" | "auto";
    inputFidelity?: "low" | "high";
  };
  outputCount?: number;
}

export interface ImagesOptions {
  signal?: AbortSignal;
  apiKey?: string;
  headers?: ProviderHeaders;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AssistantImages {
  api: ImagesApi;
  provider: string;
  model: string;
  output: Array<TextContent | ImageContent>;
  responseId?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  stopReason: "stop" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
}

export interface ImagesModel<TApi extends ImagesApi = ImagesApi> {
  id: string;
  name: string;
  api: TApi;
  provider: string;
  baseUrl: string;
  input: Array<"text" | "image">;
  output: Array<"text" | "image">;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  headers?: ProviderHeaders;
  capabilities?: {
    supportsMaskEditing: boolean;
    supportsTransparentBackground: boolean;
  };
}

export interface ApiKeyCredential {
  type: "api_key";
  key?: string;
  env?: Record<string, string>;
}

export interface OAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
}

export type Credential = ApiKeyCredential | OAuthCredential;

export interface ModelAuth {
  apiKey?: string;
  headers?: ProviderHeaders;
  baseUrl?: string;
}

export interface ApiKeyAuth {
  name: string;
  login?(callbacks: unknown): Promise<ApiKeyCredential>;
  resolve(input: { model: Model | ImagesModel; ctx: { env(name: string): Promise<string | undefined> }; credential?: ApiKeyCredential }): Promise<{ auth: ModelAuth; source?: string } | undefined>;
}

export interface OAuthAuth {
  name: string;
  login(callbacks: unknown): Promise<OAuthCredential>;
  refresh(credential: OAuthCredential): Promise<OAuthCredential>;
  toAuth(credential: OAuthCredential): Promise<ModelAuth>;
}

export interface ProviderAuth {
  apiKey?: ApiKeyAuth;
  oauth?: OAuthAuth;
}

export interface CredentialStore {
  read(providerId: string): Promise<Credential | undefined>;
  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
  delete(providerId: string): Promise<void>;
}

export interface ProviderStreams {
  stream(model: Model, context: unknown, options?: unknown): unknown;
  streamSimple(model: Model, context: unknown, options?: unknown): unknown;
}

export interface ProviderImages {
  generateImages(model: ImagesModel, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages>;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl?: string;
  headers?: ProviderHeaders;
  auth: ProviderAuth;
  getModels(): readonly Model[];
  stream(model: Model, context: unknown, options?: unknown): unknown;
  streamSimple(model: Model, context: unknown, options?: unknown): unknown;
}

export interface ImagesProvider {
  id: string;
  name: string;
  auth: ProviderAuth;
  getModels(): readonly ImagesModel[];
  generateImages(model: ImagesModel, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages>;
}

export interface MutableModels {
  setProvider(provider: Provider): void;
  deleteProvider(id: string): void;
  clearProviders(): void;
  getProviders(): readonly Provider[];
  getProvider(id: string): Provider | undefined;
  getModel(provider: string, id: string): Model | undefined;
  getModels(provider?: string): readonly Model[];
  refresh(provider?: string): Promise<void>;
  streamSimple(model: Model, context: unknown, options?: unknown): unknown;
}

export interface Models extends MutableModels {}

export interface MutableImagesModels {
  setProvider(provider: ImagesProvider): void;
  deleteProvider(id: string): void;
  clearProviders(): void;
  getProviders(): readonly ImagesProvider[];
  getProvider(id: string): ImagesProvider | undefined;
  getModel(provider: string, id: string): ImagesModel | undefined;
  getModels(provider?: string): readonly ImagesModel[];
  generateImages(model: ImagesModel, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages>;
}

export function createModels(options?: { credentials?: CredentialStore }): MutableModels;
export function createImagesModels(options?: { credentials?: CredentialStore }): MutableImagesModels;
export function createProvider(input: { id: string; name: string; baseUrl: string; auth: unknown; models: readonly Model[]; api: unknown }): Provider;
export function createImagesProvider(input: { id: string; name: string; auth: unknown; models: readonly ImagesModel[]; api: ProviderImages }): ImagesProvider;
export function envApiKeyAuth(name: string, envVars: readonly string[]): unknown;
export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean;
