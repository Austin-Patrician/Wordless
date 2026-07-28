import { writeFile } from "node:fs/promises";

const version = process.argv[2];
if (!version || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error("Usage: npm run update:officecli --workspace @wordless/desktop -- vX.Y.Z");

const repository = "https://github.com/iOfficeAI/OfficeCLI";
const releaseBase = `${repository}/releases/download/${version}`;
const response = await fetch(`${releaseBase}/SHA256SUMS`);
if (!response.ok) throw new Error(`Unable to download OfficeCLI checksums (${response.status})`);
const sums = await response.text();
const supportedAssets = ["officecli-linux-arm64", "officecli-linux-x64", "officecli-mac-arm64", "officecli-mac-x64", "officecli-win-arm64.exe", "officecli-win-x64.exe"];
const assets = Object.fromEntries(supportedAssets.map((name) => {
  const line = sums.split(/\r?\n/).find((candidate) => candidate.trim().endsWith(` ${name}`) || candidate.trim().endsWith(` *${name}`));
  const hash = line?.match(/^([a-fA-F0-9]{64})\s+\*?.+$/)?.[1]?.toLowerCase();
  if (!hash) throw new Error(`OfficeCLI ${version} is missing a checksum for ${name}`);
  return [name, { url: `${releaseBase}/${name}`, sha256: hash }];
}));
const lock = { version, repository, assets, contracts: { formats: ["pptx", "xlsx"], xlsxElements: ["workbook", "sheet", "cell", "range", "table", "chart", "pivottable", "validation", "conditionalformatting"] } };
await writeFile(new URL("officecli.lock.json", import.meta.url), `${JSON.stringify(lock, null, 2)}\n`, "utf8");
console.log(`Locked OfficeCLI ${version}. Run prepare:officecli and the Office contract tests before committing.`);
