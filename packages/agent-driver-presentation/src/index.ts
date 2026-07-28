import type { AgentTool } from "@wordless/agent";
import { createAgentHarnessDriver } from "@wordless/agent-driver-generic";
import type { AgentDriver, AgentDriverSessionContext, OperationPreflightDecision } from "@wordless/agent-driver-sdk";
import type {
  OfficeMutation,
  PresentationAdvancedOperation,
  PresentationOfficeService,
  PresentationQualityReport,
  PresentationReadRequest,
  PresentationSource,
  PresentationVisualReview,
} from "@wordless/capability-office";
import { Type } from "typebox";

const PropsSchema = Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Unknown());
const PathSchema = Type.String({ minLength: 1, maxLength: 2_048 });

const MutationSchema = Type.Union([
  Type.Object({ command: Type.Literal("add"), parent: PathSchema, type: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })), from: Type.Optional(PathSchema), props: Type.Optional(PropsSchema) }),
  Type.Object({ command: Type.Literal("set"), path: PathSchema, props: PropsSchema }),
  Type.Object({ command: Type.Literal("remove"), path: PathSchema, props: Type.Optional(PropsSchema) }),
  Type.Object({ command: Type.Literal("move"), path: PathSchema, to: Type.Optional(PathSchema), after: Type.Optional(PathSchema), before: Type.Optional(PathSchema) }),
  Type.Object({ command: Type.Literal("swap"), path: PathSchema, path2: PathSchema }),
]);

const ReadSchema = Type.Union([
  Type.Object({ kind: Type.Literal("view"), mode: Type.Union([Type.Literal("outline"), Type.Literal("stats"), Type.Literal("issues"), Type.Literal("text"), Type.Literal("annotated")]), start: Type.Optional(Type.Integer({ minimum: 1 })), end: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
  Type.Object({ kind: Type.Literal("get"), path: PathSchema, depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })) }),
  Type.Object({ kind: Type.Literal("query"), selector: Type.String({ minLength: 1, maxLength: 4_096 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
]);

const VisualReviewSchema = Type.Object({
  surfaceId: Type.String({ pattern: "^slide-[1-9][0-9]*$" }),
  status: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
  findings: Type.Array(Type.Object({ code: Type.String({ minLength: 1, maxLength: 64 }), message: Type.String({ minLength: 1, maxLength: 2_000 }), locator: Type.Optional(PathSchema) }), { maxItems: 32 }),
});

const AdvancedOperationSchema = Type.Union([
  Type.Object({ kind: Type.Literal("dump"), path: PathSchema }),
  Type.Object({ kind: Type.Literal("raw-read"), part: PathSchema }),
  Type.Object({ kind: Type.Literal("raw-update"), part: PathSchema, xpath: Type.String({ minLength: 1, maxLength: 4_096 }), action: Type.Union([Type.Literal("append"), Type.Literal("prepend"), Type.Literal("insertbefore"), Type.Literal("insertafter"), Type.Literal("replace"), Type.Literal("remove"), Type.Literal("setattr")]), xml: Type.Optional(Type.String({ maxLength: 200_000 })) }),
  Type.Object({ kind: Type.Literal("add-part"), parent: PathSchema, partType: Type.Literal("chart") }),
  Type.Object({ kind: Type.Literal("merge-template"), data: Type.Record(Type.String({ minLength: 1, maxLength: 256 }), Type.Unknown()) }),
]);

function text(value: string) {
  return [{ type: "text" as const, text: value }];
}

function reportText(report: PresentationQualityReport): string {
  const summary = `Quality ${report.status}; revision ${report.revision}; ${report.reviewedSurfaceIds.length}/${report.totalSlides} slides visually reviewed.`;
  return report.issues.length === 0 ? summary : `${summary}\n${report.issues.map((issue) => `${issue.code} ${issue.category}: ${issue.message}${issue.locator ? ` (${issue.locator})` : ""}`).join("\n")}`;
}

function artifactText(prefix: string, value: unknown): string {
  if (typeof value !== "object" || value === null) return prefix;
  const artifact = value as Record<string, unknown>;
  const name = typeof artifact.displayName === "string" ? artifact.displayName : "presentation";
  const sourcePath = typeof artifact.sourcePath === "string" ? artifact.sourcePath : "";
  const id = typeof artifact.id === "string" ? artifact.id : "";
  return `${prefix} ${name}${sourcePath ? ` at ${sourcePath}` : ""}${id ? `. Artifact ID: ${id}` : ""}`;
}

async function preflightPresentationOperation(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
): Promise<OperationPreflightDecision> {
  const advanced = request.toolName === "presentation_advanced" && typeof request.input.operation === "object" && request.input.operation !== null
    ? request.input.operation as Record<string, unknown>
    : undefined;
  const advancedMutation = advanced?.kind === "raw-update" || advanced?.kind === "add-part" || advanced?.kind === "merge-template";
  const writesDocument = request.toolName === "presentation_create" || request.toolName === "presentation_edit" || advancedMutation;
  if (!writesDocument) return { type: "allow" };
  if (context.record.accessLevel === "full" && !advancedMutation) return { type: "allow" };
  return {
    type: "approval",
    approval: {
      risk: "file-write",
      severity: advancedMutation ? "high" : "normal",
      matchedRules: [],
      summary: advancedMutation ? "This advanced operation directly modifies the PowerPoint package and requires confirmation." : "This operation will create or modify a PowerPoint document in the session workspace.",
      preview: {
        type: "diff",
        path: request.toolName === "presentation_create" && typeof request.input.name === "string" ? request.input.name : "presentation artifact",
        before: request.toolName === "presentation_create" ? "" : "Current PowerPoint document",
        after: advancedMutation ? "PowerPoint document with advanced package changes" : "PowerPoint document with structured OfficeCLI changes",
        truncated: false,
      },
    },
  };
}

function createTools(office: PresentationOfficeService, context: AgentDriverSessionContext): AgentTool[] {
  return [
    {
      name: "presentation_catalog",
      label: "Presentation catalog",
      description: "List presentation artifacts, templates, and optional OfficeCLI guidance available in this session.",
      parameters: Type.Object({}),
      async execute() {
        const catalog = await office.catalog(context.record.id);
        return { content: text(JSON.stringify(catalog, null, 2).slice(0, 24_000)), details: catalog };
      },
    },
    {
      name: "presentation_create",
      label: "Create presentation",
      description: "Create a PPTX in the session workspace. For auto selection, inspect presentation_catalog and pass the chosen concrete template ID; use blank only when no template fits.",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), templateId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }),
      async execute(_id, input) {
        const request = input as { name: string; templateId?: string };
        const artifact = await office.create(context.record.id, context.record.runtimeRootPath, request);
        return { content: text(artifactText("Created", artifact)), details: { artifact } };
      },
    },
    {
      name: "presentation_help",
      label: "OfficeCLI help",
      description: "Read the authoritative schema for the installed OfficeCLI version. Call this before using an unfamiliar element or property instead of guessing.",
      parameters: Type.Object({ verb: Type.Optional(Type.Union([Type.Literal("add"), Type.Literal("set"), Type.Literal("get"), Type.Literal("query"), Type.Literal("remove")])), element: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }),
      async execute(_id, input) {
        const request = input as { verb?: "add" | "set" | "get" | "query" | "remove"; element?: string };
        const output = await office.help(request);
        return { content: text(output.slice(0, 40_000)), details: request };
      },
    },
    {
      name: "presentation_guidance",
      label: "Load presentation guidance",
      description: "Load specialized OfficeCLI guidance when the task is a pitch deck, dashboard, or Morph presentation. Baseline pptx guidance is already loaded.",
      parameters: Type.Object({ name: Type.Union([Type.Literal("pitch-deck"), Type.Literal("data-dashboard"), Type.Literal("morph-ppt"), Type.Literal("morph-ppt-3d")]), referencePath: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })) }),
      async execute(_id, input) {
        const request = input as { name: string; referencePath?: string };
        const output = await office.guidance(request.name, request.referencePath);
        return { content: text(`Apply this guidance through the structured presentation_* tools. Treat CLI and shell snippets as conceptual OfficeCLI examples; never call bash, shell, or an officecli command directly.\n\n${output.slice(0, 60_000)}`), details: request };
      },
    },
    {
      name: "presentation_read",
      label: "Inspect presentation",
      description: "Inspect a PPTX through OfficeCLI view, get, or query. Use stable @id or @name paths for multi-step edits.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), request: ReadSchema }),
      async execute(_id, input) {
        const request = input as { artifactId: string; request: PresentationReadRequest };
        const output = await office.read(context.record.id, context.record.runtimeRootPath, request.artifactId, request.request);
        return { content: text(output.slice(0, 40_000)), details: { artifactId: request.artifactId, request: request.request } };
      },
    },
    {
      name: "presentation_edit",
      label: "Edit presentation",
      description: "Apply an atomic OfficeCLI batch. Use presentation_help for exact properties. Paths are XPath-style and text values should contain real line breaks, not escaped placeholder text.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), operations: Type.Array(MutationSchema, { minItems: 1, maxItems: 100 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string; operations: OfficeMutation[] };
        const artifact = await office.apply(context.record.id, context.record.runtimeRootPath, request.artifactId, request.operations);
        return { content: text(`${artifactText("Updated", artifact)}. Render and quality-check the new revision before publishing.`), details: { artifact, operationCount: request.operations.length } };
      },
    },
    {
      name: "presentation_render",
      label: "Render presentation",
      description: "Render up to four slides and return their PNG pixels to the model for visual inspection. Omit pages to render the first batch.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), pages: Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 200 }), { minItems: 1, maxItems: 4 })) }),
      async execute(_id, input) {
        const request = input as { artifactId: string; pages?: number[] };
        const rendered = await office.renderForModel(context.record.id, context.record.runtimeRootPath, request.artifactId, request.pages);
        return {
          content: [
            ...text(`Rendered revision ${rendered.revision}; ${rendered.totalSlides} total slide(s). Returned pages ${rendered.images.map((image) => image.page).join(", ") || "none"}.`),
            ...rendered.images.map((image) => ({ type: "image" as const, mimeType: image.mimeType, data: image.data })),
          ],
          details: rendered.details,
        };
      },
    },
    {
      name: "presentation_quality_scan",
      label: "Check presentation",
      description: "Run schema validation, OfficeCLI issues, text placeholder checks, and statistics for the current revision. Any reported issue blocks publishing.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string };
        const report = await office.qualityScan(context.record.id, context.record.runtimeRootPath, request.artifactId);
        return { content: text(reportText(report)), details: { artifactId: request.artifactId, quality: report } };
      },
    },
    {
      name: "presentation_quality_review",
      label: "Record visual review",
      description: "Record visual inspection results for rendered slides. Every slide in the current revision must pass before publishing.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), reviews: Type.Array(VisualReviewSchema, { minItems: 1, maxItems: 4 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string; reviews: PresentationVisualReview[] };
        const report = await office.recordVisualReview(context.record.id, request.artifactId, request.reviews);
        return { content: text(reportText(report)), details: { artifactId: request.artifactId, quality: report } };
      },
    },
    {
      name: "presentation_sources",
      label: "Register presentation sources",
      description: "Register external research sources and the slide numbers that use them. After registering, place concise citations in those slides' speaker notes with presentation_edit.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), sources: Type.Array(Type.Object({ url: Type.String({ format: "uri", maxLength: 4_096 }), title: Type.String({ minLength: 1, maxLength: 1_000 }), publisher: Type.Optional(Type.String({ maxLength: 512 })), slideNumbers: Type.Array(Type.Integer({ minimum: 1, maximum: 500 }), { minItems: 1, maxItems: 100 }) }), { minItems: 1, maxItems: 100 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string; sources: Array<Omit<PresentationSource, "id" | "accessedAt">> };
        const sources = await office.registerSources(context.record.id, request.artifactId, request.sources);
        return { content: text(`Registered ${sources.length} presentation source(s).`), details: { artifactId: request.artifactId, sources } };
      },
    },
    {
      name: "presentation_publish",
      label: "Publish presentation",
      description: "Save and publish the current PPTX only after deterministic checks and visual review pass for every slide in the current revision.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }) }),
      async execute(_id, input) {
        const request = input as { artifactId: string };
        const artifact = await office.publish(context.record.id, context.record.runtimeRootPath, request.artifactId);
        return { content: text(artifactText("Published", artifact)), details: { artifact } };
      },
    },
    {
      name: "presentation_advanced",
      label: "Advanced presentation operation",
      description: "Use dump or raw XML only when structured OfficeCLI operations cannot represent the required change. Raw updates always require high-risk approval.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }), operation: AdvancedOperationSchema }),
      async execute(_id, input) {
        const request = input as { artifactId: string; operation: PresentationAdvancedOperation };
        const output = await office.advanced(context.record.id, context.record.runtimeRootPath, request.artifactId, request.operation);
        return { content: text(output.slice(0, 40_000)), details: { artifactId: request.artifactId, operation: request.operation } };
      },
    },
  ];
}

export function createPresentationAgentDriver(office: PresentationOfficeService): AgentDriver {
  return createAgentHarnessDriver({
    id: "presentation",
    features: ["steer", "follow-up", "thinking", "compact", "artifacts", "approval", "user-request"],
    createTools: (context) => createTools(office, context),
    preflightOperation: preflightPresentationOperation,
    async systemPromptContribution() {
      const guidance = await office.guidance("pptx");
      return `The required OfficeCLI skill below is version-matched design and document guidance. Apply it through the structured presentation_* tools. Treat CLI and shell snippets as conceptual examples only; never call bash, shell, or officecli directly.\n\n<required_skill name="officecli-pptx">\n${guidance}\n</required_skill>`;
    },
  });
}
