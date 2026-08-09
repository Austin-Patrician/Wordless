import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name, { optional = false } = {}) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    if (optional) return undefined;
    throw new Error(`Missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

const githubReleasesPath = path.resolve(argument("--github-releases"));
const r2ObjectsPath = path.resolve(argument("--r2-objects"));
const outputDirectory = path.resolve(argument("--output-directory"));
const retain = Number.parseInt(argument("--retain"), 10);
const verifyClean = process.argv.includes("--verify-clean");

if (!Number.isSafeInteger(retain) || retain < 1) throw new Error("--retain must be a positive integer");

const githubReleases = JSON.parse(await readFile(githubReleasesPath, "utf8"));
const r2Objects = JSON.parse(await readFile(r2ObjectsPath, "utf8"));
if (!Array.isArray(githubReleases)) throw new Error("GitHub releases input must be an array");
if (r2Objects.Contents !== undefined && !Array.isArray(r2Objects.Contents)) throw new Error("R2 objects input has an invalid Contents field");

const stableVersions = githubReleases
  .filter((release) => release && !release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name))
  .map((release) => release.tag_name.slice(1));
const retainedVersions = new Set(stableVersions.slice(0, retain));
if (retainedVersions.size < 1) throw new Error("No stable GitHub release versions are available for retention");

// Only objects inside strict semantic-version directories are eligible. Shared and legacy objects are never removed.
const artifactPattern = /^releases\/v(\d+\.\d+\.\d+)\/[^/]+$/;
const staleKeys = (r2Objects.Contents ?? []).flatMap((object) => {
  if (!object || typeof object.Key !== "string") return [];
  const match = artifactPattern.exec(object.Key);
  return match && !retainedVersions.has(match[1]) ? [object.Key] : [];
});

console.log(`Retaining R2 releases: ${[...retainedVersions].map((version) => `v${version}`).join(", ")}`);
if (verifyClean) {
  if (staleKeys.length) throw new Error(`R2 retention verification found ${staleKeys.length} stale release artifacts`);
  console.log("R2 release retention verification passed");
  process.exit(0);
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (let index = 0; index < staleKeys.length; index += 1_000) {
  const batch = staleKeys.slice(index, index + 1_000);
  const batchNumber = String(index / 1_000 + 1).padStart(3, "0");
  await writeFile(
    path.join(outputDirectory, `delete-${batchNumber}.json`),
    `${JSON.stringify({ Objects: batch.map((Key) => ({ Key })), Quiet: true }, null, 2)}\n`,
    "utf8",
  );
}
console.log(staleKeys.length ? `Planned deletion of ${staleKeys.length} stale R2 artifacts` : "No stale R2 release artifacts to delete");
