import { ExecutionError, err, type ShellExecOptions } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { describe, expect, it } from "vitest";

class TimeoutExecutionEnv extends NodeExecutionEnv {
  observedTimeout: number | undefined;

  override async exec(_command: string, options?: ShellExecOptions) {
    this.observedTimeout = options?.timeout;
    options?.onStdout?.("partial stdout");
    options?.onStderr?.("partial stderr");
    return err(new ExecutionError("timeout", `timeout:${options?.timeout}`));
  }
}

describe("Bash tool timeout", () => {
  it("applies the default timeout and returns retry guidance with partial output", async () => {
    const env = new TimeoutExecutionEnv({ cwd: process.cwd() });
    const bash = createHeadlessCodingTools(env).find((tool) => tool.name === "bash");
    if (!bash) throw new Error("Bash tool is unavailable");

    await expect(bash.execute("call-1", { command: "slow command" })).rejects.toThrow(
      /Command timed out after 30 seconds[\s\S]*partial stdout[\s\S]*partial stderr[\s\S]*larger explicit timeout/,
    );
    expect(env.observedTimeout).toBe(30);
  });

  it("honors an explicit model-provided timeout", async () => {
    const env = new TimeoutExecutionEnv({ cwd: process.cwd() });
    const bash = createHeadlessCodingTools(env).find((tool) => tool.name === "bash");
    if (!bash) throw new Error("Bash tool is unavailable");

    await expect(bash.execute("call-2", { command: "long command", timeout: 120 })).rejects.toThrow(
      "Command timed out after 120 seconds",
    );
    expect(env.observedTimeout).toBe(120);
  });
});
