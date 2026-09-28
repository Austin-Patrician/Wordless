import { DESIGN_CANVAS_BUDGETS } from "./budgets.ts";
import { lruEvict, type LruEntry, type LruLimits } from "./texture-lru.ts";

/**
 * 位图缓存。
 *
 * 泛型 + 注入 `dispose`,是为了让**淘汰策略能在 node 测试里覆盖** —— 那正是最容易算错
 * 又最难从界面上看出来的部分(算错的表现是内存持续增长,或者画布反复重光栅)。浏览器里
 * 句柄是位图 URL(需要 `revokeObjectURL`),测试里是一个假对象加一个 spy。
 *
 * 位置在渲染层:位图住在渲染进程,主进程只负责流字节。
 */

export interface TextureCacheOptions<THandle> {
  /** 被淘汰或被替换时释放句柄。 */
  dispose: (handle: THandle) => void;
  limits?: LruLimits;
  now?: () => number;
}

export class TextureCache<THandle> {
  private readonly entries = new Map<string, { handle: THandle; bytes: number; lastUsed: number }>();
  private readonly disposeHandle: (handle: THandle) => void;
  private readonly limits: LruLimits;
  private readonly now: () => number;

  constructor(options: TextureCacheOptions<THandle>) {
    this.disposeHandle = options.dispose;
    this.limits = options.limits ?? {
      budgetBytes: DESIGN_CANVAS_BUDGETS.textureByteBudget,
      maxEntries: DESIGN_CANVAS_BUDGETS.maxTextures,
    };
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    return total;
  }

  /**
   * 放入一张位图,并按 LRU 淘汰到预算内。
   *
   * 同 key 覆盖时**先释放旧句柄** —— 否则每次重新光栅都会漏一个 URL。
   *
   * 注意新条目自己也可能被立刻淘汰(单张就超过预算):那是有意的,宁可不缓存这一张,
   * 也不越过预算 —— 越过预算的后果是内存无上限增长,而单张放不下的后果只是这一帧反复重光栅。
   */
  set(key: string, handle: THandle, bytes: number): void {
    const existing = this.entries.get(key);
    if (existing !== undefined) this.disposeHandle(existing.handle);
    this.entries.set(key, { handle, bytes: safeBytes(bytes), lastUsed: this.now() });
    this.evict();
  }

  /** 取用并刷新使用时间。取不到返回 null。 */
  get(key: string): THandle | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    entry.lastUsed = this.now();
    return entry.handle;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** 清空并释放全部句柄。组件卸载时调用。 */
  clear(): void {
    for (const entry of this.entries.values()) this.disposeHandle(entry.handle);
    this.entries.clear();
  }

  private evict(): void {
    const entries: LruEntry[] = [...this.entries].map(([key, entry]) => ({
      key,
      bytes: entry.bytes,
      lastUsed: entry.lastUsed,
    }));
    for (const key of lruEvict(entries, this.limits)) {
      const entry = this.entries.get(key);
      if (entry === undefined) continue;
      this.entries.delete(key);
      this.disposeHandle(entry.handle);
    }
  }
}

function safeBytes(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}
