import type { DesktopProxyActive, DesktopProxyConfig } from "@wordless/protocol";
import { resolveProxyConfig } from "./proxy-settings.ts";

/**
 * Puts the configured proxy on every egress path.
 *
 * Three consumers, and all three are needed:
 *
 * - **Child processes.** Agent commands run through `bash`, which inherits
 *   `process.env`. Nothing else carries the proxy there, and the environment is
 *   also what pip/npm/git/curl read.
 * - **Electron sessions.** Chromium networking does not read these variables,
 *   so each session is told explicitly.
 * - **The global undici dispatcher.** `EnvHttpProxyAgent` builds its proxy
 *   agents from the environment when it is constructed, so it has to be rebuilt
 *   whenever the environment changes — not just once at startup.
 *
 * The environment variables are written in both cases on purpose. `curl` (and
 * therefore `git`) deliberately ignores the uppercase `HTTP_PROXY` because a CGI
 * environment can inject it, and reads only the lowercase `http_proxy`; it
 * accepts either case for the HTTPS ones. Writing one case would leave plain
 * `http://` requests going direct with no visible reason.
 */

/**
 * Hosts that must never be sent to a proxy.
 *
 * Without this, enabling a proxy routes loopback and LAN traffic at it too — a
 * model server on `127.0.0.1`, or a bridge gateway on the same machine — and
 * those requests then fail with no explanation, because the hop was never
 * supposed to leave the machine.
 */
export const NO_PROXY_HOSTS =
  "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,*.local";

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

type ProxyEnvKey = (typeof PROXY_ENV_KEYS)[number];

/**
 * What the process inherited, captured before the first write.
 *
 * Disabling the proxy has to restore this rather than delete the variables: a
 * user who exported `HTTPS_PROXY` in their own shell would otherwise lose the
 * proxy they already had.
 */
const inherited = new WeakMap<NodeJS.ProcessEnv, Partial<Record<ProxyEnvKey, string>>>();

function rememberInherited(env: NodeJS.ProcessEnv): void {
  if (inherited.has(env)) return;
  const baseline: Partial<Record<ProxyEnvKey, string>> = {};
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) baseline[key] = value;
  }
  inherited.set(env, baseline);
}

export function applyProxyEnv(env: NodeJS.ProcessEnv, proxyUrl: string, noProxy: string = NO_PROXY_HOSTS): void {
  rememberInherited(env);
  env.HTTP_PROXY = proxyUrl;
  env.http_proxy = proxyUrl;
  env.HTTPS_PROXY = proxyUrl;
  env.https_proxy = proxyUrl;
  env.ALL_PROXY = proxyUrl;
  env.all_proxy = proxyUrl;
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
}

export function restoreProxyEnv(env: NodeJS.ProcessEnv): void {
  rememberInherited(env);
  const baseline = inherited.get(env) ?? {};
  for (const key of PROXY_ENV_KEYS) {
    const value = baseline[key];
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
}

/**
 * True when the proxy is the reason a request failed.
 *
 * Used to decide whether a failure message may mention the proxy at all. Only an
 * enabled-but-unusable configuration qualifies: an ordinary network failure
 * (target down, DNS, offline) is not a proxy problem, and telling the user to
 * check their proxy would send them somewhere that cannot help.
 */
export function isProxyFault(config: DesktopProxyConfig | undefined): boolean {
  if (!config?.enabled) return false;
  return !resolveProxyConfig(config).ok;
}

/**
 * The proxy already present in the environment, if any.
 *
 * The same precedence the account session has always used, kept in one place: an
 * explicitly exported proxy beats the OS setting. Applied through the same code
 * path as the application proxy so there is only one answer to "which proxy is
 * in effect".
 */
export function proxyRulesFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] as const) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export interface ApplyProxyDeps {
  /** Electron sessions that must be told explicitly; Chromium ignores the env. */
  configureSessions: (proxyRules: string | undefined) => Promise<void>;
  /** Rebuilds the global dispatcher so it picks up the new environment. */
  configureDispatcher: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Apply a config. Called at startup and after every settings change; safe to
 * repeat and safe to call with an unusable config.
 */
export async function applyDesktopProxy(
  config: DesktopProxyConfig | undefined,
  deps: ApplyProxyDeps,
): Promise<DesktopProxyActive> {
  const env = deps.env ?? process.env;
  const resolution = resolveProxyConfig(config);

  if (!resolution.ok) {
    restoreProxyEnv(env);
    await deps.configureSessions(undefined);
    await deps.configureDispatcher();
    // A disabled config is the normal "go direct" case; a bad one is a state the
    // settings page reports. Either way the process must not be left carrying
    // the previous proxy.
    return resolution.reason === "disabled"
      ? { source: "direct", invalid: false }
      : { source: "application", invalid: true };
  }

  applyProxyEnv(env, resolution.url);
  await deps.configureSessions(resolution.url);
  await deps.configureDispatcher();
  // Only the credential-free target is reported; it is logged and displayed.
  return { source: "application", target: resolution.target, invalid: false };
}
