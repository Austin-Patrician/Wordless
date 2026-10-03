import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
	KEEPALIVE_PING,
	KEEPALIVE_PONG,
	REMOTE_PROTOCOL_VERSION,
	REMOTE_WEBSOCKET_PROTOCOL,
	RELAY_CLOSE_INVALID_FRAME,
	RelayCore,
	encodeRemoteFrame,
	inviteBoxId,
	parseOfferedProtocols,
	readInviteEnvelope,
	type RelayCredentials,
	type RelayHandle,
	type RemoteEndpointRole,
} from "@wordless/remote-control";

/**
 * 本机中继进程:真实 WebSocket 服务,跑的是**同一份 `RelayCore`**。
 *
 * 这一点的价值在于"线上跑的规则"与"测试里通过的规则"是同一份代码 —— 不存在两边行为不一致这种 bug。
 * 本文件只做三件事:把 HTTP/WS 翻译成中继能懂的东西、管连接生命周期、给出健康检查与信箱路由。
 *
 * 它**不**保存任何会话内容(端到端加密),也**不**在转发路径上写存储。
 */

export interface RelayServerOptions {
	/** 0 表示随机端口(测试用)。 */
	readonly port?: number;
	/**
	 * 网页客户端构建产物的目录。
	 *
	 * 中继顺带托管它,是为了让**一个域名、一份证书**就够:二维码里是 `https://<中继>/#/PAIR/…`,
	 * 扫到就能打开。没配置时 `/` 会说明"网页客户端没跟着部署",而不是给一个 404 让人猜。
	 */
	readonly webRoot?: string;
	/** 默认只绑环回:暴露到外网必须是显式动作(隧道或反向代理)。 */
	readonly host?: string;
	readonly core?: RelayCore;
	readonly logger?: (line: string) => void;
	readonly maxInviteBodyBytes?: number;
}

export interface RelayServer {
	readonly url: string;
	readonly httpUrl: string;
	readonly core: RelayCore;
	close(): Promise<void>;
}

const MAX_INVITE_BODY_BYTES = 16_384;

/**
 * 绑定非环回地址时的风险提示。
 *
 * 中继本身**看不到会话内容**(端到端加密),但在没有 TLS 的链路上:
 * - 连接码与密码是明文 —— 抓到它就能取走邀请、进房间;
 * - WebSocket 子协议里带着手机凭据 —— 抓到它就能冒充那台手机。
 *
 * 所以这不是"能不能跑"的问题,而是"能这么跑多久"的问题。做成纯函数是为了让这句话可以被测试:
 * 风险提示最怕的就是悄悄失效。
 */
export function describeBindingRisk(host: string): string | undefined {
	const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
	if (loopback) return undefined;
	return [
		`绑定在 ${host}(非环回)且没有 TLS:连接码、密码与手机凭据会以明文经过链路。`,
		"仅用于受控网络下的短时测试;长期使用请用一次性隧道(自带 HTTPS)或反向代理 + 证书。",
	].join("\n");
}
const PAIRING_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const PAIRING_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const BOX_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function startRelayServer(options: RelayServerOptions = {}): Promise<RelayServer> {
	const core = options.core ?? new RelayCore();
	const log = options.logger ?? ((): void => undefined);
	const sockets = new WebSocketServer({
		noServer: true,
		// 子协议必须回一个客户端提供的名字,否则浏览器会拒绝这条连接。
		handleProtocols: (protocols) => (protocols.has(REMOTE_WEBSOCKET_PROTOCOL) ? REMOTE_WEBSOCKET_PROTOCOL : false),
	});

	const webRoot = options.webRoot === undefined ? undefined : resolve(options.webRoot);
	const server: Server = createServer((request, response) => {
		void handleHttp(request, response);
	});

	server.on("upgrade", (request, socket, head) => {
		const route = parseRelayRoute(request.url ?? "");
		if (!route) {
			socket.destroy();
			return;
		}
		const credentials = credentialsFrom(request, route);
		if (!credentials) {
			log(`upgrade_rejected ${route.role} missing_credentials`);
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
		if (route.role === "desktop" && credentials.peerCredentialHash === undefined) {
			// 桌面端必须声明"它注册的是哪台手机"的哈希;中继从不持有手机密钥本身。
			log("upgrade_rejected desktop missing_peer_hash");
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
		// 桌面端第一次连上就是"注册房间":重新注册可以轮换手机凭据,这是桌面端独有的权力。
		if (route.role === "desktop") {
			core.registerRoom(route.pairingId, credentials.pairingSecret, credentials.peerCredentialHash);
		}
		sockets.handleUpgrade(request, socket, head, (ws) => {
			void attachSocket(ws, route, credentials);
		});
	});

	async function attachSocket(
		ws: WebSocket,
		route: { pairingId: string; role: RemoteEndpointRole },
		credentials: RelayCredentials,
	): Promise<void> {
		let handle: RelayHandle;
		try {
			handle = core.attach(credentials, {
				onFrame: (frame) => {
					if (ws.readyState === ws.OPEN) ws.send(encodeRemoteFrame(frame));
				},
				onClose: (code, reason) => {
					if (ws.readyState === ws.OPEN) ws.close(code, reason);
				},
			});
		} catch {
			// 凭据不对 / 房间不存在:真实服务在这里必须直接拒绝,而不是"先连上再说"。
			log(`connect_rejected ${route.role} unauthorized`);
			ws.close(4003, "Unauthorized");
			return;
		}
		log(`socket_connected ${route.role}`);

		ws.on("message", (data) => {
			const text = data.toString();
			// 心跳在协议层之外:中继直接应答,不进房间、不唤醒任何状态,于是闲置配对不产生费用。
			if (text === KEEPALIVE_PING) {
				if (ws.readyState === ws.OPEN) ws.send(KEEPALIVE_PONG);
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				log(`socket_rejected ${route.role} invalid_json`);
				ws.close(RELAY_CLOSE_INVALID_FRAME, "Invalid remote protocol frame");
				return;
			}
			void handle.send(parsed as never);
		});
		ws.on("close", (code, reason) => {
			// **带上关闭码与原因**:排查"手机怎么突然掉了"时,这一行是唯一能分清
			// "谁关的、为什么关"的证据(4001 = 被同一角色的新连接顶掉,4002 = 帧非法)。
			log(`socket_closed ${route.role} code=${code}${reason.length > 0 ? ` reason=${reason.toString()}` : ""}`);
			void handle.close();
		});
		ws.on("error", () => {
			ws.close(1011, "Relay socket error");
		});
	}

	async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const url = new URL(request.url ?? "/", "http://relay.local");
		const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
		if (request.method === "GET" && url.pathname === "/health") {
			response.writeHead(200, { ...headers, "content-type": "application/json" });
			response.end(JSON.stringify({ status: "ok", protocolVersion: REMOTE_PROTOCOL_VERSION }));
			return;
		}
		if (request.method === "GET" && !url.pathname.startsWith("/v2/")) {
			await serveWebClient(request, response, url.pathname, webRoot);
			return;
		}
		const boxId = /^\/v2\/invite\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
		if (boxId === undefined || !BOX_ID_PATTERN.test(boxId)) {
			response.writeHead(404, { ...headers, "content-type": "application/json" });
			response.end(JSON.stringify({ error: "not_found" }));
			return;
		}
		if (request.method === "GET") {
			const envelope = core.getInvite(boxId);
			if (!envelope) {
				response.writeHead(404, headers);
				response.end();
				return;
			}
			response.writeHead(200, { ...headers, "content-type": "application/json" });
			response.end(JSON.stringify(envelope));
			return;
		}
		const token = request.headers["x-wordless-invite-token"];
		if (typeof token !== "string" || !PAIRING_SECRET_PATTERN.test(token)) {
			response.writeHead(401, headers);
			response.end();
			return;
		}
		if (request.method === "DELETE") {
			response.writeHead(core.deleteInvite(boxId, token) ? 204 : 404, headers);
			response.end();
			return;
		}
		if (request.method === "PUT") {
			const body = await readBody(request, options.maxInviteBodyBytes ?? MAX_INVITE_BODY_BYTES);
			if (body === undefined) {
				response.writeHead(413, headers);
				response.end();
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(body);
			} catch {
				response.writeHead(400, headers);
				response.end();
				return;
			}
			const envelope = readInviteEnvelope(parsed);
			if (!envelope) {
				response.writeHead(400, headers);
				response.end();
				return;
			}
			core.putInvite(boxId, token, envelope);
			response.writeHead(201, headers);
			response.end();
			return;
		}
		response.writeHead(405, headers);
		response.end();
	}

	const port = options.port ?? 8787;
	const host = options.host ?? "127.0.0.1";
	await new Promise<void>((resolve) => server.listen(port, host, () => resolve()));
	const address = server.address();
	const actualPort = typeof address === "object" && address !== null ? address.port : port;
	return {
		url: `ws://${host}:${actualPort}`,
		httpUrl: `http://${host}:${actualPort}`,
		core,
		close: () =>
			new Promise<void>((resolve) => {
				for (const client of sockets.clients) client.terminate();
				sockets.close(() => server.close(() => resolve()));
			}),
	};
}

function parseRelayRoute(pathname: string): { pairingId: string; role: RemoteEndpointRole } | undefined {
	const match = /^\/v2\/relay\/([^/]+)\/(mobile|desktop)$/.exec(pathname);
	if (!match) return undefined;
	const pairingId = match[1];
	const role = match[2];
	if (!pairingId || !PAIRING_ID_PATTERN.test(pairingId)) return undefined;
	return { pairingId, role: role === "desktop" ? "desktop" : "mobile" };
}

/** 配对密钥走**子协议**而不是 URL:代理、日志、浏览器历史里都只有 pairingId。 */
function credentialsFrom(
	request: IncomingMessage,
	route: { pairingId: string; role: RemoteEndpointRole },
): RelayCredentials | undefined {
	const header = request.headers["sec-websocket-protocol"];
	const offered = parseOfferedProtocols(typeof header === "string" ? header : undefined);
	const secret = offered.pairingSecret;
	if (!secret || !PAIRING_SECRET_PATTERN.test(secret)) return undefined;
	const hash = offered.peerCredentialHash;
	return {
		pairingId: route.pairingId,
		role: route.role,
		pairingSecret: secret,
		...(hash && SHA256_HEX_PATTERN.test(hash) ? { peerCredentialHash: hash } : {}),
	};
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

/**
 * 托管网页客户端。
 *
 * 两条纪律:**只允许 webRoot 里的文件**(路径穿越在这里是必须挡住的东西),以及
 * **带哈希的资源可以长缓存,`index.html` 绝不缓存**(否则用户会一直拿到旧页面,而资源已经换了名字)。
 */
async function serveWebClient(
	request: IncomingMessage,
	response: ServerResponse,
	pathname: string,
	webRoot: string | undefined,
): Promise<void> {
	const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
	if (webRoot === undefined) {
		response.writeHead(200, { ...headers, "content-type": "text/html; charset=utf-8" });
		response.end(NOT_DEPLOYED_PAGE);
		return;
	}
	const requested = pathname === "/" ? "/index.html" : pathname;
	// `normalize` + 前缀校验:任何试图走出 webRoot 的路径都当成不存在。
	const candidate = resolve(join(webRoot, normalize(requested)));
	if (candidate !== webRoot && !candidate.startsWith(`${webRoot}${sep}`)) {
		response.writeHead(404, headers);
		response.end();
		return;
	}
	try {
		const info = await stat(candidate);
		if (!info.isFile()) throw new Error("not a file");
		const body = await readFile(candidate);
		const type = CONTENT_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream";
		// 资源名里带哈希(Vite 默认):可以长缓存;index.html 不能。
		const cacheControl = candidate.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable";
		response.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff", "cache-control": cacheControl });
		response.end(body);
	} catch {
		response.writeHead(404, headers);
		response.end();
	}
}

const NOT_DEPLOYED_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Wordless 远程</title></head>
<body style="font:14px/1.6 system-ui;max-width:36rem;margin:12vh auto;padding:0 1.5rem">
<h1 style="font-size:1.1rem">这个中继还没有部署网页客户端</h1>
<p>中继本身是好的(健康检查在 <code>/health</code>)。要让手机能打开网页,请把网页客户端的构建产物放到中继上:</p>
<p>配好之后,配对用的<strong>连接码与密码在电脑端的「设置 → 远程连接」里生成</strong>(这个页面不会显示它们)。</p>
<pre style="background:#f3f3f0;padding:.75rem;border-radius:.5rem">npm run build -w @wordless/web-client
node apps/relay/src/main.ts --web-root apps/web-client/dist</pre>
</body></html>`;

async function readBody(request: IncomingMessage, limit: number): Promise<string | undefined> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > limit) return undefined;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** 导出给脚本用:从连接码算出信箱名(与桌面端、手机端各算一次,不用互相告知)。 */
export { inviteBoxId };
