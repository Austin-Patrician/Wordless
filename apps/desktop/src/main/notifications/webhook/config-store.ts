import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { WEBHOOK_CONFIG_VERSION, type WebhookConfigFile } from "./types.ts";

/**
 * Non-secret endpoint metadata, as plain JSON.
 *
 * The URL and the sign secret are *not* here — they live in the OS credential
 * vault (see `credential-store.ts`) and the two stores are joined by endpoint id.
 * Splitting them is what lets the renderer, the logs and the agent context all
 * receive the endpoint list without any credential in it.
 *
 * Every parse path returns a usable value rather than throwing. A corrupt file
 * must degrade to "no endpoints configured", never to a window that will not
 * open.
 */

export function defaultWebhookConfigPath(userDataPath: string): string {
  return path.join(userDataPath, "notifications", "webhooks.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds one endpoint from disk.
 *
 * Returns null for entries that cannot be salvaged (no id, no known kind): a row
 * without an identity can never be edited or deleted, so keeping it would only
 * clutter the list.
 */
function sanitizeEndpoint(raw: unknown): WebhookConfigFile["endpoints"][number] | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.kind !== "string") return null;

  const now = new Date(0).toISOString();
  return {
    id: raw.id,
    // The kind is kept as-is; the manager drops rows whose channel this build
    // cannot send through, so storage does not need the provider registry.
    kind: raw.kind as WebhookConfigFile["endpoints"][number]["kind"],
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "未命名",
    enabled: Boolean(raw.enabled),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    hasSignSecret: Boolean(raw.hasSignSecret),
    options: isRecord(raw.options) ? raw.options : {},
  };
}

export async function loadWebhookConfig(filePath: string): Promise<WebhookConfigFile["endpoints"]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    // Missing or unreadable means "nothing configured yet", which is the state a
    // fresh install is in.
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.endpoints)) return [];

  const endpoints: WebhookConfigFile["endpoints"] = [];
  for (const raw of parsed.endpoints) {
    const endpoint = sanitizeEndpoint(raw);
    if (endpoint) endpoints.push(endpoint);
  }
  return endpoints;
}

export async function saveWebhookConfig(filePath: string, endpoints: WebhookConfigFile["endpoints"]): Promise<void> {
  const file: WebhookConfigFile = { version: WEBHOOK_CONFIG_VERSION, endpoints };
  await ensureDir(path.dirname(filePath));
  // Write-then-rename: a half-written file would be read back as "nothing
  // configured" and silently drop every endpoint the user added.
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

async function ensureDir(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}
