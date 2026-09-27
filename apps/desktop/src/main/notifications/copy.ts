import type { AppPreferences, AutomationRunStatus } from "@wordless/domain";

/**
 * The only user-facing prose this feature needs on the main side.
 *
 * A status word has to be resolved at *send* time — the template only says
 * `{{status}}` — and the host builds notifications with no window open, so the
 * renderer cannot supply it. Everything else (the template body) is authored and
 * persisted by the renderer in the user's own language, which is why this file is
 * a handful of strings rather than an i18n framework.
 */

type Copy = {
  /** Exhaustive over the eight run statuses so a new one cannot ship without a word. */
  status: Record<AutomationRunStatus, string>;
  endpointMissing: string;
  interruptedSummary: string;
  droppedSuffix: string;
};

const COPY: Record<"zh-CN" | "en-US", Copy> = {
  "zh-CN": {
    status: {
      queued: "等待中",
      running: "运行中",
      waiting: "等待你的操作",
      completed: "已完成",
      failed: "失败",
      cancelled: "已取消",
      "configuration-error": "配置有误",
      interrupted: "被中断",
    },
    endpointMissing: "没有可用的推送通道",
    interruptedSummary: "上次退出时有 {count} 个任务未跑完，已被中断。",
    droppedSuffix: "\n\n（另有 {count} 条通知因积压被丢弃）",
  },
  "en-US": {
    status: {
      queued: "Queued",
      running: "Running",
      waiting: "Waiting for you",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      "configuration-error": "Misconfigured",
      interrupted: "Interrupted",
    },
    endpointMissing: "No channel is available to push to",
    interruptedSummary: "{count} task(s) did not finish before Wordless last exited and were interrupted.",
    droppedSuffix: "\n\n({count} more notification(s) were dropped while the queue was full)",
  },
};

export function notificationCopy(locale: AppPreferences["locale"]): Copy {
  return locale === "zh-CN" ? COPY["zh-CN"] : COPY["en-US"];
}

/**
 * `45s` / `3m 20s` / `1h 5m`.
 *
 * Not translated: the units are understood in both languages, and this is a value
 * substituted into a template rather than prose. `undefined` means the run never
 * reported a start, which happens for a configuration error.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function notificationStatusWord(locale: AppPreferences["locale"], status: AutomationRunStatus): string {
  return notificationCopy(locale).status[status];
}

/** Exposed for the zh/en parity test. */
export const NOTIFICATION_COPY = COPY;
