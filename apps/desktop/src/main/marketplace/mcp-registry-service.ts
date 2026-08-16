import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ENDPOINT = "https://registry.modelcontextprotocol.io/v0.1/servers";
const CACHE_TTL_MS = 10 * 60 * 1000;

export type McpMarketplaceEntry = {
  id: string;
  name: string;
  title: string;
  description: string;
  version: string;
  publisher: string;
  repositoryUrl: string | null;
  websiteUrl: string | null;
  iconUrl: string | null;
  transport: "streamable-http" | "stdio" | "unsupported";
  url: string | null;
  packageName: string | null;
  setup: {
    registryType: string | null;
    packageVersion: string | null;
    runtimeHint: string | null;
    suggestedCommand: string | null;
    requiredInputs: Array<{ name: string; description: string; secret: boolean; kind: "header" | "environment" }>;
    documentationUrl: string | null;
    documentationLabel: "Publisher website" | "Source repository" | null;
  };
  auth: "Server-defined" | "API key / headers" | "None specified";
  capabilities: string[];
  installable: boolean;
  source: "official-mcp-registry";
  sourceUrl: string;
};

export type McpMarketplacePage = {
  entries: McpMarketplaceEntry[];
  nextCursor: string | null;
  stale: boolean;
  fetchedAt: number;
};

type RegistryServer = {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  repository?: { url?: string } | string;
  websiteUrl?: string;
  icons?: Array<{ src?: string; mimeType?: string; sizes?: string[] }>;
  remotes?: Array<{ type?: string; url?: string; headers?: Array<{ name?: string; description?: string; isSecret?: boolean }> }>;
  packages?: Array<{
    registryType?: string;
    identifier?: string;
    version?: string;
    runtimeHint?: string;
    environmentVariables?: Array<{ name?: string; description?: string; isSecret?: boolean }>;
  }>;
};

type RegistryResponse = {
  servers?: Array<{ server?: RegistryServer }>;
  metadata?: { nextCursor?: string; count?: number };
};

type CacheRecord = { fetchedAt: number; etag?: string; data: RegistryResponse };
type CacheStore = { entries: Record<string, CacheRecord> };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(server: RegistryServer): McpMarketplaceEntry | null {
  const name = stringValue(server.name);
  if (!name) return null;
  const remote = (server.remotes ?? []).find((item) => item.type === "streamable-http" && stringValue(item.url));
  const stdio = (server.remotes ?? []).find((item) => item.type === "stdio");
  const packageEntry = server.packages?.find((item) => stringValue(item.identifier));
  const transport = remote ? "streamable-http" : stdio ? "stdio" : packageEntry ? "unsupported" : "unsupported";
  const url = remote ? stringValue(remote.url) : null;
  const requiresHeaders = Boolean(remote?.headers?.length);
  const auth = remote?.headers?.some((header) => /authorization|api[-_]?key/i.test(stringValue(header.name)))
    ? "API key / headers"
    : remote
      ? "Server-defined"
      : "None specified";
  const repositoryUrl = typeof server.repository === "string" ? server.repository : stringValue(server.repository?.url) || null;
  const websiteUrl = stringValue(server.websiteUrl) || null;
  const packageName = stringValue(packageEntry?.identifier) || null;
  const registryType = stringValue(packageEntry?.registryType) || null;
  const runtimeHint = stringValue(packageEntry?.runtimeHint) || ({ npm: "npx", pypi: "uvx", oci: "docker", nuget: "dnx" } as Record<string, string>)[registryType ?? ""] || null;
  const suggestedCommand = runtimeHint && packageName
    ? runtimeHint === "npx"
      ? `npx -y ${packageName}`
      : runtimeHint === "docker"
        ? `docker run -i --rm ${packageName}`
        : `${runtimeHint} ${packageName}`
    : null;
  const requiredInputs = [
    ...(remote?.headers ?? []).flatMap((input) => stringValue(input.name) ? [{ name: stringValue(input.name), description: stringValue(input.description), secret: input.isSecret === true, kind: "header" as const }] : []),
    ...(packageEntry?.environmentVariables ?? []).flatMap((input) => stringValue(input.name) ? [{ name: stringValue(input.name), description: stringValue(input.description), secret: input.isSecret === true, kind: "environment" as const }] : []),
  ];
  const iconUrl = (server.icons ?? []).flatMap((icon) => {
    const src = stringValue(icon.src);
    const mimeType = stringValue(icon.mimeType).toLowerCase();
    if (!/^https:\/\//i.test(src)) return [];
    if (mimeType && !["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"].includes(mimeType)) return [];
    if (!mimeType && !/\.(?:png|jpe?g|webp|svg)(?:[?#]|$)/i.test(src)) return [];
    return [src];
  })[0] ?? null;
  return {
    id: name,
    name,
    title: stringValue(server.title) || name.split("/").at(-1) || name,
    description: stringValue(server.description) || "No description available.",
    version: stringValue(server.version) || "latest",
    publisher: name.includes("/") ? name.split("/")[0] : "Community publisher",
    repositoryUrl,
    websiteUrl,
    iconUrl,
    transport,
    url,
    packageName,
    setup: {
      registryType,
      packageVersion: stringValue(packageEntry?.version) || null,
      runtimeHint,
      suggestedCommand,
      requiredInputs,
      documentationUrl: websiteUrl ?? repositoryUrl,
      documentationLabel: websiteUrl ? "Publisher website" : repositoryUrl ? "Source repository" : null,
    },
    auth,
    capabilities: [transport === "streamable-http" ? "Remote network" : "Local runtime", auth],
    installable: transport === "streamable-http" && Boolean(url) && /^https:\/\//i.test(url ?? "") && !requiresHeaders,
    source: "official-mcp-registry",
    sourceUrl: `${DEFAULT_ENDPOINT}/${encodeURIComponent(name)}`,
  };
}

export class McpRegistryService {
  private readonly cachePath: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(userDataPath: string, endpoint = process.env.WORDLESS_MCP_REGISTRY_URL?.trim() || DEFAULT_ENDPOINT, fetchImpl: typeof fetch = fetch) {
    this.cachePath = path.join(userDataPath, "marketplace", "mcp-registry.json");
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
  }

  async search(query = "", cursor?: string, refresh = false): Promise<McpMarketplacePage> {
    const cacheKey = JSON.stringify([query.trim().toLowerCase(), cursor ?? ""]);
    const cache = await this.readCache();
    const cached = cache.entries[cacheKey];
    if (!refresh && !cursor && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS)
      return this.page(cached.data, false, cached.fetchedAt);
    const url = new URL(this.endpoint);
    url.searchParams.set("limit", "50");
    url.searchParams.set("version", "latest");
    if (cursor) url.searchParams.set("cursor", cursor);
    if (query.trim()) url.searchParams.set("search", query.trim());
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (cached?.etag && !cursor) headers["if-none-match"] = cached.etag;
      const response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(12_000) });
      if (response.status === 304 && cached) return this.page(cached.data, false, cached.fetchedAt);
      if (!response.ok) throw new Error(`MCP Registry request failed (${response.status})`);
      const data = (await response.json()) as RegistryResponse;
      const record = { fetchedAt: Date.now(), etag: response.headers.get("etag") ?? undefined, data };
      cache.entries[cacheKey] = record;
      await this.writeCache(cache);
      return this.page(data, false, Date.now());
    } catch (error) {
      if (cached) return this.page(cached.data, true, cached.fetchedAt);
      throw error;
    }
  }

  async getDetail(name: string): Promise<McpMarketplaceEntry> {
    const response = await this.fetchImpl(`${this.endpoint}/${encodeURIComponent(name)}/versions/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`MCP Registry detail request failed (${response.status})`);
    const payload = (await response.json()) as { server?: RegistryServer };
    const entry = normalize(payload.server ?? {});
    if (!entry) throw new Error("MCP server was not found in the official registry");
    return entry;
  }

  private page(data: RegistryResponse, stale: boolean, fetchedAt: number): McpMarketplacePage {
    const entries = (data.servers ?? []).flatMap((item) => {
      const entry = normalize(item.server ?? {});
      return entry ? [entry] : [];
    });
    return { entries, nextCursor: stringValue(data.metadata?.nextCursor) || null, stale, fetchedAt };
  }

  private async readCache(): Promise<CacheStore> {
    try {
      const value = JSON.parse(await readFile(this.cachePath, "utf8")) as CacheStore;
      return value && typeof value === "object" && value.entries ? value : { entries: {} };
    } catch {
      return { entries: {} };
    }
  }

  private async writeCache(record: CacheStore): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(record), "utf8");
  }
}
