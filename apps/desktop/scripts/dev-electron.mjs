import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import electronPath from "electron";

const require = createRequire(import.meta.url);
const vitePackageRoot = resolve(dirname(require.resolve("vite")), "../..");
const vitePath = resolve(vitePackageRoot, "bin/vite.js");
const ansiPattern = /\u001B\[[0-?]*[ -/]*[@-~]/g;

function waitForRendererUrl(vite) {
  return new Promise((resolve, reject) => {
    let output = "";
    const onOutput = (chunk, write) => {
      write(chunk);
      output += chunk.toString();
      const match = output.replace(ansiPattern, "").match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) resolve(match[0]);
    };
    vite.stdout.on("data", (chunk) => onOutput(chunk, process.stdout.write.bind(process.stdout)));
    vite.stderr.on("data", (chunk) => onOutput(chunk, process.stderr.write.bind(process.stderr)));
    vite.once("error", reject);
    vite.once("exit", (code) => reject(new Error(`Vite exited before it became ready (code ${code ?? "unknown"}).`)));
  });
}

const port = process.env.WORDLESS_RENDERER_PORT ?? "5173";
const vite = spawn(process.execPath, [vitePath, "--config", "vite.renderer.config.ts", "--host", "127.0.0.1", "--port", port, "--strictPort"], {
  env: { ...process.env, NO_COLOR: "1" },
  stdio: ["inherit", "pipe", "pipe"],
});

const rendererUrl = await waitForRendererUrl(vite);
console.log(`Starting Electron with renderer ${rendererUrl}`);

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(rendererUrl);
    if (response.ok) {
      break;
    }
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const electron = spawn(electronPath, ["dist/electron/main.cjs"], {
  env: {
    ...process.env,
    WORDLESS_RENDERER_URL: rendererUrl,
  },
  stdio: "inherit",
});

const shutdown = () => {
  vite.kill();
  electron.kill();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
