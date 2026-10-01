import { NodeExecutionEnv } from "@wordless/agent/node";
import { commandFailureHint, createHeadlessCodingTools } from "@wordless/coding-agent";
import { describe, expect, it } from "vitest";

/**
 * 这些输出都是各平台 shell 的**原话**(从真实报错里抄的措辞),因为整个映射表就是靠措辞分辨平台的。
 */
describe("命令失败时补的那一句", () => {
	it("退出码 0 或被取消时,一个字都不加", () => {
		expect(commandFailureHint({ exitCode: 0, output: "bash: foo: command not found" })).toBeUndefined();
		expect(commandFailureHint({ exitCode: undefined, output: "bash: foo: command not found" })).toBeUndefined();
		expect(commandFailureHint({ exitCode: 127, output: "   \n" })).toBeUndefined();
	});

	it("bash: 缺 python 时说清是 Python,并劝住重试", () => {
		const hint = commandFailureHint({ exitCode: 127, output: "bash: line 1: python3: command not found" });
		expect(hint).toContain("Python is not installed");
		expect(hint).toContain("Do not keep retrying");
	});

	it("sh/dash 的措辞(没有 command 二字)也认", () => {
		expect(commandFailureHint({ exitCode: 127, output: "sh: 1: pyarrow-tool: not found" })).toContain(
			"`pyarrow-tool` is not installed",
		);
	});

	it("zsh 的措辞相反(名字在后)也认", () => {
		expect(commandFailureHint({ exitCode: 127, output: "zsh: command not found: npm" })).toContain(
			"packages cannot be installed",
		);
	});

	it("Windows cmd(退出码 9009)也认", () => {
		expect(
			commandFailureHint({
				exitCode: 9009,
				output: "'definitely-missing' is not recognized as an internal or external command, operable program or batch file.",
			}),
		).toContain("`definitely-missing` is not installed");
	});

	it("PowerShell 的 CommandNotFoundException 也认(退出码是 1,不是 127)", () => {
		const hint = commandFailureHint({
			exitCode: 1,
			output:
				"definitely-missing : The term 'definitely-missing' is not recognized as the name of a cmdlet, function, script file, or operable program.",
		});
		expect(hint).toContain("`definitely-missing` is not installed");
	});

	it("占位桩单独说:它比\"命令不存在\"更容易让模型以为是参数写错了", () => {
		const hint = commandFailureHint({
			exitCode: 1,
			output:
				"xcode-select: note: no developer tools were found at '/Applications/Xcode.app', and no install could be requested (perhaps no UI is present), please install manually.",
		});
		expect(hint).toContain("placeholder");
		expect(hint).toContain("Do not retry");

		expect(
			commandFailureHint({
				exitCode: 9009,
				output: "Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings.",
			}),
		).toContain("placeholder");
	});

	it("脚本自己打印的 `x: not found` 不会被误判成\"机器上没装 x\"", () => {
		// 没有 shell 前缀就不是 shell 在说话 —— 少了这条约束,任何正常的失败都可能被加一句错话。
		expect(commandFailureHint({ exitCode: 1, output: "config: not found\nstack: undefined" })).toBeUndefined();
		expect(commandFailureHint({ exitCode: 1, output: "Error: file not found" })).toBeUndefined();
	});

	it("从不建议模型去装东西(那是界面的事)", () => {
		const hints = [
			commandFailureHint({ exitCode: 127, output: "bash: line 1: python3: command not found" }),
			commandFailureHint({ exitCode: 127, output: "bash: line 1: npm: command not found" }),
			commandFailureHint({ exitCode: 1, output: "xcode-select: note: no developer tools were found" }),
		];
		for (const hint of hints) {
			expect(hint).not.toMatch(/install (?:it|python|node)\b/i);
			expect(hint).not.toMatch(/请安装/);
		}
	});
});

describe("bash 工具里的接法", () => {
	const env = new NodeExecutionEnv({ cwd: process.cwd() });
	const tool = createHeadlessCodingTools(env).find((candidate) => candidate.name === "bash");

	it("命令不存在时,那一句真的跟着输出回去了", async () => {
		if (!tool) throw new Error("bash tool missing");
		const result = (await tool.execute("t", { command: "definitely-not-a-command-xyz-123" }, undefined, undefined)) as {
			content: { text: string }[];
		};
		expect(result.content[0]?.text).toContain("`definitely-not-a-command-xyz-123` is not installed");
		expect(result.content[0]?.text).toContain("Do not retry");
	});

	it("命令成功时输出里没有那一句", async () => {
		if (!tool) throw new Error("bash tool missing");
		const result = (await tool.execute("t", { command: "printf ok" }, undefined, undefined)) as {
			content: { text: string }[];
		};
		expect(result.content[0]?.text).toBe("ok");
	});
});
