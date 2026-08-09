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
const artifactUrl = (name) => urlPrefix ? `${urlPrefix}/${name}` : name;
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const artifactPattern = new RegExp(`^Wordless-${escapedVersion}-mac-(?:arm64|x64)\\.(?:zip|dmg)$`, "i");
const names = (await readdir(releaseDirectory)).filter((name) => artifactPattern.test(name)).sort((left, right) => {
  const extensionOrder = Number(right.endsWith(".zip")) - Number(left.endsWith(".zip"));
  return extensionOrder || left.localeCompare(right);
});

const required = ["arm64.zip", "x64.zip", "arm64.dmg", "x64.dmg"];
for (const suffix of required) {
  if (!names.some((name) => name.endsWith(suffix))) throw new Error(`Missing macOS update artifact ending in ${suffix}`);
}

const files = [];
for (const name of names) {
  const filePath = path.join(releaseDirectory, name);
  files.push({ name, sha512: await sha512File(filePath), size: (await stat(filePath)).size });
}
const primary = files.find((file) => file.name.endsWith("mac-x64.zip")) ?? files.find((file) => file.name.endsWith(".zip"));
if (!primary) throw new Error("A macOS ZIP update artifact is required");

const lines = [
  `version: ${version}`,
  "files:",
  ...files.flatMap((file) => [
    `  - url: ${artifactUrl(file.name)}`,
    `    sha512: ${file.sha512}`,
    `    size: ${file.size}`,
  ]),
  `path: ${artifactUrl(primary.name)}`,
  `sha512: ${primary.sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  "",
];
await writeFile(outputPath, lines.join("\n"), "utf8");
