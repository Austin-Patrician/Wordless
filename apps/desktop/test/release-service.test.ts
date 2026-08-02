import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
      return new Response(JSON.stringify([
        { tag_name: "v1.2.3", name: "Wordless 1.2.3", body: "Useful changes", published_at: "2026-07-31T00:00:00Z", html_url: "https://github.com/Austin-Patrician/Wordless/releases/tag/v1.2.3", draft: false, prerelease: false, assets: [] },
        { tag_name: "v1.3.0-beta.1", name: "Beta", body: "", published_at: "2026-07-31T00:00:00Z", html_url: "https://example.invalid", draft: false, prerelease: true, assets: [] },
      ]), { headers: { etag: '"release-etag"', "content-type": "application/json" } });
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
    globalThis.fetch = async () => new Response(JSON.stringify([
      {
        tag_name: "v2.0.0",
        name: "Wordless 2.0.0",
        body: "",
        published_at: "2026-08-01T00:00:00Z",
        html_url: "https://github.com/Austin-Patrician/Wordless/releases/tag/v2.0.0",
        draft: false,
        prerelease: false,
        assets: [
          { name: "Wordless-2.0.0-mac-arm64.dmg", browser_download_url: "https://example.invalid/arm.dmg", size: 10 },
          { name: "Wordless-2.0.0-mac-x64.dmg", browser_download_url: "https://example.invalid/x64.dmg", size: 11 },
        ],
      },
    ]));
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
