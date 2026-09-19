import { ipcMain } from "electron";
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import {
  BrowserCreateTabSchema,
  BrowserPanelSessionSchema,
  BrowserSetActionsAllowedSchema,
  BrowserSetSharedSchema,
  BrowserNavigateSchema,
  BrowserSessionScopeSchema,
  BrowserTabIdSchema,
  BrowserViewBoundsSchema,
} from "@wordless/protocol";
import type { BrowserService } from "../browser/browser-service";

function parsePayload<T>(schema: TSchema, payload: unknown): T {
  if (!Value.Check(schema, payload)) throw new Error("Invalid request payload");
  return payload as T;
}

/**
 * IPC surface for the embedded browser panel.
 *
 * Every call stays on the layout/navigation axis: the renderer reports where
 * the panel is and what the user asked for, and the main process owns the page.
 * No page content crosses this boundary.
 */
export function registerBrowserIpc(service: BrowserService): void {
  ipcMain.handle("wordless:browser:show", async () => await service.show());

  // Which session's grants the panel should reflect. Pushed rather than sent with
  // every call so the per-session flags stay correct as the user moves between
  // sessions without the toolbar having to re-ask.
  ipcMain.handle("wordless:browser:panel-session", (_event, payload: unknown) => {
    const input = parsePayload<{ sessionId: string | null }>(BrowserPanelSessionSchema, payload);
    return service.setPanelSession(input.sessionId);
  });

  ipcMain.handle("wordless:browser:hide", () => {
    service.hide();
  });

  // Bounds arrive on every layout change, so this is intentionally cheap and
  // returns nothing the renderer needs.
  ipcMain.handle("wordless:browser:bounds", (_event, payload: unknown) => {
    const rect = parsePayload<{ x: number; y: number; width: number; height: number }>(BrowserViewBoundsSchema, payload);
    service.setBounds(rect);
  });

  ipcMain.handle("wordless:browser:navigate", async (_event, payload: unknown) => {
    const input = parsePayload<{ action: "url" | "back" | "forward" | "reload"; url?: string }>(BrowserNavigateSchema, payload);
    return await service.navigate(input.action, input.url);
  });

  ipcMain.handle("wordless:browser:tab-create", async (_event, payload: unknown) => {
    const input = parsePayload<{ url?: string }>(BrowserCreateTabSchema, payload);
    return await service.createTab(input.url);
  });

  ipcMain.handle("wordless:browser:tab-close", async (_event, payload: unknown) => {
    const input = parsePayload<{ tabId: string }>(BrowserTabIdSchema, payload);
    return await service.closeTab(input.tabId);
  });

  ipcMain.handle("wordless:browser:tab-select", async (_event, payload: unknown) => {
    const input = parsePayload<{ tabId: string }>(BrowserTabIdSchema, payload);
    return await service.selectTab(input.tabId);
  });

  ipcMain.handle("wordless:browser:session-scope", async (_event, payload: unknown) => {
    const input = parsePayload<{ scope: "ephemeral" | "persistent" }>(BrowserSessionScopeSchema, payload);
    return await service.setSessionScope(input.scope);
  });

  ipcMain.handle("wordless:browser:share", async (_event, payload: unknown) => {
    const input = parsePayload<{ tabId: string; shared: boolean }>(BrowserSetSharedSchema, payload);
    return await service.setShared(input.tabId, input.shared);
  });

  ipcMain.handle("wordless:browser:actions-allowed", async (_event, payload: unknown) => {
    const input = parsePayload<{ tabId: string; allowed: boolean }>(BrowserSetActionsAllowedSchema, payload);
    return await service.setActionsAllowed(input.tabId, input.allowed);
  });

  ipcMain.handle("wordless:browser:devtools", () => {
    service.openDevTools();
  });
}
