import { ipcMain } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DesktopNotificationService } from "../notifications/desktop-notification-service";

/**
 * The one channel the desktop-notification channel needs from the renderer.
 *
 * The renderer reports which session's chat is on screen; the host already knows
 * whether its window has focus. Suppression needs both, and each side owns exactly
 * one of them — so this crosses the boundary instead of the renderer guessing at
 * focus (which it cannot see) or the host guessing at what is on screen (which it
 * cannot see either).
 */
const ForegroundSessionSchema = Type.Object(
  { sessionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]) },
  { additionalProperties: false },
);

export interface DesktopNotificationIpcDeps {
  notifications: DesktopNotificationService;
}

export function registerDesktopNotificationIpc(deps: DesktopNotificationIpcDeps): void {
  ipcMain.handle("wordless:notification:foreground-session", (_event, payload: unknown): void => {
    if (!Value.Check(ForegroundSessionSchema, payload)) throw new Error("Invalid request payload");
    deps.notifications.setForegroundSession((payload as { sessionId: string | null }).sessionId);
  });
}
