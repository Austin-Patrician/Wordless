import { describe, expect, it } from "vitest";
import type { AnalysisRunDescriptor, AnalysisSessionSnapshot, DataAnalysisCapabilitySnapshot } from "@wordless/protocol";
import { createDataAnalysisTools, type DataAnalysisService } from "../src/index.ts";

function run(): AnalysisRunDescriptor {
  return { id: "analysis-1", sessionId: "session-1", title: "Test", status: "working", outputRoot: "analysis-output/session-1/analysis-1", reportPath: null, reportContent: null, datasets: [], charts: [], files: [], errors: [], warnings: [], createdAt: 1, updatedAt: 1 };
}

class FauxDataService implements DataAnalysisService {
  readonly calls: string[] = [];
  async capabilities(): Promise<DataAnalysisCapabilitySnapshot> { return { status: "ready", command: "python", version: "Python 3", supportedFormats: ["csv"] }; }
  async catalog(): Promise<unknown> { this.calls.push("catalog"); return { files: [] }; }
  async inspect(): Promise<AnalysisRunDescriptor> { this.calls.push("inspect"); return run(); }
  async materialize(): Promise<AnalysisRunDescriptor> { this.calls.push("materialize"); return run(); }
  async validate(): Promise<AnalysisRunDescriptor> { this.calls.push("validate"); return run(); }
  async publish(): Promise<AnalysisRunDescriptor> { this.calls.push("publish"); return run(); }
  async prepareResearch() { this.calls.push("research-prepare"); return { run: run(), confirmationToken: "token" }; }
  async startResearch(): Promise<AnalysisRunDescriptor> { this.calls.push("research-start"); return run(); }
  async snapshotResearchSource() { this.calls.push("research-snapshot"); return { id: "source-1", url: "https://example.com/", title: "Example", publisher: null, publishedAt: null, accessedAt: 1, snapshotPath: "research/source-cache/one.md", contentHash: "one", sourceType: "web" as const }; }
  async submitResearchDimension(): Promise<AnalysisRunDescriptor> { this.calls.push("research-submit"); return run(); }
  async reviewResearchDimension(): Promise<AnalysisRunDescriptor> { this.calls.push("research-review"); return run(); }
  async validateResearch(): Promise<AnalysisRunDescriptor> { this.calls.push("research-validate"); return run(); }
  async snapshot(): Promise<AnalysisSessionSnapshot> { return { sessionId: "session-1", capabilities: await this.capabilities(), runs: [run()] }; }
  async resolveOutput(): Promise<string> { return "report.md"; }
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
});
