export type OfficeDocumentFormat = "pptx" | "docx" | "xlsx";

export type OfficeViewMode = "outline" | "stats" | "issues" | "text" | "annotated";

export type OfficeMutation =
  | { command: "add"; parent: string; type?: string; from?: string; props?: Record<string, unknown> }
  | { command: "set"; path: string; props: Record<string, unknown> }
  | { command: "remove"; path: string; props?: Record<string, unknown> }
  | { command: "move"; path: string; to?: string; after?: string; before?: string }
  | { command: "swap"; path: string; path2: string };

export type PresentationReadRequest =
  | { kind: "view"; mode: OfficeViewMode; start?: number; end?: number; limit?: number }
  | { kind: "get"; path: string; depth?: number }
  | { kind: "query"; selector: string; limit?: number };

export interface PresentationRenderedImage {
  surfaceId: string;
  page: number;
  mimeType: "image/png";
  data: string;
}

export type PresentationIssueCategory = "schema" | "format" | "content" | "structure" | "visual";

export interface PresentationQualityIssue {
  code: string;
  category: PresentationIssueCategory;
  severity: "warning" | "error";
  message: string;
  locator?: string;
  surfaceId?: string;
  suggestion?: string;
}

export interface PresentationVisualReview {
  surfaceId: string;
  status: "pass" | "fail";
  findings: Array<{ code: string; message: string; locator?: string }>;
}

export interface PresentationQualityReport {
  revision: number;
  status: "draft" | "needs-review" | "needs-fix" | "ready";
  cycle: number;
  totalSlides: number;
  reviewedSurfaceIds: string[];
  issues: PresentationQualityIssue[];
  stats: Record<string, unknown>;
  checkedAt: number;
}

export interface PresentationSource {
  id: string;
  url: string;
  title: string;
  publisher?: string;
  slideNumbers: number[];
  accessedAt: number;
}

export interface PresentationCatalog {
  artifacts: unknown[];
  templates: unknown[];
  guidance: string[];
}

export type SpreadsheetReadRequest =
  | { kind: "view"; mode: "outline" | "stats" | "issues" | "text" | "annotated"; sheet?: string; range?: string; start?: number; end?: number; limit?: number }
  | { kind: "get"; path: string; depth?: number }
  | { kind: "query"; selector: string; limit?: number };

export interface SpreadsheetRenderedImage {
  surfaceId: string;
  sheet: string;
  range?: string;
  mimeType: "image/png";
  data: string;
}

export interface SpreadsheetQualityIssue {
  code: string;
  category: "schema" | "formula" | "reference" | "structure" | "format";
  severity: "warning" | "error";
  message: string;
  locator?: string;
  surfaceId?: string;
  suggestion?: string;
}

export interface SpreadsheetQualityReport {
  revision: number;
  status: "needs-fix" | "ready-with-warnings" | "ready";
  issues: SpreadsheetQualityIssue[];
  stats: Record<string, unknown>;
  checkedAt: number;
}

export interface SpreadsheetCatalog {
  artifacts: unknown[];
}

export interface SpreadsheetOfficeService {
  catalogSpreadsheets(sessionId: string): Promise<SpreadsheetCatalog>;
  createSpreadsheet(sessionId: string, workspaceRoot: string, input: { name?: string; locale?: string }): Promise<unknown>;
  openSpreadsheet(sessionId: string, workspaceRoot: string, input: { sourcePath: string }): Promise<unknown>;
  importSpreadsheetData(sessionId: string, workspaceRoot: string, artifactId: string, input: { sourcePath: string; sheet?: string; startCell?: string; header?: boolean }): Promise<unknown>;
  helpSpreadsheet(input: { verb?: "add" | "set" | "get" | "query" | "remove"; element?: string }): Promise<string>;
  readSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string, request: SpreadsheetReadRequest): Promise<string>;
  applySpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string, operations: OfficeMutation[]): Promise<unknown>;
  renderSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string, input: { sheet: string; range?: string }): Promise<{ revision: number; images: SpreadsheetRenderedImage[]; details: unknown }>;
  qualityScanSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string): Promise<SpreadsheetQualityReport>;
  publishSpreadsheet(sessionId: string, workspaceRoot: string, artifactId: string): Promise<unknown>;
}

export interface PresentationOfficeService {
  catalog(sessionId: string): Promise<PresentationCatalog>;
  create(sessionId: string, workspaceRoot: string, input: { name?: string; templateId?: string | null }): Promise<unknown>;
  help(input: { verb?: "add" | "set" | "get" | "query" | "remove"; element?: string }): Promise<string>;
  guidance(name: string, referencePath?: string): Promise<string>;
  read(sessionId: string, workspaceRoot: string, artifactId: string, request: PresentationReadRequest): Promise<string>;
  apply(sessionId: string, workspaceRoot: string, artifactId: string, operations: OfficeMutation[]): Promise<unknown>;
  renderForModel(sessionId: string, workspaceRoot: string, artifactId: string, pages?: number[]): Promise<{ revision: number; totalSlides: number; images: PresentationRenderedImage[]; details: unknown }>;
  qualityScan(sessionId: string, workspaceRoot: string, artifactId: string): Promise<PresentationQualityReport>;
  recordVisualReview(sessionId: string, artifactId: string, reviews: PresentationVisualReview[]): Promise<PresentationQualityReport>;
  registerSources(sessionId: string, artifactId: string, sources: Array<Omit<PresentationSource, "id" | "accessedAt">>): Promise<PresentationSource[]>;
  publish(sessionId: string, workspaceRoot: string, artifactId: string): Promise<unknown>;
  advanced(sessionId: string, workspaceRoot: string, artifactId: string, operation: PresentationAdvancedOperation): Promise<string>;
}

export type PresentationAdvancedOperation =
  | { kind: "dump"; path: string }
  | { kind: "raw-read"; part: string }
  | { kind: "raw-update"; part: string; xpath: string; action: "append" | "prepend" | "insertbefore" | "insertafter" | "replace" | "remove" | "setattr"; xml?: string }
  | { kind: "add-part"; parent: string; partType: "chart" }
  | { kind: "merge-template"; data: Record<string, unknown> };

function normalizeTextValue(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\r\n|\r/g, "\n").replace(/(^|[^\\])\\n/g, "$1\n");
  if (Array.isArray(value)) return value.map(normalizeTextValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeTextValue(item)]));
}

export function compileOfficeMutations(operations: readonly OfficeMutation[]): Record<string, unknown>[] {
  return operations.map((operation) => {
    if (operation.command === "add") {
      if (!operation.type && !operation.from) throw new Error("Office add requires type or from");
      return {
        command: operation.command,
        parent: operation.parent,
        ...(operation.type ? { type: operation.type } : {}),
        ...(operation.from ? { from: operation.from } : {}),
        ...(operation.props ? { props: normalizeTextValue(operation.props) } : {}),
      };
    }
    if (operation.command === "set") return { ...operation, props: normalizeTextValue(operation.props) };
    if (operation.command === "remove") return { ...operation, ...(operation.props ? { props: normalizeTextValue(operation.props) } : {}) };
    if (operation.command === "move") {
      if (!operation.to && !operation.after && !operation.before) throw new Error("Office move requires to, after, or before");
      return { ...operation };
    }
    return { ...operation };
  });
}
