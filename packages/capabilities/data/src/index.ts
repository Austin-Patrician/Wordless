import { randomUUID } from "node:crypto";
import type { AgentTool, AgentToolResult } from "@wordless/agent";
import type { SubagentResult, SubagentRunner, SubagentTaskProgress } from "@wordless/agent-extension-sdk";
import type { ResearchDelegationDetails, ResearchDelegationEvent, ResearchDelegationTask } from "@wordless/domain";

const RESEARCH_DIMENSION_TIMEOUT_MS = 10 * 60 * 1_000;
import type { AnalysisResearchSource, AnalysisRunDescriptor, AnalysisSessionSnapshot, DataAnalysisCapabilitySnapshot } from "@wordless/protocol";
import { Type, type TSchema } from "typebox";

type DataToolDetails = Record<string, unknown>;

const RESEARCH_EVENT_LIMIT = 40;
const RESEARCH_OUTPUT_PREVIEW_LIMIT = 2_000;

function previewText(value: string | undefined, limit = RESEARCH_OUTPUT_PREVIEW_LIMIT): string | undefined {
  if (!value) return undefined;
  return value.length <= limit ? value : `${value.slice(0, limit)}\n...`;
}

function safeInputSummary(input: Record<string, unknown>): string | undefined {
  if (Object.keys(input).length === 0) return undefined;
  const text = JSON.stringify(input, (key, value) => /token|secret|password|authorization|cookie/i.test(key) ? "[redacted]" : value);
  return previewText(text, 800);
}

function researchToolLabel(name: string): string {
  if (name === "research_snapshot") return "Capture source evidence";
  if (name === "research_submit_dimension") return "Submit research claims";
  if (name === "research_review_dimension") return "Review research evidence";
  if (name === "read") return "Read research material";
  if (name.startsWith("mcp_")) return "Search external sources";
  return name.replace(/_/g, " ");
}

function cloneResearchDetails(details: ResearchDelegationDetails): ResearchDelegationDetails {
  return {
    ...details,
    tasks: details.tasks.map((task) => ({
      ...task,
      ...(task.activeTool ? { activeTool: { ...task.activeTool } } : {}),
      events: task.events.map((event) => ({ ...event })),
    })),
  };
}

function formatResearchProgress(details: ResearchDelegationDetails): string {
  return details.tasks.map((task) => `${task.dimensionId}: ${task.status}${task.activeTool ? ` · ${task.activeTool.name}` : ""}`).join("\n");
}

function updateResearchTask(task: ResearchDelegationTask, next: SubagentTaskProgress): void {
  const now = Date.now();
  task.status = next.status;
  if (next.status !== "queued" && task.startedAt === undefined) task.startedAt = now;
  if (["completed", "failed", "cancelled"].includes(next.status)) task.completedAt = now;
  if (next.output !== undefined) task.output = next.output;
  if (next.usage !== undefined) task.usage = next.usage;
  if (next.approval !== undefined) task.approval = next.approval;
  if (next.userRequest !== undefined) task.userRequest = next.userRequest;
  if (["failed", "cancelled"].includes(next.status) && task.activeTool?.state === "running") {
    task.activeTool = { ...task.activeTool, state: "error" };
  }
  if (!next.tool) return;

  const inputSummary = safeInputSummary(next.tool.input);
  const outputPreview = previewText(next.tool.output);
  task.activeTool = {
    ...(next.tool.callId ? { callId: next.tool.callId } : {}),
    name: next.tool.name,
    state: next.tool.state,
    ...(inputSummary ? { inputSummary } : {}),
    ...(outputPreview ? { outputPreview } : {}),
  };
  const eventId = next.tool.callId ?? `${next.tool.name}:${task.events.length}`;
  const existing = task.events.find((event) => event.id === eventId);
  const event: ResearchDelegationEvent = {
    id: eventId,
    kind: "tool",
    label: researchToolLabel(next.tool.name),
    state: next.tool.state,
    timestamp: existing?.timestamp ?? now,
    ...(next.tool.callId ? { toolCallId: next.tool.callId } : {}),
    toolName: next.tool.name,
    ...(inputSummary ? { inputSummary } : {}),
    ...(outputPreview ? { outputPreview } : {}),
  };
  if (existing) Object.assign(existing, event);
  else task.events.push(event);
  if (task.events.length > RESEARCH_EVENT_LIMIT) task.events.splice(0, task.events.length - RESEARCH_EVENT_LIMIT);
}

export interface DataAnalysisService {
  capabilities(): Promise<DataAnalysisCapabilitySnapshot>;
  catalog(sessionId: string, workspaceRoot: string, input: { query?: string; formats?: string[]; limit?: number }, signal?: AbortSignal): Promise<unknown>;
  inspect(sessionId: string, workspaceRoot: string, input: { paths: string[]; analysisId?: string; title?: string; sampleRows?: number }, signal?: AbortSignal): Promise<AnalysisRunDescriptor>;
  materialize(sessionId: string, workspaceRoot: string, input: { analysisId: string; sourcePath: string; outputName: string }, signal?: AbortSignal): Promise<AnalysisRunDescriptor>;
  validate(sessionId: string, workspaceRoot: string, analysisId: string, signal?: AbortSignal): Promise<AnalysisRunDescriptor>;
  publish(sessionId: string, workspaceRoot: string, analysisId: string, signal?: AbortSignal): Promise<AnalysisRunDescriptor>;
  prepareResearch(sessionId: string, workspaceRoot: string, input: { analysisId: string; mode: "quick" | "normal" | "heavy"; objective: string; questions: string[]; dimensions: Array<{ id: string; name: string; question: string }> }): Promise<{ run: AnalysisRunDescriptor; confirmationToken: string }>;
  startResearch(sessionId: string, workspaceRoot: string, input: { analysisId: string; confirmationToken: string; webResearchAvailable: boolean }): Promise<AnalysisRunDescriptor>;
  snapshotResearchSource(sessionId: string, workspaceRoot: string, input: { analysisId: string; dimensionId: string; url: string; title?: string; publisher?: string; publishedAt?: string; sourceType?: "web" | "academic" | "filing" | "other" }, signal?: AbortSignal): Promise<AnalysisResearchSource>;
  submitResearchDimension(sessionId: string, workspaceRoot: string, input: { analysisId: string; dimensionId: string; claims: Array<{ id: string; statement: string; kind: "external" | "synthesis"; evidenceRefs: string[]; confidence: "high" | "medium" | "low" | "contested"; caveats?: string[] }>; conflicts?: string[] }): Promise<AnalysisRunDescriptor>;
  reviewResearchDimension(sessionId: string, workspaceRoot: string, input: { analysisId: string; dimensionId: string; verdict: "pass" | "revise"; notes: string[] }): Promise<AnalysisRunDescriptor>;
  validateResearch(sessionId: string, workspaceRoot: string, analysisId: string): Promise<AnalysisRunDescriptor>;
  snapshot(sessionId: string, workspaceRoot: string): Promise<AnalysisSessionSnapshot>;
  resolveOutput(sessionId: string, workspaceRoot: string, analysisId: string, relativePath: string): Promise<string>;
}

function result(value: unknown, details: DataToolDetails = {}): AgentToolResult<DataToolDetails> {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], details };
}

function tool<TParameters extends TSchema>(definition: AgentTool<TParameters, DataToolDetails>): AgentTool<TParameters, DataToolDetails> {
  return definition;
}

export function createDataAnalysisTools(service: DataAnalysisService, context: { sessionId: string; workspaceRoot: string; webResearchAvailable?: boolean; subagentRunner?: SubagentRunner }): AgentTool[] {
  const catalog = tool({
    name: "data_catalog",
    label: "Discover data files",
    description: "Find supported structured data files in the current workspace without reading their contents. Results are bounded.",
    parameters: Type.Object({ query: Type.Optional(Type.String()), formats: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }),
    async execute(_id, input, signal) {
      return result(await service.catalog(context.sessionId, context.workspaceRoot, input, signal));
    },
  });
  const inspect = tool({
    name: "data_inspect",
    label: "Inspect datasets",
    description: "Inspect one or more read-only workspace datasets with bounded samples. Omit analysisId to start a new analysis; reuse the returned analysisId to add sources to the same analysis.",
    parameters: Type.Object({ paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 }), analysisId: Type.Optional(Type.String({ minLength: 1 })), title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })), sampleRows: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })) }),
    async execute(_id, input, signal) {
      const run = await service.inspect(context.sessionId, context.workspaceRoot, input, signal);
      return result(run, { analysisId: run.id, outputRoot: run.outputRoot });
    },
  });
  const materialize = tool({
    name: "data_materialize",
    label: "Materialize analysis data",
    description: "Create a Parquet intermediate inside an existing analysis output directory when large or multi-file analysis benefits from it. This never changes the source file.",
    parameters: Type.Object({ analysisId: Type.String({ minLength: 1 }), sourcePath: Type.String({ minLength: 1 }), outputName: Type.String({ minLength: 1, maxLength: 120 }) }),
    async execute(_id, input, signal) {
      const run = await service.materialize(context.sessionId, context.workspaceRoot, input, signal);
      return result(run, { analysisId: run.id, outputRoot: run.outputRoot });
    },
  });
  const validate = tool({
    name: "data_validate",
    label: "Validate analysis",
    description: "Validate analysis-manifest.json, referenced charts, validation checks, and source fingerprints before publication.",
    parameters: Type.Object({ analysisId: Type.String({ minLength: 1 }) }),
    async execute(_id, input, signal) {
      return result(await service.validate(context.sessionId, context.workspaceRoot, input.analysisId, signal));
    },
  });
  const publish = tool({
    name: "data_publish",
    label: "Publish analysis report",
    description: "Validate the analysis and render analysis-report.md from analysis-manifest.json. Call only after scripts, charts, and validation checks are complete.",
    parameters: Type.Object({ analysisId: Type.String({ minLength: 1 }) }),
    async execute(_id, input, signal) {
      return result(await service.publish(context.sessionId, context.workspaceRoot, input.analysisId, signal));
    },
  });
  const researchPrepare = tool({
    name: "research_prepare",
    label: "Prepare deep research plan",
    description: "Prepare a research plan for an existing analysis. Present the returned mode, objective, questions, dimensions, source categories, and report form to the user through request_user_input. Do not call research_start until the user confirms.",
    parameters: Type.Object({
      analysisId: Type.String({ minLength: 1 }),
      mode: Type.Union([Type.Literal("quick"), Type.Literal("normal"), Type.Literal("heavy")]),
      objective: Type.String({ minLength: 1, maxLength: 2000 }),
      questions: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { minItems: 1, maxItems: 12 }),
      dimensions: Type.Array(Type.Object({ id: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,40}$" }), name: Type.String({ minLength: 1, maxLength: 160 }), question: Type.String({ minLength: 1, maxLength: 1000 }) }), { minItems: 1, maxItems: 8 }),
    }),
    async execute(_id, input) {
      const prepared = await service.prepareResearch(context.sessionId, context.workspaceRoot, input);
      const confirmation = { confirmationToken: prepared.confirmationToken, researchConfirmationRequired: true };
      return result({ ...prepared.run, ...confirmation }, { analysisId: input.analysisId, ...confirmation });
    },
  });
  const researchStart = tool({
    name: "research_start",
    label: "Start deep research",
    description: "Start a prepared and user-confirmed research plan. Pass the one-time confirmationToken from research_prepare. A ready Web Search Connector is required; when unavailable the verified data analysis remains intact and research is marked blocked.",
    parameters: Type.Object({ analysisId: Type.String({ minLength: 1 }), confirmationToken: Type.String({ minLength: 1, maxLength: 100 }) }),
    async execute(_id, input) {
      return result(await service.startResearch(context.sessionId, context.workspaceRoot, { ...input, webResearchAvailable: context.webResearchAvailable === true }), { analysisId: input.analysisId, researchConfirmationAccepted: true });
    },
  });
  const researchSnapshot = tool({
    name: "research_snapshot",
    label: "Snapshot research source",
    description: "Fetch a public HTTP(S) source, extract bounded readable text, and save an immutable content-addressed snapshot. Use source ids returned by this tool as claim evidenceRefs.",
    parameters: Type.Object({ analysisId: Type.String({ minLength: 1 }), dimensionId: Type.String({ minLength: 1 }), url: Type.String({ minLength: 1, maxLength: 4000 }), title: Type.Optional(Type.String({ maxLength: 500 })), publisher: Type.Optional(Type.String({ maxLength: 300 })), publishedAt: Type.Optional(Type.String({ maxLength: 80 })), sourceType: Type.Optional(Type.Union([Type.Literal("web"), Type.Literal("academic"), Type.Literal("filing"), Type.Literal("other")])) }),
    async execute(_id, input, signal) {
      const source = await service.snapshotResearchSource(context.sessionId, context.workspaceRoot, input, signal);
      return result(source, { analysisId: input.analysisId, dimensionId: input.dimensionId, sourceId: source.id });
    },
  });
  const researchSubmit = tool({
    name: "research_submit_dimension",
    label: "Submit research evidence",
    description: "Submit structured claims for one research dimension. Every external or synthesis claim must reference snapshotted source ids. This replaces arbitrary shared report writes and is safe for parallel researchers.",
    parameters: Type.Object({
      analysisId: Type.String({ minLength: 1 }),
      dimensionId: Type.String({ minLength: 1 }),
      claims: Type.Array(Type.Object({ id: Type.String({ pattern: "^[a-zA-Z0-9_.-]{1,80}$" }), statement: Type.String({ minLength: 1, maxLength: 4000 }), kind: Type.Union([Type.Literal("external"), Type.Literal("synthesis")]), evidenceRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20 }), confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low"), Type.Literal("contested")]), caveats: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 12 })) }), { minItems: 1, maxItems: 40 }),
      conflicts: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 20 })),
    }),
    async execute(_id, input) {
      return result(await service.submitResearchDimension(context.sessionId, context.workspaceRoot, input), { analysisId: input.analysisId, dimensionId: input.dimensionId });
    },
  });
  const researchReview = tool({
    name: "research_review_dimension",
    label: "Review research evidence",
    description: "Record an evidence review verdict for one dimension. Use revise when claims lack support, conflicts remain unexplained, or coverage is materially incomplete.",
    parameters: Type.Object({ analysisId: Type.String({ minLength: 1 }), dimensionId: Type.String({ minLength: 1 }), verdict: Type.Union([Type.Literal("pass"), Type.Literal("revise")]), notes: Type.Array(Type.String({ minLength: 1, maxLength: 1500 }), { maxItems: 20 }) }),
    async execute(_id, input) {
      return result(await service.reviewResearchDimension(context.sessionId, context.workspaceRoot, input), { analysisId: input.analysisId, dimensionId: input.dimensionId, verdict: input.verdict });
    },
  });
  const researchValidate = tool({
    name: "research_validate",
    label: "Validate deep research",
    description: "Validate research completeness, source snapshots, claim-to-source references, reviews, and unresolved conflicts before publishing the unified report.",
    parameters: Type.Object({ analysisId: Type.String({ minLength: 1 }) }),
    async execute(_id, input) {
      return result(await service.validateResearch(context.sessionId, context.workspaceRoot, input.analysisId), { analysisId: input.analysisId });
    },
  });
  const researchDelegate = tool({
    name: "research_delegate",
    label: "Delegate deep research",
    description: "Run confirmed research dimensions with dedicated source-grounded subagents. Use parallel researcher tasks for independent dimensions, then parallel research-reviewer tasks after evidence is ready.",
    parameters: Type.Object({
      analysisId: Type.String({ minLength: 1 }),
      mode: Type.Union([Type.Literal("parallel"), Type.Literal("sequential")]),
      tasks: Type.Array(Type.Object({ agent: Type.Union([Type.Literal("researcher"), Type.Literal("research-reviewer")]), dimensionId: Type.String({ minLength: 1 }), task: Type.String({ minLength: 1, maxLength: 12000 }) }), { minItems: 1, maxItems: 8 }),
    }),
    async execute(_id, input, signal, onUpdate) {
      if (!context.subagentRunner) throw new Error("Research subagent execution is unavailable");
      const analysis = (await service.snapshot(context.sessionId, context.workspaceRoot)).runs.find((run) => run.id === input.analysisId);
      if (!analysis?.research || !["researching", "reviewing", "failed"].includes(analysis.research.status)) {
        throw new Error("Deep research must be confirmed and started before delegating research tasks");
      }
      const dimensions = new Map((analysis?.research?.dimensions ?? []).map((dimension) => [dimension.id, dimension]));
      const startedAt = Date.now();
      const taskEntries = input.tasks.map((task) => {
        const dimension = dimensions.get(task.dimensionId);
        const detail: ResearchDelegationTask = {
          taskId: randomUUID(),
          dimensionId: task.dimensionId,
          dimensionName: dimension?.name ?? task.dimensionId.replace(/[-_]+/g, " "),
          question: dimension?.question ?? task.task.split("\n").find((line) => line.trim().length > 0) ?? task.task,
          agent: task.agent,
          status: "queued",
          events: [],
        };
        return {
          input: task,
          detail,
        };
      });
      const details: ResearchDelegationDetails = { version: 1, analysisId: input.analysisId, mode: input.mode, startedAt, updatedAt: startedAt, tasks: taskEntries.map((entry) => entry.detail) };
      const emitUpdate = () => onUpdate?.({ content: [{ type: "text", text: formatResearchProgress(details) }], details: cloneResearchDetails(details) });
      emitUpdate();
      const runTask = async (entry: typeof taskEntries[number], previous?: string) => {
        const { detail, input: task } = entry;
        const prompt = `Analysis id: ${input.analysisId}\nResearch dimension: ${task.dimensionId}\n${task.task}${previous ? `\n\nPrevious research result:\n${previous.slice(0, 30000)}` : ""}`;
        const taskController = new AbortController();
        let timedOut = false;
        const abortTask = () => taskController.abort();
        if (signal?.aborted) taskController.abort();
        else signal?.addEventListener("abort", abortTask, { once: true });
        const timeout = setTimeout(() => {
          timedOut = true;
          taskController.abort();
        }, RESEARCH_DIMENSION_TIMEOUT_MS);
        let resultValue: SubagentResult;
        try {
          resultValue = await context.subagentRunner!.run({ id: detail.taskId, role: task.agent, prompt, cwd: context.workspaceRoot }, { signal: taskController.signal, onUpdate: (next) => {
            updateResearchTask(detail, next);
            details.updatedAt = Date.now();
            emitUpdate();
          } });
        } catch (cause) {
          resultValue = {
            taskId: detail.taskId,
            status: taskController.signal.aborted ? "cancelled" : "failed",
            text: detail.output ?? "",
            error: cause instanceof Error ? cause.message : String(cause),
          };
        } finally {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abortTask);
        }
        if (timedOut) {
          resultValue = { ...resultValue, status: "failed", error: `Research dimension timed out after ${RESEARCH_DIMENSION_TIMEOUT_MS / 60_000} minutes` };
        }
        let verifiedResult = resultValue;
        try {
          if (resultValue.status === "completed") {
            const refreshed = (await service.snapshot(context.sessionId, context.workspaceRoot)).runs.find((run) => run.id === input.analysisId);
            const dimension = refreshed?.research?.dimensions.find((candidate) => candidate.id === task.dimensionId);
            const claims = refreshed?.research?.claims.filter((claim) => claim.dimensionId === task.dimensionId) ?? [];
            const sourceIds = new Set(refreshed?.research?.sources.map((source) => source.id) ?? []);
            const missingResult = task.agent === "researcher"
              ? !dimension || dimension.status !== "ready" || claims.length === 0 || claims.some((claim) => claim.evidenceRefs.some((reference) => !sourceIds.has(reference)))
              : !dimension?.review;
            if (missingResult) {
              verifiedResult = {
                ...resultValue,
                status: "failed",
                error: task.agent === "researcher"
                  ? "Researcher finished without submitting complete source-grounded claims."
                  : "Research reviewer finished without recording a review verdict.",
              };
            }
          }
        } catch (cause) {
          verifiedResult = {
            ...resultValue,
            status: "failed",
            error: cause instanceof Error ? cause.message : String(cause),
          };
        }
        updateResearchTask(detail, { taskId: detail.taskId, status: verifiedResult.status, output: verifiedResult.text, usage: verifiedResult.usage });
        if (verifiedResult.error) detail.error = verifiedResult.error;
        details.updatedAt = Date.now();
        emitUpdate();
        return verifiedResult;
      };
      const results = input.mode === "parallel"
        ? await Promise.all(taskEntries.map((entry) => runTask(entry)))
        : await taskEntries.reduce<Promise<Array<Awaited<ReturnType<typeof runTask>>>>>(async (promise, entry) => {
            const collected = await promise;
            const next = await runTask(entry, collected.at(-1)?.text);
            return [...collected, next];
          }, Promise.resolve([]));
      const summary = results.map((entry) => `${entry.taskId}: ${entry.status}${entry.error ? ` (${entry.error})` : ""}\n${entry.text.slice(0, 5000)}`).join("\n\n---\n\n");
      return { content: [{ type: "text", text: summary }], details: cloneResearchDetails(details), ...(results.some((entry) => entry.status !== "completed") ? { isError: true } : {}) };
    },
  });
  return [catalog, inspect, materialize, validate, publish, researchPrepare, researchStart, researchSnapshot, researchSubmit, researchReview, researchValidate, researchDelegate];
}
