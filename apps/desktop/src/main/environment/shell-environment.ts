import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import type { DesktopHostInfo } from "@wordless/protocol";

const inheritedKeys = /^(PATH|HOME|LANG|LC_|TMPDIR|SSH_AUTH_SOCK|SHELL|USER|LOGNAME|NVM_|VOLTA_|PNPM_|BUN_)/;

function parseEnvironment(value: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const entry of value.split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const key = entry.slice(0, separator);
    if (inheritedKeys.test(key)) result[key] = entry.slice(separator + 1);
  }
  return result;
}

/**
 * 用哪个 shell 去问"你的登录环境长什么样"。
 *
 * macOS 固定 `/bin/zsh` —— 系统登录 shell 就是它。Linux 取 `$SHELL`(用户自己选的登录 shell),
 * 但只认绝对路径且真实存在的,否则退回 `/bin/bash`、`/bin/sh`。
 *
 * 为什么 Linux 也需要这一步:从 .desktop 启动时进程环境里只有会话变量,而 nvm / pyenv /
 * `~/.local/bin` / cargo 这些东西是写在 shell 启动文件里的 —— 不问 shell,环境面板就会把用户明明
 * 装好的 node/python 报成"没有"。`-ilc` 那三个开关是这件事的全部:交互式 + 登录 + 执行一条命令。
 */
export function loginShellPath(options: {
  platform: NodeJS.Platform;
  /** `process.env.SHELL`。 */
  shell: string | undefined;
  exists?: (path: string) => boolean;
}): string | undefined {
  if (options.platform === "darwin") return "/bin/zsh";
  if (options.platform !== "linux") return undefined;
  const exists = options.exists ?? existsSync;
  const candidates = [options.shell, "/bin/bash", "/bin/sh"].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.startsWith("/"),
  );
  return candidates.find((candidate) => exists(candidate));
}

function readLoginEnvironment(shell: string): Promise<NodeJS.ProcessEnv> {
  return new Promise((resolve) => {
    const child = spawn(shell, ["-ilc", "env -0"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({});
    }, 4_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.once("error", () => { clearTimeout(timeout); resolve({}); });
    child.once("close", () => { clearTimeout(timeout); resolve(parseEnvironment(output)); });
  });
}

export async function hydrateShellEnvironment(host: DesktopHostInfo): Promise<void> {
  const shell = loginShellPath({ platform: host.platform, shell: process.env.SHELL });
  if (!shell) return;
  const environment = await readLoginEnvironment(shell);
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export { parseEnvironment };
