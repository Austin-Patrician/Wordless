/**
 * 命令失败时,补一句"这台机器上为什么没有它"。
 *
 * 只做三件事:**说清是什么**、**劝住别重复试**、**把结论交给用户**。三条纪律:
 *
 * 1. **只在失败路径上算**(退出码非 0),成功路径零成本。
 * 2. **事实从失败输出里读出来**,不做任何探测 —— 所以它永远不会过期:用户刚装好,下一条命令就不会
 *    再走到这里。(对照:如果这句话是会话开始时固化的快照,它会在用户装好之后继续骗模型。)
 * 3. **不写"请安装 X"**。装东西是界面的活(设置 → 环境、导览那一步);模型该做的是**停止重试**并把
 *    缺什么告诉用户。让模型去指挥用户敲安装命令,是最糟的一种出口。
 *
 * 这里**不说"可用的是 Node v22…"**:工具层拿不到宿主环境(那份事实在主进程的
 * `HostEnvironmentService`),要说得靠 runtime 把事实透进来。真正救命的是前半句"别再试了"。
 */

export interface CommandFailureContext {
	/** `undefined` 表示命令被取消(不是失败),那时不该补任何话。 */
	exitCode: number | undefined;
	/** stdout 与 stderr 合并后的输出 —— 与工具返回给模型的是同一份。 */
	output: string;
}

/**
 * "找不到这个命令"的几种说法,按平台从最具体到最宽松。
 *
 * POSIX 侧刻意要求**有 shell 前缀**(`bash: line 1: foo: command not found` / `sh: 1: foo: not found`):
 * 否则一句普通的 `config: not found`(脚本自己的输出)会被误判成"这台机器没装 config"。
 */
const MISSING_COMMAND_PATTERNS: ReadonlyArray<RegExp> = [
	// Windows PowerShell(`The term 'foo' is not recognized as the name of a cmdlet...`)
	/The term '([^']+)' is not recognized as the name of a cmdlet/i,
	// Windows cmd.exe(退出码 9009)
	/'([^']+)' is not recognized as an internal or external command/i,
	// bash / sh / dash / ash / ksh
	/^[\w./-]*(?:bash|sh|dash|ash|ksh):\s*(?:\d+:\s*|line \d+:\s*)?([\w.@/+-]+):\s*(?:command )?not found\b/im,
	// zsh 的措辞相反(名字在后面)
	/^[\w./-]*zsh:\s*command not found:\s*([^\s'"]+)/im,
];

/**
 * 占位桩:命令**存在**但一跑就弹系统安装框。
 *
 * macOS 的 `/usr/bin/git`、`/usr/bin/python3` 就是这种(Xcode Command Line Tools 没装时);Windows 上
 * `python` 可能是 Microsoft Store 的别名。这类比"命令不存在"更坏:模型看到的是"命令跑了但失败了",
 * 会以为是自己写错了参数,然后反复重试。
 */
const PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
	/xcode-select: note: no developer tools were found/i,
	/please install the command line developer tools/i,
	/Python was not found; run without arguments to install from the Microsoft Store/i,
];

const PACKAGE_MANAGERS = new Set(["npm", "npx", "yarn", "pnpm", "bun", "pip", "pip3", "uv", "conda", "poetry"]);
const PYTHON_COMMANDS = new Set(["python", "python3", "py"]);
const NODE_COMMANDS = new Set(["node", "nodejs"]);

function firstMatch(patterns: ReadonlyArray<RegExp>, output: string): RegExpMatchArray | undefined {
	for (const pattern of patterns) {
		const match = output.match(pattern);
		if (match) return match;
	}
	return undefined;
}

export function commandFailureHint(context: CommandFailureContext): string | undefined {
	if (context.exitCode === undefined || context.exitCode === 0) return undefined;
	if (context.output.trim().length === 0) return undefined;

	if (firstMatch(PLACEHOLDER_PATTERNS, context.output)) {
		return "That command is only a placeholder on this machine: running it starts a system installer instead of doing the work. Do not retry it. Tell the user what is missing.";
	}

	const missing = firstMatch(MISSING_COMMAND_PATTERNS, context.output);
	const name = missing?.[1];
	if (!name) return undefined;

	if (PACKAGE_MANAGERS.has(name)) {
		return `\`${name}\` is not available on this machine, so packages cannot be installed here. Do not retry it. Tell the user what is missing instead.`;
	}
	if (PYTHON_COMMANDS.has(name)) {
		return "Python is not installed on this machine. Do not keep retrying it. Tell the user what is missing instead, or finish the work with what is available.";
	}
	if (NODE_COMMANDS.has(name)) {
		return "Node is not installed on this machine. Do not keep retrying it. Tell the user what is missing instead, or finish the work with what is available.";
	}
	return `\`${name}\` is not installed on this machine. Do not retry it. Tell the user what is missing instead.`;
}
