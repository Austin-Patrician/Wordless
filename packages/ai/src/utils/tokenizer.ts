import { countTokens } from "gpt-tokenizer/encoding/o200k_base";

/** Cross-provider safety factor for the generic BPE fallback. */
export const GENERIC_BPE_SAFETY_FACTOR = 1.25;

export interface TokenCacheLimits {
  maxEntries: number;
  maxChars: number;
  maxEntryChars: number;
}

export interface TokenCacheStats extends TokenCacheLimits {
  entries: number;
  chars: number;
  /**
   * 因为"太大"而没缓存的累计次数。它是这份缓存健康的信号:持续增长说明有调用方在往里喂
   * 巨文本 —— 那时该去看那个调用方,而不是调大额度。
   */
  skipped: number;
  hits: number;
  misses: number;
}

/**
 * 计数的备忘录缓存。
 *
 * 存在的理由:同一个字符串会被反复计数 —— systemPrompt、技能列表、草稿文本,
 * 以及压缩检查里那些"内容没变过"的历史消息。没有它,每次都要重跑一遍 BPE。
 *
 * **它的 key 是文本本身,所以预算必须按字节给,不能只按条数给。**
 * 只限条数的版本(2048 条)曾经把整段会话上下文(单条 6MB 量级)一条条留在主进程里,
 * 一次启动就能堆到 1GB 以上,并且因为 key 是内容,关掉会话也不释放 ——
 * 见 docs/architecture/context-token-estimation.md。
 *
 * 三条规则,缺一条都不够:
 * 1. 超出单条上限的文本**根本不缓存**:巨文本的复用率为零,缓存它只有代价。
 * 2. 总字符量有上限:命中率下降只是多算几次,突破预算是内存无上限增长。
 * 3. 淘汰按"最久未用",且顺序是确定的(按插入顺序),测试才不会偶发。
 *
 * 计数单位是 UTF-16 码元(`text.length`):base64 与 ASCII 下 1 码元 = 1 字节,
 * CJK 下 1 码元 = 2 字节 —— 所以按码元给的预算在有界性上仍然是硬的。
 *
 * **为什么是实例而不是模块级的几个 `let`**:额度只能在构造时给,之后没有任何入口能改它。
 * 模块级可变额度意味着"生产的行为额度可以被任何调用方在运行时改写",而额度正是这份缓存
 * 唯一的安全边界。顺带一个好处:测试各自 `new TokenCache({...})`,**天然互不干扰**,
 * 不必依赖"先重置再断言"的顺序 —— 用生产的 4MB 额度去测这条不变量,一个用例要跑 200 秒。
 *
 * 它**不进包出口**(`src/index.ts` 只导出下面三个函数):生产永远只有那个共享实例,
 * 需要独立实例的只有测试。
 */
export class TokenCache {
  private readonly limits: TokenCacheLimits;
  private readonly counts = new Map<string, number>();
  private chars = 0;
  private skipped = 0;
  private hits = 0;
  private misses = 0;

  constructor(limits: Partial<TokenCacheLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * 数文本的 token。
   *
   * 结果与"不缓存"时**完全一致** —— 缓存只决定算几次,绝不改算出多少。
   */
  count(text: string): number {
    if (!text) return 0;
    const cached = this.counts.get(text);
    if (cached !== undefined) {
      // 命中即"刚用过":删了再插回末尾,Map 的插入顺序就是 LRU 顺序。
      this.counts.delete(text);
      this.counts.set(text, cached);
      this.hits += 1;
      return cached;
    }
    this.misses += 1;
    const count = countTokens(text);
    if (text.length > this.limits.maxEntryChars) {
      this.skipped += 1;
      return count;
    }
    this.counts.set(text, count);
    this.chars += text.length;
    this.evictWhileOverBudget();
    return count;
  }

  stats(): TokenCacheStats {
    return {
      ...this.limits,
      entries: this.counts.size,
      chars: this.chars,
      skipped: this.skipped,
      hits: this.hits,
      misses: this.misses,
    };
  }

  private evictWhileOverBudget(): void {
    while (this.counts.size > this.limits.maxEntries || this.chars > this.limits.maxChars) {
      const oldest = this.counts.keys().next().value;
      if (oldest === undefined) return;
      this.counts.delete(oldest);
      this.chars -= oldest.length;
    }
  }
}

/** 生产取值。改动它们之前先看上面那三条规则:预算变小只会多算几次。 */
const DEFAULT_LIMITS: TokenCacheLimits = {
  maxEntries: 2048,
  maxChars: 4 * 1024 * 1024,
  maxEntryChars: 256 * 1024,
};

/** 生产只有一个实例,额度在构造时定死。 */
const sharedTokenCache = new TokenCache();

/** Count text with a modern multilingual BPE vocabulary. */
export function countBpeTokens(text: string): number {
  return sharedTokenCache.count(text);
}

/**
 * Estimate provider tokens with a safety factor because non-OpenAI providers
 * use different tokenizers and message framing.
 */
export function estimateBpeTokens(text: string): number {
  return Math.ceil(countBpeTokens(text) * GENERIC_BPE_SAFETY_FACTOR);
}

/**
 * 共享缓存的诊断面。
 *
 * 它不是一个"给测试用的开关":它是这次事故留下的观测入口 —— 当 `skipped` 或 `chars`
 * 持续增长时,说明有调用方在往里喂不该喂的东西,而这正是当初没人看得见的那一面。
 */
export function tokenCacheStats(): TokenCacheStats {
  return sharedTokenCache.stats();
}
