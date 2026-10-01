import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeExecutionEnv, resolveShellConfig } from "../../src/harness/env/nodejs.ts";
import { getOrThrow } from "../../src/harness/types.ts";
import { createTempDir } from "./session-test-utils.ts";

/**
 * 用一个假的"已安装集合"驱动解析,这样 Windows 分支可以在 macOS/Linux 上断言 ——
 * 否则这段逻辑只有在真的 Windows 上才能被跑到,而它恰恰是最容易长期失效的一段。
 */
function fake(options: { platform: NodeJS.Platform; installed: string[]; customShellPath?: string }) {
	const installed = new Set(options.installed.map((name) => name.toLowerCase()));
	return resolveShellConfig({
		platform: options.platform,
		customShellPath: options.customShellPath,
		fileExists: async (path) => installed.has(path.toLowerCase()),
		findExecutable: async (command) => (installed.has(command.toLowerCase()) ? `resolved:${command}` : null),
	});
}

const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];
const UTF8_PREFIX_LINE = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)";

describe("resolveShellConfig", () => {
	it("Windows:有 pwsh 就用 pwsh(7+ 支持 &&,比系统自带的 5.1 好用)", async () => {
		const result = await fake({ platform: "win32", installed: ["pwsh.exe", "powershell.exe"] });
		expect(getOrThrow(result)).toEqual({
			shell: "resolved:pwsh.exe",
			args: POWERSHELL_ARGS,
			commandPrefix: expect.stringContaining(UTF8_PREFIX_LINE),
		});
	});

	it("Windows:没有 pwsh 就用系统自带的 powershell", async () => {
		const result = await fake({ platform: "win32", installed: ["powershell.exe"] });
		expect(getOrThrow(result)).toEqual({
			shell: "resolved:powershell.exe",
			args: POWERSHELL_ARGS,
			commandPrefix: expect.stringContaining(UTF8_PREFIX_LINE),
		});
	});

	it("Windows:连 PowerShell 都没有时退到 cmd.exe —— 不报错(P0 的全部要点)", async () => {
		const result = await fake({ platform: "win32", installed: ["cmd.exe"] });
		const config = getOrThrow(result);
		expect(config.shell).toBe("resolved:cmd.exe");
		expect(config.args).toEqual(["/d", "/s", "/c"]);
		// cmd 不认 PowerShell 的编码前导,给了反而会把命令写坏。
		expect(config.commandPrefix).toBeUndefined();
	});

	it("Windows:PATH 被改坏到连 cmd 都找不到时,仍然给一个裸 cmd.exe 而不是失败", async () => {
		const config = getOrThrow(await fake({ platform: "win32", installed: [] }));
		expect(config.shell).toBe("cmd.exe");
	});

	it("POSIX:仍然优先 /bin/bash", async () => {
		const config = getOrThrow(await fake({ platform: "darwin", installed: ["/bin/bash", "bash"] }));
		expect(config).toEqual({ shell: "/bin/bash", args: ["-c"] });
	});

	it("POSIX:没有 /bin/bash 就找 PATH 上的 bash", async () => {
		const config = getOrThrow(await fake({ platform: "linux", installed: ["bash"] }));
		expect(config).toEqual({ shell: "resolved:bash", args: ["-c"] });
	});

	it("POSIX:都没有时退到 sh —— 也不会报错", async () => {
		expect(getOrThrow(await fake({ platform: "linux", installed: [] }))).toEqual({ shell: "sh", args: ["-c"] });
	});

	it("自定义 shell 路径不存在时,报错并说清去哪改", async () => {
		const result = await fake({ platform: "darwin", installed: [], customShellPath: "/nope/sh" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("shell_unavailable");
		expect(result.error.message).toContain("/nope/sh");
		expect(result.error.message).toContain("Settings → Environment");
	});

	it("自定义路径是 PowerShell 时,同样加编码前导", async () => {
		const config = getOrThrow(
			await fake({ platform: "win32", installed: ["C:\\tools\\pwsh.exe"], customShellPath: "C:\\tools\\pwsh.exe" }),
		);
		expect(config.shell).toBe("C:\\tools\\pwsh.exe");
		expect(config.args).toEqual(POWERSHELL_ARGS);
		expect(config.commandPrefix).toContain(UTF8_PREFIX_LINE);
	});

	it("自定义路径是普通 shell 时,按 POSIX 处理且不加前导", async () => {
		const config = getOrThrow(await fake({ platform: "darwin", installed: ["/opt/myshell"], customShellPath: "/opt/myshell" }));
		expect(config).toEqual({ shell: "/opt/myshell", args: ["-c"] });
	});

	it("旧版 WSL bash 的 stdin 传输保持不变(改动前就有的行为)", async () => {
		const shellPath = "C:\\Windows\\System32\\bash.exe";
		const config = getOrThrow(await fake({ platform: "win32", installed: [shellPath], customShellPath: shellPath }));
		expect(config).toEqual({ shell: shellPath, args: ["-s"], commandTransport: "stdin" });
	});
});

describe("PowerShell 的编码前导", () => {
	it("真的拼进了命令(不只是解析出来)", async () => {
		if (process.platform === "win32") return;
		const root = createTempDir();
		// 名字是 powershell.exe,内容是个 sh 脚本:解析按名字走,执行按 POSIX 走,于是能在 macOS 上验完整条路。
		const shellPath = join(root, "powershell.exe");
		await writeFile(shellPath, '#!/bin/sh\nprintf \'%s\\n\' "$*" >&2\nexit 0\n');
		await chmod(shellPath, 0o755);

		const env = new NodeExecutionEnv({ cwd: root, shellPath });
		const result = getOrThrow(await env.exec("Write-Output 你好"));

		expect(result.stderr).toContain(UTF8_PREFIX_LINE);
		expect(result.stderr).toContain("Write-Output 你好");
		expect(result.stderr).toContain("-NonInteractive");
	});
});
