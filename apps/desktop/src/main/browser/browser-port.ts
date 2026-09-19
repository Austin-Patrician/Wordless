import type { BrowserPort, BrowserTabSummary } from "@wordless/capability-browser";
import type { BrowserConsolePage } from "@wordless/capability-browser";
import type { BrowserService } from "./browser-service";

/**
 * Adapts the panel's service to the port the browser capability is written
 * against.
 *
 * The capability must not know about gates, sessions or Electron windows, so the
 * adaptation happens here: every read is resolved against the shared-tab set, and
 * a request for a tab the user has not shared reads as "nothing to see" rather
 * than as an error the agent would retry.
 */
export function createBrowserPort(service: BrowserService, sessionId: string): BrowserPort {
  // The session is captured here rather than threaded through the capability: the
  // tools are per-session instances, following `createDataAnalysisTools(service,
  // { sessionId })`, so the port is where "which task is asking" belongs.
  return {
    async listSharedTabs(): Promise<BrowserTabSummary[]> {
      return service.listSharedTabs(sessionId);
    },
    async readSnapshot(tabId?: string) {
      const tab = service.resolveSharedTab(tabId, sessionId);
      if (!tab) return null;
      const snapshot = await service.readSnapshot(tab.id);
      if (!snapshot) return null;
      return { tab: toSummary(tab), snapshot };
    },
    async act(tabId, request) {
      return await service.act(tabId, sessionId, request);
    },
    async readConsole(tabId?: string, options?: { sinceId?: number; limit?: number }): Promise<BrowserConsolePage | null> {
      const tab = service.resolveSharedTab(tabId, sessionId);
      if (!tab) return null;
      return service.readConsoleBuffer(tab.id, options ?? {});
    },
    async captureScreenshot(tabId?: string) {
      const tab = service.resolveSharedTab(tabId, sessionId);
      if (!tab) return null;
      const shot = await service.captureScreenshot(tab.id);
      return shot ? { ...shot, tab: toSummary(tab) } : null;
    },
  };
}

function toSummary(tab: { id: string; url: string; title: string; loading: boolean; loadError: { description: string; url: string } | null }): BrowserTabSummary {
  return { id: tab.id, url: tab.url, title: tab.title, loading: tab.loading, loadError: tab.loadError };
}
