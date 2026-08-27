import { createHash, randomUUID } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import extract from "extract-zip";
import { estimateTextTokens } from "@wordless/agent";
import { parse } from "yaml";
import type { SkillCatalogSnapshot, SkillDiagnostic, SkillMarketplaceOrigin, SkillSource, SkillSummary, WorkspaceRecord } from "@wordless/domain";

export interface ResolvedSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  filePath: string;
  disableModelInvocation: boolean;
  source: SkillSource;
  workspaceId: string | null;
  baseDir: string;
}

export interface SkillRegistryPaths {
  configPath: string;
  managedRoot: string;
}

export interface SkillRegistryOptions {
  paths: SkillRegistryPaths;
  homeDir: string;
  builtInRoots?: string[];
}

type SkillConfig = {
  disabledSkillIds: string[];
};

type Candidate = {
  resolved: ResolvedSkill;
  summary: SkillSummary;
};

const DEFAULT_CONFIG: SkillConfig = { disabledSkillIds: [] };
const SOURCE_ORDER: Array<{ source: SkillSource; relativePath: string }> = [
  { source: "workspace-pi", relativePath: join(".pi", "skills") },
  { source: "workspace-claude", relativePath: join(".claude", "skills") },
  { source: "workspace-codex", relativePath: join(".codex", "skills") },
];

function stableId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 24);
}

function isInside(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !value.startsWith("../") && !value.startsWith("..\\"));
}

function validFrontmatter(value: unknown): value is { name: string; description: string; "disable-model-invocation"?: boolean } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && record.name.trim().length > 0 && typeof record.description === "string" && record.description.trim().length > 0;
}

function parseSkillFile(content: string): { name: string; description: string; body: string; disableModelInvocation: boolean } | { error: string } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return { error: "YAML frontmatter with name and description is required" };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { error: "YAML frontmatter is not closed" };
  try {
    const frontmatter = parse(normalized.slice(4, end)) as unknown;
    if (!validFrontmatter(frontmatter)) return { error: "YAML frontmatter must include non-empty name and description" };
    return {
      name: frontmatter.name.trim(),
      description: frontmatter.description.trim(),
      body: normalized.slice(end + 4).trim(),
      disableModelInvocation: frontmatter["disable-model-invocation"] === true,
    };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Unable to parse YAML frontmatter" };
  }
}

function marketplaceOrigin(value: unknown): SkillMarketplaceOrigin | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && record.source === "skillsmp"
    && typeof record.id === "string"
    && typeof record.githubUrl === "string"
    && typeof record.commitSha === "string"
    && typeof record.installedAt === "number"
    ? { source: "skillsmp", id: record.id, githubUrl: record.githubUrl, commitSha: record.commitSha, installedAt: record.installedAt }
    : undefined;
}

export class SkillRegistry {
  private readonly paths: SkillRegistryPaths;
  private readonly homeDir: string;
  private readonly builtInRoots: string[];
  private config: SkillConfig = DEFAULT_CONFIG;
  private snapshotValue: SkillCatalogSnapshot = { skills: [], diagnostics: [], updatedAt: 0 };
  private readonly resolvedGlobal = new Map<string, ResolvedSkill>();
  private readonly requiredBuiltIn = new Map<string, ResolvedSkill>();
  private readonly resolvedWorkspace = new Map<string, Map<string, ResolvedSkill>>();
  private readonly listeners = new Set<() => void>();
  private readonly watchers = new Map<string, FSWatcher>();
  private workspaces: WorkspaceRecord[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SkillRegistryOptions) {
    this.paths = options.paths;
    this.homeDir = options.homeDir;
    this.builtInRoots = options.builtInRoots ?? [];
  }

  async initialize(workspaces: WorkspaceRecord[]): Promise<void> {
    await mkdir(this.paths.managedRoot, { recursive: true });
    this.config = await this.readConfig();
    await this.refresh(workspaces);
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): SkillCatalogSnapshot {
    return this.snapshotValue;
  }

  getSessionSkills(workspaceId: string | null): ResolvedSkill[] {
    const byName = new Map<string, ResolvedSkill>();
    for (const skill of this.resolvedGlobal.values()) byName.set(skill.name, skill);
    if (workspaceId) {
      for (const skill of this.resolvedWorkspace.get(workspaceId)?.values() ?? []) byName.set(skill.name, skill);
    }
    return [...byName.values()];
  }

  getRequiredBuiltInSkill(name: string): ResolvedSkill | undefined {
    return this.requiredBuiltIn.get(name);
  }

  async refresh(workspaces = this.workspaces): Promise<SkillCatalogSnapshot> {
    this.workspaces = workspaces.filter((workspace) => workspace.availability === "available");
    const diagnostics: SkillDiagnostic[] = [];
    const globalCandidates = await this.scanSources(this.globalSources(), null, diagnostics);
    this.requiredBuiltIn.clear();
    for (const candidate of globalCandidates) {
      if (candidate.resolved.source === "built-in" && !this.requiredBuiltIn.has(candidate.resolved.name)) this.requiredBuiltIn.set(candidate.resolved.name, candidate.resolved);
    }
    const global = this.resolveCandidates(globalCandidates);
    this.resolvedGlobal.clear();
    for (const candidate of global.active) this.resolvedGlobal.set(candidate.resolved.id, candidate.resolved);

    const summaries = [...global.summaries];
    this.resolvedWorkspace.clear();
    for (const workspace of this.workspaces) {
      const candidates = await this.scanSources(this.workspaceSources(workspace), workspace.id, diagnostics);
      const resolved = this.resolveCandidates(candidates);
      const byId = new Map<string, ResolvedSkill>();
      for (const candidate of resolved.active) byId.set(candidate.resolved.id, candidate.resolved);
      this.resolvedWorkspace.set(workspace.id, byId);
      summaries.push(...resolved.summaries);
    }

    this.snapshotValue = { skills: summaries, diagnostics, updatedAt: Date.now() };
    this.configureWatchers();
    for (const listener of this.listeners) listener();
    return this.snapshotValue;
  }

  async setEnabled(skillId: string, enabled: boolean): Promise<SkillCatalogSnapshot> {
    const disabled = new Set(this.config.disabledSkillIds);
    if (enabled) disabled.delete(skillId);
    else disabled.add(skillId);
    this.config = { disabledSkillIds: [...disabled].sort() };
    await this.writeConfig();
    return await this.refresh();
  }

  async importFrom(sourcePath: string): Promise<SkillCatalogSnapshot> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "wordless-skill-"));
    try {
      const details = await stat(sourcePath);
      let importRoot = sourcePath;
      if (details.isFile()) {
        if (!sourcePath.toLowerCase().endsWith(".zip")) throw new Error("Choose a skill folder or a .zip archive");
        await extract(sourcePath, { dir: temporaryRoot });
        importRoot = temporaryRoot;
      } else if (!details.isDirectory()) {
        throw new Error("The selected skill source is not a directory or zip archive");
      }
      const packages = await this.findSkillPackages(importRoot);
      if (packages.length !== 1) throw new Error(packages.length === 0 ? "The selected source does not contain SKILL.md" : "Import one skill package at a time");
      const skillPath = packages[0]!;
      const content = await readFile(skillPath, "utf8");
      const parsed = parseSkillFile(content);
      if ("error" in parsed) throw new Error(parsed.error);
      const target = join(this.paths.managedRoot, `${parsed.name}-${randomUUID()}`);
      await cp(dirname(skillPath), target, { recursive: true, dereference: false, errorOnExist: true });
      await this.refresh();
      return this.snapshotValue;
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async removeManagedSkill(skillId: string): Promise<SkillCatalogSnapshot> {
    const candidate = this.snapshotValue.skills.find((skill) => skill.id === skillId);
    if (!candidate || candidate.source !== "wordless") throw new Error("Only imported Wordless skills can be removed");
    const root = resolve(dirname(candidate.filePath));
    if (!isInside(resolve(this.paths.managedRoot), root)) throw new Error("Invalid managed skill location");
    await rm(root, { recursive: true, force: true });
    return await this.refresh();
  }

  private globalSources(): Array<{ source: SkillSource; root: string }> {
    return [
      { source: "wordless", root: this.paths.managedRoot },
      ...this.builtInRoots.map((root) => ({ source: "built-in" as const, root })),
      { source: "pi", root: join(this.homeDir, ".pi", "agent", "skills") },
      { source: "agents", root: join(this.homeDir, ".agents", "skills") },
      { source: "claude", root: join(this.homeDir, ".claude", "skills") },
      { source: "codex", root: join(this.homeDir, ".codex", "skills") },
    ];
  }

  private workspaceSources(workspace: WorkspaceRecord): Array<{ source: SkillSource; root: string }> {
    return SOURCE_ORDER.map((entry) => ({ source: entry.source, root: join(workspace.canonicalRootPath, entry.relativePath) }));
  }

  private async scanSources(
    sources: Array<{ source: SkillSource; root: string }>,
    workspaceId: string | null,
    diagnostics: SkillDiagnostic[],
  ): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    const canonicalPaths = new Set<string>();
    for (const source of sources) {
      const packagePaths = await this.findSkillPackages(source.root, diagnostics, source.source);
      for (const path of packagePaths) {
        let canonicalPath: string;
        try {
          canonicalPath = await realpath(path);
        } catch {
          diagnostics.push({ type: "warning", source: source.source, path, message: "Skill file is unavailable" });
          continue;
        }
        if (canonicalPaths.has(canonicalPath)) continue;
        canonicalPaths.add(canonicalPath);
        let content: string;
        try {
          content = await readFile(canonicalPath, "utf8");
        } catch (cause) {
          diagnostics.push({ type: "warning", source: source.source, path: canonicalPath, message: cause instanceof Error ? cause.message : "Unable to read skill" });
          continue;
        }
        const parsed = parseSkillFile(content);
        const id = stableId(canonicalPath);
        const marketplace = source.source === "wordless" ? await this.readMarketplaceOrigin(dirname(canonicalPath)) : undefined;
        if ("error" in parsed) {
          candidates.push({
            resolved: { id, name: basename(dirname(canonicalPath)), description: "", content: "", filePath: canonicalPath, baseDir: dirname(canonicalPath), source: source.source, workspaceId, disableModelInvocation: false },
          summary: { id, name: basename(dirname(canonicalPath)), description: "", source: source.source, workspaceId, filePath: canonicalPath, enabled: false, state: "invalid", diagnostic: parsed.error, contentBytes: Buffer.byteLength(content), contentTokens: estimateTextTokens(content), ...(marketplace ? { marketplace } : {}) },
          });
          continue;
        }
        const resolved: ResolvedSkill = {
          id,
          name: parsed.name,
          description: parsed.description,
          content: parsed.body,
          filePath: canonicalPath,
          baseDir: dirname(canonicalPath),
          source: source.source,
          workspaceId,
          disableModelInvocation: parsed.disableModelInvocation,
        };
        candidates.push({
          resolved,
          summary: { id, name: parsed.name, description: parsed.description, source: source.source, workspaceId, filePath: canonicalPath, enabled: !this.config.disabledSkillIds.includes(id), state: "active", contentBytes: Buffer.byteLength(content), contentTokens: estimateTextTokens(content), ...(marketplace ? { marketplace } : {}) },
        });
      }
    }
    return candidates;
  }

  private resolveCandidates(candidates: Candidate[]): { active: Candidate[]; summaries: SkillSummary[] } {
    const winners = new Map<string, Candidate>();
    const summaries: SkillSummary[] = [];
    for (const candidate of candidates) {
      if (candidate.summary.state === "invalid") {
        summaries.push(candidate.summary);
        continue;
      }
      if (!candidate.summary.enabled) {
        summaries.push({ ...candidate.summary, state: "disabled" });
        continue;
      }
      const winner = winners.get(candidate.resolved.name);
      if (winner) {
        summaries.push({ ...candidate.summary, state: "shadowed", shadowedBy: winner.resolved.id });
        continue;
      }
      winners.set(candidate.resolved.name, candidate);
      summaries.push(candidate.summary);
    }
    return { active: [...winners.values()], summaries };
  }

  private async findSkillPackages(root: string, diagnostics?: SkillDiagnostic[], source?: SkillSource): Promise<string[]> {
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(root);
    } catch {
      return [];
    }
    if (!details.isDirectory()) return [];
    const found: string[] = [];
    const visit = async (directory: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (cause) {
        if (diagnostics && source) diagnostics.push({ type: "warning", source, path: directory, message: cause instanceof Error ? cause.message : "Unable to read skill directory" });
        return;
      }
      const entry = entries.find((candidate) => candidate.name === "SKILL.md" && candidate.isFile());
      if (entry) {
        found.push(join(directory, entry.name));
        return;
      }
      for (const child of entries) {
        if (!child.isDirectory() || child.name === "node_modules" || child.name.startsWith(".")) continue;
        await visit(join(directory, child.name));
      }
    };
    await visit(root);
    return found;
  }

  private configureWatchers(): void {
    const paths = new Set<string>();
    for (const source of this.globalSources()) {
      paths.add(source.root);
      paths.add(dirname(source.root));
    }
    for (const workspace of this.workspaces) {
      for (const source of this.workspaceSources(workspace)) {
        paths.add(source.root);
        paths.add(dirname(source.root));
      }
    }
    for (const skill of this.snapshotValue.skills) paths.add(dirname(skill.filePath));
    const watchPaths = new Set([...paths].map((path) => this.nearestExistingPath(path)));
    for (const [path, watcher] of this.watchers) {
      if (watchPaths.has(path)) continue;
      watcher.close();
      this.watchers.delete(path);
    }
    for (const path of watchPaths) {
      if (this.watchers.has(path)) continue;
      try {
        this.watchers.set(path, watch(path, () => this.scheduleRefresh()));
      } catch {
        // A missing parent/source is covered by the next explicit refresh.
      }
    }
  }

  private async readMarketplaceOrigin(skillRoot: string): Promise<SkillMarketplaceOrigin | undefined> {
    try {
      return marketplaceOrigin(JSON.parse(await readFile(join(skillRoot, ".wordless-marketplace.json"), "utf8")));
    } catch {
      return undefined;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 250);
  }

  private nearestExistingPath(path: string): string {
    let current = resolve(path);
    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
    return current;
  }

  private async readConfig(): Promise<SkillConfig> {
    try {
      const value = JSON.parse(await readFile(this.paths.configPath, "utf8")) as unknown;
      if (typeof value !== "object" || value === null || !Array.isArray((value as Record<string, unknown>).disabledSkillIds)) return DEFAULT_CONFIG;
      const disabledSkillIds = (value as { disabledSkillIds: unknown[] }).disabledSkillIds.filter((id): id is string => typeof id === "string");
      return { disabledSkillIds };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  private async writeConfig(): Promise<void> {
    await mkdir(dirname(this.paths.configPath), { recursive: true });
    await writeFile(this.paths.configPath, `${JSON.stringify(this.config, null, 2)}\n`, "utf8");
  }
}
