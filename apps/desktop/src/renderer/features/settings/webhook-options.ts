import type { WebhookKind, WebhookOptions, WebhookProviderCapabilities } from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";

/**
 * The per-channel options form, declared in one typed table.
 *
 * Why here and not on the descriptor sent from the main process: a label crossing
 * the wire would be an i18n key held as a plain string, and nothing can check a
 * string. `Record<WebhookKind, …>` is exhaustive, so a new channel fails to compile
 * until its options are declared, and every label is a `MessageKey` the i18n table
 * is checked against.
 *
 * Every helper that reads or writes the `options` blob lives here, boolean included —
 * splitting "the option value model" across two modules is what makes a reader look
 * in the wrong file for `readOption`.
 *
 * The main process still owns the *shape*: each provider declares an
 * `optionsSchema`, and `validateProviderOptions` enforces it on save. This table
 * must therefore declare exactly the keys that schema allows — a key here that the
 * schema forbids is rejected on save, and a key there that is missing here is
 * unreachable. `webhook-options.test.ts` asserts the two agree for every channel,
 * which is what keeps the split honest.
 */

/** A capability flag that can hide an option. */
export type WebhookOptionCapability = keyof WebhookProviderCapabilities;

type WebhookOptionFieldBase = {
  /** The key inside the endpoint's opaque `options` blob. */
  key: string;
  labelKey: MessageKey;
  helpKey: MessageKey;
  /**
   * Hidden when the channel lacks the capability.
   *
   * Optional: most options are simply a property of the channel that declares them,
   * and inventing a capability flag for each one would be motion without meaning.
   */
  capability?: WebhookOptionCapability;
};

export type WebhookOptionField =
  | (WebhookOptionFieldBase & { control: "toggle" })
  | (WebhookOptionFieldBase & { control: "text"; placeholderKey: MessageKey })
  | (WebhookOptionFieldBase & { control: "list"; placeholderKey: MessageKey });

/**
 * Order is the order they appear in the form. For DingTalk the keyword comes first
 * on purpose: it is the one option whose absence silently breaks *every* send, and
 * it is the one the platform's own security setting demands.
 */
const OPTION_FIELDS: Record<WebhookKind, readonly WebhookOptionField[]> = {
  feishu: [
    {
      control: "toggle",
      key: "mentionAll",
      capability: "supportsMentionAll",
      labelKey: "webhookOptionMentionAll",
      helpKey: "webhookOptionMentionAllHelp",
    },
  ],
  dingtalk: [
    {
      control: "text",
      key: "keyword",
      labelKey: "webhookOptionKeyword",
      helpKey: "webhookOptionKeywordHelp",
      placeholderKey: "webhookOptionKeywordPlaceholder",
    },
    {
      control: "list",
      key: "atMobiles",
      capability: "supportsMentionByMobile",
      labelKey: "webhookOptionAtMobiles",
      helpKey: "webhookOptionAtMobilesHelp",
      placeholderKey: "webhookOptionAtMobilesPlaceholder",
    },
    {
      control: "toggle",
      key: "mentionAll",
      capability: "supportsMentionAll",
      labelKey: "webhookOptionMentionAll",
      helpKey: "webhookOptionMentionAllHelp",
    },
  ],
  wecom: [
    {
      control: "toggle",
      key: "useMarkdownV2",
      labelKey: "webhookOptionUseMarkdownV2",
      helpKey: "webhookOptionUseMarkdownV2Help",
    },
  ],
};

/** The fields to render for a channel, with capability-gated ones filtered out. */
export function webhookOptionFields(
  kind: WebhookKind,
  capabilities?: WebhookProviderCapabilities,
): WebhookOptionField[] {
  return OPTION_FIELDS[kind].filter(
    (field) => field.capability === undefined || capabilities?.[field.capability] === true,
  );
}

/** Every key a channel's form can write. Used by the schema agreement test. */
export function webhookOptionKeys(kind: WebhookKind): string[] {
  return OPTION_FIELDS[kind].map((field) => field.key);
}

/**
 * Reads a boolean option.
 *
 * "Absent" is the single representation of "off": nothing ever stores an explicit
 * `false`. Keeping one representation is what stops the form from reporting itself
 * dirty after the user toggles an option on and back off, which would leave Save
 * enabled with nothing to save.
 */
export function readOption(options: WebhookOptions, key: string): boolean {
  return options[key] === true;
}

export function withOption(options: WebhookOptions, key: string, enabled: boolean): WebhookOptions {
  const next = { ...options };
  if (enabled) next[key] = true;
  else delete next[key];
  return next;
}

/**
 * Reads a text option.
 *
 * A value of the wrong type reads as empty rather than being shown: the config file
 * is editable by hand, and `[object Object]` in a text box would be a worse answer
 * than an empty one.
 */
export function readTextOption(options: WebhookOptions, key: string): string {
  const value = options[key];
  return typeof value === "string" ? value : "";
}

/** Blank clears the key. Nothing ever stores an empty string — see `withOption`. */
export function withTextOption(options: WebhookOptions, key: string, value: string): WebhookOptions {
  const next = { ...options };
  const text = value.trim();
  if (text === "") delete next[key];
  else next[key] = text;
  return next;
}

export function readListOption(options: WebhookOptions, key: string): string[] {
  const value = options[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** An empty list clears the key, matching `withTextOption` and `withOption`. */
export function withListOption(options: WebhookOptions, key: string, values: string[]): WebhookOptions {
  const next = { ...options };
  if (values.length === 0) delete next[key];
  else next[key] = values;
  return next;
}

/**
 * Splits what the user typed into a list.
 *
 * Everything that could plausibly separate two entries is accepted, because the
 * input is a single text box and the user will reach for whichever one their IME
 * produces: ASCII and full-width commas, the CJK enumeration comma, semicolons, and
 * any whitespace. Duplicates collapse — sending the same number twice would make the
 * platform mention it twice.
 *
 * No shape judgement is made here. A value that is not a phone number is the
 * platform's to reject, and guessing at format rules would silently drop input.
 */
const LIST_SEPARATOR = /[,，、;；\s]+/;

export function parseListOption(text: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of text.split(LIST_SEPARATOR)) {
    const value = entry.trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function formatListOption(values: string[]): string {
  return values.join(", ");
}

/**
 * Whether the text in the box already accounts for the stored value.
 *
 * The list control keeps the raw text so a trailing separator survives while the
 * user is still typing — parsing and re-formatting on every keystroke would eat it
 * and make a second number impossible to enter. That means the control has to tell
 * an external change (a channel switch, which clears options) from its own echo, and
 * this is that test: an incoming value the current text parses to is our own echo.
 */
export function listOptionTextIsCurrent(text: string, incoming: string): boolean {
  return formatListOption(parseListOption(text)) === incoming;
}
