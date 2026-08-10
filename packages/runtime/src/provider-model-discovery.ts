import type {
  ProviderModelCandidate,
  ProviderModelDiscoveryRequest,
  ProviderModelFetcherId,
} from "@wordless/domain";
import type { Model } from "@wordless/ai";

type JsonRecord = Record<string, unknown>;

type ModelFetcher = {
  id: ProviderModelFetcherId;
  match: (request: ProviderModelDiscoveryRequest) => boolean;
  fetch: (request: ProviderModelDiscoveryRequest, context: FetchContext) => Promise<ProviderModelCandidate[]>;
};

type FetchContext = {
  fetch: typeof globalThis.fetch;
  signal: AbortSignal;
};

type DiscoveryOptions = {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
};

const MAX_RESPONSE_CHARACTERS = 5_000_000;
const MAX_MODELS = 10_000;
const VERTEX_PUBLISHERS = ["google", "openai", "meta", "qwen", "deepseek-ai", "moonshotai", "zai-org"];
const NON_CHAT_MODEL_KEYWORDS = [
  "embedding", "rerank", "whisper", "transcribe", "speech", "tts", "realtime", "sora", "dall-e", "imagen",
];

export async function discoverProviderModels(
  request: ProviderModelDiscoveryRequest,
  options: DiscoveryOptions = {},
): Promise<ProviderModelCandidate[]> {
  const normalized = normalizeRequest(request);
  const fetcher = normalized.modelFetcher
    ? FETCHERS.find((candidate) => candidate.id === normalized.modelFetcher)
    : FETCHERS.find((candidate) => candidate.match(normalized));
  if (!fetcher) throw new Error("No model fetcher is available for this provider.");

  const signal = options.signal ?? AbortSignal.timeout(20_000);
  const models = await fetcher.fetch(normalized, { fetch: options.fetch ?? globalThis.fetch, signal });
  return dedupeModels(models.filter(isChatCandidate)).slice(0, MAX_MODELS);
}

export type BuiltinModelCatalogEntry = {
  providerId: string;
  model: Model<string>;
};

export function enrichProviderModelCandidates(
  candidates: ProviderModelCandidate[],
  catalog: readonly BuiltinModelCatalogEntry[],
): ProviderModelCandidate[] {
  return candidates.map((candidate) => {
    const match = bestBuiltinMatch(candidate, catalog);
    if (!match) return candidate;
    const model = match.model;
    return {
      ...candidate,
      supportsVision: model.input.includes("image"),
      supportsReasoning: model.reasoning,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      configuration: {
        reasoning: model.reasoning,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
      },
    };
  });
}

function bestBuiltinMatch(candidate: ProviderModelCandidate, catalog: readonly BuiltinModelCatalogEntry[]): BuiltinModelCatalogEntry | undefined {
  const remoteId = normalizeModelId(candidate.id);
  const remoteTail = modelIdTail(remoteId);
  const hint = `${candidate.id} ${candidate.name} ${candidate.ownedBy ?? ""}`.toLowerCase();
  let best: { entry: BuiltinModelCatalogEntry; score: number } | undefined;
  for (const entry of catalog) {
    const builtinId = normalizeModelId(entry.model.id);
    const builtinTail = modelIdTail(builtinId);
    let score = -1;
    if (builtinId === remoteId) score = 100;
    else if (builtinTail === remoteId || builtinId === remoteTail) score = 92;
    else if (builtinTail === remoteTail) score = 86;
    if (score < 0) continue;
    if (hint.includes(entry.providerId.toLowerCase())) score += 4;
    if (hint.includes(modelFamilyHint(entry.model.id))) score += 2;
    if (!best || score > best.score) best = { entry, score };
  }
  return best?.entry;
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replace(/^models\//, "");
}

function modelIdTail(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function modelFamilyHint(value: string): string {
  return modelIdTail(normalizeModelId(value)).split(/[-_.:]/)[0] ?? "";
}

function normalizeRequest(request: ProviderModelDiscoveryRequest): ProviderModelDiscoveryRequest {
  const baseUrl = request.baseUrl.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Base URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Base URL must use HTTP or HTTPS.");
  }
  return {
    ...request,
    providerId: request.providerId.trim(),
    baseUrl,
    ...(request.apiKey?.trim() ? { apiKey: request.apiKey.trim() } : {}),
  };
}

function providerHints(request: ProviderModelDiscoveryRequest): string {
  return `${request.providerId} ${request.providerFamily ?? ""} ${request.baseUrl} ${request.api ?? ""}`.toLowerCase();
}

function hintIncludes(request: ProviderModelDiscoveryRequest, ...values: string[]): boolean {
  const hints = providerHints(request);
  return values.some((value) => hints.includes(value));
}

function defaultHeaders(request: ProviderModelDiscoveryRequest): Record<string, string> {
  return {
    Accept: "application/json",
    ...(request.apiKey && request.authHeader !== false ? { Authorization: `Bearer ${request.apiKey}` } : {}),
    ...(request.headers ?? {}),
  };
}

async function fetchJson(url: string, headers: Record<string, string>, context: FetchContext): Promise<unknown> {
  let response: Response;
  try {
    response = await context.fetch(url, { headers, signal: context.signal });
  } catch (error) {
    if (context.signal.aborted) throw new Error("Model request timed out or was cancelled.");
    throw new Error(`Unable to reach the model endpoint: ${safeErrorMessage(error)}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_CHARACTERS) throw new Error("The model response is too large.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) throw new Error("The model response is too large.");
  if (!response.ok) throw new Error(`Model request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The model endpoint did not return valid JSON.");
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.replace(/(?:sk-|key-|Bearer\s+)[A-Za-z0-9._-]+/gi, "[credential]");
  return "network error";
}

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => item !== undefined) : [];
}

function stringValue(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return undefined;
}

function toCandidate(item: JsonRecord, idKeys: string[] = ["id"]): ProviderModelCandidate | undefined {
  const id = stringValue(...idKeys.map((key) => item[key]));
  if (!id) return undefined;
  return {
    id,
    name: stringValue(item.name, item.display_name, item.displayName, item.model_name, id) ?? id,
    ...(stringValue(item.owned_by, item.ownedBy, item.organization, item.publisher) ? { ownedBy: stringValue(item.owned_by, item.ownedBy, item.organization, item.publisher) } : {}),
    ...(stringValue(item.description, item.desc, item.summary) ? { description: stringValue(item.description, item.desc, item.summary) } : {}),
    ...(numberValue(item.context_length, item.contextWindow, item.inputTokenLimit) ? { contextWindow: numberValue(item.context_length, item.contextWindow, item.inputTokenLimit) } : {}),
    ...(numberValue(item.max_output, item.maxTokens, item.outputTokenLimit) ? { maxTokens: numberValue(item.max_output, item.maxTokens, item.outputTokenLimit) } : {}),
  };
}

function dataModels(value: unknown): JsonRecord[] {
  const root = record(value);
  return records(root?.data ?? root?.models ?? value);
}

function mapCandidates(items: JsonRecord[], idKeys?: string[]): ProviderModelCandidate[] {
  return items.map((item) => toCandidate(item, idKeys)).filter((item): item is ProviderModelCandidate => item !== undefined);
}

function dedupeModels(models: ProviderModelCandidate[]): ProviderModelCandidate[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    const id = model.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isChatCandidate(model: ProviderModelCandidate): boolean {
  const id = model.id.toLowerCase();
  return !NON_CHAT_MODEL_KEYWORDS.some((keyword) => id.includes(keyword));
}

function appendModelsPath(baseUrl: string): string {
  return /\/models(?:\?|$)/.test(baseUrl) ? baseUrl : `${baseUrl}/models`;
}

const openAICompatibleFetcher = (id: ProviderModelFetcherId, match: ModelFetcher["match"]): ModelFetcher => ({
  id,
  match,
  fetch: async (request, context) => mapCandidates(dataModels(await fetchJson(appendModelsPath(request.baseUrl), defaultHeaders(request), context))),
});

const aihubmixFetcher: ModelFetcher = {
  id: "aihubmix",
  match: (request) => hintIncludes(request, "aihubmix"),
  fetch: async (request, context) => {
    const root = request.baseUrl.replace(/\/v1$/, "");
    return mapCandidates(dataModels(await fetchJson(`${root}/api/v1/models`, defaultHeaders(request), context)), ["model_id", "id"]);
  },
};

const ollamaFetcher: ModelFetcher = {
  id: "ollama",
  match: (request) => hintIncludes(request, "ollama") || /localhost:11434|127\.0\.0\.1:11434/.test(request.baseUrl),
  fetch: async (request, context) => {
    const root = request.baseUrl.replace(/\/(?:v1|api)$/, "");
    return mapCandidates(dataModels(await fetchJson(`${root}/api/tags`, defaultHeaders(request), context)), ["name", "model"]);
  },
};

const geminiFetcher: ModelFetcher = {
  id: "gemini",
  match: (request) => request.api === "google-generative-ai" || hintIncludes(request, "gemini", "generativelanguage.googleapis.com"),
  fetch: async (request, context) => {
    const root = request.baseUrl.replace(/\/v1(?:beta)?$/, "");
    const headers = { ...defaultHeaders({ ...request, authHeader: false }), ...(request.apiKey ? { "x-goog-api-key": request.apiKey } : {}) };
    const items: JsonRecord[] = [];
    let pageToken: string | undefined;
    do {
      const value = await fetchJson(`${root}/v1beta/models${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ""}`, headers, context);
      items.push(...dataModels(value));
      pageToken = stringValue(record(value)?.nextPageToken);
    } while (pageToken);
    const models = mapCandidates(items, ["name"]);
    return models.map((model) => ({ ...model, id: model.id.replace(/^models\//, "") }));
  },
};

const vertexFetcher: ModelFetcher = {
  id: "vertex",
  match: (request) => request.api === "google-vertex" || hintIncludes(request, "vertex", "aiplatform.googleapis.com"),
  fetch: async (request, context) => {
    const groups = await Promise.allSettled(VERTEX_PUBLISHERS.map(async (publisher) => {
      const items: JsonRecord[] = [];
      let pageToken: string | undefined;
      do {
        const query = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
        const value = await fetchJson(`${request.baseUrl}/publishers/${publisher}/models?${query}`, defaultHeaders(request), context);
        items.push(...records(record(value)?.publisherModels));
        pageToken = stringValue(record(value)?.nextPageToken);
      } while (pageToken);
      return mapCandidates(items, ["name"]);
    }));
    const fulfilled = groups.filter((group): group is PromiseFulfilledResult<ProviderModelCandidate[]> => group.status === "fulfilled");
    if (fulfilled.length === 0) throw groups[0]?.status === "rejected" ? groups[0].reason : new Error("Vertex returned no model catalogs.");
    return fulfilled.flatMap((group) => group.value).map((model) => ({ ...model, id: model.id.split("/").pop() ?? model.id }));
  },
};

const githubFetcher: ModelFetcher = {
  id: "github",
  match: (request) => hintIncludes(request, "github-models", "models.github.ai"),
  fetch: async (request, context) => mapCandidates(records(await fetchJson("https://models.github.ai/catalog/models", defaultHeaders(request), context))),
};

const copilotFetcher = openAICompatibleFetcher("copilot", (request) => hintIncludes(request, "copilot", "githubcopilot.com"));

const ovmsFetcher: ModelFetcher = {
  id: "ovms",
  match: (request) => hintIncludes(request, "ovms", "openvino"),
  fetch: async (request, context) => {
    const value = record(await fetchJson(`${request.baseUrl.replace(/\/v1$/, "")}/config`, defaultHeaders(request), context)) ?? {};
    return Object.entries(value).filter(([, item]) => {
      const versions = records(record(item)?.model_version_status);
      return versions.some((version) => version.state === "AVAILABLE");
    }).map(([id]) => ({ id, name: id }));
  },
};

const togetherFetcher: ModelFetcher = {
  id: "together",
  match: (request) => hintIncludes(request, "together"),
  fetch: async (request, context) => mapCandidates(dataModels(await fetchJson(appendModelsPath(request.baseUrl), defaultHeaders(request), context))),
};

const newApiFetcher = openAICompatibleFetcher("new-api", (request) => hintIncludes(request, "new-api", "newapi", "one-api", "oneapi", "cherryin", "aionly"));
const openRouterFetcher = openAICompatibleFetcher("openrouter", (request) => hintIncludes(request, "openrouter"));
const ppioFetcher = openAICompatibleFetcher("ppio", (request) => hintIncludes(request, "ppio"));

const vercelGatewayFetcher: ModelFetcher = {
  id: "vercel-gateway",
  match: (request) => hintIncludes(request, "vercel", "ai-gateway"),
  fetch: async (request, context) => mapCandidates(dataModels(await fetchJson("https://ai-gateway.vercel.sh/v3/ai/config", {
    ...defaultHeaders(request),
    "ai-gateway-protocol-version": "0.0.1",
  }, context))),
};

const anthropicFetcher: ModelFetcher = {
  id: "anthropic",
  match: (request) => request.api === "anthropic-messages" || hintIncludes(request, "anthropic"),
  fetch: async (request, context) => mapCandidates(dataModels(await fetchJson(`${request.baseUrl}/models?limit=1000`, {
    Accept: "application/json",
    ...(request.apiKey ? { "x-api-key": request.apiKey } : {}),
    "anthropic-version": "2023-06-01",
    ...(request.headers ?? {}),
  }, context))),
};

const jinaFetcher: ModelFetcher = {
  id: "jina",
  match: (request) => hintIncludes(request, "jina"),
  fetch: async (request, context) => (await openAICompatibleFetcher("openai-compatible", () => true).fetch(request, context))
    .map((model) => ({ ...model, id: model.id.replace(/^jina-ai\//, "") })),
};

const openAIFetcher = openAICompatibleFetcher("openai", (request) => hintIncludes(request, "openai.com", " openai "));
const compatibleFetcher = openAICompatibleFetcher("openai-compatible", () => true);

const FETCHERS: ModelFetcher[] = [
  aihubmixFetcher,
  ollamaFetcher,
  geminiFetcher,
  vertexFetcher,
  githubFetcher,
  copilotFetcher,
  ovmsFetcher,
  togetherFetcher,
  newApiFetcher,
  openRouterFetcher,
  ppioFetcher,
  vercelGatewayFetcher,
  anthropicFetcher,
  jinaFetcher,
  openAIFetcher,
  compatibleFetcher,
];
