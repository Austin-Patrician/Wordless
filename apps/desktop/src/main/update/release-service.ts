import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { DesktopRelease } from "@wordless/protocol";

const RELEASES_API = "https://api.github.com/repos/Austin-Patrician/Wordless/releases";
const RELEASES_MANIFEST_URL = "https://download.wordless.20250230.xyz/releases/releases.json";
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

type ReleaseAsset = {
  name: string;
  size: number;
  urls: string[];
  sha256?: string;
};

export type DesktopMacDmgAsset = {
  name: string;
  url: string;
  size: number;
};

type ReleaseRecord = {
  version: string;
  name: string | null;
  notes: string;
  publishedAt: string;
  htmlUrl: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
};

type ReleaseCache = {
  etag?: string;
  source: "manifest" | "github";
  fetchedAt: number;
  releases: ReleaseRecord[];
};

function requestHeaders(etag?: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Wordless-Desktop",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(etag ? { "If-None-Match": etag } : {}),
  };
}

function publicRelease(release: ReleaseRecord): DesktopRelease {
  return {
    version: release.version,
    title: release.name?.trim() || `Wordless ${release.version}`,
    notes: release.notes,
    publishedAt: release.publishedAt,
    htmlUrl: release.htmlUrl,
    prerelease: release.prerelease,
  };
}

function validHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function parseManifest(value: unknown): ReleaseRecord[] {
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== 1) throw new Error("The Wordless release manifest has an unsupported format");
  const candidates = (value as { releases?: unknown }).releases;
  if (!Array.isArray(candidates)) throw new Error("The Wordless release manifest does not contain releases");
  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const release = candidate as Record<string, unknown>;
    if (typeof release.version !== "string" || !validHttpUrl(release.htmlUrl) || !Array.isArray(release.assets)) return [];
    const assets = release.assets.flatMap((candidateAsset) => {
      if (!candidateAsset || typeof candidateAsset !== "object") return [];
      const asset = candidateAsset as Record<string, unknown>;
      const urls = Array.isArray(asset.urls) ? asset.urls.filter(validHttpUrl) : [];
      if (typeof asset.name !== "string" || urls.length === 0) return [];
      return [{ name: asset.name, size: typeof asset.size === "number" ? asset.size : 0, urls, sha256: typeof asset.sha256 === "string" && /^[a-f0-9]{64}$/i.test(asset.sha256) ? asset.sha256.toLowerCase() : undefined }];
    });
    return [{
      version: release.version.replace(/^v/i, ""),
      name: typeof release.title === "string" ? release.title : null,
      notes: typeof release.notes === "string" ? release.notes : "",
      publishedAt: typeof release.publishedAt === "string" ? release.publishedAt : "",
      htmlUrl: release.htmlUrl,
      prerelease: release.prerelease === true,
      assets,
    }];
  }).filter((release) => !release.prerelease);
}

function parseGithubReleases(value: unknown): ReleaseRecord[] {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid releases response");
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const release = candidate as Record<string, unknown>;
    if (release.draft === true || release.prerelease === true || typeof release.tag_name !== "string" || !validHttpUrl(release.html_url)) return [];
    const assets = Array.isArray(release.assets) ? release.assets.flatMap((candidateAsset) => {
      if (!candidateAsset || typeof candidateAsset !== "object") return [];
      const asset = candidateAsset as Record<string, unknown>;
      if (typeof asset.name !== "string" || !validHttpUrl(asset.browser_download_url)) return [];
      return [{ name: asset.name, size: typeof asset.size === "number" ? asset.size : 0, urls: [asset.browser_download_url] }];
    }) : [];
    return [{
      version: release.tag_name.replace(/^v/i, ""),
      name: typeof release.name === "string" ? release.name : null,
      notes: typeof release.body === "string" ? release.body : "",
      publishedAt: typeof release.published_at === "string" ? release.published_at : "",
      htmlUrl: release.html_url,
      prerelease: false,
      assets,
    }];
  });
}

export class DesktopReleaseService {
  private cache: ReleaseCache | null = null;
  private readonly cachePath: string;
  private readonly manifestUrl: string;
  constructor(userDataPath: string, manifestUrl = process.env.WORDLESS_RELEASES_MANIFEST_URL?.trim() || RELEASES_MANIFEST_URL) {
    this.cachePath = path.join(userDataPath, "updates", "releases.json");
    this.manifestUrl = manifestUrl;
  }

  async list(refresh = false): Promise<DesktopRelease[]> {
    const releases = await this.load(refresh);
    return releases.map(publicRelease);
  }

  async findMacDmgAsset(version: string, arch: string): Promise<DesktopMacDmgAsset> {
    const release = await this.release(version);
    const asset = this.macDmgAsset(release, version, arch);
    return { name: asset.name, url: asset.urls[0], size: asset.size };
  }

  async downloadMacInstaller(version: string, arch: string, downloadsPath: string, onProgress: (percent: number) => void): Promise<string> {
    const release = await this.release(version);
    const installer = this.macDmgAsset(release, version, arch);
    const expectedHash = installer.sha256 ?? await this.downloadExpectedHash(release, installer.name);
    if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("The update checksum is invalid or missing");

    await mkdir(downloadsPath, { recursive: true });
    const targetPath = path.join(downloadsPath, path.basename(installer.name));
    const temporaryPath = `${targetPath}.download`;
    const failures: string[] = [];
    for (const url of installer.urls) try {
      await rm(temporaryPath, { force: true });
      const response = await fetch(url, { headers: requestHeaders(), redirect: "follow", signal: AbortSignal.timeout(30 * 60_000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
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
      await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(temporaryPath));
      if (hash.digest("hex") !== expectedHash) throw new Error("The downloaded update failed checksum verification");
      await rm(targetPath, { force: true });
      await rename(temporaryPath, targetPath);
      onProgress(100);
      return targetPath;
    } catch (error) {
      await rm(temporaryPath, { force: true });
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new Error(`Unable to download the macOS update from any release source (${failures.join("; ")})`);
  }

  private async load(refresh: boolean): Promise<ReleaseRecord[]> {
    if (!this.cache) this.cache = await this.readCache();
    if (!refresh && this.cache && Date.now() - this.cache.fetchedAt < CACHE_MAX_AGE_MS) return this.cache.releases;

    const sources = [
      { kind: "manifest" as const, url: this.manifestUrl, parse: parseManifest },
      { kind: "github" as const, url: `${RELEASES_API}?per_page=20`, parse: parseGithubReleases },
    ];
    for (const source of sources) try {
      const etag = this.cache?.source === source.kind ? this.cache.etag : undefined;
      const response = await fetch(source.url, { headers: requestHeaders(etag), signal: AbortSignal.timeout(15_000) });
      if (response.status === 304 && this.cache) {
        this.cache = { ...this.cache, fetchedAt: Date.now() };
        await this.writeCache(this.cache);
        return this.cache.releases;
      }
      if (!response.ok) throw new Error(`${source.kind} release request failed (${response.status})`);
      const releases = source.parse(await response.json());
      if (releases.length === 0) throw new Error(`${source.kind} did not return any stable releases`);
      this.cache = { source: source.kind, etag: response.headers.get("etag") ?? undefined, fetchedAt: Date.now(), releases };
      await this.writeCache(this.cache);
      return releases;
    } catch {}
    if (this.cache) return this.cache.releases;
    throw new Error("Unable to load Wordless releases from R2 or GitHub");
  }

  private async release(version: string): Promise<ReleaseRecord> {
    const normalized = version.replace(/^v/i, "");
    const releases = await this.load(false);
    const match = releases.find((candidate) => candidate.version === normalized);
    if (match) return match;
    const refreshed = await this.load(true);
    const refreshedMatch = refreshed.find((candidate) => candidate.version === normalized);
    if (!refreshedMatch) throw new Error(`Wordless ${normalized} is no longer available on GitHub`);
    return refreshedMatch;
  }

  private macDmgAsset(release: ReleaseRecord, version: string, arch: string): ReleaseAsset {
    const normalizedVersion = version.replace(/^v/i, "");
    const escapedVersion = normalizedVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const installerPattern = new RegExp(`^Wordless-${escapedVersion}-mac-${arch}\\.dmg$`, "i");
    const universalPattern = new RegExp(`^Wordless-${escapedVersion}-mac-universal\\.dmg$`, "i");
    const installer = release.assets.find((asset) => installerPattern.test(asset.name)) ?? release.assets.find((asset) => universalPattern.test(asset.name));
    if (!installer) throw new Error(`The macOS ${arch} installer is missing from release ${normalizedVersion}`);
    return installer;
  }

  private async downloadExpectedHash(release: ReleaseRecord, installerName: string): Promise<string | undefined> {
    const checksums = release.assets.find((asset) => asset.name === "SHA256SUMS.txt");
    if (!checksums) throw new Error("The release checksum file is missing");
    for (const url of checksums.urls) try {
      const response = await fetch(url, { headers: requestHeaders(), redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!response.ok) continue;
      const checksumText = await response.text();
      const expected = checksumText.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find((parts) => parts.at(-1)?.replace(/^\*/, "") === installerName)?.[0]?.toLowerCase();
      if (expected && /^[a-f0-9]{64}$/.test(expected)) return expected;
    } catch {}
    return undefined;
  }

  private async readCache(): Promise<ReleaseCache | null> {
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, "utf8")) as ReleaseCache;
      return Array.isArray(parsed.releases) && typeof parsed.fetchedAt === "number" && (parsed.source === "manifest" || parsed.source === "github") ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeCache(cache: ReleaseCache): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cache), "utf8");
  }
}
