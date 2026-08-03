import { InMemorySessionStorage, type AgentTool, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@wordless/ai";
import type { AgentDriverEvent, AgentDriverSessionContext, OperationApprovalRequest } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

describe("operation approval persistence", () => {
  it("journals the pending request before waiting for the user's resolution", async () => {
    const models = createModels();
    const faux = fauxProvider({ provider: `approval-${crypto.randomUUID()}` });
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("write_value", { value: "updated" }, { id: "call-1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done")]),
    ]);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const recordValue: SessionRecord = {
      id: crypto.randomUUID(), title: "Approval", workspaceId: null, runtimeRootPath: process.cwd(), mode: "everyday", entryId: "generic",
      profile: { id: "generic", version: "1" }, driverId: "generic", journalFormat: "wordless-agent-v1", workbenchId: "general", accessLevel: "default",
      model: { connectionId: model.provider, modelId: model.id }, thinkingLevel: "off", journalPath: "memory", connectorIds: [], interactionMode: "default", toolApprovalMode: "manual", pinnedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const tool: AgentTool = {
      name: "write_value",
      label: "Write value",
      description: "Write a value",
      parameters: Type.Object({ value: Type.String() }),
      async execute() {
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
      modelCapabilities: { supportsText: true, supportsVision: false, supportsToolUse: true, supportsReasoning: false, supportedThinkingLevels: ["off"], contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens },
      models, session, env: new NodeExecutionEnv({ cwd: process.cwd() }), skills: [], connectorTools: [], connectorToolPolicies: [], security: { fileRules: [], commandRules: [] }, resolveModel: () => model,
    };
    const driverSession = await createGenericAgentDriver({
      createTools: () => [tool],
      preflightOperation: async () => ({
        type: "approval",
        approval: { risk: "file-write", severity: "normal", matchedRules: [], summary: "Write value", preview: { type: "diff", path: "value.txt", before: "old", after: "updated", truncated: false } },
      }),
    }).createSession(context);
    let resolveRequested: ((approval: OperationApprovalRequest) => void) | undefined;
    const requested = new Promise<OperationApprovalRequest>((resolvePromise) => { resolveRequested = resolvePromise; });
    const unsubscribe = driverSession.subscribe((event: AgentDriverEvent) => {
      if (event.type === "approval.requested") resolveRequested?.(event.approval);
    });

    const prompt = driverSession.execute({ type: "prompt", text: "Update the value" });
    const approval = await requested;
    const pendingEntries = await session.getEntries();
    const pending = pendingEntries.map((entry) => record(entry)).find((entry) => entry?.customType === "wordless.operation-approval");
    expect(record(pending?.data)?.resolution).toBeUndefined();

    await driverSession.execute({ type: "resolve-approval", resolution: { approvalId: approval.approvalId, approved: true } });
    await prompt;
    const resolvedEntries = (await session.getEntries()).map((entry) => record(entry)).filter((entry) => entry?.customType === "wordless.operation-approval");
    expect(resolvedEntries).toHaveLength(2);
    expect(record(record(resolvedEntries[1]?.data)?.resolution)?.approved).toBe(true);
    unsubscribe();
    driverSession.dispose();
  });
});
