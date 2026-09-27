import type { AppPreferences, AutomationRunStatus } from "@wordless/domain";
import type {
  NotificationDefaults,
  NotificationEvent,
  NotificationFailure,
  NotificationSubscription,
  WebhookMessage,
  WebhookMessageLevel,
  WebhookSendResult,
} from "@wordless/protocol";
import { notificationCopy, notificationStatusWord } from "./copy.ts";
import { DEFAULT_NOTIFICATION_TEMPLATE, renderForBudget, templateVariables } from "./template.ts";
import type { TextLimits } from "./truncate.ts";

/**
 * Where a notification comes from and where it goes.
 *
 * Producers call `emit` and stop caring: they never learn whether a webhook
 * exists, which channel answered, or that a platform has a rate limit. Everything
 * between — resolving the subscription, rendering, truncating per target, queueing,
 * limiting — happens here.
 *
 * Nothing in this file imports Electron, so the whole set of rules is testable with
 * a fake producer and a fake sender.
 */

export type NotifyWhen = "always" | "success" | "failure";

/** A channel the bus may send to, with the ceiling of the platform behind it. */
export interface NotificationTarget {
  id: string;
  name: string;
  limits: TextLimits;
  maxMessagesPerMinute?: number;
}

export interface NotificationBusDeps {
  /** Read per dispatch: the user may change the language mid-session. */
  locale: () => AppPreferences["locale"];
  readDefaults: () => Promise<NotificationDefaults>;
  /** The task-level override, when the producer stored one. */
  readSubscription: (sourceId: string) => Promise<NotificationSubscription | undefined>;
  /** Enabled channels, already filtered. */
  listTargets: () => NotificationTarget[];
  /** The run's final reply. Only called when the template asks for it. */
  readReply: (event: NotificationEvent) => Promise<string | undefined>;
  send: (targetId: string, message: WebhookMessage) => Promise<WebhookSendResult>;
  /** Delivery finished. The producer records the failure, if any, off the hot path. */
  onResult?: (event: NotificationEvent, failure: NotificationFailure | undefined) => void;
  /** Injected so tests need not touch a real clock. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Bounded so a long outage cannot grow memory; oldest is dropped, being least relevant. */
const QUEUE_CAPACITY = 50;
const DEDUPE_CAPACITY = 200;
const DEDUPE_WINDOW_MS = 10 * 60_000;
/** Feishu allows 5/second; the gap keeps a burst from tripping that while the minute cap is fine. */
const MIN_SEND_GAP_MS = 200;
const RATE_WINDOW_MS = 60_000;

export interface ResolvedSubscription {
  endpointIds: string[];
  when: NotifyWhen;
  template: string;
}

/**
 * Task override first, then the global defaults, **field by field**.
 *
 * Field-by-field rather than "the task's whole subscription or the defaults": that
 * way adding a field later cannot silently change what existing tasks do, and a
 * task that only wants a different template still inherits the rest.
 */
export function resolveSubscription(
  defaults: NotificationDefaults,
  subscription: NotificationSubscription | undefined,
): ResolvedSubscription | undefined {
  if (subscription?.enabled === false) return undefined;
  if (subscription === undefined && !defaults.enabled) return undefined;
  return {
    endpointIds: subscription?.endpointIds.length ? subscription.endpointIds : defaults.endpointIds,
    when: subscription?.when ?? defaults.when,
    template: subscription?.template ?? defaults.template ?? DEFAULT_NOTIFICATION_TEMPLATE,
  };
}

/**
 * Whether a run that ended this way should be announced.
 *
 * `cancelled` is excluded first and unconditionally: the user asked for it, so
 * telling them about it is noise.
 */
export function shouldPushForStatus(when: NotifyWhen, status: AutomationRunStatus): boolean {
  if (status === "cancelled") return false;
  if (when === "always") return true;
  if (when === "success") return status === "completed";
  return status === "failed" || status === "configuration-error" || status === "interrupted";
}

export function levelForStatus(status: AutomationRunStatus): WebhookMessageLevel {
  if (status === "completed") return "success";
  if (status === "failed" || status === "configuration-error") return "error";
  if (status === "interrupted") return "warn";
  return "info";
}

export class NotificationBus {
  private readonly deps: NotificationBusDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queue: NotificationEvent[] = [];
  /** eventId → first seen. Insertion-ordered, so the oldest is evicted first. */
  private readonly seen = new Map<string, number>();
  /** targetId → recent send timestamps, for the per-channel window. */
  private readonly sendTimes = new Map<string, number[]>();
  private dropped = 0;
  private draining = false;
  private disposed = false;

  constructor(deps: NotificationBusDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Hands over one event. **Synchronous, never throws, never awaits.**
   *
   * This runs on the run-completion path, where the only job is to record that the
   * run ended. A webhook that hangs for its full 30s timeout must not be able to
   * delay the run itself showing as finished, so delivery happens on the queue and
   * the failure comes back later through `onResult`.
   */
  emit(event: NotificationEvent): void {
    try {
      if (!this.accept(event.eventId)) return;
      if (this.deps.listTargets().length === 0) {
        // Configured but unusable. Reported rather than dropped in silence: "nothing
        // happened" is the hardest failure for a user to diagnose.
        this.deps.onResult?.(event, { code: "no-endpoint" });
        return;
      }
      if (this.queue.length >= QUEUE_CAPACITY) {
        this.queue.shift();
        this.dropped += 1;
      }
      this.queue.push(event);
      void this.drain();
    } catch {
      // A notification must never break the work that produced it.
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
  }

  /** How many events were discarded because the queue was full. */
  droppedCount(): number {
    return this.dropped;
  }

  /**
   * Idempotency: the terminal branch that emits can run more than once for one run,
   * and a duplicate message in a group chat cannot be taken back.
   */
  private accept(eventId: string): boolean {
    const at = this.seen.get(eventId);
    if (at !== undefined && this.now() - at < DEDUPE_WINDOW_MS) return false;
    this.seen.delete(eventId);
    this.seen.set(eventId, this.now());
    while (this.seen.size > DEDUPE_CAPACITY) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }

  /**
   * Serial over events, parallel over the targets of one event.
   *
   * Events must not run concurrently — that is what keeps a channel from being hit
   * twice at once and blowing through its rate limit. Targets within one event can,
   * since they are different channels; a slow one then does not hold up the others.
   * (The design note mentioned a global cap of 4 as well; with an endpoint count in
   * the single digits and events already serial, it would only add a semaphore.)
   */
  private async drain(): Promise<void> {
    if (this.draining || this.disposed) return;
    this.draining = true;
    try {
      while (!this.disposed) {
        const event = this.queue.shift();
        if (!event) break;
        await this.dispatch(event);
      }
    } catch {
      // One bad event must not stall the queue behind it.
    } finally {
      this.draining = false;
    }
  }

  private async dispatch(event: NotificationEvent): Promise<void> {
    const resolved = resolveSubscription(await this.deps.readDefaults(), await this.deps.readSubscription(event.sourceId));
    // Not configured is not a failure: most runs are not meant to be announced.
    if (!resolved) return;
    if (!shouldPushForStatus(resolved.when, event.status)) return;

    const allowed = new Set(resolved.endpointIds);
    const targets = this.deps.listTargets().filter((target) => allowed.has(target.id));
    if (targets.length === 0) {
      this.deps.onResult?.(event, { code: "no-endpoint" });
      return;
    }

    const values = await this.templateValues(event, resolved.template);
    const results = await Promise.all(
      targets.map(async (target) => {
        await this.gate(target);
        return await this.sendSafely(target, event, resolved.template, values);
      }),
    );
    this.deps.onResult?.(event, summarize(results));
  }

  private async templateValues(event: NotificationEvent, template: string): Promise<Record<string, string>> {
    const context = event.context;
    const values: Record<string, string> = {
      name: event.title,
      status: notificationStatusWord(this.deps.locale(), event.status),
      startedAt: text(context.startedAt),
      duration: context.duration === undefined ? "—" : text(context.duration),
      reply: "",
      error: context.error === undefined ? "" : text(context.error),
    };
    // Lazily, only when the body actually asks: reading the session is the one part
    // of this that touches stored conversation history.
    if (templateVariables(template).includes("reply")) {
      values.reply = await this.readReplySafely(event);
    }
    return values;
  }

  private async readReplySafely(event: NotificationEvent): Promise<string> {
    try {
      return (await this.deps.readReply(event)) ?? "";
    } catch {
      // A missing session must not cost the notification: the rest of the message is
      // still worth sending.
      return "";
    }
  }

  private async sendSafely(
    target: NotificationTarget,
    event: NotificationEvent,
    template: string,
    values: Record<string, string>,
  ): Promise<WebhookSendResult> {
    try {
      const body =
        event.text === undefined
          ? renderForBudget({ template, values, limits: target.limits }).text
          : event.text;
      return await this.deps.send(target.id, {
        title: event.title,
        text: body,
        level: event.level ?? levelForStatus(event.status),
        ...(event.attachments ? { attachments: event.attachments } : {}),
      });
    } catch (error) {
      return { ok: false, code: "unknown", detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Waits until this channel may be used again.
   *
   * Both ceilings matter: the per-minute cap (WeCom allows 20, DingTalk 20) and a
   * small gap, because a per-minute cap alone lets a burst empty itself in one
   * second and be rejected for exceeding a per-second limit.
   *
   * Waiting rather than retrying or dropping: the event is already in hand, so the
   * queue is the right place to absorb the delay.
   */
  private async gate(target: NotificationTarget): Promise<void> {
    const now = this.now();
    const recent = (this.sendTimes.get(target.id) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
    let wait = 0;
    const last = recent.at(-1);
    if (last !== undefined && now - last < MIN_SEND_GAP_MS) wait = MIN_SEND_GAP_MS - (now - last);
    const cap = target.maxMessagesPerMinute;
    if (cap !== undefined && recent.length >= cap) {
      wait = Math.max(wait, RATE_WINDOW_MS - (now - recent[0]) + 1);
    }
    if (wait > 0) await this.sleep(wait);

    const at = this.now();
    const kept = (this.sendTimes.get(target.id) ?? []).filter((value) => at - value < RATE_WINDOW_MS);
    kept.push(at);
    this.sendTimes.set(target.id, kept);
  }
}

function text(value: string | number | undefined): string {
  return value === undefined ? "—" : String(value);
}

/**
 * One failure for the run record, from any number of channel results.
 *
 * The first failing code is the one shown, because the codes are what the run list
 * translates; the count goes in the detail so "one of three" is not lost.
 */
export function summarize(results: WebhookSendResult[]): NotificationFailure | undefined {
  const failed = results.filter((result): result is Extract<WebhookSendResult, { ok: false }> => !result.ok);
  if (failed.length === 0) return undefined;
  const first = failed[0];
  const detail =
    failed.length > 1
      ? `${failed.length}/${results.length} channels failed; first: ${first.detail ?? first.code}`
      : first.detail;
  return { code: first.code, ...(detail ? { detail } : {}) };
}
