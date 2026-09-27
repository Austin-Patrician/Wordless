import type {
  WebhookEndpointPublic,
  WebhookKind,
  WebhookMessage,
  WebhookOptions,
  WebhookProviderCapabilities,
  WebhookProviderDescriptor,
  WebhookSendResult,
  WebhookValidationResult,
} from "@wordless/protocol";

/**
 * The contract every group-robot channel implements.
 *
 * Adding a channel means writing one provider file and registering it in
 * `providers/registry.ts`. The manager, IPC surface, storage and the settings
 * list keep working untouched — that is the property this interface exists to
 * buy, so nothing here may grow a kind-specific branch.
 *
 * Two rules come straight from the reference implementation, both worth keeping:
 *
 *  - No platform SDK or wire detail leaks through this interface. Everything is
 *    expressed in the provider-neutral types declared in `@wordless/domain`.
 *  - `capabilities` is the only place the upper layers may branch on platform
 *    differences. There must be no `kind === "wecom"` outside a provider file;
 *    rate limits, attachment degradation, mention syntax and truncation are all
 *    driven from the capability flags.
 */
export interface WebhookProvider {
  kind: WebhookKind;

  iconClass?: string;

  /** Which credential fields the form must render. Lets WeCom omit the secret. */
  credentialFields: WebhookCredentialFieldSpec[];

  capabilities: WebhookProviderCapabilities;

  /**
   * Schema for this provider's slice of the opaque `options` blob.
   *
   * Validated on save and on load. `options` itself is typed `unknown` on the way
   * in because that is the truth — it comes back from a JSON file — and keeping
   * it opaque is what stops a new channel from changing any shared type.
   */
  optionsSchema: unknown;

  /** Synchronous. Returns a code, never a sentence: the message is translated. */
  validate(input: WebhookValidateInput): WebhookValidationResult;

  /**
   * Sends one message. Never throws and never returns a rejection: a failing
   * webhook must not be able to strand the work that finished.
   */
  send(request: WebhookSendRequest): Promise<WebhookSendResult>;
}

export interface WebhookValidateInput {
  url: string;
  signSecret?: string;
  options: unknown;
}

export interface WebhookSendRequest {
  /** The decrypted credential. Only ever held by the main process. */
  url: string;
  signSecret?: string;
  options: unknown;
  message: WebhookMessage;
}

/** Mirrors the shared credential-field type; named locally so providers stay terse. */
export type WebhookCredentialFieldSpec = WebhookProviderDescriptor["credentialFields"][number];

export type { WebhookEndpointPublic, WebhookKind, WebhookMessage, WebhookOptions };

/** Bumped only for a breaking change to the on-disk shape. */
export const WEBHOOK_CONFIG_VERSION = 1;

/**
 * The on-disk file. `version` is written even though nothing reads it yet, so a
 * future migration does not have to guess whether the field was absent or lost.
 */
export interface WebhookConfigFile {
  version: number;
  endpoints: WebhookEndpointPublic[];
}
