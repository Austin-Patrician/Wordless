import type { RuntimeEventEnvelope } from "@wordless/protocol";
import type { RuntimeClient } from "../../bridge/runtime-client";
import type { MessageKey } from "../../shared/i18n";
import type { AnimationFrameScheduler } from "./thread-viewport-store";
import {
  ThreadSessionStore,
  type ThreadRuntimeSubscribe,
} from "./thread-session-store.ts";

type SessionListener = (event: RuntimeEventEnvelope) => void;

/**
 * Keeps live projections alive while a different session is visible. Runtime
 * is a broadcast source, so one hub subscription is enough for all cached
 * sessions and avoids one IPC listener per mounted/unmounted ThreadView.
 */
class RuntimeSessionStoreRegistry {
  private readonly client: RuntimeClient;
  private readonly stores = new Map<string, ThreadSessionStore>();
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
    return store;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
    this.listeners.clear();
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
