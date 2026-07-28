import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("bundled OfficeCLI matches the pinned release lock", async () => {
  const lock = JSON.parse(await readFile(path.resolve("scripts", "officecli.lock.json"), "utf8")) as { version: string; assets: Record<string, { url: string; sha256: string }> };
  const platform = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
  const assetName = `officecli-${platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
  const asset = lock.assets[assetName];
  assert.ok(asset, `missing ${assetName} from OfficeCLI lock`);
  assert.match(lock.version, /^v\d+\.\d+\.\d+$/);
  assert.equal(asset.url, `https://github.com/iOfficeAI/OfficeCLI/releases/download/${lock.version}/${assetName}`);
  const binary = await readFile(path.resolve("resources", "officecli", `${platform}-${process.arch}`, process.platform === "win32" ? "officecli.exe" : "officecli"));
  assert.equal(createHash("sha256").update(binary).digest("hex"), asset.sha256);
});
