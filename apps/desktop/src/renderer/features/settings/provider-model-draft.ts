import type { ConfiguredModelSummary, ProviderModelCandidate } from "@wordless/domain";

export type ProviderModelDraftChange = {
  addedIds: string[];
  removedIds: string[];
};

export function parseProviderConfigurationDraft(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Provider configuration must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function providerDraftModelIds(raw: string): string[] {
  const configuration = parseProviderConfigurationDraft(raw);
  if (!Array.isArray(configuration.models)) return [];
  return configuration.models.flatMap((model) => {
    if (typeof model !== "object" || model === null || Array.isArray(model)) return [];
    const id = (model as Record<string, unknown>).id;
    return typeof id === "string" && id.trim() ? [id.trim()] : [];
  });
}

export function applyProviderModelDraftChange(
  raw: string,
  candidates: ProviderModelCandidate[],
  presentIds: ReadonlySet<string>,
): { raw: string; change: ProviderModelDraftChange } {
  const configuration = parseProviderConfigurationDraft(raw);
  const currentModels = Array.isArray(configuration.models) ? configuration.models : [];
  const currentIds = new Set(providerDraftModelIds(raw));
  const remoteIds = new Set(candidates.map((candidate) => candidate.id));
  const removedIds = [...currentIds].filter((id) => remoteIds.has(id) && !presentIds.has(id));
  const added = candidates.filter((candidate) => presentIds.has(candidate.id) && !currentIds.has(candidate.id));
  const kept = currentModels.filter((model) => {
    if (typeof model !== "object" || model === null || Array.isArray(model)) return true;
    const id = (model as Record<string, unknown>).id;
    return typeof id !== "string" || !removedIds.includes(id);
  });
  const additions = added.map(candidateDefinition);
  return {
    raw: JSON.stringify({ ...configuration, models: [...kept, ...additions] }, null, 2),
    change: { addedIds: added.map((model) => model.id), removedIds },
  };
}

export function desiredEnabledModelIds(
  currentlyEnabledIds: string[],
  finalModelIds: string[],
  pendingAddedIds: string[],
): string[] {
  const available = new Set(finalModelIds);
  return [...new Set([...currentlyEnabledIds, ...pendingAddedIds])].filter((id) => available.has(id));
}

export function draftConfiguredModels(
  raw: string,
  runtimeModels: ConfiguredModelSummary[],
  pendingEnabledIds: string[],
  providerId: string,
  providerApi = "openai-completions",
): ConfiguredModelSummary[] {
  const configuration = parseProviderConfigurationDraft(raw);
  if (!Array.isArray(configuration.models)) return runtimeModels;
  const runtimeById = new Map(runtimeModels.map((model) => [model.modelId, model]));
  const enabled = new Set(pendingEnabledIds);
  return configuration.models.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const definition = value as Record<string, unknown>;
    const id = typeof definition.id === "string" ? definition.id.trim() : "";
    if (!id) return [];
    const runtime = runtimeById.get(id);
    if (runtime) return [{ ...runtime, enabled: enabled.has(id) }];
    const input = Array.isArray(definition.input) ? definition.input : [];
    const reasoning = definition.reasoning === true;
    const thinkingMap = definition.thinkingLevelMap && typeof definition.thinkingLevelMap === "object" && !Array.isArray(definition.thinkingLevelMap)
      ? definition.thinkingLevelMap as Record<string, unknown>
      : undefined;
    const levels = reasoning
      ? (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).filter((level) => thinkingMap?.[level] !== null && (level !== "xhigh" && level !== "max" || thinkingMap?.[level] !== undefined))
      : ["off"] as const;
    return [{
      providerId,
      providerAvatarId: null,
      modelId: id,
      displayName: typeof definition.name === "string" && definition.name.trim() ? definition.name : id,
      kind: "chat" as const,
      enabled: enabled.has(id),
      supportsVision: input.includes("image"),
      supportsReasoning: reasoning,
      supportedThinkingLevels: [...levels],
      contextWindow: typeof definition.contextWindow === "number" ? definition.contextWindow : 128_000,
      api: typeof definition.api === "string" ? definition.api : providerApi,
      imageCapabilities: null,
    }];
  });
}

function candidateDefinition(candidate: ProviderModelCandidate): Record<string, unknown> {
  return {
    ...candidate.configuration,
    id: candidate.id,
    ...(candidate.name ? { name: candidate.name } : {}),
    ...(candidate.supportsReasoning !== undefined ? { reasoning: candidate.supportsReasoning } : {}),
    ...(candidate.supportsVision !== undefined ? { input: candidate.supportsVision ? ["text", "image"] : ["text"] } : {}),
    ...(candidate.contextWindow ? { contextWindow: candidate.contextWindow } : {}),
    ...(candidate.maxTokens ? { maxTokens: candidate.maxTokens } : {}),
  };
}
