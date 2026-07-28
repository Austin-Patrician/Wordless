import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider } from "@wordless/ai";
import type { AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SpreadsheetOfficeService } from "@wordless/capability-office";
import type { SessionRecord } from "@wordless/domain";
import { describe, expect, it } from "vitest";
import { createSpreadsheetAgentDriver } from "../src/index.ts";

function unused(): never {
  throw new Error("Office service should not run during driver startup");
}

const office: SpreadsheetOfficeService = {
  catalogSpreadsheets: unused,
  createSpreadsheet: unused,
  openSpreadsheet: unused,
  importSpreadsheetData: unused,
  helpSpreadsheet: unused,
  readSpreadsheet: unused,
  applySpreadsheet: unused,
  renderSpreadsheet: unused,
  qualityScanSpreadsheet: unused,
  publishSpreadsheet: unused,
};

describe("spreadsheet driver startup", () => {
  it("creates a session and reaches the model on the first prompt", async () => {
    const models = createModels();
    const faux = fauxProvider({ provider: `spreadsheet-${crypto.randomUUID()}` });
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage("Ready")]);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const record: SessionRecord = {
      id: crypto.randomUUID(), title: "Spreadsheet", workspaceId: null, runtimeRootPath: process.cwd(), mode: "everyday", entryId: "spreadsheet",
      profile: { id: "excel", version: "1" }, driverId: "spreadsheet", journalFormat: "wordless-agent-v1", workbenchId: "workbook", accessLevel: "default",
      model: { connectionId: model.provider, modelId: model.id }, journalPath: "memory", connectorIds: [], interactionMode: "default", pinnedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const context: AgentDriverSessionContext = {
      record,
      profile: {
        reference: record.profile, driverId: "spreadsheet", modelRequirements: { requiresToolUse: true }, systemPrompt: "Use spreadsheet tools.",
        activeToolNames: ["spreadsheet_catalog", "spreadsheet_create", "spreadsheet_open", "spreadsheet_import", "spreadsheet_help", "spreadsheet_read", "spreadsheet_edit", "spreadsheet_render", "spreadsheet_quality_scan", "spreadsheet_publish"],
        capabilityIds: ["filesystem", "office"], skills: [], artifactKinds: ["spreadsheet"], workbenchId: "workbook",
      },
      model,
      modelCapabilities: { supportsText: true, supportsVision: false, supportsToolUse: true, supportsReasoning: false, contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens },
      models, session, env: new NodeExecutionEnv({ cwd: process.cwd() }), skills: [], connectorTools: [], connectorToolPolicies: [], security: { fileRules: [], commandRules: [] }, resolveModel: () => model,
    };
    const driverSession = await createSpreadsheetAgentDriver(office).createSession(context);
    await driverSession.execute({ type: "prompt", text: "Create a budget workbook." });
    expect(faux.state.callCount).toBe(1);
  });
});
