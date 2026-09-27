import type { WebhookMessageLevel, WebhookSendResult, WebhookValidationResult } from "@wordless/protocol";
import type { WebhookProvider, WebhookSendRequest, WebhookValidateInput } from "../types.ts";
import { byteLength, truncateToLimits } from "../../truncate.ts";

/**
 * WeCom (企业微信) group-robot webhook.
 *
 * Verified against the official message-push reference:
 * https://developer.work.weixin.qq.com/document/path/91770
 *
 * Three things differ from the other two channels:
 *
 *  1. **There is no request signature.** The webhook URL carries a `key` and that is
 *     the whole of the authority, so the URL is treated as a credential and the
 *     provider declares no `signSecret` field at all. Leaking it is leaking the
 *     ability to post in that group, permanently.
 *  2. **`mentionAll` is not supported.** Only the `text` message type has
 *     `mentioned_list` / `mentioned_mobile_list` (the latter takes `"@all"`); the
 *     `markdown` type's schema is `msgtype` + `content` and nothing else. `markdown_v2`
 *     drops the mention syntax entirely. So a WeCom notification cannot @everyone
 *     unless the whole message gives up markdown, which is not a trade worth making
 *     for a body that is mostly a readable summary.
 *  3. **The limit is 4096 bytes** (not characters), so no `maxTextChars`.
 *
 * One option exists: `useMarkdownV2`. `markdown_v2` adds tables and a few other
 * constructs, and it is a strict superset for our purposes — **the byte ceiling is the
 * same 4096**, and it drops the `<@userid>` syntax we do not use anyway. The cost is
 * entirely on the client side: below 4.1.36 (Android 4.1.38) the message renders as
 * plain text, so this is opt-in rather than the default.
 */

const HOST = "qyapi.weixin.qq.com";
const SEND_PATH = "/cgi-bin/webhook/send";
const HOOK_HINT = `https://${HOST}${SEND_PATH}?key=`;
const REQUEST_TIMEOUT_MS = 30_000;
/** Documented at 4096 bytes; the margin covers the heading this provider prepends. */
const MAX_TEXT_BYTES = 3_800;
const FALLBACK_TITLE = "Wordless";

interface WecomOptions {
  useMarkdownV2?: boolean;
}

function readOptions(raw: unknown): WecomOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const value = (raw as Record<string, unknown>).useMarkdownV2;
  return typeof value === "boolean" ? { useMarkdownV2: value } : {};
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
  const key = parsed.searchParams.get("key");
  if (!key) return { ok: false, code: "url-missing-token" };
  if (key.length < 8) return { ok: false, code: "url-token-too-short" };
  return { ok: true };
}

/** WeCom markdown has no card and no colour for headings, so the level is an emoji. */
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

async function send(request: WebhookSendRequest): Promise<WebhookSendResult> {
  const urlCheck = validateUrl(request.url);
  if (!urlCheck.ok) return { ok: false, code: "url-invalid", detail: urlCheck.code };

  const title = (request.message.title ?? "").trim() || FALLBACK_TITLE;
  const heading = `#### ${levelTag(request.message.level)}${title}`;
  // No card header here either, so the heading shares the body's budget.
  const body = truncateToLimits(request.message.text, {
    maxBytes: Math.max(0, MAX_TEXT_BYTES - byteLength(heading) - 2),
  });
  const content = body.text ? `${heading}\n\n${body.text}` : heading;

  // The two message types carry the same content under a different key, and the
  // documented ceiling is the same, so only the envelope changes.
  const payload = readOptions(request.options).useMarkdownV2
    ? { msgtype: "markdown_v2", markdown_v2: { content } }
    : { msgtype: "markdown", markdown: { content } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, code: "http-error", detail: `HTTP ${response.status} ${response.statusText}` };

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

export const wecomProvider: WebhookProvider = {
  kind: "wecom",
  // No `signSecret`: this platform has no signature, and offering a field that does
  // nothing would suggest a safety net that is not there.
  credentialFields: [{ key: "url", required: true, urlHint: HOOK_HINT, secret: true }],
  capabilities: {
    supportsSign: false,
    supportsImage: false,
    supportsFile: false,
    // See the module note: markdown cannot mention anyone, and the message type that
    // can is plain text only.
    supportsMentionAll: false,
    supportsMentionByMobile: false,
    maxTextBytes: MAX_TEXT_BYTES,
    maxTitleBytes: 512,
    maxMessagesPerMinute: 20,
    supportsMarkdown: true,
  },
  optionsSchema: {
    type: "object",
    properties: { useMarkdownV2: { type: "boolean" } },
    additionalProperties: false,
  },
  validate: (input: WebhookValidateInput) => validateUrl(input.url),
  send,
};
