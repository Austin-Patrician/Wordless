import type { AppPreferences } from "@wordless/domain";
import type { RuntimeEventEnvelope } from "@wordless/protocol";
import {
  isNotificationEnabled,
  notificationBody,
  notificationKind,
  notificationTitle,
  shouldSuppressNotification,
} from "./notification-policy.ts";

/**
 * The system-notification channel.
 *
 * Every host capability is injected — window focus, notification construction,
 * the dock badge, session titles, activation — so this file has no Electron import
 * and its behaviour (suppression, coalescing, the badge) is testable with fakes
 * instead of a mocked Electron module.
 *
 * It covers the *interactive* side. Background work (automations, scheduled runs)
 * is meant to reach the user through message push instead; see
 * docs/architecture/desktop-notifications.md.
 */

/** The notification as the host sees it. */
export interface HostNotification {
  close(): void;
  show(): void;
  onClick(handler: () => void): void;
  onClose(handler: () => void): void;
}

export interface DesktopNotificationHost {
  /** True when a visible window has focus. A hidden window is never focused. */
  isWindowFocused(): boolean;
  notificationsSupported(): boolean;
  /** Empty string clears the badge. */
  setBadge(text: string): void;
  createNotification(input: { title: string; body: string }): HostNotification;
  sessionTitle(sessionId: string): string | undefined;
  /** Brings the window forward; a null session just focuses the app. */
  activateSession(sessionId: string | null): void;
}

export class DesktopNotificationService {
  private readonly host: DesktopNotificationHost;
  /** Pending approvals/questions, counted on the dock badge. */
  private readonly pendingActions = new Set<string>();
  /**
   * Notifications currently on screen, keyed by session.
   *
   * A new one for the same session closes the previous, so a session that runs
   * several turns leaves one notification rather than a stack the user cannot
   * tell apart.
   */
  private readonly onScreen = new Map<string, HostNotification>();
  private foregroundSessionId: string | null = null;

  constructor(host: DesktopNotificationHost) {
    this.host = host;
  }

  /** Reported by the renderer; see the bridge's `setForegroundSession`. */
  setForegroundSession(sessionId: string | null): void {
    this.foregroundSessionId = sessionId;
  }

  clearBadge(): void {
    this.pendingActions.clear();
    this.updateBadge();
  }

  /** Closes everything on screen. The window is going away. */
  dispose(): void {
    for (const notification of this.onScreen.values()) notification.close();
    this.onScreen.clear();
  }

  private updateBadge(): void {
    this.host.setBadge(this.pendingActions.size > 0 ? String(this.pendingActions.size) : "");
  }

  handle(event: RuntimeEventEnvelope, preferences: AppPreferences): void {
    const sessionId = event.sessionId ?? "global";
    if (event.event.type === "approval.resolved") {
      this.pendingActions.delete(`${sessionId}:approval:${event.event.resolution.approvalId}`);
      this.updateBadge();
      return;
    }
    if (event.event.type === "user-request.resolved") {
      this.pendingActions.delete(`${sessionId}:user-request:${event.event.resolution.requestId}`);
      this.updateBadge();
      return;
    }
    const kind = notificationKind(event);
    if (!kind || !isNotificationEnabled(preferences, kind)) return;
    if (kind === "action-required") {
      if (event.event.type === "approval.requested") {
        this.pendingActions.add(`${sessionId}:approval:${event.event.approval.approvalId}`);
      } else if (event.event.type === "user-request.requested") {
        this.pendingActions.add(`${sessionId}:user-request:${event.event.request.requestId}`);
      }
      // The badge is updated *before* the suppression check on purpose: staying
      // quiet about a notification is not the same as forgetting the pending work.
      this.updateBadge();
    }
    if (!this.host.notificationsSupported()) return;
    const suppressed = shouldSuppressNotification({
      windowFocused: this.host.isWindowFocused(),
      foregroundSessionId: this.foregroundSessionId,
      eventSessionId: event.sessionId ?? null,
    });
    if (suppressed) return;
    this.present(sessionId, event.sessionId, notificationBody(preferences.locale, kind));
  }

  private present(badgeKey: string, sessionId: string | null, body: string): void {
    try {
      const title = sessionId === null ? undefined : this.host.sessionTitle(sessionId);
      // Coalesce first: the older notification for this session is replaced, not stacked.
      this.onScreen.get(badgeKey)?.close();
      const notification = this.host.createNotification({ title: notificationTitle(title), body });
      this.onScreen.set(badgeKey, notification);
      notification.onClick(() => {
        this.clearBadge();
        this.host.activateSession(sessionId ?? null);
      });
      notification.onClose(() => {
        // Identity check: a newer notification may already have taken this key, and
        // deleting it here would lose the coalescing state for the next one.
        if (this.onScreen.get(badgeKey) === notification) this.onScreen.delete(badgeKey);
      });
      notification.show();
    } catch {
      // Native notifications must never interrupt an Agent run.
    }
  }
}
