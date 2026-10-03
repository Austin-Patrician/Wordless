import { RemoteProtocolError, encodeRemoteFrame, isKeepalive, parseRemoteFrame } from "./protocol.ts";
import { KEEPALIVE_PING, type RemoteFrame, type RemoteTransport, type RemoteTransportHandlers } from "./types.ts";

/**
 * 真实 WebSocket 传输。
 *
 * 它同时服务三种运行环境:Node 里中继/本机服务用 `ws`,浏览器里用内置 `WebSocket` ——
 * 两者的**事件 API 不同**(`on` vs `addEventListener`),所以这里只要求一个最小的结构,
 * 由调用方给一个工厂把 URL 变成 socket。
 *
 * 心跳(`ping`)是**裸文本**,不走帧编码:中继侧对它的应答由运行时自动完成,
 * 所以闲置配对不会唤醒任何对象、也不产生费用。
 */

export interface WebSocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	/** 浏览器风格。 */
	addEventListener?(type: "open" | "message" | "close" | "error", listener: (event: unknown) => void): void;
	/** `ws` 风格。 */
	on?(type: "open" | "message" | "close" | "error", listener: (...args: unknown[]) => void): void;
}

export interface WebSocketFactory {
	open(url: string, protocols: string[]): WebSocketLike;
}

export interface WebSocketTransportOptions {
	readonly url: string;
	readonly protocols: string[];
	readonly factory: WebSocketFactory;
	/** 建链超时(毫秒)。超时就以可重试错误收尾,而不是一直挂着。 */
	readonly openTimeoutMs?: number;
}

const OPEN_STATE = 1;
const DEFAULT_OPEN_TIMEOUT_MS = 15_000;

export class WebSocketTransport implements RemoteTransport {
	private readonly options: WebSocketTransportOptions;
	private socket: WebSocketLike | undefined;
	private handlers: RemoteTransportHandlers | undefined;

	constructor(options: WebSocketTransportOptions) {
		this.options = options;
	}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		this.handlers = handlers;
		const socket = this.options.factory.open(this.options.url, this.options.protocols);
		this.socket = socket;
		await new Promise<void>((resolve, reject) => {
			let opened = false;
			const timeout = setTimeout(() => {
				reject(new RemoteProtocolError("连接中继超时", "transport_closed"));
			}, this.options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS);
			const settle = (): void => {
				opened = true;
				clearTimeout(timeout);
				resolve();
			};
			/**
			 * 建链阶段就失败时**立刻收尾**,而不是等超时。
			 *
			 * 之前这里只处理了"开"与"关":升级被拒(比如中继没有注册过这个房间)时,`error`/`close`
			 * 都发生在 open 之前,于是要干等 15 秒,最后把"连不上"报成"超时" —— 根因被这句话盖掉了。
			 */
			const fail = (reason: string): void => {
				clearTimeout(timeout);
				reject(new RemoteProtocolError(reason, "transport_closed"));
			};
			this.on(socket, "open", () => settle());
			this.on(socket, "message", (payload) => {
				const text = typeof payload === "string" ? payload : undefined;
				if (text === undefined) return;
				if (isKeepalive(text)) return; // 心跳由中继自动应答,不进入协议层
				try {
					this.handlers?.onFrame(parseRemoteFrame(text));
				} catch (error) {
					// 不合规的帧:交给对端处理(真实中继会直接关闭连接)。
					//
					// **把解析器的原因带上**:日志里只写 "invalid frame" 时,分不清"帧太大"和"JSON 坏了" ——
					// 这两种情况的修法完全不同(前者是发送方要分页,后者是协议实现有 bug)。
					const detail = error instanceof Error ? error.message : "unparseable frame";
					void this.close(`invalid frame: ${detail}`);
				}
			});
			this.on(socket, "close", (code, reason) => {
				this.socket = undefined;
				if (!opened) {
					const detail = typeof reason === "string" && reason.length > 0 ? reason : String(code ?? "");
					fail(`中继拒绝了这条连接${detail.length === 0 ? "" : `(${detail})`}`);
					return;
				}
				this.handlers?.onClose(typeof reason === "string" ? reason : "socket closed");
			});
			this.on(socket, "error", (first) => {
				if (!opened) fail(`无法连接到中继${describeSocketError(first)}`);
			});
		});
	}

	async send(frame: RemoteFrame): Promise<void> {
		const socket = this.socket;
		if (!socket || socket.readyState !== OPEN_STATE) {
			throw new RemoteProtocolError("websocket is not open", "transport_closed");
		}
		socket.send(encodeRemoteFrame(frame));
	}

	async close(reason = "closed by local endpoint"): Promise<void> {
		const socket = this.socket;
		this.socket = undefined;
		socket?.close(1000, reason);
	}

	/** 主动发一次心跳(中继会自动应答,不会进入协议层)。 */
	sendKeepalive(): void {
		if (this.socket?.readyState === OPEN_STATE) this.socket.send(KEEPALIVE_PING);
	}

	/** 两种事件 API 的适配:只写一次,避免每个调用点都判断环境。 */
	private on(
		socket: WebSocketLike,
		type: "open" | "message" | "close" | "error",
		listener: (first?: unknown, second?: unknown) => void,
	): void {
		if (typeof socket.addEventListener === "function") {
			socket.addEventListener(type, (event) => {
				const record = event as { data?: unknown; reason?: unknown };
				listener(record.data, record.reason);
			});
			return;
		}
		socket.on?.(type, (...args: unknown[]) => listener(args[0], args[1]));
	}
}

/**
 * 用 Node 的 `ws` 建一个工厂(本机服务、中继测试、脚本用)。
 *
 * 参数刻意收成 `unknown`:打包器对 CJS 模块(`ws` 就是)的处理各不相同 —— 传进来的可能是
 * **类本身**(默认导出)、**命名导出对象**,或者**模块命名空间**。三种都要认。
 *
 * 这不是"防御性编程",而是踩过的坑:在 Electron 主进程的 CJS 打包里,命名导入曾经变成 undefined,
 * 报错是 `WebSocketImpl is not a constructor` —— 一个看不出根因的错。所以这里既容忍三种形状,
 * 也在真的不对时把话说清楚。
 */
/** 浏览器出于安全不会给 error 事件细节,所以这里能取到多少说多少。 */
function describeSocketError(value: unknown): string {
	const message = (value as { message?: unknown } | undefined)?.message;
	return typeof message === "string" && message.length > 0 ? `:${message}` : "";
}

export function nodeWebSocketFactory(moduleOrClass: unknown): WebSocketFactory {
	const Impl = resolveWebSocketImplementation(moduleOrClass);
	return { open: (url, protocols) => new Impl(url, protocols) };
}

function resolveWebSocketImplementation(value: unknown): new (url: string, protocols: string[]) => WebSocketLike {
	const record = value as { WebSocket?: unknown; default?: unknown } | undefined;
	const candidate = (typeof record?.WebSocket === "function" ? record.WebSocket : undefined)
		?? (typeof record?.default === "function" ? record.default : undefined)
		?? value;
	if (typeof candidate !== "function") {
		throw new Error(
			"需要 WebSocket 实现:传 ws 的默认导出、命名导出或模块命名空间都可以(拿到的是 " +
				`${value === undefined ? "undefined" : typeof value})`,
		);
	}
	return candidate as new (url: string, protocols: string[]) => WebSocketLike;
}
