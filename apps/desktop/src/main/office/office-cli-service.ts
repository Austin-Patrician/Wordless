import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  ArtifactDescriptor,
  ArtifactIssue,
  ArtifactPreviewManifest,
  ArtifactSelection,
  OfficeEngineHealth,
  PresentationTemplate,
} from "@wordless/protocol";

type PresentationManifest = {
  version: 1;
  artifacts: ArtifactDescriptor[];
};

type RunResult = { stdout: string; stderr: string };

type WatchSession = {
  child: ChildProcessWithoutNullStreams;
  url: string | null;
};

const sessionIdPattern = /^[a-f0-9-]{36}$/i;
const artifactIdPattern = /^[a-f0-9-]{36}$/i;
const fileNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,116}\.pptx$/;
const maximumPreviewSlides = 60;
const presentationOperationNames = new Set(["add", "set", "remove", "move", "swap"]);

const templates: PresentationTemplate[] = [
  { id: "auto", name: "Auto", description: "Let the agent select a visual direction from the brief.", tags: ["adaptive"] },
  { id: "blank", name: "Blank canvas", description: "A clean PPTX with no inherited visual language.", tags: ["minimal"] },
  { id: "aura-coffee", name: "Aura light", description: "Warm editorial product storytelling from the OfficeCLI template set.", tags: ["brand", "light"] },
  { id: "aura-coffee-dark", name: "Aura dark", description: "Dark, high-contrast product presentation from the OfficeCLI template set.", tags: ["brand", "dark"] },
  { id: "aionui-promo", name: "AionUI promo", description: "Structured technology product narrative from the OfficeCLI template set.", tags: ["product", "technology"] },
  { id: "attention-budget", name: "Attention budget", description: "Clear, editorial report treatment from the OfficeCLI template set.", tags: ["report", "editorial"] },
];

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function safeDeckName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  const withExtension = normalized.toLowerCase().endsWith(".pptx") ? normalized : `${normalized || "presentation"}.pptx`;
  return fileNamePattern.test(withExtension) ? withExtension : "presentation.pptx";
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function officeCliData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return "data" in record ? record.data : value;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function presentationAssetUrl(sessionId: string, artifactId: string, revision: number, fileName: string): string {
  return `wordless-presentation://preview/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}/${revision}/${encodeURIComponent(fileName)}`;
}

export function officeCliResourcePlatform(platform: string = process.platform): string {
  if (platform === "darwin") return "mac";
  if (platform === "win32") return "win";
  return platform;
}

function operationRecord(value: unknown, index: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Presentation operation ${index + 1} must be an object`);
  return value as Record<string, unknown>;
}

function operationString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function operationProps(value: unknown, index: number): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Presentation operation ${index + 1} props must be an object`);
  return { ...(value as Record<string, unknown>) };
}

const officePathSegments: Record<string, string> = {
  charts: "chart",
  connectors: "connector",
  groups: "group",
  pictures: "picture",
  placeholders: "placeholder",
  shapes: "shape",
  slides: "slide",
  tables: "table",
  textboxes: "textbox",
};

function officePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let normalized = value;
  for (const [plural, singular] of Object.entries(officePathSegments)) {
    normalized = normalized
      .replace(new RegExp(`/${plural}/([0-9]+)(?=/|$)`, "gi"), `/${singular}[$1]`)
      .replace(new RegExp(`/${singular}/([0-9]+)(?=/|$)`, "gi"), `/${singular}[$1]`)
      .replace(new RegExp(`/${plural}\\[([0-9]+)\\]`, "gi"), `/${singular}[$1]`);
  }
  return normalized;
}

function normalizedOperationProps(props: Record<string, unknown>, target: string | undefined, type: string | undefined): Record<string, unknown> {
  const normalized = { ...props };
  const backgroundColor = operationString(normalized.backgroundFillColor);
  if (backgroundColor) {
    if (type === "shape" || target?.includes("/shape[")) normalized.fill ??= backgroundColor;
    else normalized.background ??= backgroundColor;
  }
  delete normalized.backgroundFill;
  delete normalized.backgroundFillColor;
  return normalized;
}

function addParent(value: string | undefined): string {
  // Older Wordless operations addressed the presentation's slide collection as /slides.
  return value === "/slides" || value === "/slides/" ? "/" : officePath(value) ?? "/";
}

/** Converts Wordless' early op/path shape into OfficeCLI's batch-command shape. */
export function normalizePresentationOperations(operations: unknown[]): Record<string, unknown>[] {
  return operations.map((value, index) => {
    const operation = operationRecord(value, index);
    const command = operationString(operation.command) ?? operationString(operation.op);
    if (!command || !presentationOperationNames.has(command)) throw new Error(`Presentation operation ${index + 1} must declare add, set, remove, move, or swap`);
    let props = operationProps(operation.props, index);
    const path = officePath(operationString(operation.path));
    const includeProps = (omit: string[] = []) => {
      for (const key of omit) delete props[key];
      return Object.keys(props).length > 0 ? { props } : {};
    };

    if (command === "add") {
      const parent = addParent(operationString(operation.parent) ?? path);
      const type = operationString(operation.type) ?? operationString(props.type);
      const from = operationString(operation.from) ?? operationString(props.from);
      if (!type && !from) throw new Error(`Presentation operation ${index + 1}: add requires type or from`);
      props = normalizedOperationProps(props, parent, type);
      return { command, parent, ...(type ? { type } : {}), ...(from ? { from } : {}), ...includeProps(["type", "from"]) };
    }
    if (!path) throw new Error(`Presentation operation ${index + 1}: ${command} requires path`);
    props = normalizedOperationProps(props, path, undefined);
    if (command === "set" || command === "remove") return { command, path, ...includeProps() };
    if (command === "move") {
      const to = officePath(operationString(operation.to) ?? operationString(props.to));
      const after = officePath(operationString(operation.after) ?? operationString(props.after));
      const before = officePath(operationString(operation.before) ?? operationString(props.before));
      if (!to && !after && !before) throw new Error(`Presentation operation ${index + 1}: move requires to, after, or before`);
      return { command, path, ...(to ? { to } : {}), ...(after ? { after } : {}), ...(before ? { before } : {}), ...includeProps(["to", "after", "before"]) };
    }
    const path2 = officePath(operationString(operation.path2) ?? operationString(props.path2));
    if (!path2) throw new Error(`Presentation operation ${index + 1}: swap requires path2`);
    return { command, path, path2, ...includeProps(["path2"]) };
  });
}

export class OfficeCliService {
  private healthPromise: Promise<OfficeEngineHealth> | undefined;
  private readonly previewCache = new Map<string, ArtifactPreviewManifest>();
  private readonly previewPromises = new Map<string, Promise<ArtifactPreviewManifest>>();
  private readonly watches = new Map<string, WatchSession>();
  private readonly options: { artifactsRoot: string; resourcesPath?: string; binaryPath?: string };

  constructor(options: { artifactsRoot: string; resourcesPath?: string; binaryPath?: string }) {
    this.options = options;
  }

  listTemplates(): PresentationTemplate[] {
    return templates;
  }

  async health(): Promise<OfficeEngineHealth> {
    if (!this.healthPromise) this.healthPromise = this.probeHealth();
    return await this.healthPromise;
  }

  async list(sessionId: string): Promise<ArtifactDescriptor[]> {
    return (await this.readManifest(sessionId)).artifacts;
  }

  async create(sessionId: string, workspaceRoot: string, input: { name?: string; templateId?: string | null }): Promise<ArtifactDescriptor> {
    this.assertSessionId(sessionId);
    await this.requireHealthy();
    const root = resolve(workspaceRoot);
    const name = safeDeckName(input.name ?? "presentation.pptx");
    const source = await this.uniqueSourcePath(root, name);
    const templateId = input.templateId && input.templateId !== "auto" ? input.templateId : "blank";
    if (templateId !== "blank") {
      const template = this.templatePath(templateId);
      await access(template);
      await copyFile(template, source);
    } else {
      await this.run(["create", source, "--force"], { cwd: root });
    }
    const now = Date.now();
    const artifact: ArtifactDescriptor = {
      id: randomUUID(),
      sessionId,
      kind: "presentation",
      sourcePath: relative(root, source).replace(/\\/g, "/"),
      displayName: basename(source),
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      revision: 1,
      status: "ready",
      capabilities: ["preview", "select", "validate", "export", "open"],
      updatedAt: now,
    };
    const manifest = await this.readManifest(sessionId);
    manifest.artifacts.unshift(artifact);
    await this.writeManifest(sessionId, manifest);
    return artifact;
  }

  async inspect(sessionId: string, workspaceRoot: string, artifactId: string): Promise<string> {
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const result = await this.run(["view", source, "outline", "--json"], { cwd: dirnameFor(source) });
    const payload = officeCliData(parseJson(result.stdout));
    return payload === undefined ? result.stdout || result.stderr : JSON.stringify(payload, null, 2);
  }

  async apply(sessionId: string, workspaceRoot: string, artifactId: string, operations: unknown[]): Promise<ArtifactDescriptor> {
    if (operations.length === 0) throw new Error("At least one Office operation is required");
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const artifact = await this.findArtifact(sessionId, artifactId);
    const operationFile = join(this.revisionRoot(sessionId, artifactId, artifact.revision + 1), "operations.json");
    await mkdir(dirnameFor(operationFile), { recursive: true });
    await writeFile(operationFile, JSON.stringify(normalizePresentationOperations(operations)), "utf8");
    await this.run(["batch", source, "--input", operationFile, "--json"], { cwd: dirnameFor(source) });
    return await this.updateArtifact(sessionId, artifactId, (current) => ({ ...current, revision: current.revision + 1, status: "ready", updatedAt: Date.now() }));
  }

  async validate(sessionId: string, workspaceRoot: string, artifactId: string): Promise<ArtifactIssue[]> {
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const result = await this.run(["validate", source, "--json"], { cwd: dirnameFor(source), allowFailure: true });
    const payload = parseJson(result.stdout);
    const issues = this.validationIssues(payload, result.stderr);
    await this.updateArtifact(sessionId, artifactId, (artifact) => ({ ...artifact, status: issues.some((issue) => issue.severity === "error") ? "failed" : "ready", updatedAt: Date.now() }));
    return issues;
  }

  async preview(sessionId: string, workspaceRoot: string, artifactId: string, options: { force?: boolean } = {}): Promise<ArtifactPreviewManifest> {
    const artifact = await this.findArtifact(sessionId, artifactId);
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const cacheKey = `${sessionId}:${artifactId}:${artifact.revision}`;
    const inFlight = this.previewPromises.get(cacheKey);
    if (inFlight) return await inFlight;
    const cached = this.previewCache.get(cacheKey);
    if (cached && !options.force) {
      const watchUrl = await this.ensureWatch(sessionId, artifactId, source);
      return { ...cached, ...(watchUrl ? { watchUrl } : {}) };
    }
    const render = this.renderPreview(sessionId, artifactId, artifact.revision, source)
      .then((manifest) => {
        this.previewCache.set(cacheKey, manifest);
        return manifest;
      })
      .finally(() => this.previewPromises.delete(cacheKey));
    this.previewPromises.set(cacheKey, render);
    return await render;
  }

  private async renderPreview(sessionId: string, artifactId: string, revision: number, source: string): Promise<ArtifactPreviewManifest> {
    const output = this.revisionRoot(sessionId, artifactId, revision);
    await rm(output, { force: true, recursive: true });
    await mkdir(output, { recursive: true });
    const html = join(output, "deck.html");
    await this.run(["view", source, "html", "-o", html], { cwd: dirnameFor(source) });
    const outline = officeCliData(parseJson((await this.run(["view", source, "outline", "--json"], { cwd: dirnameFor(source), allowFailure: true })).stdout));
    const totalSlides = this.slideCount(outline);
    for (let index = 1; index <= Math.min(totalSlides, maximumPreviewSlides); index += 1) {
      await this.run(["view", source, "screenshot", "--page", String(index), "-o", join(output, `slide-${index}.png`)], { cwd: dirnameFor(source), allowFailure: true, timeoutMs: 60_000 });
    }
    const previewFiles = await readdir(output).catch(() => []);
    const thumbnails = new Set(previewFiles.filter((file) => /^slide-[0-9]+\.png$/i.test(file)));
    const surfaces = Array.from({ length: totalSlides }, (_, index) => {
      const file = `slide-${index + 1}.png`;
      return {
        id: `slide-${index + 1}`,
        kind: "slide" as const,
        label: `Slide ${index + 1}`,
        ...(thumbnails.has(file) ? { thumbnailUrl: presentationAssetUrl(sessionId, artifactId, revision, file) } : {}),
      };
    });
    const watchUrl = await this.ensureWatch(sessionId, artifactId, source);
    return {
      artifactId,
      revision,
      htmlUrl: presentationAssetUrl(sessionId, artifactId, revision, "deck.html"),
      ...(watchUrl ? { watchUrl } : {}),
      surfaces: surfaces.length ? surfaces : [{ id: "slide-1", kind: "slide", label: "Slide 1" }],
      issues: [],
    };
  }

  async selection(sessionId: string, workspaceRoot: string, artifactId: string, surfaceId = "slide-1"): Promise<ArtifactSelection | null> {
    const artifact = await this.findArtifact(sessionId, artifactId);
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const result = await this.run(["get", source, "selected", "--json"], { cwd: dirnameFor(source), allowFailure: true });
    const payload = officeCliData(parseJson(result.stdout));
    const locators = this.selectionLocators(payload);
    if (!locators[0]) return null;
    return { artifactId, revision: artifact.revision, surfaceId, locator: locators[0], label: `Selected element · ${locators[0]}` };
  }

  async sourceForOpen(sessionId: string, workspaceRoot: string, artifactId: string): Promise<string> {
    return await this.sourcePath(sessionId, workspaceRoot, artifactId);
  }

  async dispose(): Promise<void> {
    for (const watch of this.watches.values()) watch.child.kill();
    this.watches.clear();
  }

  private async probeHealth(): Promise<OfficeEngineHealth> {
    const binary = this.binaryPath();
    try {
      const result = await this.run(["--version"], { timeoutMs: 6_000 });
      return { status: "ready", version: (result.stdout || result.stderr).trim() || undefined, bundled: binary !== "officecli" };
    } catch (cause) {
      const message = messageFrom(cause);
      return { status: /ENOENT|not found/i.test(message) ? "missing" : "error", message, bundled: binary !== "officecli" };
    }
  }

  private async requireHealthy(): Promise<void> {
    const health = await this.health();
    if (health.status !== "ready") throw new Error(health.message ?? "OfficeCLI is not available. Reinstall Wordless or configure WORDLESS_OFFICECLI_BINARY.");
  }

  private binaryPath(): string {
    if (this.options.binaryPath) return this.options.binaryPath;
    if (process.env.WORDLESS_OFFICECLI_BINARY) return process.env.WORDLESS_OFFICECLI_BINARY;
    if (this.options.resourcesPath) {
      const executable = process.platform === "win32" ? "officecli.exe" : "officecli";
      return join(this.options.resourcesPath, "officecli", `${officeCliResourcePlatform()}-${process.arch}`, executable);
    }
    return "officecli";
  }

  private async run(args: string[], options: { cwd?: string; timeoutMs?: number; allowFailure?: boolean } = {}): Promise<RunResult> {
    const binary = this.binaryPath();
    const result = await new Promise<RunResult>((resolvePromise, reject) => {
      const child = spawn(binary, args, { cwd: options.cwd, env: { ...process.env, OFFICECLI_SKIP_UPDATE: "1" }, stdio: "pipe", windowsHide: true });
      let stdout = "";
      let stderr = "";
      const limit = 2_000_000;
      const append = (current: string, chunk: Buffer) => (current.length >= limit ? current : `${current}${chunk.toString("utf8")}`.slice(0, limit));
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const timeout = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 45_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 || options.allowFailure) resolvePromise({ stdout, stderr });
        else reject(new Error((stderr || stdout || `OfficeCLI exited with ${code}`).trim()));
      });
    });
    return result;
  }

  private async ensureWatch(sessionId: string, artifactId: string, source: string): Promise<string | null> {
    const key = `${sessionId}:${artifactId}`;
    const existing = this.watches.get(key);
    if (existing && !existing.child.killed) return existing.url;
    const child = spawn(this.binaryPath(), ["watch", source, "--port", "0"], {
      cwd: dirnameFor(source),
      env: { ...process.env, OFFICECLI_SKIP_UPDATE: "1" },
      stdio: "pipe",
      windowsHide: true,
    });
    const session: WatchSession = { child, url: null };
    this.watches.set(key, session);
    child.once("close", () => { if (this.watches.get(key) === session) this.watches.delete(key); });
    const url = await new Promise<string | null>((resolvePromise) => {
      const timer = setTimeout(() => resolvePromise(null), 2_500);
      const receive = (chunk: Buffer) => {
        const found = chunk.toString("utf8").match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/i)?.[0];
        if (!found) return;
        clearTimeout(timer);
        resolvePromise(found);
      };
      child.stdout.on("data", receive);
      child.stderr.on("data", receive);
      child.once("error", () => { clearTimeout(timer); resolvePromise(null); });
    });
    session.url = url;
    return url;
  }

  private async readManifest(sessionId: string): Promise<PresentationManifest> {
    this.assertSessionId(sessionId);
    try {
      const value = parseJson(await readFile(this.manifestPath(sessionId), "utf8"));
      if (!value || typeof value !== "object" || !Array.isArray((value as PresentationManifest).artifacts)) return { version: 1, artifacts: [] };
      return value as PresentationManifest;
    } catch {
      return { version: 1, artifacts: [] };
    }
  }

  private async writeManifest(sessionId: string, manifest: PresentationManifest): Promise<void> {
    const path = this.manifestPath(sessionId);
    await mkdir(dirnameFor(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
    await rename(temporary, path);
  }

  private async updateArtifact(sessionId: string, artifactId: string, update: (artifact: ArtifactDescriptor) => ArtifactDescriptor): Promise<ArtifactDescriptor> {
    const manifest = await this.readManifest(sessionId);
    const index = manifest.artifacts.findIndex((artifact) => artifact.id === artifactId);
    if (index < 0) throw new Error("Presentation artifact was not found");
    const next = update(manifest.artifacts[index]!);
    manifest.artifacts[index] = next;
    await this.writeManifest(sessionId, manifest);
    return next;
  }

  private async findArtifact(sessionId: string, artifactId: string): Promise<ArtifactDescriptor> {
    if (!artifactIdPattern.test(artifactId)) throw new Error("Invalid presentation artifact");
    const artifact = (await this.readManifest(sessionId)).artifacts.find((candidate) => candidate.id === artifactId && candidate.kind === "presentation");
    if (!artifact) throw new Error("Presentation artifact was not found");
    return artifact;
  }

  private async sourcePath(sessionId: string, workspaceRoot: string, artifactId: string): Promise<string> {
    const artifact = await this.findArtifact(sessionId, artifactId);
    const root = resolve(workspaceRoot);
    const source = resolve(root, artifact.sourcePath);
    if (!isWithin(root, source) || extname(source).toLowerCase() !== ".pptx") throw new Error("Presentation artifact path is invalid");
    await stat(source);
    return source;
  }

  private async uniqueSourcePath(root: string, name: string): Promise<string> {
    const base = resolve(root, name);
    if (!isWithin(root, base)) throw new Error("Presentation path must remain inside the workspace");
    let next = base;
    let index = 2;
    while (await stat(next).then(() => true).catch(() => false)) {
      next = join(dirnameFor(base), `${basename(base, ".pptx")} ${index}.pptx`);
      index += 1;
    }
    return next;
  }

  private templatePath(templateId: string): string {
    const fileNames: Record<string, string> = {
      "aura-coffee": "aura-coffee.pptx",
      "aura-coffee-dark": "aura-coffee-dark.pptx",
      "aionui-promo": "aionui-promo.pptx",
      "attention-budget": "attention-budget.pptx",
    };
    const fileName = fileNames[templateId];
    if (!fileName || !this.options.resourcesPath) throw new Error("Selected OfficeCLI template is not available in this build");
    return join(this.options.resourcesPath, "presentation-templates", fileName);
  }

  private revisionRoot(sessionId: string, artifactId: string, revision: number): string {
    return join(this.options.artifactsRoot, sessionId, artifactId, String(revision));
  }

  private manifestPath(sessionId: string): string {
    return join(this.options.artifactsRoot, sessionId, "manifest.json");
  }

  private assertSessionId(sessionId: string): void {
    if (!sessionIdPattern.test(sessionId)) throw new Error("Invalid session");
  }

  private validationIssues(payload: unknown, fallback: string): ArtifactIssue[] {
    payload = officeCliData(payload);
    if (Array.isArray(payload)) return payload.flatMap((item) => this.validationIssue(item));
    if (payload && typeof payload === "object" && Array.isArray((payload as { issues?: unknown[] }).issues)) return (payload as { issues: unknown[] }).issues.flatMap((item) => this.validationIssue(item));
    return fallback.trim() ? [{ severity: "warning", message: fallback.trim().slice(0, 1_000) }] : [];
  }

  private validationIssue(value: unknown): ArtifactIssue[] {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const message = typeof item.message === "string" ? item.message : typeof item.error === "string" ? item.error : undefined;
    if (!message) return [];
    return [{ severity: typeof item.severity === "string" && item.severity.toLowerCase() === "error" ? "error" : "warning", message, ...(typeof item.path === "string" ? { locator: item.path } : {}) }];
  }

  private selectionLocators(payload: unknown): string[] {
    payload = officeCliData(payload);
    if (Array.isArray(payload)) return payload.filter((value): value is string => typeof value === "string");
    if (!payload || typeof payload !== "object") return [];
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.results)) return record.results.flatMap((value) => typeof value === "string" ? [value] : value && typeof value === "object" && typeof (value as Record<string, unknown>).path === "string" ? [(value as Record<string, unknown>).path as string] : []);
    if (Array.isArray(record.paths)) return record.paths.filter((value): value is string => typeof value === "string");
    return [];
  }

  private slideCount(outline: unknown): number {
    if (!outline || typeof outline !== "object" || Array.isArray(outline)) return 1;
    const totalSlides = (outline as Record<string, unknown>).totalSlides;
    return typeof totalSlides === "number" && Number.isInteger(totalSlides) && totalSlides > 0 ? totalSlides : 1;
  }
}

function dirnameFor(path: string): string {
  return dirname(path);
}
