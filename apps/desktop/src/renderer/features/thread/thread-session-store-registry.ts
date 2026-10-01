import type { RuntimeEventEnvelope } from "@wordless/protocol";
import type { RuntimeClient } from "../../bridge/runtime-client";
import type { MessageKey } from "../../shared/i18n";
import type { AnimationFrameScheduler } from "./thread-viewport-store";
import {
  ThreadSessionStore,
  type ThreadRuntimeSubscribe,
} from "./thread-session-store.ts";

type SessionListener = (event: RuntimeEventEnvelope) => void;

const MAX_CACHED_STORES = 32;

/**
 * 让已创建的 Store 实例在会话之间复用,但**不负责保活投影**:视图卸载时会调
 * `release()`(不在运行就立刻释放历史投影,在运行则等这一轮跑完),所以这里缓存的主要是
 * "实例 + 翻译函数",不是几份完整历史。
 *
 * Runtime 是广播源,所以整个应用只挂一个 IPC 订阅再分发,而不是每个 ThreadView 一个。
 */
class RuntimeSessionStoreRegistry {
  private readonly client: RuntimeClient;
  private readonly stores = new Map<string, ThreadSessionStore>();
  private readonly usage = new Map<string, number>();
  private readonly listeners = new Map<string, Set<SessionListener>>();
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(client: RuntimeClient) {
    this.client = client;
  }

  get(
    sessionId: string,
    translate: (key: MessageKey) => string,
    scheduler?: AnimationFrameScheduler,
  ): ThreadSessionStore {
    const existing = this.stores.get(sessionId);
    if (existing) {
      existing.setTranslate(translate);
      this.usage.delete(sessionId);
      this.usage.set(sessionId, Date.now());
      return existing;
    }
    const subscribe: ThreadRuntimeSubscribe = (listener) => {
      this.ensureRuntimeSubscription();
      const sessionListeners = this.listeners.get(sessionId) ?? new Set<SessionListener>();
      sessionListeners.add(listener);
      this.listeners.set(sessionId, sessionListeners);
      return () => {
        sessionListeners.delete(listener);
        if (sessionListeners.size === 0) this.listeners.delete(sessionId);
      };
    };
    const store = new ThreadSessionStore(
      this.client,
      sessionId,
      translate,
      scheduler,
      subscribe,
    );
    this.stores.set(sessionId, store);
    this.usage.set(sessionId, Date.now());
    this.evictOverflow();
    return store;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
    this.usage.clear();
    this.listeners.clear();
  }

  /**
   * 超出上限时淘汰**最久没被取用**的 store。
   *
   * 只淘汰**没有订阅**的那些:有订阅说明要么正被挂载的视图用着(`ThreadView` 的 effect 依赖
   * 里只有 `threadStore`,不会重跑,所以被淘汰之后它再也不会收到通知),要么正在跑一轮。
   * `dispose()` 会清空投影并关掉发布器,这两种情况都无法自愈 —— 宁可暂时超出上限。
   */
  private evictOverflow(): void {
    for (const sessionId of [...this.usage.keys()]) {
      if (this.stores.size <= MAX_CACHED_STORES) return;
      if (this.listeners.has(sessionId)) continue;
      this.usage.delete(sessionId);
      this.listeners.delete(sessionId);
      this.stores.get(sessionId)?.dispose();
      this.stores.delete(sessionId);
    }
  }

  private ensureRuntimeSubscription(): void {
    if (this.unsubscribe || this.disposed) return;
    this.unsubscribe = this.client.subscribe((event) => {
      if (this.disposed || !event.sessionId) return;
      const listeners = this.listeners.get(event.sessionId);
      if (!listeners) return;
      for (const listener of [...listeners]) listener(event);
    });
  }
}

const registries = new WeakMap<object, RuntimeSessionStoreRegistry>();

export function getThreadSessionStore(
  client: RuntimeClient,
  sessionId: string,
  translate: (key: MessageKey) => string,
  scheduler?: AnimationFrameScheduler,
): ThreadSessionStore {
  let registry = registries.get(client);
  if (!registry) {
    registry = new RuntimeSessionStoreRegistry(client);
    registries.set(client, registry);
  }
  return registry.get(sessionId, translate, scheduler);
}

export function disposeThreadSessionStores(client: RuntimeClient): void {
  const registry = registries.get(client);
  if (!registry) return;
  registry.dispose();
  registries.delete(client);
}
