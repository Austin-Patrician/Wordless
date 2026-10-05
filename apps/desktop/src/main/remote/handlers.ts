import type { RemoteAccessService, RemoteAccessState } from "./remote-access-service.ts";
import { normalizeRelayAddress, probeRelay, type RelayProbeResult } from "./relay-address.ts";
import { DEPLOY_RELAY_PORT, remoteDeployPlan, type DeployPlan, type DeployPlanInput } from "./deploy-plan.ts";
import { SshDeploy, type DeployProgress, type SshTarget } from "./ssh-deploy.ts";
import { remoteUninstallPlan, type UninstallPlan, type UninstallScope } from "./uninstall-plan.ts";
import { prepareDeployBundle, type DeployBundleResult } from "./deploy-bundle.ts";

/**
 * 远程访问的 IPC 逻辑。
 *
 * **刻意不 import Electron**:所有校验与调用都在这里,`register-remote-ipc.ts` 只做转接。
 * 这样这段逻辑可以直接测,而且渲染层与主进程之间的契约在类型上是看得见的
 * (照 `notifications/webhook/handlers.ts` 的做法)。
 *
 * 载荷只有三个标量(开关、中继地址、设备 id),所以这里手写校验而不是引入 schema:
 * 一旦载荷变成结构化对象,就应当换成 `@wordless/protocol` 里的 typebox schema —— 与消息推送那边一致。
 */

export interface RemoteAccessHandlers {
	getState(): Promise<RemoteAccessState>;
	setEnabled(payload: unknown): Promise<RemoteAccessState>;
	/**
	 * 准备部署包(把中继单文件与网页客户端复制到用户找得到的地方)。
	 *
	 * 目录由主进程定(默认在"下载"里),因为教程里那句 `scp` 要指向**真实存在的路径**。
	 */
	prepareDeployBundle(): Promise<DeployBundleResult>;
	/** 取部署步骤(教程档渲染它;自动部署跑的**就是这一份**)。 */
	deployPlan(payload: unknown): Promise<DeployPlan>;
	/** 只读探测:动手之前先问清楚(系统、Node、用户、sudo)。 */
	deployProbe(payload: unknown): Promise<{ ok: boolean; findings: readonly string[]; error?: string }>;
	/** 逐步执行(一步一报;失败立刻停)。 */
	deployRun(payload: unknown): Promise<{ ok: boolean; failedStep?: string; error?: string }>;
	/**
	 * 撤下来:停服务 / 卸载(删文件、摘配置)。
	 *
	 * 与部署**同一套形状**:先给一份可以逐条看的计划,再逐步执行。
	 * 不同的是卸载**不可逆** —— 所以计划只包含探测到确实存在的东西(见 `uninstall-plan.ts`)。
	 */
	uninstallPlan(payload: unknown): Promise<UninstallPlan>;
	uninstallRun(payload: unknown): Promise<{ ok: boolean; failedStep?: string; error?: string; nothingToDo?: boolean }>;
	/** 取消正在跑的那一步。 */
	deployCancel(): Promise<{ ok: boolean }>;
	/** 切换接入方式(局域网 / 远程)。 */
	setMode(payload: unknown): Promise<RemoteAccessState>;
	/** 局域网模式的总开关(一键:起服务 + 填地址 + 开启)。 */
	setLanMode(payload: unknown): Promise<RemoteAccessState>;
	/** 换一个网卡地址(多网卡时用户挑的那一个)。 */
	setLanAddress(payload: unknown): Promise<RemoteAccessState>;
	setRelayUrl(payload: unknown): Promise<RemoteAccessState>;
	createInvite(): Promise<RemoteAccessState>;
	/** 探一次中继:让用户在生成二维码**之前**就知道地址通不通。 */
	testRelay(payload: unknown): Promise<RelayProbeResult>;
	withdrawInvite(): Promise<RemoteAccessState>;
	revokeDevice(payload: unknown): Promise<RemoteAccessState>;
}

/**
 * 部署包相关的**路径**(由主进程给:它们要 `app.getPath`,而这一层刻意不 import Electron)。
 */
export interface RemoteAccessHandlerPaths {
	readonly relayBundlePath: string;
	readonly webClientDir: string;
	/** "准备部署包"复制到哪儿(通常是"下载"里的一个固定子目录)。 */
	readonly deployBundleDir: string;
	/**
	 * 这台电脑上装的是哪一版(`app.getVersion()`)。
	 *
	 * 两处用到它:部署计划里**写进服务器的 `version.json`**,以及和服务器上那一版比对
	 * ("你更新了桌面端,该重新部署一次了")。少了它,用户只能靠记忆。
	 */
	readonly version?: string;
}

export interface RemoteAccessHandlerDeps {
	/** 部署进度(逐步推给界面:哪一步在跑、跑到哪了、失败时那一步的输出)。 */
	readonly onDeployProgress?: (progress: DeployProgress) => void;
	/** 只给测试用:注入执行器。 */
	readonly sshDeploy?: SshDeploy;
}

export function createRemoteAccessHandlers(
	service: RemoteAccessService,
	paths: RemoteAccessHandlerPaths,
	deps: RemoteAccessHandlerDeps = {},
): RemoteAccessHandlers {
	const sshDeploy = deps.sshDeploy ?? new SshDeploy();
	return {
		getState: async () => service.getState(),

		setEnabled: async (payload) => {
			const enabled = readBoolean(payload, "enabled");
			return service.setEnabled(enabled);
		},

		prepareDeployBundle: async () =>
			prepareDeployBundle({
				relayBundlePath: paths.relayBundlePath,
				webClientDir: paths.webClientDir,
				targetDir: paths.deployBundleDir,
			}),

		deployPlan: async (payload) => {
			const record = asRecord(payload);
			/**
			 * **与执行走同一条组装路径**(`readTargetInputs`)。
			 *
			 * 这里原来是手写的一份:于是"预览"与"执行"的输入会分叉 ——
			 * 真实踩到:预览那一份漏了探测结果,于是界面显示的步骤与真正跑的步骤不一样。
			 */
			return remoteDeployPlan({
				...readTargetInputs(record),
				localDir: paths.deployBundleDir,
				...(paths.version === undefined ? {} : { version: paths.version }),
			});
		},

		deployProbe: async (payload) => {
			const record = asRecord(payload);
			const relayPort = readOptionalPort(record, "relayPort") ?? DEPLOY_RELAY_PORT;
			// 一起测中继端口:否则"8787 被别的程序占着"要等部署到一半才发现。
			return sshDeploy.probe(readTarget(payload), [80, 443, relayPort]);
		},

		deployRun: async (payload) => {
			const record = asRecord(payload);
			const plan = remoteDeployPlan({
				...readTargetInputs(record),
				localDir: paths.deployBundleDir,
				...(paths.version === undefined ? {} : { version: paths.version }),
			});
			return sshDeploy.run(readTarget(payload), plan.steps, (progress) => deps.onDeployProgress?.(progress));
		},

		deployCancel: async () => {
			sshDeploy.cancel();
			return { ok: true };
		},

		uninstallPlan: async (payload) => remoteUninstallPlan(readUninstallInput(payload)),

		uninstallRun: async (payload) => {
			const plan = remoteUninstallPlan(readUninstallInput(payload));
			// 没东西可删就**别连服务器**:跑了只会得到一串"什么都没做"的绿勾,那比不跑更糟。
			// 但也不能只说 `ok` —— 界面会据此说"已经停用了",而其实什么都没发生。
			if (plan.nothingToDo) return { ok: true, nothingToDo: true };
			return sshDeploy.run(readTarget(payload), plan.steps, (progress) => deps.onDeployProgress?.(progress));
		},

		setMode: async (payload) => {
			const mode = readMode(payload);
			return service.setMode(mode);
		},

		setLanMode: async (payload) => {
			const enabled = readBoolean(payload, "enabled");
			return service.setLanMode(enabled);
		},

		setLanAddress: async (payload) => {
			const address = readString(payload, "address");
			return service.setLanAddress(address);
		},

		setRelayUrl: async (payload) => {
			const raw = readOptionalString(payload, "relayBaseUrl");
			if (raw === undefined) return service.setRelayBaseUrl(undefined);
			// 规范化在**保存时**做:少写端口是最常见的笔误,这里补上并让界面拿到规范值回显。
			return service.setRelayBaseUrl(normalizeRelayAddress(raw).webSocketUrl);
		},

		createInvite: async () => service.createInvite(),

		testRelay: async (payload) => {
			const raw = readOptionalString(payload, "relayBaseUrl") ?? service.getState().relayBaseUrl;
			if (raw === undefined) return { ok: false, detail: "还没有填中继地址" };
			return probeRelay(raw);
		},

		withdrawInvite: async () => {
			await service.withdrawInvite();
			return service.getState();
		},

		revokeDevice: async (payload) => {
			const deviceId = readString(payload, "deviceId");
			return service.revokeDevice(deviceId);
		},
	};
}

function asRecord(payload: unknown): Record<string, unknown> {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		throw new Error("载荷必须是对象");
	}
	return payload as Record<string, unknown>;
}

function readBoolean(payload: unknown, field: string): boolean {
	const value = asRecord(payload)[field];
	if (typeof value !== "boolean") throw new Error(`${field} 必须是布尔值`);
	return value;
}

function readString(payload: unknown, field: string): string {
	const value = asRecord(payload)[field];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${field} 必须是非空字符串`);
	return value;
}

/** 连接目标(host / user / port / 认证方式)。密码只在这一层出现,不写进任何持久状态。 */
function readTargetInputs(record: Record<string, unknown>): {
	server: string;
	user: string;
	domain?: string;
	relayPort?: number;
	publicPort?: number;
	facts?: DeployPlanInput["facts"];
} {
	const domain = readOptionalString(record, "domain");
	/**
	 * 探测结果**整份**带过来(界面刚探过),据此决定:跳过哪些步骤、走哪条反代路线。
	 *
	 * 以前只传了 `nodeMajor` / `nodeVersion` 两项 —— 于是"nginx 在跑"这类事实到不了计划,
	 * 计划永远按 Caddy 走(真实抱怨:探测说 nginx=yes,却还是去装 Caddy)。
	 * 现在传**整份**:以后探测里加一项,不用再改这条链路。
	 */
	const facts = readFacts(record.facts);
	const relayPort = readOptionalPort(record, "relayPort");
	const publicPort = readOptionalPort(record, "publicPort");
	return {
		server: readString(record, "server"),
		user: readString(record, "user"),
		...(domain === undefined ? {} : { domain }),
		...(relayPort === undefined ? {} : { relayPort }),
		...(publicPort === undefined ? {} : { publicPort }),
		...(facts === undefined ? {} : { facts }),
	};
}

/**
 * 读探测结果。
 *
 * 只收**认得的字段与类型**:探测是我们自己发的,但这份数据经渲染层转了一圈,
 * 缺字段、多字段、类型不对都不该让计划崩 —— 收不进来的当"没探测过"。
 */
function readFacts(value: unknown): {
	node?: { present: boolean; version?: string; major?: number };
	distro?: { id?: string; version?: string };
	caddy?: boolean;
	caddyActive?: boolean;
	nginx?: boolean;
	nginxActive?: boolean;
	deployDirExists?: boolean;
	deployedVersion?: string;
	serviceExists?: boolean;
	serviceActive?: boolean;
	nginxSiteExists?: boolean;
	caddyBlockExists?: boolean;
	listeningPorts?: readonly number[];
	aptBusy?: boolean;
	sudoNoPassword?: boolean;
} | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const bool = (field: string): boolean | undefined =>
		typeof record[field] === "boolean" ? (record[field] as boolean) : undefined;
	const node = typeof record.node === "object" && record.node !== null ? (record.node as Record<string, unknown>) : undefined;
	const distro =
		typeof record.distro === "object" && record.distro !== null ? (record.distro as Record<string, unknown>) : undefined;
	const ports = Array.isArray(record.listeningPorts)
		? record.listeningPorts.filter((entry): entry is number => typeof entry === "number")
		: undefined;
	return {
		...(node === undefined
			? {}
			: {
					node: {
						present: node.present === true,
						...(typeof node.version === "string" ? { version: node.version } : {}),
						...(typeof node.major === "number" ? { major: node.major } : {}),
					},
				}),
		...(distro === undefined
			? {}
			: {
					distro: {
						...(typeof distro.id === "string" ? { id: distro.id } : {}),
						...(typeof distro.version === "string" ? { version: distro.version } : {}),
					},
				}),
		...(bool("caddy") === undefined ? {} : { caddy: bool("caddy") }),
		...(bool("caddyActive") === undefined ? {} : { caddyActive: bool("caddyActive") }),
		...(bool("nginx") === undefined ? {} : { nginx: bool("nginx") }),
		...(bool("nginxActive") === undefined ? {} : { nginxActive: bool("nginxActive") }),
		...(bool("deployDirExists") === undefined ? {} : { deployDirExists: bool("deployDirExists") }),
		...(typeof record.deployedVersion === "string" && record.deployedVersion.length > 0
			? { deployedVersion: record.deployedVersion }
			: {}),
		...(bool("serviceExists") === undefined ? {} : { serviceExists: bool("serviceExists") }),
		...(bool("serviceActive") === undefined ? {} : { serviceActive: bool("serviceActive") }),
		...(bool("nginxSiteExists") === undefined ? {} : { nginxSiteExists: bool("nginxSiteExists") }),
		...(bool("caddyBlockExists") === undefined ? {} : { caddyBlockExists: bool("caddyBlockExists") }),
		...(ports === undefined ? {} : { listeningPorts: ports }),
		...(bool("aptBusy") === undefined ? {} : { aptBusy: bool("aptBusy") }),
		...(bool("sudoNoPassword") === undefined ? {} : { sudoNoPassword: bool("sudoNoPassword") }),
	};
}

/** 端口:非整数或超范围就当没填(计划那边还会再收一道,退回默认)。 */
function readOptionalPort(record: Record<string, unknown>, field: string): number | undefined {
	const value = record[field];
	if (value === undefined || value === null || value === "") return undefined;
	const port = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
	return port;
}

/**
 * 卸载的输入:**服务器/用户**照旧,外加"停用还是卸载"与探测结果。
 *
 * scope 收一道值域:`remove` 是不可逆的那一档,不能让一个拼错的字符串意外走到它。
 */
function readUninstallInput(payload: unknown): Parameters<typeof remoteUninstallPlan>[0] {
	const record = asRecord(payload);
	const scope = record.scope;
	if (scope !== "stop" && scope !== "remove") throw new Error("scope 必须是 stop 或 remove");
	const relayPort = readOptionalPort(record, "relayPort");
	const facts = readUninstallFacts(record.facts);
	return {
		scope,
		...(relayPort === undefined ? {} : { relayPort }),
		...(facts === undefined ? {} : { facts }),
	};
}

/** 卸载要看的那四项(与 `DeployProbeFacts` 同一份来源,只是这里只取用得上的)。 */
function readUninstallFacts(value: unknown): Parameters<typeof remoteUninstallPlan>[0]["facts"] {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const bool = (field: string): boolean | undefined =>
		typeof record[field] === "boolean" ? (record[field] as boolean) : undefined;
	const facts = {
		...(bool("deployDirExists") === undefined ? {} : { deployDirExists: bool("deployDirExists") }),
		...(bool("serviceExists") === undefined ? {} : { serviceExists: bool("serviceExists") }),
		...(bool("serviceActive") === undefined ? {} : { serviceActive: bool("serviceActive") }),
		...(bool("nginxSiteExists") === undefined ? {} : { nginxSiteExists: bool("nginxSiteExists") }),
		...(bool("caddyBlockExists") === undefined ? {} : { caddyBlockExists: bool("caddyBlockExists") }),
	};
	return Object.keys(facts).length === 0 ? undefined : facts;
}

function readTarget(payload: unknown): SshTarget {
	const record = asRecord(payload);
	const port = record.port;
	const password = record.password;
	return {
		host: readString(record, "server"),
		user: readString(record, "user"),
		...(typeof port === "number" && Number.isInteger(port) ? { port } : {}),
		auth:
			typeof password === "string" && password.length > 0
				? { kind: "password", password }
				: { kind: "key" },
	};
}

function readMode(payload: unknown): "lan" | "remote" {
	const value = asRecord(payload).mode;
	if (value !== "lan" && value !== "remote") throw new Error("mode 必须是 lan 或 remote");
	return value;
}

function readOptionalString(payload: unknown, field: string): string | undefined {
	const value = asRecord(payload)[field];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error(`${field} 必须是字符串`);
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}
