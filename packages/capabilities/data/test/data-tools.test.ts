import { describe, expect, it, vi } from "vitest";
import type { SubagentRunner, SubagentTask } from "@wordless/agent-extension-sdk";
import type { ResearchDelegationDetails } from "@wordless/domain";
import type { AnalysisRunDescriptor, AnalysisSessionSnapshot, DataAnalysisCapabilitySnapshot } from "@wordless/protocol";
import { createDataAnalysisTools, type DataAnalysisService } from "../src/index.ts";

function run(): AnalysisRunDescriptor {
  return {
    id: "analysis-1",
    sessionId: "session-1",
    title: "Test",
    status: "working",
    outputRoot: "analysis-output/session-1/analysis-1",
    reportPath: null,
    reportContent: null,
    datasets: [],
    charts: [],
    files: [],
    errors: [],
    warnings: [],
    research: {
      researchId: "research-1",
      status: "researching",
      mode: "normal",
      objective: "Explain the market",
      questions: ["What changed?"],
      dimensions: [
        { id: "drivers", name: "Drivers", question: "What changed?", status: "ready", claimCount: 1, sourceCount: 1 },
        { id: "outlook", name: "Outlook", question: "What happens next?", status: "ready", claimCount: 1, sourceCount: 1 },
      ],
      sources: [{ id: "source-1", url: "https://example.com/", title: "Example", publisher: null, publishedAt: null, accessedAt: 1, snapshotPath: "research/source-cache/one.md", contentHash: "one", sourceType: "web" }],
      claims: [
        { id: "drivers-1", dimensionId: "drivers", statement: "Driver claim", kind: "external", evidenceRefs: ["source-1"], confidence: "medium", caveats: [] },
        { id: "outlook-1", dimensionId: "outlook", statement: "Outlook claim", kind: "external", evidenceRefs: ["source-1"], confidence: "medium", caveats: [] },
      ],
      conflicts: [],
      sourceCount: 1,
      completedDimensions: 2,
      updatedAt: 1,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

class FauxDataService implements DataAnalysisService {
  readonly calls: string[] = [];
  readonly researchStartInputs: Array<{ analysisId: string; confirmationToken: string; webResearchAvailable: boolean }> = [];
  async capabilities(): Promise<DataAnalysisCapabilitySnapshot> { return { status: "ready", command: "python", version: "Python 3", supportedFormats: ["csv"] }; }
  async catalog(): Promise<unknown> { this.calls.push("catalog"); return { files: [] }; }
  async inspect(): Promise<AnalysisRunDescriptor> { this.calls.push("inspect"); return run(); }
  async materialize(): Promise<AnalysisRunDescriptor> { this.calls.push("materialize"); return run(); }
  async validate(): Promise<AnalysisRunDescriptor> { this.calls.push("validate"); return run(); }
  async publish(): Promise<AnalysisRunDescriptor> { this.calls.push("publish"); return run(); }
  async prepareResearch() { this.calls.push("research-prepare"); return { run: run(), confirmationToken: "token" }; }
  async startResearch(_sessionId: string, _workspaceRoot: string, input: { analysisId: string; confirmationToken: string; webResearchAvailable: boolean }): Promise<AnalysisRunDescriptor> {
    this.calls.push("research-start");
    this.researchStartInputs.push(input);
    return run();
  }
  async snapshotResearchSource() { this.calls.push("research-snapshot"); return { id: "source-1", url: "https://example.com/", title: "Example", publisher: null, publishedAt: null, accessedAt: 1, snapshotPath: "research/source-cache/one.md", contentHash: "one", sourceType: "web" as const }; }
  async submitResearchDimension(): Promise<AnalysisRunDescriptor> { this.calls.push("research-submit"); return run(); }
  async reviewResearchDimension(): Promise<AnalysisRunDescriptor> { this.calls.push("research-review"); return run(); }
  async validateResearch(): Promise<AnalysisRunDescriptor> { this.calls.push("research-validate"); return run(); }
  async snapshot(): Promise<AnalysisSessionSnapshot> { return { sessionId: "session-1", capabilities: await this.capabilities(), runs: [run()] }; }
  async resolveOutput(): Promise<string> { return "report.md"; }
}

class FauxSubagentRunner implements SubagentRunner {
  async run(task: SubagentTask, options?: Parameters<SubagentRunner["run"]>[1]) {
    options?.onUpdate?.({ taskId: task.id, status: "running", tool: { callId: `${task.id}:search`, name: "mcp_web_search", input: { query: "market drivers" }, state: "running" } });
    options?.onUpdate?.({ taskId: task.id, status: "running", tool: { callId: `${task.id}:search`, name: "mcp_web_search", input: { query: "market drivers" }, output: "Found sources", state: "complete" } });
    options?.onUpdate?.({ taskId: task.id, status: "running", tool: { callId: `${task.id}:snapshot`, name: "research_snapshot", input: { url: "https://example.com" }, output: "Captured source", state: "complete" } });
    return { taskId: task.id, status: "completed" as const, text: "Research complete" };
  }
  async cancel(): Promise<void> {}
}

class BlockingSubagentRunner implements SubagentRunner {
  async run(task: SubagentTask, options?: Parameters<SubagentRunner["run"]>[1]) {
    return await new Promise<Awaited<ReturnType<SubagentRunner["run"]>>>((resolve) => {
      options?.signal?.addEventListener("abort", () => resolve({ taskId: task.id, status: "cancelled", text: "" }), { once: true });
    });
  }
  async cancel(): Promise<void> {}
}

describe("data analysis tools", () => {
  it("exposes autonomous data primitives without imposing an execution order", async () => {
    const service = new FauxDataService();
    const tools = createDataAnalysisTools(service, { sessionId: "session-1", workspaceRoot: "workspace" });
    expect(tools.map((tool) => tool.name)).toEqual(["data_catalog", "data_inspect", "data_materialize", "data_validate", "data_publish", "research_prepare", "research_start", "research_snapshot", "research_submit_dimension", "research_review_dimension", "research_validate", "research_delegate"]);
    const inspect = tools.find((tool) => tool.name === "data_inspect");
    expect(inspect).toBeDefined();
    await inspect!.execute("call-1", { paths: ["sales.csv"] });
    expect(service.calls).toEqual(["inspect"]);
  });

  it("returns a model-visible research confirmation token and accepts it when starting research", async () => {
    const service = new FauxDataService();
    const tools = createDataAnalysisTools(service, { sessionId: "session-1", workspaceRoot: "workspace", webResearchAvailable: true });
    const prepare = tools.find((tool) => tool.name === "research_prepare");
    const start = tools.find((tool) => tool.name === "research_start");
    expect(prepare).toBeDefined();
    expect(start).toBeDefined();

    const prepared = await prepare!.execute("call-prepare", {
      analysisId: "analysis-1",
      mode: "normal",
      objective: "Explain the change",
      questions: ["What caused it?"],
      dimensions: [{ id: "drivers", name: "Drivers", question: "What caused it?" }],
    });
    const visibleOutput = JSON.parse(prepared.content[0]!.type === "text" ? prepared.content[0]!.text : "{}");
    expect(visibleOutput).toMatchObject({
      id: "analysis-1",
      confirmationToken: "token",
      researchConfirmationRequired: true,
    });

    await start!.execute("call-start", { analysisId: "analysis-1", confirmationToken: visibleOutput.confirmationToken });
    expect(service.researchStartInputs).toEqual([{ analysisId: "analysis-1", confirmationToken: "token", webResearchAvailable: true }]);
  });

  it("preserves dimension metadata and ordered subagent tool history", async () => {
    const service = new FauxDataService();
    const tools = createDataAnalysisTools(service, { sessionId: "session-1", workspaceRoot: "workspace", subagentRunner: new FauxSubagentRunner() });
    const delegate = tools.find((tool) => tool.name === "research_delegate");
    expect(delegate).toBeDefined();
    const updates: ResearchDelegationDetails[] = [];
    const result = await delegate!.execute("call-delegate", {
      analysisId: "analysis-1",
      mode: "parallel",
      tasks: [
        { agent: "researcher", dimensionId: "drivers", task: "Research market drivers" },
        { agent: "researcher", dimensionId: "outlook", task: "Research market outlook" },
      ],
    }, new AbortController().signal, (update) => updates.push(update.details as ResearchDelegationDetails));
    const details = result.details as ResearchDelegationDetails;

    expect(details.tasks.map((task) => task.dimensionId)).toEqual(["drivers", "outlook"]);
    expect(details.tasks.every((task) => task.status === "completed")).toBe(true);
    expect(details.tasks[0]?.events.map((event) => [event.toolName, event.state])).toEqual([
      ["mcp_web_search", "complete"],
      ["research_snapshot", "complete"],
    ]);
    expect(details.tasks[0]?.events[0]?.toolCallId).toContain(":search");
    expect(updates.some((update) => update.tasks.some((task) => task.status === "running"))).toBe(true);
  });

  it("marks a completed researcher as failed when no structured evidence was submitted", async () => {
    const service = new FauxDataService();
    service.snapshot = async () => {
      const value = run();
      value.research = { ...value.research!, dimensions: value.research!.dimensions.map((dimension) => ({ ...dimension, status: "planned", claimCount: 0, sourceCount: 0 })), sources: [], claims: [], sourceCount: 0, completedDimensions: 0 };
      return { sessionId: "session-1", capabilities: await service.capabilities(), runs: [value] };
    };
    const tools = createDataAnalysisTools(service, { sessionId: "session-1", workspaceRoot: "workspace", subagentRunner: new FauxSubagentRunner() });
    const delegate = tools.find((tool) => tool.name === "research_delegate")!;

    const result = await delegate.execute("call-delegate", {
      analysisId: "analysis-1",
      mode: "parallel",
      tasks: [{ agent: "researcher", dimensionId: "drivers", task: "Research market drivers" }],
    });
    const details = result.details as ResearchDelegationDetails;

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(details.tasks[0]?.status).toBe("failed");
    expect(details.tasks[0]?.error).toContain("without submitting complete source-grounded claims");
  });

  it("times out a stuck research dimension without waiting indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const service = new FauxDataService();
      const tools = createDataAnalysisTools(service, { sessionId: "session-1", workspaceRoot: "workspace", subagentRunner: new BlockingSubagentRunner() });
      const delegate = tools.find((tool) => tool.name === "research_delegate")!;
      const pending = delegate.execute("call-timeout", {
        analysisId: "analysis-1",
        mode: "parallel",
        tasks: [{ agent: "researcher", dimensionId: "drivers", task: "Research market drivers" }],
      });
      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);
      const result = await pending;
      const details = result.details as ResearchDelegationDetails;
      expect(details.tasks[0]?.status).toBe("failed");
      expect(details.tasks[0]?.error).toContain("timed out after 10 minutes");
    } finally {
      vi.useRealTimers();
    }
  });
});
