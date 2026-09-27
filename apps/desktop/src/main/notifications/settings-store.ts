import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NotificationDefaults } from "@wordless/protocol";

/**
 * The global push defaults.
 *
 * A task can override any of these field by field, so this file answers "what
 * happens to an automation nobody configured". Stored beside the webhook endpoints
 * rather than inside them because it is not a channel: it names channels.
 *
 * Reads never throw — a corrupt file degrades to "nothing is pushed", which is the
 * state a fresh install is in.
 */

export const DEFAULT_NOTIFICATION_DEFAULTS: NotificationDefaults = {
  enabled: false,
  endpointIds: [],
  when: "always",
};

export function defaultNotificationDefaultsPath(userDataPath: string): string {
  return path.join(userDataPath, "notifications", "defaults.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function notifyWhen(value: unknown): NotificationDefaults["when"] {
  return value === "success" || value === "failure" ? value : "always";
}

export async function loadNotificationDefaults(filePath: string): Promise<NotificationDefaults> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return { ...DEFAULT_NOTIFICATION_DEFAULTS };
  }
  if (!isRecord(parsed)) return { ...DEFAULT_NOTIFICATION_DEFAULTS };
  const endpointIds = Array.isArray(parsed.endpointIds)
    ? parsed.endpointIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const template = typeof parsed.template === "string" && parsed.template.trim() ? parsed.template : undefined;
  return {
    enabled: Boolean(parsed.enabled),
    endpointIds,
    when: notifyWhen(parsed.when),
    ...(template ? { template } : {}),
  };
}

export async function saveNotificationDefaults(filePath: string, defaults: NotificationDefaults): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  // Write-then-rename: a half-written file would read back as "push is off" and
  // silently stop every notification.
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}
