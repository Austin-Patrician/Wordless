import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const retentionScript = new URL("../scripts/plan-r2-release-retention.mjs", import.meta.url);

test("R2 retention keeps five stable version directories and never deletes shared or legacy objects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-r2-retention-"));
  try {
    const releasesPath = path.join(root, "github-releases.json");
    const objectsPath = path.join(root, "r2-objects.json");
    const outputDirectory = path.join(root, "plan");
    const versions = ["0.2.5", "0.2.4", "0.2.3", "0.2.2", "0.2.1", "0.1.8"];
    await writeFile(releasesPath, JSON.stringify(versions.map((version) => ({
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
    }))));
    await writeFile(objectsPath, JSON.stringify({ Contents: [
      ...versions.flatMap((version) => [
        { Key: `releases/v${version}/Wordless-${version}-mac-arm64.dmg` },
        { Key: `releases/v${version}/Wordless-${version}-win-x64.exe.blockmap` },
        { Key: `releases/v${version}/SHA256SUMS.txt` },
      ]),
      { Key: "releases/releases.json" },
      { Key: "releases/latest-mac.yml" },
      { Key: "releases/Wordless-0.1.8-mac-arm64.dmg" },
      { Key: "releases/unrecognized-user-file.bin" },
    ] }));

    await execFileAsync(process.execPath, [
      retentionScript.pathname,
      "--github-releases", releasesPath,
      "--r2-objects", objectsPath,
      "--output-directory", outputDirectory,
      "--retain", "5",
    ]);
    const plan = JSON.parse(await readFile(path.join(outputDirectory, "delete-001.json"), "utf8"));
    assert.deepEqual(plan.Objects, [
      { Key: "releases/v0.1.8/Wordless-0.1.8-mac-arm64.dmg" },
      { Key: "releases/v0.1.8/Wordless-0.1.8-win-x64.exe.blockmap" },
      { Key: "releases/v0.1.8/SHA256SUMS.txt" },
    ]);

    await assert.rejects(execFileAsync(process.execPath, [
      retentionScript.pathname,
      "--github-releases", releasesPath,
      "--r2-objects", objectsPath,
      "--output-directory", path.join(root, "failed-verification"),
      "--retain", "5",
      "--verify-clean",
    ]), /retention verification found 3 stale release artifacts/);

    const cleanObjectsPath = path.join(root, "r2-objects-clean.json");
    const objects = JSON.parse(await readFile(objectsPath, "utf8"));
    objects.Contents = objects.Contents.filter(({ Key }: { Key: string }) => !Key.startsWith("releases/v0.1.8/"));
    await writeFile(cleanObjectsPath, JSON.stringify(objects));
    await execFileAsync(process.execPath, [
      retentionScript.pathname,
      "--github-releases", releasesPath,
      "--r2-objects", cleanObjectsPath,
      "--output-directory", path.join(root, "verification"),
      "--retain", "5",
      "--verify-clean",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
