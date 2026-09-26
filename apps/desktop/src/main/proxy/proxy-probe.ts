import http from "node:http";
import type { ProxyProbeCandidate, ProxyTestResult } from "@wordless/protocol";

/**
 * Finding and testing a local proxy.
 *
 * Deliberately small: a short list of ports, and a probe that *uses* the address
 * as an HTTP proxy rather than merely checking that the port is open. Probing
 * the port alone cannot tell a proxy from any other listener, and suggesting the
 * wrong one is worse than suggesting nothing.
 *
 * Loopback only. Nothing here scans the network.
 */

/** Where a locally installed proxy client usually listens. */
export const LOCAL_PROXY_CANDIDATES: readonly ProxyProbeCandidate[] = [
  { host: "127.0.0.1", port: 7890 }, // Clash, ClashX
  { host: "127.0.0.1", port: 7897 }, // Clash Verge
  { host: "127.0.0.1", port: 1087 }, // V2Ray / Shadowsocks (http inbound)
  { host: "127.0.0.1", port: 8118 }, // Privoxy
  { host: "127.0.0.1", port: 8080 }, // generic
];

/**
 * The endpoint a probe asks for. Plain HTTP on purpose: an HTTP proxy can serve
 * an absolute-URI request directly, so the probe needs no CONNECT and no TLS.
 */
const PROBE_TARGET = "http://www.gstatic.com/generate_204";

export const PROBE_TIMEOUT_MS = 2_500;

/** Answers one question: does this address behave like a working HTTP proxy? */
export type ProxyProbe = (proxyUrl: string, signal: AbortSignal) => Promise<boolean>;

export function proxyUrlFor(candidate: ProxyProbeCandidate): string {
  return `http://${candidate.host}:${candidate.port}`;
}

/**
 * Sends an absolute-URI request to the proxy and treats any HTTP response as
 * success.
 *
 * A refusal, a timeout or a non-HTTP reply all count as failure. The status code
 * is deliberately ignored: what is being tested is whether the address proxies
 * requests at all, and the target's own status is not this function's business.
 */
export const httpProxyProbe: ProxyProbe = (proxyUrl, signal) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    try {
      const proxy = new URL(proxyUrl);
      const request = http.request(
        {
          host: proxy.hostname,
          port: Number(proxy.port) || 80,
          method: "GET",
          path: PROBE_TARGET,
          headers: { Host: new URL(PROBE_TARGET).host, Connection: "close" },
          signal,
        },
        (response) => {
          response.resume();
          finish(true);
        },
      );
      request.on("error", () => finish(false));
      request.end();
    } catch {
      finish(false);
    }
  });

/** Tries one address, returning why it failed when it did. */
export async function testProxy(url: string, probe: ProxyProbe = httpProxyProbe): Promise<ProxyTestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // The probe resolves false rather than throwing, so the boolean has to be
    // read: `await` alone would report success for every address.
    const ok = await probe(url, controller.signal);
    return ok ? { ok: true } : { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sequential, stopping at the first address that answers.
 *
 * Sequential rather than parallel: the list is short, the common case is the
 * first entry, and firing five simultaneous probes through a user's proxy client
 * is a ruder way to answer the same question.
 */
export async function findLocalProxy(
  probe: ProxyProbe = httpProxyProbe,
  candidates: readonly ProxyProbeCandidate[] = LOCAL_PROXY_CANDIDATES,
): Promise<ProxyProbeCandidate | undefined> {
  for (const candidate of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let ok = false;
    try {
      ok = await probe(proxyUrlFor(candidate), controller.signal);
    } catch {
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    if (ok) return candidate;
  }
  return undefined;
}
