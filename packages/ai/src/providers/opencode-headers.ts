import type { Api, Model, ProviderHeaders, ProviderStreams, StreamOptions } from "../types.ts";

const OPENCODE_SESSION_HEADER = "x-opencode-session";
/** Hosts whose gateway requires the per-conversation routing header. */
const OPENCODE_HOST = "opencode.ai";
const OPENCODE_PROVIDER_IDS = new Set(["opencode", "opencode-go"]);

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
	const expected = name.toLowerCase();
	return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === expected);
}

/**
 * Whether a model is served by an OpenCode endpoint.
 *
 * Matched by provider id first, then by host so that a user-configured provider
 * pointing at the same gateway is treated identically. Hosts are compared
 * exactly rather than by suffix, so a lookalike domain cannot inherit the rule.
 */
export function isOpenCodeEndpoint(model: Pick<Model<Api>, "provider" | "baseUrl">): boolean {
	if (OPENCODE_PROVIDER_IDS.has(model.provider)) return true;
	try {
		return new URL(model.baseUrl).hostname === OPENCODE_HOST;
	} catch {
		return false;
	}
}

/**
 * Session headers a request to an OpenCode endpoint has to carry.
 *
 * Returns undefined when there is nothing to add: no session identity, an
 * unrelated endpoint, or a header the caller already set (an explicit
 * `x-opencode-session` always wins, whatever its casing).
 */
export function openCodeSessionHeadersFor(
	model: Pick<Model<Api>, "provider" | "baseUrl">,
	options: { sessionId?: string | undefined; headers?: ProviderHeaders | undefined } = {},
): ProviderHeaders | undefined {
	if (!options.sessionId) return undefined;
	if (hasHeader(options.headers, OPENCODE_SESSION_HEADER)) return undefined;
	if (!isOpenCodeEndpoint(model)) return undefined;
	return { [OPENCODE_SESSION_HEADER]: options.sessionId };
}

function withSessionHeader<TOptions extends StreamOptions>(
	model: Model<Api>,
	options: TOptions | undefined,
): TOptions | undefined {
	const headers = openCodeSessionHeadersFor(model, { sessionId: options?.sessionId, headers: options?.headers });
	if (!headers) return options;
	// The spread keeps every caller option; only `headers` is replaced. The cast
	// restores the generic the optional spread erases.
	return { ...options, headers: { ...options?.headers, ...headers } } as TOptions;
}

/**
 * Adds OpenCode's required per-conversation routing header before API dispatch.
 *
 * Applied per provider, so it covers every request made through that provider
 * regardless of which layer issued it. Callers that bypass a wrapped provider -
 * a user-configured provider entry, for example - rely on the shared
 * `openCodeSessionHeadersFor` rule being applied at their own dispatch point.
 */
export function withOpenCodeSessionHeader(streams: ProviderStreams): ProviderStreams {
	return {
		...streams,
		stream: (model, context, options) => streams.stream(model, context, withSessionHeader(model, options)),
		streamSimple: (model, context, options) => streams.streamSimple(model, context, withSessionHeader(model, options)),
	};
}
