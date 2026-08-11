import type { ProviderAvatarId, ProviderModelCandidate } from "@wordless/domain";

export type ProviderModelGroup = {
  id: string;
  label: string;
  avatarId: ProviderAvatarId | null;
  models: ProviderModelCandidate[];
};

type FamilyRule = { pattern: RegExp; id: string; label: string; avatarId: ProviderAvatarId };

const FAMILY_RULES: FamilyRule[] = [
  { pattern: /\b(claude|anthropic)\b/i, id: "anthropic", label: "Anthropic", avatarId: "anthropic" },
  { pattern: /\b(deepseek)\b/i, id: "deepseek", label: "DeepSeek", avatarId: "deepseek" },
  { pattern: /\b(gemini|gemma|google)\b/i, id: "google", label: "Google", avatarId: "gemini" },
  { pattern: /(^|[/\s])(gpt|o1|o3|o4|codex)([-./\s]|$)|\bopenai\b/i, id: "openai", label: "OpenAI", avatarId: "openai" },
  { pattern: /\b(qwen|qwq|alibaba|dashscope)\b/i, id: "qwen", label: "Qwen", avatarId: "qwen" },
  { pattern: /\b(llama|meta-llama|meta)\b/i, id: "meta", label: "Meta Llama", avatarId: "huggingface" },
  { pattern: /\bmistral\b|\bmixtral\b/i, id: "mistral", label: "Mistral", avatarId: "mistral" },
  { pattern: /\b(kimi|moonshot)\b/i, id: "moonshot", label: "Kimi / Moonshot", avatarId: "moonshot" },
  { pattern: /\b(longcat)\b/i, id: "longcat", label: "LongCat", avatarId: "longcat" },
  { pattern: /\b(stepfun)\b/i, id: "stepfun", label: "StepFun", avatarId: "stepfun" },
  { pattern: /\b(bytedance|byteplus|doubao)\b/i, id: "bytedance", label: "ByteDance", avatarId: "bytedance" },
  { pattern: /\bminimax\b/i, id: "minimax", label: "MiniMax", avatarId: "minimax" },
  { pattern: /\b(grok|xai)\b/i, id: "xai", label: "xAI", avatarId: "xai" },
  { pattern: /\b(glm|zhipu|zai)\b/i, id: "zhipu", label: "Zhipu / Z.AI", avatarId: "zhipu" },
  { pattern: /\b(nemotron|nvidia)\b/i, id: "nvidia", label: "NVIDIA", avatarId: "nvidia" },
  { pattern: /\bhunyuan\b/i, id: "hunyuan", label: "Hunyuan", avatarId: "hunyuan" },
  { pattern: /\b(mimo|xiaomi)\b/i, id: "xiaomi", label: "Xiaomi MiMo", avatarId: "xiaomi" },
];

const NAMESPACE_AVATARS: Record<string, ProviderAvatarId> = {
  baai: "baai",
  bytedance: "bytedance",
  byteplus: "bytedance",
  doubao: "bytedance",
  kimi: "moonshot",
  "kimi-coding": "moonshot",
  longcat: "longcat",
  moonshot: "moonshot",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  stepfun: "stepfun",
};

export function modelPresentation(model: Pick<ProviderModelCandidate, "id" | "name" | "ownedBy">): Omit<ProviderModelGroup, "models"> {
  const searchable = `${model.id} ${model.name} ${model.ownedBy ?? ""}`;
  const family = FAMILY_RULES.find((rule) => rule.pattern.test(searchable));
  const namespace = model.id.includes("/") ? model.id.split("/")[0]?.trim() : undefined;
  if (namespace) return { id: namespace.toLowerCase(), label: namespace, avatarId: NAMESPACE_AVATARS[namespace.toLowerCase()] ?? family?.avatarId ?? null };
  if (family) return { id: family.id, label: family.label, avatarId: family.avatarId };
  const fallback = model.ownedBy?.trim() || model.id.split(/[-_.:]/)[0] || "other";
  return { id: fallback.toLowerCase(), label: titleCase(fallback), avatarId: null };
}

export function groupProviderModels(models: ProviderModelCandidate[]): ProviderModelGroup[] {
  const groups = new Map<string, ProviderModelGroup>();
  for (const model of models) {
    const presentation = modelPresentation(model);
    const group = groups.get(presentation.id) ?? { ...presentation, models: [] };
    group.models.push(model);
    groups.set(presentation.id, group);
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label)).map((group) => ({
    ...group,
    models: [...group.models].sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
