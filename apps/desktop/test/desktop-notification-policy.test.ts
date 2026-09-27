import assert from "node:assert/strict";
import test from "node:test";
import type { AppPreferences } from "@wordless/domain";
import type { RuntimeEventEnvelope } from "@wordless/protocol";
import {
  NOTIFICATION_FALLBACK_TITLE,
  NOTIFICATION_TITLE_MAX_BYTES,
  isNotificationEnabled,
  notificationBody,
  notificationKind,
  notificationTitle,
  shouldSuppressNotification,
} from "../src/main/notifications/notification-policy.ts";

function envelope(event: Record<string, unknown>): RuntimeEventEnvelope {
  return { protocolVersion: 1, runtimeInstanceId: "t", eventId: "e", sessionId: null, sequence: 1, timestamp: 0, event } as unknown as RuntimeEventEnvelope;
}

function preferences(overrides: Partial<AppPreferences["notifications"]> = {}): AppPreferences {
  return {
    locale: "zh-CN",
    notifications: { enabled: true, onActionRequired: true, onRunCompleted: true, onRunFailed: true, ...overrides },
  } as unknown as AppPreferences;
}

test("only the four kinds of event notify", () => {
  assert.equal(notificationKind(envelope({ type: "run.completed" })), "run-completed");
  assert.equal(notificationKind(envelope({ type: "run.failed", message: "x" })), "run-failed");
  assert.equal(notificationKind(envelope({ type: "approval.requested" })), "action-required");
  assert.equal(notificationKind(envelope({ type: "user-request.requested" })), "action-required");
  // Everything else stays silent: these fire constantly and would be noise.
  assert.equal(notificationKind(envelope({ type: "run.started", runId: "r" })), undefined);
  assert.equal(notificationKind(envelope({ type: "run.cancelled", runId: "r" })), undefined);
  assert.equal(notificationKind(envelope({ type: "message.delta", text: "x" })), undefined);
});

test("the master switch beats the per-kind switches", () => {
  assert.equal(isNotificationEnabled(preferences(), "run-completed"), true);
  assert.equal(isNotificationEnabled(preferences({ onRunCompleted: false }), "run-completed"), false);
  // Complete and failed are separable, so a user can keep only failures.
  assert.equal(isNotificationEnabled(preferences({ onRunCompleted: false }), "run-failed"), true);
  assert.equal(
    isNotificationEnabled(preferences({ enabled: false, onRunFailed: true }), "run-failed"),
    false,
  );
});

/**
 * The suppression rule, exhausted.
 *
 * Suppress **only** when the window is focused *and* the renderer is showing that
 * exact session. The old rule ("any focused window") dropped notifications for a
 * session that finished while the user was reading a different one, which is the
 * case this table exists to protect.
 */
test("suppression needs both signals, and both to match", () => {
  const table: Array<[boolean, string | null, string | null, boolean, string]> = [
    // focused, foreground,     event session, suppressed, why
    [true, "a", "a", true, "looking at exactly this session"],
    [true, "a", "b", false, "focused, but on another session"],
    [true, null, "a", false, "focused, but not on any chat (another view or a dialog)"],
    [true, "a", null, false, "event names no session, so nothing is on screen for it"],
    [false, "a", "a", false, "not focused: notify even though that session is the one shown"],
    [false, "a", "b", false, "not focused"],
    [false, null, "a", false, "not focused"],
    [false, null, null, false, "not focused"],
  ];
  for (const [windowFocused, foregroundSessionId, eventSessionId, expected, why] of table) {
    assert.equal(
      shouldSuppressNotification({ windowFocused, foregroundSessionId, eventSessionId }),
      expected,
      `${windowFocused} / ${foregroundSessionId} / ${eventSessionId} — ${why}`,
    );
  }
});

test("a title is trimmed to a readable length and never empty", () => {
  assert.equal(notificationTitle("Weekly report"), "Weekly report");
  assert.equal(notificationTitle(""), NOTIFICATION_FALLBACK_TITLE);
  assert.equal(notificationTitle("   "), NOTIFICATION_FALLBACK_TITLE);
  assert.equal(notificationTitle(undefined), NOTIFICATION_FALLBACK_TITLE);
  // Trimmed first, so surrounding whitespace does not eat the budget.
  assert.equal(notificationTitle("  sparse  "), "sparse");

  // Bytes, not characters: a Chinese character costs three.
  const long = "中".repeat(200);
  const trimmed = notificationTitle(long);
  assert.ok(Buffer.byteLength(trimmed, "utf8") <= NOTIFICATION_TITLE_MAX_BYTES, `got ${Buffer.byteLength(trimmed, "utf8")}`);
  assert.ok(trimmed.endsWith("…"));
  // 39 Chinese characters plus the ellipsis fits in 120 bytes; a 60-character cap
  // would have spent 180 bytes and still been cut by the platform.
  assert.equal(trimmed, `${"中".repeat(39)}…`);

  // ASCII is limited by the same byte budget, so it fits far more characters.
  // 120 bytes minus the 3-byte ellipsis leaves 117.
  const ascii = notificationTitle("a".repeat(200));
  assert.equal(ascii, `${"a".repeat(117)}…`);
  assert.equal(Buffer.byteLength(ascii, "utf8"), NOTIFICATION_TITLE_MAX_BYTES);
});

test("the body distinguishes the three kinds in both locales", () => {
  const kinds = ["action-required", "run-completed", "run-failed"] as const;
  const zh = kinds.map((kind) => notificationBody("zh-CN", kind));
  const en = kinds.map((kind) => notificationBody("en-US", kind));
  assert.equal(new Set(zh).size, 3);
  assert.equal(new Set(en).size, 3);
  for (const line of [...zh, ...en]) assert.ok(line.trim().length > 0);
});
