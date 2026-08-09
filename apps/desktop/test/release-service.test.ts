import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DesktopReleaseService } from "../src/main/update/release-service.ts";

async function withTemporaryDirectories(run: (userData: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-release-service-"));
  try {
    await run(path.join(root, "user-data"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("lists stable releases, revalidates with ETag, and caches the result", async () => {
  await withTemporaryDirectories(async (userData) => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async (_input, init) => {
      requestCount += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.["If-None-Match"] === '"release-etag"') return new Response(null, { status: 304 });
      return new Response(JSON.stringify({
        schemaVersion: 1,
        releases: [
          { version: "1.2.3", title: "Wordless 1.2.3", notes: "Useful changes", publishedAt: "2026-07-31T00:00:00Z", htmlUrl: "https://github.com/Austin-Patrician/Wordless/releases/tag/v1.2.3", prerelease: false, assets: [] },
          { version: "1.3.0-beta.1", title: "Beta", notes: "", publishedAt: "2026-07-31T00:00:00Z", htmlUrl: "https://example.invalid", prerelease: true, assets: [] },
        ],
      }), { headers: { etag: '"release-etag"', "content-type": "application/json" } });
    };
    try {
      const service = new DesktopReleaseService(userData);
      assert.deepEqual((await service.list()).map((release) => release.version), ["1.2.3"]);
      assert.deepEqual((await service.list(true)).map((release) => release.version), ["1.2.3"]);
      assert.equal(requestCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("resolves the architecture-specific macOS DMG from a cached release", async () => {
  await withTemporaryDirectories(async (userData) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      schemaVersion: 1,
      releases: [{
        version: "2.0.0",
        title: "Wordless 2.0.0",
        notes: "",
        publishedAt: "2026-08-01T00:00:00Z",
        htmlUrl: "https://github.com/Austin-Patrician/Wordless/releases/tag/v2.0.0",
        prerelease: false,
        assets: [
          { name: "Wordless-2.0.0-mac-arm64.dmg", urls: ["https://example.invalid/arm.dmg"], size: 10 },
          { name: "Wordless-2.0.0-mac-x64.dmg", urls: ["https://example.invalid/x64.dmg"], size: 11 },
        ],
      }],
    }));
    try {
      const service = new DesktopReleaseService(userData);
      assert.deepEqual(await service.findMacDmgAsset("2.0.0", "arm64"), {
        name: "Wordless-2.0.0-mac-arm64.dmg",
        url: "https://example.invalid/arm.dmg",
        size: 10,
      });
      assert.deepEqual(await service.findMacDmgAsset("v2.0.0", "x64"), {
        name: "Wordless-2.0.0-mac-x64.dmg",
        url: "https://example.invalid/x64.dmg",
        size: 11,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("falls back to the next installer mirror and verifies its checksum", async () => {
  await withTemporaryDirectories(async (userData) => {
    const originalFetch = globalThis.fetch;
    const installer = Buffer.from("verified Wordless installer");
    const sha256 = createHash("sha256").update(installer).digest("hex");
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://r2.invalid/Wordless-3.0.0-mac-arm64.dmg") return new Response("unavailable", { status: 503 });
      if (url === "https://github.invalid/Wordless-3.0.0-mac-arm64.dmg") return new Response(installer, { headers: { "content-length": String(installer.length) } });
      return new Response(JSON.stringify({
        schemaVersion: 1,
        releases: [{
          version: "3.0.0",
          title: "Wordless 3.0.0",
          notes: "",
          publishedAt: "2026-08-09T00:00:00Z",
          htmlUrl: "https://github.com/Austin-Patrician/Wordless/releases/tag/v3.0.0",
          prerelease: false,
          assets: [{
            name: "Wordless-3.0.0-mac-arm64.dmg",
            size: installer.length,
            sha256,
            urls: [
              "https://r2.invalid/Wordless-3.0.0-mac-arm64.dmg",
              "https://github.invalid/Wordless-3.0.0-mac-arm64.dmg",
            ],
          }],
        }],
      }));
    };
    try {
      const downloads = path.join(userData, "downloads");
      const service = new DesktopReleaseService(userData);
      const result = await service.downloadMacInstaller("3.0.0", "arm64", downloads, () => {});
      assert.deepEqual(await readFile(result), installer);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
