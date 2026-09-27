import type { AppPreferences } from "@wordless/domain";
import type { RuntimeEventEnvelope } from "@wordless/protocol";
import { truncateToLimits } from "./truncate.ts";

/**
 * The decisions a desktop notification makes, with no Electron in them.
 *
 * Split out from the service so the rule can be tested as a table rather than by
 * mocking a window: which events notify, when they are suppressed, and what the
 * text says.
 */

export type NotificationKind = "action-required" | "run-completed" | "run-failed";

/** Fallback header when a session has no title, or when the event names no session. */
export const NOTIFICATION_FALLBACK_TITLE = "Wordless";

/**
 * Long titles are cut here rather than left to the OS.
 *
 * **Counted in bytes, not characters.** Electron documents a 256-byte ceiling on
 * the whole notification, and a Chinese character is three of them — so a
 * character-based cap of 60 would spend 180 bytes on the title alone and still be
 * truncated by the platform. 120 bytes leaves room for the body in either script.
 */
export const NOTIFICATION_TITLE_MAX_BYTES = 120;

export function notificationKind(event: RuntimeEventEnvelope): NotificationKind | undefined {
  if (event.event.type === "approval.requested" || event.event.type === "user-request.requested") return "action-required";
  if (event.event.type === "run.completed") return "run-completed";
  if (event.event.type === "run.failed") return "run-failed";
  return undefined;
}

export function isNotificationEnabled(preferences: AppPreferences, kind: NotificationKind): boolean {
  if (!preferences.notifications.enabled) return false;
  if (kind === "action-required") return preferences.notifications.onActionRequired;
  if (kind === "run-completed") return preferences.notifications.onRunCompleted;
  return preferences.notifications.onRunFailed;
}

export function notificationBody(locale: AppPreferences["locale"], kind: NotificationKind): string {
  if (locale === "zh-CN") {
    if (kind === "action-required") return "Wordless 正在等待你的操作。";
    if (kind === "run-completed") return "Wordless 已完成当前任务。";
    return "Wordless 未能完成当前任务。";
  }
  if (kind === "action-required") return "Wordless is waiting for your input.";
  if (kind === "run-completed") return "Wordless completed the current task.";
  return "Wordless could not complete the current task.";
}

export function notificationTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  if (!trimmed) return NOTIFICATION_FALLBACK_TITLE;
  return truncateToLimits(trimmed, { maxBytes: NOTIFICATION_TITLE_MAX_BYTES }).text;
}

/**
 * Whether to stay quiet.
 *
 * Suppress **only** when the window is focused *and* the renderer is showing this
 * exact session's chat — i.e. the result is already in front of the user. Both
 * signals are needed and they come from different places: focus is the host's,
 * "which session is on screen" is the renderer's.
 *
 * The old rule was "any focused window suppresses everything", which silently
 * dropped the notification for a session that finished while the user was looking
 * at a different session or the settings dialog — the most common case.
 *
 * A focused window on another page must therefore still notify.
 */
export function shouldSuppressNotification(input: {
  windowFocused: boolean;
  /** The chat the renderer is showing, or null when it is not on a chat. */
  foregroundSessionId: string | null;
  /** The session this event belongs to; null for events that name none. */
  eventSessionId: string | null;
}): boolean {
  if (!input.windowFocused) return false;
  if (input.foregroundSessionId === null) return false;
  if (input.eventSessionId === null) return false;
  return input.foregroundSessionId === input.eventSessionId;
}
