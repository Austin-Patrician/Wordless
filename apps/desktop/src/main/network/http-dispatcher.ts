import * as undici from "undici";

const PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] as const;

export interface SystemProxySession {
	resolveProxy(url: string): Promise<string>;
}

export interface HttpDispatcherSetup {
	source: "environment" | "system" | "direct";
	proxyUrl?: string;
}

/**
 * Install the same global dispatcher used by pi's coding-agent. Electron's
 * system proxy is resolved once because Node's fetch cannot read WinInet/PAC
 * settings by itself. Explicit proxy environment variables always win.
 */
export async function configureHttpDispatcher(session: SystemProxySession): Promise<HttpDispatcherSetup> {
	const environmentProxy = findEnvironmentProxy();
	let proxyUrl = environmentProxy;
	let source: HttpDispatcherSetup["source"] = environmentProxy ? "environment" : "direct";

	if (!proxyUrl) {
		try {
			proxyUrl = parseElectronProxy(await session.resolveProxy("https://generativelanguage.googleapis.com"));
			if (proxyUrl) {
				process.env.HTTP_PROXY ??= proxyUrl;
				process.env.HTTPS_PROXY ??= proxyUrl;
				source = "system";
			}
		} catch (error) {
			console.warn("Unable to resolve the system HTTP proxy for AI requests:", error);
		}
	}

	const dispatcher = new undici.EnvHttpProxyAgent({ allowH2: false });
	undici.setGlobalDispatcher(dispatcher);
	undici.install?.();

	return { source, ...(proxyUrl ? { proxyUrl } : {}) };
}

function findEnvironmentProxy(): string | undefined {
	for (const key of PROXY_ENV_KEYS) {
		const value = process.env[key]?.trim();
		if (value) return value;
	}
	return undefined;
}

/** Parse Electron's `PROXY host:port; DIRECT` result. */
export function parseElectronProxy(rules: string): string | undefined {
	for (const rule of rules.split(";")) {
		const match = rule.trim().match(/^(PROXY|HTTPS?)\s+(.+)$/i);
		if (!match) continue;
		const endpoint = match[2]!.trim();
		if (!endpoint) continue;
		return endpoint.includes("://") ? endpoint : `${match[1]!.toUpperCase() === "HTTPS" ? "https" : "http"}://${endpoint}`;
	}
	return undefined;
}
