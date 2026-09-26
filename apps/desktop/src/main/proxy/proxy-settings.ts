import type {
  DesktopProxyConfig,
  DesktopProxyConfigPatch,
  DesktopProxyConfigSnapshot,
  DesktopProxyProtocol,
} from "@wordless/protocol";

/**
 * Normalisation, validation, redaction and patch merging for the application
 * proxy. Pure: no I/O, so every rule below is testable without a network or an
 * Electron runtime.
 *
 * The password is treated like an API key. It can be used to reach the user's
 * own network, so it is never handed to the renderer: reads replace it with a
 * `passwordConfigured` flag, and writes that omit it keep the stored one. Both
 * halves are required — with only the first, every save would have to send the
 * plaintext back down to the renderer.
 */

export const PROXY_PROTOCOLS: readonly DesktopProxyProtocol[] = ["http", "https"];

export const DEFAULT_PROXY_CONFIG: DesktopProxyConfig = {
  enabled: false,
  protocol: "http",
  host: "",
  port: 7890,
  username: "",
  password: "",
};

export type ProxyValidation =
  | { ok: true; target: string; url: string }
  | { ok: false; reason: "disabled" | "bad-host" | "bad-port" };

export function isProxyProtocol(value: unknown): value is DesktopProxyProtocol {
  return typeof value === "string" && (PROXY_PROTOCOLS as readonly string[]).includes(value);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/**
 * Ports are carried through unchanged, including out-of-range values.
 *
 * Clamping here would turn "you typed the wrong port" into "you are connected to
 * a different port", which is strictly worse than reporting it: validation is
 * `resolveProxyConfig`'s job, and the settings page shows what it says.
 */
function asPort(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeProxyConfig(value: unknown): DesktopProxyConfig {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_PROXY_CONFIG };
  const input = value as Record<string, unknown>;
  return {
    enabled: input.enabled === true,
    protocol: isProxyProtocol(input.protocol) ? input.protocol : DEFAULT_PROXY_CONFIG.protocol,
    host: asString(input.host, DEFAULT_PROXY_CONFIG.host),
    port: asPort(input.port, DEFAULT_PROXY_CONFIG.port),
    username: asString(input.username, DEFAULT_PROXY_CONFIG.username),
    // The password is deliberately not trimmed: surrounding spaces may be part
    // of it, and the user cannot see them in a masked field.
    password: typeof input.password === "string" ? input.password : DEFAULT_PROXY_CONFIG.password,
  };
}

export function redactProxyConfig(config: DesktopProxyConfig | undefined): DesktopProxyConfigSnapshot {
  const resolved = config ?? DEFAULT_PROXY_CONFIG;
  const { password, ...rest } = resolved;
  return { ...rest, passwordConfigured: password.length > 0 };
}

/** Merge a renderer patch; an absent `password` keeps the stored one. */
export function mergeProxyConfigPatch(current: DesktopProxyConfig | undefined, patch: unknown): DesktopProxyConfig {
  const base = current ?? DEFAULT_PROXY_CONFIG;
  if (typeof patch !== "object" || patch === null) return { ...base };
  const input = patch as DesktopProxyConfigPatch & Record<string, unknown>;
  return normalizeProxyConfig({
    ...base,
    ...input,
    password: typeof input.password === "string" ? input.password : base.password,
  });
}

/**
 * Hosts that cannot be part of a proxy endpoint.
 *
 * Whitespace and the URL delimiters would either produce an unparsable URL or
 * let a typed value smuggle in credentials or a port of its own — the same
 * characters are rejected regardless of which one it turns out to be.
 */
const INVALID_HOST_CHARACTERS = /[\s/\\@#?%]/;

export function isValidProxyHost(host: string): boolean {
  return host.length > 0 && !INVALID_HOST_CHARACTERS.test(host);
}

export function isValidProxyPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

/** `host:port`, never with credentials. Safe to log and to show in the UI. */
export function proxyTarget(config: DesktopProxyConfig): string {
  return `${config.host}:${config.port}`;
}

/**
 * The single place that decides whether a config can actually be used, and
 * what URL it resolves to.
 *
 * A disabled config is not a failure — the caller treats it as "go direct".
 * Everything else that comes back `ok: false` means the user asked for a proxy
 * that cannot work, which is a state the UI must state plainly rather than
 * letting it surface as unrelated-looking request failures.
 */
export function resolveProxyConfig(config: DesktopProxyConfig | undefined): ProxyValidation {
  if (!config || !config.enabled) return { ok: false, reason: "disabled" };
  if (!isValidProxyHost(config.host)) return { ok: false, reason: "bad-host" };
  if (!isValidProxyPort(config.port)) return { ok: false, reason: "bad-port" };

  const credentials = config.username === ""
    ? ""
    : `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`;

  return {
    ok: true,
    target: proxyTarget(config),
    url: `${config.protocol}://${credentials}${config.host}:${config.port}`,
  };
}
