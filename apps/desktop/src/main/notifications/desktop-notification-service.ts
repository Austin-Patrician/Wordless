import { app, BrowserWindow, Notification } from "electron";
import type { AppPreferences } from "@wordless/domain";
import type { RuntimeEventEnvelope } from "@wordless/protocol";

type NotificationKind = "action-required" | "run-completed" | "run-failed";

function notificationKind(event: RuntimeEventEnvelope): NotificationKind | undefined {
  if (event.event.type === "approval.requested" || event.event.type === "user-request.requested") return "action-required";
  if (event.event.type === "run.completed") return "run-completed";
  if (event.event.type === "run.failed") return "run-failed";
  return undefined;
}

function isEnabled(preferences: AppPreferences, kind: NotificationKind): boolean {
  if (!preferences.notifications.enabled) return false;
  if (kind === "action-required") return preferences.notifications.onActionRequired;
  if (kind === "run-completed") return preferences.notifications.onRunCompleted;
  return preferences.notifications.onRunFailed;
}

function notificationBody(locale: AppPreferences["locale"], kind: NotificationKind): string {
  if (locale === "zh-CN") {
    if (kind === "action-required") return "Wordless 正在等待你的操作。";
    if (kind === "run-completed") return "Wordless 已完成当前任务。";
    return "Wordless 未能完成当前任务。";
  }
  if (kind === "action-required") return "Wordless is waiting for your input.";
  if (kind === "run-completed") return "Wordless completed the current task.";
  return "Wordless could not complete the current task.";
}

function hasFocusedWindow(): boolean {
  return BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isVisible() && window.isFocused());
}

function focusWordless(): void {
  const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export class DesktopNotificationService {
  private pendingActions = 0;

  clearBadge(): void {
    this.pendingActions = 0;
    if (process.platform === "darwin" && app.dock) app.dock.setBadge("");
  }

  private updateBadge(): void {
    if (process.platform === "darwin" && app.dock) app.dock.setBadge(this.pendingActions > 0 ? String(this.pendingActions) : "");
  }

  handle(event: RuntimeEventEnvelope, preferences: AppPreferences): void {
    const kind = notificationKind(event);
    if (!kind || !isEnabled(preferences, kind)) return;
    if (kind === "action-required") {
      this.pendingActions += 1;
      this.updateBadge();
    }
    if (hasFocusedWindow() || !Notification.isSupported()) return;
    try {
      const notification = new Notification({ title: "Wordless", body: notificationBody(preferences.locale, kind) });
      notification.on("click", () => { this.clearBadge(); focusWordless(); });
      notification.show();
    } catch {
      // Native notifications must never interrupt an Agent run.
    }
  }
}
