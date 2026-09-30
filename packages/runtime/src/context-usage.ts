import type { AgentExtensionSnapshot } from "@wordless/agent-extension-sdk";
import { countBpeTokens, estimateBpeTokens, GENERIC_BPE_SAFETY_FACTOR } from "@wordless/ai";
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

/** 给小的结构化输入(画像、连接器、技能元数据)计数 —— 它们本来就小,不必走逐条记忆。 */
function estimateTokens(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return 0;
    return estimateBpeTokens(serialized);
  } catch {
    return 0;
  }
}

/** 与 `@wordless/ai` 的 `estimate.ts` 同一口径:一张图片计固定 token,不数它的 base64。 */
const ESTIMATED_IMAGE_TOKENS = 1200;

/**
 * 条目级记忆:内容哈希 → token 数。
 *
 * 为什么不用 `@wordless/ai` 那个按文本做 key 的缓存:它为"同一条文本反复进来"设计,而这里
 * 的文本是**每条消息序列化后的样子** —— 一条 1.2MB 的工具输出会占满它的额度、并把别的条目
 * 挤出去,而它自己又因为超过单条上限根本不进缓存(于是每次重新 BPE,实测每次多花 ~120ms)。
 *
 * 只存"哈希 + 数字",不存正文,所以这个记忆与上下文大小无关:4096 条上限对应的是几十 KB。
 * 碰撞需要同时撞上长度和 32 位哈希;万一撞上,代价是**这一条消息的估算值不准**(展示面),
 * 决策路径用的是另一套逐条计数,不受影响。
 */
const ENTRY_MEMO_LIMIT = 4096;
const entryTokenMemo = new Map<string, number>();

/**
 * 这个记忆的现状:只读的诊断面(它没有"重置"入口 —— 需要独立状态就自己构造,见
 * docs/architecture/context-token-estimation.md 的不变量 5)。
 */
export function contextUsageMemoStats(): { entries: number } {
  return { entries: entryTokenMemo.size };
}

function digestOf(text: string): string {
  // FNV-1a 32 位。逐字符走一遍换来的是"不用把正文留在内存里",这是这笔交易的全部意义。
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * 把条目序列化成"可计数"的文本,顺便把图片数据换成占位符。
 *
 * 用 `JSON.stringify` 的 replacer 而不是先深拷贝再序列化:深拷贝要给整棵上下文再分配一份
 * 内存(实测这条路 4.3MB 上下文每次多花上百毫秒),而 replacer 是原地走一遍。
 *
 * 判据是"键名是 `data`、值是一大段 base64" —— 那是 `ImageContent` 的形状;把它按字符喂给
 * BPE 会得到几十万 token 的假读数,而图片在上下文里就是一笔固定成本。
 */
function entryText(value: unknown, counts: { images: number }): string {
  return (
    JSON.stringify(value, (key, item: unknown) => {
      if (
        key === "data" &&
        typeof item === "string" &&
        item.length > 512 &&
        /^[A-Za-z0-9+/=\s]+$/.test(item)
      ) {
        counts.images += 1;
        return "<image>";
      }
      return item;
    }) ?? ""
  );
}

/**
 * 整个活跃上下文的 token 数。
 *
 * **逐条计数再求和,而不是把整段 `JSON.stringify` 一次。** 旧写法会造出一个数 MB 的字符串,
 * 它成为 token 缓存的 key —— 每次消息完成都留下一份,主进程因此涨到 1GB 以上,并且因为 key
 * 是内容,关掉会话也不释放;那一次 BPE 还要 1.4 秒,跑在主线程上。
 */
function estimateEntriesTokens(entries: readonly unknown[]): number {
  if (entries.length === 0) return 0;
  const counts = { images: 0 };
  let raw = 0;
  for (const entry of entries) {
    const text = entryText(entry, counts);
    const digest = digestOf(text);
    const remembered = entryTokenMemo.get(digest);
    if (remembered !== undefined) {
      raw += remembered;
      continue;
    }
    // 逐条用**原始**计数累加,跨 provider 的安全系数只在最后乘一次 —— 与旧口径一致。
    // 逐条各乘一次的话,每条向上取整的误差会累加(实测在短条目上下文里到 0.46%)。
    const count = countBpeTokens(text);
    if (entryTokenMemo.size >= ENTRY_MEMO_LIMIT) {
      const oldest = entryTokenMemo.keys().next().value;
      if (oldest !== undefined) entryTokenMemo.delete(oldest);
    }
    entryTokenMemo.set(digest, count);
    raw += count;
  }
  // 数组自己的框架:`JSON.stringify(array)` 是 `[` + 逗号 + `]`。漏掉它,条数一多就会低估。
  raw += countBpeTokens(`[${",".repeat(entries.length - 1)}]`);
  // 图片按固定成本加在安全系数**之外**,与 `packages/ai` 的 `estimate.ts` 完全一致。
  return Math.ceil(raw * GENERIC_BPE_SAFETY_FACTOR) + counts.images * ESTIMATED_IMAGE_TOKENS;
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
    conversation: estimateEntriesTokens(activeJournalEntries(input.entries)),
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
    source: providerTokens ? "provider" : "tokenizer",
    usedTokens,
  };
}
