/**
 * 中继地址的规范化与连通性探测。
 *
 * 之所以有这一层:真实用户踩过一次 —— 填了 `ws://192.168.1.109`(没有端口),于是桌面端去连 80 端口,
 * 报了一句 `fetch failed`,看不出根因。所以:
 *
 * - **补默认端口**:我们的中继默认 8787,少写端口是最常见的笔误,自动补上并在界面上回显;
 * - **探测**:点一下就真的去问中继的 `/health`,而不是等生成二维码时才失败。
 */

import { REMOTE_PROTOCOL_VERSION } from "@wordless/remote-control";

/** 中继的默认端口。改这里等于改 `apps/relay/src/main.ts` 的默认值。 */
export const DEFAULT_RELAY_PORT = 8787;

export interface NormalizedRelayAddress {
	readonly webSocketUrl: string;
	/** 同一个中继的 HTTP 地址(探测与信箱用它)。 */
	readonly httpUrl: string;
	/** 补过端口就说一声,界面上要能看见"我给它补了什么"。 */
	readonly paddedPort: boolean;
}

/** 宽松接受:带不带协议、带不带端口都行;结果统一成 `ws(s)://host:port`。 */
export function normalizeRelayAddress(input: string): NormalizedRelayAddress {
	const trimmed = input.trim();
	if (trimmed.length === 0) throw new Error("中继地址不能为空");

	// 先挡住"协议写错"这一类:用户很容易把网页地址(http://)当中继地址填进来,
	// 而那样会被下面的拆分逻辑报成"不要带路径" —— 一句与真实问题无关的话。
	const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
	if (schemeMatch && !/^wss?$/i.test(schemeMatch[1] as string)) {
		throw new Error(`中继地址要用 ws:// 或 wss:// 开头(${schemeMatch[1]}:// 是另一类地址)`);
	}
	const hasScheme = /^wss?:\/\//i.test(trimmed);
	const scheme = hasScheme ? (trimmed.slice(0, trimmed.indexOf("://")).toLowerCase() as "ws" | "wss") : "ws";
	const remainder = hasScheme ? trimmed.slice(trimmed.indexOf("://") + 3) : trimmed;
	const [authority = "", ...rest] = remainder.split("/");
	if (rest.length > 0 && rest.join("/").length > 0) {
		throw new Error("中继地址只填到端口就好,不要带路径(例如 ws://192.168.1.109:8787)");
	}
	if (authority.length === 0) throw new Error("中继地址缺少主机名");

	// `host` / `host:port`;IPv6 不在支持范围内(自建中继极少这么部署,而且方括号形式容易写错)。
	const match = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(authority);
	if (!match) {
		throw new Error("中继地址的写法不对(例如 ws://192.168.1.109:8787)");
	}
	const host = match[1] as string;
	const explicitPort = match[2];
	if (explicitPort !== undefined) {
		const port = Number(explicitPort);
		if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("中继地址的端口不合法");
	}
	const socketScheme = scheme === "wss" ? "wss" : "ws";
	/**
	 * 什么时候补端口:
	 *
	 * - `ws://` 或**裸主机**:补 8787(我们中继的默认端口,少写端口是最常见的笔误);
	 * - `wss://` 不带端口:**不补** —— 按 URL 的通行约定,那指的是 443(通常前面有个 TLS 反代),
	 *   硬补 8787 会把一个本来正确的地址改坏。
	 */
	const shouldPad = explicitPort === undefined && socketScheme === "ws";
	const port = explicitPort ?? (shouldPad ? String(DEFAULT_RELAY_PORT) : undefined);
	const authorityWithPort = port === undefined ? host : `${host}:${port}`;
	return {
		webSocketUrl: `${socketScheme}://${authorityWithPort}`,
		httpUrl: `${socketScheme === "wss" ? "https" : "http"}://${authorityWithPort}`,
		paddedPort: shouldPad,
	};
}

export interface RelayProbeResult {
	readonly ok: boolean;
	/** 给人看的一句话:成功说版本,失败说**地址**与原因。 */
	readonly detail: string;
}

/**
 * 探一次中继:GET `/health`。
 *
 * 失败时把**地址**带出来 —— 这是上次那个 `fetch failed` 最大的问题:用户不知道是哪个地址失败。
 */
export async function probeRelay(
	input: string,
	options: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number } = {},
): Promise<RelayProbeResult> {
	let address: NormalizedRelayAddress;
	try {
		address = normalizeRelayAddress(input);
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : "中继地址不合法" };
	}
	const doFetch = options.fetchImpl ?? globalThis.fetch;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
	try {
		const response = await doFetch(`${address.httpUrl}/health`, { signal: controller.signal });
		if (!response.ok) {
			return { ok: false, detail: `${address.httpUrl}/health 回了 ${response.status},这不像一个中继的地址` };
		}
		const body = (await response.json()) as { status?: unknown; protocolVersion?: unknown };
		if (body.status !== "ok") return { ok: false, detail: `${address.httpUrl} 回的内容不像中继的健康检查` };
		/**
		 * **协议版本对不上 = 那条链路上跑的是旧版中继**(升级部署最硬的冲突)。
		 *
		 * 中继的协议版本是握手时**逐个校验**的(`assertVersion` 要求完全相等),
		 * 所以对不上不是"可能有点小问题",而是**一定连不上**。这句话要说出根因与做法 ——
		 * 否则用户看到的是握手时一句 `unsupported protocol version`,那完全看不出"去重新部署一次"。
		 */
		const remote = Number(body.protocolVersion);
		if (Number.isFinite(remote) && remote !== REMOTE_PROTOCOL_VERSION) {
			return {
				ok: false,
				detail: `${address.httpUrl} 上的中继是旧版(协议 v${remote},这台电脑要 v${REMOTE_PROTOCOL_VERSION})—— 去「自动部署(SSH)」重新部署一次就会更新`,
			};
		}
		return { ok: true, detail: `可以连接(${address.httpUrl},协议 v${String(body.protocolVersion ?? "?")})` };
	} catch (error) {
		const reason = error instanceof Error && error.message.length > 0 ? `(${error.message})` : "";
		return { ok: false, detail: `连不上 ${address.httpUrl}${reason}。检查中继进程是否在运行、端口是否写对` };
	} finally {
		clearTimeout(timeout);
	}
}
