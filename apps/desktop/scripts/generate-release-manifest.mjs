import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing required argument ${name}`);
  return process.argv[index + 1];
}

function normalizedBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("The public release base URL must use HTTPS");
  return url.toString().replace(/\/$/, "");
}

function assetUrl(baseUrl, name) {
  return `${baseUrl}/${encodeURIComponent(name)}`;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const releaseDirectory = path.resolve(argument("--release-dir"));
const githubReleasesPath = path.resolve(argument("--github-releases"));
const outputPath = path.resolve(argument("--output"));
const publicBaseUrl = normalizedBaseUrl(argument("--public-base-url"));
const currentTag = argument("--current-tag");

const githubReleases = JSON.parse(await readFile(githubReleasesPath, "utf8"));
if (!Array.isArray(githubReleases)) throw new Error("GitHub releases input must be an array");

const localNames = new Set((await readdir(releaseDirectory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name));
const localHashes = new Map();
for (const name of localNames) {
  if (name === path.basename(outputPath) || name === path.basename(githubReleasesPath)) continue;
  localHashes.set(name, await sha256File(path.join(releaseDirectory, name)));
}

const releases = githubReleases
  .filter((release) => release && !release.draft && !release.prerelease && typeof release.tag_name === "string")
  .slice(0, 20)
  .map((release) => ({
    version: release.tag_name.replace(/^v/i, ""),
    title: typeof release.name === "string" && release.name.trim() ? release.name.trim() : `Wordless ${release.tag_name.replace(/^v/i, "")}`,
    notes: typeof release.body === "string" ? release.body : "",
    publishedAt: typeof release.published_at === "string" ? release.published_at : "",
    htmlUrl: typeof release.html_url === "string" ? release.html_url : "https://github.com/Austin-Patrician/Wordless/releases",
    prerelease: false,
    assets: Array.isArray(release.assets)
      ? release.assets.flatMap((asset) => {
          if (!asset || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") return [];
          const mirrored = release.tag_name === currentTag && localNames.has(asset.name);
          return [{
            name: asset.name,
            size: typeof asset.size === "number" ? asset.size : 0,
            sha256: mirrored ? localHashes.get(asset.name) : undefined,
            urls: [
              ...(mirrored ? [assetUrl(publicBaseUrl, asset.name)] : []),
              asset.browser_download_url,
            ],
          }];
        })
      : [],
  }));

if (!releases.some((release) => `v${release.version}` === currentTag)) {
  throw new Error(`Published release ${currentTag} was not returned by the GitHub Releases API`);
}

await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), releases }, null, 2)}\n`, "utf8");
