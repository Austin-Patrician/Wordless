import type { ConfiguredModelSummary, ModelConfigurationSnapshot } from "@wordless/domain";

export type QuickModelProviderDefinition = {
  accent: string;
  keyUrl: string;
  name: string;
  providerId: string;
  recommendedModelId: string;
};

export const QUICK_MODEL_PROVIDERS: QuickModelProviderDefinition[] = [
  { providerId: "openai", name: "OpenAI", recommendedModelId: "gpt-5.6-terra", keyUrl: "https://platform.openai.com/api-keys", accent: "#22221f" },
  { providerId: "anthropic", name: "Anthropic", recommendedModelId: "claude-sonnet-5", keyUrl: "https://console.anthropic.com/settings/keys", accent: "#c66a42" },
  { providerId: "google", name: "Gemini", recommendedModelId: "gemini-3.5-flash", keyUrl: "https://aistudio.google.com/app/apikey", accent: "#4285f4" },
  { providerId: "deepseek", name: "DeepSeek", recommendedModelId: "deepseek-v4-flash", keyUrl: "https://platform.deepseek.com/api_keys", accent: "#4d6bfe" },
  { providerId: "zai-coding-cn", name: "智谱 GLM", recommendedModelId: "glm-5.2", keyUrl: "https://open.bigmodel.cn/usercenter/apikeys", accent: "#7657e8" },
  { providerId: "moonshotai-cn", name: "Moonshot AI", recommendedModelId: "kimi-k2.6", keyUrl: "https://platform.moonshot.cn/console/api-keys", accent: "#1e1e1e" },
];

export function quickProviderModels(snapshot: ModelConfigurationSnapshot, providerId: string): ConfiguredModelSummary[] {
  return snapshot.models.filter((model) => model.kind === "chat" && model.providerId === providerId);
}

export function recommendedQuickModel(models: ConfiguredModelSummary[], recommendedModelId: string): ConfiguredModelSummary | undefined {
  return models.find((model) => model.modelId === recommendedModelId) ?? models[0];
}

export function mergeQuickProviderConfiguration(configuration: Record<string, unknown> | null, apiKey: string): Record<string, unknown> {
  const trimmedApiKey = apiKey.trim();
  return trimmedApiKey ? { ...(configuration ?? {}), apiKey: trimmedApiKey } : { ...(configuration ?? {}) };
}

export function hasEnabledChatModel(snapshot: ModelConfigurationSnapshot): boolean {
  return snapshot.models.some((model) => model.kind === "chat" && model.enabled);
}

export function carouselOffset(index: number, activeIndex: number, count: number): number {
  if (count < 1) return 0;
  let offset = (index - activeIndex) % count;
  if (offset < 0) offset += count;
  if (offset > count / 2) offset -= count;
  return offset;
}
