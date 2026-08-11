import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NodeExecutionEnv } from "@wordless/agent/node";
import type { FileFinder as FffFileFinder, GrepCursor } from "@ff-labs/fff-node";
import type { SessionAccessLevel } from "@wordless/domain";
import type { WorkspaceFindRequest, WorkspaceGrepRequest, WorkspaceSearchProvider, WorkspaceSearchService as WorkspaceSearchServiceContract } from "@wordless/workspace-search";
import { minimatch } from "minimatch";

export interface WorkspaceDirectoryEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  size: number;
  mtimeMs: number;
}

function toPortablePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function canonicalExistingPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function normalizedRelativePath(path: string): string {
  return toPortablePath(path).replace(/^\.\//, "").replace(/\/$/, "");
}

function excludesPath(path: string, exclude: string | string[] | undefined): boolean {
  const patterns = (Array.isArray(exclude) ? exclude : exclude ? [exclude] : []).map(normalizedRelativePath).filter(Boolean);
  const candidate = normalizedRelativePath(path);
  return patterns.some((pattern) => minimatch(candidate, pattern, { dot: true, matchBase: !pattern.includes("/") }) || minimatch(candidate, `${pattern.replace(/\/$/, "")}/**`, { dot: true }));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type FinderEntry = { finder?: FffFileFinder; loading?: Promise<FffFileFinder>; touchedAt: number };
type CursorEntry = { root: string; operation: "find" | "grep"; signature: string; pageIndex?: number; grepCursor?: GrepCursor; touchedAt: number };
type SearchScope = { indexRoot: string; constraint?: string; absoluteResults: boolean; temporary: boolean };

export class WorkspaceSearchService implements WorkspaceSearchServiceContract {
  private readonly finders = new Map<string, FinderEntry>();
  private readonly cursors = new Map<string, CursorEntry>();
  private readonly maximumFinders: number;
  private readonly fffModuleUrl?: string;
  private disposed = false;

  constructor(options?: { maximumFinders?: number; fffModuleUrl?: string }) {
    this.maximumFinders = Math.max(1, options?.maximumFinders ?? 6);
    this.fffModuleUrl = options?.fffModuleUrl;
  }

  forRoot(rootPath: string): WorkspaceSearchProvider {
    const root = canonicalExistingPath(rootPath);
    return {
      find: async (request) => await this.find(root, request),
      grep: async (request) => await this.grep(root, request),
      searchReferences: async (query, limit) => await this.searchReferences(root, query, limit),
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.finders.values()) entry.finder?.destroy();
    this.finders.clear();
    this.cursors.clear();
  }

  private async getFinder(root: string): Promise<FffFileFinder> {
    if (this.disposed) throw new Error("Workspace search service has been disposed");
    const key = canonicalExistingPath(root);
    const existing = this.finders.get(key);
    if (existing?.finder && !existing.finder.isDestroyed) {
      existing.touchedAt = Date.now();
      return existing.finder;
    }
    if (existing?.loading) return await existing.loading;
    const entry: FinderEntry = { touchedAt: Date.now() };
    const loading = (async () => {
      const finder = await this.createFinder(key);
      if (this.disposed) {
        finder.destroy();
        throw new Error("Workspace search service has been disposed");
      }
      entry.finder = finder;
      entry.loading = undefined;
      entry.touchedAt = Date.now();
      this.evictFinders(key);
      return finder;
    })();
    entry.loading = loading;
    this.finders.set(key, entry);
    try {
      return await loading;
    } catch (error) {
      if (this.finders.get(key) === entry) this.finders.delete(key);
      throw error;
    }
  }

  private async find(root: string, request: WorkspaceFindRequest) {
    const limit = Math.min(200, Math.max(1, request.limit ?? 30));
    const signature = JSON.stringify({ pattern: request.pattern, path: request.path ?? "", exclude: request.exclude ?? [], limit });
    const cursor = request.cursor ? this.consumeCursor(request.cursor, root, "find", signature) : undefined;
    const pageIndex = cursor?.pageIndex ?? 0;
    const scope = this.resolveScope(root, request.path);
    return await this.withScopeFinder(scope, async (finder) => {
      const query = [scope.constraint, request.pattern.trim()].filter(Boolean).join(" ");
      const result = finder.fileSearch(query, { pageIndex, pageSize: limit });
      if (!result.ok) throw new Error(`FFF file search failed: ${result.error}`);
      const items = result.value.items
        .filter((item) => !excludesPath(item.relativePath, request.exclude))
        .slice(0, limit)
        .map((item) => ({ path: this.resultPath(scope, item.relativePath), name: item.fileName, size: item.size, modifiedAt: item.modified * 1_000 }));
      const hasMore = (pageIndex + 1) * limit < result.value.totalMatched;
      return { items, total: result.value.totalMatched, ...(hasMore ? { nextCursor: this.putCursor({ root, operation: "find", signature, pageIndex: pageIndex + 1, touchedAt: Date.now() }) } : {}) };
    });
  }

  private async grep(root: string, request: WorkspaceGrepRequest) {
    const limit = Math.min(200, Math.max(1, request.limit ?? 20));
    const context = Math.min(20, Math.max(0, request.context ?? 0));
    const signature = JSON.stringify({ pattern: request.pattern, path: request.path ?? "", exclude: request.exclude ?? [], ignoreCase: request.ignoreCase, literal: request.literal !== false, context, limit });
    const cursor = request.cursor ? this.consumeCursor(request.cursor, root, "grep", signature) : undefined;
    const scope = this.resolveScope(root, request.path);
    return await this.withScopeFinder(scope, async (finder) => {
      const forceCaseSensitive = request.ignoreCase === false;
      const searchedPattern = request.ignoreCase === true
        ? request.pattern.toLocaleLowerCase()
        : forceCaseSensitive
          ? `(?-i:${request.literal === false ? request.pattern : escapeRegex(request.pattern)})`
          : request.pattern;
      const query = [scope.constraint, searchedPattern].filter(Boolean).join(" ");
      const result = finder.grep(query, {
        mode: request.literal === false || forceCaseSensitive ? "regex" : "plain",
        smartCase: true,
        beforeContext: context,
        afterContext: context,
        pageSize: limit,
        cursor: cursor?.grepCursor ?? null,
      });
      if (!result.ok) throw new Error(`FFF grep failed: ${result.error}`);
      const items = result.value.items
        .filter((item) => !excludesPath(item.relativePath, request.exclude))
        .slice(0, limit)
        .map((item) => ({ path: this.resultPath(scope, item.relativePath), line: item.lineNumber, column: item.col + 1, text: item.lineContent, contextBefore: item.contextBefore ?? [], contextAfter: item.contextAfter ?? [] }));
      return {
        items,
        total: result.value.totalMatched,
        ...(result.value.nextCursor ? { nextCursor: this.putCursor({ root, operation: "grep", signature, grepCursor: result.value.nextCursor, touchedAt: Date.now() }) } : {}),
      };
    });
  }

  private async searchReferences(root: string, query: string, requestedLimit = 50) {
    const limit = Math.min(100, Math.max(1, requestedLimit));
    const finder = await this.getFinder(root);
    const result = finder.mixedSearch(query.trim(), { pageSize: limit });
    if (!result.ok) throw new Error(`FFF workspace search failed: ${result.error}`);
    return result.value.items.map((entry) => entry.type === "file"
      ? { path: normalizedRelativePath(entry.item.relativePath), name: entry.item.fileName, kind: "file" as const, size: entry.item.size, modifiedAt: entry.item.modified * 1_000 }
      : { path: normalizedRelativePath(entry.item.relativePath), name: entry.item.dirName.replace(/\/$/, ""), kind: "directory" as const, size: 0, modifiedAt: 0 });
  }

  private putCursor(entry: CursorEntry): string {
    const token = randomUUID();
    this.cursors.set(token, entry);
    while (this.cursors.size > 200) this.cursors.delete(this.cursors.keys().next().value!);
    return token;
  }

  private async createFinder(root: string): Promise<FffFileFinder> {
    const { FileFinder } = this.fffModuleUrl
      ? await import(this.fffModuleUrl) as typeof import("@ff-labs/fff-node")
      : await import("@ff-labs/fff-node");
    const created = FileFinder.create({ basePath: root, aiMode: true, enableFsRootScanning: false, enableHomeDirScanning: false, followSymlinks: false });
    if (!created.ok) throw new Error(`FFF could not index ${root}: ${created.error}`);
    const scanned = await created.value.waitForScan(15_000);
    if (!scanned.ok || !scanned.value) {
      created.value.destroy();
      throw new Error(!scanned.ok ? `FFF scan failed: ${scanned.error}` : `FFF scan timed out for ${root}`);
    }
    return created.value;
  }

  private resolveScope(root: string, requestedPath: string | undefined): SearchScope {
    if (!requestedPath || requestedPath === ".") return { indexRoot: root, absoluteResults: false, temporary: false };
    const requested = canonicalExistingPath(isAbsolute(requestedPath) ? requestedPath : resolve(root, requestedPath));
    const within = relative(root, requested);
    if (within === "" || (!within.startsWith("..") && !isAbsolute(within))) {
      const constraint = normalizedRelativePath(within);
      return { indexRoot: root, ...(constraint ? { constraint: `${constraint}/` } : {}), absoluteResults: false, temporary: false };
    }
    return { indexRoot: requested, absoluteResults: true, temporary: true };
  }

  private async withScopeFinder<T>(scope: SearchScope, operation: (finder: FffFileFinder) => Promise<T>): Promise<T> {
    const finder = scope.temporary ? await this.createFinder(scope.indexRoot) : await this.getFinder(scope.indexRoot);
    try {
      return await operation(finder);
    } finally {
      if (scope.temporary) finder.destroy();
    }
  }

  private resultPath(scope: SearchScope, relativePath: string): string {
    const normalized = normalizedRelativePath(relativePath);
    return scope.absoluteResults ? toPortablePath(resolve(scope.indexRoot, normalized)) : normalized;
  }

  private consumeCursor(token: string, root: string, operation: CursorEntry["operation"], signature: string): CursorEntry {
    const entry = this.cursors.get(token);
    this.cursors.delete(token);
    if (!entry || entry.root !== root || entry.operation !== operation || entry.signature !== signature) throw new Error("Search cursor is invalid or expired");
    return entry;
  }

  private evictFinders(activeRoot: string): void {
    const candidates = [...this.finders.entries()].filter(([root, entry]) => root !== activeRoot && entry.finder && !entry.loading).sort((left, right) => left[1].touchedAt - right[1].touchedAt);
    while (this.finders.size > this.maximumFinders && candidates.length) {
      const [root, entry] = candidates.shift()!;
      entry.finder?.destroy();
      this.finders.delete(root);
      for (const [token, cursor] of this.cursors) if (cursor.root === root) this.cursors.delete(token);
    }
  }
}

export interface ToolCallAccessController {
  runWithToolCall<T>(toolCallId: string, operation: () => Promise<T>): Promise<T>;
  grantOutsideWorkspaceAccess(toolCallId: string): void;
  revokeOutsideWorkspaceAccess(toolCallId: string): void;
  clearOutsideWorkspaceAccess(): void;
}

class WorkspaceExecutionEnv implements ToolCallAccessController {
  readonly cwd: string;
  private readonly base: NodeExecutionEnv;
  private readonly readOnlyRoots: string[];
  private readonly toolCallContext = new AsyncLocalStorage<string>();
  private readonly elevatedToolCalls = new Set<string>();

  constructor(rootPath: string, readOnlyRoots: string[] = []) {
    this.cwd = canonicalExistingPath(rootPath);
    this.base = new NodeExecutionEnv({ cwd: this.cwd });
    this.readOnlyRoots = readOnlyRoots.map(canonicalExistingPath);
  }

  async readTextFile(path: string, abortSignal?: AbortSignal) {
    const guarded = await this.guardReadPath(path, abortSignal);
    return guarded.ok ? await this.base.readTextFile(guarded.value, abortSignal) : guarded;
  }

  async readTextLines(path: string, options?: { maxLines?: number; abortSignal?: AbortSignal }) {
    const guarded = await this.guardReadPath(path, options?.abortSignal);
    return guarded.ok ? await this.base.readTextLines(guarded.value, options) : guarded;
  }

  async writeFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal) {
    const guarded = await this.guardWorkspacePath(path, abortSignal);
    return guarded.ok ? await this.base.writeFile(guarded.value, content, abortSignal) : guarded;
  }

  async fileInfo(path: string, abortSignal?: AbortSignal) {
    const guarded = await this.guardReadPath(path, abortSignal);
    return guarded.ok ? await this.base.fileInfo(guarded.value) : guarded;
  }

  async listDir(path: string, abortSignal?: AbortSignal) {
    const guarded = await this.guardReadPath(path, abortSignal);
    return guarded.ok ? await this.base.listDir(guarded.value, abortSignal) : guarded;
  }

  async canonicalPath(path: string, abortSignal?: AbortSignal) {
    const guarded = await this.guardReadPath(path, abortSignal);
    return guarded.ok ? await this.base.canonicalPath(guarded.value) : guarded;
  }

  async exec(command: string, options?: Parameters<NodeExecutionEnv["exec"]>[1]) {
    return await this.base.exec(command, options);
  }

  async runWithToolCall<T>(toolCallId: string, operation: () => Promise<T>): Promise<T> {
    return await this.toolCallContext.run(toolCallId, operation);
  }

  grantOutsideWorkspaceAccess(toolCallId: string): void {
    this.elevatedToolCalls.add(toolCallId);
  }

  revokeOutsideWorkspaceAccess(toolCallId: string): void {
    this.elevatedToolCalls.delete(toolCallId);
  }

  clearOutsideWorkspaceAccess(): void {
    this.elevatedToolCalls.clear();
  }

  private async guardWorkspacePath(path: string, abortSignal?: AbortSignal): Promise<{ ok: true; value: string } | { ok: false; error: Error }> {
    const addressed = isAbsolute(path) ? resolve(path) : resolve(this.cwd, path);
    return await this.guardAddressedPath(addressed, abortSignal, (candidate) => this.isWithinRoot(candidate));
  }

  private async guardReadPath(path: string, abortSignal?: AbortSignal): Promise<{ ok: true; value: string } | { ok: false; error: Error }> {
    const addressed = isAbsolute(path) ? resolve(path) : resolve(this.cwd, path);
    return await this.guardAddressedPath(addressed, abortSignal, (candidate) => this.isWithinRoot(candidate) || this.isWithinReadOnlyRoot(candidate));
  }

  private async guardAddressedPath(
    path: string,
    abortSignal: AbortSignal | undefined,
    allowed: (candidate: string) => boolean,
  ): Promise<{ ok: true; value: string } | { ok: false; error: Error }> {
    if (abortSignal?.aborted) return this.aborted(path);
    if (this.isCurrentToolCallElevated()) return { ok: true, value: path };
    const canonicalPath = await this.canonicalizeAddressedPath(path);
    if (!canonicalPath || !allowed(canonicalPath)) return this.denied(path);
    return { ok: true, value: canonicalPath };
  }

  private isCurrentToolCallElevated(): boolean {
    const toolCallId = this.toolCallContext.getStore();
    return toolCallId !== undefined && this.elevatedToolCalls.has(toolCallId);
  }

  private async canonicalizeAddressedPath(path: string): Promise<string | undefined> {
    let current = path;
    const missingSegments: string[] = [];
    while (true) {
      try {
        return resolve(await realpath(current), ...missingSegments.reverse());
      } catch {
        const parent = dirname(current);
        if (parent === current) return undefined;
        missingSegments.push(basename(current));
        current = parent;
      }
    }
  }

  private isWithinRoot(path: string): boolean {
    const value = relative(this.cwd, path);
    return value === "" || (!value.startsWith("..") && !isAbsolute(value));
  }

  private isWithinReadOnlyRoot(path: string): boolean {
    return this.readOnlyRoots.some((root) => {
      const value = relative(root, path);
      return value === "" || (!value.startsWith("..") && !isAbsolute(value));
    });
  }

  private denied(path: string): { ok: false; error: Error } {
    return { ok: false, error: new Error(`Default access only permits files inside the workspace: ${path}`) };
  }

  private aborted(path: string): { ok: false; error: Error } {
    return { ok: false, error: new Error(`aborted: ${path}`) };
  }
}

export class WorkspacePathService {
  async createManagedWorkspace(root: string, name: string): Promise<{ rootPath: string; canonicalRootPath: string }> {
    const rootPath = resolve(root, name);
    await mkdir(rootPath, { recursive: false });
    return { rootPath, canonicalRootPath: await realpath(rootPath) };
  }

  async openLinkedWorkspace(rootPath: string): Promise<{ rootPath: string; canonicalRootPath: string; name: string }> {
    const resolved = resolve(rootPath);
    const details = await stat(resolved);
    if (!details.isDirectory()) {
      throw new Error("Selected path is not a directory");
    }
    return { rootPath: resolved, canonicalRootPath: await realpath(resolved), name: basename(resolved) };
  }

  async ensureSessionRoot(rootPath: string): Promise<string> {
    await mkdir(rootPath, { recursive: true });
    return await realpath(rootPath);
  }

  createExecutionEnv(rootPath: string, accessLevel: SessionAccessLevel, options?: { readOnlyRoots?: string[] }): NodeExecutionEnv | WorkspaceExecutionEnv {
    return accessLevel === "default" ? new WorkspaceExecutionEnv(rootPath, options?.readOnlyRoots) : new NodeExecutionEnv({ cwd: rootPath });
  }

  isWithinRoot(rootPath: string, candidatePath: string): boolean {
    const root = resolve(rootPath);
    const candidate = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(root, candidatePath);
    const path = relative(root, candidate);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
  }

  async listDirectory(rootPath: string, relativePath: string): Promise<WorkspaceDirectoryEntry[]> {
    const directory = await this.resolveExistingPath(rootPath, relativePath, true);
    const entries: WorkspaceDirectoryEntry[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink() || (!details.isFile() && !details.isDirectory())) continue;
      const root = await realpath(rootPath);
      const canonical = await realpath(path);
      if (!this.isWithinRoot(root, canonical)) continue;
      entries.push({
        path: toPortablePath(relative(root, canonical)),
        name: entry.name,
        kind: details.isDirectory() ? "directory" : "file",
        size: details.size,
        mtimeMs: details.mtimeMs,
      });
    }
    return entries
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      })
      .slice(0, 500);
  }

  async resolveWorkspaceFile(rootPath: string, relativePath: string): Promise<string> {
    const path = await this.resolveExistingPath(rootPath, relativePath, false);
    const details = await stat(path);
    if (!details.isFile()) throw new Error("Selected path is not a file");
    return path;
  }

  async resolveWorkspaceEntry(rootPath: string, relativePath: string): Promise<string> {
    return await this.resolveExistingPath(rootPath, relativePath, false);
  }

  async readWorkspaceTextFile(rootPath: string, relativePath: string, maximumBytes: number): Promise<{ path: string; name: string; content: string }> {
    const path = await this.resolveWorkspaceFile(rootPath, relativePath);
    const details = await stat(path);
    if (details.size > maximumBytes) throw new Error("The selected file is too large to attach");
    const content = await readFile(path);
    if (content.includes(0)) throw new Error("Only UTF-8 text files can be attached");
    return { path: toPortablePath(relative(await realpath(rootPath), path)), name: basename(path), content: content.toString("utf8") };
  }

  private async resolveExistingPath(rootPath: string, requestedPath: string, allowRoot: boolean): Promise<string> {
    if (isAbsolute(requestedPath)) throw new Error("Workspace paths must be relative");
    const root = await realpath(rootPath);
    const requested = requestedPath.trim();
    if (!allowRoot && !requested) throw new Error("A workspace file path is required");
    const candidate = resolve(root, requested || ".");
    if (!this.isWithinRoot(root, candidate)) throw new Error("Workspace path escapes the session root");
    const details = await lstat(candidate);
    if (details.isSymbolicLink()) throw new Error("Symbolic links are not available in the workspace browser");
    const canonical = await realpath(candidate);
    if (!this.isWithinRoot(root, canonical)) throw new Error("Workspace path escapes the session root");
    return canonical;
  }
}
