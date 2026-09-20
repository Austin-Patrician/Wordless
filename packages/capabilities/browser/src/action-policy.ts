/**
 * Who the agent may act on.
 *
 * Acting on a page is the phase with a real security surface, so the policy is
 * deliberately narrower than reading. Two independent conditions must hold, and
 * both are decided here in pure code so the rules can be tested rather than
 * inferred from a chain of guards:
 *
 * 1. **The user shared the tab.** Same gate as reading; acting never widens it.
 * 2. **The origin is allowed.** Loopback is allowed without a further step, because
 *    verifying the UI the agent just wrote is what this feature is for and a dev
 *    server is the common case. Every other origin needs the user to grant it
 *    explicitly, and the grant is checked against the origin the page is on *now* —
 *    so following a link to somewhere else does not inherit the permission.
 *
 *    Hostname, not resolved address: a hostile domain that points at 127.0.0.1 is
 *    still `evil.com` here, which is what makes the loopback test survive DNS
 *    rebinding.
 */

export type ActDenial =
  | { code: "not_shared"; message: string }
  | { code: "origin_not_allowed"; message: string; origin: string | null; loopbackDefault: boolean }
  | { code: "rate_limited"; message: string; retryAfterMs: number };

/** Hosts treated as loopback. `0.0.0.0` is included because dev servers bind it. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/** Hosts whose subdomains are also loopback, e.g. `app.localhost`. */
const LOOPBACK_SUFFIXES = [".localhost", ".127.0.0.1"];

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? null : parsed.origin;
  } catch {
    return null;
  }
}

export function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return LOOPBACK_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Decisions per tab inside a sliding window.
 *
 * Acting is the one capability that can run away on its own: a page that reloads
 * its own markup after every click turns a small task into an unbounded loop of
 * real requests. The limit is a backstop, not a workflow — it exists so a stuck
 * agent stops instead of spending the user's tokens and hammering their server.
 */
export const ACTION_WINDOW_MS = 60_000;
export const ACTION_LIMIT_PER_WINDOW = 60;

/**
 * Prunes the action history and decides whether another action may run.
 *
 * Timestamps are supplied by the caller so this stays pure.
 */
export function checkActionBudget(
  history: readonly number[],
  now: number,
  options: { windowMs?: number; limit?: number } = {},
): { allowed: boolean; retryAfterMs: number; history: number[] } {
  const windowMs = options.windowMs ?? ACTION_WINDOW_MS;
  const limit = options.limit ?? ACTION_LIMIT_PER_WINDOW;
  const recent = history.filter((at) => now - at < windowMs);
  if (recent.length < limit) return { allowed: true, retryAfterMs: 0, history: recent };
  // The oldest action inside the window is the one that has to age out first.
  const oldest = Math.min(...recent);
  return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)), history: recent };
}

/**
 * Whether an action may run against this URL.
 *
 * Loopback is allowed outright; anything else has to be in the origins the user
 * approved. Both are compared as origins, so a permission granted for
 * `https://app.example.com` does not travel to another host on navigation.
 */
export function isActionableUrl(url: string, allowedOrigins: readonly string[] = []): boolean {
  if (isLoopbackUrl(url)) return true;
  const origin = originOf(url);
  return origin !== null && allowedOrigins.includes(origin);
}

/**
 * Full gate for an action, in one place so no call path can skip a check.
 *
 * Order matters for the message the agent receives: an unshared tab and an
 * unapproved origin are both things the *user* can fix, so those messages must say
 * so rather than read as a permanent limit; rate limiting is temporary and the
 * agent should stop rather than retry.
 */
export function evaluateActRequest(input: {
  shared: boolean;
  url: string;
  /** Origins the user approved for actions this session. */
  allowedOrigins?: readonly string[];
  history: readonly number[];
  now: number;
  windowMs?: number;
  limit?: number;
}): { allowed: true; history: number[] } | { allowed: false; denial: ActDenial } {
  if (!input.shared) {
    return {
      allowed: false,
      denial: {
        code: "not_shared",
        message: "The user has not shared this tab with you. Ask them to turn on sharing for the page in the browser panel.",
      },
    };
  }
  const origin = originOf(input.url);
  if (!isActionableUrl(input.url, input.allowedOrigins ?? [])) {
    return {
      allowed: false,
      denial: {
        code: "origin_not_allowed",
        message: origin
          ? `Clicking and typing are not enabled for ${origin}. Ask the user to turn on "Allow actions" for this site in the browser panel, then try again. Reading the page needs no permission.`
          : "The page has no usable address, so it cannot be acted on.",
        origin,
        loopbackDefault: false,
      },
    };
  }
  const budget = checkActionBudget(input.history, input.now, { windowMs: input.windowMs, limit: input.limit });
  if (!budget.allowed) {
    return {
      allowed: false,
      denial: {
        code: "rate_limited",
        message: `Too many browser actions in a short period (${budget.retryAfterMs}ms until the window clears). Stop and report what you have so far.`,
        retryAfterMs: budget.retryAfterMs,
      },
    };
  }
  return { allowed: true, history: budget.history };
}
