import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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
const downloadTimeoutMs = 120_000;

async function fetchBytes(url) {
  const resourceName = new URL(url).pathname.split("/").at(-1) ?? url;
  const curl = platform === "win32" ? "curl.exe" : "curl";
  try {
    console.log(`Downloading ${resourceName}...`);
    const { stdout } = await execFile(curl, [
      "--http1.1",
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry",
      "6",
      "--retry-all-errors",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "15",
      "--max-time",
      String(downloadTimeoutMs / 1_000),
      url,
    ], { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 });
    const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
    console.log(`Downloaded ${resourceName} (${bytes.byteLength.toLocaleString()} bytes).`);
    return bytes;
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  console.log(`Downloading ${resourceName} with Node fetch...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  console.log(`Downloaded ${resourceName} (${bytes.byteLength.toLocaleString()} bytes).`);
  return bytes;
}

async function downloadFile(url, temporaryDestination) {
  const resourceName = new URL(url).pathname.split("/").at(-1) ?? url;
  const curl = platform === "win32" ? "curl.exe" : "curl";
  const destinationPath = fileURLToPath(temporaryDestination);
  try {
    console.log(`Downloading ${resourceName} with resume support...`);
    await execFile(curl, [
      "--http1.1",
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry",
      "5",
      "--retry-all-errors",
      "--retry-delay",
      "2",
      "--connect-timeout",
      "15",
      "--speed-time",
      "30",
      "--speed-limit",
      "1024",
      "--continue-at",
      "-",
      "--output",
      destinationPath,
      url,
    ], { maxBuffer: 1024 * 1024 });
    const bytes = await readFile(temporaryDestination);
    console.log(`Downloaded ${resourceName} (${bytes.byteLength.toLocaleString()} bytes).`);
    return;
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  console.log(`Downloading ${resourceName} with Node fetch...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(temporaryDestination, bytes);
  console.log(`Downloaded ${resourceName} (${bytes.byteLength.toLocaleString()} bytes).`);
}

function expectedHash(sums, name) {
  const line = sums.split(/\r?\n/).find((candidate) => candidate.trim().endsWith(` ${name}`) || candidate.trim().endsWith(` *${name}`));
  const match = line?.match(/^([a-fA-F0-9]{64})\s+\*?.+$/);
  if (!match) throw new Error(`No SHA-256 checksum found for ${name}`);
  return match[1].toLowerCase();
}

async function fetchTemplate(target, source) {
  const destination = new URL(`presentation-templates/${target}`, resources);
  const temporaryDestination = new URL(`presentation-templates/${target}.part`, resources);
  await downloadFile(`https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/${version}/${source.split("/").map(encodeURIComponent).join("/")}`, temporaryDestination);
  await rm(destination, { force: true });
  await rename(temporaryDestination, destination);
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
const temporaryDestination = new URL(`officecli/${platformName}-${arch}/${executable}.part`, resources);
const versionFile = new URL(`officecli/${platformName}-${arch}/.wordless-officecli-version`, resources);
const templateSources = [
  ["aura-coffee.pptx", "examples/ppt/templates/styles/brand--aura-coffee/aura_coffee.pptx"],
  ["aura-coffee-dark.pptx", "examples/ppt/templates/styles/brand--aura-coffee-dark/AURA_COFFEE.pptx"],
  ["future-2050.pptx", "examples/ppt/templates/styles/future--2050-vision/未来已来_2050.pptx"],
  ["cat-philosophy.pptx", "examples/ppt/templates/styles/lifestyle--cat-philosophy/cat_philosophy.pptx"],
  ["cat-secret-life.pptx", "examples/ppt/templates/styles/lifestyle--cat-secret-life/Cat-Secret-Life.pptx"],
  ["feline-report.pptx", "examples/ppt/templates/styles/lifestyle--feline-report/Feline_Report.pptx"],
  ["aionui-promo.pptx", "examples/ppt/templates/styles/product--aionui-promo/AionUI-推广.pptx"],
  ["geminicli-timetravel.pptx", "examples/ppt/templates/styles/product--geminicli-timetravel/GeminiCLI-TimeTravel.pptx"],
  ["attention-budget.pptx", "examples/ppt/templates/styles/productivity--attention-budget/注意力预算-把手机时间变成创造时间.pptx"],
  ["alien-guide.pptx", "examples/ppt/templates/styles/science--alien-guide/Alien_Guide.pptx"],
  ["mars-settlement.pptx", "examples/ppt/templates/styles/science--mars-settlement/Mars-Settlement-Guide.pptx"],
  ["space-exploration.pptx", "examples/ppt/templates/styles/science--space-exploration/太空探索历程.pptx"],
  ["time-travel.pptx", "examples/ppt/templates/styles/science--time-travel/Time_Travel.pptx"],
  ["wildlife-company.pptx", "examples/ppt/templates/styles/tech--wildlife-company/野生动物科技公司.pptx"],
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
    await downloadFile(`${releaseBase}/${asset}`, temporaryDestination);
    const binary = await readFile(temporaryDestination);
    if (createHash("sha256").update(binary).digest("hex") !== expected) {
      await rm(temporaryDestination, { force: true });
      throw new Error(`SHA-256 mismatch for ${asset}`);
    }
    await rm(destination, { force: true });
    await rename(temporaryDestination, destination);
  }
  if (platform !== "win32") await chmod(destination, 0o755);
  await writeFile(versionFile, `${preparedVersion}\n`, "utf8");
}

await Promise.all(templateSources.map(([target, source]) => exists(new URL(`presentation-templates/${target}`, resources)).then((present) => present ? undefined : fetchTemplate(target, source))));

const notice = await readFile(new URL("third-party-notices/OfficeCLI-NOTICE.txt", resources), "utf8");
if (!notice.includes("OfficeCLI")) throw new Error("OfficeCLI notice is missing");
console.log(`Prepared OfficeCLI ${version} for ${platform}-${arch} from ${root.pathname}`);
