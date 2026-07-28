import type { AgentTool } from "@wordless/agent";
import { createAgentHarnessDriver } from "@wordless/agent-driver-generic";
import type { AgentDriver, AgentDriverSessionContext, OperationPreflightDecision } from "@wordless/agent-driver-sdk";
import type { OfficeMutation, SpreadsheetOfficeService, SpreadsheetQualityReport, SpreadsheetReadRequest } from "@wordless/capability-office";
import { Type } from "typebox";

const PathSchema = Type.String({ minLength: 1, maxLength: 2_048 });
const PropsSchema = Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Unknown());
const MutationSchema = Type.Union([
  Type.Object({ command: Type.Literal("add"), parent: PathSchema, type: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), from: Type.Optional(PathSchema), props: Type.Optional(PropsSchema) }),
  Type.Object({ command: Type.Literal("set"), path: PathSchema, props: PropsSchema }),
  Type.Object({ command: Type.Literal("remove"), path: PathSchema, props: Type.Optional(PropsSchema) }),
  Type.Object({ command: Type.Literal("move"), path: PathSchema, to: Type.Optional(PathSchema), after: Type.Optional(PathSchema), before: Type.Optional(PathSchema) }),
  Type.Object({ command: Type.Literal("swap"), path: PathSchema, path2: PathSchema }),
]);
const ReadSchema = Type.Union([
  Type.Object({ kind: Type.Literal("view"), mode: Type.Union([Type.Literal("outline"), Type.Literal("stats"), Type.Literal("issues"), Type.Literal("text"), Type.Literal("annotated")]), sheet: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), range: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })), start: Type.Optional(Type.Integer({ minimum: 1 })), end: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })) }),
  Type.Object({ kind: Type.Literal("get"), path: PathSchema, depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })) }),
  Type.Object({ kind: Type.Literal("query"), selector: Type.String({ minLength: 1, maxLength: 4_096 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000 })) }),
]);

function text(value: string) {
  return [{ type: "text" as const, text: value }];
}

function artifactText(prefix: string, value: unknown): string {
  if (!value || typeof value !== "object") return prefix;
  const artifact = value as Record<string, unknown>;
  const name = typeof artifact.displayName === "string" ? artifact.displayName : "workbook";
  const id = typeof artifact.id === "string" ? artifact.id : "";
  return `${prefix} ${name}${id ? `. Artifact ID: ${id}` : ""}`;
}

function qualityText(report: SpreadsheetQualityReport): string {
  const summary = `Workbook quality ${report.status}; revision ${report.revision}; ${report.issues.length} issue(s).`;
  if (report.issues.length === 0) return summary;
  return `${summary}\n${report.issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}${issue.locator ? ` (${issue.locator})` : ""}`).join("\n")}`;
}

async function preflightSpreadsheetOperation(context: AgentDriverSessionContext, request: { toolName: string; input: Record<string, unknown> }): Promise<OperationPreflightDecision> {
  const writesWorkbook = request.toolName === "spreadsheet_create" || request.toolName === "spreadsheet_import" || request.toolName === "spreadsheet_edit";
  if (!writesWorkbook || context.record.accessLevel === "full") return { type: "allow" };
  const path = typeof request.input.name === "string" ? request.input.name : typeof request.input.sourcePath === "string" ? request.input.sourcePath : "spreadsheet artifact";
  return {
    type: "approval",
    approval: {
      risk: "file-write",
      severity: "normal",
      matchedRules: [],
      summary: "This operation will create or modify a spreadsheet in the session workspace.",
      preview: { type: "diff", path, before: request.toolName === "spreadsheet_create" ? "" : "Current workbook", after: "Workbook updated through an atomic OfficeCLI operation", truncated: false },
    },
  };
}

function createTools(office: SpreadsheetOfficeService, context: AgentDriverSessionContext): AgentTool[] {
  return [
    {
      name: "spreadsheet_catalog",
      label: "Spreadsheet catalog",
      description: "List spreadsheet artifacts already registered in this session. Call this before creating a duplicate workbook.",
      parameters: Type.Object({}),
      async execute() {
        const catalog = await office.catalogSpreadsheets(context.record.id);
        return { content: text(JSON.stringify(catalog, null, 2).slice(0, 24_000)), details: catalog };
      },
    },
    {
      name: "spreadsheet_create",
      label: "Create workbook",
      description: "Create a blank XLSX in the session workspace. Use spreadsheet_edit to add sheets, values, formulas, tables, charts, and formatting.",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), locale: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })) }),
      async execute(_id, input) {
        const artifact = await office.createSpreadsheet(context.record.id, context.record.runtimeRootPath, input as { name: string; locale?: string });
        return { content: text(artifactText("Created", artifact)), details: { artifact } };
      },
    },
    {
      name: "spreadsheet_open",
      label: "Open workbook",
      description: "Register an existing XLSX from the session workspace. The path must be relative to the session workspace and end in .xlsx.",
      parameters: Type.Object({ sourcePath: PathSchema }),
      async execute(_id, input) {
        const artifact = await office.openSpreadsheet(context.record.id, context.record.runtimeRootPath, input as { sourcePath: string });
        return { content: text(artifactText("Opened", artifact)), details: { artifact } };
      },
    },
    {
      name: "spreadsheet_import",
      label: "Import tabular data",
      description: "Import a CSV or TSV file from the session workspace into an existing workbook sheet.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), sourcePath: PathSchema, sheet: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), startCell: Type.Optional(Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]*$" })), header: Type.Optional(Type.Boolean()) }),
      async execute(_id, input) {
        const request = input as { artifactId: string; sourcePath: string; sheet?: string; startCell?: string; header?: boolean };
        const artifact = await office.importSpreadsheetData(context.record.id, context.record.runtimeRootPath, request.artifactId, request);
        return { content: text(artifactText("Imported data into", artifact)), details: { artifact } };
      },
    },
    {
      name: "spreadsheet_help",
      label: "Spreadsheet schema",
      description: "Read the authoritative XLSX schema from the installed OfficeCLI version before using unfamiliar elements or properties.",
      parameters: Type.Object({ verb: Type.Optional(Type.Union([Type.Literal("add"), Type.Literal("set"), Type.Literal("get"), Type.Literal("query"), Type.Literal("remove")])), element: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }),
      async execute(_id, input) {
        const output = await office.helpSpreadsheet(input as { verb?: "add" | "set" | "get" | "query" | "remove"; element?: string });
        return { content: text(output.slice(0, 50_000)), details: input };
      },
    },
    {
      name: "spreadsheet_read",
      label: "Inspect workbook",
      description: "Inspect workbook structure, a targeted sheet or range, formulas, tables, charts, statistics, or issues. Prefer narrow ranges for large workbooks.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), request: ReadSchema }),
      async execute(_id, input) {
        const request = input as { artifactId: string; request: SpreadsheetReadRequest };
        const output = await office.readSpreadsheet(context.record.id, context.record.runtimeRootPath, request.artifactId, request.request);
        return { content: text(output.slice(0, 50_000)), details: request };
      },
    },
    {
      name: "spreadsheet_edit",
      label: "Edit workbook",
      description: "Apply one atomic OfficeCLI batch. All operations roll back if any item fails. Use spreadsheet_help instead of guessing properties.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), operations: Type.Array(MutationSchema, { minItems: 1, maxItems: 250 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string; operations: OfficeMutation[] };
        const artifact = await office.applySpreadsheet(context.record.id, context.record.runtimeRootPath, request.artifactId, request.operations);
        return { content: text(`${artifactText("Updated", artifact)}. Inspect affected ranges and run spreadsheet_quality_scan.`), details: { artifact, operationCount: request.operations.length } };
      },
    },
    {
      name: "spreadsheet_render",
      label: "Render workbook range",
      description: "Render one sheet or range as PNG for visual inspection. Use a bounded range when the sheet is large.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), sheet: Type.String({ minLength: 1, maxLength: 128 }), range: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })) }),
      async execute(_id, input) {
        const request = input as { artifactId: string; sheet: string; range?: string };
        const rendered = await office.renderSpreadsheet(context.record.id, context.record.runtimeRootPath, request.artifactId, request);
        return { content: [...text(`Rendered ${request.sheet}${request.range ? `!${request.range}` : ""} at revision ${rendered.revision}.`), ...rendered.images.map((image) => ({ type: "image" as const, mimeType: image.mimeType, data: image.data }))], details: rendered.details };
      },
    },
    {
      name: "spreadsheet_quality_scan",
      label: "Check workbook",
      description: "Run OpenXML validation and detect broken formulas, missing references, stale caches, and workbook structure issues.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string };
        const report = await office.qualityScanSpreadsheet(context.record.id, context.record.runtimeRootPath, request.artifactId);
        return { content: text(qualityText(report)), details: { artifactId: request.artifactId, quality: report } };
      },
    },
    {
      name: "spreadsheet_publish",
      label: "Publish workbook",
      description: "Save the current XLSX after quality checks. Blocking schema, formula, or reference errors prevent publishing; stale formula caches are published with an explicit warning.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string };
        const artifact = await office.publishSpreadsheet(context.record.id, context.record.runtimeRootPath, request.artifactId);
        return { content: text(artifactText("Published", artifact)), details: { artifact } };
      },
    },
  ];
}

export function createSpreadsheetAgentDriver(office: SpreadsheetOfficeService): AgentDriver {
  return createAgentHarnessDriver({
    id: "spreadsheet",
    features: ["steer", "follow-up", "thinking", "compact", "artifacts", "approval", "user-request"],
    createTools: (context) => createTools(office, context),
    preflightOperation: preflightSpreadsheetOperation,
  });
}
