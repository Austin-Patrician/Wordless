import { InMemorySessionStorage, Session, type AgentTool } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@wordless/ai";
import type { AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SpreadsheetOfficeService } from "@wordless/capability-office";
import type { SessionRecord } from "@wordless/domain";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { compileSpreadsheetToolOperations, createSpreadsheetAgentDriver } from "../src/index.ts";

function unused(): never {
  throw new Error("Office service should not run during driver startup");
}

const office: SpreadsheetOfficeService = {
  catalogSpreadsheets: async () => ({ artifacts: [] }),
  spreadsheetCapabilities: unused,
  createSpreadsheet: unused,
  openSpreadsheet: unused,
  importSpreadsheetData: unused,
  helpSpreadsheet: unused,
  readSpreadsheet: unused,
  profileSpreadsheetRange: unused,
  previewSpreadsheetOperations: unused,
  applySpreadsheet: unused,
  renderSpreadsheet: unused,
  qualityScanSpreadsheet: unused,
  publishSpreadsheet: unused,
  focusSpreadsheetLocator: unused,
  clearSpreadsheetMarks: unused,
};

describe("spreadsheet driver startup", () => {
  it("compiles high-level spreadsheet tools into deterministic OfficeCLI operations", () => {
    expect(compileSpreadsheetToolOperations("spreadsheet_create_chart", {
      artifactId: "workbook-1",
      sheet: "Summary",
      dataRange: "A1:B12",
      chartType: "column",
      title: "Monthly revenue",
      anchor: "D2",
    })).toEqual([{
      command: "add",
      parent: "/Summary",
      type: "chart",
      props: { dataRange: "A1:B12", chartType: "column", title: "Monthly revenue", anchor: "D2" },
    }]);
    expect(compileSpreadsheetToolOperations("spreadsheet_create_chart", {
      artifactId: "workbook-1",
      sheet: "Summary",
      chartType: "column",
      categories: "Summary!A3:A9",
      series: [{ name: "Revenue", values: "Summary!C3:C9", categories: "Summary!A3:A9", color: "#587136" }],
    })).toEqual([{
      command: "add",
      parent: "/Summary",
      type: "chart",
      props: {
        categories: "Summary!A3:A9",
        chartType: "column",
        "series1.name": "Revenue",
        "series1.values": "Summary!C3:C9",
        "series1.categories": "Summary!A3:A9",
        "series1.color": "#587136",
      },
    }]);
    expect(compileSpreadsheetToolOperations("spreadsheet_sort_filter", {
      artifactId: "workbook-1",
      sheet: "Data",
      range: "A1:F200",
      sort: "C:desc",
      header: true,
      filterColumn: 2,
      filter: ">100",
    })).toEqual([
      { command: "set", path: "/Data/A1:F200", props: { sort: "C:desc", sortHeader: true } },
      { command: "add", parent: "/Data", type: "autofilter", props: { range: "A1:F200", criteria2: ">100" } },
    ]);
  });

  it("creates a session and reaches the model on the first prompt", async () => {
    const advertisedTools: string[][] = [];
    const workspacePreflightCalls: string[] = [];
    const models = createModels();
    const faux = fauxProvider({ provider: `spreadsheet-${crypto.randomUUID()}` });
    models.setProvider(faux.provider);
    faux.setResponses([
      (request) => {
        advertisedTools.push((request.tools ?? []).map((tool) => tool.name));
        return fauxAssistantMessage([fauxToolCall("read", {}, { id: "read-1" })], { stopReason: "toolUse" });
      },
      fauxAssistantMessage([fauxToolCall("spreadsheet_catalog", {}, { id: "catalog-1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Ready"),
    ]);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const record: SessionRecord = {
      id: crypto.randomUUID(), title: "Spreadsheet", workspaceId: null, runtimeRootPath: process.cwd(), mode: "everyday", entryId: "spreadsheet",
      profile: { id: "excel", version: "1" }, driverId: "spreadsheet", journalFormat: "wordless-agent-v1", workbenchId: "workbook", accessLevel: "default",
      model: { connectionId: model.provider, modelId: model.id }, journalPath: "memory", connectorIds: [], interactionMode: "default", toolApprovalMode: "manual", pinnedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const context: AgentDriverSessionContext = {
      record,
      profile: {
        reference: record.profile, driverId: "spreadsheet", modelRequirements: { requiresToolUse: true }, systemPrompt: "Use spreadsheet tools.",
        activeToolNames: ["read", "spreadsheet_catalog", "spreadsheet_create", "spreadsheet_open", "spreadsheet_import", "spreadsheet_help", "spreadsheet_read", "spreadsheet_edit", "spreadsheet_profile_range", "spreadsheet_format_range", "spreadsheet_create_table", "spreadsheet_create_chart", "spreadsheet_create_pivot", "spreadsheet_apply_validation", "spreadsheet_apply_conditional_format", "spreadsheet_sort_filter", "spreadsheet_render", "spreadsheet_quality_scan", "spreadsheet_publish"],
        capabilityIds: ["filesystem", "shell", "office"], skills: [], artifactKinds: ["spreadsheet"], workbenchId: "workbook",
      },
      model,
      modelCapabilities: { supportsText: true, supportsVision: false, supportsToolUse: true, supportsReasoning: false, contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens },
      models, session, env: new NodeExecutionEnv({ cwd: process.cwd() }), skills: [], connectorTools: [], connectorToolPolicies: [], security: { fileRules: [], commandRules: [] }, resolveModel: () => model,
    };
    const readTool: AgentTool = {
      name: "read",
      label: "Read file",
      description: "Read a workspace text file.",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "source material" }], details: {} };
      },
    };
    const driverSession = await createSpreadsheetAgentDriver(office, {
      createWorkspaceTools: () => [readTool],
      async preflightWorkspaceOperation(_driverContext, request) {
        workspacePreflightCalls.push(request.toolName);
        return { type: "allow" };
      },
    }).createSession(context);
    await driverSession.execute({ type: "prompt", text: "Create a budget workbook." });
    expect(faux.state.callCount).toBe(3);
    expect(advertisedTools[0]).toEqual(expect.arrayContaining(["read", "spreadsheet_catalog", "spreadsheet_read", "spreadsheet_edit"]));
    expect(workspacePreflightCalls).toEqual(["read"]);
    driverSession.dispose();
  });
});
