/**
 * 单飞 + 有界重读的装载器。
 *
 * ## 为什么单独一层
 *
 * 历史缓存的两条装载路径(历史投影、会话快照)都要"同一会话只跑一次"和"读到的中间态不作数"。
 * 这两件事各自都有坑:
 *
 * - **单飞**:并发的调用方必须共享同一次装载,否则一份大会话会被整份解析好几遍。
 * - **重读**:journal 在我们读的过程中被追加时,那一份结果不能进缓存(它的修订号已经不对了)。
 *
 * ## 一个实测过的坑:重读**不能经由这张表**
 *
 * 第一版把重读写成"再调一次外层那个取缓存的函数",看起来是"重来一次",实际上那条路会命中
 * 表里**自己这一条**,于是 `await` 自己的 promise —— 永不返回。而且这条记录只在创建者的
 * `finally` 里删,所以它会永久留在表里:该会话之后**每一个**请求都跟着挂死。
 *
 * 所以重读只能是**同一个装载对象的下一轮**,不能重新进表。下面的 `LoadState.valid` 是**每轮
 * 重置**的:它回答的是"这一轮读的时候有没有人来改",而不是"这个 key 有没有被失效过"。
 *
 * ## 重读有上限
 *
 * 每次重读都是整份 journal 的解析。流式运行期间每个事件都会失效一次,无限重试等于把这条
 * 装载饿死(症状是"历史打不开",而不是"多读了几遍")。到上限就把最后读到的那份交出去 ——
 * 调用方要的是一份历史,而这一份是当下最新的;下一次事件还会再失效一次,所以不需要在这里
 * "等到稳定为止"。代价是这一份**不进缓存**(不稳定态进缓存才会真的过期)。
 *
 * 本文件不 import 任何东西,也不碰 Electron/React。
 */

export interface LoadState {
  /** 本轮读的时候有没有被失效(`invalidate` 把它置 false)。 */
  valid: boolean;
}

export interface LoadOutcome<T> {
  value: T;
  /**
   * 这一份是不是稳定态:本轮没被失效,并且调用方自己的修订号检查也过了。
   * **只有稳定态才该被缓存。**
   */
  stable: boolean;
}

export interface SingleFlightLoads<T> {
  /**
   * 同一 key 已有装载就共享它,否则开一次新的。
   *
   * `produce` 每轮都会被调用一次(至多 `attempts` 次),并从 `state` 读"本轮有没有被失效"。
   */
  load(key: string, produce: (state: LoadState) => Promise<LoadOutcome<T>>, attempts?: number): Promise<T>;
  /** 失效:正在跑的那一次结果不再可信,并且不再被共享。 */
  invalidate(key: string): void;
  /** 全部作废(运行时关闭)。 */
  clear(): void;
  /** 在途的 key。给测试与诊断用。 */
  readonly pending: readonly string[];
}

/** 一次装载最多读几遍。1 表示不重读。 */
export const DEFAULT_LOAD_ATTEMPTS = 3;

export function createSingleFlightLoads<T>(options: { attempts?: number } = {}): SingleFlightLoads<T> {
  const defaultAttempts = normalizeAttempts(options.attempts, DEFAULT_LOAD_ATTEMPTS);
  const inflight = new Map<string, Promise<T>>();
  const states = new Map<string, LoadState>();

  return {
    load(key, produce, attempts) {
      const existing = inflight.get(key);
      if (existing !== undefined) return existing;

      const limit = normalizeAttempts(attempts, defaultAttempts);
      const state: LoadState = { valid: true };
      /**
       * 重读那一轮要把这次装载放回表里,而那时它已经在表里被删掉过(失效会删),
       * 于是需要拿到"自己这个 promise" —— 只能靠这个可变引用,不能靠表。
       * 它在函数体第一次 `await` 之前就被赋值,所以循环里读到的一定不是 null。
       */
      let self: Promise<T> | null = null;

      const work = (async (): Promise<T> => {
        // **先让注册完成再跑第一轮。** `produce` 的同步前缀里若发生失效或嵌套 `load`,
        // 表里还没有这条记录 —— 失效会被丢掉(测试里就是这一条先红的),嵌套 `load` 会
        // 开出第二次装载。让出一个微任务,下面两行 `set` 就已经执行完了。
        await null;
        for (let attempt = 0; ; attempt += 1) {
          state.valid = true;
          const outcome = await produce(state);
          if (outcome.stable || attempt + 1 >= limit) return outcome.value;
          // 失效把这条从表里删了,而并发的调用方在这段时间里会各自开新的装载。
          // 只在**空着**的时候放回去:已经有更新的一次装载时,不要把它顶掉。
          if (self !== null && !inflight.has(key)) {
            inflight.set(key, self);
            states.set(key, state);
          }
        }
      })();
      self = work;
      inflight.set(key, work);
      states.set(key, state);

      return work.finally(() => {
        if (inflight.get(key) === work) inflight.delete(key);
        if (states.get(key) === state) states.delete(key);
      });
    },

    invalidate(key) {
      const state = states.get(key);
      if (state !== undefined) state.valid = false;
      // 表里这条也要删:否则后来的调用方会共享一次"结果已经不作数"的装载。
      states.delete(key);
      inflight.delete(key);
    },

    clear() {
      for (const state of states.values()) state.valid = false;
      states.clear();
      inflight.clear();
    },

    get pending() {
      return [...inflight.keys()];
    },
  };
}

function normalizeAttempts(attempts: number | undefined, fallback: number): number {
  // `NaN` 会穿过 `Math.max(1, ...)` 变成 NaN,于是循环一次都不该有上限 —— 显式挡掉。
  return attempts === undefined || !Number.isFinite(attempts) ? fallback : Math.max(1, Math.floor(attempts));
}
