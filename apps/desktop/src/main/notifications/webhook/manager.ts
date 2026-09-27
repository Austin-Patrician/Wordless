import { randomUUID } from "node:crypto";
import type {
  WebhookDispatchResult,
  WebhookEndpointPublic,
  WebhookKind,
  WebhookMessage,
  WebhookMutationResult,
  WebhookProviderDescriptor,
  WebhookSendResult,
} from "@wordless/protocol";
import { defaultWebhookConfigPath, loadWebhookConfig, saveWebhookConfig } from "./config-store.ts";
import { deleteSecret, maskWebhookUrl, readSecret, writeSecret, type WebhookSecretStore } from "./credential-store.ts";
import { getProvider, isSupportedKind, listProviderDescriptors } from "./providers/registry.ts";
import type { WebhookConfigFile } from "./types.ts";
import { sanitizeProviderOptions, validateProviderOptions } from "./validate-options.ts";

/**
 * Owns the endpoint list.
 *
 * Two source-of-truth files are joined by endpoint id — non-secret metadata in
 * JSON, credentials in the OS keychain — and this class keeps them in step on
 * every mutation. Only the *derived* public view is held in memory (`urlMask`,
 * `hasSignSecret`); the URL and secret are read from the vault at the moment of a
 * send and otherwise never held.
 *
 * Rows this build cannot send through are dropped rather than listed: a channel
 * registered by a newer build would otherwise fail at send time with no way for
 * the user to understand why.
 */

export interface WebhookManagerOptions {
  userDataPath: string;
  secrets: WebhookSecretStore;
}

export interface BroadcastOptions {
  /** Restrict to these endpoints. Duplicates are ignored. */
  onlyIds?: string[];
  onlyKinds?: WebhookKind[];
  /** Also dispatch to endpoints the user disabled. Used by the test button. */
  includeDisabled?: boolean;
}

export class WebhookManager {
  private readonly configPath: string;
  private readonly secrets: WebhookSecretStore;
  private endpoints: WebhookEndpointPublic[] = [];

  constructor(options: WebhookManagerOptions) {
    this.configPath = defaultWebhookConfigPath(options.userDataPath);
    this.secrets = options.secrets;
  }

  /** Reads both stores and rebuilds the in-memory view. Never throws. */
  async reload(): Promise<void> {
    const stored = await loadWebhookConfig(this.configPath);
    const endpoints: WebhookEndpointPublic[] = [];
    for (const endpoint of stored) {
      if (!isSupportedKind(endpoint.kind)) continue;
      const secret = await this.readSecretSafely(endpoint.id);
      // A row with no credentials can never send, and keeping it would leave an
      // unremovable-looking entry in the list.
      if (!secret) continue;
      // Options this channel cannot send are dropped here rather than carried into
      // the form, where round-tripping them back would make the row unsavable.
      const { options, repaired } = sanitizeProviderOptions(
        getProvider(endpoint.kind).optionsSchema,
        endpoint.options,
      );
      if (repaired) {
        console.warn(`[webhook] dropped options this channel cannot send from endpoint ${endpoint.id}`);
      }
      endpoints.push({
        ...endpoint,
        options,
        urlMask: maskWebhookUrl(secret.url),
        hasSignSecret: Boolean(secret.signSecret),
      });
    }
    this.endpoints = endpoints;
  }

  list(): WebhookEndpointPublic[] {
    return this.endpoints.map((endpoint) => ({ ...endpoint }));
  }

  listProviderDescriptors(): WebhookProviderDescriptor[] {
    return listProviderDescriptors();
  }

  async create(input: {
    kind: WebhookKind;
    name: string;
    url: string;
    signSecret?: string;
    enabled?: boolean;
    options?: Record<string, unknown>;
  }): Promise<WebhookMutationResult> {
    if (!isSupportedKind(input.kind)) return { ok: false, code: "unsupported-kind", detail: input.kind };
    const provider = getProvider(input.kind);
    const url = input.url.trim();
    const signSecret = input.signSecret?.trim() || undefined;
    const options = input.options ?? {};

    const validation = provider.validate({ url, signSecret, options });
    if (!validation.ok) return { ok: false, code: validation.code, detail: validation.detail };
    const optionsCheck = validateProviderOptions(provider.optionsSchema, options);
    if (!optionsCheck.ok) return { ok: false, code: optionsCheck.code, detail: optionsCheck.detail };

    const id = randomUUID();
    const now = new Date().toISOString();
    const endpoint: WebhookEndpointPublic = {
      id,
      kind: input.kind,
      name: input.name.trim() || input.kind,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      urlMask: maskWebhookUrl(url),
      hasSignSecret: Boolean(signSecret),
      options,
    };

    // Credentials first: if the vault refuses, nothing is written and no
    // half-configured row is left behind.
    await writeSecret(this.secrets, id, { url, ...(signSecret ? { signSecret } : {}) });
    this.endpoints.push(endpoint);
    await this.persist();
    return { ok: true, endpoint: { ...endpoint } };
  }

  async update(
    id: string,
    patch: {
      name?: string;
      url?: string;
      signSecret?: string;
      enabled?: boolean;
      options?: Record<string, unknown>;
    },
  ): Promise<WebhookMutationResult> {
    const index = this.endpoints.findIndex((endpoint) => endpoint.id === id);
    if (index === -1) return { ok: false, code: "endpoint-not-found" };
    const previous = this.endpoints[index];
    const secret = await this.readSecretSafely(id);
    if (!secret) return { ok: false, code: "endpoint-not-found", detail: "credentials-missing" };

    const url = patch.url !== undefined ? patch.url.trim() : secret.url;
    // An empty string clears the secret; omitting the field keeps the stored one.
    // That is what lets the form save an unrelated change without the plaintext
    // ever travelling back down to the renderer.
    const signSecret =
      patch.signSecret === undefined ? secret.signSecret : patch.signSecret.trim() || undefined;
    const options = patch.options ?? previous.options;

    const provider = getProvider(previous.kind);
    const validation = provider.validate({ url, signSecret, options });
    if (!validation.ok) return { ok: false, code: validation.code, detail: validation.detail };
    const optionsCheck = validateProviderOptions(provider.optionsSchema, options);
    if (!optionsCheck.ok) return { ok: false, code: optionsCheck.code, detail: optionsCheck.detail };

    const next: WebhookEndpointPublic = {
      ...previous,
      name: patch.name !== undefined ? patch.name.trim() || previous.name : previous.name,
      enabled: patch.enabled ?? previous.enabled,
      options,
      updatedAt: new Date().toISOString(),
      urlMask: maskWebhookUrl(url),
      hasSignSecret: Boolean(signSecret),
    };

    const urlChanged = url !== secret.url;
    const secretChanged = signSecret !== secret.signSecret;
    if (urlChanged || secretChanged) {
      await writeSecret(this.secrets, id, { url, ...(signSecret ? { signSecret } : {}) });
    }

    this.endpoints[index] = next;
    await this.persist();
    return { ok: true, endpoint: { ...next } };
  }

  async setEnabled(id: string, enabled: boolean): Promise<WebhookMutationResult> {
    return await this.update(id, { enabled });
  }

  async delete(id: string): Promise<boolean> {
    const before = this.endpoints.length;
    this.endpoints = this.endpoints.filter((endpoint) => endpoint.id !== id);
    if (this.endpoints.length === before) return false;
    await deleteSecret(this.secrets, id);
    await this.persist();
    return true;
  }

  /**
   * Sends one message. Never throws: a failing webhook must not be able to fail
   * the work that finished.
   */
  async send(id: string, message: WebhookMessage): Promise<WebhookSendResult> {
    const endpoint = this.endpoints.find((candidate) => candidate.id === id);
    if (!endpoint) return { ok: false, code: "credentials-missing", detail: "not-found" };
    const secret = await this.readSecretSafely(id);
    if (!secret) return { ok: false, code: "credentials-missing" };

    const provider = getProvider(endpoint.kind);
    return await provider.send({
      url: secret.url,
      ...(secret.signSecret ? { signSecret: secret.signSecret } : {}),
      options: endpoint.options,
      message,
    });
  }

  /**
   * Fans out to every matching endpoint.
   *
   * Returns one result per target so a partial success is visible — "2 of 3
   * groups got it" is a different situation from "nothing got it".
   */
  async broadcast(message: WebhookMessage, options: BroadcastOptions = {}): Promise<WebhookDispatchResult[]> {
    const onlyIds = options.onlyIds ? new Set(options.onlyIds) : undefined;
    const onlyKinds = options.onlyKinds ? new Set(options.onlyKinds) : undefined;
    const targets = this.endpoints.filter((endpoint) => {
      if (!options.includeDisabled && !endpoint.enabled) return false;
      if (onlyIds && !onlyIds.has(endpoint.id)) return false;
      if (onlyKinds && !onlyKinds.has(endpoint.kind)) return false;
      return true;
    });

    return await Promise.all(
      targets.map(async (endpoint): Promise<WebhookDispatchResult> => {
        const result = await this.send(endpoint.id, message);
        return {
          id: endpoint.id,
          kind: endpoint.kind,
          name: endpoint.name,
          ok: result.ok,
          ...(result.ok ? {} : { code: result.code, ...(result.detail ? { detail: result.detail } : {}) }),
        };
      }),
    );
  }

  private async readSecretSafely(id: string) {
    try {
      return await readSecret(this.secrets, id);
    } catch {
      // An unavailable keychain, or an entry we cannot decrypt, is treated as
      // "no credentials": the row disappears instead of breaking the whole list.
      return undefined;
    }
  }

  private async persist(): Promise<void> {
    // Derived fields are never written: they must come from the vault on load, or
    // a rotated secret would leave a stale mask behind.
    const stripped = this.endpoints.map(({ urlMask: _mask, hasSignSecret: _has, ...rest }) => rest);
    await saveWebhookConfig(this.configPath, stripped as WebhookConfigFile["endpoints"]);
  }
}
