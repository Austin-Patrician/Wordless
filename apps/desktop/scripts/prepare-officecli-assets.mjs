import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const version = "v1.0.142";
const root = new URL("..", import.meta.url);
const resources = new URL("../resources/", import.meta.url);
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const platform = option("platform", process.platform);
const arch = option("arch", process.arch);
const platformName = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
const executable = platform === "win32" ? "officecli.exe" : "officecli";
const asset = platform === "linux" ? `officecli-linux-${arch}` : `officecli-${platformName}-${arch}${platform === "win32" ? ".exe" : ""}`;
const releaseBase = `https://github.com/iOfficeAI/OfficeCLI/releases/download/${version}`;
const preparedVersion = `${version}:${asset}`;
const execFile = promisify(execFileCallback);

async function fetchBytes(url) {
  if (platform !== "win32") {
    try {
      const { stdout } = await execFile("curl", ["--fail", "--location", "--silent", "--show-error", url], { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 });
      return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function expectedHash(sums, name) {
  const line = sums.split(/\r?\n/).find((candidate) => candidate.trim().endsWith(` ${name}`) || candidate.trim().endsWith(` *${name}`));
  const match = line?.match(/^([a-fA-F0-9]{64})\s+\*?.+$/);
  if (!match) throw new Error(`No SHA-256 checksum found for ${name}`);
  return match[1].toLowerCase();
}

async function fetchTemplate(target, source) {
  const data = await fetchBytes(`https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/${version}/${source.split("/").map(encodeURIComponent).join("/")}`);
  await writeFile(new URL(`presentation-templates/${target}`, resources), data);
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

const destination = new URL(`officecli/${platformName}-${arch}/${executable}`, resources);
const versionFile = new URL(`officecli/${platformName}-${arch}/.wordless-officecli-version`, resources);
const templateSources = [
  ["aura-coffee.pptx", "examples/ppt/templates/styles/brand--aura-coffee/aura_coffee.pptx"],
  ["aura-coffee-dark.pptx", "examples/ppt/templates/styles/brand--aura-coffee-dark/AURA_COFFEE.pptx"],
  ["aionui-promo.pptx", "examples/ppt/templates/styles/product--aionui-promo/AionUI-推广.pptx"],
  ["attention-budget.pptx", "examples/ppt/templates/styles/productivity--attention-budget/注意力预算-把手机时间变成创造时间.pptx"],
];
await mkdir(new URL(`officecli/${platformName}-${arch}/`, resources), { recursive: true });
await mkdir(new URL("presentation-templates/", resources), { recursive: true });
const currentVersion = await readFile(versionFile, "utf8").catch(() => "");
if (currentVersion.trim() !== preparedVersion || !(await exists(destination))) {
  const sums = (await fetchBytes(`${releaseBase}/SHA256SUMS`)).toString("utf8");
  const expected = expectedHash(sums, asset);
  const current = await readFile(destination).catch(() => undefined);
  const actual = current ? createHash("sha256").update(current).digest("hex") : undefined;
  if (actual !== expected) {
    const binary = await fetchBytes(`${releaseBase}/${asset}`);
    if (createHash("sha256").update(binary).digest("hex") !== expected) throw new Error(`SHA-256 mismatch for ${asset}`);
    await writeFile(destination, binary);
  }
  if (platform !== "win32") await chmod(destination, 0o755);
  await writeFile(versionFile, `${preparedVersion}\n`, "utf8");
}

await Promise.all(templateSources.map(([target, source]) => exists(new URL(`presentation-templates/${target}`, resources)).then((present) => present ? undefined : fetchTemplate(target, source))));

const notice = await readFile(new URL("third-party-notices/OfficeCLI-NOTICE.txt", resources), "utf8");
if (!notice.includes("OfficeCLI")) throw new Error("OfficeCLI notice is missing");
console.log(`Prepared OfficeCLI ${version} for ${platform}-${arch} from ${root.pathname}`);
