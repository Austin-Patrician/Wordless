import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  SkillMarketplaceEntry,
  SkillMarketplaceFile,
  SkillMarketplaceOrigin,
  SkillMarketplacePage,
  SkillMarketplacePreview,
} from "@wordless/domain";

const DEFAULT_ENDPOINT = "https://skillsmp.com/api/v1/skills/search";
const CACHE_TTL_MS = 10 * 60 * 1000;
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

type SkillsMpApiSkill = {
  id?: unknown;
  name?: unknown;
  author?: unknown;
  description?: unknown;
  contentLanguage?: unknown;
  githubUrl?: unknown;
  skillUrl?: unknown;
  stars?: unknown;
  updatedAt?: unknown;
};

type SkillsMpApiResponse = {
  success?: unknown;
  data?: {
    skills?: SkillsMpApiSkill[];
    pagination?: {
      page?: unknown;
      total?: unknown;
      totalPages?: unknown;
      hasNext?: unknown;
    };
  };
  error?: { code?: unknown; message?: unknown };
};

type CacheRecord = { fetchedAt: number; response: SkillsMpApiResponse };
type CacheStore = { entries: Record<string, CacheRecord> };

type GitHubTarget = {
  owner: string;
  repo: string;
  branch: string;
  directory: string;
};

type GitHubContent = {
  type?: unknown;
  path?: unknown;
  size?: unknown;
  download_url?: unknown;
  url?: unknown;
};

type StagedPreview = {
  directory: string;
  preview: SkillMarketplacePreview;
  timer: ReturnType<typeof setTimeout>;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function integerValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function normalizeEntry(value: SkillsMpApiSkill): SkillMarketplaceEntry | null {
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const author = stringValue(value.author);
  const description = stringValue(value.description);
  const githubUrl = stringValue(value.githubUrl);
  const skillUrl = stringValue(value.skillUrl);
  if (!id || !name || !author || !description || !githubUrl || !skillUrl) return null;
  try {
    if (new URL(githubUrl).hostname !== "github.com" || new URL(skillUrl).hostname !== "skillsmp.com") return null;
  } catch {
    return null;
  }
  return {
    id,
    name,
    author,
    description,
    contentLanguage: stringValue(value.contentLanguage) || null,
    githubUrl,
    skillUrl,
    stars: integerValue(value.stars),
    updatedAt: integerValue(value.updatedAt),
    source: "skillsmp",
  };
}

function parseGitHubTarget(githubUrl: string): GitHubTarget {
  const url = new URL(githubUrl);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash)
    throw new Error("SkillsMP returned an unsupported GitHub source URL");
  const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments.length < 5 || segments[2] !== "tree") throw new Error("The skill source must point to a GitHub directory");
  const [owner, repo, , branch, ...directorySegments] = segments;
  if (!owner || !repo || !branch || directorySegments.length === 0) throw new Error("The GitHub skill directory is incomplete");
  for (const segment of [owner, repo, branch, ...directorySegments]) {
    if (!segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("/") || segment.includes("\0"))
      throw new Error("The GitHub skill directory is invalid");
  }
  return { owner, repo: repo.replace(/\.git$/i, ""), branch, directory: directorySegments.join("/") };
}

function isRelativeFilePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export class SkillsMpMarketplaceService {
  private readonly cachePath: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly previews = new Map<string, StagedPreview>();

  constructor(
    userDataPath: string,
    options: { endpoint?: string; apiKey?: string; fetch?: typeof fetch } = {},
  ) {
    this.cachePath = path.join(userDataPath, "marketplace", "skillsmp.json");
    this.endpoint = options.endpoint?.trim() || process.env.WORDLESS_SKILLSMP_API_URL?.trim() || DEFAULT_ENDPOINT;
    this.apiKey = options.apiKey?.trim() ?? "";
    this.fetchImpl = options.fetch ?? fetch;
  }

  async search(query: string, page = 1, sortBy: "stars" | "recent" = "stars", refresh = false): Promise<SkillMarketplacePage> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length > 200 || !/[\p{L}\p{N}]/u.test(normalizedQuery)) throw new Error("Enter a skill keyword to search SkillsMP");
    const normalizedPage = Math.max(1, Math.floor(page));
    const cacheKey = JSON.stringify([normalizedQuery.toLocaleLowerCase(), normalizedPage, sortBy]);
    const cache = await this.readCache();
    const cached = cache.entries[cacheKey];
    if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS)
      return this.page(cached.response, false, cached.fetchedAt);

    const url = new URL(this.endpoint);
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("page", String(normalizedPage));
    url.searchParams.set("limit", "18");
    url.searchParams.set("sortBy", sortBy);
    try {
      const headers: Record<string, string> = {
        accept: "application/json",
        "user-agent": "WordlessDesktop/1.0 (+https://github.com/Austin-Patrician/Wordless)",
      };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(12_000) });
      const payload = await this.responseJson<SkillsMpApiResponse>(response, "SkillsMP search");
      if (!response.ok || payload.success !== true) {
        const message = stringValue(payload.error?.message);
        throw new Error(message || `SkillsMP search failed (${response.status})`);
      }
      const record = { fetchedAt: Date.now(), response: payload };
      cache.entries[cacheKey] = record;
      await this.writeCache(cache);
      return this.page(payload, false, record.fetchedAt);
    } catch (error) {
      if (cached) return this.page(cached.response, true, cached.fetchedAt);
      throw error;
    }
  }

  async preview(skillId: string): Promise<SkillMarketplacePreview> {
    const entry = await this.findCachedEntry(skillId);
    if (!entry) throw new Error("Search for this skill again before previewing it");
    const target = parseGitHubTarget(entry.githubUrl);
    const commitSha = await this.resolveCommit(target);
    const previewId = randomUUID();
    const directory = await mkdtemp(path.join(tmpdir(), "wordless-skill-preview-"));
    try {
      const files = await this.downloadDirectory(target, commitSha, directory);
      const skillFile = files.find((file) => file.path === "SKILL.md");
      if (!skillFile) throw new Error("The selected GitHub directory does not contain SKILL.md");
      const skillMarkdown = await readFile(path.join(directory, "SKILL.md"), "utf8");
      const expiresAt = Date.now() + PREVIEW_TTL_MS;
      const preview = { previewId, entry, files, skillMarkdown, commitSha, expiresAt };
      const timer = setTimeout(() => void this.deletePreview(previewId), PREVIEW_TTL_MS);
      timer.unref?.();
      this.previews.set(previewId, { directory, preview, timer });
      return preview;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async install(previewId: string, importer: (directory: string) => Promise<void>): Promise<SkillMarketplaceOrigin> {
    const staged = this.previews.get(previewId);
    if (!staged || staged.preview.expiresAt <= Date.now()) {
      await this.deletePreview(previewId);
      throw new Error("This skill preview expired. Preview it again before installing");
    }
    const origin: SkillMarketplaceOrigin = {
      source: "skillsmp",
      id: staged.preview.entry.id,
      githubUrl: staged.preview.entry.githubUrl,
      commitSha: staged.preview.commitSha,
      installedAt: Date.now(),
    };
    await writeFile(path.join(staged.directory, ".wordless-marketplace.json"), `${JSON.stringify({ version: 1, ...origin }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      await importer(staged.directory);
      return origin;
    } finally {
      await this.deletePreview(previewId);
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.previews.keys()].map(async (id) => await this.deletePreview(id)));
  }

  private page(response: SkillsMpApiResponse, stale: boolean, fetchedAt: number): SkillMarketplacePage {
    const pagination = response.data?.pagination;
    const page = Math.max(1, integerValue(pagination?.page, 1));
    const totalPages = Math.max(page, integerValue(pagination?.totalPages, page));
    return {
      entries: (response.data?.skills ?? []).flatMap((value) => {
        const entry = normalizeEntry(value);
        return entry ? [entry] : [];
      }),
      page,
      totalPages,
      hasNext: pagination?.hasNext === true,
      total: integerValue(pagination?.total),
      stale,
      fetchedAt,
    };
  }

  private async findCachedEntry(skillId: string): Promise<SkillMarketplaceEntry | null> {
    const cache = await this.readCache();
    for (const record of Object.values(cache.entries)) {
      for (const value of record.response.data?.skills ?? []) {
        const entry = normalizeEntry(value);
        if (entry?.id === skillId) return entry;
      }
    }
    return null;
  }

  private async resolveCommit(target: GitHubTarget): Promise<string> {
    const url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/commits/${encodeURIComponent(target.branch)}`;
    const response = await this.githubFetch(url);
    const payload = await this.responseJson<{ sha?: unknown }>(response, "GitHub commit lookup");
    const sha = stringValue(payload.sha);
    if (!response.ok || !/^[a-f0-9]{40}$/i.test(sha)) throw new Error(`Unable to resolve the GitHub skill revision (${response.status})`);
    return sha;
  }

  private async downloadDirectory(target: GitHubTarget, commitSha: string, localRoot: string): Promise<SkillMarketplaceFile[]> {
    const queue = [target.directory];
    const files: SkillMarketplaceFile[] = [];
    const downloads: Array<{ contentApiUrl: string; downloadUrl: string; localPath: string; relativePath: string; size: number }> = [];
    let totalBytes = 0;
    let visitedDirectories = 0;
    while (queue.length > 0) {
      visitedDirectories += 1;
      if (visitedDirectories > MAX_FILES) throw new Error("This skill contains too many nested directories");
      const remoteDirectory = queue.shift()!;
      const url = new URL(`https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${remoteDirectory.split("/").map(encodeURIComponent).join("/")}`);
      url.searchParams.set("ref", commitSha);
      const response = await this.githubFetch(url);
      const payload = await this.responseJson<GitHubContent[] | GitHubContent>(response, "GitHub directory lookup");
      if (!response.ok || !Array.isArray(payload)) throw new Error(`Unable to read the GitHub skill directory (${response.status})`);
      for (const item of payload) {
        const type = stringValue(item.type);
        const remotePath = stringValue(item.path);
        if (!remotePath.startsWith(`${target.directory}/`)) throw new Error("GitHub returned a file outside the selected skill directory");
        const relativePath = remotePath.slice(target.directory.length + 1);
        if (!isRelativeFilePath(relativePath)) throw new Error("GitHub returned an invalid skill file path");
        if (type === "dir") {
          queue.push(remotePath);
          continue;
        }
        if (type !== "file") throw new Error("Skill packages containing links or submodules are not supported");
        if (relativePath === ".wordless-marketplace.json") throw new Error("The skill contains reserved Wordless marketplace metadata");
        const size = integerValue(item.size, -1);
        if (size < 0 || size > MAX_FILE_BYTES) throw new Error(`Skill file is too large: ${relativePath}`);
        if (files.length >= MAX_FILES) throw new Error("This skill contains more than 100 files");
        totalBytes += size;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error("This skill is larger than 5 MB");
        const downloadUrl = stringValue(item.download_url);
        this.validateDownloadUrl(downloadUrl, target, commitSha, remotePath);
        const contentApiUrl = stringValue(item.url);
        this.validateContentApiUrl(contentApiUrl, target, commitSha, remotePath);
        const localPath = path.join(localRoot, ...relativePath.split("/"));
        downloads.push({ contentApiUrl, downloadUrl, localPath, relativePath, size });
        files.push({ path: relativePath, size });
      }
    }
    for (let index = 0; index < downloads.length; index += 5) {
      await Promise.all(downloads.slice(index, index + 5).map(async (download) => {
        const bytes = await this.downloadFile(download.downloadUrl, download.contentApiUrl, download.relativePath);
        if (bytes.byteLength !== download.size || bytes.byteLength > MAX_FILE_BYTES)
          throw new Error(`GitHub returned an unexpected size for ${download.relativePath}`);
        await mkdir(path.dirname(download.localPath), { recursive: true });
        await writeFile(download.localPath, bytes, { flag: "wx" });
      }));
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async githubFetch(input: string | URL): Promise<Response> {
    return await this.fetchImpl(input, {
      headers: { accept: "application/vnd.github+json", "user-agent": "WordlessDesktop/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
  }

  private validateDownloadUrl(downloadUrl: string, target: GitHubTarget, commitSha: string, remotePath: string): void {
    const url = new URL(downloadUrl);
    const expectedPath = `/${target.owner}/${target.repo}/${commitSha}/${remotePath}`;
    if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com" || decodeURIComponent(url.pathname) !== expectedPath || url.search || url.hash)
      throw new Error("GitHub returned an untrusted skill download URL");
  }

  private validateContentApiUrl(contentApiUrl: string, target: GitHubTarget, commitSha: string, remotePath: string): void {
    const url = new URL(contentApiUrl);
    const expectedPath = `/repos/${target.owner}/${target.repo}/contents/${remotePath}`;
    if (url.protocol !== "https:" || url.hostname !== "api.github.com" || decodeURIComponent(url.pathname) !== expectedPath || url.searchParams.get("ref") !== commitSha || [...url.searchParams.keys()].some((key) => key !== "ref") || url.hash)
      throw new Error("GitHub returned an untrusted content API URL");
  }

  private async downloadFile(downloadUrl: string, contentApiUrl: string, relativePath: string): Promise<Uint8Array> {
    try {
      const response = await this.fetchImpl(downloadUrl, { headers: { "user-agent": "WordlessDesktop/1.0" }, signal: AbortSignal.timeout(12_000) });
      if (response.ok) return await this.responseBytes(response, MAX_FILE_BYTES, `GitHub file ${relativePath}`);
    } catch {
      // The raw host is inaccessible on some networks; the authenticated API representation is the bounded fallback.
    }
    const response = await this.githubFetch(contentApiUrl);
    const payload = await this.responseJson<{ encoding?: unknown; content?: unknown }>(response, `GitHub file ${relativePath}`);
    const encoding = stringValue(payload.encoding);
    const content = stringValue(payload.content).replace(/\s+/g, "");
    if (!response.ok || encoding !== "base64" || !content || !/^[A-Za-z0-9+/]*={0,2}$/.test(content))
      throw new Error(`Unable to download ${relativePath} (${response.status})`);
    return new Uint8Array(Buffer.from(content, "base64"));
  }

  private async responseJson<T>(response: Response, operation: string): Promise<T> {
    const bytes = await this.responseBytes(response, 1024 * 1024, operation);
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
    } catch {
      throw new Error(`${operation} returned invalid JSON`);
    }
  }

  private async responseBytes(response: Response, limit: number, operation: string): Promise<Uint8Array> {
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > limit) throw new Error(`${operation} response is too large`);
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) throw new Error(`${operation} response is too large`);
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private async deletePreview(previewId: string): Promise<void> {
    const staged = this.previews.get(previewId);
    if (!staged) return;
    this.previews.delete(previewId);
    clearTimeout(staged.timer);
    await rm(staged.directory, { recursive: true, force: true });
  }

  private async readCache(): Promise<CacheStore> {
    try {
      const value = JSON.parse(await readFile(this.cachePath, "utf8")) as CacheStore;
      return value && typeof value === "object" && value.entries && typeof value.entries === "object" ? value : { entries: {} };
    } catch {
      return { entries: {} };
    }
  }

  private async writeCache(cache: CacheStore): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(cache), "utf8");
  }
}
