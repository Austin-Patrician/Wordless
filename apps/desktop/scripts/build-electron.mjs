import { dirname, resolve } from "node:path";
import { copyFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { generateAppIcon } from "./generate-app-icon.mjs";
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
  return id === "undici" || id === "sharp" || id.startsWith("sharp/") || id === "@img" || id.startsWith("@img/") || id === "@ff-labs/fff-node" || id.startsWith("@ff-labs/fff-node/") || id === "ffi-rs" || id.startsWith("ffi-rs/") || id.startsWith("@ff-labs/fff-bin-") || id.startsWith("@yuuang/ffi-rs-");
}

/**
 * 设计构建要用、但**不能被打进产物**的包。
 *
 * `@tailwindcss/node` 是 ESM 且带原生依赖(`lightningcss` / `oxide`),内联进产物既会让
 * 原生 require 在错误的路径上解析,也会让主进程产物无谓地变大 —— 它只在真要构建时才被
 * 动态 import。与上面那份原生依赖清单分开写,是因为它是 **JS 包但必须外部化**,成因不同。
 */
function isDesignBuildRuntimeDependency(id) {
  return (
    id === "@tailwindcss/node" || id.startsWith("@tailwindcss/node/") ||
    id === "@tailwindcss/oxide" || id.startsWith("@tailwindcss/oxide/") ||
    id === "tailwindcss" || id.startsWith("tailwindcss/") ||
    id === "lightningcss" || id.startsWith("lightningcss")
  );
}

async function buildEntry(entry, name, emptyOutDir, options = {}) {
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
      lib: { entry, fileName: () => `${name}${options.extension ?? ".cjs"}`, formats: [options.format ?? "cjs"] },
      minify: false,
      outDir: outputDirectory,
      sourcemap: true,
      target: "node22",
      rollupOptions: {
        external: (id) =>
          id === "electron" || isNodeBuiltin(id) || isNativeRuntimeDependency(id) || isDesignBuildRuntimeDependency(id),
      },
    },
  });
}

await buildEntry(resolve(appRoot, "src/main/index.ts"), "main", true);
await buildEntry(resolve(appRoot, "src/preload/index.ts"), "preload", false);
// 设计构建脚本。**打成 ESM**:`@tailwindcss/node` 是 ESM-only,而 CJS 产物里的动态 import
// 会被改写成 require —— 那条路在 ESM-only 包上不通。
await buildEntry(resolve(appRoot, "src/main/design/design-build-entry.ts"), "design-build", false, {
  format: "es",
  extension: ".mjs",
});
await generateAppIcon();
await readWindowsIcon(windowsApplicationIcon);
await copyFile(applicationIcon, resolve(outputDirectory, "wordless.png"));
await copyFile(windowsApplicationIcon, resolve(outputDirectory, "wordless.ico"));
