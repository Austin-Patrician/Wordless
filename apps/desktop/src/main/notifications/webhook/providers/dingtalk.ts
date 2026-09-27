import { createHmac } from "node:crypto";
import type { WebhookMessage, WebhookMessageLevel, WebhookSendResult, WebhookValidationResult } from "@wordless/protocol";
import type { WebhookProvider, WebhookSendRequest, WebhookValidateInput } from "../types.ts";
import { byteLength, truncateToLimits } from "../../truncate.ts";

/**
 * DingTalk group-robot webhook.
 *
 * Verified against the official custom-robot guide:
 * https://open.dingtalk.com/document/robots/customize-robot-security-settings
 *
 * Four things here are easy to get wrong:
 *
 *  1. **The signature is the inverse of Feishu's.** The secret is the HMAC *key* and
 *     `timestamp + "\n" + secret` is the signed data; the result is base64,
 *     URL-encoded, and appended to the *URL* (not the body, which is where Feishu
 *     puts it). The timestamp is in **milliseconds** — Feishu uses seconds. Getting
 *     any of that wrong fails verification with a message that reads like a
 *     permission error.
 *  2. **The body limit is in characters**, not bytes (4000). See the capability note.
 *  3. **`markdown.title` is required** and is the text the chat list shows; the
 *     message itself is `markdown.text`.
 *  4. **The keyword security check reads the outgoing text**, so a configured keyword
 *     has to appear in the message; prefixing it to the heading satisfies it.
 */

const HOST = "oapi.dingtalk.com";
const SEND_PATH = "/robot/send";
const HOOK_HINT = `https://${HOST}${SEND_PATH}?access_token=`;
const REQUEST_TIMEOUT_MS = 30_000;
/** The documented limit is 4000 characters; both figures are kept conservative. */
const MAX_TEXT_CHARS = 3_800;
const MAX_TEXT_BYTES = 11_500;
const FALLBACK_TITLE = "Wordless";

interface DingtalkOptions {
  mentionAll?: boolean;
  atMobiles?: string[];
  keyword?: string;
}

function readOptions(raw: unknown): DingtalkOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const mobiles = Array.isArray(source.atMobiles)
    ? source.atMobiles.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  const keyword = typeof source.keyword === "string" && source.keyword.trim() ? source.keyword.trim() : undefined;
  return {
    ...(typeof source.mentionAll === "boolean" ? { mentionAll: source.mentionAll } : {}),
    ...(mobiles && mobiles.length > 0 ? { atMobiles: mobiles } : {}),
    ...(keyword ? { keyword } : {}),
  };
}

function validateUrl(raw: string): WebhookValidationResult {
  const url = raw.trim();
  if (!url) return { ok: false, code: "url-empty" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: "url-bad-format" };
  }
  if (parsed.protocol === "http:") return { ok: false, code: "url-http-not-allowed" };
  if (parsed.protocol !== "https:") return { ok: false, code: "url-not-https" };
  if (parsed.hostname !== HOST) return { ok: false, code: "url-wrong-host", detail: parsed.hostname };
  if (!parsed.pathname.startsWith(SEND_PATH)) return { ok: false, code: "url-wrong-path", detail: parsed.pathname };
  if (!parsed.searchParams.get("access_token")) return { ok: false, code: "url-missing-token" };
  return { ok: true };
}

/**
 * DingTalk's HMAC-SHA256 layout — the **inverse** of Feishu's.
 *
 * The secret is the key, and `timestamp + "\n" + secret` is the signed payload.
 * Feishu is the other way round, which is why both are pinned by a test.
 */
export function dingtalkSign(timestampMs: number, secret: string): string {
  const stringToSign = `${timestampMs}\n${secret}`;
  return encodeURIComponent(createHmac("sha256", secret).update(stringToSign).digest("base64"));
}

/** DingTalk markdown has no colour, so the level is carried by an emoji. */
function levelTag(level: WebhookMessageLevel | undefined): string {
  switch (level) {
    case "success":
      return "✅ ";
    case "warn":
      return "⚠️ ";
    case "error":
      return "❌ ";
    default:
      return "";
  }
}

const emojiLength = (tag: string): number => [...tag].length;

async function send(request: WebhookSendRequest): Promise<WebhookSendResult> {
  const urlCheck = validateUrl(request.url);
  if (!urlCheck.ok) return { ok: false, code: "url-invalid", detail: urlCheck.code };

  const options = readOptions(request.options);
  const tag = levelTag(request.message.level);
  const title = (request.message.title ?? "").trim() || FALLBACK_TITLE;
  // The keyword check inspects what is sent, so prefixing the heading satisfies it
  // without the user having to remember to put their keyword in the template.
  const heading = options.keyword ? `[${options.keyword}] ${tag}${title}` : `${tag}${title}`;
  const atMobiles = options.atMobiles ?? [];
  const tail = atMobiles.length > 0 ? `\n\n${atMobiles.map((mobile) => `@${mobile}`).join(" ")}` : "";

  // There is no card header on this platform, so the heading is part of the body and
  // its bytes come out of the same budget.
  const reserved = byteLength(`#### ${heading}${tail}`) + 2;
  const body = truncateToLimits(request.message.text, {
    maxBytes: Math.max(0, MAX_TEXT_BYTES - reserved),
    maxChars: Math.max(0, MAX_TEXT_CHARS - emojiLength(`#### ${heading}${tail}`) - 2),
  });
  const lines = [`#### ${heading}`];
  if (body.text) lines.push("", body.text);
  if (tail) lines.push(tail.trimStart());

  const payload: Record<string, unknown> = {
    msgtype: "markdown",
    markdown: { title: heading, text: lines.join("\n") },
    at: { isAtAll: Boolean(options.mentionAll), ...(atMobiles.length > 0 ? { atMobiles } : {}) },
  };

  let url = request.url;
  if (request.signSecret) {
    const timestamp = Date.now();
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}timestamp=${timestamp}&sign=${dingtalkSign(timestamp, request.signSecret)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, code: "http-error", detail: `HTTP ${response.status} ${response.statusText}` };

    // 200 with a business code, so `ok` alone is not evidence of delivery.
    const parsed = (await response.json().catch(() => null)) as { errcode?: number; errmsg?: string } | null;
    if (!parsed) return { ok: false, code: "response-unparsable" };
    if (parsed.errcode === 0) return { ok: true, ...(body.truncated ? { degraded: "truncated" } : {}) };
    return { ok: false, code: "platform-rejected", detail: parsed.errmsg ?? `errcode=${parsed.errcode}` };
  } catch (error) {
    if ((error as Error).name === "AbortError") return { ok: false, code: "timeout" };
    return { ok: false, code: "unknown", detail: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export const dingtalkProvider: WebhookProvider = {
  kind: "dingtalk",
  credentialFields: [
    { key: "url", required: true, urlHint: HOOK_HINT, secret: true },
    { key: "signSecret", required: false, secret: true },
  ],
  capabilities: {
    supportsSign: true,
    supportsImage: false,
    supportsFile: false,
    supportsMentionAll: true,
    supportsMentionByMobile: true,
    maxTextBytes: MAX_TEXT_BYTES,
    maxTextChars: MAX_TEXT_CHARS,
    maxTitleBytes: 512,
    // Exceeding it is throttled for ten minutes, so the bus must wait rather than burst.
    maxMessagesPerMinute: 20,
    supportsMarkdown: true,
  },
  optionsSchema: {
    type: "object",
    properties: {
      mentionAll: { type: "boolean" },
      atMobiles: { type: "array", items: { type: "string" } },
      keyword: { type: "string" },
    },
    additionalProperties: false,
  },
  validate: (input: WebhookValidateInput) => validateUrl(input.url),
  send,
};
