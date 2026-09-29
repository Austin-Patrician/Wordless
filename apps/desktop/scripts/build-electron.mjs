import { dirname, resolve } from "node:path";
import { copyFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { generateAppIcon } from "./generate-app-icon.mjs";
import { readWindowsIcon } from "./windows-icon.mjs";
import { isExternalRuntimeDependency } from "./external-packages.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const outputDirectory = resolve(appRoot, "dist/electron");
const applicationIcon = resolve(appRoot, "src/icons/common-icons/wordless.png");
const windowsApplicationIcon = resolve(appRoot, "build/icon.ico");
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((id) => `node:${id}`)]);

function isNodeBuiltin(id) {
  return nodeBuiltins.has(id) || id.startsWith("node:");
}

/**
 * **外化判定的规则表在 `scripts/external-packages.mjs`。**
 *
 * 这里原来是两张手写的谓词。它们只说"什么不该被内联",没说"那它从哪来" —— 于是
 * `@tailwindcss/node` 被 external 了却没随包发布,安装版永远缺一份编译器运行时。
 * 规则表因此多了一栏 `shippedBy`,由 `test/external-runtime-packages.test.ts` 守着。
 */

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
        external: (id) => id === "electron" || isNodeBuiltin(id) || isExternalRuntimeDependency(id),
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
