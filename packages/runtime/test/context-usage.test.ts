import { describe, expect, it } from "vitest";
import type { AgentExtensionSnapshot } from "@wordless/agent-extension-sdk";
import type { ProfileDefinition } from "@wordless/profile-sdk";
import { estimateSessionContextUsage } from "../src/context-usage.ts";

const profile: ProfileDefinition = {
  reference: { id: "test", version: "1" },
  driverId: "test",
  modelRequirements: {},
  systemPrompt: "You are a careful assistant.",
  activeToolNames: ["read", "write"],
  capabilityIds: ["filesystem"],
  skills: [],
  artifactKinds: [],
  workbenchId: "conversation",
};

const extensions: AgentExtensionSnapshot = {
  descriptors: [{ id: "wordless.subagent", version: "1", name: "Subagent", description: "Delegate independent work.", category: "orchestration", builtin: true, defaultEnabled: false, supportedDriverIds: ["test"] }],
  configurations: { "wordless.subagent": { enabled: true, settings: {} } },
};

describe("estimateSessionContextUsage", () => {
  it("includes profile, enabled extensions, messages, and skill metadata", () => {
    const usage = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 128_000,
      entries: [{ type: "message", message: { role: "user", content: "Current task" } }],
      extensions,
      profile,
      skills: [{ name: "release", description: "Prepare releases safely." }],
    });

    expect(usage.source).toBe("tokenizer");
    expect(usage.contextWindow).toBe(128_000);
    expect(usage.categories.systemPrompt).toBeGreaterThan(0);
    expect(usage.categories.toolsAndSubagents).toBeGreaterThan(0);
    expect(usage.categories.conversation).toBeGreaterThan(0);
    expect(usage.categories.skills).toBeGreaterThan(0);
    expect(usage.usedTokens).toBe(Object.values(usage.categories).reduce((sum, value) => sum + value, 0));
  });

  it("calibrates category estimates to the latest provider input usage", () => {
    const usage = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 192_000,
      entries: [{ type: "message", message: { role: "user", content: "Current task" } }],
      extensions,
      latestInputTokens: 33_200,
      profile,
      skills: [],
    });

    expect(usage.source).toBe("provider");
    expect(usage.usedTokens).toBe(33_200);
    expect(Object.values(usage.categories).reduce((sum, value) => sum + value, 0)).toBe(33_200);
  });

  it("only counts history after the latest compaction record", () => {
    const before = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 128_000,
      entries: [{ type: "message", content: "x".repeat(12_000) }, { type: "compaction", summary: "short summary" }, { type: "message", content: "recent" }],
      extensions: { descriptors: [], configurations: {} },
      profile,
      skills: [],
    });
    const after = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 128_000,
      entries: [{ type: "compaction", summary: "short summary" }, { type: "message", content: "recent" }],
      extensions: { descriptors: [], configurations: {} },
      profile,
      skills: [],
    });

    expect(before.categories.conversation).toBe(after.categories.conversation);
  });

  it("uses the post-compaction estimate when no current provider usage exists", () => {
    const usage = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 128_000,
      entries: [{ type: "compaction", summary: "short summary" }, { type: "message", content: "recent" }],
      extensions: { descriptors: [], configurations: {} },
      profile,
      skills: [],
    });

    expect(usage.source).toBe("tokenizer");
    expect(usage.usedTokens).toBeLessThan(10_000);
  });
});
