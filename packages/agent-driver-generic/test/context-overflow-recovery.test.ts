import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider } from "@wordless/ai";
import type { AgentDriverEvent, AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { describe, expect, it } from "vitest";
import { createAgentHarnessDriver } from "../src/index.ts";

function overflowResponse() {
  return fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage: "Your input exceeds the context window of this model",
  });
}

async function createDriverSession(responses: ReturnType<typeof fauxAssistantMessage>[]) {
  const models = createModels();
  const faux = fauxProvider({ provider: `context-overflow-${crypto.randomUUID()}` });
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const model = faux.getModel();
  const session = new Session(new InMemorySessionStorage());
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    title: "Context overflow test",
    workspaceId: null,
    runtimeRootPath: process.cwd(),
    mode: "everyday",
    entryId: "test",
    profile: { id: "test", version: "1" },
    driverId: "test",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel: "full",
    model: { connectionId: model.provider, modelId: model.id },
    thinkingLevel: "off",
    journalPath: "memory",
    toolApprovalMode: "manual",
    pinnedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const context: AgentDriverSessionContext = {
    record,
    profile: {
      reference: record.profile,
      driverId: "test",
      modelRequirements: {},
      systemPrompt: "You are helpful.",
      activeToolNames: [],
      capabilityIds: [],
      skills: [],
      artifactKinds: [],
      workbenchId: "conversation",
    },
    model,
    modelCapabilities: {
      supportsText: true,
      supportsVision: true,
      supportsToolUse: true,
      supportsReasoning: false,
      supportedThinkingLevels: ["off"],
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
    },
    models,
    session,
    env: new NodeExecutionEnv({ cwd: process.cwd() }),
    skills: [],
    connectorTools: [],
    connectorToolPolicies: [],
    security: { fileRules: [], commandRules: [] },
    resolveModel: () => model,
  };
  const driver = createAgentHarnessDriver({ id: "test", createTools: () => [] });
  return { driverSession: await driver.createSession(context), events: [] as AgentDriverEvent[], faux, session };
}

describe("context overflow recovery", () => {

  it("retries a transient model failure through the shared assistant retry loop", { timeout: 20_000 }, async () => {
    const { driverSession, events, faux, session } = await createDriverSession([
      fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." }),
      fauxAssistantMessage("recovered response"),
    ]);
    driverSession.subscribe((event) => events.push(event));

    await driverSession.execute({ type: "prompt", text: "continue" });

    expect(faux.state.callCount).toBe(2);
    expect(events.filter((event) => event.type === "model.retry.scheduled")).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.retry.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "message.completed" && event.message.status === "error")).toHaveLength(0);
    expect(events.some((event) => event.type === "message.completed" && event.message.blocks.some((block) => block.type === "text" && block.text === "recovered response"))).toBe(true);
    expect((await session.buildContext()).messages.some((message) => message.role === "assistant" && message.stopReason === "error")).toBe(false);
  });

  it("compacts once, removes the failed response from active context, and continues", async () => {
    const { driverSession, events, faux, session } = await createDriverSession([
      fauxAssistantMessage("prior response"),
      overflowResponse(),
      fauxAssistantMessage("summary"),
      fauxAssistantMessage("recovered response"),
    ]);
    driverSession.subscribe((event) => events.push(event));

    await driverSession.execute({ type: "prompt", text: `history ${"x".repeat(90_000)}` });
    events.length = 0;
    await driverSession.execute({ type: "prompt", text: "continue" });

    expect(faux.state.callCount).toBe(4);
    expect(events.filter((event) => event.type === "context.compaction.started" && event.trigger === "overflow")).toHaveLength(1);
    const assistantStarts = events.filter((event) => event.type === "message.started" && event.message.role === "assistant");
    const compactionCompleted = events.find((event) => event.type === "context.compaction.completed" && event.compaction.trigger === "overflow");
    expect(assistantStarts).toHaveLength(2);
    expect(compactionCompleted).toBeDefined();
    expect(compactionCompleted?.recoveredFailureMessageId).toBe(assistantStarts[0]?.message.id);
    expect(compactionCompleted?.recoveredFailureMessageId).not.toBe(assistantStarts.at(-1)?.message.id);
    expect(events.filter((event) => event.type === "message.completed" && event.message.status === "error")).toHaveLength(0);
    expect(events.some((event) => event.type === "message.completed" && event.message.blocks.some((block) => block.type === "text" && block.text === "recovered response"))).toBe(true);
    expect((await session.buildContext()).messages.some((message) => message.role === "assistant" && message.stopReason === "error")).toBe(false);
  });

  it("stops after the retry also exceeds the context window", async () => {
    const { driverSession, events, faux } = await createDriverSession([
      fauxAssistantMessage("prior response"),
      overflowResponse(),
      fauxAssistantMessage("summary"),
      overflowResponse(),
    ]);
    driverSession.subscribe((event) => events.push(event));

    await driverSession.execute({ type: "prompt", text: `history ${"x".repeat(90_000)}` });
    events.length = 0;
    await driverSession.execute({ type: "prompt", text: "continue" });

    expect(faux.state.callCount).toBe(4);
    expect(events.filter((event) => event.type === "context.compaction.started" && event.trigger === "overflow")).toHaveLength(1);
    expect(events.filter((event) => event.type === "context.compaction.failed" && event.trigger === "overflow")).toHaveLength(1);
    expect(events.filter((event) => event.type === "message.completed" && event.message.status === "error")).toHaveLength(1);
  });
});
