import { Type } from "typebox";
import type { AgentTool } from "@wordless/agent";
import { createAgentHarnessDriver } from "@wordless/agent-driver-generic";
import type { AgentDriver, AgentDriverSessionContext, OperationPreflightDecision } from "@wordless/agent-driver-sdk";
import { OfficeCliService } from "./office-cli-service";

const presentationOperationName = Type.Union([
  Type.Literal("add"),
  Type.Literal("set"),
  Type.Literal("remove"),
  Type.Literal("move"),
  Type.Literal("swap"),
]);

const presentationOperation = Type.Object({
  // command/parent/type is OfficeCLI's native batch format; op/path remains accepted for earlier sessions.
  command: Type.Optional(presentationOperationName),
  op: Type.Optional(presentationOperationName),
  parent: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  path: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  path2: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  type: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  from: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  to: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  after: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  before: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  props: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.Unknown())),
});

function text(value: string) {
  return [{ type: "text" as const, text: value }];
}

function stringValue(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

async function preflightPresentationOperation(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
): Promise<OperationPreflightDecision> {
  if (request.toolName !== "presentation_create" && request.toolName !== "presentation_apply") return { type: "allow" };
  if (context.record.accessLevel === "full") return { type: "allow" };
  const path = request.toolName === "presentation_create" ? stringValue(request.input, "name") || "presentation.pptx" : "presentation artifact";
  const action = request.toolName === "presentation_create" ? "create" : "modify";
  return {
    type: "approval",
    approval: {
      risk: "file-write",
      severity: "normal",
      matchedRules: [],
      summary: `This operation will ${action} a PowerPoint document in the session workspace.`,
      preview: {
        type: "diff",
        path,
        before: request.toolName === "presentation_create" ? "" : "Structured Office document",
        after: request.toolName === "presentation_create" ? "New PowerPoint document" : "Structured Office document with requested operations",
        truncated: false,
      },
    },
  };
}

function createTools(office: OfficeCliService, context: AgentDriverSessionContext): AgentTool[] {
  return [
    {
      name: "presentation_create",
      label: "Create presentation",
      description: "Create a new PPTX in the current session workspace. Use a template ID returned by presentation_publish only when it fits the user's request.",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }), templateId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }),
      async execute(_toolCallId, input) {
        const request = input as { name: string; templateId?: string };
        const artifact = await office.create(context.record.id, context.record.runtimeRootPath, { name: request.name, templateId: request.templateId });
        return { content: text(`Created ${artifact.displayName} at ${artifact.sourcePath}. Artifact ID: ${artifact.id}`), details: { artifact } };
      },
    },
    {
      name: "presentation_inspect",
      label: "Inspect presentation",
      description: "Read the structured outline of a previously created presentation before changing it.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }) }),
      async execute(_toolCallId, input) {
        const request = input as { artifactId: string };
        const outline = await office.inspect(context.record.id, context.record.runtimeRootPath, request.artifactId);
        return { content: text(outline.slice(0, 24_000)), details: { artifactId: request.artifactId } };
      },
    },
    {
      name: "presentation_apply",
      label: "Edit presentation",
      description: "Apply OfficeCLI batch commands. Paths use XPath-style singular segments such as /slide[1] and /slide[1]/shape[2], never /slides/1. Add requires command:'add', parent:'/' (or /slide[N]), and type:'slide'|'shape'|...; set/remove use path; move uses path plus to/after/before; swap uses path plus path2. Use slide background, shape fill, and unit-qualified x/y/width/height properties. Never put add type inside props. Do not use raw XML or shell commands.",
      parameters: Type.Object({
        artifactId: Type.String({ minLength: 1 }),
        operations: Type.Array(presentationOperation, { minItems: 1, maxItems: 100 }),
      }),
      async execute(_toolCallId, input) {
        const request = input as { artifactId: string; operations: unknown[] };
        const artifact = await office.apply(context.record.id, context.record.runtimeRootPath, request.artifactId, request.operations);
        return { content: text(`Updated ${artifact.displayName}; revision ${artifact.revision}. Render the changed presentation before reporting completion.`), details: { artifact, operationCount: request.operations.length } };
      },
    },
    {
      name: "presentation_render",
      label: "Render presentation",
      description: "Render the current presentation into an HTML preview and slide images. Use this after visual changes.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }) }),
      async execute(_toolCallId, input) {
        const request = input as { artifactId: string };
        const preview = await office.preview(context.record.id, context.record.runtimeRootPath, request.artifactId, { force: true });
        return { content: text(`Rendered revision ${preview.revision} with ${preview.surfaces.length} slide preview(s).`), details: preview };
      },
    },
    {
      name: "presentation_validate",
      label: "Validate presentation",
      description: "Validate the PPTX structure before delivery. Fix error-level issues before reporting the file complete.",
      parameters: Type.Object({ artifactId: Type.String({ minLength: 1 }) }),
      async execute(_toolCallId, input) {
        const request = input as { artifactId: string };
        const issues = await office.validate(context.record.id, context.record.runtimeRootPath, request.artifactId);
        return { content: text(issues.length ? issues.map((issue) => `${issue.severity}: ${issue.message}`).join("\n") : "Validation completed with no reported issues."), details: { artifactId: request.artifactId, issues } };
      },
    },
    {
      name: "presentation_publish",
      label: "Publish presentation",
      description: "List presentation artifacts available in this session, including their IDs and revisions.",
      parameters: Type.Object({}),
      async execute() {
        const artifacts = await office.list(context.record.id);
        return { content: text(artifacts.length ? artifacts.map((artifact) => `${artifact.displayName} · ${artifact.id} · revision ${artifact.revision}`).join("\n") : "No presentation artifact exists yet."), details: { artifacts, templates: office.listTemplates() } };
      },
    },
  ];
}

export function createPresentationAgentDriver(office: OfficeCliService): AgentDriver {
  return createAgentHarnessDriver({
    id: "presentation",
    features: ["steer", "follow-up", "thinking", "compact", "artifacts", "approval", "user-request"],
    createTools: (context) => createTools(office, context),
    preflightOperation: preflightPresentationOperation,
  });
}
