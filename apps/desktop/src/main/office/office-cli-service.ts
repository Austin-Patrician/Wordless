import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  compileOfficeMutations,
  SPREADSHEET_HIGH_LEVEL_TOOLS,
  type OfficeMutation,
  type PresentationAdvancedOperation,
  type PresentationCatalog,
  type PresentationOfficeService,
  type PresentationQualityIssue,
  type PresentationQualityReport,
  type PresentationReadRequest,
  type PresentationRenderedImage,
  type PresentationSource,
  type PresentationVisualReview,
  type SpreadsheetCatalog,
  type SpreadsheetCapabilitySnapshot,
  type SpreadsheetOfficeService,
  type SpreadsheetOperationPreview,
  type SpreadsheetQualityIssue,
  type SpreadsheetQualityReport,
  type SpreadsheetReadRequest,
  type SpreadsheetRenderedImage,
  type SpreadsheetRangeProfile,
} from "@wordless/capability-office";
import type {
  ArtifactDescriptor,
  ArtifactIssue,
  ArtifactPreviewManifest,
  ArtifactSelection,
  OfficeEngineHealth,
  PresentationTemplate,
  SpreadsheetChangeRecord,
  SpreadsheetSelection,
} from "@wordless/protocol";

type PresentationArtifactState = {
  templateId: string;
  quality?: PresentationQualityReport;
  sources: PresentationSource[];
  renderedRevision?: number;
  renderedSurfaceIds?: string[];
};

type SpreadsheetArtifactState = {
  quality?: SpreadsheetQualityReport;
  changes: Array<{ revision: number; operations: OfficeMutation[]; updatedAt: number }>;
};

type OfficeManifest = {
  version: 1 | 2 | 3;
  artifacts: ArtifactDescriptor[];
  presentation?: Record<string, PresentationArtifactState>;
  spreadsheet?: Record<string, SpreadsheetArtifactState>;
};

type RunResult = { stdout: string; stderr: string; exitCode: number | null };

type OfficeCliErrorCode = "OFFICECLI_TIMEOUT" | "OFFICECLI_CANCELLED" | "OFFICECLI_EXIT_FAILED" | "OFFICECLI_TERMINATION_FAILED";

class OfficeCliExecutionError extends Error {
  readonly code: OfficeCliErrorCode;

  constructor(code: OfficeCliErrorCode, message: string) {
    super(message);
    this.name = "OfficeCliExecutionError";
    this.code = code;
  }
}

type RunOptions = {
  allowFailure?: boolean;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

type WatchSession = {
  child: ChildProcessWithoutNullStreams;
  url: string | null;
};

const sessionIdPattern = /^[a-f0-9-]{36}$/i;
const artifactIdPattern = /^[a-f0-9-]{36}$/i;
const fileNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,116}\.pptx$/;
const spreadsheetFileNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,116}\.xlsx$/;
const maximumPreviewSlides = 60;
const maximumConcurrentPreviewRenders = 3;
const maximumModelRenderSlides = 4;
const presentationOperationNames = new Set(["add", "set", "remove", "move", "swap"]);
const presentationGuidanceNames = new Set(["pptx", "pitch-deck", "data-dashboard", "morph-ppt", "morph-ppt-3d"]);
const placeholderPattern = /(?:\\n|\{\{[^}]+\}\}|<TODO>|\b(?:lorem|ipsum|xxxx|placeholder)\b|\(\s*\)|\[\s*\])/gi;

const templates: PresentationTemplate[] = [
  { id: "auto", name: "Auto", description: "Let the agent select a visual direction from the brief.", tags: ["adaptive"] },
  { id: "blank", name: "Blank canvas", description: "A clean PPTX with no inherited visual language.", tags: ["minimal"] },
  { id: "aura-coffee", name: "Aura light", description: "Warm editorial product storytelling from the OfficeCLI template set.", tags: ["brand", "light"] },
  { id: "aura-coffee-dark", name: "Aura dark", description: "Dark, high-contrast product presentation from the OfficeCLI template set.", tags: ["brand", "dark"] },
  { id: "future-2050", name: "2050 vision", description: "A forward-looking visual narrative for trends, strategy, and future scenarios.", tags: ["future", "strategy"] },
  { id: "cat-philosophy", name: "Philosophy editorial", description: "A reflective lifestyle story with an editorial visual rhythm.", tags: ["lifestyle", "editorial"] },
  { id: "cat-secret-life", name: "Secret life story", description: "A playful, image-led narrative for informal storytelling.", tags: ["lifestyle", "story"] },
  { id: "feline-report", name: "Visual report", description: "A structured report layout with expressive editorial accents.", tags: ["report", "editorial"] },
  { id: "aionui-promo", name: "AionUI promo", description: "Structured technology product narrative from the OfficeCLI template set.", tags: ["product", "technology"] },
  { id: "geminicli-timetravel", name: "CLI time travel", description: "A technical product story with a cinematic timeline treatment.", tags: ["product", "technology"] },
  { id: "attention-budget", name: "Attention budget", description: "Clear, editorial report treatment from the OfficeCLI template set.", tags: ["report", "editorial"] },
  { id: "alien-guide", name: "Exploration guide", description: "An illustrated science guide for explanatory narratives.", tags: ["science", "guide"] },
  { id: "mars-settlement", name: "Mars settlement", description: "A structured mission and settlement planning presentation.", tags: ["science", "strategy"] },
  { id: "space-exploration", name: "Space exploration", description: "A chronological science narrative for milestones and discovery.", tags: ["science", "timeline"] },
  { id: "time-travel", name: "Time travel", description: "A cinematic science story with high visual contrast.", tags: ["science", "story"] },
  { id: "wildlife-company", name: "Wildlife technology", description: "A technology company profile with a nature-led visual system.", tags: ["technology", "company"] },
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

function safeWorkbookName(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  const withExtension = normalized.toLowerCase().endsWith(".xlsx") ? normalized : `${normalized || "workbook"}.xlsx`;
  return spreadsheetFileNamePattern.test(withExtension) ? withExtension : "workbook.xlsx";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function outputText(result: RunResult): string {
  const payload = officeCliData(parseJson(result.stdout));
  if (typeof payload === "string") return payload;
  if (payload !== undefined) return JSON.stringify(payload, null, 2);
  return (result.stdout || result.stderr).trim();
}

function spreadsheetColumnNumber(value: string): number {
  return [...value.toUpperCase()].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
}

function spreadsheetColumnLabel(value: number): string {
  let current = value;
  let label = "";
  while (current > 0) {
    current -= 1;
    label = String.fromCharCode(65 + current % 26) + label;
    current = Math.floor(current / 26);
  }
  return label;
}

function spreadsheetRangeDimensions(value: string): { rowCount: number; columnCount: number } {
  const match = value.match(/^([A-Z]{1,3})([1-9][0-9]*)(?::([A-Z]{1,3})([1-9][0-9]*))?$/i);
  if (!match) return { rowCount: 1, columnCount: 1 };
  const startColumn = spreadsheetColumnNumber(match[1]!);
  const startRow = Number(match[2]);
  const endColumn = spreadsheetColumnNumber(match[3] ?? match[1]!);
  const endRow = Number(match[4] ?? match[2]);
  return { rowCount: Math.abs(endRow - startRow) + 1, columnCount: Math.abs(endColumn - startColumn) + 1 };
}

function spreadsheetSheetFromLocator(locator: string): string | undefined {
  return locator.replace(/^\//, "").split("/")[0]?.trim() || undefined;
}

type SpreadsheetSelectionBounds = {
  sheetName: string;
  startColumn: number;
  startRow: number;
  endColumn: number;
  endRow: number;
};

function spreadsheetSelectionBounds(locator: string): SpreadsheetSelectionBounds | undefined {
  const match = locator.match(/^\/([^/]+)\/([A-Z]{1,3})([1-9][0-9]*)(?::([A-Z]{1,3})([1-9][0-9]*))?$/i);
  if (!match) return undefined;
  const firstColumn = spreadsheetColumnNumber(match[2]!);
  const firstRow = Number(match[3]);
  const secondColumn = spreadsheetColumnNumber(match[4] ?? match[2]!);
  const secondRow = Number(match[5] ?? match[3]);
  return {
    sheetName: match[1]!,
    startColumn: Math.min(firstColumn, secondColumn),
    startRow: Math.min(firstRow, secondRow),
    endColumn: Math.max(firstColumn, secondColumn),
    endRow: Math.max(firstRow, secondRow),
  };
}

export function normalizeSpreadsheetSelectionLocators(locators: readonly string[]): { locator: string; sheetName: string; range: string; rowCount: number; columnCount: number } | undefined {
  return normalizeSpreadsheetSelections(locators).ranges[0];
}

export function normalizeSpreadsheetSelections(locators: readonly string[]): {
  paths: string[];
  ranges: Array<{ locator: string; sheetName: string; range: string; rowCount: number; columnCount: number }>;
  elements: string[];
} {
  const paths = [...new Set(locators)];
  const cellBounds = paths.flatMap((locator) => {
    const bounds = spreadsheetSelectionBounds(locator);
    return bounds ? [bounds] : [];
  });
  const elements = paths.filter((locator) => !spreadsheetSelectionBounds(locator));
  const expandedCells = new Map<string, { sheetName: string; column: number; row: number }>();
  for (const bounds of cellBounds) {
    for (let row = bounds.startRow; row <= bounds.endRow; row += 1) {
      for (let column = bounds.startColumn; column <= bounds.endColumn; column += 1) {
        expandedCells.set(`${bounds.sheetName}\u0000${column}\u0000${row}`, { sheetName: bounds.sheetName, column, row });
      }
    }
  }
  const ranges = [...new Set([...expandedCells.values()].map((cell) => cell.sheetName))].flatMap((sheetName) => {
    const byRow = new Map<number, number[]>();
    for (const cell of expandedCells.values()) {
      if (cell.sheetName !== sheetName) continue;
      byRow.set(cell.row, [...(byRow.get(cell.row) ?? []), cell.column]);
    }
    const rowRuns = [...byRow.entries()].sort((left, right) => left[0] - right[0]).flatMap(([row, columns]) => {
      const sorted = [...new Set(columns)].sort((left, right) => left - right);
      const runs: Array<{ startColumn: number; endColumn: number; startRow: number; endRow: number }> = [];
      for (const column of sorted) {
        const current = runs.at(-1);
        if (current && column === current.endColumn + 1) current.endColumn = column;
        else runs.push({ startColumn: column, endColumn: column, startRow: row, endRow: row });
      }
      return runs;
    });
    const merged: typeof rowRuns = [];
    for (const run of rowRuns) {
      const previous = merged.find((candidate) => candidate.endRow === run.startRow - 1 && candidate.startColumn === run.startColumn && candidate.endColumn === run.endColumn);
      if (previous) previous.endRow = run.endRow;
      else merged.push({ ...run });
    }
    return merged.map((bounds) => {
      const start = `${spreadsheetColumnLabel(bounds.startColumn)}${bounds.startRow}`;
      const end = `${spreadsheetColumnLabel(bounds.endColumn)}${bounds.endRow}`;
      const range = start === end ? start : `${start}:${end}`;
      return { locator: `/${sheetName}/${range}`, sheetName, range, rowCount: bounds.endRow - bounds.startRow + 1, columnCount: bounds.endColumn - bounds.startColumn + 1 };
    });
  });
  return { paths, ranges, elements };
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  const record = recordValue(value);
  return record ? Object.values(record).flatMap(collectStrings) : [];
}

function slideNumberFromLocator(locator: string | undefined): number | undefined {
  const match = locator?.match(/\/slide\[([1-9][0-9]*)\]/i);
  return match ? Number(match[1]) : undefined;
}

function privateNetworkHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local")) return true;
  return /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(normalized) || /^172\.(?:1[6-9]|2[0-9]|3[01])\./.test(normalized);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function spreadsheetArtifactIssues(issues: SpreadsheetQualityIssue[]): ArtifactIssue[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    message: issue.message,
    ...(issue.locator ? { locator: issue.locator } : {}),
    code: issue.code,
    category: issue.category === "formula" ? "content" : issue.category === "reference" ? "structure" : issue.category,
    ...(issue.surfaceId ? { surfaceId: issue.surfaceId } : {}),
    ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
  }));
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

export class OfficeCliService implements PresentationOfficeService, SpreadsheetOfficeService {
  private healthPromise: Promise<OfficeEngineHealth> | undefined;
  private spreadsheetCapabilityPromise: Promise<SpreadsheetCapabilitySnapshot> | undefined;
  private readonly guidanceCache = new Map<string, Promise<string>>();
  private readonly previewCache = new Map<string, ArtifactPreviewManifest>();
  private readonly previewPromises = new Map<string, Promise<ArtifactPreviewManifest>>();
  private readonly watches = new Map<string, WatchSession>();
  private readonly managedSources = new Set<string>();
  private readonly spreadsheetWriteLocks = new Map<string, Promise<void>>();
  private readonly options: { artifactsRoot: string; resourcesPath?: string; binaryPath?: string };

  constructor(options: { artifactsRoot: string; resourcesPath?: string; binaryPath?: string }) {
    this.options = options;
  }

  listTemplates(): PresentationTemplate[] {
    return templates;
  }

  async catalog(sessionId: string): Promise<PresentationCatalog> {
    return {
      artifacts: await this.list(sessionId),
      templates: this.listTemplates(),
      guidance: [...presentationGuidanceNames].filter((name) => name !== "pptx"),
    };
  }

  async health(): Promise<OfficeEngineHealth> {
    if (!this.healthPromise) this.healthPromise = this.probeHealth();
    return await this.healthPromise;
  }

  async list(sessionId: string): Promise<ArtifactDescriptor[]> {
    const manifest = await this.readManifest(sessionId);
    return manifest.artifacts.filter((artifact) => artifact.kind === "presentation").map((artifact) => {
      const quality = manifest.presentation?.[artifact.id]?.quality;
      return quality ? {
        ...artifact,
        quality: {
          revision: quality.revision,
          status: quality.status,
          cycle: quality.cycle,
          totalSlides: quality.totalSlides,
          reviewedSlides: quality.reviewedSurfaceIds.length,
          issueCount: quality.issues.length,
          checkedAt: quality.checkedAt,
        },
      } : artifact;
    });
  }

  async catalogSpreadsheets(sessionId: string): Promise<SpreadsheetCatalog> {
    return { artifacts: await this.listSpreadsheets(sessionId) };
  }

  async spreadsheetCapabilities(): Promise<SpreadsheetCapabilitySnapshot> {
    if (!this.spreadsheetCapabilityPromise) {
      this.spreadsheetCapabilityPromise = Promise.all([
        this.run(["--version"], { timeoutMs: 6_000 }),
        this.run(["help", "xlsx"], { timeoutMs: 15_000 }),
      ]).then(([version, schema]) => ({
        version: (version.stdout || version.stderr).trim(),
        elements: [...schema.stdout.matchAll(/^  ([a-z][a-z0-9-]*)\s*$/gim)].map((match) => match[1]!).sort(),
        highLevelTools: [...SPREADSHEET_HIGH_LEVEL_TOOLS],
      }));
    }
    return await this.spreadsheetCapabilityPromise;
  }

  async listSpreadsheets(sessionId: string): Promise<ArtifactDescriptor[]> {
    return (await this.readManifest(sessionId)).artifacts.filter((artifact) => artifact.kind === "spreadsheet");
  }

  async createSpreadsheet(sessionId: string, workspaceRoot: string, input: { name?: string; locale?: string }, signal?: AbortSignal): Promise<ArtifactDescriptor> {
    this.assertSessionId(sessionId);
    await this.requireHealthy();
    const root = resolve(workspaceRoot);
    const source = await this.uniqueSpreadsheetSourcePath(root, safeWorkbookName(input.name ?? "workbook.xlsx"));
    const args = ["create", source, "--force"];
    if (input.locale) args.push("--locale", input.locale);
    await this.run(args, { cwd: root, signal, timeoutMs: 90_000 });
    this.managedSources.add(source);
    return await this.registerSpreadsheetArtifact(sessionId, root, source);
  }

  async openSpreadsheet(sessionId: string, workspaceRoot: string, input: { sourcePath: string }): Promise<ArtifactDescriptor> {
    this.assertSessionId(sessionId);
    await this.requireHealthy();
    if (isAbsolute(input.sourcePath)) throw new Error("Spreadsheet source path must be relative to the session workspace");
    const root = resolve(workspaceRoot);
    const source = resolve(root, input.sourcePath);
    if (!isWithin(root, source) || extname(source).toLowerCase() !== ".xlsx") throw new Error("Spreadsheet source must be an XLSX inside the session workspace");
    await stat(source);
    const relativePath = relative(root, source).replace(/\\/g, "/");
    const existing = (await this.readManifest(sessionId)).artifacts.find((artifact) => artifact.kind === "spreadsheet" && artifact.sourcePath === relativePath);
    if (existing) return existing;
    this.managedSources.add(source);
    return await this.registerSpreadsheetArtifact(sessionId, root, source);
  }

  async importSpreadsheetData(sessionId: string, workspaceRoot: string, artifactId: string, input: { sourcePath: string; sheet?: string; startCell?: string; header?: boolean }, signal?: AbortSignal): Promise<ArtifactDescriptor> {
    if (isAbsolute(input.sourcePath)) throw new Error("Spreadsheet import path must be relative to the session workspace");
    const root = resolve(workspaceRoot);
    const importSource = resolve(root, input.sourcePath);
    const extension = extname(importSource).toLowerCase();
    if (!isWithin(root, importSource) || (extension !== ".csv" && extension !== ".tsv")) throw new Error("Spreadsheet import source must be a CSV or TSV inside the session workspace");
    await stat(importSource);
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    return await this.withSpreadsheetWrite(source, async () => {
      await this.stopWatch(sessionId, artifactId);
      const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
      const backupRoot = this.revisionRoot(sessionId, artifactId, artifact.revision + 1);
      const backup = join(backupRoot, "source-before.xlsx");
      await mkdir(backupRoot, { recursive: true });
      await copyFile(source, backup);
      const args = ["import", source, `/${input.sheet ?? "Sheet1"}`, importSource, "--start-cell", input.startCell ?? "A1", "--json"];
      if (input.header) args.push("--header");
      try {
        await this.run(args, { cwd: dirnameFor(source), signal, timeoutMs: 90_000 });
      } catch (cause) {
        await this.restoreSpreadsheetBackup(sessionId, artifactId, source, backup, cause);
        throw cause;
      }
      const updated = await this.updateArtifact(sessionId, artifactId, (current) => ({ ...current, revision: current.revision + 1, status: "ready", updatedAt: Date.now() }));
      await this.updateSpreadsheetState(sessionId, artifactId, (state) => ({ ...state, quality: undefined, changes: [...state.changes, { revision: updated.revision, operations: [], updatedAt: Date.now() }] }));
      return updated;
    });
  }

  async helpSpreadsheet(input: { verb?: "add" | "set" | "get" | "query" | "remove"; element?: string }): Promise<string> {
    const args = ["help", "xlsx"];
    if (input.verb) args.push(input.verb);
    if (input.element) args.push(input.element);
    args.push("--json");
    return outputText(await this.run(args));
  }

  async readSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string, request: SpreadsheetReadRequest): Promise<string> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.waitForSpreadsheetWrite(source);
    let args: string[];
    if (request.kind === "view") {
      args = ["view", source, request.mode];
      if (request.sheet || request.range) {
        const locator = request.range ? `${request.sheet ?? "Sheet1"}!${request.range}` : request.sheet;
        if (locator) args.push("--range", locator);
      }
      if (request.start !== undefined) args.push("--start", String(request.start));
      if (request.end !== undefined) args.push("--end", String(request.end));
      if (request.limit !== undefined) args.push("--max-lines", String(request.limit));
    } else if (request.kind === "get") {
      args = ["get", source, request.path];
      if (request.depth !== undefined) args.push("--depth", String(request.depth));
    } else {
      args = ["query", source, request.selector];
      if (request.limit !== undefined) args.push("--limit", String(request.limit));
    }
    args.push("--json");
    return outputText(await this.run(args, { cwd: dirnameFor(source) }));
  }

  async profileSpreadsheetRange(sessionId: string, workspaceRoot: string, artifactId: string, input: { sheet: string; range: string }): Promise<SpreadsheetRangeProfile> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.waitForSpreadsheetWrite(source);
    const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
    const result = await this.run(["view", source, "text", "--range", `${input.sheet}!${input.range}`, "--json"], { cwd: dirnameFor(source) });
    const payload = recordValue(officeCliData(parseJson(result.stdout)));
    const values = (Array.isArray(payload?.sheets) ? payload.sheets : []).flatMap((sheet) => {
      const sheetRecord = recordValue(sheet);
      return (Array.isArray(sheetRecord?.rows) ? sheetRecord.rows : []).flatMap((row) => {
        const cells = recordValue(recordValue(row)?.cells);
        return cells ? Object.values(cells).filter((value): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean") : [];
      });
    });
    const dimensions = spreadsheetRangeDimensions(input.range);
    const numbers = values.flatMap((value) => {
      const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
      return Number.isFinite(number) ? [number] : [];
    });
    const normalizedValues = values.map((value) => String(value));
    const populatedCells = values.length;
    const duplicateValues = normalizedValues.length - new Set(normalizedValues).size;
    const totalCells = dimensions.rowCount * dimensions.columnCount;
    return {
      artifactId,
      revision: artifact.revision,
      sheetName: input.sheet,
      range: input.range,
      ...dimensions,
      populatedCells,
      blankCells: Math.max(0, totalCells - populatedCells),
      numericCells: numbers.length,
      duplicateValues,
      ...(numbers.length ? { minimum: Math.min(...numbers), maximum: Math.max(...numbers), average: numbers.reduce((sum, value) => sum + value, 0) / numbers.length } : {}),
    };
  }

  async previewSpreadsheetOperations(sessionId: string, workspaceRoot: string, artifactId: string, operations: OfficeMutation[]): Promise<SpreadsheetOperationPreview> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.waitForSpreadsheetWrite(source);
    const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
    const limited = operations.slice(0, 20);
    const changes = await Promise.all(limited.map(async (operation) => {
      const locator = operation.command === "add" ? operation.parent : operation.path;
      const before = operation.command === "add" ? undefined : await this.run(["get", source, locator, "--json"], { cwd: dirnameFor(source), allowFailure: true }).then((result) => outputText(result).slice(0, 500));
      const kind = /\/[A-Z]{1,3}[1-9][0-9]*(?::[A-Z]{1,3}[1-9][0-9]*)?$/i.test(locator)
        ? locator.includes(":") ? "range" as const : "cell" as const
        : "structure" as const;
      const summary = operation.command === "add"
        ? `Add ${operation.type ?? "element"}`
        : operation.command === "set"
          ? `Update ${Object.keys(operation.props).join(", ")}`
          : operation.command === "remove"
            ? "Remove element"
            : operation.command === "move"
              ? "Move element"
              : "Swap elements";
      const after = operation.command === "set" ? JSON.stringify(operation.props).slice(0, 500) : operation.command === "add" ? JSON.stringify(operation.props ?? {}).slice(0, 500) : undefined;
      return { kind, locator, ...(before ? { before } : {}), ...(after ? { after } : {}), summary };
    }));
    return {
      type: "spreadsheet",
      artifactId,
      workbookName: artifact.displayName,
      affectedSheets: [...new Set(operations.map((operation) => spreadsheetSheetFromLocator(operation.command === "add" ? operation.parent : operation.path)).filter((sheet): sheet is string => Boolean(sheet)))],
      changes,
      truncated: operations.length > limited.length,
    };
  }

  async applySpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string, operations: OfficeMutation[], signal?: AbortSignal): Promise<ArtifactDescriptor> {
    if (operations.length === 0) throw new Error("At least one spreadsheet operation is required");
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    return await this.withSpreadsheetWrite(source, async () => {
      await this.stopWatch(sessionId, artifactId);
      const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
      const nextRevisionRoot = this.revisionRoot(sessionId, artifactId, artifact.revision + 1);
      const operationFile = join(nextRevisionRoot, "operations.json");
      const backup = join(nextRevisionRoot, "source-before.xlsx");
      await mkdir(nextRevisionRoot, { recursive: true });
      await copyFile(source, backup);
      const secured = await this.secureOfficeAssets(workspaceRoot, operations);
      await writeFile(operationFile, JSON.stringify(compileOfficeMutations(secured)), "utf8");
      try {
        await this.run(["batch", source, "--input", operationFile, "--stop-on-error", "--json"], { cwd: dirnameFor(source), signal, timeoutMs: 90_000 });
      } catch (cause) {
        await this.restoreSpreadsheetBackup(sessionId, artifactId, source, backup, cause);
        throw cause;
      }
      const updated = await this.updateArtifact(sessionId, artifactId, (current) => ({ ...current, revision: current.revision + 1, status: "ready", updatedAt: Date.now() }));
      await this.updateSpreadsheetState(sessionId, artifactId, (state) => ({ ...state, quality: undefined, changes: [...state.changes, { revision: updated.revision, operations: secured, updatedAt: Date.now() }].slice(-100) }));
      return updated;
    });
  }

  async renderSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string, input: { sheet: string; range?: string }): Promise<{ revision: number; images: SpreadsheetRenderedImage[]; details: ArtifactPreviewManifest }> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.waitForSpreadsheetWrite(source);
    const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
    const output = this.revisionRoot(sessionId, artifactId, artifact.revision);
    await mkdir(output, { recursive: true });
    const surfaceId = `sheet-${encodeURIComponent(input.sheet)}`;
    const file = join(output, `${surfaceId}-${input.range ? encodeURIComponent(input.range) : "used"}.png`);
    const range = input.range ? `${input.sheet}!${input.range}` : input.sheet;
    await this.run(["view", source, "screenshot", "--range", range, "-o", file], { cwd: dirnameFor(source), timeoutMs: 60_000 });
    const image: SpreadsheetRenderedImage = { surfaceId, sheet: input.sheet, ...(input.range ? { range: input.range } : {}), mimeType: "image/png", data: (await readFile(file)).toString("base64") };
    return { revision: artifact.revision, images: [image], details: await this.previewSpreadsheet(sessionId, workspaceRoot, artifactId) };
  }

  async qualityScanSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string): Promise<SpreadsheetQualityReport> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.waitForSpreadsheetWrite(source);
    const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
    const [validation, issueResult, statsResult] = await Promise.all([
      this.run(["validate", source, "--json"], { cwd: dirnameFor(source), allowFailure: true }),
      this.run(["view", source, "issues", "--json"], { cwd: dirnameFor(source), allowFailure: true }),
      this.run(["view", source, "stats", "--json"], { cwd: dirnameFor(source), allowFailure: true }),
    ]);
    const issues: SpreadsheetQualityIssue[] = [];
    const validationEnvelope = recordValue(parseJson(validation.stdout));
    if (validation.exitCode !== 0 || validationEnvelope?.success === false) issues.push({ code: "SCHEMA", category: "schema", severity: "error", message: outputText(validation) || "OfficeCLI schema validation failed." });
    const issueData = recordValue(officeCliData(parseJson(issueResult.stdout)));
    for (const value of Array.isArray(issueData?.issues) ? issueData.issues : []) {
      const item = recordValue(value);
      if (!item || typeof item.message !== "string") continue;
      const rawCode = typeof item.id === "string" ? item.id : typeof item.type === "string" ? item.type : "OFFICE";
      const code = rawCode.toUpperCase();
      const locator = typeof item.path === "string" ? item.path : undefined;
      const cacheWarning = /cache_stale|not_evaluated/i.test(rawCode);
      const category = /formula/i.test(rawCode) ? "formula" as const : /ref|definedname|chart_series/i.test(rawCode) ? "reference" as const : "structure" as const;
      const sheet = locator?.split("/").filter(Boolean)[0];
      issues.push({ code, category, severity: cacheWarning ? "warning" : "error", message: item.message, ...(locator ? { locator } : {}), ...(sheet ? { surfaceId: `sheet-${encodeURIComponent(sheet)}` } : {}), ...(cacheWarning ? { suggestion: "Open the workbook in Excel or WPS and recalculate formulas before relying on cached values." } : {}) });
    }
    const hasErrors = issues.some((issue) => issue.severity === "error");
    const report: SpreadsheetQualityReport = { revision: artifact.revision, status: hasErrors ? "needs-fix" : issues.length ? "ready-with-warnings" : "ready", issues, stats: recordValue(officeCliData(parseJson(statsResult.stdout))) ?? {}, checkedAt: Date.now() };
    await this.updateSpreadsheetState(sessionId, artifactId, (state) => ({ ...state, quality: report }));
    await this.updateArtifact(sessionId, artifactId, (current) => ({ ...current, status: hasErrors ? "failed" : "ready", updatedAt: Date.now() }));
    return report;
  }

  async publishSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string, signal?: AbortSignal): Promise<ArtifactDescriptor> {
    const report = await this.qualityScanSpreadsheet(sessionId, workspaceRoot, artifactId);
    if (report.status === "needs-fix") throw new Error(`Spreadsheet cannot be published: ${report.issues.filter((issue) => issue.severity === "error").length} blocking issue(s).`);
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    return await this.withSpreadsheetWrite(source, async () => {
      await this.stopWatch(sessionId, artifactId);
      await this.run(["save", source], { cwd: dirnameFor(source), signal, timeoutMs: 90_000 });
      return await this.updateArtifact(sessionId, artifactId, (artifact) => ({ ...artifact, status: "ready", updatedAt: Date.now() }));
    });
  }

  async previewSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string): Promise<ArtifactPreviewManifest> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.waitForSpreadsheetWrite(source);
    const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
    const outline = recordValue(officeCliData(parseJson((await this.run(["view", source, "outline", "--json"], { cwd: dirnameFor(source), allowFailure: true })).stdout)));
    const sheets = Array.isArray(outline?.sheets) ? outline.sheets : [];
    const surfaces = sheets.flatMap((value) => {
      const sheet = recordValue(value);
      if (!sheet || typeof sheet.name !== "string") return [];
      return [{ id: `sheet-${encodeURIComponent(sheet.name)}`, kind: "sheet" as const, label: sheet.name }];
    });
    const state = await this.spreadsheetState(sessionId, artifactId);
    const watchUrl = await this.ensureWatch(sessionId, artifactId, source);
    return { artifactId, revision: artifact.revision, ...(watchUrl ? { watchUrl } : {}), surfaces: surfaces.length ? surfaces : [{ id: "sheet-Sheet1", kind: "sheet", label: "Sheet1" }], issues: spreadsheetArtifactIssues(state.quality?.issues ?? []) };
  }

  async selectionSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string): Promise<SpreadsheetSelection | null> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.waitForSpreadsheetWrite(source);
    const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
    const result = await this.run(["get", source, "selected", "--json"], { cwd: dirnameFor(source), allowFailure: true });
    const normalizedSelection = normalizeSpreadsheetSelections(this.selectionLocators(officeCliData(parseJson(result.stdout))));
    if (normalizedSelection.paths.length === 0) return null;
    const primaryRange = normalizedSelection.ranges[0];
    const selected = primaryRange ? recordValue(officeCliData(parseJson((await this.run(["get", source, primaryRange.locator, "--json"], { cwd: dirnameFor(source), allowFailure: true })).stdout))) : undefined;
    const first = Array.isArray(selected?.results) ? recordValue(selected.results[0]) : undefined;
    const format = recordValue(first?.format);
    const isSingleCell = normalizedSelection.ranges.length === 1 && normalizedSelection.elements.length === 0 && primaryRange?.rowCount === 1 && primaryRange.columnCount === 1;
    const formula = isSingleCell ? typeof first?.formula === "string" ? first.formula : typeof format?.formula === "string" ? format.formula : undefined : undefined;
    const displayValue = isSingleCell ? typeof first?.text === "string" ? first.text : typeof first?.value === "string" || typeof first?.value === "number" ? String(first.value) : undefined : undefined;
    const selectionKind = normalizedSelection.ranges.length === 1 && normalizedSelection.elements.length === 0
      ? "range" as const
      : normalizedSelection.ranges.length > 0 && normalizedSelection.elements.length === 0
        ? "multi-range" as const
        : normalizedSelection.ranges.length === 0
          ? "elements" as const
          : "mixed" as const;
    const locator = primaryRange?.locator ?? normalizedSelection.elements[0]!;
    const summary = normalizedSelection.ranges.length > 1 ? `${normalizedSelection.ranges.length} ranges` : normalizedSelection.elements.length > 0 ? `${normalizedSelection.paths.length} items` : locator;
    return {
      artifactId,
      kind: "spreadsheet",
      revision: artifact.revision,
      surfaceId: `sheet-${encodeURIComponent(primaryRange?.sheetName ?? "selection")}`,
      locator,
      locators: normalizedSelection.ranges.map((range) => range.locator).concat(normalizedSelection.elements),
      label: `Selected · ${summary}`,
      selectionKind,
      ...normalizedSelection,
      ...(primaryRange && normalizedSelection.ranges.length === 1 ? { sheetName: primaryRange.sheetName, range: primaryRange.range, rowCount: primaryRange.rowCount, columnCount: primaryRange.columnCount } : {}),
      ...(displayValue ? { displayValue } : {}),
      ...(formula ? { formula } : {}),
    };
  }

  async spreadsheetChanges(sessionId: string, artifactId: string): Promise<SpreadsheetChangeRecord[]> {
    return (await this.spreadsheetState(sessionId, artifactId)).changes.slice().reverse().map((change) => ({
      revision: change.revision,
      updatedAt: change.updatedAt,
      operations: change.operations.map((operation) => ({
        command: operation.command,
        ...(operation.command === "add" ? { locator: operation.parent, ...(operation.type ? { elementType: operation.type } : {}) } : { locator: operation.path }),
      })),
    }));
  }

  async validateSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string): Promise<ArtifactIssue[]> {
    return spreadsheetArtifactIssues((await this.qualityScanSpreadsheet(sessionId, workspaceRoot, artifactId)).issues);
  }

  async sourceForSpreadsheetOpen(sessionId: string, workspaceRoot: string, artifactId: string): Promise<string> {
    return await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
  }

  async focusSpreadsheetLocator(sessionId: string, workspaceRoot: string, artifactId: string, locator: string): Promise<void> {
    // OfficeCLI watch does not expose spreadsheet cell or sheet scrolling.
    // Keep this IPC method for compatibility with older renderer builds.
    void sessionId;
    void workspaceRoot;
    void artifactId;
    void locator;
  }

  async clearSpreadsheetMarks(sessionId: string, workspaceRoot: string, artifactId: string): Promise<void> {
    const source = await this.spreadsheetSourcePath(sessionId, workspaceRoot, artifactId);
    await this.run(["watch", source, "unmark", source, "--all"], { cwd: dirnameFor(source), allowFailure: true, timeoutMs: 5_000 });
  }

  async create(sessionId: string, workspaceRoot: string, input: { name?: string; templateId?: string | null }): Promise<ArtifactDescriptor> {
    this.assertSessionId(sessionId);
    await this.requireHealthy();
    const root = resolve(workspaceRoot);
    const name = safeDeckName(input.name ?? "presentation.pptx");
    const source = await this.uniqueSourcePath(root, name);
    this.managedSources.add(source);
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
    manifest.version = 3;
    manifest.presentation ??= {};
    manifest.presentation[artifact.id] = { templateId, sources: [], renderedRevision: artifact.revision, renderedSurfaceIds: [] };
    await this.writeManifest(sessionId, manifest);
    return artifact;
  }

  async help(input: { verb?: "add" | "set" | "get" | "query" | "remove"; element?: string }): Promise<string> {
    const args = ["help", "pptx"];
    if (input.verb) args.push(input.verb);
    if (input.element) args.push(input.element);
    args.push("--json");
    return outputText(await this.run(args));
  }

  async guidance(name: string, referencePath?: string): Promise<string> {
    if (!presentationGuidanceNames.has(name)) throw new Error(`Unsupported presentation guidance: ${name}`);
    if (referencePath && (isAbsolute(referencePath) || referencePath.includes(".."))) throw new Error("Invalid OfficeCLI guidance reference path");
    const key = `${name}:${referencePath ?? ""}`;
    let pending = this.guidanceCache.get(key);
    if (!pending) {
      pending = this.run(["load_skill", name, ...(referencePath ? ["--path", referencePath] : [])], { timeoutMs: 15_000 }).then(outputText);
      this.guidanceCache.set(key, pending);
    }
    try {
      return await pending;
    } catch (cause) {
      this.guidanceCache.delete(key);
      throw cause;
    }
  }

  async inspect(sessionId: string, workspaceRoot: string, artifactId: string): Promise<string> {
    return await this.read(sessionId, workspaceRoot, artifactId, { kind: "view", mode: "outline" });
  }

  async read(sessionId: string, workspaceRoot: string, artifactId: string, request: PresentationReadRequest): Promise<string> {
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    let args: string[];
    if (request.kind === "view") {
      args = ["view", source, request.mode];
      if (request.start !== undefined) args.push("--start", String(request.start));
      if (request.end !== undefined) args.push("--end", String(request.end));
      if (request.limit !== undefined) args.push("--limit", String(request.limit));
    } else if (request.kind === "get") {
      args = ["get", source, request.path];
      if (request.depth !== undefined) args.push("--depth", String(request.depth));
    } else {
      args = ["query", source, request.selector];
      if (request.limit !== undefined) args.push("--limit", String(request.limit));
    }
    args.push("--json");
    return outputText(await this.run(args, { cwd: dirnameFor(source) }));
  }

  async apply(sessionId: string, workspaceRoot: string, artifactId: string, operations: OfficeMutation[]): Promise<ArtifactDescriptor> {
    if (operations.length === 0) throw new Error("At least one Office operation is required");
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const artifact = await this.findArtifact(sessionId, artifactId);
    const nextRevisionRoot = this.revisionRoot(sessionId, artifactId, artifact.revision + 1);
    const operationFile = join(nextRevisionRoot, "operations.json");
    await mkdir(nextRevisionRoot, { recursive: true });
    await copyFile(source, join(nextRevisionRoot, "source-before.pptx"));
    const normalized = normalizePresentationOperations(operations) as OfficeMutation[];
    const secured = await this.secureOfficeAssets(workspaceRoot, normalized);
    await writeFile(operationFile, JSON.stringify(compileOfficeMutations(secured)), "utf8");
    await this.run(["batch", source, "--input", operationFile, "--stop-on-error", "--json"], { cwd: dirnameFor(source) });
    const updated = await this.updateArtifact(sessionId, artifactId, (current) => ({ ...current, revision: current.revision + 1, status: "ready", updatedAt: Date.now() }));
    await this.updatePresentationState(sessionId, artifactId, (state) => ({ ...state, quality: undefined, renderedRevision: updated.revision, renderedSurfaceIds: [] }));
    return updated;
  }

  async validate(sessionId: string, workspaceRoot: string, artifactId: string): Promise<ArtifactIssue[]> {
    const report = await this.qualityScan(sessionId, workspaceRoot, artifactId);
    return report.issues.map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      ...(issue.locator ? { locator: issue.locator } : {}),
      code: issue.code,
      category: issue.category,
      ...(issue.surfaceId ? { surfaceId: issue.surfaceId } : {}),
      ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
    }));
  }

  async qualityScan(sessionId: string, workspaceRoot: string, artifactId: string): Promise<PresentationQualityReport> {
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const artifact = await this.findArtifact(sessionId, artifactId);
    const [validation, issueResult, textResult, statsResult, outlineResult] = await Promise.all([
      this.run(["validate", source, "--json"], { cwd: dirnameFor(source), allowFailure: true }),
      this.run(["view", source, "issues", "--json"], { cwd: dirnameFor(source), allowFailure: true }),
      this.run(["view", source, "text", "--max-lines", "5000", "--json"], { cwd: dirnameFor(source), allowFailure: true }),
      this.run(["view", source, "stats", "--json"], { cwd: dirnameFor(source), allowFailure: true }),
      this.run(["view", source, "outline", "--json"], { cwd: dirnameFor(source), allowFailure: true }),
    ]);
    const issues: PresentationQualityIssue[] = [];
    const validationEnvelope = recordValue(parseJson(validation.stdout));
    if (validation.exitCode !== 0 || validationEnvelope?.success === false) {
      issues.push({ code: "SCHEMA", category: "schema", severity: "error", message: outputText(validation) || "OfficeCLI schema validation failed." });
    }
    const issueData = recordValue(officeCliData(parseJson(issueResult.stdout)));
    for (const value of Array.isArray(issueData?.issues) ? issueData.issues : []) {
      const item = recordValue(value);
      if (!item || typeof item.message !== "string") continue;
      const code = typeof item.id === "string" ? item.id : "OFFICE";
      const locator = typeof item.path === "string" ? item.path : undefined;
      const category = code.startsWith("C") ? "content" as const : code.startsWith("S") ? "structure" as const : "format" as const;
      const suggestion = item.message.match(/suggest(?:ion)?[.:=]\s*(.+)$/i)?.[1];
      const slideNumber = slideNumberFromLocator(locator);
      issues.push({
        code,
        category,
        severity: "error",
        message: item.message,
        ...(locator ? { locator } : {}),
        ...(slideNumber ? { surfaceId: `slide-${slideNumber}` } : {}),
        ...(suggestion ? { suggestion } : {}),
      });
    }
    const extractedText = collectStrings(officeCliData(parseJson(textResult.stdout))).join("\n");
    const placeholders = [...new Set(extractedText.match(placeholderPattern) ?? [])].slice(0, 25);
    if (placeholders.length > 0) {
      issues.push({ code: "PLACEHOLDER", category: "content", severity: "error", message: `Unresolved placeholder or escaped text found: ${placeholders.join(", ")}` });
    }
    const stats = recordValue(officeCliData(parseJson(statsResult.stdout))) ?? {};
    const outline = officeCliData(parseJson(outlineResult.stdout));
    const totalSlides = this.slideCount(outline);
    const state = await this.presentationState(sessionId, artifactId);
    const previous = state.quality?.revision === artifact.revision ? state.quality : undefined;
    const visualIssues = previous?.issues.filter((issue) => issue.category === "visual") ?? [];
    const combinedIssues = [...issues, ...visualIssues];
    const reviewedSurfaceIds = previous?.reviewedSurfaceIds.filter((surfaceId) => {
      const page = Number(surfaceId.replace("slide-", ""));
      return Number.isInteger(page) && page >= 1 && page <= totalSlides;
    }) ?? [];
    const report: PresentationQualityReport = {
      revision: artifact.revision,
      status: combinedIssues.length > 0 ? "needs-fix" : reviewedSurfaceIds.length === totalSlides ? "ready" : "needs-review",
      cycle: (previous?.cycle ?? 0) + 1,
      totalSlides,
      reviewedSurfaceIds,
      issues: combinedIssues,
      stats,
      checkedAt: Date.now(),
    };
    await this.updatePresentationState(sessionId, artifactId, (current) => ({ ...current, quality: report }));
    await this.updateArtifact(sessionId, artifactId, (current) => ({ ...current, status: report.status === "needs-fix" ? "failed" : "ready", updatedAt: Date.now() }));
    return report;
  }

  async recordVisualReview(sessionId: string, artifactId: string, reviews: PresentationVisualReview[]): Promise<PresentationQualityReport> {
    const artifact = await this.findArtifact(sessionId, artifactId);
    const state = await this.presentationState(sessionId, artifactId);
    const current = state.quality;
    if (!current || current.revision !== artifact.revision) throw new Error("Run presentation_quality_scan for the current revision before recording visual review");
    const renderedSurfaceIds = new Set(state.renderedRevision === artifact.revision ? state.renderedSurfaceIds ?? [] : []);
    const reviewed = new Set(current.reviewedSurfaceIds);
    const reviewedNow = new Set(reviews.map((review) => review.surfaceId));
    const validSurfaceIds = new Set(Array.from({ length: current.totalSlides }, (_, index) => `slide-${index + 1}`));
    for (const review of reviews) {
      if (!validSurfaceIds.has(review.surfaceId)) throw new Error(`Unknown presentation surface: ${review.surfaceId}`);
      if (!renderedSurfaceIds.has(review.surfaceId)) throw new Error(`Render ${review.surfaceId} for the model before recording its visual review`);
      if (review.status === "pass" && review.findings.length > 0) throw new Error("A passing visual review cannot contain findings");
      if (review.status === "fail" && review.findings.length === 0) throw new Error("A failing visual review must describe at least one finding");
      reviewed.add(review.surfaceId);
    }
    const retainedIssues = current.issues.filter((issue) => issue.category !== "visual" || !issue.surfaceId || !reviewedNow.has(issue.surfaceId));
    const visualIssues = reviews.flatMap((review) => review.status === "pass" ? [] : review.findings.map((finding) => ({
      code: finding.code,
      category: "visual" as const,
      severity: "error" as const,
      message: finding.message,
      surfaceId: review.surfaceId,
      ...(finding.locator ? { locator: finding.locator } : {}),
    })));
    const issues = [...retainedIssues, ...visualIssues];
    const report: PresentationQualityReport = {
      ...current,
      status: issues.length > 0 ? "needs-fix" : reviewed.size === current.totalSlides ? "ready" : "needs-review",
      reviewedSurfaceIds: [...reviewed].sort((left, right) => Number(left.slice(6)) - Number(right.slice(6))),
      issues,
      checkedAt: Date.now(),
    };
    await this.updatePresentationState(sessionId, artifactId, (value) => ({ ...value, quality: report }));
    await this.updateArtifact(sessionId, artifactId, (value) => ({ ...value, status: report.status === "needs-fix" ? "failed" : "ready", updatedAt: Date.now() }));
    return report;
  }

  async registerSources(sessionId: string, artifactId: string, sources: Array<Omit<PresentationSource, "id" | "accessedAt">>): Promise<PresentationSource[]> {
    const state = await this.presentationState(sessionId, artifactId);
    const byUrl = new Map(state.sources.map((source) => [source.url, source]));
    for (const source of sources) {
      const url = new URL(source.url);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || privateNetworkHost(url.hostname)) throw new Error(`Unsafe presentation source URL: ${source.url}`);
      const existing = byUrl.get(source.url);
      byUrl.set(source.url, {
        id: existing?.id ?? randomUUID(),
        url: source.url,
        title: source.title,
        ...(source.publisher ? { publisher: source.publisher } : {}),
        slideNumbers: [...new Set(source.slideNumbers)].sort((left, right) => left - right),
        accessedAt: existing?.accessedAt ?? Date.now(),
      });
    }
    const registered = [...byUrl.values()];
    await this.updatePresentationState(sessionId, artifactId, (value) => ({ ...value, sources: registered }));
    return registered;
  }

  async publish(sessionId: string, workspaceRoot: string, artifactId: string): Promise<ArtifactDescriptor> {
    const report = await this.qualityScan(sessionId, workspaceRoot, artifactId);
    if (report.status !== "ready") {
      throw new Error(`Presentation cannot be published: quality status is ${report.status}; ${report.issues.length} blocking issue(s); ${report.reviewedSurfaceIds.length}/${report.totalSlides} slides reviewed.`);
    }
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    await this.run(["save", source], { cwd: dirnameFor(source) });
    return await this.updateArtifact(sessionId, artifactId, (artifact) => ({ ...artifact, status: "ready", updatedAt: Date.now() }));
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

  async renderForModel(sessionId: string, workspaceRoot: string, artifactId: string, pages?: number[]): Promise<{ revision: number; totalSlides: number; images: PresentationRenderedImage[]; details: ArtifactPreviewManifest }> {
    const preview = await this.preview(sessionId, workspaceRoot, artifactId, { force: true });
    const totalSlides = preview.surfaces.length;
    const selectedPages = pages?.length
      ? [...new Set(pages)]
      : Array.from({ length: Math.min(maximumModelRenderSlides, totalSlides) }, (_, index) => index + 1);
    if (selectedPages.length > maximumModelRenderSlides) throw new Error(`Render at most ${maximumModelRenderSlides} slides per model inspection call`);
    if (selectedPages.some((page) => page < 1 || page > totalSlides)) throw new Error(`Presentation page must be between 1 and ${totalSlides}`);
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const output = this.revisionRoot(sessionId, artifactId, preview.revision);
    const images: PresentationRenderedImage[] = [];
    for (const page of selectedPages) {
      const file = join(output, `slide-${page}.png`);
      if (!(await stat(file).then(() => true).catch(() => false))) {
        await this.run(["view", source, "screenshot", "--page", String(page), "-o", file], { cwd: dirnameFor(source), timeoutMs: 60_000 });
      }
      images.push({ surfaceId: `slide-${page}`, page, mimeType: "image/png", data: (await readFile(file)).toString("base64") });
    }
    await this.updatePresentationState(sessionId, artifactId, (state) => ({
      ...state,
      renderedRevision: preview.revision,
      renderedSurfaceIds: [...new Set([...(state.renderedRevision === preview.revision ? state.renderedSurfaceIds ?? [] : []), ...images.map((image) => image.surfaceId)])],
    }));
    return { revision: preview.revision, totalSlides, images, details: preview };
  }

  private async renderPreview(sessionId: string, artifactId: string, revision: number, source: string): Promise<ArtifactPreviewManifest> {
    const output = this.revisionRoot(sessionId, artifactId, revision);
    await rm(output, { force: true, recursive: true });
    await mkdir(output, { recursive: true });
    const html = join(output, "deck.html");
    await this.run(["view", source, "html", "-o", html], { cwd: dirnameFor(source) });
    const outline = officeCliData(parseJson((await this.run(["view", source, "outline", "--json"], { cwd: dirnameFor(source), allowFailure: true })).stdout));
    const totalSlides = this.slideCount(outline);
    const previewPages = Array.from({ length: Math.min(totalSlides, maximumPreviewSlides) }, (_, index) => index + 1);
    const workerCount = Math.min(maximumConcurrentPreviewRenders, previewPages.length);
    await Promise.all(Array.from({ length: workerCount }, async (_, workerIndex) => {
      for (let index = workerIndex; index < previewPages.length; index += workerCount) {
        const page = previewPages[index]!;
        await this.run(["view", source, "screenshot", "--page", String(page), "-o", join(output, `slide-${page}.png`), "--render", "html"], { cwd: dirnameFor(source), allowFailure: true, timeoutMs: 60_000 });
      }
    }));
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
    const qualityIssues = (await this.presentationState(sessionId, artifactId)).quality?.issues.map((issue) => ({
      severity: issue.severity,
      message: issue.message,
      ...(issue.locator ? { locator: issue.locator } : {}),
      code: issue.code,
      category: issue.category,
      ...(issue.surfaceId ? { surfaceId: issue.surfaceId } : {}),
      ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
    })) ?? [];
    return {
      artifactId,
      revision,
      htmlUrl: presentationAssetUrl(sessionId, artifactId, revision, "deck.html"),
      ...(watchUrl ? { watchUrl } : {}),
      surfaces: surfaces.length ? surfaces : [{ id: "slide-1", kind: "slide", label: "Slide 1" }],
      issues: qualityIssues,
    };
  }

  async selection(sessionId: string, workspaceRoot: string, artifactId: string, surfaceId = "slide-1"): Promise<ArtifactSelection | null> {
    const artifact = await this.findArtifact(sessionId, artifactId);
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    const result = await this.run(["get", source, "selected", "--json"], { cwd: dirnameFor(source), allowFailure: true });
    const payload = officeCliData(parseJson(result.stdout));
    const locators = this.selectionLocators(payload);
    if (!locators[0]) return null;
    return { artifactId, kind: "presentation", revision: artifact.revision, surfaceId, locator: locators[0], label: `Selected element · ${locators[0]}` };
  }

  async sourceForOpen(sessionId: string, workspaceRoot: string, artifactId: string): Promise<string> {
    return await this.sourcePath(sessionId, workspaceRoot, artifactId);
  }

  async advanced(sessionId: string, workspaceRoot: string, artifactId: string, operation: PresentationAdvancedOperation): Promise<string> {
    const source = await this.sourcePath(sessionId, workspaceRoot, artifactId);
    if (operation.kind === "dump") return outputText(await this.run(["dump", source, operation.path, "--json"], { cwd: dirnameFor(source) }));
    if (operation.kind === "raw-read") return outputText(await this.run(["raw", source, operation.part, "--json"], { cwd: dirnameFor(source) }));
    const artifact = await this.findArtifact(sessionId, artifactId);
    const nextRevisionRoot = this.revisionRoot(sessionId, artifactId, artifact.revision + 1);
    const backup = join(nextRevisionRoot, "source-before.pptx");
    await mkdir(nextRevisionRoot, { recursive: true });
    await copyFile(source, backup);
    try {
      if (operation.kind === "raw-update") {
        const args = ["raw-set", source, operation.part, "--xpath", operation.xpath, "--action", operation.action];
        if (operation.xml !== undefined) args.push("--xml", operation.xml);
        args.push("--json");
        await this.run(args, { cwd: dirnameFor(source) });
      } else if (operation.kind === "add-part") {
        await this.run(["add-part", source, operation.parent, "--type", operation.partType, "--json"], { cwd: dirnameFor(source) });
      } else {
        const data = JSON.stringify(operation.data);
        if (data.length > 200_000) throw new Error("Presentation merge data exceeds 200,000 characters");
        const merged = join(nextRevisionRoot, "merged.pptx");
        await this.run(["merge", source, merged, "--data", data, "--force", "--json"], { cwd: dirnameFor(source), timeoutMs: 60_000 });
        await copyFile(merged, source);
      }
      const validation = await this.run(["validate", source, "--json"], { cwd: dirnameFor(source), allowFailure: true });
      const envelope = recordValue(parseJson(validation.stdout));
      if (validation.exitCode !== 0 || envelope?.success === false) throw new Error(outputText(validation) || "Raw OfficeCLI update failed schema validation");
    } catch (cause) {
      await copyFile(backup, source);
      throw cause;
    }
    const updated = await this.updateArtifact(sessionId, artifactId, (current) => ({ ...current, revision: current.revision + 1, status: "ready", updatedAt: Date.now() }));
    await this.updatePresentationState(sessionId, artifactId, (state) => ({ ...state, quality: undefined, renderedRevision: updated.revision, renderedSurfaceIds: [] }));
    return "Advanced OfficeCLI update applied and schema validation passed. Run the full quality workflow for the new revision.";
  }

  async dispose(): Promise<void> {
    const watchClosures = [...this.watches.values()].map(async (watch) => {
      if (watch.child.exitCode !== null || watch.child.killed) return;
      await new Promise<void>((resolvePromise) => {
        const timeout = setTimeout(resolvePromise, 2_000);
        watch.child.once("close", () => { clearTimeout(timeout); resolvePromise(); });
        watch.child.kill();
      });
    });
    await Promise.all(watchClosures);
    this.watches.clear();
    await Promise.all([...this.managedSources].map(async (source) => {
      await this.run(["close", source], { cwd: dirnameFor(source), allowFailure: true, timeoutMs: 5_000 }).catch(() => undefined);
    }));
    this.managedSources.clear();
  }

  async releaseSession(sessionId: string, workspaceRoot: string): Promise<void> {
    this.assertSessionId(sessionId);
    const root = resolve(workspaceRoot);
    const manifest = await this.readManifest(sessionId);
    const watchedArtifactIds = [...this.watches.keys()]
      .flatMap((key) => key.startsWith(`${sessionId}:`) ? [key.slice(sessionId.length + 1)] : []);
    const artifactIds = [...new Set([...manifest.artifacts.map((artifact) => artifact.id), ...watchedArtifactIds])];
    await Promise.all(artifactIds.map(async (artifactId) => await this.stopWatch(sessionId, artifactId)));
    await Promise.all(manifest.artifacts.map(async (artifact) => {
      const source = resolve(root, artifact.sourcePath);
      if (!isWithin(root, source)) return;
      this.managedSources.delete(source);
      this.spreadsheetWriteLocks.delete(source);
      await this.run(["close", source], { cwd: dirnameFor(source), allowFailure: true, timeoutMs: 5_000 }).catch(() => undefined);
    }));
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

  private async run(args: string[], options: RunOptions = {}): Promise<RunResult> {
    if (options.signal?.aborted) throw new OfficeCliExecutionError("OFFICECLI_CANCELLED", "OfficeCLI operation was cancelled before it started");
    const binary = this.binaryPath();
    const result = await new Promise<RunResult>((resolvePromise, reject) => {
      const child = spawn(binary, args, { cwd: options.cwd, env: { ...process.env, OFFICECLI_SKIP_UPDATE: "1" }, stdio: "pipe", windowsHide: true });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let termination: "cancelled" | "timeout" | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      let terminationTimer: ReturnType<typeof setTimeout> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const limit = 2_000_000;
      const append = (current: string, chunk: Buffer) => (current.length >= limit ? current : `${current}${chunk.toString("utf8")}`.slice(0, limit));
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (forceTimer) clearTimeout(forceTimer);
        if (terminationTimer) clearTimeout(terminationTimer);
        options.signal?.removeEventListener("abort", abort);
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const terminate = (reason: "cancelled" | "timeout") => {
        if (termination || settled) return;
        termination = reason;
        if (process.platform === "win32" && child.pid !== undefined) {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          killer.once("error", () => child.kill());
        } else {
          child.kill("SIGTERM");
          forceTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          }, 2_000);
        }
        terminationTimer = setTimeout(() => rejectOnce(new OfficeCliExecutionError(
          "OFFICECLI_TERMINATION_FAILED",
          `OfficeCLI did not terminate after the operation ${reason === "timeout" ? "timed out" : "was cancelled"}`,
        )), 5_000);
      };
      const abort = () => terminate("cancelled");
      options.signal?.addEventListener("abort", abort, { once: true });
      timeout = setTimeout(() => terminate("timeout"), options.timeoutMs ?? 45_000);
      if (options.signal?.aborted) abort();
      child.once("error", (error) => rejectOnce(error));
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (termination === "timeout") {
          reject(new OfficeCliExecutionError("OFFICECLI_TIMEOUT", `OfficeCLI operation timed out after ${options.timeoutMs ?? 45_000}ms`));
          return;
        }
        if (termination === "cancelled") {
          reject(new OfficeCliExecutionError("OFFICECLI_CANCELLED", "OfficeCLI operation was cancelled"));
          return;
        }
        if (code === 0 || options.allowFailure) resolvePromise({ stdout, stderr, exitCode: code });
        else reject(new OfficeCliExecutionError("OFFICECLI_EXIT_FAILED", (stderr || stdout || `OfficeCLI exited with ${code}`).trim()));
      });
    });
    return result;
  }

  private async withSpreadsheetWrite<T>(source: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.spreadsheetWriteLocks.get(source) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    this.spreadsheetWriteLocks.set(source, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.spreadsheetWriteLocks.get(source) === current) this.spreadsheetWriteLocks.delete(source);
    }
  }

  private async waitForSpreadsheetWrite(source: string): Promise<void> {
    await this.spreadsheetWriteLocks.get(source)?.catch(() => undefined);
  }

  private async restoreSpreadsheetBackup(sessionId: string, artifactId: string, source: string, backup: string, cause: unknown): Promise<void> {
    if (cause instanceof OfficeCliExecutionError && cause.code === "OFFICECLI_TERMINATION_FAILED") {
      await this.updateArtifact(sessionId, artifactId, (artifact) => ({ ...artifact, status: "failed", updatedAt: Date.now() }));
      return;
    }
    await copyFile(backup, source);
  }

  private async stopWatch(sessionId: string, artifactId: string): Promise<void> {
    const key = `${sessionId}:${artifactId}`;
    const watch = this.watches.get(key);
    if (!watch) return;
    this.watches.delete(key);
    if (watch.child.exitCode !== null || watch.child.signalCode !== null || watch.child.killed) return;
    await new Promise<void>((resolvePromise) => {
      const timeout = setTimeout(resolvePromise, 2_000);
      watch.child.once("close", () => {
        clearTimeout(timeout);
        resolvePromise();
      });
      if (process.platform === "win32" && watch.child.pid !== undefined) {
        const killer = spawn("taskkill", ["/PID", String(watch.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        killer.once("error", () => watch.child.kill());
      } else {
        watch.child.kill();
      }
    });
  }

  private async ensureWatch(sessionId: string, artifactId: string, source: string): Promise<string | null> {
    const key = `${sessionId}:${artifactId}`;
    const existing = this.watches.get(key);
    if (existing) {
      const running = existing.child.exitCode === null && existing.child.signalCode === null && !existing.child.killed;
      if (running && existing.url) return existing.url;
      this.watches.delete(key);
      if (running) existing.child.kill();
    }
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

  private async readManifest(sessionId: string): Promise<OfficeManifest> {
    this.assertSessionId(sessionId);
    try {
      const value = parseJson(await readFile(this.manifestPath(sessionId), "utf8"));
      if (!value || typeof value !== "object" || !Array.isArray((value as OfficeManifest).artifacts)) return { version: 3, artifacts: [], presentation: {}, spreadsheet: {} };
      return value as OfficeManifest;
    } catch {
      return { version: 3, artifacts: [], presentation: {}, spreadsheet: {} };
    }
  }

  private async writeManifest(sessionId: string, manifest: OfficeManifest): Promise<void> {
    const path = this.manifestPath(sessionId);
    await mkdir(dirnameFor(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
    await rename(temporary, path);
  }

  private async updateArtifact(sessionId: string, artifactId: string, update: (artifact: ArtifactDescriptor) => ArtifactDescriptor): Promise<ArtifactDescriptor> {
    const manifest = await this.readManifest(sessionId);
    const index = manifest.artifacts.findIndex((artifact) => artifact.id === artifactId);
    if (index < 0) throw new Error("Office artifact was not found");
    const next = update(manifest.artifacts[index]!);
    manifest.artifacts[index] = next;
    await this.writeManifest(sessionId, manifest);
    return next;
  }

  private async presentationState(sessionId: string, artifactId: string): Promise<PresentationArtifactState> {
    await this.findArtifact(sessionId, artifactId);
    const manifest = await this.readManifest(sessionId);
    return manifest.presentation?.[artifactId] ?? { templateId: "unknown", sources: [] };
  }

  private async updatePresentationState(sessionId: string, artifactId: string, update: (state: PresentationArtifactState) => PresentationArtifactState): Promise<PresentationArtifactState> {
    const manifest = await this.readManifest(sessionId);
    if (!manifest.artifacts.some((artifact) => artifact.id === artifactId)) throw new Error("Presentation artifact was not found");
    manifest.version = 3;
    manifest.presentation ??= {};
    const next = update(manifest.presentation[artifactId] ?? { templateId: "unknown", sources: [] });
    manifest.presentation[artifactId] = next;
    await this.writeManifest(sessionId, manifest);
    return next;
  }

  private async registerSpreadsheetArtifact(sessionId: string, workspaceRoot: string, source: string): Promise<ArtifactDescriptor> {
    const artifact: ArtifactDescriptor = {
      id: randomUUID(),
      sessionId,
      kind: "spreadsheet",
      sourcePath: relative(workspaceRoot, source).replace(/\\/g, "/"),
      displayName: basename(source),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      revision: 1,
      status: "ready",
      capabilities: ["preview", "select", "validate", "export", "open"],
      updatedAt: Date.now(),
    };
    const manifest = await this.readManifest(sessionId);
    manifest.version = 3;
    manifest.artifacts.unshift(artifact);
    manifest.spreadsheet ??= {};
    manifest.spreadsheet[artifact.id] = { changes: [] };
    await this.writeManifest(sessionId, manifest);
    return artifact;
  }

  private async spreadsheetState(sessionId: string, artifactId: string): Promise<SpreadsheetArtifactState> {
    await this.findSpreadsheetArtifact(sessionId, artifactId);
    const manifest = await this.readManifest(sessionId);
    return manifest.spreadsheet?.[artifactId] ?? { changes: [] };
  }

  private async updateSpreadsheetState(sessionId: string, artifactId: string, update: (state: SpreadsheetArtifactState) => SpreadsheetArtifactState): Promise<SpreadsheetArtifactState> {
    const manifest = await this.readManifest(sessionId);
    if (!manifest.artifacts.some((artifact) => artifact.id === artifactId && artifact.kind === "spreadsheet")) throw new Error("Spreadsheet artifact was not found");
    manifest.version = 3;
    manifest.spreadsheet ??= {};
    const next = update(manifest.spreadsheet[artifactId] ?? { changes: [] });
    manifest.spreadsheet[artifactId] = next;
    await this.writeManifest(sessionId, manifest);
    return next;
  }

  private async findSpreadsheetArtifact(sessionId: string, artifactId: string): Promise<ArtifactDescriptor> {
    if (!artifactIdPattern.test(artifactId)) throw new Error("Invalid spreadsheet artifact");
    const artifact = (await this.readManifest(sessionId)).artifacts.find((candidate) => candidate.id === artifactId && candidate.kind === "spreadsheet");
    if (!artifact) throw new Error("Spreadsheet artifact was not found");
    return artifact;
  }

  private async spreadsheetSourcePath(sessionId: string, workspaceRoot: string, artifactId: string): Promise<string> {
    const artifact = await this.findSpreadsheetArtifact(sessionId, artifactId);
    const root = resolve(workspaceRoot);
    const source = resolve(root, artifact.sourcePath);
    if (!isWithin(root, source) || extname(source).toLowerCase() !== ".xlsx") throw new Error("Spreadsheet artifact path is invalid");
    await stat(source);
    this.managedSources.add(source);
    return source;
  }

  private async uniqueSpreadsheetSourcePath(root: string, name: string): Promise<string> {
    const base = resolve(root, name);
    if (!isWithin(root, base)) throw new Error("Spreadsheet path must remain inside the workspace");
    let next = base;
    let index = 2;
    while (await stat(next).then(() => true).catch(() => false)) {
      next = join(dirnameFor(base), `${basename(base, ".xlsx")} ${index}.xlsx`);
      index += 1;
    }
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
    this.managedSources.add(source);
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

  private async secureOfficeAssets(workspaceRoot: string, operations: OfficeMutation[]): Promise<OfficeMutation[]> {
    const root = await realpath(resolve(workspaceRoot));
    const secureProps = async (props: Record<string, unknown> | undefined): Promise<Record<string, unknown> | undefined> => {
      if (!props) return undefined;
      const secured: Record<string, unknown> = { ...props };
      for (const key of ["src", "preview"]) {
        const value = secured[key];
        if (typeof value !== "string") continue;
        if (value.startsWith("data:")) {
          if (value.length > 14_000_000) throw new Error(`Office asset ${key} data URI is too large`);
          continue;
        }
        if (/^https?:\/\//i.test(value)) {
          const url = new URL(value);
          if (url.protocol !== "https:" || privateNetworkHost(url.hostname)) throw new Error(`Unsafe Office asset URL: ${value}`);
          continue;
        }
        const candidate = await realpath(isAbsolute(value) ? value : resolve(root, value)).catch(() => undefined);
        if (!candidate || !isWithin(root, candidate)) throw new Error(`Office asset ${key} must resolve inside the workspace: ${value}`);
        secured[key] = candidate;
      }
      return secured;
    };
    const secured: OfficeMutation[] = [];
    for (const operation of operations) {
      if (operation.command === "add") secured.push({ ...operation, props: await secureProps(operation.props) });
      else if (operation.command === "set") secured.push({ ...operation, props: (await secureProps(operation.props)) ?? {} });
      else if (operation.command === "remove") secured.push({ ...operation, props: await secureProps(operation.props) });
      else secured.push(operation);
    }
    return secured;
  }

  private templatePath(templateId: string): string {
    const fileNames: Record<string, string> = {
      "aura-coffee": "aura-coffee.pptx",
      "aura-coffee-dark": "aura-coffee-dark.pptx",
      "future-2050": "future-2050.pptx",
      "cat-philosophy": "cat-philosophy.pptx",
      "cat-secret-life": "cat-secret-life.pptx",
      "feline-report": "feline-report.pptx",
      "aionui-promo": "aionui-promo.pptx",
      "geminicli-timetravel": "geminicli-timetravel.pptx",
      "attention-budget": "attention-budget.pptx",
      "alien-guide": "alien-guide.pptx",
      "mars-settlement": "mars-settlement.pptx",
      "space-exploration": "space-exploration.pptx",
      "time-travel": "time-travel.pptx",
      "wildlife-company": "wildlife-company.pptx",
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
