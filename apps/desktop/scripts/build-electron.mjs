import { dirname, resolve } from "node:path";
import { copyFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { readWindowsIcon } from "./windows-icon.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const outputDirectory = resolve(appRoot, "dist/electron");
const applicationIcon = resolve(appRoot, "src/icons/common-icons/wordless.png");
const windowsApplicationIcon = resolve(appRoot, "build/icon.ico");
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((id) => `node:${id}`)]);

function isNodeBuiltin(id) {
  return nodeBuiltins.has(id) || id.startsWith("node:");
}

function isNativeRuntimeDependency(id) {
  return id === "undici" || id === "@ff-labs/fff-node" || id.startsWith("@ff-labs/fff-node/") || id === "ffi-rs" || id.startsWith("ffi-rs/") || id.startsWith("@ff-labs/fff-bin-") || id.startsWith("@yuuang/ffi-rs-");
}

async function buildEntry(entry, name, emptyOutDir) {
  await build({
    configFile: false,
    logLevel: "error",
    publicDir: false,
    root: appRoot,
    define: {
      __WORDLESS_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.WORDLESS_GOOGLE_CLIENT_ID?.trim() ?? ""),
      __WORDLESS_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.WORDLESS_GOOGLE_CLIENT_SECRET?.trim() ?? ""),
      __WORDLESS_SKILLSMP_API_KEY__: JSON.stringify(process.env.WORDLESS_SKILLSMP_API_KEY?.trim() ?? ""),
    },
    build: {
      emptyOutDir,
      lib: { entry, fileName: () => `${name}.cjs`, formats: ["cjs"] },
      minify: false,
      outDir: outputDirectory,
      sourcemap: true,
      target: "node22",
      rollupOptions: {
        external: (id) => id === "electron" || isNodeBuiltin(id) || isNativeRuntimeDependency(id),
      },
    },
  });
}

await buildEntry(resolve(appRoot, "src/main/index.ts"), "main", true);
await buildEntry(resolve(appRoot, "src/preload/index.ts"), "preload", false);
await readWindowsIcon(windowsApplicationIcon);
await copyFile(applicationIcon, resolve(outputDirectory, "wordless.png"));
await copyFile(windowsApplicationIcon, resolve(outputDirectory, "wordless.ico"));
