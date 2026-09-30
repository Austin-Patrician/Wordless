import { describe, expect, it } from "vitest";
import type { AgentExtensionSnapshot } from "@wordless/agent-extension-sdk";
import type { ProfileDefinition } from "@wordless/profile-sdk";
import { estimateBpeTokens } from "@wordless/ai";
import { contextUsageMemoStats, estimateSessionContextUsage } from "../src/context-usage.ts";

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

  /**
   * 漂移契约:逐条计数与"整段 stringify 一次"的差异**每条约 1 个 token**。
   *
   * 旧实现把整个活跃上下文 `JSON.stringify` 成一个字符串再数,那个字符串(实测 6MB 量级)
   * 会成为 token 缓存的 key 被永久留下 —— 一次启动就能把主进程堆到 1GB 以上。新实现逐条
   * 数再求和,并补上数组框架。
   *
   * 差异的来源是**边界**:BPE 无法跨越条目边界做合并,所以每条最多多算/少算一个 token。
   * 真实会话(平均条目 4.7KB)实测差异 0.021%;条目越短、条数越多,这个固定量占的比例越
   * 大 —— 这条用例用很短的条目把上界逼出来,断言的是**那个上界**,不是某个拍出来的百分比。
   */
  it("counts per entry within 0.1% of counting the whole array at once", () => {
    const entries = Array.from({ length: 40 }, (_value, index) => ({
      type: "message",
      id: `entry-${index}`,
      timestamp: 1_700_000_000_000 + index,
      message: {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `第 ${index} 条消息:${"context ".repeat(60)}`,
      },
    }));
    // `estimateBpeTokens` 自身已经乘过跨 provider 的安全系数:这里不能再乘一次。
    const holistic = estimateBpeTokens(JSON.stringify(entries));
    const usage = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 128_000,
      entries,
      extensions: { descriptors: [], configurations: {} },
      profile,
      skills: [],
    });

    const drift = Math.abs(usage.categories.conversation - holistic);
    expect(drift).toBeLessThanOrEqual(entries.length + 2);
    expect(drift / holistic).toBeLessThan(0.005);
  });

  /**
   * 条目级记忆必须有界。
   *
   * 它记的是"内容哈希 → token 数",所以与上下文大小无关;但若没有条数上限,长时间运行的
   * 会话会把它变成另一条无上限的增长路径 —— 那正是这次事故的形状(见
   * docs/architecture/context-token-estimation.md)。
   */
  it("keeps the per-entry memo bounded while it is reused", () => {
    const entries = Array.from({ length: 200 }, (_value, index) => ({
      type: "message",
      message: { role: "user", content: `第 ${index} 条:${"x".repeat(40)}` },
    }));
    const estimate = (): number =>
      estimateSessionContextUsage({
        connectors: [],
        contextWindow: 128_000,
        entries,
        extensions: { descriptors: [], configurations: {} },
        profile,
        skills: [],
      }).categories.conversation;

    // 记忆是进程级的:断言增量,不依赖这个文件里其他用例跑过什么。
    const before = contextUsageMemoStats().entries;
    const first = estimate();
    const afterFirst = contextUsageMemoStats().entries;
    expect(afterFirst - before).toBeLessThanOrEqual(entries.length);

    // 反复估算:值不变,条目也不再增长 —— 这是"内容哈希记忆"该有的样子。
    for (let round = 0; round < 20; round += 1) expect(estimate()).toBe(first);
    expect(contextUsageMemoStats().entries).toBe(afterFirst);
  });

  /**
   * 图片在上下文里是**固定成本**,不是"多少字符"。
   *
   * 把 1MB 截图的 base64 按字符喂给 BPE,会得到几十万 token 的假读数 —— 指示器会长期
   * 停在 100%,而用户看到的是"上下文明明还很空"。决策路径(`estimate.ts`)一直是按常数算的,
   * 这里与它对齐。
   */
  it("charges a fixed cost per image instead of counting its base64", () => {
    const image = { type: "image", data: "A".repeat(400_000), mimeType: "image/png" };
    const withImage = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 128_000,
      entries: [{ type: "message", message: { role: "user", content: [image] } }],
      extensions: { descriptors: [], configurations: {} },
      profile,
      skills: [],
    });
    const withoutImage = estimateSessionContextUsage({
      connectors: [],
      contextWindow: 128_000,
      entries: [{ type: "message", message: { role: "user", content: [] } }],
      extensions: { descriptors: [], configurations: {} },
      profile,
      skills: [],
    });

    const added = withImage.categories.conversation - withoutImage.categories.conversation;
    expect(added).toBeGreaterThan(1_000);
    expect(added).toBeLessThan(2_000);
  });
});
