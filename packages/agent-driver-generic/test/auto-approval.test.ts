import { InMemorySessionStorage, type AgentTool, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@wordless/ai";
import type { AgentDriverEvent, AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

describe("automatic operation approval", () => {
  it("auto-approves normal operations without emitting user-action events", async () => {
    const models = createModels();
    const faux = fauxProvider({ provider: `auto-approval-${crypto.randomUUID()}` });
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("write_value", { value: "updated" }, { id: "call-1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done")]),
    ]);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const recordValue: SessionRecord = {
      id: crypto.randomUUID(), title: "Auto approval", workspaceId: null, runtimeRootPath: process.cwd(), mode: "everyday", entryId: "generic",
      profile: { id: "generic", version: "1" }, driverId: "generic", journalFormat: "wordless-agent-v1", workbenchId: "general", accessLevel: "default",
      model: { connectionId: model.provider, modelId: model.id }, journalPath: "memory", connectorIds: [], interactionMode: "default", pinnedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    let executions = 0;
    const tool: AgentTool = {
      name: "write_value",
      label: "Write value",
      description: "Write a value",
      parameters: Type.Object({ value: Type.String() }),
      async execute() {
        executions += 1;
        return { content: [{ type: "text", text: "updated" }], details: {} };
      },
    };
    const context: AgentDriverSessionContext = {
      record: recordValue,
      profile: {
        reference: recordValue.profile, driverId: "generic", modelRequirements: { requiresToolUse: true }, systemPrompt: "Use the tool.",
        activeToolNames: [tool.name], capabilityIds: ["filesystem"], skills: [], artifactKinds: [], workbenchId: "general",
      },
      model,
      modelCapabilities: { supportsText: true, supportsVision: false, supportsToolUse: true, supportsReasoning: false, contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens },
      models, session, env: new NodeExecutionEnv({ cwd: process.cwd() }), skills: [], connectorTools: [], connectorToolPolicies: [], security: { fileRules: [], commandRules: [] }, resolveModel: () => model,
      toolApprovalMode: "auto",
    };
    const driverSession = await createGenericAgentDriver({
      createTools: () => [tool],
      preflightOperation: async () => ({
        type: "approval",
        approval: { risk: "file-write", severity: "normal", matchedRules: [], summary: "Write value", preview: { type: "diff", path: "value.txt", before: "old", after: "updated", truncated: false } },
      }),
    }).createSession(context);
    const events: AgentDriverEvent[] = [];
    driverSession.subscribe((event) => events.push(event));

    await driverSession.execute({ type: "prompt", text: "Update the value" });

    expect(executions).toBe(1);
    expect(events.some((event) => event.type === "approval.requested" || event.type === "approval.resolved")).toBe(false);
    const approvals = (await session.getEntries()).map((entry) => record(entry)).filter((entry) => entry?.customType === "wordless.operation-approval");
    expect(approvals).toHaveLength(2);
    expect(record(record(approvals[1]?.data)?.resolution)?.approved).toBe(true);
    driverSession.dispose();
  });
});
