import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { DesktopHostEvent, DesktopHostInfo } from "@wordless/protocol";
import { useRuntime } from "../shared/runtime";

type DesktopHostContextValue = {
  hostInfo: DesktopHostInfo | null;
  modifierLabel: string;
  subscribeHost: (listener: (event: DesktopHostEvent) => void) => () => void;
};

const DesktopHostContext = createContext<DesktopHostContextValue | null>(null);

export function DesktopHostProvider({ children }: { children: ReactNode }) {
  const { client } = useRuntime();
  const [hostInfo, setHostInfo] = useState<DesktopHostInfo | null>(null);

  useEffect(() => {
    if (!client) return;
    void client.getHostInfo().then(setHostInfo).catch(() => setHostInfo(null));
  }, [client]);

  useEffect(() => {
    const root = document.documentElement;
    if (hostInfo) root.dataset.platform = hostInfo.platform;
    else delete root.dataset.platform;
    return () => { delete root.dataset.platform; };
  }, [hostInfo]);

  const value = useMemo<DesktopHostContextValue>(() => ({
    hostInfo,
    modifierLabel: hostInfo?.modifier === "meta" ? "Cmd" : "Ctrl",
    subscribeHost: (listener) => client ? client.subscribeHost(listener) : () => {},
  }), [client, hostInfo]);

  return <DesktopHostContext.Provider value={value}>{children}</DesktopHostContext.Provider>;
}

export function useDesktopHost() {
  const host = useContext(DesktopHostContext);
  if (!host) throw new Error("useDesktopHost must be used inside DesktopHostProvider.");
  return host;
}
