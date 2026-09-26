import { ipcMain } from "electron";
import { Value } from "typebox/value";
import {
  DesktopProxyConfigPatchSchema,
  type DesktopProxyActive,
  type DesktopProxyConfig,
  type DesktopProxySnapshot,
  type ProxyTestResult,
} from "@wordless/protocol";
import { findLocalProxy, testProxy } from "../proxy/proxy-probe";
import { mergeProxyConfigPatch, redactProxyConfig, resolveProxyConfig } from "../proxy/proxy-settings";
import type { DesktopProxyStore } from "../proxy/proxy-store";

/**
 * IPC surface for the application proxy.
 *
 * The renderer never sees the password: every response goes through
 * `redactProxyConfig`, and a save may omit the field to keep the stored one.
 * `active` is the host's own account of what it is using, so the page can say
 * "your settings are not in effect, the system proxy is" instead of leaving the
 * user to guess.
 */
export interface ProxyIpcDeps {
  /** Applies a config and reports what ended up in effect. */
  apply: (config: DesktopProxyConfig) => Promise<DesktopProxyActive>;
  /** The state from the startup apply, so the page does not have to re-apply. */
  initialActive: DesktopProxyActive;
  store: DesktopProxyStore;
}

export function registerProxyIpc(deps: ProxyIpcDeps): void {
  let active: DesktopProxyActive = deps.initialActive;

  const snapshot = async (): Promise<DesktopProxySnapshot> => ({
    active,
    config: redactProxyConfig(await deps.store.read()),
  });

  ipcMain.handle("wordless:proxy:snapshot", async (): Promise<DesktopProxySnapshot> => await snapshot());

  ipcMain.handle("wordless:proxy:set", async (_event, payload: unknown): Promise<DesktopProxySnapshot> => {
    // Reject unknown fields at the boundary rather than letting normalisation
    // drop them silently: a typo in the renderer should be a loud error.
    if (!Value.Check(DesktopProxyConfigPatchSchema, payload)) throw new Error("Invalid request payload");
    const merged = mergeProxyConfigPatch(await deps.store.read(), payload);
    active = await deps.apply(await deps.store.write(merged));
    return await snapshot();
  });

  ipcMain.handle("wordless:proxy:test", async (): Promise<ProxyTestResult> => {
    const config = await deps.store.read();
    const resolution = resolveProxyConfig(config);
    // An enabled-but-unusable config is `invalid`, which is a different message
    // from "the address did not answer".
    if (!resolution.ok) {
      return { ok: false, reason: resolution.reason === "disabled" ? "unreachable" : "invalid" };
    }
    return await testProxy(resolution.url);
  });

  ipcMain.handle("wordless:proxy:detect", async () => (await findLocalProxy()) ?? null);
}
