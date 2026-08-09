import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing required argument ${name}`);
  return process.argv[index + 1];
}

function optionalArgument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index < 0 || !process.argv[index + 1] ? fallback : process.argv[index + 1];
}

async function sha512File(filePath) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("base64");
}

const releaseDirectory = path.resolve(argument("--release-dir"));
const version = argument("--version").replace(/^v/i, "");
const outputPath = path.resolve(argument("--output"));
const urlPrefix = optionalArgument("--url-prefix").replace(/^\/+|\/+$/g, "");
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const artifactPattern = new RegExp(`^Wordless-${escapedVersion}-win-x64\\.exe$`, "i");
const name = (await readdir(releaseDirectory)).find((candidate) => artifactPattern.test(candidate));
if (!name) throw new Error(`Missing Windows update artifact for ${version}`);

const filePath = path.join(releaseDirectory, name);
const sha512 = await sha512File(filePath);
const size = (await stat(filePath)).size;
const url = urlPrefix ? `${urlPrefix}/${name}` : name;
const lines = [
  `version: ${version}`,
  "files:",
  `  - url: ${url}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${url}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  "",
];

await writeFile(outputPath, lines.join("\n"), "utf8");
