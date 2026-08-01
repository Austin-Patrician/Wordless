import { InMemorySessionStorage, type AgentTool, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@wordless/ai";
import type { AgentDriverEvent, AgentDriverSessionContext, OperationApprovalRequest, OperationPreflightDecision } from "@wordless/agent-driver-sdk";
import type { SessionRecord, ToolApprovalMode } from "@wordless/domain";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function approvalEntries(session: Session): Promise<Record<string, unknown>[]> {
  return session.getEntries().then((entries) => entries.map((entry) => record(entry)).filter((entry): entry is Record<string, unknown> => entry?.customType === "wordless.operation-approval"));
}

function createRecord(model: { provider: string; id: string }, title: string): SessionRecord {
  return {
    id: crypto.randomUUID(), title, workspaceId: null, runtimeRootPath: process.cwd(), mode: "everyday", entryId: "generic",
    profile: { id: "generic", version: "1" }, driverId: "generic", journalFormat: "wordless-agent-v1", workbenchId: "general", accessLevel: "default",
    model: { connectionId: model.provider, modelId: model.id }, journalPath: "memory", connectorIds: [], interactionMode: "default", toolApprovalMode: "manual", pinnedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
}

async function createApprovalScenario(options: {
  decision?: "approval" | "block";
  mode: ToolApprovalMode;
  severity: OperationApprovalRequest["severity"];
}) {
  const models = createModels();
  const faux = fauxProvider({ provider: `approval-mode-${crypto.randomUUID()}` });
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("write_value", { value: "updated" }, { id: "call-1" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("Done")]),
  ]);
  const model = faux.getModel();
  const session = new Session(new InMemorySessionStorage());
  const recordValue = createRecord(model, "Approval mode");
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
    toolApprovalMode: options.mode,
  };
  const preflightOperation = async (): Promise<OperationPreflightDecision> => options.decision === "block"
    ? { type: "block", reason: "Blocked by workspace policy" }
    : {
        type: "approval",
        approval: { risk: "file-write", severity: options.severity, matchedRules: [], summary: "Write value", preview: { type: "diff", path: "value.txt", before: "old", after: "updated", truncated: false } },
      };
  const driverSession = await createGenericAgentDriver({ createTools: () => [tool], preflightOperation }).createSession(context);
  const events: AgentDriverEvent[] = [];
  let resolveRequested: ((approval: OperationApprovalRequest) => void) | undefined;
  const approvalRequested = new Promise<OperationApprovalRequest>((resolve) => { resolveRequested = resolve; });
  driverSession.subscribe((event) => {
    events.push(event);
    if (event.type === "approval.requested") resolveRequested?.(event.approval);
  });
  return { approvalRequested, driverSession, events, executions: () => executions, session };
}

describe("automatic operation approval", () => {
  it("auto-approves normal operations without emitting user-action events", async () => {
    const scenario = await createApprovalScenario({ mode: "auto", severity: "normal" });

    await scenario.driverSession.execute({ type: "prompt", text: "Update the value" });

    expect(scenario.executions()).toBe(1);
    expect(scenario.events.some((event) => event.type === "approval.requested" || event.type === "approval.resolved")).toBe(false);
    const approvals = await approvalEntries(scenario.session);
    expect(approvals).toHaveLength(2);
    expect(record(record(approvals[1]?.data)?.resolution)?.approved).toBe(true);
    scenario.driverSession.dispose();
  });

  it("approves an already pending normal operation when switching to auto", async () => {
    const scenario = await createApprovalScenario({ mode: "manual", severity: "normal" });
    const prompt = scenario.driverSession.execute({ type: "prompt", text: "Update the value" });
    await scenario.approvalRequested;

    await scenario.driverSession.execute({ type: "set-tool-approval-mode", mode: "auto" });
    await prompt;

    expect(scenario.executions()).toBe(1);
    expect(scenario.events.some((event) => event.type === "approval.resolved" && event.resolution.approved)).toBe(true);
    scenario.driverSession.dispose();
  });

  it("keeps high-risk operations pending in auto mode", async () => {
    const scenario = await createApprovalScenario({ mode: "auto", severity: "high" });
    const prompt = scenario.driverSession.execute({ type: "prompt", text: "Update the value" });
    const approval = await scenario.approvalRequested;

    expect(scenario.executions()).toBe(0);
    await scenario.driverSession.execute({ type: "resolve-approval", resolution: { approvalId: approval.approvalId, approved: true } });
    await prompt;

    expect(scenario.executions()).toBe(1);
    scenario.driverSession.dispose();
  });

  it("auto-approves high-risk operations in bypass mode without user-action events", async () => {
    const scenario = await createApprovalScenario({ mode: "bypass", severity: "high" });

    await scenario.driverSession.execute({ type: "prompt", text: "Update the value" });

    expect(scenario.executions()).toBe(1);
    expect(scenario.events.some((event) => event.type === "approval.requested" || event.type === "approval.resolved")).toBe(false);
    const approvals = await approvalEntries(scenario.session);
    expect(record(record(approvals[1]?.data)?.resolution)?.approved).toBe(true);
    scenario.driverSession.dispose();
  });

  it("approves an already pending high-risk operation when switching to bypass", async () => {
    const scenario = await createApprovalScenario({ mode: "auto", severity: "high" });
    const prompt = scenario.driverSession.execute({ type: "prompt", text: "Update the value" });
    await scenario.approvalRequested;

    await scenario.driverSession.execute({ type: "set-tool-approval-mode", mode: "bypass" });
    await prompt;

    expect(scenario.executions()).toBe(1);
    expect(scenario.events.some((event) => event.type === "approval.resolved" && event.resolution.approved)).toBe(true);
    scenario.driverSession.dispose();
  });

  it("does not bypass blocked operations", async () => {
    const scenario = await createApprovalScenario({ decision: "block", mode: "bypass", severity: "high" });

    await scenario.driverSession.execute({ type: "prompt", text: "Update the value" });

    expect(scenario.executions()).toBe(0);
    expect(await approvalEntries(scenario.session)).toHaveLength(0);
    scenario.driverSession.dispose();
  });

  it("keeps user requests pending in bypass mode", async () => {
    const models = createModels();
    const faux = fauxProvider({ provider: `bypass-user-request-${crypto.randomUUID()}` });
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("request_user_input", { title: "Choose a direction", fields: [{ id: "confirmed", type: "confirm", label: "Continue?", required: true }] }, { id: "request-1" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done")]),
    ]);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const recordValue = createRecord(model, "Bypass user request");
    const context: AgentDriverSessionContext = {
      record: recordValue,
      profile: { reference: recordValue.profile, driverId: "generic", modelRequirements: { requiresToolUse: true }, systemPrompt: "Ask the user.", activeToolNames: [], capabilityIds: [], skills: [], artifactKinds: [], workbenchId: "general" },
      model,
      modelCapabilities: { supportsText: true, supportsVision: false, supportsToolUse: true, supportsReasoning: false, contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens },
      models, session, env: new NodeExecutionEnv({ cwd: process.cwd() }), skills: [], connectorTools: [], connectorToolPolicies: [], security: { fileRules: [], commandRules: [] }, resolveModel: () => model,
      toolApprovalMode: "bypass",
    };
    const driverSession = await createGenericAgentDriver().createSession(context);
    let resolveRequested: ((requestId: string) => void) | undefined;
    const requested = new Promise<string>((resolve) => { resolveRequested = resolve; });
    const events: AgentDriverEvent[] = [];
    driverSession.subscribe((event) => {
      events.push(event);
      if (event.type === "user-request.requested") resolveRequested?.(event.request.requestId);
    });
    const prompt = driverSession.execute({ type: "prompt", text: "Ask me first" });
    const requestId = await requested;

    expect(events.some((event) => event.type === "user-request.requested")).toBe(true);
    await driverSession.execute({ type: "resolve-user-request", resolution: { requestId, status: "submitted", answers: { confirmed: true } } });
    await prompt;

    expect(events.some((event) => event.type === "user-request.resolved")).toBe(true);
    driverSession.dispose();
  });
});
