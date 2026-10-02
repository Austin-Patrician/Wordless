import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { DesktopAppInfo, DesktopRelease, DesktopUpdateSnapshot } from "@wordless/protocol";
import { useRuntime } from "../shared/runtime";

type DesktopUpdateContextValue = {
  appInfo: DesktopAppInfo | null;
  snapshot: DesktopUpdateSnapshot | null;
  releases: DesktopRelease[];
  releasesLoading: boolean;
  releasesError: string | null;
  dismissed: boolean;
  dismiss: () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  loadReleases: (refresh?: boolean) => Promise<void>;
  openReleasePage: (version?: string) => Promise<void>;
};

const DesktopUpdateContext = createContext<DesktopUpdateContextValue | null>(null);

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DesktopUpdateProvider({ children }: { children: ReactNode }) {
  const { client } = useRuntime();
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot | null>(null);
  const [releases, setReleases] = useState<DesktopRelease[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!client) return;
    void Promise.all([client.getAppInfo(), client.getUpdateSnapshot()]).then(([info, update]) => {
      setAppInfo(info);
      setSnapshot(update);
    }).catch(() => undefined);
    return client.subscribeHost((event) => {
      if (event.type !== "update") return;
      setSnapshot(event.snapshot);
      if (event.snapshot.state === "available") setDismissed(false);
    });
  }, [client]);

  const run = useCallback(async (operation: "check" | "download" | "install") => {
    if (!client) return;
    if (operation === "check") setDismissed(false);
    try {
      const next = operation === "check" ? await client.checkForUpdates() : operation === "download" ? await client.downloadUpdate() : await client.installUpdate();
      setSnapshot(next);
    } catch (error) {
      setSnapshot((current) => ({ currentVersion: current?.currentVersion ?? appInfo?.version ?? "0.0.0", ...current, state: "error", error: messageFrom(error), progress: undefined }));
    }
  }, [appInfo?.version, client]);

  const loadReleases = useCallback(async (refresh = false) => {
    if (!client) return;
    setReleasesLoading(true);
    setReleasesError(null);
    try {
      setReleases(await client.listReleases(refresh));
    } catch (error) {
      setReleasesError(messageFrom(error));
    } finally {
      setReleasesLoading(false);
    }
  }, [client]);

  const value = useMemo<DesktopUpdateContextValue>(() => ({
    appInfo,
    snapshot,
    releases,
    releasesLoading,
    releasesError,
    dismissed,
    dismiss: () => setDismissed(true),
    check: () => run("check"),
    download: () => run("download"),
    install: () => run("install"),
    loadReleases,
    openReleasePage: async (version) => { await client?.openReleasePage(version); },
  }), [appInfo, client, dismissed, loadReleases, releases, releasesError, releasesLoading, run, snapshot]);

  return <DesktopUpdateContext.Provider value={value}>{children}</DesktopUpdateContext.Provider>;
}

export function useDesktopUpdate(): DesktopUpdateContextValue {
  const value = useContext(DesktopUpdateContext);
  if (!value) throw new Error("useDesktopUpdate must be used inside DesktopUpdateProvider.");
  return value;
}
