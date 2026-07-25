import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AppSnapshot, RuntimeEventEnvelope } from "@wordless/protocol";
import { getRuntimeClient, type RuntimeClient } from "../bridge/runtime-client";

type RuntimeContextValue = {
  client: RuntimeClient | null;
  snapshot: AppSnapshot | null;
  error: string | null;
  refresh: () => Promise<void>;
  status: "loading" | "ready" | "unavailable" | "error";
};

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [{ client, bridgeError }] = useState<{ client: RuntimeClient | null; bridgeError: string | null }>(() => {
    try {
      return { client: getRuntimeClient(), bridgeError: null };
    } catch (cause) {
      return { client: null, bridgeError: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState<string | null>(bridgeError);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      setSnapshot(await client.getSnapshot());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!client) return;
    return client.subscribe((event) => {
      if (event.event.type === "skills.changed" || event.event.type === "connectors.changed" || event.event.type === "model-configuration.changed" || event.event.type === "media.project.changed") void refresh();
    });
  }, [client, refresh]);

  const status = !client ? "unavailable" : snapshot ? "ready" : error ? "error" : "loading";
  const value = useMemo<RuntimeContextValue>(() => ({ client, snapshot, error, refresh, status }), [client, error, refresh, snapshot, status]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("useRuntime must be used inside RuntimeProvider.");
  return runtime;
}

export function useRuntimeClient(): RuntimeClient {
  const { client, error } = useRuntime();
  if (!client) throw new Error(error ?? "Electron runtime is unavailable.");
  return client;
}

export function subscribeToRuntime(listener: (event: RuntimeEventEnvelope) => void): () => void {
  return getRuntimeClient().subscribe(listener);
}
