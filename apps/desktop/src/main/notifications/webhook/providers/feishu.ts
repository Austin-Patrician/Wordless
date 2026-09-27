import { createHmac } from "node:crypto";
import type { WebhookMessage, WebhookMessageLevel, WebhookSendResult, WebhookValidationResult } from "@wordless/protocol";
import type { WebhookProvider, WebhookSendRequest, WebhookValidateInput } from "../types.ts";
import { byteLength, truncateToLimits } from "../../truncate.ts";

/**
 * Feishu (Lark) group-robot webhook.
 *
 * Verified against the official custom-bot guide:
 * https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 *
 * Three things here are easy to get wrong and silently fail:
 *
 *  1. The signature. Feishu's HMAC layout is the *inverse* of DingTalk's: the key
 *     is `timestamp + "\n" + secret` and the signed data is the empty string.
 *     Using the secret as the key fails verification. The timestamp is in
 *     seconds and both fields go in the request *body*.
 *  2. HTTP 200 does not mean delivered. Feishu answers 200 with a business code
 *     in the body, so the body has to be checked too.
 *  3. `msg_type: "text"` is plain text. Rendering markdown needs an interactive
 *     card, which is also what gets us the level colour for free.
 */

const HOOK_HOST = "open.feishu.cn";
const HOOK_PATH = "/open-apis/bot/v2/hook/";
const HOOK_HINT = `https://${HOOK_HOST}${HOOK_PATH}`;
const REQUEST_TIMEOUT_MS = 30_000;
/** Feishu rejects the whole request body above 20 KB, so the text budget is conservative. */
const MAX_TEXT_BYTES = 12_000;
const MAX_TITLE_BYTES = 512;

interface FeishuOptions {
  mentionAll?: boolean;
}

function readOptions(raw: unknown): FeishuOptions {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const value = (raw as Record<string, unknown>).mentionAll;
  return typeof value === "boolean" ? { mentionAll: value } : {};
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
  if (parsed.protocol === "http:") {
    // Called out separately from "not https": the address is otherwise right, so
    // the user only has to change the scheme.
    return { ok: false, code: "url-http-not-allowed" };
  }
  if (parsed.protocol !== "https:") return { ok: false, code: "url-not-https" };
  if (parsed.hostname !== HOOK_HOST) return { ok: false, code: "url-wrong-host", detail: parsed.hostname };
  if (!parsed.pathname.startsWith(HOOK_PATH)) return { ok: false, code: "url-wrong-path", detail: parsed.pathname };
  const token = parsed.pathname.slice(HOOK_PATH.length);
  if (!token) return { ok: false, code: "url-missing-token" };
  if (token.length < 8) return { ok: false, code: "url-token-too-short" };
  return { ok: true };
}

/**
 * Feishu's HMAC-SHA256 layout. `secret` is part of the *key*, and the signed
 * payload is empty — the reverse of DingTalk's. See the module doc.
 */
export function feishuSign(timestampSeconds: number, secret: string): string {
  return createHmac("sha256", `${timestampSeconds}\n${secret}`).update("").digest("base64");
}

/** Feishu cards have no notion of severity, so the level is carried by colour + emoji. */
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

function levelTemplate(level: WebhookMessageLevel | undefined): string {
  switch (level) {
    case "success":
      return "green";
    case "warn":
      return "orange";
    case "error":
      return "red";
    default:
      return "blue";
  }
}

/**
 * A group robot cannot upload media and the request body is capped at 20 KB, so
 * an attachment cannot be delivered.
 *
 * The note is returned *separately* from the body so it can be appended after
 * truncation. Appending it first — as this did — puts it at the tail, where a
 * long body cuts it off, and the user is left believing a file was delivered
 * that never left the machine.
 */
function attachmentNote(message: WebhookMessage): string | null {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return null;
  return attachments
    .map(
      (attachment) =>
        `⚠️ 无法发送附件：${attachment.name} (${formatBytes(attachment.sizeBytes)})，文件在本机 ${attachment.path}`,
    )
    .join("\n");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildCardPayload(message: WebhookMessage, mentionAll: boolean): Record<string, unknown> {
  const title = (message.title ?? "").trim();
  const tag = levelTag(message.level);
  const headerTitle = title ? `${tag}${title}` : `${tag}消息推送`;
  const text = mentionAll ? `<at id=all></at>\n${message.text}` : message.text;

  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: levelTemplate(message.level),
        title: { tag: "plain_text", content: headerTitle },
      },
      elements: [{ tag: "markdown", content: text }],
    },
  };
}

async function send(request: WebhookSendRequest): Promise<WebhookSendResult> {
  // Defensive: creation already validated, but a config file may predate a rule.
  const urlCheck = validateUrl(request.url);
  if (!urlCheck.ok) return { ok: false, code: "url-invalid", detail: urlCheck.code };

  const note = attachmentNote(request.message);
  // The note is reserved out of the budget *before* the body is trimmed, so a long
  // body cannot push the warning off the end. This mirrors Feishu's own limit,
  // which is on the whole request body rather than on the text alone.
  const noteReserve = note ? byteLength(note) + 2 : 0;
  const trimmed = truncateToLimits(request.message.text, { maxBytes: MAX_TEXT_BYTES - noteReserve });
  const title = request.message.title
    ? truncateToLimits(request.message.title, { maxBytes: MAX_TITLE_BYTES }).text
    : undefined;
  const text = note ? `${trimmed.text}\n\n${note}` : trimmed.text;
  const payload = buildCardPayload(
    { ...request.message, text, ...(title ? { title } : {}) },
    Boolean(readOptions(request.options).mentionAll),
  );

  if (request.signSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    payload.timestamp = String(timestamp);
    payload.sign = feishuSign(timestamp, request.signSecret);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { ok: false, code: "http-error", detail: `HTTP ${response.status} ${response.statusText}` };
    }

    // Feishu answers 200 with a business code in the body, so `ok` alone is not
    // evidence of delivery.
    const body = (await response.json().catch(() => null)) as {
      code?: number;
      StatusCode?: number;
      msg?: string;
      StatusMessage?: string;
    } | null;
    if (!body) return { ok: false, code: "response-unparsable" };
    const code = body.code ?? body.StatusCode;
    if (code === 0) {
      return {
        ok: true,
        ...(note || trimmed.truncated ? { degraded: note ? "attachment-dropped" : "truncated" } : {}),
      };
    }
    return { ok: false, code: "platform-rejected", detail: body.msg ?? body.StatusMessage ?? `code=${code}` };
  } catch (error) {
    if ((error as Error).name === "AbortError") return { ok: false, code: "timeout" };
    return { ok: false, code: "unknown", detail: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export const feishuProvider: WebhookProvider = {
  kind: "feishu",
  credentialFields: [
    { key: "url", required: true, urlHint: HOOK_HINT, secret: true },
    { key: "signSecret", required: false, secret: true },
  ],
  capabilities: {
    supportsSign: true,
    supportsImage: false,
    supportsFile: false,
    supportsMentionAll: true,
    supportsMentionByMobile: false,
    maxTextBytes: MAX_TEXT_BYTES,
    // No character ceiling: Feishu's limit is on the request body, in bytes.
    maxTitleBytes: MAX_TITLE_BYTES,
    maxMessagesPerMinute: 100,
    supportsMarkdown: true,
  },
  optionsSchema: { type: "object", properties: { mentionAll: { type: "boolean" } }, additionalProperties: false },
  validate: (input: WebhookValidateInput) => validateUrl(input.url),
  send,
};
