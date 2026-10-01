import { spawn } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { resolveShellConfig, shellKindOf } from "@wordless/agent/node";
import type {
	HostEnvironmentFacts,
	HostPythonDependency,
	HostPythonProvisionResult,
	HostRuntimeSource,
	HostShellKind,
} from "@wordless/protocol";
import { DATA_ANALYSIS_PYTHON_PACKAGES, pinnedRequirements, PYTHON_PACKAGE_MIRROR } from "./python-packages.ts";

/**
 * 宿主环境:这台机器上有什么可用的命令解释器与运行时。
 *
 * 为什么要有这个服务:在此之前,"这台机器有没有 Python"是**数据功能自己**的私事
 * (`DesktopDataAnalysisService.detectPython`),而 agent 的命令工具对它一无所知。于是同一个事实会有
 * 两份、彼此矛盾(面板说"Python ✓"、数据功能说"缺 pandas")。这里把它收成一个真源,后续的失败提示、
 * 设置面板、导览共读同一份。
 *
 * 三条纪律:
 * - **探测不阻塞任何关键路径**:缓存 promise,谁先问谁触发。
 * - **失败静默降级**:探不到就是"没有",绝不因为探测本身抛错而让调用方失败。
 * - **不写用户的任何文件**,只执行固定候选表里的命令(见 `probeCwd` 的注释)。
 */

/** 事实的形状与协议共用(面板要读同一份),所以别名到这里,不在两处各写一遍。 */
export type PythonDependency = HostPythonDependency;

export interface PythonRuntime {
	command: string;
	args: string[];
	version: string;
	dependencies: Record<PythonDependency, boolean>;
	/** 来自 Wordless 内置的那份(而不是用户机器上装的)。 */
	bundled?: boolean;
}

export type NodeSource = HostRuntimeSource;
export type ShellKind = HostShellKind;
export type { HostEnvironmentFacts };

export interface NodeState {
	source: NodeSource;
	version?: string;
}

export interface HostRunOptions {
	cwd?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** 覆盖环境变量(探测"系统版"时要用注入前的 PATH)。 */
	env?: NodeJS.ProcessEnv;
}

export interface HostEnvironmentOptions {
	/** 测试用来改写平台,免得为了断言 Windows 分支而真的跑在 Windows 上。 */
	platform?: NodeJS.Platform;
	/** 测试用来注入进程执行结果(不依赖开发机装了什么)。 */
	run?: (command: string, args: readonly string[], options?: HostRunOptions) => Promise<string>;
	/** Node 兜底脚本放在这里(主进程注入 userData 下的目录)。不传 = 不做兜底。 */
	binDirectory?: string;
	/** 自带 Node 就是"这个二进制 + ELECTRON_RUN_AS_NODE=1"。默认 `process.execPath`。 */
	electronBinaryPath?: string;
	/** 要改 PATH 的就是它(默认 `process.env`;测试传一个普通对象,免得动全局)。 */
	env?: NodeJS.ProcessEnv;
	/** 系统 Node 的最低版本,低于它就改用我们自带的。 */
	minimumNodeMajor?: number;
	/** 打包进来的 Python 在哪(`<resources>/python/<platform>-<arch>`)。不传 = 没有内置的。 */
	pythonVendorDirectory?: string;
	/** 内置运行时的落盘位置(默认 `<用户目录>/runtimes`)。 */
	runtimesDirectory?: string;
}

/**
 * Python 不可用。**只描述事实**,不提"什么功能要它" —— 那属于调用方的文案。
 *
 * 这么分是因为这个服务被多个功能共用:数据功能会对用户说"数据操作需要 pandas",另一个功能会说别的。
 * 服务里塞进任何一个功能的措辞,就等于把那个功能的文案钉死在公共服务上。
 */
export class PythonUnavailableError extends Error {
	readonly dependencies: readonly PythonDependency[];
	readonly hasPython: boolean;

	constructor(dependencies: readonly PythonDependency[], hasPython: boolean) {
		super(
			hasPython
				? `Missing Python packages: ${dependencies.join(", ")}`
				: "No Python 3 runtime found on this machine",
		);
		this.name = "PythonUnavailableError";
		this.dependencies = dependencies;
		this.hasPython = hasPython;
	}
}

const PROBE_TIMEOUT_MS = 5_000;
/** 低于这个版本的 Node 当作"没有":agent 的脚本会用到现代语法,一个 node 12 只会带来更难的错误。 */
const DEFAULT_MINIMUM_NODE_MAJOR = 18;
const MAX_PROCESS_OUTPUT = 2_000_000;
/** 重探节流:模型连着失败时会反复触发重探,这里把每类压到 10 秒一次。 */
const REFRESH_THROTTLE_MS = 10_000;

const PYTHON_DEPENDENCIES: readonly PythonDependency[] = ["openpyxl", "pyarrow", "pandas"];

/** 内置运行时的版本标记文件(打包时由 prepare-python-runtime.mjs 写,首启据此决定要不要拷)。 */
const PYTHON_MARKER_FILE = ".wordless-python-version";
const SKIPPED_MARKER = "skipped";

/** 三个依赖名只在这里写一次 —— 面板、探测、空事实三处共用一个来源。 */
function emptyPackages(): Record<PythonDependency, boolean> {
	const entries = PYTHON_DEPENDENCIES.map((dependency) => [dependency, false] as const);
	return Object.fromEntries(entries) as Record<PythonDependency, boolean>;
}

const DEPENDENCY_PROBE_SCRIPT =
	"import importlib.util,json,sys;print(json.dumps({'executable':sys.executable,'openpyxl':bool(importlib.util.find_spec('openpyxl')),'pyarrow':bool(importlib.util.find_spec('pyarrow')),'pandas':bool(importlib.util.find_spec('pandas'))}))";

/**
 * 探测时的工作目录。
 *
 * **刻意不用工作区**:Windows 上 CreateProcess 会先搜当前目录,如果拿工作区当 cwd,一个放在里面的
 * `node.exe` / `python.exe` 就会被我们探到并执行 —— 那是"用别人的目录当命令来源"的经典坑。临时目录
 * 与工作区无关,也不该被写。
 */
function probeCwd(): string {
	return tmpdir();
}

/**
 * 候选命令。顺序即优先级:Windows 的 `py -3` 与带版本号的 `py -3.x` 是那台机器上最可靠的入口
 * (Store 上的假 `python` 别名要靠"输出确实是 Python 3.x"才骗不过),POSIX 上 `python3` 优先。
 */
function pythonCandidates(platform: NodeJS.Platform): { command: string; args: string[] }[] {
	if (platform === "win32") {
		return [
			{ command: "py", args: ["-3"] },
			...["3.14", "3.13", "3.12", "3.11", "3.10", "3.9"].map((version) => ({ command: "py", args: [`-${version}`] })),
			{ command: "python", args: [] },
			{ command: "python3", args: [] },
		];
	}
	return [
		{ command: "python3", args: [] },
		{ command: "python", args: [] },
	];
}

function parseVersion(output: string): string | undefined {
	return output.match(/(\d+\.\d+\.\d+)/)?.[1];
}

function majorOf(version: string): number {
	return Number.parseInt(version.split(".")[0] ?? "", 10) || 0;
}

export class HostEnvironmentService {
	private readonly platform: NodeJS.Platform;
	private readonly runProcess: (command: string, args: readonly string[], options?: HostRunOptions) => Promise<string>;
	private pythonRuntimesPromise: Promise<PythonRuntime[]> | undefined;
	private factsPromise: Promise<HostEnvironmentFacts> | undefined;
	private readonly lastRefreshAt = new Map<string, number>();

	private readonly binDirectory: string | undefined;
	private readonly electronBinaryPath: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly minimumNodeMajor: number;
	/**
	 * 注入前的 PATH,在构造时抓。
	 *
	 * 探测"系统 Node"必须用它:否则我们自己放到最前面的那层兜底会被当成系统版,于是"用户装没装 node"
	 * 这个问题永远答成"装了"。(构造发生在登录 shell 的 PATH 导入之后 —— 那份是用户真实的 PATH,要算数。)
	 */
	private readonly systemPath: string;
	private readonly pythonVendorDirectory: string | undefined;
	private readonly runtimesDirectory: string | undefined;
	private nodeState: NodeState | undefined;
	private pythonSeedPromise: Promise<string | undefined> | undefined;

	constructor(options: HostEnvironmentOptions = {}) {
		this.platform = options.platform ?? process.platform;
		this.runProcess = options.run ?? ((command, args, runOptions) => runProcess(command, args, runOptions));
		this.binDirectory = options.binDirectory;
		this.electronBinaryPath = options.electronBinaryPath ?? process.execPath;
		this.env = options.env ?? process.env;
		this.minimumNodeMajor = options.minimumNodeMajor ?? DEFAULT_MINIMUM_NODE_MAJOR;
		this.systemPath = pathValueOf(this.env);
		this.pythonVendorDirectory = options.pythonVendorDirectory;
		this.runtimesDirectory = options.runtimesDirectory;
	}

	async run(command: string, args: readonly string[], options: HostRunOptions = {}): Promise<string> {
		return await this.runProcess(command, args, options);
	}

	/** 探测结果缓存到进程结束;`refresh()` 才让它失效。 */
	async pythonRuntimes(): Promise<PythonRuntime[]> {
		this.pythonRuntimesPromise ??= this.detectPythonRuntimes().catch(() => []);
		return await this.pythonRuntimesPromise;
	}

	async requirePython(dependencies: readonly PythonDependency[] = []): Promise<PythonRuntime> {
		const runtimes = await this.pythonRuntimes();
		const runtime = runtimes.find((candidate) => dependencies.every((dependency) => candidate.dependencies[dependency]));
		if (runtime) return runtime;
		throw new PythonUnavailableError(dependencies, runtimes.length > 0);
	}

	async runPython(
		runtime: PythonRuntime,
		script: string,
		args: readonly string[],
		cwd: string,
		signal: AbortSignal | undefined,
		timeoutMs: number,
	): Promise<string> {
		return await this.run(runtime.command, [...runtime.args, script, ...args], { cwd, signal, timeoutMs });
	}

	/** 这台机器的事实。任何一项探不到都只是"没有",不抛错。 */
	async facts(): Promise<HostEnvironmentFacts> {
		this.factsPromise ??= this.detectFacts().catch(() => emptyFacts(this.platform));
		return await this.factsPromise;
	}

	/**
	 * 让缓存失效并重探(设置面板的"重新探测"、以及"同类失败之后"用)。
	 *
	 * 节流是必须的:失败会连着发生,不加节流就等于把探测挂在失败路径上反复跑子进程。
	 * `force` 给显式用户操作:点了就该真的再探,不该因为"10 秒内刚探过"而看起来没反应。
	 */
	async refresh(kind: "all" | "shell" | "node" | "python" = "all", options: { force?: boolean } = {}): Promise<void> {
		const now = Date.now();
		const last = this.lastRefreshAt.get(kind) ?? 0;
		// 显式操作(面板上的"重新探测")不受节流:用户点了就该真的再探一遍。节流只挡自动路径。
		if (!options.force && now - last < REFRESH_THROTTLE_MS) return;
		this.lastRefreshAt.set(kind, now);
		this.factsPromise = undefined;
		if (kind === "all" || kind === "node") this.nodeState = undefined;
		if (kind === "all" || kind === "python") {
			this.pythonRuntimesPromise = undefined;
			// 应用更新后内置那份可能换了版本:重探时重新读一次版本标记。
			this.pythonSeedPromise = undefined;
		}
	}

	private async detectPythonRuntimes(): Promise<PythonRuntime[]> {
		const runtimes: PythonRuntime[] = [];
		const identities = new Set<string>();
		for (const candidate of await this.pythonRuntimeCandidates()) {
			try {
				const version = (await this.run(candidate.command, [...candidate.args, "--version"], {
					cwd: probeCwd(),
					timeoutMs: PROBE_TIMEOUT_MS,
				})).trim();
				if (!/Python 3\./i.test(version)) continue;
				const dependencyOutput = await this.run(candidate.command, [...candidate.args, "-c", DEPENDENCY_PROBE_SCRIPT], {
					cwd: probeCwd(),
					timeoutMs: PROBE_TIMEOUT_MS,
				});
				const detected = JSON.parse(dependencyOutput) as {
					executable?: string;
					openpyxl?: boolean;
					pyarrow?: boolean;
					pandas?: boolean;
				};
				// 按真实可执行文件去重:`python` 与 `python3` 常常是同一个。
				const identity = detected.executable?.toLowerCase() ?? `${candidate.command}:${candidate.args.join(" ")}`;
				if (identities.has(identity)) continue;
				identities.add(identity);
				runtimes.push({
					...candidate,
					version,
					dependencies: {
						openpyxl: detected.openpyxl === true,
						pyarrow: detected.pyarrow === true,
						pandas: detected.pandas === true,
					},
				});
			} catch {
				// 试下一个候选命令。
			}
		}
		// 依赖最全的排前面:数据功能要的是"能跑 pandas 的那个",不是第一个能跑 --version 的。
		return runtimes.sort(
			(left, right) =>
				Object.values(right.dependencies).filter(Boolean).length -
				Object.values(left.dependencies).filter(Boolean).length,
		);
	}

	private async detectFacts(): Promise<HostEnvironmentFacts> {
		const [shell, node, runtimes] = await Promise.all([this.detectShell(), this.resolveNode(), this.pythonRuntimes()]);
		const best = runtimes[0];
		return {
			platform: this.platform,
			shell,
			node: { found: node.source !== "none", ...(node.version ? { version: node.version } : {}), source: node.source },
			python: {
				found: Boolean(best),
				...(best ? { version: best.version, executable: best.command } : {}),
				source: best?.bundled ? "wordless" : best ? "system" : "none",
				packages: best?.dependencies ?? emptyPackages(),
			},
			probedAt: Date.now(),
		};
	}

	private async detectShell(): Promise<HostEnvironmentFacts["shell"]> {
		const result = await resolveShellConfig({ platform: this.platform });
		if (!result.ok) return null;
		return { kind: shellKindOf(result.value.shell), executable: result.value.shell };
	}

	/**
	 * 这台机器的 Node 从哪来。只回答事实,**不改任何东西**(改 PATH 的是 `installNodeFallback`)。
	 */
	async resolveNode(): Promise<NodeState> {
		this.nodeState ??= await this.computeNode();
		return this.nodeState;
	}

	/**
	 * 装 Node 兜底:**没有可用的系统 Node 时**,才把自带的那份放到 PATH 最前面。
	 *
	 * 为什么是"没有才放":
	 * - 用户自己那份可能正是他的项目要的版本(nvm/volta),抢在前面会让 agent 的行为不可预测;
	 * - 反过来,一个过旧的 node(低于下限)比没有更坏 —— 那种错误最难查,所以低版本**会被盖掉**。
	 *
	 * 兜底本体是**零字节**的:Electron 就是一份 Node,`ELECTRON_RUN_AS_NODE=1` 之后它就是 node。
	 * 代价是版本跟着 Electron 走、而且**没有 npm**(所以命令工具的失败提示会明说"不能装包")。
	 *
	 * 失败一律吞掉:装不上兜底最差就是"这台机器没有 node",那由失败提示去解释,不该拖垮启动。
	 */
	async installNodeFallback(): Promise<NodeState> {
		const node = await this.resolveNode();
		if (!this.binDirectory) return node;
		try {
			if (node.source === "wordless") {
				await this.writeNodeShim();
				prependPathEntry(this.env, this.binDirectory);
			} else {
				removePathEntry(this.env, this.binDirectory);
			}
		} catch {
			// 见上:静默降级。
		}
		return node;
	}

	/**
	 * 把打包进来的 Python 拷到用户目录,返回可执行文件路径。
	 *
	 * 几个关键取舍:
	 * - **副本必须落在用户目录**:应用包里的那份不可写(macOS 改内容会破坏代码签名,Windows 的安装目录
	 *   也不可写),而用户/agent 早晚要 `pip install`,装进只读目录会当场失败。
	 * - **首启零网络**:拷贝而已,不下载。运行时不做任何网络请求是这套设计的硬约束。
	 * - **每次都跑一下**:副本可能被清理工具或杀软破坏 —— "存在但跑不起来"必须被当成没有,否则
	 *   `requirePython` 会选中一个坏运行时,把"缺 Python"变成更难查的失败。
	 */
	async seedPythonRuntime(): Promise<string | undefined> {
		this.pythonSeedPromise ??= this.seedPythonRuntimeOnce();
		return await this.pythonSeedPromise;
	}

	private async seedPythonRuntimeOnce(): Promise<string | undefined> {
		const vendor = this.pythonVendorDirectory;
		const runtimes = this.runtimesDirectory;
		if (!vendor || !runtimes) return undefined;
		try {
			const marker = (await readFile(join(vendor, PYTHON_MARKER_FILE), "utf8")).trim();
			if (!marker || marker === SKIPPED_MARKER) return undefined;
			const pythonVersion = marker.split(":")[1];
			if (!pythonVersion) return undefined;

			const interpreterName = this.platform === "win32" ? "python.exe" : join("bin", "python3");
			const target = join(runtimes, "python", pythonVersion);
			const markerFile = join(target, PYTHON_MARKER_FILE);
			const interpreter = join(target, interpreterName);

			// "标记对得上"不等于"副本是好的":标记和整棵 67MB 的树是两个东西,中间可能被杀软/清理工具
			// 动过。所以判据是**能不能跑** —— 跑不起来就重拷一次(源就在应用包里,重拷是免费的)。
			const markerMatches = (await readFile(markerFile, "utf8").catch(() => "")).trim() === marker;
			if (!markerMatches || !(await this.runsPython(interpreter))) {
				await rm(target, { recursive: true, force: true });
				await mkdir(dirname(target), { recursive: true });
				// `verbatimSymlinks: true` **不能省**。默认(false)会把符号链接的**目标解析成绝对路径** ——
				// 而 `bin/python3` 在原树里是相对链接(`python3 -> python3.12`)。解析之后副本里的链接指回
				// 应用包,CPython 又按"可执行文件的真实路径"算 `sys.prefix`,于是:
				//   - `sys.prefix` 指回应用包(而不是副本);
				//   - `pip install` 往应用包里装 —— 打包后那是只读目录,当场失败;开发机上则是把
				//     243MB 装进了仓库里的资产目录(实测踩到,见文档"测试里踩到的坑")。
				await cp(vendor, target, { recursive: true, verbatimSymlinks: true });
				if (this.platform !== "win32") await chmod(interpreter, 0o755);
				await writeFile(markerFile, `${marker}\n`, "utf8");
			}

			// 重拷之后仍然跑不起来 = 应用包里那份是坏的。当作"没有",而不是把一个坏运行时交出去。
			return (await this.runsPython(interpreter)) ? interpreter : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Python 的候选:内置那份排最前。
	 *
	 * 排序仍按"依赖满足数"(见 detectPythonRuntimes),同分时保持插入顺序 —— 于是:
	 * 用户自己那份依赖更全时它胜出(那是他熟悉的、可能已经装好东西的环境),否则用内置的。
	 * 这与 Node 的"优先用户那份"不矛盾:Node 关心的是版本对项目的适配,Python 关心的是**依赖是否齐**。
	 */
	/**
	 * 按需把数据功能要的包装进**内置那份** Python。
	 *
	 * 为什么是"用户点一次"而不是"首次用到就自动装":装东西会联网、会写盘、会改变这台机器的行为 ——
	 * 那是用户的决定。所以功能侧遇到缺包时只说清"去哪点一次",点不点在面板上。
	 *
	 * 为什么装进内置那份而不是用户的:那是我们自己的目录,装坏了删掉重来即可;用户那份可能被他别的项目
	 * 依赖着,不该被我们改。这也是"面板不写用户配置"这条纪律的延伸。
	 */
	async provisionPythonPackages(): Promise<HostPythonProvisionResult> {
		const interpreter = await this.seedPythonRuntime();
		if (!interpreter) {
			return { ok: false, installed: [], message: "No bundled Python is available on this machine." };
		}

		const already = await this.pythonDependenciesSatisfied(interpreter);
		if (already) return { ok: true, installed: [] };

		const names = DATA_ANALYSIS_PYTHON_PACKAGES.map((entry) => entry.name);
		try {
			await this.run(
				interpreter,
				[
					"-m", "pip", "install",
					// 只收 wheel:没有预编译版本的包要现场编译,而 Wordless 不带编译工具链。
					"--only-binary", ":all:",
					"--no-input",
					"--disable-pip-version-check",
					...pinnedRequirements(),
				],
				{
					timeoutMs: 600_000,
					env: {
						...this.env,
						PIP_INDEX_URL: PYTHON_PACKAGE_MIRROR.indexUrl,
						PIP_TRUSTED_HOST: PYTHON_PACKAGE_MIRROR.trustedHost,
						// 缓存放我们自己的目录:不往用户 home 里丢东西,也好整个删掉。
						...(this.runtimesDirectory ? { PIP_CACHE_DIR: join(this.runtimesDirectory, "pip-cache") } : {}),
						PIP_DISABLE_PIP_VERSION_CHECK: "1",
					},
				},
			);
		} catch (error) {
			return { ok: false, installed: [], message: error instanceof Error ? error.message : String(error) };
		}

		// 装完**当场验**:pip 说成功不等于能 import(镜像给错 wheel、磁盘满、半途中断都可能)。
		await this.refresh("python", { force: true });
		if (!(await this.pythonDependenciesSatisfied(interpreter))) {
			return { ok: false, installed: [], message: "Packages were installed but cannot be imported." };
		}
		return { ok: true, installed: names };
	}

	private async pythonDependenciesSatisfied(interpreter: string): Promise<boolean> {
		try {
			const output = await this.run(interpreter, ["-c", DEPENDENCY_PROBE_SCRIPT], { cwd: probeCwd(), timeoutMs: PROBE_TIMEOUT_MS });
			const detected = JSON.parse(output) as Partial<Record<PythonDependency, boolean>>;
			return PYTHON_DEPENDENCIES.every((dependency) => detected[dependency] === true);
		} catch {
			return false;
		}
	}

	private async runsPython(interpreter: string): Promise<boolean> {
		try {
			const version = await this.run(interpreter, ["--version"], { cwd: probeCwd(), timeoutMs: PROBE_TIMEOUT_MS });
			return /Python 3\./i.test(version);
		} catch {
			return false;
		}
	}

	private async pythonRuntimeCandidates(): Promise<{ command: string; args: string[]; bundled: boolean }[]> {
		const bundled = await this.seedPythonRuntime();
		return [
			...(bundled ? [{ command: bundled, args: [], bundled: true }] : []),
			...pythonCandidates(this.platform).map((candidate) => ({ ...candidate, bundled: false })),
		];
	}

	private async computeNode(): Promise<NodeState> {
		const system = await this.probeNodeVersion({ PATH: this.systemPath });
		if (system && majorOf(system) >= this.minimumNodeMajor) return { source: "system", version: system };
		if (!this.binDirectory) return { source: "none" };
		const bundled = await this.probeBundledNode();
		return bundled ? { source: "wordless", version: bundled } : { source: "none" };
	}

	private async probeNodeVersion(env?: NodeJS.ProcessEnv): Promise<string | undefined> {
		try {
			const output = await this.run("node", ["--version"], {
				cwd: probeCwd(),
				timeoutMs: PROBE_TIMEOUT_MS,
				...(env ? { env } : {}),
			});
			return parseVersion(output.trim());
		} catch {
			return undefined;
		}
	}

	private async probeBundledNode(): Promise<string | undefined> {
		try {
			const output = await this.run(this.electronBinaryPath, ["--version"], {
				cwd: probeCwd(),
				timeoutMs: PROBE_TIMEOUT_MS,
				env: { ...this.env, ELECTRON_RUN_AS_NODE: "1" },
			});
			const version = parseVersion(output.trim());
			return version && majorOf(version) >= this.minimumNodeMajor ? version : undefined;
		} catch {
			return undefined;
		}
	}

	private async writeNodeShim(): Promise<void> {
		const directory = this.binDirectory;
		if (!directory) return;
		await mkdir(directory, { recursive: true, mode: 0o700 });
		if (this.platform === "win32") {
			await writeFile(join(directory, "node.cmd"), windowsNodeShim(this.electronBinaryPath), "utf8");
			return;
		}
		const target = join(directory, "node");
		await writeFile(target, posixNodeShim(this.electronBinaryPath), "utf8");
		await chmod(target, 0o755);
	}
}

/**
 * POSIX 兜底脚本。**用户中途装好了 node 就让位** —— 不等重启。
 *
 * 做法:把本目录从 PATH 里剔掉之后再找一次 `node`;找到就用真的那个。这样"装了还要重启"这类
 * 说不清的体验就不存在了。
 *
 * **全程只用 shell 内建**(参数展开、`for`、`command -v`),不用 `dirname`/`tr`/`grep`。这不是洁癖:
 * 这个脚本恰恰工作在"PATH 很薄"的机器上(它就是为了那种机器存在的),一旦依赖外部命令,它会在最需要
 * 它的场合失灵 —— 实测过一次:测试里只给 PATH 两个目录,`dirname: command not found`,脚本静默走到
 * 最后一行的 Electron 分支,于是"让位给系统 node"这件事悄悄没发生。
 */
function posixNodeShim(electronBinaryPath: string): string {
	return [
		"#!/bin/sh",
		"# Wordless 自带的 Node 兜底。见 docs/architecture/host-environment.md。",
		"# 只有这台机器没有可用的 node 时,这个目录才会被放到 PATH 前面。",
		"",
		"# ① 自己所在的目录(不借助 dirname:参数展开就够了)。",
		'case "$0" in',
		'  */*) self=${0%/*} ;;',
		'  *) self=$(command -v "$0" 2>/dev/null) && self=${self%/*} ;;',
		"esac",
		"",
		"# ② 把本目录从 PATH 里剔掉,再找一次 node;找到就让位。",
		'if [ -n "$self" ]; then',
		"  rest=",
		"  old_ifs=$IFS",
		"  IFS=:",
		'  for dir in $PATH; do',
		'    if [ -n "$dir" ] && [ "$dir" != "$self" ]; then',
		'      rest=${rest:+$rest:}$dir',
		"    fi",
		"  done",
		"  IFS=$old_ifs",
		'  next=$(PATH=$rest command -v node 2>/dev/null)',
		'  if [ -n "$next" ]; then exec "$next" "$@"; fi',
		"fi",
		"",
		"# ③ 没有别的 node:用 Wordless 自带的那份(Electron 本身就是 Node)。",
		"ELECTRON_RUN_AS_NODE=1",
		"export ELECTRON_RUN_AS_NODE",
		`exec "${electronBinaryPath}" "$@"`,
		"",
	].join("\n");
}

/**
 * Windows 兜底脚本。
 *
 * **对比 POSIX 少一步"让位"**:`cmd` 里要剔除自身目录、再解析一次 `node` 的路径,引号与 `%*` 的
 * 组合很容易写错,而这里没有 Windows 机器可以验。所以它保持最简单的一版:装好的系统 node 会被
 * 设置里的"重新探测"接回来(那时我们把这一层从 PATH 摘掉)。
 */
function windowsNodeShim(electronBinaryPath: string): string {
	return [
		"@echo off",
		"rem Wordless 自带的 Node 兜底。见 docs/architecture/host-environment.md。",
		'set "ELECTRON_RUN_AS_NODE=1"',
		`"${electronBinaryPath}" %*`,
		"",
	].join("\r\n");
}

function pathKeyOf(env: NodeJS.ProcessEnv): string {
	return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function pathValueOf(env: NodeJS.ProcessEnv): string {
	return env[pathKeyOf(env)] ?? "";
}

function prependPathEntry(env: NodeJS.ProcessEnv, entry: string): void {
	const key = pathKeyOf(env);
	const entries = pathValueOf(env).split(delimiter).filter(Boolean).filter((current) => current !== entry);
	env[key] = [entry, ...entries].join(delimiter);
}

function removePathEntry(env: NodeJS.ProcessEnv, entry: string | undefined): void {
	if (!entry) return;
	const key = pathKeyOf(env);
	const entries = pathValueOf(env).split(delimiter).filter(Boolean).filter((current) => current !== entry);
	env[key] = entries.join(delimiter);
}

function emptyFacts(platform: NodeJS.Platform): HostEnvironmentFacts {
	return {
		platform,
		shell: null,
		node: { found: false, source: "none" },
		python: { found: false, source: "none", packages: emptyPackages() },
		probedAt: Date.now(),
	};
}

let singleton: HostEnvironmentService | undefined;

export function getHostEnvironmentService(): HostEnvironmentService {
	singleton ??= new HostEnvironmentService();
	return singleton;
}

/** 与数据功能原来那份 `runProcess` 同一实现:超时/取消都杀掉整棵进程树,输出有上限。 */
async function runProcess(command: string, args: readonly string[], options: HostRunOptions = {}): Promise<string> {
	const { cwd, signal, timeoutMs = 120_000, env } = options;
	return await new Promise((resolvePromise, reject) => {
		const child = spawn(command, [...args], {
			cwd,
			env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ...env },
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			if (error) reject(error);
			else resolvePromise(stdout);
		};
		const stop = () => {
			if (process.platform === "win32" && child.pid) {
				spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
			} else {
				child.kill("SIGKILL");
			}
		};
		const abort = () => {
			stop();
			finish(new Error("Command cancelled"));
		};
		const timer = setTimeout(
			() => {
				stop();
				finish(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)} seconds`));
			},
			timeoutMs,
		);
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_PROCESS_OUTPUT) stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_PROCESS_OUTPUT) stderr += chunk.toString();
		});
		child.on("error", (error) => finish(error));
		// 非零退出码也要 reject:调用方要的是"能不能用",不是退出码本身。stderr 带回去便于排查。
		child.on("close", (code) => {
			if (code === 0) finish();
			else finish(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code ?? "unknown"}`));
		});
	});
}
