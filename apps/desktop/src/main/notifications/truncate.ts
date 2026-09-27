/**
 * Byte- and character-aware truncation, shared by the message-push providers and
 * the desktop-notification title.
 *
 * It lives in its own module because the platforms limit the body in *different
 * units*, and two copies of that logic would drift:
 *
 *   Feishu          request body ≤ 20 KB   → bytes (whole JSON body)
 *   WeCom           markdown    ≤ 4096     → bytes
 *   DingTalk        body        ≤ 4000     → characters
 *
 * A single byte cap is wrong for DingTalk in both directions: 4000 Chinese
 * characters is 12000 bytes (a 4000-byte cap would throw away two thirds of what
 * the platform allows), while a 12000-byte cap lets pure ASCII reach 12000
 * characters and get rejected. So both caps are applied and whichever binds first
 * wins.
 */

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export interface TextLimits {
  /** Always set: every platform has a byte ceiling, even if it is expressed as a body size. */
  maxBytes: number;
  /** Only when the platform documents its limit in characters. */
  maxChars?: number;
}

/**
 * Trims on a character boundary while respecting both ceilings.
 *
 * The ellipsis is reserved out of the budget rather than appended afterwards:
 * adding it on top pushed a full-budget body three bytes over the platform limit,
 * which is the kind of off-by-a-few that gets a message rejected after it was
 * already reported as sent.
 *
 * `String.length` counts UTF-16 units, so an emoji counts as two characters. That
 * is stricter than a code-point count, which is the safe direction: we may cut
 * one character early, never one late.
 */
export function truncateToLimits(value: string, limits: TextLimits): { text: string; truncated: boolean } {
  const withinChars = limits.maxChars === undefined || value.length <= limits.maxChars;
  if (byteLength(value) <= limits.maxBytes && withinChars) return { text: value, truncated: false };

  const ellipsis = "…";
  const byteBudget = limits.maxBytes - byteLength(ellipsis);
  const charBudget = limits.maxChars === undefined ? Number.POSITIVE_INFINITY : limits.maxChars - ellipsis.length;

  let end = value.length;
  if (Number.isFinite(charBudget)) end = Math.min(end, Math.max(0, charBudget));
  // Walk back to the last character that fits the byte budget. Single pass: the
  // character budget has already bounded the other end.
  while (end > 0 && byteLength(value.slice(0, end)) > byteBudget) end -= 1;

  return { text: `${value.slice(0, end)}${ellipsis}`, truncated: true };
}

/**
 * How many bytes are left for a variable-length part (a reply) once the rest of
 * the message is accounted for.
 *
 * Derived rather than a fixed constant: the budget depends on the endpoint's
 * platform *and* on how much room the user's own template already spends. A
 * hard-coded reply length either wastes the platform's allowance or overflows it.
 */
export function remainingBytes(limits: TextLimits, staticPart: string): number {
  // One byte is reserved for the ellipsis that may replace the excess.
  return Math.max(0, limits.maxBytes - byteLength(staticPart) - 1);
}

/** Same idea in characters, for platforms that cap by character. */
export function remainingChars(limits: TextLimits, staticPart: string): number {
  if (limits.maxChars === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, limits.maxChars - staticPart.length - 1);
}
