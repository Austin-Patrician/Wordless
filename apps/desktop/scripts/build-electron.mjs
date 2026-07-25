import { dirname, resolve } from "node:path";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "..");
const outputDirectory = resolve(appRoot, "dist/electron");
const applicationIcon = resolve(appRoot, "src/icons/common-icons/wordless.png");

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
        external: (id) => id === "electron" || id.startsWith("node:") || id.startsWith("@wordless/") || id === "typebox" || id.startsWith("typebox/"),
      },
    },
  });
}

await buildEntry(resolve(appRoot, "src/main/index.ts"), "main", true);
await buildEntry(resolve(appRoot, "src/preload/index.ts"), "preload", false);
await copyFile(applicationIcon, resolve(outputDirectory, "wordless.png"));
