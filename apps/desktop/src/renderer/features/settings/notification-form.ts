import type {
  WebhookEndpointPublic,
  WebhookKind,
  WebhookMutationErrorCode,
  WebhookMutationResult,
  WebhookOptions,
  WebhookProviderDescriptor,
  WebhookSendErrorCode,
  WebhookSendResult,
  WebhookValidationErrorCode,
} from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";

/**
 * Form state for the message-push page, kept apart from the component so the
 * parts that can be wrong are testable.
 *
 * The page never receives a webhook URL or a sign secret — only a mask and a
 * boolean. So a draft starts with both fields empty and the caller tracks whether
 * the user touched them; omitting an untouched field is the only way to save an
 * unrelated change without wiping the stored credential.
 */
export type NotificationDraft = {
  kind: WebhookKind;
  name: string;
  /** Empty when editing until the user types a replacement. */
  url: string;
  signSecret: string;
  enabled: boolean;
  options: Record<string, unknown>;
};

export type NotificationDraftTouched = {
  url: boolean;
  signSecret: boolean;
};

export const UNTOUCHED_DRAFT: NotificationDraftTouched = { url: false, signSecret: false };

/**
 * What the editor is working on.
 *
 * A draft plus which credential fields the user has touched, and — when editing —
 * the id needed to save and the mask to show in place of the stored address.
 */
export type NotificationEditorState =
  | { mode: "create"; draft: NotificationDraft; touched: NotificationDraftTouched }
  | { mode: "edit"; id: string; draft: NotificationDraft; touched: NotificationDraftTouched; urlMask?: string };

/** A new endpoint. The kind defaults to whatever the provider list offers first. */
export function emptyNotificationDraft(kind: WebhookKind): NotificationDraft {
  return { kind, name: "", url: "", signSecret: "", enabled: true, options: {} };
}

/**
 * A draft for an existing endpoint.
 *
 * `url` and `signSecret` are empty on purpose: the values are not available here,
 * so pretending otherwise would let a save silently blank them.
 */
export function notificationDraftFromEndpoint(endpoint: WebhookEndpointPublic): NotificationDraft {
  return {
    kind: endpoint.kind,
    name: endpoint.name,
    url: "",
    signSecret: "",
    enabled: endpoint.enabled,
    options: { ...endpoint.options },
  };
}

/**
 * The payload for creating.
 *
 * `nextSequence` is not needed: a new endpoint has no stored credential, so both
 * values are simply sent as typed.
 */
export function notificationCreateInput(draft: NotificationDraft) {
  const signSecret = draft.signSecret.trim();
  return {
    kind: draft.kind,
    name: draft.name.trim(),
    url: draft.url.trim(),
    ...(signSecret ? { signSecret } : {}),
    enabled: draft.enabled,
    options: draft.options,
  };
}

/**
 * The patch for saving an existing endpoint.
 *
 * An untouched field is omitted so the host keeps it; a touched-and-blank field
 * is sent as an explicit empty string, which is how the user clears a secret.
 * That distinction is the whole reason `touched` exists.
 */
export function notificationUpdatePatch(draft: NotificationDraft, touched: NotificationDraftTouched) {
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    options: draft.options,
    ...(touched.url ? { url: draft.url.trim() } : {}),
    ...(touched.signSecret ? { signSecret: draft.signSecret.trim() } : {}),
  };
}

/**
 * Local pre-check, limited to what the renderer can actually know.
 *
 * Address *shape* is the provider's business — it lives in the main process and
 * its typed code comes back from the save. Catching an empty required field here
 * just avoids a pointless round trip.
 */
export function notificationFormError(
  draft: NotificationDraft,
  options: { urlRequired: boolean },
): "name" | "url" | null {
  if (draft.name.trim() === "") return "name";
  if (options.urlRequired && draft.url.trim() === "") return "url";
  return null;
}

/**
 * Structural comparison, independent of key order.
 *
 * Only one option exists today, so `JSON.stringify` would happen to work — but it
 * would start reporting false differences the moment a second provider adds a
 * second key, and that kind of bug reads as "Save does nothing".
 */
export function optionsEqual(left: WebhookOptions, right: WebhookOptions): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

/** Whether anything in the draft differs from what is stored. */
export function notificationDraftIsDirty(
  draft: NotificationDraft,
  endpoint: WebhookEndpointPublic,
  touched: NotificationDraftTouched,
): boolean {
  if (touched.url || touched.signSecret) return true;
  return (
    draft.name.trim() !== endpoint.name ||
    draft.enabled !== endpoint.enabled ||
    !optionsEqual(draft.options, endpoint.options)
  );
}

/**
 * Labels live here rather than on the descriptor sent from the main process.
 *
 * A label crossing the wire would be an i18n key held as a plain string, which
 * nothing can check; this map is exhaustive over `WebhookKind`, so adding a
 * channel fails to compile until it has a label in both languages.
 */
const PROVIDER_KEYS: Record<WebhookKind, MessageKey> = {
  feishu: "webhookProviderFeishu",
  dingtalk: "webhookProviderDingtalk",
  wecom: "webhookProviderWecom",
};

export function webhookProviderLabelKey(kind: WebhookKind): MessageKey {
  return PROVIDER_KEYS[kind];
}

/**
 * Every validation code maps to a message. `Record` over the union means a new
 * code cannot ship without wording.
 */
const VALIDATION_KEYS: Record<WebhookValidationErrorCode, MessageKey> = {
  "url-empty": "webhookErrorUrlEmpty",
  "url-not-https": "webhookErrorUrlNotHttps",
  "url-http-not-allowed": "webhookErrorUrlHttpNotAllowed",
  "url-bad-format": "webhookErrorUrlBadFormat",
  "url-wrong-host": "webhookErrorUrlWrongHost",
  "url-wrong-path": "webhookErrorUrlWrongPath",
  "url-missing-token": "webhookErrorUrlMissingToken",
  "url-token-too-short": "webhookErrorUrlTokenTooShort",
  "sign-secret-required": "webhookErrorSignSecretRequired",
  "sign-secret-unexpected": "webhookErrorSignSecretUnexpected",
  "options-invalid": "webhookErrorOptionsInvalid",
};

/**
 * Covers validation *and* the operational failures, which are not validation
 * problems — a missing row or an unsupported channel still has to say something.
 */
const MUTATION_KEYS: Record<WebhookMutationErrorCode, MessageKey> = {
  ...VALIDATION_KEYS,
  "endpoint-not-found": "webhookErrorEndpointNotFound",
  "unsupported-kind": "webhookErrorUnsupportedKind",
};

export function webhookMutationMessageKey(code: WebhookMutationErrorCode): MessageKey {
  return MUTATION_KEYS[code];
}

const SEND_KEYS: Record<WebhookSendErrorCode, MessageKey> = {
  "url-invalid": "webhookSendErrorUrlInvalid",
  "credentials-missing": "webhookSendErrorCredentialsMissing",
  timeout: "webhookSendErrorTimeout",
  "http-error": "webhookSendErrorHttpError",
  "response-unparsable": "webhookSendErrorResponseUnparsable",
  "platform-rejected": "webhookSendErrorPlatformRejected",
  "rate-limited": "webhookSendErrorRateLimited",
  "attachment-unsupported": "webhookSendErrorAttachmentUnsupported",
  "attachment-too-large": "webhookSendErrorAttachmentTooLarge",
  "attachment-upload-failed": "webhookSendErrorAttachmentUploadFailed",
  unknown: "webhookSendErrorUnknown",
};

export function webhookSendMessageKey(code: WebhookSendErrorCode): MessageKey {
  return SEND_KEYS[code];
}

/** Which field a validation failure belongs under, so the page can point at it. */
export function webhookMutationField(code: WebhookMutationErrorCode): "url" | "signSecret" | "form" {
  if (code === "endpoint-not-found" || code === "unsupported-kind") return "form";
  return webhookValidationField(code);
}

export function webhookValidationField(code: WebhookValidationErrorCode): "url" | "signSecret" | "form" {
  if (code === "sign-secret-required" || code === "sign-secret-unexpected") return "signSecret";
  if (code.startsWith("url-")) return "url";
  return "form";
}

/** The first endpoint matching a kind, used to default the create form. */
export function firstProviderKind(providers: WebhookProviderDescriptor[]): WebhookKind | null {
  return providers.length > 0 ? providers[0].kind : null;
}

/** True when a result reports the message arrived but something was left out. */
export function webhookSendWasDegraded(result: WebhookSendResult): boolean {
  return result.ok && result.degraded !== undefined;
}
