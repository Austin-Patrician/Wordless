import type { WebhookEndpointSecret } from "@wordless/protocol";

/**
 * Credential storage for group robots.
 *
 * The URL is the whole authority on every one of these platforms — and WeCom has
 * no request signature at all, so the URL alone is enough to post into the group.
 * That is why it goes to the OS keychain rather than to a plain JSON file: it is
 * held to the same standard as a stored password, and it never crosses into the
 * renderer.
 */

/** The slice of the credential vault this needs, so tests can supply a fake. */
export interface WebhookSecretStore {
  delete(id: string): Promise<void>;
  read(id: string): Promise<string | undefined>;
  write(id: string, value: string): Promise<void>;
}

/**
 * Vault ids are namespaced so a future channel cannot collide with the proxy
 * password or a model credential.
 */
function secretId(endpointId: string): string {
  return `webhook:${endpointId}`;
}

export async function readSecret(secrets: WebhookSecretStore, endpointId: string): Promise<WebhookEndpointSecret | undefined> {
  const raw = await secrets.read(secretId(endpointId));
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const url = (parsed as { url?: unknown }).url;
    if (typeof url !== "string" || !url) return undefined;
    const signSecret = (parsed as { signSecret?: unknown }).signSecret;
    return {
      url,
      ...(typeof signSecret === "string" && signSecret ? { signSecret } : {}),
    };
  } catch {
    // A vault entry we cannot parse is treated as absent rather than fatal: the
    // row shows up as needing credentials again and the user can re-enter them.
    return undefined;
  }
}

export async function writeSecret(secrets: WebhookSecretStore, endpointId: string, secret: WebhookEndpointSecret): Promise<void> {
  await secrets.write(secretId(endpointId), JSON.stringify(secret));
}

export async function deleteSecret(secrets: WebhookSecretStore, endpointId: string): Promise<void> {
  await secrets.delete(secretId(endpointId));
}

/**
 * Keeps the protocol and host, drops the path and query, and appends the last
 * four characters of the original.
 *
 * The tail exists so a user with several robots can tell the rows apart ("which
 * of these three is the release group?") without the token being recoverable.
 */
export function maskWebhookUrl(url: string): string {
  const tail = url.slice(-4);
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/…${tail}`;
  } catch {
    return `…${tail}`;
  }
}
