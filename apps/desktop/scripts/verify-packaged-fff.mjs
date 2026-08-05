import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(appRoot, "release");
const smokeScript = join(appRoot, "scripts", "packaged-fff-smoke.mjs");
const requestedRoots = process.argv.slice(2);
const releaseEntries = requestedRoots.length
  ? requestedRoots.map((requested) => ({ name: requested, root: resolve(appRoot, requested) }))
  : readdirSync(releaseRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, root: join(releaseRoot, entry.name) }));
const candidates = releaseEntries.flatMap((entry) => {
  const root = entry.root;
  const macApp = join(root, "Wordless.app");
  if (existsSync(macApp)) return [{ executable: join(macApp, "Contents", "MacOS", "Wordless"), resources: join(macApp, "Contents", "Resources"), label: entry.name }];
  const windowsExecutable = join(root, "Wordless.exe");
  if (existsSync(windowsExecutable)) return [{ executable: windowsExecutable, resources: join(root, "resources"), label: entry.name }];
  return [];
});

if (candidates.length !== releaseEntries.length) throw new Error("One or more requested unpacked Wordless applications were not found");
for (const candidate of candidates) {
  const result = spawnSync(candidate.executable, [smokeScript, candidate.resources], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  if (result.status !== 0) throw new Error(`Packaged FFF smoke failed for ${candidate.label}:\n${result.stdout}\n${result.stderr}`);
  console.log(`Verified packaged FFF native search for ${candidate.label}.`);
}
