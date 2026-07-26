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

function readLoginEnvironment(): Promise<NodeJS.ProcessEnv> {
  return new Promise((resolve) => {
    const child = spawn("/bin/zsh", ["-ilc", "env -0"], { stdio: ["ignore", "pipe", "ignore"] });
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
  if (host.platform !== "darwin") return;
  const environment = await readLoginEnvironment();
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export { parseEnvironment };
