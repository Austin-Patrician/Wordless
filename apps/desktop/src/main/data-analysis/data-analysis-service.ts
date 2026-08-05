import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { isIP } from "node:net";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { DataAnalysisService } from "@wordless/capability-data";
import type { AnalysisChartSummary, AnalysisDatasetSummary, AnalysisOutputFile, AnalysisResearchClaim, AnalysisResearchSource, AnalysisRunDescriptor, AnalysisSessionSnapshot, DataAnalysisCapabilitySnapshot } from "@wordless/protocol";

type PythonRuntime = { command: string; args: string[]; version: string; dependencies: Record<string, boolean> };
type PythonDependency = "openpyxl" | "pyarrow" | "pandas";
type StoredRun = AnalysisRunDescriptor & { workspaceRoot: string };
type StoredSession = { version: 1; runs: StoredRun[] };

const SUPPORTED_EXTENSIONS = new Set([".csv", ".tsv", ".json", ".jsonl", ".xlsx", ".xlsm", ".xltx", ".parquet"]);
const IMAGE_EXTENSIONS = new Set([".png", ".svg"]);
const MAX_PROCESS_OUTPUT = 2_000_000;
const MAX_RESEARCH_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_RESEARCH_SOURCE_CHARS = 120_000;

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function safeName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "analysis-data";
}

function chartUrl(sessionId: string, analysisId: string, path: string): string {
  return `wordless-analysis://output/${encodeURIComponent(sessionId)}/${encodeURIComponent(analysisId)}/${path.split(/[\\/]/).map(encodeURIComponent).join("/")}`;
}

function stableAnalysisId(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

function fileKind(path: string): AnalysisOutputFile["kind"] {
  const name = basename(path).toLowerCase();
  const extension = extname(name);
  if (name === "analysis-report.md") return "report";
  if (name === "analysis-manifest.json") return "manifest";
  if (IMAGE_EXTENSIONS.has(extension)) return "chart";
  if (extension === ".py" || extension === ".sql" || extension === ".js" || extension === ".mjs") return "script";
  if (SUPPORTED_EXTENSIONS.has(extension)) return "data";
  return "other";
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b !== undefined && b >= 64 && b <= 127) || a >= 224;
  }
  if (isIP(normalized) === 6) return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
  return true;
}

function decodeHtml(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function extractHtmlTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeHtml(match[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 500) || null : null;
}

function extractHtmlText(html: string): string {
  const blockAware = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|article|section|main|header|footer|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(blockAware).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

export class DesktopDataAnalysisService implements DataAnalysisService {
  private readonly metadataRoot: string;
  private readonly resourcesRoot: string;
  private readonly researchConfirmationTokens = new Map<string, string>();
  private readonly sessionMutationTails = new Map<string, Promise<void>>();
  private pythonRuntimesPromise: Promise<PythonRuntime[]> | undefined;

  constructor(options: { metadataRoot: string; resourcesRoot: string }) {
    this.metadataRoot = options.metadataRoot;
    this.resourcesRoot = options.resourcesRoot;
  }

  private async withSessionMutation<T>(sessionId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.sessionMutationTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.sessionMutationTails.set(sessionId, tail);
    await previous.catch(() => undefined);
    try {
      return await mutation();
    } finally {
      release();
      if (this.sessionMutationTails.get(sessionId) === tail) this.sessionMutationTails.delete(sessionId);
    }
  }

  async capabilities(): Promise<DataAnalysisCapabilitySnapshot> {
    const runtime = (await this.pythonRuntimes())[0];
    return runtime
      ? { status: "ready", command: [runtime.command, ...runtime.args].join(" "), version: runtime.version, dependencies: runtime.dependencies, supportedFormats: [...SUPPORTED_EXTENSIONS].map((extension) => extension.slice(1)) }
      : { status: "missing", command: null, version: null, message: "Python 3 was not found. Install Python and restart Wordless. Packages are never installed automatically.", supportedFormats: [...SUPPORTED_EXTENSIONS].map((extension) => extension.slice(1)) };
  }

  async catalog(_sessionId: string, workspaceRoot: string, input: { query?: string; formats?: string[]; limit?: number }, signal?: AbortSignal): Promise<unknown> {
    const root = await realpath(workspaceRoot);
    const query = input.query?.trim().toLowerCase() ?? "";
    const requestedFormats = new Set((input.formats ?? []).map((format) => `.${format.toLowerCase().replace(/^\./, "")}`));
    const limit = input.limit ?? 100;
    const files: Array<{ path: string; name: string; format: string; size: number; updatedAt: number }> = [];
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (signal?.aborted) throw new Error("Data catalog cancelled");
      if (depth > 8 || files.length >= limit) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (files.length >= limit) break;
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "analysis-output") continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute, depth + 1);
        if (!entry.isFile()) continue;
        const extension = extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(extension) || (requestedFormats.size > 0 && !requestedFormats.has(extension))) continue;
        const path = relative(root, absolute);
        if (query && !path.toLowerCase().includes(query)) continue;
        const details = await stat(absolute);
        files.push({ path, name: entry.name, format: extension.slice(1), size: details.size, updatedAt: details.mtimeMs });
      }
    };
    await visit(root, 0);
    return { files, count: files.length, truncated: files.length >= limit };
  }

  async inspect(sessionId: string, workspaceRoot: string, input: { paths: string[]; analysisId?: string; title?: string; sampleRows?: number }, signal?: AbortSignal): Promise<AnalysisRunDescriptor> {
    const root = await realpath(workspaceRoot);
    const stored = await this.readSession(sessionId);
    const existing = input.analysisId ? stored.runs.find((run) => run.id === input.analysisId) : undefined;
    if (input.analysisId && !existing) throw new Error("Analysis run not found");
    const now = Date.now();
    const id = existing?.id ?? randomUUID();
    const outputRoot = join("analysis-output", sessionId, id);
    const datasets = new Map((existing?.datasets ?? []).map((dataset) => [dataset.path.toLowerCase(), dataset]));
    let run: StoredRun = {
      id,
      sessionId,
      title: input.title?.trim() || existing?.title || `Analysis ${stored.runs.length + 1}`,
      status: "inspecting",
      outputRoot,
      reportPath: existing?.reportPath ?? null,
      reportContent: existing?.reportContent ?? null,
      datasets: [...datasets.values()],
      charts: existing?.charts ?? [],
      files: existing?.files ?? [],
      errors: [],
      warnings: [...datasets.values()].flatMap((dataset) => dataset.warnings),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      workspaceRoot: root,
    };
    await this.upsertRun(sessionId, run);
    try {
      for (const path of input.paths) {
        const source = await this.resolveWorkspaceFile(root, path);
        const dataset = await this.inspectSource(root, source, input.sampleRows ?? 20, signal);
        datasets.set(dataset.path.toLowerCase(), dataset);
      }
      run = { ...run, status: "working", datasets: [...datasets.values()], warnings: [...datasets.values()].flatMap((dataset) => dataset.warnings), updatedAt: Date.now() };
      await this.upsertRun(sessionId, run);
      return this.publicRun(run);
    } catch (cause) {
      await this.recordFailure({ ...run, datasets: [...datasets.values()] }, cause);
      throw cause;
    }
  }

  async materialize(sessionId: string, workspaceRoot: string, input: { analysisId: string; sourcePath: string; outputName: string }, signal?: AbortSignal): Promise<AnalysisRunDescriptor> {
    const runtime = await this.requirePython(["pandas", "pyarrow"]);
    const run = await this.requireRun(sessionId, workspaceRoot, input.analysisId);
    try {
      const source = await this.resolveWorkspaceFile(run.workspaceRoot, input.sourcePath);
      const output = resolve(run.workspaceRoot, run.outputRoot, "intermediate", `${safeName(input.outputName).replace(/\.parquet$/i, "")}.parquet`);
      await mkdir(dirname(output), { recursive: true });
      await this.runPython(runtime, this.script("materialize_data.py"), [source, output], run.workspaceRoot, signal, 300_000);
      const refreshed = await this.refreshRunFiles({ ...run, status: "working", updatedAt: Date.now(), errors: [] });
      await this.upsertRun(sessionId, refreshed);
      return this.publicRun(refreshed);
    } catch (cause) {
      await this.recordFailure(run, cause);
      throw cause;
    }
  }

  async validate(sessionId: string, workspaceRoot: string, analysisId: string, signal?: AbortSignal): Promise<AnalysisRunDescriptor> {
    const runtime = await this.requirePython();
    const run = await this.requireRun(sessionId, workspaceRoot, analysisId);
    try {
      await this.assertSourceFingerprints(run, signal);
      const manifest = resolve(run.workspaceRoot, run.outputRoot, "analysis-manifest.json");
      await this.runPython(runtime, this.script("validate_analysis.py"), [manifest], run.workspaceRoot, signal, 120_000);
      const refreshed = await this.refreshRunFiles({ ...run, status: "validated", errors: [], updatedAt: Date.now() });
      await this.upsertRun(sessionId, refreshed);
      return this.publicRun(refreshed);
    } catch (cause) {
      await this.recordFailure(run, cause);
      throw cause;
    }
  }

  async publish(sessionId: string, workspaceRoot: string, analysisId: string, signal?: AbortSignal): Promise<AnalysisRunDescriptor> {
    const runtime = await this.requirePython();
    let run = await this.requireRun(sessionId, workspaceRoot, analysisId);
    try {
      await this.assertSourceFingerprints(run, signal);
      if (run.research && !["not-needed", "blocked", "ready"].includes(run.research.status)) throw new Error("Deep research must be validated before publishing the unified report");
      const output = resolve(run.workspaceRoot, run.outputRoot);
      const manifestPath = join(output, "analysis-manifest.json");
      const reportPath = join(output, "analysis-report.md");
      await this.runPython(runtime, this.script("validate_analysis.py"), [manifestPath], run.workspaceRoot, signal, 120_000);
      await this.runPython(runtime, this.script("render_report.py"), [manifestPath, reportPath], run.workspaceRoot, signal, 120_000);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { title?: string; charts?: Array<{ title?: string; path?: string }> };
      const charts: AnalysisChartSummary[] = [];
      for (const [index, chart] of (manifest.charts ?? []).entries()) {
        if (!chart.path) continue;
        const source = resolve(output, chart.path);
        if (!isInside(output, source) || !IMAGE_EXTENSIONS.has(extname(source).toLowerCase())) continue;
        await stat(source);
        charts.push({ id: `${analysisId}:${index}`, title: chart.title?.trim() || basename(source), path: relative(output, source), mimeType: extname(source).toLowerCase() === ".svg" ? "image/svg+xml" : "image/png", url: chartUrl(sessionId, analysisId, relative(output, source)) });
      }
      run = await this.refreshRunFiles({ ...run, title: manifest.title?.trim() || run.title, status: "published", reportPath: relative(run.workspaceRoot, reportPath), reportContent: await readFile(reportPath, "utf8"), charts, errors: [], updatedAt: Date.now() });
      await this.upsertRun(sessionId, run);
      return this.publicRun(run);
    } catch (cause) {
      await this.recordFailure(run, cause);
      throw cause;
    }
  }

  async prepareResearch(sessionId: string, workspaceRoot: string, input: { analysisId: string; mode: "quick" | "normal" | "heavy"; objective: string; questions: string[]; dimensions: Array<{ id: string; name: string; question: string }> }): Promise<{ run: AnalysisRunDescriptor; confirmationToken: string }> {
    return await this.withSessionMutation(sessionId, async () => {
      const run = await this.requireRun(sessionId, workspaceRoot, input.analysisId);
      const now = Date.now();
      const dimensions = input.dimensions.map((dimension) => ({ id: dimension.id, name: dimension.name, question: dimension.question, status: "planned" as const, claimCount: 0, sourceCount: 0 }));
      const research: NonNullable<AnalysisRunDescriptor["research"]> = {
        researchId: randomUUID(),
        status: "awaiting-confirmation" as const,
        mode: input.mode,
        objective: input.objective,
        questions: input.questions,
        dimensions,
        sources: [],
        claims: [],
        conflicts: [],
        sourceCount: 0,
        completedDimensions: 0,
        updatedAt: now,
      };
      const output = resolve(run.workspaceRoot, run.outputRoot, "research");
      await mkdir(join(output, "source-cache"), { recursive: true });
      await writeFile(join(output, "plan.json"), `${JSON.stringify({ version: 1, ...research }, null, 2)}\n`, "utf8");
      const confirmationToken = randomUUID();
      this.researchConfirmationTokens.set(`${sessionId}:${input.analysisId}`, confirmationToken);
      const updated = { ...run, research, updatedAt: now, errors: [] };
      await this.upsertRun(sessionId, updated);
      return { run: this.publicRun(updated), confirmationToken };
    });
  }

  async startResearch(sessionId: string, workspaceRoot: string, input: { analysisId: string; confirmationToken: string; webResearchAvailable: boolean }): Promise<AnalysisRunDescriptor> {
    return await this.withSessionMutation(sessionId, async () => {
      const run = await this.requireRun(sessionId, workspaceRoot, input.analysisId);
      const key = `${sessionId}:${input.analysisId}`;
      const expectedToken = this.researchConfirmationTokens.get(key);
      if (!expectedToken || expectedToken !== input.confirmationToken) throw new Error("Research confirmation is missing or expired. Prepare the research plan again.");
      this.researchConfirmationTokens.delete(key);
      if (!run.research || run.research.status !== "awaiting-confirmation") throw new Error("Research is not awaiting confirmation");
      const research = input.webResearchAvailable
        ? { ...run.research, status: "researching" as const, updatedAt: Date.now() }
        : { ...run.research, status: "blocked" as const, blockedReason: "A ready Web Search Connector is required for external research.", updatedAt: Date.now() };
      const updated = { ...run, research, updatedAt: research.updatedAt, errors: [] };
      await this.upsertRun(sessionId, updated);
      return this.publicRun(updated);
    });
  }

  async snapshotResearchSource(sessionId: string, workspaceRoot: string, input: { analysisId: string; dimensionId: string; url: string; title?: string; publisher?: string; publishedAt?: string; sourceType?: "web" | "academic" | "filing" | "other" }, signal?: AbortSignal): Promise<AnalysisResearchSource> {
    const initial = await this.requireRun(sessionId, workspaceRoot, input.analysisId);
    if (!initial.research || !["researching", "reviewing", "failed"].includes(initial.research.status)) {
      throw new Error(initial.research?.blockedReason ?? "Deep research must be confirmed and started before capturing sources");
    }
    if (!initial.research.dimensions.some((candidate) => candidate.id === input.dimensionId)) throw new Error(`Research dimension not found: ${input.dimensionId}`);
    const canonicalUrl = await this.assertPublicResearchUrl(input.url);
    const existing = initial.research.sources.find((source) => source.url === canonicalUrl);
    if (existing) return existing;
    const fetched = await this.fetchResearchSource(canonicalUrl, signal);
    const output = resolve(initial.workspaceRoot, initial.outputRoot);
    const relativeSnapshot = join("research", "source-cache", `${fetched.contentHash}.md`);
    const absoluteSnapshot = resolve(output, relativeSnapshot);
    await mkdir(dirname(absoluteSnapshot), { recursive: true });
    await writeFile(absoluteSnapshot, `# ${input.title?.trim() || canonicalUrl}\n\nSource: ${canonicalUrl}\n\n${fetched.text}\n`, "utf8");
    const source: AnalysisResearchSource = {
      id: `source-${fetched.contentHash.slice(0, 16)}`,
      url: canonicalUrl,
      title: input.title?.trim() || fetched.title || canonicalUrl,
      publisher: input.publisher?.trim() || null,
      publishedAt: input.publishedAt?.trim() || null,
      accessedAt: Date.now(),
      snapshotPath: relativeSnapshot,
      contentHash: fetched.contentHash,
      sourceType: input.sourceType ?? "web",
    };
    return await this.withSessionMutation(sessionId, async () => {
      const run = await this.requireRun(sessionId, workspaceRoot, input.analysisId);
      if (!run.research || !["researching", "reviewing", "failed"].includes(run.research.status)) {
        throw new Error(run.research?.blockedReason ?? "Deep research is no longer accepting source updates");
      }
      if (!run.research.dimensions.some((candidate) => candidate.id === input.dimensionId)) throw new Error(`Research dimension not found: ${input.dimensionId}`);
      const current = run.research.sources.find((candidate) => candidate.url === canonicalUrl);
      if (current) return current;
      const sources = [...run.research.sources, source];
      const dimensions = run.research.dimensions.map((candidate) => candidate.id === input.dimensionId ? { ...candidate, status: candidate.status === "planned" ? "researching" as const : candidate.status, sourceCount: candidate.sourceCount + 1 } : candidate);
      const research = { ...run.research, sources, dimensions, sourceCount: sources.length, updatedAt: Date.now() };
      await this.upsertRun(sessionId, { ...run, research, updatedAt: research.updatedAt });
      return source;
    });
  }

  async submitResearchDimension(sessionId: string, workspaceRoot: string, input: { analysisId: string; dimensionId: string; claims: Array<{ id: string; statement: string; kind: "external" | "synthesis"; evidenceRefs: string[]; confidence: "high" | "medium" | "low" | "contested"; caveats?: string[] }>; conflicts?: string[] }): Promise<AnalysisRunDescriptor> {
    return await this.withSessionMutation(sessionId, async () => {
      const run = await this.requireRun(sessionId, workspaceRoot, input.analysisId);
      if (!run.research || !["researching", "reviewing", "failed"].includes(run.research.status)) throw new Error("Deep research must be confirmed and started before submitting evidence");
      if (!run.research.dimensions.some((dimension) => dimension.id === input.dimensionId)) throw new Error(`Research dimension not found: ${input.dimensionId}`);
      const sourceIds = new Set(run.research.sources.map((source) => source.id));
      for (const claim of input.claims) for (const reference of claim.evidenceRefs) if (!sourceIds.has(reference)) throw new Error(`Claim ${claim.id} references an unknown source: ${reference}`);
      const claims: AnalysisResearchClaim[] = input.claims.map((claim) => ({ ...claim, dimensionId: input.dimensionId, caveats: claim.caveats ?? [] }));
      const retained = run.research.claims.filter((claim) => claim.dimensionId !== input.dimensionId && !claims.some((next) => next.id === claim.id));
      const dimensions = run.research.dimensions.map((dimension) => dimension.id === input.dimensionId ? { ...dimension, status: "ready" as const, claimCount: claims.length } : dimension);
      const completedDimensions = dimensions.filter((dimension) => dimension.status === "ready").length;
      const research = { ...run.research, claims: [...retained, ...claims], conflicts: input.conflicts ?? run.research.conflicts, dimensions, completedDimensions, updatedAt: Date.now() };
      const updated = { ...run, research, updatedAt: research.updatedAt, errors: [] };
      await this.upsertRun(sessionId, updated);
      return this.publicRun(updated);
    });
  }

  async reviewResearchDimension(sessionId: string, workspaceRoot: string, input: { analysisId: string; dimensionId: string; verdict: "pass" | "revise"; notes: string[] }): Promise<AnalysisRunDescriptor> {
    return await this.withSessionMutation(sessionId, async () => {
      const run = await this.requireRun(sessionId, workspaceRoot, input.analysisId);
      if (!run.research || !["researching", "reviewing", "failed"].includes(run.research.status)) throw new Error("Deep research must be confirmed and started before reviewing evidence");
      if (!run.research.dimensions.some((dimension) => dimension.id === input.dimensionId)) throw new Error(`Research dimension not found: ${input.dimensionId}`);
      const dimensions = run.research.dimensions.map((dimension) => dimension.id === input.dimensionId ? { ...dimension, review: { verdict: input.verdict, notes: input.notes } } : dimension);
      const research = { ...run.research, dimensions, status: "reviewing" as const, updatedAt: Date.now() };
      const updated = { ...run, research, updatedAt: research.updatedAt };
      await this.upsertRun(sessionId, updated);
      return this.publicRun(updated);
    });
  }

  async validateResearch(sessionId: string, workspaceRoot: string, analysisId: string): Promise<AnalysisRunDescriptor> {
    return await this.withSessionMutation(sessionId, async () => {
      const run = await this.requireRun(sessionId, workspaceRoot, analysisId);
      if (!run.research) throw new Error("Deep research has not been started");
      if (run.research.status === "blocked") return this.publicRun(run);
      if (run.research.status === "awaiting-confirmation") throw new Error("Deep research must be confirmed and started before validation");
      const errors: string[] = [];
      const sourceIds = new Set(run.research.sources.map((source) => source.id));
      if (run.research.dimensions.some((dimension) => dimension.status !== "ready")) errors.push("Every research dimension must submit evidence before validation");
      if (run.research.claims.length === 0) errors.push("Research must contain at least one claim");
      for (const claim of run.research.claims) for (const reference of claim.evidenceRefs) if (!sourceIds.has(reference)) errors.push(`Claim ${claim.id} references an unknown source: ${reference}`);
      if (run.research.conflicts.length > 0) errors.push("Unresolved source conflicts remain");
      if (run.research.mode !== "quick" && run.research.dimensions.some((dimension) => dimension.review?.verdict !== "pass")) errors.push("Every standard/deep research dimension requires a passing review");
      if (errors.length > 0) {
        const research = { ...run.research, status: "failed" as const, error: errors.join("; "), updatedAt: Date.now() };
        const updated = { ...run, research, updatedAt: research.updatedAt, errors };
        await this.upsertRun(sessionId, updated);
        throw new Error(errors.join("; "));
      }
      const research = { ...run.research, status: "ready" as const, error: undefined, updatedAt: Date.now() };
      const output = resolve(run.workspaceRoot, run.outputRoot);
      await writeFile(join(output, "research", "evidence.json"), `${JSON.stringify({ version: 1, researchId: research.researchId, mode: research.mode, objective: research.objective, questions: research.questions, dimensions: research.dimensions, sources: research.sources, claims: research.claims, conflicts: research.conflicts }, null, 2)}\n`, "utf8");
      await this.persistResearchManifest(output, research);
      const updated = { ...run, research, updatedAt: research.updatedAt, errors: [] };
      await this.upsertRun(sessionId, updated);
      return this.publicRun(updated);
    });
  }

  private async persistResearchManifest(output: string, research: NonNullable<AnalysisRunDescriptor["research"]>): Promise<void> {
    const manifestPath = join(output, "analysis-manifest.json");
    try {
      const value = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      value.version = Math.max(typeof value.version === "number" ? value.version : 1, 2);
      value.research = { researchId: research.researchId, mode: research.mode, objective: research.objective, questions: research.questions, evidencePath: "research/evidence.json", sourceCount: research.sourceCount, claimCount: research.claims.length };
      await writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    } catch {
      // data_publish will report a missing or malformed manifest through its normal validator.
    }
  }

  async snapshot(sessionId: string, workspaceRoot: string): Promise<AnalysisSessionSnapshot> {
    const root = await realpath(workspaceRoot);
    await this.discoverWorkspaceRuns(sessionId, root);
    const stored = await this.readSession(sessionId);
    const runs: AnalysisRunDescriptor[] = [];
    for (const run of stored.runs.filter((candidate) => candidate.workspaceRoot === root)) {
      const repaired = await this.repairDatasetEncoding(run).catch(() => run);
      const synchronized = await this.refreshRunReport(repaired).catch(() => repaired);
      const researchSynchronized = await this.refreshRunResearch(synchronized).catch(() => synchronized);
      const refreshed = await this.refreshRunFiles(researchSynchronized).catch(() => researchSynchronized);
      runs.push(this.publicRun(refreshed));
    }
    return { sessionId, capabilities: await this.capabilities(), runs: runs.sort((left, right) => right.updatedAt - left.updatedAt) };
  }

  async resolveOutput(sessionId: string, workspaceRoot: string, analysisId: string, relativePath: string): Promise<string> {
    const run = await this.requireRun(sessionId, workspaceRoot, analysisId);
    return await this.resolveRunOutput(run, relativePath);
  }

  async resolveProtocolOutput(sessionId: string, analysisId: string, relativePath: string): Promise<string> {
    const stored = await this.readSession(sessionId);
    const run = stored.runs.find((candidate) => candidate.id === analysisId);
    if (!run) throw new Error("Analysis run not found");
    return await this.resolveRunOutput(run, relativePath);
  }

  private async resolveRunOutput(run: StoredRun, relativePath: string): Promise<string> {
    const output = resolve(run.workspaceRoot, run.outputRoot);
    const candidate = resolve(output, relativePath);
    if (!isInside(output, candidate)) throw new Error("Analysis output path escapes the run directory");
    const canonical = await realpath(candidate);
    if (!isInside(await realpath(output), canonical)) throw new Error("Analysis output resolves outside the run directory");
    return canonical;
  }

  private async assertPublicResearchUrl(value: string): Promise<string> {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error("Research source URL is invalid"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Research sources must use HTTP or HTTPS");
    if (url.username || url.password) throw new Error("Research source URLs cannot contain credentials");
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") throw new Error("Private research source hosts are not allowed");
    const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    if (addresses.length === 0) throw new Error("Research source host could not be resolved");
    if (addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("Private research source addresses are not allowed");
    url.hash = "";
    return url.toString();
  }

  private async fetchResearchSource(url: string, signal?: AbortSignal): Promise<{ title: string | null; text: string; contentHash: string }> {
    let current = url;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (signal?.aborted) throw new Error("Research source fetch cancelled");
      const response = await fetch(current, { redirect: "manual", signal, headers: { accept: "text/html, text/plain, application/json, application/pdf;q=0.5" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Research source redirect ${response.status} has no location`);
        current = await this.assertPublicResearchUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`Research source returned HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_RESEARCH_SOURCE_BYTES) throw new Error("Research source is larger than 5 MB");
      if (!response.body) throw new Error("Research source returned an empty body");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAX_RESEARCH_SOURCE_BYTES) { await reader.cancel(); throw new Error("Research source is larger than 5 MB"); }
        chunks.push(next.value);
      }
      const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const isPdf = contentType.includes("application/pdf") || bytes.subarray(0, 5).toString("ascii") === "%PDF-";
      let title: string | null = null;
      let text: string;
      if (isPdf) {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: bytes });
        try { text = (await parser.getText()).text.replace(/\u0000/g, "").trim(); }
        finally { await parser.destroy(); }
      } else {
        const body = bytes.toString("utf8");
        title = contentType.includes("html") ? extractHtmlTitle(body) : null;
        text = contentType.includes("html") ? extractHtmlText(body) : body.replace(/\u0000/g, "").trim();
      }
      if (!text) throw new Error("Research source contained no readable text");
      return { title, text: text.slice(0, MAX_RESEARCH_SOURCE_CHARS), contentHash };
    }
    throw new Error("Research source exceeded the redirect limit");
  }

  private async resolveWorkspaceFile(root: string, path: string): Promise<string> {
    const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path);
    if (!isInside(root, candidate)) throw new Error("Data sources must be inside the current workspace");
    const canonical = await realpath(candidate);
    if (!isInside(root, canonical)) throw new Error("Data source resolves outside the current workspace");
    if (!(await stat(canonical)).isFile()) throw new Error("Data source must be a file");
    return canonical;
  }

  private async inspectSource(root: string, source: string, sampleRows: number, signal?: AbortSignal): Promise<AnalysisDatasetSummary> {
    const extension = extname(source).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Unsupported data format: ${extension || "(none)"}`);
    const dependencies: PythonDependency[] = extension === ".xlsx" || extension === ".xlsm" || extension === ".xltx"
      ? ["openpyxl"]
      : extension === ".parquet"
        ? ["pyarrow"]
        : [];
    const runtime = await this.requirePython(dependencies);
    const stdout = await this.runPython(runtime, this.script("inspect_data.py"), [source, "--sample-rows", String(sampleRows)], root, signal, 120_000);
    const inspected = JSON.parse(stdout) as { format?: string; fileSizeBytes?: number; datasets?: AnalysisDatasetSummary["datasets"]; warnings?: string[] };
    return {
      path: relative(root, source),
      name: basename(source),
      format: inspected.format ?? extension.slice(1),
      size: inspected.fileSizeBytes ?? (await stat(source)).size,
      fingerprint: await this.fingerprint(source, signal),
      datasets: (inspected.datasets ?? []).map((dataset) => ({ ...dataset, warnings: dataset.warnings ?? [], sample: dataset.sample ?? [] })),
      warnings: inspected.warnings ?? [],
    };
  }

  private async assertSourceFingerprints(run: StoredRun, signal?: AbortSignal): Promise<void> {
    for (const dataset of run.datasets) {
      const source = await this.resolveWorkspaceFile(run.workspaceRoot, dataset.path);
      if (await this.fingerprint(source, signal) !== dataset.fingerprint) throw new Error(`Source data changed after inspection: ${dataset.path}. Run data_inspect again before publishing.`);
    }
  }

  private async fingerprint(path: string, signal?: AbortSignal): Promise<string> {
    return await new Promise((resolvePromise, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(path);
      const abort = () => stream.destroy(new Error("Data inspection cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolvePromise(hash.digest("hex")));
      stream.on("close", () => signal?.removeEventListener("abort", abort));
    });
  }

  private script(name: string): string {
    return join(this.resourcesRoot, "skills", "data-analysis", "scripts", name);
  }

  private async requirePython(dependencies: PythonDependency[] = []): Promise<PythonRuntime> {
    const runtimes = await this.pythonRuntimes();
    const runtime = runtimes.find((candidate) => dependencies.every((dependency) => candidate.dependencies[dependency]));
    if (!runtime) throw new Error(dependencies.length > 0 ? `${dependencies.join(" and ")} ${dependencies.length === 1 ? "is" : "are"} required for this data operation. Install the missing package in an existing Python environment and restart Wordless.` : "Python 3 is required for data analysis. Install Python and restart Wordless; Wordless will not install packages automatically.");
    return runtime;
  }

  private async pythonRuntimes(): Promise<PythonRuntime[]> {
    this.pythonRuntimesPromise ??= this.detectPython();
    return await this.pythonRuntimesPromise;
  }

  private async detectPython(): Promise<PythonRuntime[]> {
    const candidates = [
      { command: "python", args: [] },
      { command: "py", args: ["-3"] },
      ...["3.14", "3.13", "3.12", "3.11", "3.10", "3.9"].map((version) => ({ command: "py", args: [`-${version}`] })),
      { command: "python3", args: [] },
    ];
    const runtimes: PythonRuntime[] = [];
    const identities = new Set<string>();
    for (const candidate of candidates) {
      try {
        const version = (await this.runProcess(candidate.command, [...candidate.args, "--version"], process.cwd(), undefined, 5_000)).trim();
        if (!/Python 3\./i.test(version)) continue;
        const dependencyOutput = await this.runProcess(candidate.command, [...candidate.args, "-c", "import importlib.util,json,sys;print(json.dumps({'executable':sys.executable,'openpyxl':bool(importlib.util.find_spec('openpyxl')),'pyarrow':bool(importlib.util.find_spec('pyarrow')),'pandas':bool(importlib.util.find_spec('pandas'))}))"], process.cwd(), undefined, 5_000);
        const detected = JSON.parse(dependencyOutput) as { executable?: string; openpyxl?: boolean; pyarrow?: boolean; pandas?: boolean };
        const identity = detected.executable?.toLowerCase() ?? `${candidate.command}:${candidate.args.join(" ")}`;
        if (identities.has(identity)) continue;
        identities.add(identity);
        runtimes.push({ ...candidate, version, dependencies: { openpyxl: detected.openpyxl === true, pyarrow: detected.pyarrow === true, pandas: detected.pandas === true } });
      } catch {
        // Try the next conventional Python command.
      }
    }
    return runtimes.sort((left, right) => Object.values(right.dependencies).filter(Boolean).length - Object.values(left.dependencies).filter(Boolean).length);
  }

  private async runPython(runtime: PythonRuntime, script: string, args: string[], cwd: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
    return await this.runProcess(runtime.command, [...runtime.args, script, ...args], cwd, signal, timeoutMs);
  }

  private async runProcess(command: string, args: string[], cwd: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
    return await new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, { cwd, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolvePromise(stdout);
      };
      const stop = () => {
        if (process.platform === "win32" && child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        else child.kill("SIGKILL");
      };
      const abort = () => { stop(); finish(new Error("Data analysis operation cancelled")); };
      const timer = setTimeout(() => { stop(); finish(new Error(`Data analysis operation timed out after ${Math.round(timeoutMs / 1000)} seconds`)); }, timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => { if (stdout.length < MAX_PROCESS_OUTPUT) stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < MAX_PROCESS_OUTPUT) stderr += chunk.toString(); });
      child.on("error", (error) => finish(error));
      child.on("close", (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`)));
    });
  }

  private async discoverWorkspaceRuns(sessionId: string, workspaceRoot: string): Promise<void> {
    const stored = await this.readSession(sessionId);
    const knownRoots = new Set(stored.runs.filter((run) => run.workspaceRoot === workspaceRoot).map((run) => resolve(workspaceRoot, run.outputRoot).toLowerCase()));
    const analysisRoot = join(workspaceRoot, "analysis-output");
    const manifests: string[] = [];
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > 5) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute, depth + 1);
        else if (entry.isFile() && entry.name === "analysis-manifest.json") manifests.push(absolute);
      }
    };
    try { await visit(analysisRoot, 0); } catch { return; }
    for (const manifestPath of manifests) {
      const output = dirname(manifestPath);
      if (knownRoots.has(output.toLowerCase())) continue;
      const run = await this.importWorkspaceRun(sessionId, workspaceRoot, manifestPath).catch(() => null);
      if (!run) continue;
      knownRoots.add(output.toLowerCase());
      await this.upsertRun(sessionId, run);
    }
  }

  private async importWorkspaceRun(sessionId: string, workspaceRoot: string, manifestPath: string): Promise<StoredRun> {
    const output = dirname(manifestPath);
    if (!isInside(join(workspaceRoot, "analysis-output"), output)) throw new Error("Analysis manifest is outside analysis-output");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      title?: string;
      inputs?: Array<{ path?: string; format?: string; rows?: number }>;
      charts?: Array<{ title?: string; path?: string }>;
      quality?: { warnings?: string[] };
    };
    const outputRoot = relative(workspaceRoot, output);
    const id = stableAnalysisId(`${sessionId}:${outputRoot.toLowerCase()}`);
    const datasets: AnalysisDatasetSummary[] = [];
    for (const input of manifest.inputs ?? []) {
      if (!input.path) continue;
      const candidate = resolve(output, input.path);
      if (!isInside(workspaceRoot, candidate)) continue;
      try {
        const source = await this.resolveWorkspaceFile(workspaceRoot, candidate);
        datasets.push(await this.inspectSource(workspaceRoot, source, 20));
      } catch {
        try {
          const details = await stat(candidate);
          datasets.push({ path: relative(workspaceRoot, candidate), name: basename(candidate), format: input.format ?? extname(candidate).slice(1), size: details.size, fingerprint: "unavailable", datasets: [{ name: basename(candidate), rows: input.rows ?? 0, columns: [], sample: [], warnings: ["A bounded preview could not be generated with the available Python environments."] }], warnings: ["A bounded preview could not be generated with the available Python environments."] });
        } catch {
          // Keep the report discoverable even when a source was moved.
        }
      }
    }
    const charts: AnalysisChartSummary[] = [];
    for (const [index, chart] of (manifest.charts ?? []).entries()) {
      if (!chart.path) continue;
      const source = resolve(output, chart.path);
      if (!isInside(output, source) || !IMAGE_EXTENSIONS.has(extname(source).toLowerCase())) continue;
      try { await stat(source); } catch { continue; }
      charts.push({ id: `${id}:${index}`, title: chart.title?.trim() || basename(source), path: relative(output, source), mimeType: extname(source).toLowerCase() === ".svg" ? "image/svg+xml" : "image/png", url: chartUrl(sessionId, id, relative(output, source)) });
    }
    const reportPath = join(output, "analysis-report.md");
    let reportContent: string | null = null;
    try { reportContent = await readFile(reportPath, "utf8"); } catch { /* The manifest can be inspected before report rendering. */ }
    const now = Date.now();
    return await this.refreshRunFiles({ id, sessionId, title: manifest.title?.trim() || basename(output), status: reportContent ? "published" : "working", outputRoot, reportPath: reportContent ? relative(workspaceRoot, reportPath) : null, reportContent, datasets, charts, files: [], errors: [], warnings: manifest.quality?.warnings ?? datasets.flatMap((dataset) => dataset.warnings), createdAt: now, updatedAt: now, workspaceRoot });
  }

  private metadataPath(sessionId: string): string {
    return join(this.metadataRoot, `${sessionId}.json`);
  }

  private async readSession(sessionId: string): Promise<StoredSession> {
    try {
      const value = JSON.parse(await readFile(this.metadataPath(sessionId), "utf8")) as StoredSession;
      if (value.version !== 1 || !Array.isArray(value.runs)) return { version: 1, runs: [] };
      return {
        ...value,
        runs: value.runs.map((run) => run.research && typeof run.research.researchId !== "string"
          ? { ...run, research: { ...run.research, researchId: `legacy-${stableAnalysisId(`${sessionId}:${run.id}:${run.research.updatedAt}`)}` } }
          : run),
      };
    } catch {
      return { version: 1, runs: [] };
    }
  }

  private async upsertRun(sessionId: string, run: StoredRun): Promise<void> {
    const stored = await this.readSession(sessionId);
    const runs = stored.runs.filter((candidate) => candidate.id !== run.id);
    runs.push(run);
    await mkdir(this.metadataRoot, { recursive: true });
    await writeFile(this.metadataPath(sessionId), `${JSON.stringify({ version: 1, runs }, null, 2)}\n`, "utf8");
  }

  private async recordFailure(run: StoredRun, cause: unknown): Promise<void> {
    const message = cause instanceof Error ? cause.message : String(cause);
    await this.upsertRun(run.sessionId, { ...run, status: "failed", errors: [message], updatedAt: Date.now() });
  }

  private async repairDatasetEncoding(run: StoredRun): Promise<StoredRun> {
    if (!JSON.stringify(run.datasets).includes("\uFFFD")) return run;
    const datasets: AnalysisDatasetSummary[] = [];
    for (const dataset of run.datasets) {
      const source = await this.resolveWorkspaceFile(run.workspaceRoot, dataset.path);
      datasets.push(await this.inspectSource(run.workspaceRoot, source, 20));
    }
    const repaired = { ...run, datasets, warnings: datasets.flatMap((dataset) => dataset.warnings), updatedAt: Date.now() };
    await this.upsertRun(run.sessionId, repaired);
    return repaired;
  }

  private async requireRun(sessionId: string, workspaceRoot: string, analysisId: string): Promise<StoredRun> {
    const root = await realpath(workspaceRoot);
    const run = (await this.readSession(sessionId)).runs.find((candidate) => candidate.id === analysisId && candidate.workspaceRoot === root);
    if (!run) throw new Error("Analysis run not found in the current workspace");
    return run;
  }

  private async refreshRunFiles(run: StoredRun): Promise<StoredRun> {
    const root = resolve(run.workspaceRoot, run.outputRoot);
    const files: AnalysisOutputFile[] = [];
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) {
          const details = await stat(absolute);
          const path = relative(root, absolute);
          files.push({ path, name: entry.name, kind: fileKind(path), size: details.size, updatedAt: details.mtimeMs });
        }
      }
    };
    try { await visit(root); } catch { return run; }
    return { ...run, files: files.sort((left, right) => left.path.localeCompare(right.path)) };
  }

  private async refreshRunReport(run: StoredRun): Promise<StoredRun> {
    const report = resolve(run.workspaceRoot, run.outputRoot, "analysis-report.md");
    try {
      const [reportContent, details] = await Promise.all([readFile(report, "utf8"), stat(report)]);
      const reportPath = relative(run.workspaceRoot, report);
      if (reportContent === run.reportContent && reportPath === run.reportPath) return run;
      return { ...run, reportContent, reportPath, updatedAt: Math.max(run.updatedAt, details.mtimeMs) };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT" || (run.reportContent === null && run.reportPath === null)) return run;
      return { ...run, reportContent: null, reportPath: null, status: run.status === "published" ? "working" : run.status };
    }
  }

  private async refreshRunResearch(run: StoredRun): Promise<StoredRun> {
    const evidencePath = resolve(run.workspaceRoot, run.outputRoot, "research", "evidence.json");
    let value: unknown;
    try { value = JSON.parse(await readFile(evidencePath, "utf8")) as unknown; }
    catch { return run; }
    if (!value || typeof value !== "object" || Array.isArray(value)) return run;
    const evidence = value as Record<string, unknown>;
    if (!Array.isArray(evidence.sources) || !Array.isArray(evidence.claims) || !Array.isArray(evidence.dimensions)) return run;
    const evidenceUpdatedAt = (await stat(evidencePath)).mtimeMs;
    const evidenceResearchId = typeof evidence.researchId === "string" ? evidence.researchId : null;
    if (run.research) {
      if (evidenceResearchId && evidenceResearchId !== run.research.researchId) return run;
      if (!evidenceResearchId && run.research.status !== "ready") return run;
      if (evidenceUpdatedAt < run.research.updatedAt && run.research.status !== "ready") return run;
    }
    const dimensions = evidence.dimensions as NonNullable<AnalysisRunDescriptor["research"]>["dimensions"];
    const sources = evidence.sources as AnalysisResearchSource[];
    const claims = evidence.claims as AnalysisResearchClaim[];
    const research: NonNullable<AnalysisRunDescriptor["research"]> = {
      researchId: evidenceResearchId ?? run.research?.researchId ?? `legacy-${createHash("sha256").update(JSON.stringify(evidence)).digest("hex").slice(0, 24)}`,
      status: "ready" as const,
      mode: evidence.mode === "quick" || evidence.mode === "normal" || evidence.mode === "heavy" ? evidence.mode : null,
      objective: typeof evidence.objective === "string" ? evidence.objective : null,
      questions: Array.isArray(evidence.questions) ? evidence.questions.filter((question): question is string => typeof question === "string") : [],
      dimensions,
      sources,
      claims,
      conflicts: Array.isArray(evidence.conflicts) ? evidence.conflicts.filter((conflict): conflict is string => typeof conflict === "string") : [],
      sourceCount: sources.length,
      completedDimensions: dimensions.filter((dimension) => dimension.status === "ready").length,
      updatedAt: evidenceUpdatedAt,
    };
    if (JSON.stringify(run.research) === JSON.stringify(research)) return run;
    return { ...run, research, updatedAt: Math.max(run.updatedAt, research.updatedAt) };
  }

  private publicRun(run: StoredRun): AnalysisRunDescriptor {
    const { workspaceRoot: _workspaceRoot, ...descriptor } = run;
    return descriptor;
  }
}
