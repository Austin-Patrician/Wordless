import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DesktopRelease } from "@wordless/protocol";

const RELEASES_API = "https://api.github.com/repos/Austin-Patrician/Wordless/releases";
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

type GithubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type GithubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubAsset[];
};

type ReleaseCache = {
  etag?: string;
  fetchedAt: number;
  releases: GithubRelease[];
};

function requestHeaders(etag?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Wordless-Desktop",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(etag ? { "If-None-Match": etag } : {}),
  };
}

function publicRelease(release: GithubRelease): DesktopRelease {
  return {
    version: release.tag_name.replace(/^v/, ""),
    title: release.name?.trim() || `Wordless ${release.tag_name.replace(/^v/, "")}`,
    notes: release.body ?? "",
    publishedAt: release.published_at ?? "",
    htmlUrl: release.html_url,
    prerelease: release.prerelease,
  };
}

export class DesktopReleaseService {
  private cache: ReleaseCache | null = null;
  private readonly cachePath: string;
  private readonly downloadsPath: string;

  constructor(userDataPath: string, downloadsPath: string) {
    this.cachePath = path.join(userDataPath, "updates", "releases.json");
    this.downloadsPath = downloadsPath;
  }

  async list(refresh = false): Promise<DesktopRelease[]> {
    const releases = await this.load(refresh);
    return releases.map(publicRelease);
  }

  async release(version: string): Promise<GithubRelease> {
    const normalized = version.replace(/^v/, "");
    const releases = await this.load(false);
    const match = releases.find((candidate) => candidate.tag_name.replace(/^v/, "") === normalized);
    if (match) return match;
    const refreshed = await this.load(true);
    const refreshedMatch = refreshed.find((candidate) => candidate.tag_name.replace(/^v/, "") === normalized);
    if (!refreshedMatch) throw new Error(`Wordless ${normalized} is no longer available on GitHub`);
    return refreshedMatch;
  }

  async downloadMacInstaller(version: string, arch: string, onProgress: (percent: number) => void): Promise<string> {
    const release = await this.release(version);
    const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const installerPattern = new RegExp(`^Wordless-${escapedVersion}-mac-${arch}\\.dmg$`, "i");
    const universalPattern = new RegExp(`^Wordless-${escapedVersion}-mac-universal\\.dmg$`, "i");
    const installer = release.assets.find((asset) => installerPattern.test(asset.name)) ?? release.assets.find((asset) => universalPattern.test(asset.name));
    const checksums = release.assets.find((asset) => asset.name === "SHA256SUMS.txt");
    if (!installer || !checksums) throw new Error(`The macOS ${arch} installer or checksum is missing from this release`);

    const checksumResponse = await fetch(checksums.browser_download_url, { headers: requestHeaders(), redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (!checksumResponse.ok) throw new Error(`Unable to download update checksum (${checksumResponse.status})`);
    const checksumText = await checksumResponse.text();
    const expectedHash = checksumText.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find((parts) => parts.at(-1)?.replace(/^\*/, "") === installer.name)?.[0]?.toLowerCase();
    if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("The update checksum is invalid or missing");

    await mkdir(this.downloadsPath, { recursive: true });
    const targetPath = path.join(this.downloadsPath, path.basename(installer.name));
    const temporaryPath = `${targetPath}.download`;
    const response = await fetch(installer.browser_download_url, { headers: requestHeaders(), redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`Unable to download the macOS update (${response.status})`);

    const total = Number(response.headers.get("content-length")) || installer.size;
    let received = 0;
    const hash = createHash("sha256");
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        hash.update(chunk);
        if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)));
        callback(null, chunk);
      },
    });

    try {
      await rm(temporaryPath, { force: true });
      await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(temporaryPath));
      if (hash.digest("hex") !== expectedHash) throw new Error("The downloaded update failed checksum verification");
      await rm(targetPath, { force: true });
      await rename(temporaryPath, targetPath);
      onProgress(100);
      return targetPath;
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async load(refresh: boolean): Promise<GithubRelease[]> {
    if (!this.cache) this.cache = await this.readCache();
    if (!refresh && this.cache && Date.now() - this.cache.fetchedAt < CACHE_MAX_AGE_MS) return this.cache.releases;

    try {
      const response = await fetch(`${RELEASES_API}?per_page=20`, { headers: requestHeaders(this.cache?.etag), signal: AbortSignal.timeout(15_000) });
      if (response.status === 304 && this.cache) {
        this.cache = { ...this.cache, fetchedAt: Date.now() };
        await this.writeCache(this.cache);
        return this.cache.releases;
      }
      if (!response.ok) throw new Error(`GitHub Releases request failed (${response.status})`);
      const value = await response.json();
      if (!Array.isArray(value)) throw new Error("GitHub returned an invalid releases response");
      const releases = (value as GithubRelease[]).filter((release) => !release.draft && !release.prerelease && typeof release.tag_name === "string");
      this.cache = { etag: response.headers.get("etag") ?? undefined, fetchedAt: Date.now(), releases };
      await this.writeCache(this.cache);
      return releases;
    } catch (error) {
      if (this.cache) return this.cache.releases;
      throw error;
    }
  }

  private async readCache(): Promise<ReleaseCache | null> {
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, "utf8")) as ReleaseCache;
      return Array.isArray(parsed.releases) && typeof parsed.fetchedAt === "number" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeCache(cache: ReleaseCache): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cache), "utf8");
  }
}
