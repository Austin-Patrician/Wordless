import assert from "node:assert/strict";
import test from "node:test";
import type { MessageToolBlock } from "@wordless/domain";
import { hidesEmptySuccessfulBashOutput } from "../src/renderer/features/workbench/tool-output-visibility.ts";

/**
 * bash 命令那一行 `View output` 入口要不要出现。
 *
 * 这条规则曾经拿 `details.stdout` / `details.stderr` 判断,而 bash 工具从来不设这两个字段 ——
 * 于是它退化成"所有成功的 bash 都隐藏",用户看到的现象是:**命令执行中能看到输出入口,
 * 一旦跑完(exit 0)入口就消失**,只剩命令那一行。真输出和被截断的那份都一起没了。
 *
 * 所以这里逐条钉住"什么情况下必须保留入口":有输出、失败、被截断、还在跑、老记录。
 */

function block(details: unknown, overrides: Partial<MessageToolBlock> = {}): MessageToolBlock {
  return {
    type: "tool",
    callId: "call-1",
    name: "bash",
    state: "complete",
    output: "hello",
    details,
    ...overrides,
  };
}

/** 现在 bash 工具在成功路径上给出的 details 形状(见 packages/coding-agent 的 bash 工具)。 */
const successfulWithOutput = { command: "echo hello", elapsedMs: 12, exitCode: 0, timeoutSeconds: 30, hasOutput: true };
const successfulWithoutOutput = { command: "true", elapsedMs: 3, exitCode: 0, timeoutSeconds: 30, hasOutput: false };

test("成功且有输出的命令保留输出入口", () => {
  assert.equal(hidesEmptySuccessfulBashOutput(block(successfulWithOutput)), false);
});

test("成功且工具显式说没有输出时才隐藏", () => {
  assert.equal(hidesEmptySuccessfulBashOutput(block(successfulWithoutOutput)), true);
});

test("命令还在跑(还没有 exitCode)时保留入口 —— 实时输出正是要看的", () => {
  // 执行中:partial details 只有 command / timeoutSeconds。
  assert.equal(hidesEmptySuccessfulBashOutput(block({ command: "npm test", timeoutSeconds: 30 }, { state: "running" })), false);
});

test("失败的命令保留入口 —— 正文里可能有 failureHint 要给人读", () => {
  const failed = { command: "definitely-not-installed", elapsedMs: 9, exitCode: 127, timeoutSeconds: 30, hasOutput: false };
  assert.equal(hidesEmptySuccessfulBashOutput(block(failed, { state: "error" })), false);
});

test("输出被截断过的命令保留入口 —— 入口是唯一能读到那份的地方", () => {
  const truncated = { ...successfulWithOutput, truncated: true, fullOutputPath: "/tmp/bash-1.log" };
  assert.equal(hidesEmptySuccessfulBashOutput(block(truncated)), false);
  // 就算工具的信号本身是错的(截断过却说没输出),也不能把入口藏掉。
  const contradictory = { ...successfulWithoutOutput, truncated: true };
  assert.equal(hidesEmptySuccessfulBashOutput(block(contradictory)), false);
});

test("改动前写入的老记录(没有 hasOutput 字段)保留入口", () => {
  // 否则这次修改会把历史会话的输出入口一起吃掉。
  const legacy = { command: "npm test", elapsedMs: 9, exitCode: 0, timeoutSeconds: 30 };
  assert.equal(hidesEmptySuccessfulBashOutput(block(legacy)), false);
});

test("不是 bash 的工具一律不受这条规则影响", () => {
  assert.equal(hidesEmptySuccessfulBashOutput(block(successfulWithoutOutput, { name: "read" })), false);
  assert.equal(hidesEmptySuccessfulBashOutput(block(successfulWithoutOutput, { name: "grep" })), false);
});

test("details 缺失或不是对象时保留入口(宁可多一个入口,也不要凭空消失)", () => {
  assert.equal(hidesEmptySuccessfulBashOutput(block(undefined)), false);
  assert.equal(hidesEmptySuccessfulBashOutput(block(null)), false);
  assert.equal(hidesEmptySuccessfulBashOutput(block("Command finished with exit code 0")), false);
  assert.equal(hidesEmptySuccessfulBashOutput(block([1, 2])), false);
});
