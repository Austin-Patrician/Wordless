import { NodeExecutionEnv } from "@wordless/agent/node";
import {
  commandToolDescription,
  commandToolSnippet,
  commandToolUnavailableHint,
  createHeadlessCodingTools,
} from "@wordless/coding-agent";
import { describe, expect, it } from "vitest";

/**
 * 临时把 `process.platform` 换成 win32 —— 仓库里已有同样的手法
 * (`packages/agent/test/harness/nodejs-env.test.ts`)。
 */
function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  try {
    return run();
  } finally {
    if (descriptor) Object.defineProperty(process, "platform", descriptor);
  }
}

describe("命令工具告诉模型它跑在哪个 shell 上", () => {
  it("POSIX 上不提 PowerShell", () => {
    expect(commandToolSnippet("darwin")).toContain("bash");
    expect(commandToolSnippet("darwin")).not.toContain("PowerShell");
    expect(commandToolDescription("linux")).not.toContain("PowerShell");
  });

  it("Windows 上明说 PowerShell,并写清最容易踩的两处", () => {
    const snippet = commandToolSnippet("win32");
    expect(snippet).toContain("PowerShell");
    // `&&` 与 `$VAR` 是模型最可能从 POSIX 习惯里带过来的两个写法。
    expect(snippet).toContain("&&");
    expect(snippet).toContain(";");
    expect(snippet).toContain("$env:");
    expect(commandToolDescription("win32")).toContain("PowerShell");
  });

  it("模型读到的那一句就是平台那一句(不能只写在完整描述里)", () => {
    const env = new NodeExecutionEnv({ cwd: process.cwd() });
    // defineTool 默认取描述的第一句;平台差异如果只加在描述末尾,模型永远看不到。
    const windowsBash = withPlatform("win32", () => createHeadlessCodingTools(env).find((tool) => tool.name === "bash"));
    const posixBash = createHeadlessCodingTools(env).find((tool) => tool.name === "bash");

    expect(windowsBash?.promptSnippet).toContain("$env:NAME");
    expect(windowsBash?.description).toContain("PowerShell");
    expect(posixBash?.promptSnippet).not.toContain("PowerShell");
  });

  it("没有可用 shell 时给一句能指路的说明,别的错误码不加料", () => {
    const hint = commandToolUnavailableHint({ code: "shell_unavailable", message: "Custom shell path not found: /nope" });
    expect(hint).toContain("Settings → Environment");
    expect(commandToolUnavailableHint({ code: "timeout", message: "timed out" })).toBeUndefined();
    expect(commandToolUnavailableHint({ code: "spawn_error", message: "boom" })).toBeUndefined();
  });
});
