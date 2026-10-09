import { ok, type ShellExecOptions } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { describe, expect, it } from "vitest";

/**
 * bash 工具必须**显式**告诉界面"这次到底有没有输出"(`details.hasOutput`)。
 *
 * 为什么需要这个字段:命令成功但什么都没打印时,工具结果的正文只有那句兜底文案
 * ("Command finished with exit code 0"),界面据此不显示 "View output" 入口 —— 而这个判断
 * **只能在工具层算**:界面看到的文本已经加过兜底,它想分辨就只剩"字符串匹配那句英文"。
 *
 * 曾经的实现是界面去读 `details.stdout` / `details.stderr`,而 bash 工具从来不设这两个字段,
 * 于是规则退化成"所有成功的 bash 都隐藏输出入口"(真输出与被截断的那份一起没了)。这条测试钉住
 * 工具侧的契约,免得哪天字段被删掉时只剩一个静默的降级。
 */

class StubExecutionEnv extends NodeExecutionEnv {
  constructor(
    private readonly chunks: readonly string[],
    private readonly exitCode: number = 0,
  ) {
    super({ cwd: process.cwd() });
  }

  override async exec(_command: string, options?: ShellExecOptions) {
    for (const chunk of this.chunks) options?.onStdout?.(chunk);
    return ok({ stdout: "", stderr: "", exitCode: this.exitCode });
  }
}

async function runBash(chunks: readonly string[], exitCode = 0) {
  const bash = createHeadlessCodingTools(new StubExecutionEnv(chunks, exitCode)).find(
    (tool) => tool.name === "bash",
  );
  if (!bash) throw new Error("Bash tool is unavailable");
  return await bash.execute("call-1", { command: "stub" });
}

describe("bash 的输出信号", () => {
  it("命令真的打印了东西:hasOutput 为 true", async () => {
    const result = await runBash(["hello\n"]);
    expect(result.details.hasOutput).toBe(true);
    expect(JSON.stringify(result.content)).toContain("hello");
  });

  it("只打印空白也算没有输出(否则界面会给出一个看起来是空的入口)", async () => {
    expect((await runBash(["   \n\t"])).details.hasOutput).toBe(false);
  });

  it("什么都没打印:hasOutput 为 false,正文只剩兜底句", async () => {
    const result = await runBash([]);
    expect(result.details.hasOutput).toBe(false);
    expect(JSON.stringify(result.content)).toContain("Command finished with exit code 0");
  });

  it("失败的命令同样带这个字段(界面按 exitCode 决定要不要保留入口)", async () => {
    const result = await runBash([], 127);
    expect(result.details.hasOutput).toBe(false);
    expect(result.details.exitCode).toBe(127);
  });
});
