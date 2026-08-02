import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
  constructor(userDataPath: string) {
    this.cachePath = path.join(userDataPath, "updates", "releases.json");
  }

  async list(refresh = false): Promise<DesktopRelease[]> {
    const releases = await this.load(refresh);
    return releases.map(publicRelease);
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
