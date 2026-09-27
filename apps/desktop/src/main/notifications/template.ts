import type { NotificationTemplateErrorCode } from "@wordless/domain";
import { byteLength, truncateToLimits, type TextLimits } from "./truncate.ts";

/**
 * Notification templates: validate, render, and fit to a platform budget.
 *
 * Pure, because these are the rules most likely to be wrong and the cheapest to
 * test: what a valid template is, what an unknown variable does, and — the part
 * that matters most — how a long reply is made to fit *without* pushing the rest
 * of the message out of sight.
 */

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

const KNOWN_VARIABLES: ReadonlySet<string> = new Set(["name", "status", "startedAt", "duration", "reply", "error"]);

/**
 * The fallback body.
 *
 * Deliberately free of prose: it is only variables plus blank lines, so it needs
 * no translation and can be assembled by the host with no window open.
 */
export const DEFAULT_NOTIFICATION_TEMPLATE = "{{duration}}\n\n{{reply}}\n\n{{error}}";

export function templateVariables(template: string): string[] {
  return [...template.matchAll(VARIABLE_PATTERN)].map((match) => match[1]);
}

/**
 * Rejects an unusable template at save time.
 *
 * The reference implementation left an unknown variable in the message so the user
 * would notice their typo. Noticing it in a group chat is too late — and it is the
 * whole group that reads it.
 */
export function validateTemplate(template: string): NotificationTemplateErrorCode | undefined {
  if (template.trim() === "") return "template-empty";
  for (const name of templateVariables(template)) {
    if (!KNOWN_VARIABLES.has(name)) return "template-unknown-variable";
  }
  return undefined;
}

export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const replaced = template.replace(VARIABLE_PATTERN, (match, name: string) =>
    KNOWN_VARIABLES.has(name) ? (values[name] ?? "") : match,
  );
  // Variables that resolve to nothing leave their separator behind, so a template
  // with optional parts would otherwise arrive with gaps in it.
  return replaced
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export interface RenderForBudgetResult {
  text: string;
  /** The reply was cut to fit. */
  truncatedReply: boolean;
  /** Even after that, the whole body had to be cut. */
  truncated: boolean;
}

/**
 * Renders a template so that it fits `limits`, giving the reply whatever room is
 * left over.
 *
 * The reply is a variable-length part inside a fixed budget, so a fixed reply
 * length is wrong in both directions: too generous and the reply pushes the status
 * line off the message, too tight and a short status still gets cut. Instead the
 * rest of the template is rendered first and the reply takes the remainder — which
 * also means a user who writes a long template automatically leaves less for the
 * reply, rather than overflowing the platform.
 *
 * `limits` belongs to one *endpoint*: the same event fans out to channels with
 * different ceilings, so this runs per target rather than once.
 */
export function renderForBudget(input: {
  template: string;
  values: Readonly<Record<string, string>>;
  limits: TextLimits;
}): RenderForBudgetResult {
  const { template, values, limits } = input;
  const usesReply = templateVariables(template).includes("reply");

  if (!usesReply) {
    const rendered = truncateToLimits(renderTemplate(template, values), limits);
    return { text: rendered.text, truncatedReply: false, truncated: rendered.truncated };
  }

  // Step 1: measure everything except the reply.
  //
  // Probing with a *one-character* sentinel rather than an empty reply, because an
  // empty reply changes the layout: the blank lines that separate it from the rest
  // are collapsed away, so measuring the empty form under-reports by those bytes and
  // the "fitted" message then overflows. The sentinel keeps the shape.
  const sentinel = "x";
  const probe = renderTemplate(template, { ...values, reply: sentinel });
  const staticBytes = byteLength(probe) - byteLength(sentinel);
  const staticChars = probe.length - sentinel.length;
  const replyLimits: TextLimits = {
    maxBytes: Math.max(0, limits.maxBytes - staticBytes - 1),
    ...(limits.maxChars === undefined
      ? {}
      : { maxChars: Math.max(0, limits.maxChars - staticChars - 1) }),
  };
  const reply = values.reply ?? "";
  const trimmedReply = truncateToLimits(reply, replyLimits);

  // Step 2: render again with what actually fits.
  const rendered = truncateToLimits(renderTemplate(template, { ...values, reply: trimmedReply.text }), limits);
  return {
    text: rendered.text,
    truncatedReply: trimmedReply.truncated,
    truncated: rendered.truncated,
  };
}
