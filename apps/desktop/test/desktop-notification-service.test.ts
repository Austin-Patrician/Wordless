import assert from "node:assert/strict";
import test from "node:test";
import type { AppPreferences } from "@wordless/domain";
import type { RuntimeEventEnvelope } from "@wordless/protocol";
import {
  DesktopNotificationService,
  type DesktopNotificationHost,
  type HostNotification,
} from "../src/main/notifications/desktop-notification-service.ts";

/**
 * The system-notification channel, exercised through a fake host.
 *
 * Every platform capability is injected, so these cases run without Electron and
 * can assert the things that are easy to get wrong and invisible in a manual test:
 * whether an earlier notification is actually replaced, whether the badge survives
 * suppression, and whether a stale close handler can wipe the coalescing state.
 */

function envelope(event: Record<string, unknown>, sessionId: string | null): RuntimeEventEnvelope {
  return { protocolVersion: 1, runtimeInstanceId: "t", eventId: "e", sessionId, sequence: 1, timestamp: 0, event } as unknown as RuntimeEventEnvelope;
}

function preferences(overrides: Partial<AppPreferences["notifications"]> = {}): AppPreferences {
  return {
    locale: "zh-CN",
    notifications: { enabled: true, onActionRequired: true, onRunCompleted: true, onRunFailed: true, ...overrides },
  } as unknown as AppPreferences;
}

class FakeNotification implements HostNotification {
  shown = 0;
  closed = 0;
  private clickHandler: (() => void) | undefined;
  private closeHandler: (() => void) | undefined;
  readonly input: { title: string; body: string };
  constructor(input: { title: string; body: string }) {
    this.input = input;
  }
  close(): void {
    this.closed += 1;
    // The real `Notification.close()` fires its "close" event, which is what makes
    // the identity check in the service necessary.
    this.closeHandler?.();
  }
  show(): void {
    this.shown += 1;
  }
  onClick(handler: () => void): void {
    this.clickHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  click(): void {
    this.clickHandler?.();
  }
}

class FakeHost implements DesktopNotificationHost {
  focused = false;
  supported = true;
  readonly badges: string[] = [];
  readonly created: FakeNotification[] = [];
  readonly activated: Array<string | null> = [];
  titles = new Map<string, string>();

  isWindowFocused(): boolean {
    return this.focused;
  }
  notificationsSupported(): boolean {
    return this.supported;
  }
  setBadge(text: string): void {
    this.badges.push(text);
  }
  createNotification(input: { title: string; body: string }): HostNotification {
    const notification = new FakeNotification(input);
    this.created.push(notification);
    return notification;
  }
  sessionTitle(sessionId: string): string | undefined {
    return this.titles.get(sessionId);
  }
  activateSession(sessionId: string | null): void {
    this.activated.push(sessionId);
  }
}

function setup() {
  const host = new FakeHost();
  return { host, service: new DesktopNotificationService(host) };
}

test("a second notification for the same session replaces the first", () => {
  const { host, service } = setup();
  const event = envelope({ type: "run.completed", runId: "r" }, "s1");

  service.handle(event, preferences());
  service.handle(event, preferences());

  assert.equal(host.created.length, 2);
  assert.equal(host.created[0].closed, 1, "the first must be closed, not stacked");
  assert.equal(host.created[1].closed, 0);
  assert.equal(host.created[1].shown, 1);
});

test("a stale close handler cannot wipe the coalescing state", () => {
  const { host, service } = setup();
  const event = envelope({ type: "run.completed", runId: "r" }, "s1");

  service.handle(event, preferences()); // n1
  service.handle(event, preferences()); // n2 closes n1, whose close handler runs
  service.handle(event, preferences()); // n3 must therefore close n2

  // Without the identity check, n1's close event would have deleted the map entry
  // that n2 then re-registered... which silently degrades to "stacked
  // notifications", the exact bug coalescing exists to prevent.
  assert.equal(host.created[1].closed, 1, "the second must still be closed by the third");

  service.handle(event, preferences()); // n4
  assert.equal(host.created[2].closed, 1);
});

test("different sessions each keep their own notification", () => {
  const { host, service } = setup();
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s2"), preferences());

  assert.equal(host.created.length, 2);
  assert.equal(host.created[0].closed, 0);
  assert.equal(host.created[1].closed, 0);
});

test("the notification is suppressed only when that session is already on screen", () => {
  const { host, service } = setup();
  host.focused = true;
  service.setForegroundSession("s1");

  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());
  assert.equal(host.created.length, 0, "the user is looking at it");

  service.handle(envelope({ type: "run.completed", runId: "r" }, "s2"), preferences());
  assert.equal(host.created.length, 1, "focused elsewhere must still notify");

  service.setForegroundSession(null);
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());
  assert.equal(host.created.length, 2, "focused but not on a chat must still notify");

  host.focused = false;
  service.setForegroundSession("s1");
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());
  assert.equal(host.created.length, 3, "an unfocused window must notify");
});

test("the badge counts pending work even when the notification is suppressed", () => {
  const { host, service } = setup();
  host.focused = true;
  service.setForegroundSession("s1");
  const approval = envelope({ type: "approval.requested", approval: { approvalId: "a1" } }, "s1");

  service.handle(approval, preferences());

  assert.equal(host.created.length, 0, "no notification: the prompt is on screen");
  // The regression guard: suppressing the popup must not forget the pending item.
  assert.equal(host.badges.at(-1), "1");

  service.handle(envelope({ type: "approval.resolved", resolution: { approvalId: "a1" } }, "s1"), preferences());
  assert.equal(host.badges.at(-1), "");
});

test("two pending approvals count as two", () => {
  const { host, service } = setup();
  service.handle(envelope({ type: "approval.requested", approval: { approvalId: "a1" } }, "s1"), preferences());
  service.handle(envelope({ type: "user-request.requested", request: { requestId: "q1" } }, "s2"), preferences());
  assert.equal(host.badges.at(-1), "2");

  // Resolving one leaves the other.
  service.handle(envelope({ type: "approval.resolved", resolution: { approvalId: "a1" } }, "s1"), preferences());
  assert.equal(host.badges.at(-1), "1");
});

test("the master switch also silences the badge", () => {
  const { host, service } = setup();
  service.handle(
    envelope({ type: "approval.requested", approval: { approvalId: "a1" } }, "s1"),
    preferences({ enabled: false }),
  );
  assert.equal(host.created.length, 0);
  assert.deepEqual(host.badges, [], "disabled means nothing at all, badge included");
});

test("the notification is headed by the session title, with a fallback", () => {
  const { host, service } = setup();
  host.titles.set("s1", "Weekly report");
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());
  assert.equal(host.created[0].input.title, "Weekly report");

  // Unknown session: still notify, headed by the app name.
  service.handle(envelope({ type: "run.completed", runId: "r" }, "gone"), preferences());
  assert.equal(host.created[1].input.title, "Wordless");
});

test("clicking clears the badge and opens the session", () => {
  const { host, service } = setup();
  service.handle(envelope({ type: "approval.requested", approval: { approvalId: "a1" } }, "s1"), preferences());
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());

  const clickable = host.created.at(-1);
  assert.ok(clickable);
  clickable.click();

  assert.equal(host.badges.at(-1), "");
  assert.deepEqual(host.activated, ["s1"]);
});

test("clicking a notification for an anonymous event only focuses the app", () => {
  const { host, service } = setup();
  service.handle(envelope({ type: "run.completed", runId: "r" }, null), preferences());
  assert.equal(host.created[0].input.title, "Wordless");

  host.created[0].click();
  assert.deepEqual(host.activated, [null], "no session to open");
});

test("an unsupported platform still counts work but shows nothing", () => {
  const { host, service } = setup();
  host.supported = false;
  service.handle(envelope({ type: "approval.requested", approval: { approvalId: "a1" } }, "s1"), preferences());

  assert.equal(host.created.length, 0);
  assert.equal(host.badges.at(-1), "1");
});

test("dispose closes everything on screen", () => {
  const { host, service } = setup();
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s2"), preferences());

  service.dispose();
  assert.equal(host.created[0].closed, 1);
  assert.equal(host.created[1].closed, 1);
});

test("the body distinguishes completion from failure", () => {
  const { host, service } = setup();
  service.handle(envelope({ type: "run.completed", runId: "r" }, "s1"), preferences());
  service.handle(envelope({ type: "run.failed", runId: "r", message: "boom" }, "s2"), preferences());
  assert.notEqual(host.created[0].input.body, host.created[1].input.body);
});
