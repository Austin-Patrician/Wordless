import assert from "node:assert/strict";
import test from "node:test";
import type { WebhookEndpointPublic, WebhookKind, WebhookMutationErrorCode, WebhookSendErrorCode, WebhookValidationErrorCode } from "@wordless/protocol";
import {
  UNTOUCHED_DRAFT,
  emptyNotificationDraft,
  firstProviderKind,
  notificationCreateInput,
  notificationDraftFromEndpoint,
  notificationDraftIsDirty,
  notificationFormError,
  notificationUpdatePatch,
  optionsEqual,
  webhookMutationField,
  webhookMutationMessageKey,
  webhookProviderLabelKey,
  webhookSendMessageKey,
  webhookSendWasDegraded,
  webhookValidationField,
} from "../src/renderer/features/settings/notification-form.ts";
import { readOption, withOption } from "../src/renderer/features/settings/webhook-options.ts";

const ENDPOINT: WebhookEndpointPublic = {
  id: "e1",
  kind: "feishu",
  name: "Release group",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  urlMask: "https://open.feishu.cn/…1c2d",
  hasSignSecret: true,
  options: { mentionAll: true },
};

test("a draft for an existing endpoint never fabricates a credential", () => {
  const draft = notificationDraftFromEndpoint(ENDPOINT);
  // The page never received these, so starting them empty is the only honest
  // state — anything else would let a save silently blank what is stored.
  assert.equal(draft.url, "");
  assert.equal(draft.signSecret, "");
  assert.equal(draft.name, "Release group");
  assert.equal(draft.kind, "feishu");
  assert.deepEqual(draft.options, { mentionAll: true });
  // A copy, not the same object: editing options must not mutate the snapshot the
  // list is rendering from.
  assert.notEqual(draft.options, ENDPOINT.options);
});

test("a create payload trims and omits an empty secret", () => {
  const draft = { ...emptyNotificationDraft("feishu"), name: "  Group  ", url: "  https://x.test/hook/a  " };
  assert.deepEqual(notificationCreateInput(draft), {
    kind: "feishu",
    name: "Group",
    url: "https://x.test/hook/a",
    enabled: true,
    options: {},
  });
});

test("an update patch omits untouched fields and clears on an explicit empty string", () => {
  const draft = { ...notificationDraftFromEndpoint(ENDPOINT), name: "Renamed" };

  // Neither credential field was touched, so neither is in the patch — which is
  // what lets the rename save without wiping the stored secret.
  assert.deepEqual(notificationUpdatePatch(draft, UNTOUCHED_DRAFT), {
    name: "Renamed",
    enabled: true,
    options: { mentionAll: true },
  });

  assert.deepEqual(notificationUpdatePatch(draft, { url: true, signSecret: true }), {
    name: "Renamed",
    enabled: true,
    options: { mentionAll: true },
    url: "",
    signSecret: "",
  });

  const typed = { ...draft, url: " https://open.feishu.cn/open-apis/bot/v2/hook/abcdefgh ", signSecret: " s3cret " };
  assert.deepEqual(notificationUpdatePatch(typed, { url: true, signSecret: true }), {
    name: "Renamed",
    enabled: true,
    options: { mentionAll: true },
    url: "https://open.feishu.cn/open-apis/bot/v2/hook/abcdefgh",
    signSecret: "s3cret",
  });
});

test("the local check is limited to what the renderer can know", () => {
  const create = emptyNotificationDraft("feishu");
  // Address *shape* is the provider's business and comes back as a code from the
  // save; only an obviously missing field is caught here.
  assert.equal(notificationFormError(create, { urlRequired: true }), "name");
  assert.equal(notificationFormError({ ...create, name: "G" }, { urlRequired: true }), "url");
  assert.equal(notificationFormError({ ...create, name: "G", url: "nonsense" }, { urlRequired: true }), null);
  // Editing while leaving the address alone is legitimate.
  assert.equal(notificationFormError({ ...create, name: "G" }, { urlRequired: false }), null);
});

test("dirtiness follows the draft and the touched flags", () => {
  const draft = notificationDraftFromEndpoint(ENDPOINT);
  assert.equal(notificationDraftIsDirty(draft, ENDPOINT, UNTOUCHED_DRAFT), false);
  assert.equal(notificationDraftIsDirty({ ...draft, name: "Other" }, ENDPOINT, UNTOUCHED_DRAFT), true);
  assert.equal(notificationDraftIsDirty({ ...draft, enabled: false }, ENDPOINT, UNTOUCHED_DRAFT), true);
  // Typing anything into a credential field counts even if the value is empty.
  assert.equal(notificationDraftIsDirty(draft, ENDPOINT, { url: true, signSecret: false }), true);
  assert.equal(
    notificationDraftIsDirty(notificationDraftFromEndpoint({ ...ENDPOINT, name: "Release group" }), ENDPOINT, UNTOUCHED_DRAFT),
    false,
  );
});

test("structural option comparison ignores key order", () => {
  assert.equal(optionsEqual({}, {}), true);
  assert.equal(optionsEqual({ a: true, b: "x" }, { b: "x", a: true }), true);
  assert.equal(optionsEqual({ a: true }, {}), false);
  assert.equal(optionsEqual({}, { a: false }), false);
});

test("the dirty check is stable across a toggle and settles at rest", () => {
  const endpoint = { ...ENDPOINT, options: {} };
  const draft = notificationDraftFromEndpoint(endpoint);

  const on = { ...draft, options: withOption(draft.options, "mentionAll", true) };
  assert.equal(notificationDraftIsDirty(on, endpoint, UNTOUCHED_DRAFT), true);

  const off = { ...on, options: withOption(on.options, "mentionAll", false) };
  // Back to the stored state, so Save must go quiet again.
  assert.equal(notificationDraftIsDirty(off, endpoint, UNTOUCHED_DRAFT), false);

  // And an endpoint that already has it on is not dirty against itself.
  const enabled = { ...ENDPOINT, options: { mentionAll: true } };
  assert.equal(notificationDraftIsDirty(notificationDraftFromEndpoint(enabled), enabled, UNTOUCHED_DRAFT), false);
});

test("every provider kind has a label", () => {
  const kinds: WebhookKind[] = ["feishu", "dingtalk", "wecom"];
  for (const kind of kinds) {
    assert.ok(webhookProviderLabelKey(kind).startsWith("webhookProvider"), kind);
  }
});

test("every error code maps to a message", () => {
  const validation: WebhookValidationErrorCode[] = [
    "url-empty",
    "url-not-https",
    "url-http-not-allowed",
    "url-bad-format",
    "url-wrong-host",
    "url-wrong-path",
    "url-missing-token",
    "url-token-too-short",
    "sign-secret-required",
    "sign-secret-unexpected",
    "options-invalid",
  ];
  const mutations: WebhookMutationErrorCode[] = [...validation, "endpoint-not-found", "unsupported-kind"];
  for (const code of mutations) assert.notEqual(webhookMutationMessageKey(code), undefined);

  const sends: WebhookSendErrorCode[] = [
    "url-invalid",
    "credentials-missing",
    "timeout",
    "http-error",
    "response-unparsable",
    "platform-rejected",
    "rate-limited",
    "attachment-unsupported",
    "attachment-too-large",
    "attachment-upload-failed",
    "unknown",
  ];
  for (const code of sends) assert.notEqual(webhookSendMessageKey(code), undefined);
});

test("a failure is attributed to the field the user has to fix", () => {
  assert.equal(webhookValidationField("url-wrong-host"), "url");
  assert.equal(webhookValidationField("sign-secret-required"), "signSecret");
  assert.equal(webhookValidationField("options-invalid"), "form");
  // Operational failures belong to the form, not to a credential field.
  assert.equal(webhookMutationField("endpoint-not-found"), "form");
  assert.equal(webhookMutationField("unsupported-kind"), "form");
  assert.equal(webhookMutationField("url-empty"), "url");
});

test("the first provider defaults the create form, and none is handled", () => {
  assert.equal(firstProviderKind([]), null);
  assert.equal(
    firstProviderKind([
      { kind: "feishu", credentialFields: [], capabilities: { supportsSign: true, supportsImage: false, supportsFile: false, supportsMentionAll: true, supportsMentionByMobile: false, maxTextBytes: 1, maxTitleBytes: 1, supportsMarkdown: true } },
    ]),
    "feishu",
  );
});

test("degradation is reported without being treated as a failure", () => {
  assert.equal(webhookSendWasDegraded({ ok: true, degraded: "attachment-dropped" }), true);
  assert.equal(webhookSendWasDegraded({ ok: true }), false);
  assert.equal(webhookSendWasDegraded({ ok: false, code: "timeout" }), false);
});
