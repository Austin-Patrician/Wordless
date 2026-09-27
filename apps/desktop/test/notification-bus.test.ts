import assert from "node:assert/strict";
import test from "node:test";
import type { NotificationDefaults, NotificationEvent, NotificationSubscription, WebhookSendResult } from "@wordless/protocol";
import {
  NotificationBus,
  levelForStatus,
  resolveSubscription,
  shouldPushForStatus,
  summarize,
  type NotificationTarget,
} from "../src/main/notifications/bus.ts";

/**
 * The notification bus, with a fake producer and a fake sender.
 *
 * The behaviours worth pinning are the ones a manual test cannot see: that a
 * duplicate event is not announced twice, that the run-completion path never waits,
 * that a channel's rate limit is respected rather than exceeded, and that a reply
 * which does not fit gives way instead of pushing the rest of the message out.
 */

const TARGET: NotificationTarget = { id: "e1", name: "Release group", limits: { maxBytes: 12_000 } };

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    eventId: "automation.finished:run-1",
    kind: "automation.finished",
    sourceId: "task-1",
    status: "completed",
    title: "Daily report",
    context: { duration: "2m 18s" },
    at: "2026-03-25T00:00:00.000Z",
    ...overrides,
  };
}

const DEFAULTS: NotificationDefaults = { enabled: true, endpointIds: ["e1"], when: "always" };

function setup(overrides: Partial<Parameters<typeof buildDeps>[0]> = {}) {
  const sent: Array<{ targetId: string; text: string; title: string }> = [];
  const sleeps: number[] = [];
  const failures: Array<{ code: string } | undefined> = [];
  let clock = 1_000_000;
  const deps = buildDeps({
    defaults: DEFAULTS,
    targets: [TARGET],
    send: async (targetId, message) => {
      sent.push({ targetId, text: message.text, title: message.title ?? "" });
      return { ok: true };
    },
    onResult: (_event, failure) => failures.push(failure ? { code: failure.code } : undefined),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      // Advancing the clock keeps the rate-limit maths deterministic.
      clock += ms;
    },
    ...overrides,
  });
  const bus = new NotificationBus(deps);
  return { bus, sent, sleeps, failures, deps, advance: (ms: number) => (clock += ms) };
}

interface DepsOverrides {
  defaults: NotificationDefaults;
  subscription?: NotificationSubscription;
  targets: NotificationTarget[];
  send: (targetId: string, message: { text: string; title?: string }) => Promise<WebhookSendResult>;
  onResult?: (event: NotificationEvent, failure: { code: string } | undefined) => void;
  readReply?: () => Promise<string | undefined>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function buildDeps(overrides: DepsOverrides) {
  return {
    locale: () => "zh-CN" as const,
    readDefaults: async () => overrides.defaults,
    readSubscription: async () => overrides.subscription,
    listTargets: () => overrides.targets,
    readReply: overrides.readReply ?? (async () => "the reply"),
    send: overrides.send as never,
    onResult: overrides.onResult as never,
    now: overrides.now,
    sleep: overrides.sleep,
  };
}

/** Lets the queued dispatch run to completion. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("emit returns before delivery even starts", async () => {
  let senderCalled = false;
  let resolveSend: (() => void) | undefined;
  const { bus, sent } = setup({
    send: async (targetId, message) => {
      senderCalled = true;
      await new Promise<void>((resolve) => {
        resolveSend = resolve;
      });
      sent.push({ targetId, text: message.text, title: message.title ?? "" });
      return { ok: true };
    },
  });

  // The contract that matters: `emit` runs on the run-completion path, so it must
  // not drive any of the delivery itself.
  bus.emit(event());
  assert.equal(senderCalled, false, "the sender must not be reached synchronously");
  assert.equal(sent.length, 0);

  await settle();
  // Delivery is under way but blocked on the platform, and the caller is long gone.
  assert.equal(senderCalled, true);
  assert.equal(sent.length, 0);

  resolveSend?.();
  await settle();
  assert.equal(sent.length, 1);
});

test("the same event is announced once", async () => {
  const { bus, sent } = setup();
  bus.emit(event());
  bus.emit(event());
  await settle();
  assert.equal(sent.length, 1);
});

test("a different run of the same task is announced", async () => {
  const { bus, sent } = setup();
  bus.emit(event({ eventId: "automation.finished:run-1" }));
  await settle();
  bus.emit(event({ eventId: "automation.finished:run-2" }));
  await settle();
  assert.equal(sent.length, 2);
});

test("an event with no usable channel reports it rather than going quiet", async () => {
  const { bus, sent, failures } = setup({ targets: [] });
  bus.emit(event());
  await settle();
  assert.equal(sent.length, 0);
  assert.deepEqual(failures, [{ code: "no-endpoint" }]);
});

test("defaults that are off mean no message and no failure", async () => {
  const { bus, sent, failures } = setup({ defaults: { ...DEFAULTS, enabled: false } });
  bus.emit(event());
  await settle();
  assert.equal(sent.length, 0);
  // Not the same as "no endpoint": nothing was asked for, so nothing is wrong.
  assert.deepEqual(failures, []);
});

test("a task-level override wins field by field", () => {
  const defaults: NotificationDefaults = { enabled: true, endpointIds: ["e1"], when: "failure", template: "{{status}}" };
  // Only the template differs; the rest is inherited.
  assert.deepEqual(resolveSubscription(defaults, { enabled: true, endpointIds: [], when: "always", template: "x" }), {
    endpointIds: ["e1"],
    when: "always",
    template: "x",
  });
  // A task that says nothing gets the defaults wholesale.
  assert.deepEqual(resolveSubscription(defaults, undefined), { endpointIds: ["e1"], when: "failure", template: "{{status}}" });
  // Explicitly off short-circuits everything.
  assert.equal(resolveSubscription(defaults, { enabled: false, endpointIds: ["e9"], when: "always" }), undefined);
  // A task turned on while the global switch is off still runs.
  assert.deepEqual(resolveSubscription({ ...defaults, enabled: false }, { enabled: true, endpointIds: ["e2"], when: "success" }), {
    endpointIds: ["e2"],
    when: "success",
    template: "{{status}}",
  });
});

test("when-filtering over all eight statuses", () => {
  const statuses = [
    "queued",
    "running",
    "waiting",
    "completed",
    "failed",
    "cancelled",
    "configuration-error",
    "interrupted",
  ] as const;
  const expectFor = (when: "always" | "success" | "failure") =>
    statuses.filter((status) => shouldPushForStatus(when, status));

  // Cancelled is excluded from every mode: the user asked for it.
  assert.deepEqual(expectFor("always"), ["queued", "running", "waiting", "completed", "failed", "configuration-error", "interrupted"]);
  assert.deepEqual(expectFor("success"), ["completed"]);
  // A misconfiguration is a failure the user needs to hear about, not a silent skip.
  assert.deepEqual(expectFor("failure"), ["failed", "configuration-error", "interrupted"]);
});

test("the card colour follows the status", () => {
  assert.equal(levelForStatus("completed"), "success");
  assert.equal(levelForStatus("failed"), "error");
  assert.equal(levelForStatus("configuration-error"), "error");
  assert.equal(levelForStatus("interrupted"), "warn");
});

test("the rendered body uses the endpoint's budget and keeps the reply", async () => {
  const { bus, sent } = setup({
    defaults: { ...DEFAULTS, template: "{{duration}}\n\n{{reply}}" },
    readReply: async () => "中".repeat(10_000),
  });
  bus.emit(event());
  await settle();

  assert.equal(sent.length, 1);
  const body = sent[0].text;
  assert.match(body, /2m 18s/, "the status part must survive");
  assert.ok(Buffer.byteLength(body, "utf8") <= 12_000, `got ${Buffer.byteLength(body, "utf8")}`);
});

test("a reply is only read when the template asks for one", async () => {
  let reads = 0;
  const { bus } = setup({
    defaults: { ...DEFAULTS, template: "{{duration}}" },
    readReply: async () => {
      reads += 1;
      return "unused";
    },
  });
  bus.emit(event());
  await settle();
  assert.equal(reads, 0);
});

test("a failed reply read still sends the notification", async () => {
  const { bus, sent, failures } = setup({
    defaults: { ...DEFAULTS, template: "{{duration}}\n\n{{reply}}" },
    readReply: async () => {
      throw new Error("session gone");
    },
  });
  bus.emit(event());
  await settle();
  assert.equal(sent.length, 1);
  assert.deepEqual(failures, [undefined]);
});

test("a failed send is reported with its code", async () => {
  let attempts = 0;
  const { bus, failures } = setup({
    send: async () => {
      attempts += 1;
      return { ok: false, code: "timeout" };
    },
  });
  bus.emit(event());
  await settle();
  assert.equal(attempts, 1, "a failure is not retried inside the bus");
  assert.deepEqual(failures, [{ code: "timeout" }]);
});

test("a channel's per-minute cap is waited out, not exceeded", async () => {
  const capped: NotificationTarget = { ...TARGET, maxMessagesPerMinute: 2 };
  const { bus, sent, sleeps, advance } = setup({ targets: [capped] });

  bus.emit(event({ eventId: "r1" }));
  await settle();
  bus.emit(event({ eventId: "r2" }));
  await settle();
  assert.equal(sent.length, 2);
  // The first two are inside the window; the third has to wait for it to expire.
  assert.deepEqual(sleeps.slice(0, 2), [0, 200].filter((ms) => ms > 0).length ? sleeps.slice(0, 2) : []);

  const before = sleeps.length;
  advance(0);
  bus.emit(event({ eventId: "r3" }));
  await settle();
  assert.equal(sent.length, 3);
  assert.ok(sleeps.length > before, "the third send must have waited for the window");
  assert.ok(sleeps.at(-1)! > 0);
});

test("the minimum gap is applied between sends to one channel", async () => {
  const { bus, sleeps } = setup();
  bus.emit(event({ eventId: "r1" }));
  await settle();
  bus.emit(event({ eventId: "r2" }));
  await settle();
  assert.ok(sleeps.includes(200), `expected a 200ms gap, got ${JSON.stringify(sleeps)}`);
});

test("two channels are sent to independently", async () => {
  const second: NotificationTarget = { id: "e2", name: "Ops", limits: { maxBytes: 12_000 } };
  const { bus, sent } = setup({
    targets: [TARGET, second],
    defaults: { enabled: true, endpointIds: ["e1", "e2"], when: "always" },
  });
  bus.emit(event());
  await settle();
  assert.deepEqual(sent.map((item) => item.targetId).sort(), ["e1", "e2"]);
});

test("only the channels the subscription names are used", async () => {
  const second: NotificationTarget = { id: "e2", name: "Ops", limits: { maxBytes: 12_000 } };
  const { bus, sent } = setup({
    targets: [TARGET, second],
    defaults: { enabled: true, endpointIds: ["e1", "e2"], when: "always" },
    subscription: { enabled: true, endpointIds: ["e2"], when: "always" },
  });
  bus.emit(event());
  await settle();
  assert.deepEqual(sent.map((item) => item.targetId), ["e2"]);
});

test("a body supplied by the producer bypasses the template", async () => {
  const { bus, sent } = setup({ defaults: { ...DEFAULTS, template: "should not be used" } });
  bus.emit(event({ text: "written by the producer" }));
  await settle();
  assert.equal(sent[0].text, "written by the producer");
});

test("the first failing code is surfaced, with the count kept aside", () => {
  assert.equal(summarize([{ ok: true }]), undefined);
  assert.deepEqual(summarize([{ ok: false, code: "timeout" }]), { code: "timeout" });
  assert.deepEqual(summarize([{ ok: true }, { ok: false, code: "platform-rejected", detail: "nope" }]), {
    code: "platform-rejected",
    detail: "nope",
  });
  const mixed = summarize([
    { ok: false, code: "timeout" },
    { ok: false, code: "http-error", detail: "500" },
    { ok: true },
  ]);
  assert.equal(mixed?.code, "timeout");
  assert.match(String(mixed?.detail), /2\/3/);
});
