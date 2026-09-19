/**
 * Turns whatever the user typed in the address bar into something
 * `webContents.loadURL` accepts.
 *
 * Returns `null` for input we deliberately refuse to navigate to. The panel is
 * the only place in the app that renders untrusted pages, so scheme filtering
 * lives here rather than being left to each caller.
 */

/** Schemes the embedded browser is allowed to load. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "about:", "data:"]);

/** Hosts that read more naturally without a scheme prefix. */
const LOOPBACK_PATTERN = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;

/** Looks like a hostname: has a dot, no spaces, and no scheme. */
const BARE_HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i;

export function normalizeNavigationInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare loopback addresses keep `http` — a local dev server is almost never
  // serving TLS, and upgrading it to https would break the common case.
  if (LOOPBACK_PATTERN.test(trimmed)) return toUrl(`http://${trimmed}`);

  if (BARE_HOST_PATTERN.test(trimmed)) return toUrl(`https://${trimmed}`);

  // Anything with an explicit scheme goes through the allowlist. `file:` is
  // intentionally absent: reading local files from an agent-controlled page is
  // a capability we add deliberately, later, behind session trust.
  const withScheme = toUrl(trimmed);
  if (withScheme) return withScheme;

  // No scheme and not host-shaped — treat it as a search-less relative path is
  // worse than doing nothing, so report refusal.
  return null;
}

function toUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return ALLOWED_SCHEMES.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
