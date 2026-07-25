import { Buffer } from "node:buffer";
import type { AgentExtensionSnapshot } from "@wordless/agent-extension-sdk";
import type { ConnectorSummary, SessionContextUsage, SessionContextUsageCategories } from "@wordless/domain";
import type { ProfileDefinition } from "@wordless/profile-sdk";

type ContextUsageEstimateInput = {
  connectors: readonly ConnectorSummary[];
  contextWindow: number;
  entries: readonly unknown[];
  extensions: AgentExtensionSnapshot;
  latestInputTokens?: number;
  profile: ProfileDefinition;
  skills: readonly { name: string; description: string }[];
};

function estimateTokens(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized ? Math.max(0, Math.ceil(Buffer.byteLength(serialized, "utf8") / 4)) : 0;
  } catch {
    return 0;
  }
}

function activeJournalEntries(entries: readonly unknown[]): readonly unknown[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index];
    if (typeof candidate === "object" && candidate !== null && "type" in candidate && candidate.type === "compaction") return entries.slice(index);
  }
  return entries;
}

function scaledCategories(categories: SessionContextUsageCategories, total: number): SessionContextUsageCategories {
  const estimated = Object.values(categories).reduce((sum, value) => sum + value, 0);
  if (estimated === 0 || estimated === total) return categories;
  const keys = Object.keys(categories) as Array<keyof SessionContextUsageCategories>;
  const scaled = {} as SessionContextUsageCategories;
  let assigned = 0;
  for (const key of keys.slice(0, -1)) {
    const value = Math.round((categories[key] / estimated) * total);
    scaled[key] = value;
    assigned += value;
  }
  const lastKey = keys.at(-1)!;
  scaled[lastKey] = Math.max(0, total - assigned);
  return scaled;
}

export function estimateSessionContextUsage(input: ContextUsageEstimateInput): SessionContextUsage {
  const enabledExtensions = input.extensions.descriptors
    .filter((descriptor) => input.extensions.configurations[descriptor.id]?.enabled)
    .map((descriptor) => ({ id: descriptor.id, name: descriptor.name, description: descriptor.description }));
  const categories: SessionContextUsageCategories = {
    systemPrompt: estimateTokens(input.profile.systemPrompt),
    toolsAndSubagents: estimateTokens({
      activeToolNames: input.profile.activeToolNames,
      capabilityIds: input.profile.capabilityIds,
      extensions: enabledExtensions,
    }),
    conversation: estimateTokens(activeJournalEntries(input.entries)),
    connectors: estimateTokens(input.connectors.map((connector) => ({
      name: connector.name,
      prompts: connector.prompts,
      resources: connector.resources,
      tools: connector.tools,
    }))),
    skills: estimateTokens(input.skills.map((skill) => ({ name: skill.name, description: skill.description }))),
  };
  const estimatedTokens = Object.values(categories).reduce((sum, value) => sum + value, 0);
  const providerTokens = input.latestInputTokens && input.latestInputTokens > 0 ? input.latestInputTokens : undefined;
  const usedTokens = providerTokens ?? estimatedTokens;
  return {
    categories: providerTokens ? scaledCategories(categories, usedTokens) : categories,
    contextWindow: input.contextWindow,
    source: providerTokens ? "provider" : "estimate",
    usedTokens,
  };
}
