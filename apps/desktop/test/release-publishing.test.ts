import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const scriptsDirectory = new URL("../scripts/", import.meta.url);

test("update manifests use the immutable version directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-update-manifests-"));
  try {
    const artifacts = new Map([
      ["Wordless-1.2.3-mac-arm64.zip", "mac-arm64-zip"],
      ["Wordless-1.2.3-mac-x64.zip", "mac-x64-zip"],
      ["Wordless-1.2.3-mac-arm64.dmg", "mac-arm64-dmg"],
      ["Wordless-1.2.3-mac-x64.dmg", "mac-x64-dmg"],
      ["Wordless-1.2.3-win-x64.exe", "windows-exe"],
    ]);
    await Promise.all([...artifacts].map(([name, contents]) => writeFile(path.join(root, name), contents)));

    const windowsOutput = path.join(root, "latest.yml");
    const macOutput = path.join(root, "latest-mac.yml");
    await execFileAsync(process.execPath, [
      new URL("generate-windows-update-manifest.mjs", scriptsDirectory).pathname,
      "--release-dir", root,
      "--version", "1.2.3",
      "--url-prefix", "v1.2.3",
      "--output", windowsOutput,
    ]);
    await execFileAsync(process.execPath, [
      new URL("generate-mac-update-manifest.mjs", scriptsDirectory).pathname,
      "--release-dir", root,
      "--version", "1.2.3",
      "--url-prefix", "v1.2.3",
      "--output", macOutput,
    ]);

    const windows = await readFile(windowsOutput, "utf8");
    const mac = await readFile(macOutput, "utf8");
    assert.match(windows, /url: v1\.2\.3\/Wordless-1\.2\.3-win-x64\.exe/);
    assert.match(windows, /path: v1\.2\.3\/Wordless-1\.2\.3-win-x64\.exe/);
    assert.ok(windows.includes(createHash("sha512").update("windows-exe").digest("base64")));
    for (const name of [...artifacts.keys()].filter((name) => /mac/.test(name))) {
      assert.match(mac, new RegExp(`url: v1\\.2\\.3/${name.replaceAll(".", "\\.")}`));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release manifest exposes only objects that exist in version directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-release-manifest-"));
  try {
    const releaseDirectory = path.join(root, "release");
    await mkdir(releaseDirectory);
    const currentName = "Wordless-1.2.3-win-x64.exe";
    const checksumName = "SHA256SUMS.txt";
    await writeFile(path.join(releaseDirectory, currentName), "current-installer");
    await writeFile(path.join(releaseDirectory, checksumName), "checksum-data");

    const githubReleases = [
      {
        tag_name: "v1.2.3",
        name: "Wordless 1.2.3",
        draft: false,
        prerelease: false,
        assets: [
          { name: currentName, size: 17, browser_download_url: `https://github.invalid/${currentName}` },
          { name: checksumName, size: 13, browser_download_url: `https://github.invalid/${checksumName}` },
        ],
      },
      {
        tag_name: "v1.2.2",
        name: "Wordless 1.2.2",
        draft: false,
        prerelease: false,
        assets: [
          { name: "Wordless-1.2.2-win-x64.exe", size: 10, browser_download_url: "https://github.invalid/old.exe" },
        ],
      },
      {
        tag_name: "v1.2.1",
        name: "Wordless 1.2.1",
        draft: false,
        prerelease: false,
        assets: [
          { name: "Wordless-1.2.1-win-x64.exe", size: 10, browser_download_url: "https://github.invalid/legacy.exe" },
        ],
      },
    ];
    const githubPath = path.join(root, "github-releases.json");
    const objectsPath = path.join(root, "r2-objects.json");
    const outputPath = path.join(root, "releases.json");
    await writeFile(githubPath, JSON.stringify(githubReleases));
    await writeFile(objectsPath, JSON.stringify({ Contents: [
      { Key: `releases/v1.2.3/${currentName}` },
      { Key: `releases/v1.2.3/${checksumName}` },
      { Key: "releases/v1.2.2/Wordless-1.2.2-win-x64.exe" },
      { Key: "releases/Wordless-1.2.1-win-x64.exe" },
    ] }));

    await execFileAsync(process.execPath, [
      new URL("generate-release-manifest.mjs", scriptsDirectory).pathname,
      "--release-dir", releaseDirectory,
      "--github-releases", githubPath,
      "--r2-objects", objectsPath,
      "--output", outputPath,
      "--public-base-url", "https://download.example/releases",
      "--current-tag", "v1.2.3",
    ]);

    const manifest = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(manifest.releases[0].assets[0].urls, [
      `https://download.example/releases/v1.2.3/${currentName}`,
      `https://github.invalid/${currentName}`,
    ]);
    assert.deepEqual(manifest.releases[1].assets[0].urls, [
      "https://download.example/releases/v1.2.2/Wordless-1.2.2-win-x64.exe",
      "https://github.invalid/old.exe",
    ]);
    assert.deepEqual(manifest.releases[2].assets[0].urls, ["https://github.invalid/legacy.exe"]);
    assert.equal(manifest.releases[0].assets[0].sha256, createHash("sha256").update("current-installer").digest("hex"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
