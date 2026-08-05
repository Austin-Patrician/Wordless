import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const resourcesPath = process.argv[2];
if (!resourcesPath) throw new Error("Packaged Electron resources path is required");

const modulePath = resolve(resourcesPath, "app.asar.unpacked", "node_modules", "@ff-labs", "fff-node", "dist", "src", "index.js");
const { FileFinder } = await import(pathToFileURL(modulePath).href);
const root = mkdtempSync(join(tmpdir(), "wordless-packaged-fff-"));
try {
  writeFileSync(join(root, "packed.txt"), "native search works\n");
  const created = FileFinder.create({ basePath: root, aiMode: true });
  if (!created.ok) throw new Error(created.error);
  try {
    const ready = await created.value.waitForScan(5_000);
    if (!ready.ok || !ready.value) throw new Error(ready.ok ? "FFF packaged scan timed out" : ready.error);
    const found = created.value.grep("native search");
    if (!found.ok || found.value.items.length !== 1) throw new Error(found.ok ? "FFF packaged grep returned no result" : found.error);
  } finally {
    created.value.destroy();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
