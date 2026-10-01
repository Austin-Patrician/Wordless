import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
	access,
	appendFile,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
	type ExecutionEnv,
	ExecutionError,
	err,
	FileError,
	type FileInfo,
	type FileKind,
	ok,
	type Result,
	toError,
} from "../types.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;
const EXIT_STDIO_GRACE_MS = 100;
/** Total post-exit stdio budget: even if orphaned grandchildren keep the pipe
 * alive, the wait after process exit is bounded instead of indefinite. */
const EXIT_STDIO_GRACE_BUDGET_MS = 2_000;
/** Upper bound for a single taskkill invocation. */
const TASKKILL_TIMEOUT_MS = 5_000;
/** Delay before retrying a failed tree kill. */
const KILL_RETRY_DELAY_MS = 200;
/** Final grace after a timeout/abort kill before the exec promise is forced
 * to settle. Guarantees the caller is never left waiting forever. */
const KILL_GRACE_MS = 3_000;

function delay(ms: number): Promise<void> {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function resolveTimeoutMs(timeout: number | undefined): Result<number | undefined, ExecutionError> {
	if (timeout === undefined) return ok(undefined);
	if (!Number.isFinite(timeout) || timeout <= 0) {
		return err(new ExecutionError("timeout", "Invalid timeout: must be a finite number of seconds"));
	}

	const timeoutMs = timeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		return err(new ExecutionError("timeout", `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`));
	}
	return ok(timeoutMs);
}

function resolvePath(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

function fileKindFromStats(stats: {
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}): FileKind | undefined {
	if (stats.isFile()) return "file";
	if (stats.isDirectory()) return "directory";
	if (stats.isSymbolicLink()) return "symlink";
	return undefined;
}

function fileInfoFromStats(
	path: string,
	stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mtimeMs: number },
): Result<FileInfo, FileError> {
	const kind = fileKindFromStats(stats);
	if (!kind) return err(new FileError("invalid", "Unsupported file type", path));
	return ok({
		name: path.replace(/\/+$/, "").split("/").pop() ?? path,
		path,
		kind,
		size: stats.size,
		mtimeMs: stats.mtimeMs,
	});
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function toFileError(error: unknown, path?: string): FileError {
	if (error instanceof FileError) return error;
	const cause = toError(error);
	if (isNodeError(error)) {
		const message = error.message;
		switch (error.code) {
			case "ABORT_ERR":
				return new FileError("aborted", message, path, cause);
			case "ENOENT":
				return new FileError("not_found", message, path, cause);
			case "EACCES":
			case "EPERM":
				return new FileError("permission_denied", message, path, cause);
			case "ENOTDIR":
				return new FileError("not_directory", message, path, cause);
			case "EISDIR":
				return new FileError("is_directory", message, path, cause);
			case "EINVAL":
				return new FileError("invalid", message, path, cause);
		}
	}
	return new FileError("unknown", cause.message, path, cause);
}

function abortResult<TValue>(signal: AbortSignal | undefined, path?: string): Result<TValue, FileError> | undefined {
	return signal?.aborted ? err(new FileError("aborted", "aborted", path)) : undefined;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function runCommand(
	command: string,
	args: string[],
	timeoutMs: number,
): Promise<{ stdout: string; status: number | null }> {
	return await new Promise((resolve) => {
		let stdout = "";
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				stdio: ["ignore", "pipe", "ignore"],
				windowsHide: true,
			});
		} catch {
			resolve({ stdout: "", status: null });
			return;
		}
		const timeout = setTimeout(() => {
			if (child.pid) void killProcessTree(child.pid);
		}, timeoutMs);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", () => {
			clearTimeout(timeout);
			resolve({ stdout: "", status: null });
		});
		child.on("close", (status) => {
			clearTimeout(timeout);
			resolve({ stdout, status });
		});
	});
}

async function findExecutableOnPath(command: string, platform: NodeJS.Platform): Promise<string | null> {
	const result = await runCommand(platform === "win32" ? "where" : "which", [command], 5000);
	if (result.status !== 0 || !result.stdout) return null;
	const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
	return firstMatch && (await pathExists(firstMatch)) ? firstMatch : null;
}

interface ShellConfig {
	shell: string;
	args: string[];
	commandTransport?: "argv" | "stdin";
	/**
	 * 拼在每条命令前面的若干行。
	 *
	 * 只用于 PowerShell 的编码前导(见 `WINDOWS_POWERSHELL_UTF8_PREFIX`):没有它,Windows 上
	 * 中文输出会按系统代码页解码成乱码。
	 */
	commandPrefix?: string;
}

/**
 * PowerShell 的编码前导。
 *
 * `[Console]::OutputEncoding` 决定子进程往管道里写什么编码;后两行让 `$OutputEncoding` 与
 * `Get-Content` 也按 UTF-8 走。三行缺一条就会在某个方向上出现乱码(中文用户尤其)。
 */
const WINDOWS_POWERSHELL_UTF8_PREFIX = [
	"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
	"$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
	'$PSDefaultParameterValues["Get-Content:Encoding"] = "UTF8"',
].join("\n");

const WINDOWS_POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];

function isLegacyWslBashPath(path: string): boolean {
	const normalized = path.replace(/\//g, "\\").toLowerCase();
	return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(normalized);
}

/** 命令解释器的种类:宿主要用它给用户（和面板）说清"你现在跑的是什么"。 */
export type ShellKind = "pwsh" | "powershell" | "cmd" | "bash" | "sh" | "other";

export function shellKindOf(shellPath: string): ShellKind {
	const name = shellPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
	if (name === "pwsh" || name === "pwsh.exe") return "pwsh";
	if (name === "powershell" || name === "powershell.exe") return "powershell";
	if (name === "cmd" || name === "cmd.exe") return "cmd";
	if (name === "bash" || name === "bash.exe") return "bash";
	if (name === "sh" || name === "sh.exe") return "sh";
	return "other";
}

function getBashShellConfig(shell: string): ShellConfig {
	return isLegacyWslBashPath(shell) ? { shell, args: ["-s"], commandTransport: "stdin" } : { shell, args: ["-c"] };
}

function isPowerShellPath(shellPath: string): boolean {
	const kind = shellKindOf(shellPath);
	return kind === "pwsh" || kind === "powershell";
}

/**
 * 用户显式指定的 shell 路径:是 PowerShell 就同样走 PowerShell 的参数与前导,其余当 POSIX 处理。
 * (`-c` 两边都认:PowerShell 把 `-c` 当 `-Command` 的别名。)
 */
function getCustomShellConfig(shellPath: string): ShellConfig {
	return isPowerShellPath(shellPath)
		? { shell: shellPath, args: WINDOWS_POWERSHELL_ARGS, commandPrefix: WINDOWS_POWERSHELL_UTF8_PREFIX }
		: getBashShellConfig(shellPath);
}

export interface ResolveShellOptions {
	/** 默认取当前进程的平台;测试用它覆盖,免得为了断言 Windows 分支而真的跑在 Windows 上。 */
	platform?: NodeJS.Platform;
	customShellPath?: string;
	fileExists?: (path: string) => Promise<boolean>;
	findExecutable?: (command: string, platform: NodeJS.Platform) => Promise<string | null>;
}

/**
 * 解析出一个可用的命令解释器。
 *
 * **Windows 上用 PowerShell,不是 bash。** Windows 自带的是 PowerShell 与 cmd;bash 要用户另装
 * (Git for Windows / WSL)。早先这里在 win32 只找 Git Bash,找不到就报 `shell_unavailable` —— 那
 * 等于给普通 Windows 用户立了一道必须自己跨的墙,而那道失败当时全仓没有任何出口。现在按
 * `pwsh` → `powershell` → `cmd` 解析:三者都不需要用户安装,所以 Windows 上不再有"没有 shell"这一说。
 *
 * POSIX 侧不变:`/bin/bash` → PATH 上的 `bash` → `sh`,而且**不会**返回错误。
 *
 * `customShellPath` 由用户显式指定,所以写错时仍然报 `shell_unavailable`(这是它现在唯一的来源),
 * 但消息里带上"去哪改"。
 */
export async function resolveShellConfig(options: ResolveShellOptions = {}): Promise<Result<ShellConfig, ExecutionError>> {
	const platform = options.platform ?? process.platform;
	const fileExists = options.fileExists ?? pathExists;
	const findExecutable = options.findExecutable ?? findExecutableOnPath;

	if (options.customShellPath) {
		if (await fileExists(options.customShellPath)) {
			return ok(getCustomShellConfig(options.customShellPath));
		}
		return err(
			new ExecutionError(
				"shell_unavailable",
				`Custom shell path not found: ${options.customShellPath}\nFix the shell path in Settings → Environment, or clear it to use the system default.`,
			),
		);
	}

	if (platform === "win32") {
		// PowerShell 优先:`pwsh` 是 7+(支持 `&&`),`powershell` 是系统自带的 5.1,两者都比 cmd 好用。
		for (const candidate of ["pwsh.exe", "powershell.exe"]) {
			const resolved = await findExecutable(candidate, platform);
			if (resolved) {
				return ok({ shell: resolved, args: WINDOWS_POWERSHELL_ARGS, commandPrefix: WINDOWS_POWERSHELL_UTF8_PREFIX });
			}
		}
		// cmd.exe 一定在(System32 在 PATH 上),这里只是 PATH 被改坏时的兜底:否则又要变成"没有 shell"。
		return ok({ shell: (await findExecutable("cmd.exe", platform)) ?? "cmd.exe", args: ["/d", "/s", "/c"] });
	}

	if (await fileExists("/bin/bash")) {
		return ok(getBashShellConfig("/bin/bash"));
	}
	const bashOnPath = await findExecutable("bash", platform);
	return ok(bashOnPath ? getBashShellConfig(bashOnPath) : { shell: "sh", args: ["-c"] });
}

async function getShellConfig(customShellPath?: string): Promise<Result<ShellConfig, ExecutionError>> {
	return await resolveShellConfig({ customShellPath });
}

function getShellEnv(baseEnv?: NodeJS.ProcessEnv, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
	return {
		...process.env,
		...baseEnv,
		...extraEnv,
	};
}

async function runTaskkill(pid: number): Promise<boolean> {
	return await new Promise((resolvePromise) => {
		let child: ChildProcess;
		try {
			child = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
				windowsHide: true,
			});
		} catch {
			resolvePromise(false);
			return;
		}
		const timer = setTimeout(() => {
			child.removeAllListeners();
			child.kill("SIGKILL");
			resolvePromise(false);
		}, TASKKILL_TIMEOUT_MS);
		child.once("close", (code) => {
			clearTimeout(timer);
			resolvePromise(code === 0);
		});
		child.once("error", () => {
			clearTimeout(timer);
			resolvePromise(false);
		});
	});
}

/** Forcefully terminates the process tree rooted at `pid` and reports whether
 * the termination was likely successful. Best-effort: callers must never rely
 * on it alone and need a bounded fallback (see exec's force settle). */
async function killProcessTree(pid: number): Promise<boolean> {
	if (process.platform === "win32") {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const killed = await runTaskkill(pid);
			if (killed) return true;
			if (attempt === 0) await delay(KILL_RETRY_DELAY_MS);
		}
		return false;
	}

	try {
		process.kill(-pid, "SIGKILL");
		return true;
	} catch {
		try {
			process.kill(pid, "SIGKILL");
			return true;
		} catch {
			// Process already dead or cannot be signalled.
			return false;
		}
	}
}

function waitForChildProcess(child: ChildProcess): Promise<number | null> {
	return new Promise((resolvePromise, reject) => {
		let settled = false;
		let exited = false;
		let exitCode: number | null = null;
		let postExitTimer: ReturnType<typeof setTimeout> | undefined;
		let graceBudget = EXIT_STDIO_GRACE_BUDGET_MS;
		let stdoutEnded = child.stdout === null;
		let stderrEnded = child.stderr === null;

		const cleanup = (): void => {
			if (postExitTimer) clearTimeout(postExitTimer);
			child.removeListener("error", onError);
			child.removeListener("exit", onExit);
			child.removeListener("close", onClose);
			child.stdout?.removeListener("end", onStdoutEnd);
			child.stderr?.removeListener("end", onStderrEnd);
			child.stdout?.removeListener("data", onData);
			child.stderr?.removeListener("data", onData);
		};
		const finalize = (code: number | null): void => {
			if (settled) return;
			settled = true;
			cleanup();
			child.stdout?.destroy();
			child.stderr?.destroy();
			resolvePromise(code);
		};
		const maybeFinalizeAfterExit = (): void => {
			if (exited && stdoutEnded && stderrEnded) finalize(exitCode);
		};
		const armIdleTimer = (): void => {
			if (graceBudget <= 0) {
				// Budget exhausted: orphaned grandchildren keep writing to the
				// inherited stdio pipes. Finalize anyway instead of waiting forever.
				finalize(exitCode);
				return;
			}
			const slice = Math.min(EXIT_STDIO_GRACE_MS, graceBudget);
			graceBudget -= slice;
			if (postExitTimer) clearTimeout(postExitTimer);
			postExitTimer = setTimeout(() => finalize(exitCode), slice);
		};
		const onData = (): void => {
			if (exited && !settled) armIdleTimer();
		};
		const onStdoutEnd = (): void => {
			stdoutEnded = true;
			maybeFinalizeAfterExit();
		};
		const onStderrEnd = (): void => {
			stderrEnded = true;
			maybeFinalizeAfterExit();
		};
		const onError = (error: Error): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const onExit = (code: number | null): void => {
			exited = true;
			exitCode = code;
			maybeFinalizeAfterExit();
			if (!settled) armIdleTimer();
		};
		const onClose = (code: number | null): void => finalize(code);

		child.stdout?.once("end", onStdoutEnd);
		child.stderr?.once("end", onStderrEnd);
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.once("error", onError);
		child.once("exit", onExit);
		child.once("close", onClose);
	});
}

export class NodeExecutionEnv implements ExecutionEnv {
	cwd: string;
	private shellPath?: string;
	private shellEnv?: NodeJS.ProcessEnv;
	private activeChildPids = new Set<number>();

	constructor(options: { cwd: string; shellPath?: string; shellEnv?: NodeJS.ProcessEnv }) {
		this.cwd = options.cwd;
		this.shellPath = options.shellPath;
		this.shellEnv = options.shellEnv;
	}

	async absolutePath(path: string): Promise<Result<string, FileError>> {
		return ok(resolvePath(this.cwd, path));
	}

	async joinPath(parts: string[]): Promise<Result<string, FileError>> {
		return ok(join(...parts));
	}

	async exec(
		command: string,
		options?: {
			cwd?: string;
			env?: Record<string, string>;
			timeout?: number;
			abortSignal?: AbortSignal;
			onStdout?: (chunk: string) => void;
			onStderr?: (chunk: string) => void;
		},
	): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
		if (options?.abortSignal?.aborted) return err(new ExecutionError("aborted", "aborted"));
		const timeoutMsResult = resolveTimeoutMs(options?.timeout);
		if (!timeoutMsResult.ok) return err(timeoutMsResult.error);
		const timeoutMs = timeoutMsResult.value;

		const cwd = options?.cwd ? resolvePath(this.cwd, options.cwd) : this.cwd;
		const shellConfig = await getShellConfig(this.shellPath);
		if (!shellConfig.ok) return shellConfig;
		try {
			await access(cwd, constants.F_OK);
		} catch (error) {
			const cause = toError(error);
			return err(new ExecutionError("spawn_error", `Working directory does not exist: ${cwd}\nCannot run shell commands.`, cause));
		}

		return await new Promise((resolvePromise) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			let timedOut = false;
			let callbackError: ExecutionError | undefined;
			let child: ReturnType<typeof spawn> | undefined;
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			let forceSettleId: ReturnType<typeof setTimeout> | undefined;

			const onAbort = () => {
				if (settled) return;
				scheduleForceSettle("aborted");
				if (child?.pid) void killProcessTree(child.pid);
			};

			/** Arm the bounded fallback that settles the exec promise even when the
			 * tree kill failed or orphaned grandchildren keep the stdio pipes open.
			 * Created at most once, only on the timeout/abort paths. */
			const scheduleForceSettle = (code: "timeout" | "aborted") => {
				if (forceSettleId || settled) return;
				forceSettleId = setTimeout(() => {
					timedOut = timedOut || code === "timeout";
					// Best-effort final strike; only when the child has not exited yet
					// (guards against killing a reused PID).
					if (child?.pid && child.exitCode === null && child.signalCode === null) {
						void killProcessTree(child.pid);
					}
					settle(
						callbackError
							? err(callbackError)
							: err(
									new ExecutionError(
										code,
										code === "timeout" ? `Command timed out after ${options?.timeout} seconds` : "aborted",
									),
								),
					);
				}, KILL_GRACE_MS);
			};

			const settle = (result: Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>) => {
				if (timeoutId) clearTimeout(timeoutId);
				if (forceSettleId) clearTimeout(forceSettleId);
				forceSettleId = undefined;
				if (options?.abortSignal) options.abortSignal.removeEventListener("abort", onAbort);
				if (child?.pid) this.activeChildPids.delete(child.pid);
				if (settled) return;
				settled = true;
				// Stop consuming output: orphaned descendants may keep writing to the
				// inherited pipes, so destroy the streams to avoid unbounded memory
				// growth and further streaming updates after termination.
				child?.stdout?.destroy();
				child?.stderr?.destroy();
				resolvePromise(result);
			};

			try {
				const commandFromStdin = shellConfig.value.commandTransport === "stdin";
				// 前导(argv 与 stdin 两条传输都要带上,否则只有一条路径是干净的)。
				const shellCommand = shellConfig.value.commandPrefix
					? `${shellConfig.value.commandPrefix}\n${command}`
					: command;
				child = spawn(
					shellConfig.value.shell,
					commandFromStdin ? shellConfig.value.args : [...shellConfig.value.args, shellCommand],
					{
						cwd,
						detached: process.platform !== "win32",
						env: getShellEnv(this.shellEnv, options?.env),
						stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
						windowsHide: true,
					},
				);
				if (child.pid) this.activeChildPids.add(child.pid);
				if (commandFromStdin) {
					child.stdin?.on("error", () => {});
					child.stdin?.end(shellCommand);
				}
			} catch (error) {
				const cause = toError(error);
				settle(err(new ExecutionError("spawn_error", cause.message, cause)));
				return;
			}

			timeoutId =
				timeoutMs !== undefined
					? setTimeout(() => {
							timedOut = true;
							// Unconditionally arm the bounded fallback: it covers both a
							// failed tree kill and a killed child whose stdio is held open
							// by orphaned descendants.
							scheduleForceSettle("timeout");
							if (child?.pid) void killProcessTree(child.pid);
						}, timeoutMs)
					: undefined;

			if (options?.abortSignal) {
				if (options.abortSignal.aborted) {
					onAbort();
				} else {
					options.abortSignal.addEventListener("abort", onAbort, { once: true });
				}
			}

			child.stdout?.setEncoding("utf8");
			child.stderr?.setEncoding("utf8");
			child.stdout?.on("data", (chunk: string) => {
				if (settled) return;
				stdout += chunk;
				try {
					options?.onStdout?.(chunk);
				} catch (error) {
					const cause = toError(error);
					callbackError = new ExecutionError("callback_error", cause.message, cause);
					onAbort();
				}
			});
			child.stderr?.on("data", (chunk: string) => {
				if (settled) return;
				stderr += chunk;
				try {
					options?.onStderr?.(chunk);
				} catch (error) {
					const cause = toError(error);
					callbackError = new ExecutionError("callback_error", cause.message, cause);
					onAbort();
				}
			});

			void waitForChildProcess(child).then(
				(code) => {
					if (callbackError) {
						settle(err(callbackError));
						return;
					}
					if (timedOut) {
						settle(err(new ExecutionError("timeout", `Command timed out after ${options?.timeout} seconds`)));
						return;
					}
					if (options?.abortSignal?.aborted) {
						settle(err(new ExecutionError("aborted", "aborted")));
						return;
					}
					settle(ok({ stdout, stderr, exitCode: code ?? 0 }));
				},
				(error: Error) => settle(err(new ExecutionError("spawn_error", error.message, error))),
			);
		});
	}

	async readTextFile(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const aborted = abortResult<string>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			return ok(await readFile(resolved, { encoding: "utf8", signal: abortSignal }));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async readTextLines(
		path: string,
		options?: { maxLines?: number; abortSignal?: AbortSignal },
	): Promise<Result<string[], FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const aborted = abortResult<string[]>(options?.abortSignal, resolved);
		if (aborted) return aborted;
		if (options?.maxLines !== undefined && options.maxLines <= 0) return ok([]);
		let stream: ReturnType<typeof createReadStream> | undefined;
		let lineReader: ReturnType<typeof createInterface> | undefined;
		try {
			stream = createReadStream(resolved, { encoding: "utf8", signal: options?.abortSignal });
			lineReader = createInterface({ input: stream, crlfDelay: Infinity });
			const lines: string[] = [];
			for await (const line of lineReader) {
				const loopAbort = abortResult<string[]>(options?.abortSignal, resolved);
				if (loopAbort) return loopAbort;
				lines.push(line);
				if (options?.maxLines !== undefined && lines.length >= options.maxLines) break;
			}
			const afterReadAbort = abortResult<string[]>(options?.abortSignal, resolved);
			if (afterReadAbort) return afterReadAbort;
			return ok(lines);
		} catch (error) {
			return err(toFileError(error, resolved));
		} finally {
			lineReader?.close();
			stream?.destroy();
		}
	}

	async readBinaryFile(path: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const aborted = abortResult<Uint8Array>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			return ok(await readFile(resolved, { signal: abortSignal }));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async writeFile(
		path: string,
		content: string | Uint8Array,
		abortSignal?: AbortSignal,
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const aborted = abortResult<void>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			await mkdir(resolve(resolved, ".."), { recursive: true });
			const afterMkdirAbort = abortResult<void>(abortSignal, resolved);
			if (afterMkdirAbort) return afterMkdirAbort;
			await writeFile(resolved, content, { signal: abortSignal });
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		try {
			await mkdir(resolve(resolved, ".."), { recursive: true });
			await appendFile(resolved, content);
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		try {
			return fileInfoFromStats(resolved, await lstat(resolved));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async listDir(path: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const aborted = abortResult<FileInfo[]>(abortSignal, resolved);
		if (aborted) return aborted;
		try {
			const entries = await readdir(resolved, { withFileTypes: true });
			const infos: FileInfo[] = [];
			for (const entry of entries) {
				const loopAbort = abortResult<FileInfo[]>(abortSignal, resolved);
				if (loopAbort) return loopAbort;
				const entryPath = resolve(resolved, entry.name);
				try {
					const info = fileInfoFromStats(entryPath, await lstat(entryPath));
					if (info.ok) infos.push(info.value);
				} catch (error) {
					return err(toFileError(error, entryPath));
				}
			}
			return ok(infos);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async canonicalPath(path: string): Promise<Result<string, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		try {
			return ok(await realpath(resolved));
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async exists(path: string): Promise<Result<boolean, FileError>> {
		const result = await this.fileInfo(path);
		if (result.ok) return ok(true);
		if (result.error.code === "not_found") return ok(false);
		return err(result.error);
	}

	async createDir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		try {
			await mkdir(resolved, { recursive: options?.recursive ?? true });
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		try {
			await rm(resolved, { recursive: options?.recursive ?? false, force: options?.force ?? false });
			return ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		}
	}

	async createTempDir(prefix: string = "tmp-"): Promise<Result<string, FileError>> {
		try {
			return ok(await mkdtemp(join(tmpdir(), prefix)));
		} catch (error) {
			return err(toFileError(error));
		}
	}

	async createTempFile(options?: { prefix?: string; suffix?: string }): Promise<Result<string, FileError>> {
		const dir = await this.createTempDir("tmp-");
		if (!dir.ok) return dir;
		const filePath = join(dir.value, `${options?.prefix ?? ""}${randomUUID()}${options?.suffix ?? ""}`);
		try {
			await writeFile(filePath, "");
			return ok(filePath);
		} catch (error) {
			return err(toFileError(error, filePath));
		}
	}

	async cleanup(): Promise<void> {
		const kills = [...this.activeChildPids].map((pid) => killProcessTree(pid));
		this.activeChildPids.clear();
		await Promise.all(kills);
	}
}
