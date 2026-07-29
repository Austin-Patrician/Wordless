import type { AgentTool } from "@wordless/agent";
import { createAgentHarnessDriver } from "@wordless/agent-driver-generic";
import type { AgentDriver, AgentDriverSessionContext, OperationPreflightDecision } from "@wordless/agent-driver-sdk";
import { SPREADSHEET_HIGH_LEVEL_TOOLS, type OfficeMutation, type SpreadsheetOfficeService, type SpreadsheetQualityReport, type SpreadsheetReadRequest } from "@wordless/capability-office";
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
const ArtifactSheetRangeSchema = Type.Object({
  artifactId: Type.String({ minLength: 1 }),
  sheet: Type.String({ minLength: 1, maxLength: 128 }),
  range: Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]*(?::[A-Z]{1,3}[1-9][0-9]*)?$" }),
});
const FormatSchema = Type.Intersect([ArtifactSheetRangeSchema, Type.Object({
  fontName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  fontSize: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  bold: Type.Optional(Type.Boolean()),
  italic: Type.Optional(Type.Boolean()),
  fontColor: Type.Optional(Type.String({ minLength: 3, maxLength: 32 })),
  fill: Type.Optional(Type.String({ minLength: 3, maxLength: 64 })),
  numberFormat: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  horizontalAlignment: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right"), Type.Literal("general")])),
  wrapText: Type.Optional(Type.Boolean()),
  border: Type.Optional(Type.Union([Type.Literal("thin"), Type.Literal("medium"), Type.Literal("thick"), Type.Literal("double"), Type.Literal("none")])),
})]);
const TableSchema = Type.Intersect([ArtifactSheetRangeSchema, Type.Object({ name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), style: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), totalRow: Type.Optional(Type.Boolean()) })]);
const ChartSeriesSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  values: Type.String({ minLength: 1, maxLength: 2_048, description: "A sheet-qualified cell range or comma-separated numeric values." }),
  categories: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048, description: "A sheet-qualified category range." })),
  color: Type.Optional(Type.String({ minLength: 3, maxLength: 64 })),
});
const ChartSchema = Type.Object({
  artifactId: Type.String({ minLength: 1 }), sheet: Type.String({ minLength: 1, maxLength: 128 }), dataRange: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "One contiguous chart source in A1 notation, preferably sheet-qualified, for example Summary!A1:D20. Omit when explicit series are supplied." })),
  categories: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048, description: "Category labels as a sheet-qualified range or comma-separated labels." })),
  series: Type.Optional(Type.Array(ChartSeriesSchema, { minItems: 1, maxItems: 32, description: "Explicit chart series for non-contiguous selections." })),
  chartType: Type.String({ minLength: 1, maxLength: 64 }), title: Type.Optional(Type.String({ maxLength: 256 })), anchor: Type.Optional(Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]*$" })),
  width: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })), height: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })), legend: Type.Optional(Type.Boolean()),
});
const PivotSchema = Type.Object({
  artifactId: Type.String({ minLength: 1 }), sheet: Type.String({ minLength: 1, maxLength: 128 }), source: Type.String({ minLength: 1, maxLength: 256, description: "Selected pivot source in sheet-qualified A1 notation, for example Data!A1:H500." }), position: Type.Optional(Type.String({ pattern: "^[A-Z]{1,3}[1-9][0-9]*$" })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), rows: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 16 })), columns: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 16 })),
  filters: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 16 })), values: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 16 }), layout: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("outline"), Type.Literal("tabular")])), style: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
const ValidationSchema = Type.Intersect([ArtifactSheetRangeSchema, Type.Object({ type: Type.String({ minLength: 1, maxLength: 64 }), operator: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })), formula1: Type.Optional(Type.String({ maxLength: 1_024 })), formula2: Type.Optional(Type.String({ maxLength: 1_024 })), allowBlank: Type.Optional(Type.Boolean()), prompt: Type.Optional(Type.String({ maxLength: 256 })), error: Type.Optional(Type.String({ maxLength: 256 })) })]);
const ConditionalFormattingSchema = Type.Intersect([ArtifactSheetRangeSchema, Type.Object({ type: Type.String({ minLength: 1, maxLength: 64 }), operator: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })), value: Type.Optional(Type.String({ maxLength: 512 })), value2: Type.Optional(Type.String({ maxLength: 512 })), formula: Type.Optional(Type.String({ maxLength: 1_024 })), fill: Type.Optional(Type.String({ minLength: 3, maxLength: 64 })), color: Type.Optional(Type.String({ minLength: 3, maxLength: 64 })), iconSet: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })) })]);
const SortFilterSchema = Type.Intersect([ArtifactSheetRangeSchema, Type.Object({ sort: Type.String({ minLength: 1, maxLength: 128 }), header: Type.Optional(Type.Boolean()), filterColumn: Type.Optional(Type.Integer({ minimum: 0, maximum: 16_383 })), filter: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })) })]);

function definedProperties(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined));
}

export function compileSpreadsheetToolOperations(toolName: string, input: Record<string, unknown>): OfficeMutation[] | undefined {
  const sheet = typeof input.sheet === "string" ? input.sheet : undefined;
  const range = typeof input.range === "string" ? input.range : undefined;
  if (toolName === "spreadsheet_edit" && Array.isArray(input.operations)) return input.operations as OfficeMutation[];
  if (toolName === "spreadsheet_format_range" && sheet && range) return [{ command: "set", path: `/${sheet}/${range}`, props: definedProperties({
    "font.name": input.fontName, "font.size": input.fontSize, "font.bold": input.bold, "font.italic": input.italic, "font.color": input.fontColor,
    fill: input.fill, numberformat: input.numberFormat, "alignment.horizontal": input.horizontalAlignment, "alignment.wrapText": input.wrapText, "border.all": input.border,
  }) }];
  if (toolName === "spreadsheet_create_table" && sheet && range) return [{ command: "add", parent: `/${sheet}`, type: "table", props: definedProperties({ ref: range, name: input.name, style: input.style, totalRow: input.totalRow }) }];
  if (toolName === "spreadsheet_create_chart" && sheet) {
    const series = Array.isArray(input.series) ? input.series.flatMap((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      const number = index + 1;
      return Object.entries(definedProperties({ [`series${number}.name`]: item.name, [`series${number}.values`]: item.values, [`series${number}.categories`]: item.categories, [`series${number}.color`]: item.color }));
    }) : [];
    const props = definedProperties({ dataRange: input.dataRange, categories: input.categories, chartType: input.chartType, title: input.title, anchor: input.anchor, width: input.width, height: input.height, legend: input.legend, ...Object.fromEntries(series) });
    if (typeof input.dataRange !== "string" && series.length === 0) return undefined;
    return [{ command: "add", parent: `/${sheet}`, type: "chart", props }];
  }
  if (toolName === "spreadsheet_create_pivot" && sheet) return [{ command: "add", parent: `/${sheet}`, type: "pivottable", props: definedProperties({ source: input.source, position: input.position, name: input.name, rows: Array.isArray(input.rows) ? input.rows.join(",") : undefined, cols: Array.isArray(input.columns) ? input.columns.join(",") : undefined, filters: Array.isArray(input.filters) ? input.filters.join(",") : undefined, values: Array.isArray(input.values) ? input.values.join(",") : undefined, layout: input.layout, style: input.style }) }];
  if (toolName === "spreadsheet_apply_validation" && sheet && range) return [{ command: "add", parent: `/${sheet}`, type: "validation", props: definedProperties({ ref: range, type: input.type, operator: input.operator, formula1: input.formula1, formula2: input.formula2, allowBlank: input.allowBlank, prompt: input.prompt, error: input.error }) }];
  if (toolName === "spreadsheet_apply_conditional_format" && sheet && range) return [{ command: "add", parent: `/${sheet}`, type: "conditionalformatting", props: definedProperties({ ref: range, type: input.type, operator: input.operator, value: input.value, value2: input.value2, formula: input.formula, fill: input.fill, color: input.color, iconset: input.iconSet }) }];
  if (toolName === "spreadsheet_sort_filter" && sheet && range) {
    const operations: OfficeMutation[] = [{ command: "set", path: `/${sheet}/${range}`, props: definedProperties({ sort: input.sort, sortHeader: input.header }) }];
    if (typeof input.filterColumn === "number" && typeof input.filter === "string") operations.push({ command: "add", parent: `/${sheet}`, type: "autofilter", props: { range, [`criteria${input.filterColumn}`]: input.filter } });
    return operations;
  }
  return undefined;
}

function affectedLocators(operations: readonly OfficeMutation[]): string[] {
  return [...new Set(operations.flatMap((operation) => operation.command === "add" ? [operation.parent] : operation.command === "swap" ? [operation.path, operation.path2] : [operation.path]))];
}

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

async function preflightSpreadsheetOperation(office: SpreadsheetOfficeService, context: AgentDriverSessionContext, request: { toolName: string; input: Record<string, unknown> }): Promise<OperationPreflightDecision> {
  const operations = compileSpreadsheetToolOperations(request.toolName, request.input);
  const writesWorkbook = request.toolName === "spreadsheet_create" || request.toolName === "spreadsheet_import" || request.toolName === "spreadsheet_publish" || operations !== undefined;
  if (!writesWorkbook || context.record.accessLevel === "full") return { type: "allow" };
  const path = typeof request.input.name === "string" ? request.input.name : typeof request.input.sourcePath === "string" ? request.input.sourcePath : "spreadsheet artifact";
  const artifactId = typeof request.input.artifactId === "string" ? request.input.artifactId : undefined;
  const preview = artifactId && operations
    ? await office.previewSpreadsheetOperations(context.record.id, context.record.runtimeRootPath, artifactId, operations)
    : { type: "diff" as const, path, before: request.toolName === "spreadsheet_create" ? "" : "Current workbook", after: "Workbook updated through an atomic OfficeCLI operation", truncated: false };
  return {
    type: "approval",
    approval: {
      risk: "file-write",
      severity: "normal",
      matchedRules: [],
      summary: "This operation will create or modify a spreadsheet in the session workspace.",
      preview,
    },
  };
}

function createTools(office: SpreadsheetOfficeService, context: AgentDriverSessionContext): AgentTool[] {
  const applyHighLevelOperations = async (toolName: string, input: Record<string, unknown>, signal?: AbortSignal) => {
    const artifactId = typeof input.artifactId === "string" ? input.artifactId : "";
    const operations = compileSpreadsheetToolOperations(toolName, input);
    if (!artifactId || !operations) throw new Error(`Unable to compile ${toolName}`);
    const artifact = await office.applySpreadsheet(context.record.id, context.record.runtimeRootPath, artifactId, operations, signal);
    return { content: text(`${artifactText("Updated", artifact)}. Inspect affected ranges and run spreadsheet_quality_scan.`), details: { artifact, operationCount: operations.length, affectedLocators: affectedLocators(operations) } };
  };
  return [
    {
      name: "spreadsheet_catalog",
      label: "Spreadsheet catalog",
      description: "List spreadsheet artifacts already registered in this session. Call this before creating a duplicate workbook.",
      parameters: Type.Object({}),
      async execute() {
        const [catalog, capabilities] = await Promise.all([office.catalogSpreadsheets(context.record.id), office.spreadsheetCapabilities()]);
        return { content: text(JSON.stringify({ ...catalog, capabilities }, null, 2).slice(0, 24_000)), details: { ...catalog, capabilities } };
      },
    },
    {
      name: "spreadsheet_create",
      label: "Create workbook",
      description: "Create a blank XLSX in the session workspace. Use spreadsheet_edit to add sheets, values, formulas, tables, charts, and formatting.",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), locale: Type.Optional(Type.String({ minLength: 2, maxLength: 32 })) }),
      executionMode: "sequential",
      async execute(_id, input, signal) {
        const artifact = await office.createSpreadsheet(context.record.id, context.record.runtimeRootPath, input as { name: string; locale?: string }, signal);
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
      executionMode: "sequential",
      async execute(_id, input, signal) {
        const request = input as { artifactId: string; sourcePath: string; sheet?: string; startCell?: string; header?: boolean };
        const artifact = await office.importSpreadsheetData(context.record.id, context.record.runtimeRootPath, request.artifactId, request, signal);
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
      description: "Apply one atomic OfficeCLI batch. Cell set operations create missing cells, so do not add empty rows before setting cell values. All operations roll back if any item fails. Use spreadsheet_help instead of guessing properties.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), operations: Type.Array(MutationSchema, { minItems: 1, maxItems: 250 }) }),
      executionMode: "sequential",
      async execute(_id, input, signal) {
        const request = input as { artifactId: string; operations: OfficeMutation[] };
        const artifact = await office.applySpreadsheet(context.record.id, context.record.runtimeRootPath, request.artifactId, request.operations, signal);
        return { content: text(`${artifactText("Updated", artifact)}. Inspect affected ranges and run spreadsheet_quality_scan.`), details: { artifact, operationCount: request.operations.length, affectedLocators: affectedLocators(request.operations) } };
      },
    },
    {
      name: "spreadsheet_profile_range",
      label: "Profile range",
      description: "Compute deterministic completeness, numeric distribution, and duplicate-value statistics for one bounded worksheet range.",
      parameters: ArtifactSheetRangeSchema,
      async execute(_id, input) {
        const request = input as { artifactId: string; sheet: string; range: string };
        const profile = await office.profileSpreadsheetRange(context.record.id, context.record.runtimeRootPath, request.artifactId, request);
        return { content: text(JSON.stringify(profile, null, 2)), details: { profile } };
      },
    },
    { name: "spreadsheet_format_range", label: "Format range", description: "Apply common font, fill, number format, alignment, wrapping, and border properties to a bounded range.", parameters: FormatSchema, executionMode: "sequential", execute: (_id, input, signal) => applyHighLevelOperations("spreadsheet_format_range", input as Record<string, unknown>, signal) },
    { name: "spreadsheet_create_table", label: "Create table", description: "Create an Excel table from an existing bounded range.", parameters: TableSchema, executionMode: "sequential", execute: (_id, input, signal) => applyHighLevelOperations("spreadsheet_create_table", input as Record<string, unknown>, signal) },
    { name: "spreadsheet_create_chart", label: "Create chart", description: "Create a chart from one contiguous dataRange or from explicit categories and series for non-contiguous selections. Preserve exact user-selected ranges; never substitute the whole sheet or used range.", parameters: ChartSchema, executionMode: "sequential", execute: (_id, input, signal) => applyHighLevelOperations("spreadsheet_create_chart", input as Record<string, unknown>, signal) },
    { name: "spreadsheet_create_pivot", label: "Create pivot table", description: "Create a pivot table with explicit source, axes, value aggregations, filters, layout, and style.", parameters: PivotSchema, executionMode: "sequential", execute: (_id, input, signal) => applyHighLevelOperations("spreadsheet_create_pivot", input as Record<string, unknown>, signal) },
    { name: "spreadsheet_apply_validation", label: "Apply validation", description: "Add data validation to a bounded cell range.", parameters: ValidationSchema, executionMode: "sequential", execute: (_id, input, signal) => applyHighLevelOperations("spreadsheet_apply_validation", input as Record<string, unknown>, signal) },
    { name: "spreadsheet_apply_conditional_format", label: "Apply conditional format", description: "Add a conditional-formatting rule to a bounded cell range.", parameters: ConditionalFormattingSchema, executionMode: "sequential", execute: (_id, input, signal) => applyHighLevelOperations("spreadsheet_apply_conditional_format", input as Record<string, unknown>, signal) },
    { name: "spreadsheet_sort_filter", label: "Sort and filter range", description: "Sort a bounded range and optionally create one AutoFilter criterion.", parameters: SortFilterSchema, executionMode: "sequential", execute: (_id, input, signal) => applyHighLevelOperations("spreadsheet_sort_filter", input as Record<string, unknown>, signal) },
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
      executionMode: "sequential",
      async execute(_id, input, signal) {
        const request = input as { artifactId: string };
        const artifact = await office.publishSpreadsheet(context.record.id, context.record.runtimeRootPath, request.artifactId, signal);
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
    preflightOperation: (context, request) => preflightSpreadsheetOperation(office, context, request),
  });
}
