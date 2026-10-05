import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEPLOY_REMOTE_DIR, type DeployStep } from "./deploy-plan.ts";

/**
 * 远程部署的执行器:**用系统的 `ssh` / `scp`**,不内嵌 SSH 库。
 *
 * 三条理由:
 * 1. 复用用户**已经配好的**密钥、agent、`~/.ssh/config`、跳板机配置 —— 那是他们机器上的既有事实;
 * 2. 密码认证走 `SSH_ASKPASS`(见下),**不经过命令行** —— 命令行对同机的任何进程可见;
 * 3. 桌面端已有 spawn 的先例(`environment/shell-environment.ts`),行为可预期。
 *
 * 与教程的关系:**跑的就是教程里显示的那一份命令**(`deploy-plan.ts` 是唯一真源)。
 * 预览与执行不一致的话,用户看到的"将要做什么"就是假的。
 */

/** 连接目标。 */
export interface SshTarget {
	readonly host: string;
	readonly user: string;
	readonly port?: number;
	/**
	 * 认证方式。
	 *
	 * `key` 是默认:直接用系统 ssh 的密钥/agent。`password` 只用于**这一次连接** ——
	 * 不落盘、不进日志、不进命令行,连接结束(无论成败)立刻删掉临时文件。
	 */
	readonly auth: { readonly kind: "key" } | { readonly kind: "password"; readonly password: string };
}

export interface DeployProgress {
	readonly index: number;
	readonly id: string;
	readonly status: "running" | "done" | "failed";
	/** 这一步到目前为止的输出(有上限;`failed` 时带 stderr)。 */
	readonly output?: string;
}

export interface ProbeResult {
	readonly ok: boolean;
	/** 一行一条的发现(系统、Node、用户、目录权限……),给界面原样显示。 */
	readonly findings: readonly string[];
	/**
	 * **结构化**的探测结果。
	 *
	 * 只给界面看是不行的:计划要**据此决定做哪些步骤** —— 服务器上已经有 Node 20 时,
	 * 那一步就该跳过,而不是"反正装上也没坏处"(强制安装会改掉别人机器上的环境,
	 * 还可能把正在跑的东西换掉)。
	 */
	readonly facts: {
		readonly system?: string;
		readonly user?: string;
		readonly sudo: boolean;
		readonly arch?: string;
		/** Node:没装是 `present: false`,装了带版本与主版本号(判断够不够用)。 */
		readonly node: { readonly present: boolean; readonly version?: string; readonly major?: number };
		/**
		 * 发行版。我们的命令是 `apt-get` + `deb.nodesource.com` 那一套 ——
		 * 在 CentOS / Alpine 上直接失败,而且失败的样子(某一步 exit 1)完全看不出是"系统不对"。
		 */
		readonly distro?: { readonly id?: string; readonly version?: string };
		/** 反向代理装没装(有就不必再装一遍 —— apt 虽然幂等,但每次 update 都很慢)。 */
		readonly caddy: boolean;
		/**
		 * 反向代理**在不在跑**。
		 *
		 * "装着"和"在跑"是两件事:真实踩到过 `caddy.service is not active, cannot reload` ——
		 * 刚装好的机器上它可能还没起来(或者上一次装到一半被打断了)。
		 */
		readonly caddyActive: boolean;
		/**
		 * nginx 装没装、在不在跑。
		 *
		 * 这件事决定了**走哪条反代路线**:nginx 在跑说明它多半已经占着 80/443 ——
		 * 那时候装 Caddy 是没用的(它绑不上端口,证书也签不下来),应该改用 nginx 自己的配置。
		 */
		readonly nginx: boolean;
		readonly nginxActive: boolean;
		/** 目标目录在不在(在 = 这台服务器上已经部署过,这次是覆盖升级)。 */
		readonly deployDirExists: boolean;
		/** 服务器上那一版(读不出来 = 上一次部署比"写版本文件"更早,一定是旧的)。 */
		readonly deployedVersion?: string;
		/** 卸载要看这四项:服务单元、服务是否活着、我们写的 nginx 站点、Caddyfile 里我们那一段。 */
		readonly serviceExists: boolean;
		readonly serviceActive: boolean;
		readonly nginxSiteExists: boolean;
		readonly caddyBlockExists: boolean;
		/** 被测端口有没有人在监听。 */
		readonly listeningPorts: readonly number[];
		/** 现在有没有 apt / unattended-upgrades 在跑(会占着 dpkg 的锁)。 */
		readonly aptBusy: boolean;
		/**
		 * `sudo -n true` 通不通,也就是**不用密码**就能 sudo。
		 *
		 * 不通的话自动部署没法进行:我们是拿 `ssh host bash -s` 跑命令的,没有终端可以输密码,
		 * 于是 `sudo` 会以 "a password is required" 失败 —— 而那句话看不出"你得先配 NOPASSWD"。
		 */
		readonly sudoNoPassword: boolean;
	};
	readonly error?: string;
}

export interface DeployRunResult {
	readonly ok: boolean;
	/** 失败的那一步 id(成功了就没有)。 */
	readonly failedStep?: string;
	readonly error?: string;
}

export interface SshDeployOptions {
	/** 只给测试用:注入 spawn。 */
	readonly spawn?: typeof nodeSpawn;
	/** 只给测试用:临时目录的根。 */
	readonly tmpRoot?: string;
	/** 单步超时(毫秒)。装 Node 那一步在慢机器上确实要几分钟。 */
	readonly stepTimeoutMs?: number;
}

/** 输出上限:远端可能刷屏(apt 装 Node),而界面只需要看到"最后发生了什么"。 */
const MAX_OUTPUT_CHARS = 20_000;

/**
 * 只读探测:一条命令问完所有需要知道的事,不装、不写、不改。
 *
 * 问的东西分两类,这也是"要不要探测"的判断标准:
 *
 * 1. **我们会装的**(Node / Caddy)—— 已经装了就别装第二遍;
 * 2. **会和我们冲突的**(端口被占、发行版不对、目录已有内容)—— 这些如果不问,
 *    失败会以"某一步 exit 1"的形式出现,而那句话完全看不出真正的原因。
 *
 * 端口用 bash 的 `/dev/tcp` 测:不依赖 `ss` / `netstat` / `lsof`(它们不一定装)。
 */
function probeCommand(ports: readonly number[]): string {
	return [
		"set -e",
		"echo system=$(uname -srm)",
		"echo user=$(id -un)",
		"echo sudo=$(command -v sudo >/dev/null 2>&1 && echo yes || echo no)",
		"echo node=$(command -v node >/dev/null 2>&1 && node -v || echo none)",
		"echo arch=$(uname -m)",
		// `/etc/os-release` 是 systemd 系的通行做法;读不到就留空(不猜)。
		'id=$(. /etc/os-release 2>/dev/null && printf %s "${ID:-}")',
		'version=$(. /etc/os-release 2>/dev/null && printf %s "${VERSION_ID:-}")',
		'echo distro=$id',
		'echo distro_version=$version',
		"echo caddy=$(command -v caddy >/dev/null 2>&1 && echo yes || echo no)",
		"echo caddyactive=$(systemctl is-active caddy >/dev/null 2>&1 && echo yes || echo no)",
		"echo nginx=$(command -v nginx >/dev/null 2>&1 && echo yes || echo no)",
		"echo nginxactive=$(systemctl is-active nginx >/dev/null 2>&1 && echo yes || echo no)",
		'echo nginxrunning=$((pgrep -x nginx >/dev/null 2>&1 || pgrep -f "nginx: master" >/dev/null 2>&1) && echo yes || echo no)',
		// 正在跑 apt 的话会占着 dpkg 的锁:我们知道这件事(并且会等),但用户看到"卡住"时得能对上号。
		'echo aptbusy=$((pgrep -x apt-get >/dev/null 2>&1 || pgrep -f unattended-upgr >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1) && echo yes || echo no)',
		// 不用密码能不能 sudo:不能的话自动部署跑不下去(没有终端可以输密码)。
		"echo sudonopass=$(sudo -n true >/dev/null 2>&1 && echo yes || echo no)",
		`echo deploydir=$([ -d ${DEPLOY_REMOTE_DIR} ] && echo yes || echo no)`,
		/*
			服务器上那一版的版本号。**读不出来就不报这一行** —— 那说明上一次部署发生在
			"我们开始写 version.json"之前,而"读不出来"这件事本身就是要告诉用户的
			(它一定是旧的,重新部署一次就会写上)。
		*/
		// 用 `grep -o` 取,不用 `sed` 的反向引用:那串 `\1` 在 JS 模板串里是八进制转义。
		`[ -f ${DEPLOY_REMOTE_DIR}/version.json ] && echo deployedversion=$(grep -o '"version"[^,}]*' ${DEPLOY_REMOTE_DIR}/version.json | head -1 | cut -d'"' -f4)`,
		/*
			**卸载要问的四件事**:服务、目录、我们写的 nginx 站点、Caddyfile 里我们那一段。

			卸载是"删东西",所以"服务器上到底有什么"必须**先问清楚**:只删探到的,
			没探到的就跳过并说明 —— 而不是照着脚本盲删一遍(那在别人的机器上是很危险的动作)。
		*/
		"echo serviceexists=$([ -f /etc/systemd/system/wordless-relay.service ] && echo yes || echo no)",
		"echo serviceactive=$(systemctl is-active wordless-relay >/dev/null 2>&1 && echo yes || echo no)",
		"echo nginxconf=$([ -f /etc/nginx/conf.d/wordless-relay.conf ] && echo yes || echo no)",
		// 普通 grep 先试(`/etc/caddy/Caddyfile` 一般人人可读),不行再一次**免密** sudo ——
		// 不带 `-n` 的 sudo 会挂在那里等密码,而探测是只读的、不该卡住。
		"echo caddyblock=$((grep -q wordless-relay /etc/caddy/Caddyfile 2>/dev/null || sudo -n grep -q wordless-relay /etc/caddy/Caddyfile 2>/dev/null) && echo yes || echo no)",
		...ports.map(
			(port) => `echo port_${port}=$((exec 3<>/dev/tcp/127.0.0.1/${port}) 2>/dev/null && echo yes || echo no)`,
		),
	].join("\n");
}

export class SshDeploy {
	private readonly options: SshDeployOptions;
	private current: ChildProcessWithoutNullStreams | undefined;
	private cancelled = false;

	constructor(options: SshDeployOptions = {}) {
		this.options = options;
	}

	/** 取消正在跑的那一步(杀掉的只是当前子进程,服务器上的服务不受影响)。 */
	cancel(): void {
		this.cancelled = true;
		this.current?.kill("SIGTERM");
		this.current = undefined;
	}

	/**
	 * 只读探测 —— **动手之前先问清楚**。
	 *
	 * 它只跑一条 `uname` / `command -v` 级别的命令:不改服务器上的任何东西。
	 * 探不通(密码错、端口不对、防火墙挡着)时,后面那些步骤一步都不会跑。
	 */
	async probe(target: SshTarget, ports: readonly number[] = [80, 443]): Promise<ProbeResult> {
		const result = await this.withAuth(target, async (env) => {
			const run = await this.runShell(target, probeCommand(ports), env);
			return run;
		});
		if (!result.ok) {
			return {
				ok: false,
				findings: [],
				facts: {
					sudo: false,
					node: { present: false },
					caddy: false,
					caddyActive: false,
					nginx: false,
					nginxActive: false,
					deployDirExists: false,
					// 探不通 = 什么都不知道:全部按"没有"算(卸载那边据此一行都不动)。
					serviceExists: false,
					serviceActive: false,
					nginxSiteExists: false,
					caddyBlockExists: false,
					listeningPorts: [],
					aptBusy: false,
					sudoNoPassword: false,
				},
				error: result.output.trim() || "连不上这台服务器",
			};
		}
		const findings = result.output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.includes("="));
		return { ok: true, findings, facts: factsFrom(findings) };
	}

	/**
	 * 逐步执行。
	 *
	 * **一步一跑、一步一报**:失败了立刻停(后面那些步骤建立在前面成功之上),
	 * 并把那一步的输出原样交给界面 —— 不给"部署失败"四个字。
	 */
	async run(
		target: SshTarget,
		steps: readonly DeployStep[],
		onProgress: (progress: DeployProgress) => void,
	): Promise<DeployRunResult> {
		this.cancelled = false;
		return this.withAuth(target, async (env) => {
			for (const [index, step] of steps.entries()) {
				if (this.cancelled) return { ok: false, error: "已取消" };
				onProgress({ index, id: step.id, status: "running" });
				const result =
					step.target === "local"
						? await this.runLocal(step.command, env)
						: await this.runShell(target, step.command, env);
				if (!result.ok) {
					onProgress({ index, id: step.id, status: "failed", output: clamp(result.output) });
					return { ok: false, failedStep: step.id, error: result.output.trim() || "这一步失败了" };
				}
				onProgress({ index, id: step.id, status: "done", output: clamp(result.output) });
			}
			return { ok: true };
		});
	}

	/**
	 * 认证的准备与收尾。
	 *
	 * 密码那一条路:生成一个**只读一次**的 askpass 脚本(0700,临时目录 0700),
	 * 让 ssh 从它那里取密码 —— 这样密码不出现在命令行、也不出现在日志里。
	 * `finally` 里**一定删掉**(成功、失败、异常都一样)。
	 */
	private async withAuth<T>(
		target: SshTarget,
		body: (env: NodeJS.ProcessEnv) => Promise<T>,
	): Promise<T> {
		if (target.auth.kind === "key") {
			return body({ ...process.env, SSH_ASKPASS: "", SSH_ASKPASS_REQUIRE: "never" });
		}
		const parent = this.options.tmpRoot ?? tmpdir();
		// 目录 0700:里面那个脚本会短暂地持有密码,别人不该看得见。
		await mkdir(parent, { recursive: true, mode: 0o700 });
		const root = await mkdtemp(join(parent, "wordless-ssh-"));
		const script = join(root, "askpass.sh");
		try {
			// 密码写在脚本里(文件 0700、目录 0700),而不是命令行参数。
			await writeFile(script, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(target.auth.password)}\n`, { mode: 0o700 });
			await chmod(script, 0o700);
			return await body({
				...process.env,
				SSH_ASKPASS: script,
				// `force`:没有 tty 时也要用 askpass(否则 ssh 直接放弃)。
				SSH_ASKPASS_REQUIRE: "force",
				DISPLAY: process.env.DISPLAY ?? ":0",
			});
		} finally {
			await rm(root, { recursive: true, force: true }).catch(() => undefined);
		}
	}

	/** 在服务器上跑一段 shell(命令从 stdin 进,避开一层引号地狱)。 */
	private runShell(
		target: SshTarget,
		command: string,
		env: NodeJS.ProcessEnv,
	): Promise<{ ok: boolean; output: string }> {
		const args = [
			...this.commonArgs(target),
			// 第一次连接记录指纹;之后**变了就拒绝** —— 这才是防中间人的那一半。
			"-o",
			"StrictHostKeyChecking=accept-new",
			"-o",
			"ConnectTimeout=10",
			...(target.port === undefined ? [] : ["-p", String(target.port)]),
			`${target.user}@${target.host}`,
			"bash -s",
		];
		return this.spawnCollect("ssh", args, env, command);
	}

	/** 在本机跑(上传那一步:scp 从这台电脑往外传)。 */
	private runLocal(command: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; output: string }> {
		return this.spawnCollect("/bin/bash", ["-lc", command], env);
	}

	/** 认证与主机密钥的公共参数。 */
	private commonArgs(target: SshTarget): readonly string[] {
		const base = ["-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=publickey,password"];
		// 密钥认证下不给交互的机会:能连就连,连不上就报错(否则会挂在那里等输入)。
		return target.auth.kind === "key" ? ["-o", "BatchMode=yes", ...base] : base;
	}

	private spawnCollect(
		command: string,
		args: readonly string[],
		env: NodeJS.ProcessEnv,
		stdin?: string,
	): Promise<{ ok: boolean; output: string }> {
		const spawn = this.options.spawn ?? nodeSpawn;
		return new Promise((resolve) => {
			let child: ChildProcessWithoutNullStreams;
			try {
				child = spawn(command, [...args], { env, stdio: "pipe" }) as ChildProcessWithoutNullStreams;
			} catch (cause) {
				resolve({ ok: false, output: cause instanceof Error ? cause.message : String(cause) });
				return;
			}
			this.current = child;
			let output = "";
			const collect = (chunk: Buffer | string) => {
				output += chunk.toString();
				if (output.length > MAX_OUTPUT_CHARS * 2) output = output.slice(-MAX_OUTPUT_CHARS);
			};
			child.stdout?.on("data", collect);
			child.stderr?.on("data", collect);
			const timer = setTimeout(
				() => {
					child.kill("SIGTERM");
					collect("\n(这一步超时了)");
				},
				this.options.stepTimeoutMs ?? 300_000,
			);
			child.on("error", (error) => {
				clearTimeout(timer);
				this.current = undefined;
				resolve({ ok: false, output: `${output}\n${error.message}`.trim() });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				this.current = undefined;
				resolve({ ok: code === 0, output: clamp(output) });
			});
			if (stdin !== undefined) {
				child.stdin?.end(stdin);
			} else {
				child.stdin?.end();
			}
		});
	}
}

/** 把 `key=value` 那几行折成结构化的东西(探测命令的输出格式就是它自己定的)。 */
function factsFrom(findings: readonly string[]): ProbeResult["facts"] {
	const value = (key: string): string | undefined => {
		const line = findings.find((entry) => entry.startsWith(`${key}=`));
		const raw = line?.slice(key.length + 1).trim();
		return raw === undefined || raw.length === 0 ? undefined : raw;
	};
	const nodeVersion = value("node");
	const present = nodeVersion !== undefined && nodeVersion !== "none";
	const major = present ? Number.parseInt((nodeVersion ?? "").replace(/^v/, ""), 10) : undefined;
	const distroId = value("distro");
	// `port_<n>=yes` 那几行折成数组:计划据此说"这个端口已经有人在用"。
	const listeningPorts = findings
		.filter((entry) => entry.startsWith("port_"))
		.flatMap((entry) => {
			const [key, flag] = entry.split("=");
			const port = Number.parseInt((key ?? "").replace("port_", ""), 10);
			return flag === "yes" && Number.isFinite(port) ? [port] : [];
		});
	return {
		...(value("system") === undefined ? {} : { system: value("system") }),
		...(value("user") === undefined ? {} : { user: value("user") }),
		sudo: value("sudo") === "yes",
		...(value("arch") === undefined ? {} : { arch: value("arch") }),
		node: {
			present,
			...(present && nodeVersion !== undefined ? { version: nodeVersion } : {}),
			...(major !== undefined && Number.isFinite(major) ? { major } : {}),
		},
		...(distroId === undefined ? {} : { distro: { id: distroId, ...(value("distro_version") === undefined ? {} : { version: value("distro_version") }) } }),
		caddy: value("caddy") === "yes",
		caddyActive: value("caddyactive") === "yes",
		nginx: value("nginx") === "yes",
		// "在不在跑"取**两个信号**的并集:systemd 说在跑,或者有 nginx 进程(手动起的 / Docker 里的)。
		nginxActive: value("nginxactive") === "yes" || value("nginxrunning") === "yes",
		deployDirExists: value("deploydir") === "yes",
		...(value("deployedversion") === undefined ? {} : { deployedVersion: value("deployedversion") as string }),
		serviceExists: value("serviceexists") === "yes",
		serviceActive: value("serviceactive") === "yes",
		nginxSiteExists: value("nginxconf") === "yes",
		caddyBlockExists: value("caddyblock") === "yes",
		listeningPorts,
		aptBusy: value("aptbusy") === "yes",
		// 只读探测本身**不改**服务器;这里只问"能不能免密 sudo",不做任何 sudo 操作。
		sudoNoPassword: value("sudonopass") === "yes",
	};
}

function clamp(output: string): string {
	return output.length <= MAX_OUTPUT_CHARS ? output : output.slice(-MAX_OUTPUT_CHARS);
}

/** 单引号包裹:密码里可能有引号、`$`、空格 —— 不能让它们被 shell 解释。 */
function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
