import { spawn } from "node:child_process";
import type { BuildRunner, BuildRunnerInput, BuildRunnerResult } from "./design-builder.ts";

/**
 * 真实现:一次构建 = 一个子进程。
 *
 * 与仓库里其余子进程调用保持同一套做法(`data-analysis-service` / `office-cli-service`):
 * `settled` 守卫保证只结算一次、`clearTimeout` 不留悬空计时器、超时杀掉**整棵进程树**
 * (Windows 上 `child.kill` 只杀壳,真活儿在子进程里)。
 *
 * **超时由这里实现,而不是由调用方。** 只有这里拿着进程句柄,才可能让一个不肯退出的
 * 子进程真的停下 —— 调用方只能选择"继续等"或"不等了",而"不等了"会把子进程漏在后台。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 输出上限。构建输出可能很长(依赖安装、打包进度),全量留在内存里没有意义。 */
const MAX_OUTPUT_CHARS = 64_000;

export class NodeBuildRunner implements BuildRunner {
  async run(input: BuildRunnerInput): Promise<BuildRunnerResult> {
    return await new Promise<BuildRunnerResult>((resolve, reject) => {
      let child;
      try {
        child = spawn(input.command, input.args, {
          cwd: input.cwd,
          // 继承环境,再叠加方案给出的变量(`ELECTRON_RUN_AS_NODE` 这类)。
          env: { ...process.env, ...input.env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const stopTree = (): void => {
        if (child.pid === undefined) return;
        if (process.platform === "win32") {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } else {
          child.kill("SIGKILL");
        }
      };

      const finish = (result: BuildRunnerResult | { error: Error }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if ("error" in result) reject(result.error);
        else resolve(result);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        stopTree();
        // 不在这里结算:先让 `close` 到达,好把已经吐出来的输出一并交回去 —— 超时的
        // 构建最有用的信息往往就在最后几行里。
        // 但子进程可能杀不掉,所以再给一个兜底,避免构建器永远卡住。
        fallback = setTimeout(() => finish({ code: null, timedOut: true, stdout, stderr }), 2_000);
      }, input.timeoutMs);
      let fallback: NodeJS.Timeout | undefined;

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString();
      });

      // 连进程都没起来(ENOENT / EACCES)。这一条抛给调用方,由它归到 `spawn-failed`。
      child.on("error", (error) => finish({ error }));

      child.on("close", (code) => {
        if (fallback !== undefined) clearTimeout(fallback);
        finish({ code, timedOut, stdout, stderr });
      });
    });
  }
}
