import { dirname, resolve } from "node:path";
import { copyFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const outputDirectory = resolve(appRoot, "dist/electron");
const applicationIcon = resolve(appRoot, "src/icons/common-icons/wordless.png");
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((id) => `node:${id}`)]);

function isNodeBuiltin(id) {
  return nodeBuiltins.has(id) || id.startsWith("node:");
}

async function buildEntry(entry, name, emptyOutDir) {
  await build({
    configFile: false,
    logLevel: "error",
    publicDir: false,
    root: appRoot,
    build: {
      emptyOutDir,
      lib: { entry, fileName: () => `${name}.cjs`, formats: ["cjs"] },
      minify: false,
      outDir: outputDirectory,
      sourcemap: true,
      target: "node22",
      rollupOptions: {
        external: (id) => id === "electron" || isNodeBuiltin(id),
      },
    },
  });
}

await buildEntry(resolve(appRoot, "src/main/index.ts"), "main", true);
await buildEntry(resolve(appRoot, "src/preload/index.ts"), "preload", false);
await copyFile(applicationIcon, resolve(outputDirectory, "wordless.png"));
