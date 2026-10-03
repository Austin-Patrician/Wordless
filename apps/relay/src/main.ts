import { describeBindingRisk, startRelayServer } from "./server.ts";

/**
 * 中继进程入口。
 *
 * ```bash
 * node apps/relay/src/main.ts --port 8787            # 只绑环回(默认)
 * node apps/relay/src/main.ts --host 0.0.0.0 --port 8787   # 显式暴露(请自行加隧道/反代与访问控制)
 * ```
 *
 * 默认只绑 `127.0.0.1`:要跨网络,应当由用户显式开启隧道或反向代理,而不是让中继自己监听公网。
 */

function readOption(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(readOption("port") ?? process.env.WORDLESS_RELAY_PORT ?? "8787");
const host = readOption("host") ?? process.env.WORDLESS_RELAY_HOST ?? "127.0.0.1";
// 网页客户端的构建产物:配了就在同一个域名下托管(二维码才打得开)。
const webRoot = readOption("web-root") ?? process.env.WORDLESS_WEB_ROOT;

const server = await startRelayServer({
	port,
	host,
	...(webRoot === undefined ? {} : { webRoot }),
	logger: (line) => console.log(`[relay] ${line}`),
});

console.log(`[relay] listening on ${server.url} (http ${server.httpUrl})`);
console.log(
	webRoot === undefined
		? "[relay] 没有配置 --web-root:手机扫码后打不开网页(健康检查与中继本身正常)。"
		: `[relay] 网页客户端托管在 ${server.httpUrl}/ (来自 ${webRoot})`,
);
console.log("[relay] 只转发加密帧,不保存任何会话内容;心跳由本进程直接应答,闲置配对不产生负载。");

const risk = describeBindingRisk(host);
if (risk !== undefined) {
	// 说清楚代价,而不是拒绝启动 —— 受控网络下的短时测试是合理用法。
	for (const line of risk.split("\n")) console.warn(`[relay] ⚠ ${line}`);
}

const shutdown = async (): Promise<void> => {
	console.log("[relay] shutting down");
	await server.close();
	process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
