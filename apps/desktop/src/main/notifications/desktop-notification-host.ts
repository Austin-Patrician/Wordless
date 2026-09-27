import { app, BrowserWindow, Notification } from "electron";
import type { DesktopHostEvent } from "@wordless/protocol";
import type { DesktopNotificationHost, HostNotification } from "./desktop-notification-service.ts";

/**
 * The Electron side of desktop notifications.
 *
 * Everything the service is not allowed to know lives here: which window is
 * focused, how a notification is constructed, how the dock badge is set, and how
 * the app is brought forward. Keeping it in one file is what lets the service
 * itself be tested without Electron.
 */

export interface DesktopNotificationHostOptions {
  /** Late-bound: the window is created after the service. */
  getWindow: () => BrowserWindow | undefined;
  sendHostEvent: (event: DesktopHostEvent) => void;
  /** Resolved from the runtime snapshot, which the wiring owns. */
  sessionTitle: (sessionId: string) => string | undefined;
}

function liveWindow(getWindow: () => BrowserWindow | undefined): BrowserWindow | undefined {
  const window = getWindow();
  return window && !window.isDestroyed() ? window : undefined;
}

export function createDesktopNotificationHost(options: DesktopNotificationHostOptions): DesktopNotificationHost {
  const { getWindow, sendHostEvent } = options;

  return {
    isWindowFocused(): boolean {
      const window = liveWindow(getWindow);
      // A hidden window (macOS close) is not focused, so a run that finishes while
      // the app is hidden still reaches the user.
      return window !== undefined && window.isVisible() && window.isFocused();
    },

    notificationsSupported(): boolean {
      return Notification.isSupported();
    },

    setBadge(text: string): void {
      if (process.platform === "darwin" && app.dock) app.dock.setBadge(text);
    },

    createNotification(input: { title: string; body: string }): HostNotification {
      const notification = new Notification({ title: input.title, body: input.body });
      // macOS refuses to display notifications from a binary it cannot identify, and
      // says so only through this event — `Notification.isSupported()` still returns
      // true. Without this listener the feature looks implemented but silently does
      // nothing, which is exactly how it went unnoticed.
      notification.on("failed", (_event, error) => {
        console.warn(`[notifications] the system refused to display a notification: ${error}`);
      });
      return {
        close: () => notification.close(),
        show: () => notification.show(),
        onClick: (handler) => {
          notification.on("click", handler);
        },
        onClose: (handler) => {
          notification.on("close", handler);
        },
      };
    },

    sessionTitle(sessionId: string): string | undefined {
      // Filled in by the wiring, which owns the runtime snapshot.
      return options.sessionTitle?.(sessionId);
    },

    activateSession(sessionId: string | null): void {
      const window = liveWindow(getWindow);
      if (window) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      }
      // The renderer decides what "open this session" means; it may also need to
      // close an overlay first.
      if (sessionId !== null) sendHostEvent({ type: "open-session", sessionId });
    },
  };
}
