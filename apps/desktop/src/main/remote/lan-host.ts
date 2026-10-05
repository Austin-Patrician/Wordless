import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { startRelayServer, type RelayServer } from "@wordless/relay/server";

/**
 * **局域网模式**:在桌面端**主进程里**把中继起起来,并把网页客户端一起托管出去。
 *
 * 这一层的存在就是为了"一键":
 *
 * 1. 中继不是外部依赖 —— `@wordless/relay` 已经是桌面端的依赖,直接 `startRelayServer()` 就行,
 *    不需要第二个终端、不需要用户懂 npm;
 * 2. 中继本来就托管网页客户端(`webRoot`),所以"部署本机 web client"= 把构建产物目录指给它;
 * 3. 端口被占用**自动换一个**,而不是让用户对着一句 `EADDRINUSE` 发呆。
 *
 * 刻意不做的事:不碰 TLS。端到端加密走 `@noble/*`(纯 JS,不依赖安全上下文),
 * 所以 `http://<局域网 IP>` 上功能是完整的 —— 见 `docs/architecture/remote-deployment.md` §2.4。
 */

/** 与 `apps/relay/src/main.ts` 同一个默认端口。 */
export const DEFAULT_LAN_PORT = 8787;

/** 端口被占用时往后试几个,再不行就让系统随机给一个。 */
const PORT_RETRY_COUNT = 10;

export interface LanAddress {
	/** 形如 `192.168.1.9`。 */
	readonly address: string;
	/** 网卡名(`en0` / `WLAN`),多网卡时帮用户认出来是哪一个。 */
	readonly name: string;
}

/**
 * 本机可用的局域网地址。
 *
 * **只取 IPv4 的非环回地址**,而且**不替用户挑** —— 虚拟网卡(Docker / VPN / 虚拟机)非常常见,
 * 挑错的表现是"手机打不开",而用户完全看不出问题在哪。界面把列表摆出来让他选。
 */
export function listLanAddresses(interfaces = networkInterfaces()): readonly LanAddress[] {
	const found: LanAddress[] = [];
	for (const [name, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.internal) continue;
			// IPv6 暂不支持:二维码里带 IPv6 要方括号,而且家庭网络里很少有可用的 v6 直连。
			if (entry.family !== "IPv4") continue;
			found.push({ address: entry.address, name });
		}
	}
	// 名字稳定排序:同一个网络下每次打开设置页的顺序都一样,免得用户每次都要重新找。
	return found.sort((left, right) => left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
}

export interface LanHostStatus {
	readonly running: boolean;
	readonly port?: number;
	readonly addresses: readonly LanAddress[];
	/** 网页客户端的构建产物在不在。不在就**不起服务** —— 起了手机也只会看到一个说明页。 */
	readonly webClientReady: boolean;
	readonly webRoot?: string;
	/**
	 * 想要的那个端口被别人占了,实际用了另一个。
	 *
	 * 这件事必须**看得见**:用户可能在路由器上做过端口转发、或照着文档记着 8787,
	 * 悄悄换掉之后他会以为"端口没生效"。
	 */
	readonly portChanged: boolean;
	readonly error?: string;
}

export interface LanHostOptions {
	/**
	 * 网页客户端目录。
	 *
	 * 由调用方决定(开发版指向仓库里的构建产物,打包版指向 `process.resourcesPath/web-client`)——
	 * 这一层不碰 Electron,所以它可以直接测。
	 */
	readonly resolveWebRoot: () => string | undefined;
	/** 想要的端口;被占用会自动往后找。 */
	readonly port?: number;
	readonly logger?: (line: string) => void;
	/** 只给测试用:注入一个"起服务"的实现。 */
	readonly startServer?: typeof startRelayServer;
	/** 只给测试用:注入地址列表(真实实现读本机网卡)。 */
	readonly listAddresses?: () => readonly LanAddress[];
}

export class LanHost {
	private readonly options: LanHostOptions;
	private server: RelayServer | undefined;
	private status: LanHostStatus;

	constructor(options: LanHostOptions) {
		this.options = options;
		this.status = {
			running: false,
			addresses: this.addresses(),
			webClientReady: false,
			portChanged: false,
			...(options.resolveWebRoot() === undefined ? {} : { webRoot: options.resolveWebRoot() }),
		};
	}

	getStatus(): LanHostStatus {
		// 地址每次都重新读:换网络、插网线都会变,而设置页正好是最需要看到当前值的地方。
		return { ...this.status, addresses: this.addresses() };
	}

	private addresses(): readonly LanAddress[] {
		return (this.options.listAddresses ?? listLanAddresses)();
	}

	async start(): Promise<LanHostStatus> {
		if (this.server !== undefined) return this.getStatus();
		const webRoot = this.options.resolveWebRoot();
		if (webRoot === undefined) {
			return this.fail("这台机器上还没有网页客户端(开发版需要先构建一次)。");
		}
		if (!(await hasIndexHtml(webRoot))) {
			return this.fail("网页客户端的构建产物不完整(缺少 index.html),请重新构建一次。");
		}

		const startServer = this.options.startServer ?? startRelayServer;
		const first = this.options.port ?? DEFAULT_LAN_PORT;
		let lastError: unknown;
		// 先试用户给的端口,再往后试几个,最后让系统随机给 —— 端口被占用是最常见的"一键失败"。
		for (const port of [...Array.from({ length: PORT_RETRY_COUNT }, (_, index) => first + index), 0]) {
			try {
				this.server = await startServer({
					port,
					// 绑所有网卡:手机要从局域网另一头连进来。
					host: "0.0.0.0",
					webRoot,
					...(this.options.logger === undefined ? {} : { logger: this.options.logger }),
				});
				const actualPort =
					this.server.httpUrl === undefined ? port : Number(new URL(this.server.httpUrl).port);
				this.status = {
					running: true,
					port: actualPort,
					addresses: this.addresses(),
					webClientReady: true,
					webRoot,
					// 想要的端口是 first(0 表示"随便给一个",不算换过)。
					portChanged: first !== 0 && actualPort !== first,
				};
				return this.getStatus();
			} catch (error) {
				lastError = error;
				this.server = undefined;
			}
		}
		return this.fail(`起不了局域网服务:${errorText(lastError)}`);
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		await server?.close().catch(() => undefined);
		this.status = { ...this.status, running: false, port: undefined };
	}

	private fail(message: string): LanHostStatus {
		this.status = { ...this.status, running: false, port: undefined, error: message };
		return this.getStatus();
	}
}

async function hasIndexHtml(webRoot: string): Promise<boolean> {
	try {
		const info = await stat(join(webRoot, "index.html"));
		return info.isFile();
	} catch {
		return false;
	}
}

function errorText(cause: unknown): string {
	if (cause instanceof Error) {
		// 端口占用是最常见的一种:把原始信息留着,别只给一句"起不了服务"。
		return cause.message;
	}
	return String(cause);
}
