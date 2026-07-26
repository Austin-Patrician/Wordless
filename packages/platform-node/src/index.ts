import { lstat, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NodeExecutionEnv } from "@wordless/agent/node";
import type { SessionAccessLevel } from "@wordless/domain";
import ignore from "ignore";

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

class WorkspaceExecutionEnv {
  readonly cwd: string;
  private readonly base: NodeExecutionEnv;
  private readonly readOnlyRoots: string[];

  constructor(rootPath: string, readOnlyRoots: string[] = []) {
    this.cwd = resolve(rootPath);
    this.base = new NodeExecutionEnv({ cwd: this.cwd });
    this.readOnlyRoots = readOnlyRoots.map((path) => resolve(path));
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

  async exec(command: string, options?: Parameters<NodeExecutionEnv["exec"]>[1]) {
    return await this.base.exec(command, options);
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
    if (!allowed(path)) return this.denied(path);
    const canonicalAncestor = await this.findCanonicalAncestor(path, allowed);
    if (!canonicalAncestor || !allowed(canonicalAncestor)) return this.denied(path);
    return { ok: true, value: path };
  }

  private async findCanonicalAncestor(path: string, allowed: (candidate: string) => boolean): Promise<string | undefined> {
    let current = path;
    while (true) {
      try {
        return await realpath(current);
      } catch {
        const parent = dirname(current);
        if (parent === current || !allowed(parent)) return undefined;
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
  private static readonly ignoredDirectoryNames = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".turbo", ".cache"]);
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

  async searchWorkspace(rootPath: string, query: string, maximumResults = 50): Promise<WorkspaceDirectoryEntry[]> {
    const root = await realpath(rootPath);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches: WorkspaceDirectoryEntry[] = [];
    const gitignoreRules: Array<{ basePath: string; matcher: ReturnType<typeof ignore> }> = [];
    let scanned = 0;

    const loadGitignore = async (directory: string): Promise<void> => {
      try {
        const contents = await readFile(join(directory, ".gitignore"), "utf8");
        if (contents.trim()) gitignoreRules.push({ basePath: directory, matcher: ignore().add(contents) });
      } catch {
        // A workspace does not need to be a Git repository.
      }
    };

    const isGitignored = (candidate: string, kind: WorkspaceDirectoryEntry["kind"]): boolean => {
      let ignored = false;
      for (const ruleSet of gitignoreRules) {
        const path = toPortablePath(relative(ruleSet.basePath, candidate));
        if (!path || path === ".." || path.startsWith("../")) continue;
        const result = ruleSet.matcher.test(kind === "directory" ? `${path}/` : path);
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
      }
      return ignored;
    };

    const visit = async (directory: string, depth: number): Promise<void> => {
      if (matches.length >= maximumResults || scanned >= 20_000 || depth > 32) return;
      await loadGitignore(directory);
      let entries: Dirent<string>[];
      try {
        entries = await readdir(directory, { withFileTypes: true, encoding: "utf8" });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (matches.length >= maximumResults || scanned >= 20_000) return;
        if (entry.isDirectory() && WorkspacePathService.ignoredDirectoryNames.has(entry.name)) continue;
        const candidate = resolve(directory, entry.name);
        let details;
        try {
          details = await lstat(candidate);
        } catch {
          continue;
        }
        if (details.isSymbolicLink() || (!details.isFile() && !details.isDirectory())) continue;
        let canonical: string;
        try {
          canonical = await realpath(candidate);
        } catch {
          continue;
        }
        if (!this.isWithinRoot(root, canonical)) continue;
        scanned += 1;
        const path = toPortablePath(relative(root, canonical));
        const kind = details.isDirectory() ? "directory" : "file";
        if (isGitignored(canonical, kind)) continue;
        if (!normalizedQuery || `${entry.name} ${path}`.toLocaleLowerCase().includes(normalizedQuery)) {
          matches.push({ path, name: entry.name, kind, size: details.size, mtimeMs: details.mtimeMs });
        }
        if (details.isDirectory()) await visit(canonical, depth + 1);
      }
    };

    await visit(root, 0);
    return matches.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" });
    });
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
