import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DesktopReleaseService } from "../src/main/update/release-service.ts";

async function withTemporaryDirectories(run: (userData: string, downloads: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-release-service-"));
  try {
    await run(path.join(root, "user-data"), path.join(root, "downloads"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("lists stable releases, revalidates with ETag, and caches the result", async () => {
  await withTemporaryDirectories(async (userData, downloads) => {
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
      const service = new DesktopReleaseService(userData, downloads);
      assert.deepEqual((await service.list()).map((release) => release.version), ["1.2.3"]);
      assert.deepEqual((await service.list(true)).map((release) => release.version), ["1.2.3"]);
      assert.equal(requestCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("downloads and verifies the matching macOS installer", async () => {
  await withTemporaryDirectories(async (userData, downloads) => {
    const originalFetch = globalThis.fetch;
    const installerName = "Wordless-1.2.3-mac-arm64.dmg";
    const installer = Buffer.from("verified dmg fixture");
    const checksum = createHash("sha256").update(installer).digest("hex");
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("api.github.com")) return new Response(JSON.stringify([{ tag_name: "v1.2.3", name: "Wordless 1.2.3", body: "", published_at: "2026-07-31T00:00:00Z", html_url: "https://github.com/Austin-Patrician/Wordless/releases/tag/v1.2.3", draft: false, prerelease: false, assets: [{ name: installerName, browser_download_url: "https://downloads.invalid/wordless.dmg", size: installer.length }, { name: "SHA256SUMS.txt", browser_download_url: "https://downloads.invalid/SHA256SUMS.txt", size: 80 }] }]), { headers: { "content-type": "application/json" } });
      if (url.endsWith("SHA256SUMS.txt")) return new Response(`${checksum}  ${installerName}\n`);
      return new Response(installer, { headers: { "content-length": String(installer.length) } });
    };
    try {
      const progress: number[] = [];
      const service = new DesktopReleaseService(userData, downloads);
      const result = await service.downloadMacInstaller("1.2.3", "arm64", (percent) => progress.push(percent));
      assert.equal(result, path.join(downloads, installerName));
      assert.deepEqual(await readFile(result), installer);
      assert.equal(progress.at(-1), 100);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
