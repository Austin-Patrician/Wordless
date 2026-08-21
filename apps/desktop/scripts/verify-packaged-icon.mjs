import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isElectronDefaultExeIcon } from "./windows-icon.mjs";

const require = createRequire(import.meta.url);
const { NtExecutable, NtExecutableResource } = require("resedit");
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(appRoot, "release");
const requestedRoots = process.argv.slice(2);
const releaseEntries = requestedRoots.length
  ? requestedRoots.map((requested) => ({ name: requested, root: resolve(appRoot, requested) }))
  : readdirSync(releaseRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, root: join(releaseRoot, entry.name) }));
const executables = releaseEntries.flatMap((entry) => {
  const windowsExecutable = join(entry.root, "Wordless.exe");
  return existsSync(windowsExecutable) ? [{ file: windowsExecutable, label: entry.name }] : [];
});

if (executables.length === 0) throw new Error("No packaged Wordless.exe was found to verify");

for (const candidate of executables) {
  const executable = NtExecutable.from(readFileSync(candidate.file), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const icons = resources.entries
    .filter((entry) => entry.type === 3)
    .map((entry) => {
      const bytes = entry.bin.byteLength;
      const header = Buffer.from(entry.bin).subarray(0, 4);
      return { bytes, png: header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 };
    });
  if (isElectronDefaultExeIcon(icons)) {
    throw new Error(`Packaged ${candidate.label} still uses the default Electron icon`);
  }
  console.log(`Verified packaged Windows icon for ${candidate.label}.`);
}
