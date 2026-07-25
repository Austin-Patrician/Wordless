import { InMemorySessionStorage, Session, type AgentTool } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory } from "@wordless/ai";
import type { AgentDriverEvent, AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { createAgentHarnessDriver } from "../src/index.ts";

function trackedTool(name: string, executed: string[]): AgentTool {
  return {
    name,
    label: name,
    description: `${name} test tool`,
    parameters: Type.Object({}),
    async execute() {
      executed.push(name);
      return { content: [{ type: "text", text: `${name} completed` }] };
    },
  };
}

async function createClarificationDriverSession(
  responses: Array<ReturnType<typeof fauxAssistantMessage> | FauxResponseFactory>,
  baseTools: AgentTool[],
) {
  const models = createModels();
  const faux = fauxProvider({ provider: `clarification-${crypto.randomUUID()}` });
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const model = faux.getModel();
  const session = new Session(new InMemorySessionStorage());
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    title: "Clarification test",
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
    journalPath: "memory",
    connectorIds: [],
    interactionMode: "clarify",
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
      activeToolNames: baseTools.map((tool) => tool.name),
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
  const driver = createAgentHarnessDriver({ id: "test", createTools: () => baseTools });
  return { driverSession: await driver.createSession(context), faux };
}

describe("clarification mode", () => {
  it("exposes only read-only clarification tools and ends after one question", async () => {
    const executed: string[] = [];
    const advertisedTools: string[][] = [];
    const systemPrompts: string[] = [];
    const { driverSession, faux } = await createClarificationDriverSession([
      (context) => {
        advertisedTools.push((context.tools ?? []).map((tool) => tool.name));
        systemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage(
          fauxToolCall("ask_clarifying_question", {
            question: "Which audience should this serve first?",
            answerType: "choice",
            options: [{ value: "existing", label: "Existing customers" }],
            recommendation: { answer: "Existing customers", value: "existing", reason: "They provide faster feedback." },
            purpose: "discovery",
          }, { id: "clarification-question" }),
          { stopReason: "toolUse" },
        );
      },
    ], [trackedTool("read", executed), trackedTool("write", executed), trackedTool("bash", executed)]);
    const events: AgentDriverEvent[] = [];
    driverSession.subscribe((event) => events.push(event));

    await driverSession.execute({ type: "prompt", text: "Help me decide the rollout." });

    expect(advertisedTools[0]).toEqual(expect.arrayContaining(["read", "ask_clarifying_question", "complete_clarification"]));
    expect(advertisedTools[0]).not.toEqual(expect.arrayContaining(["write", "bash", "request_user_input"]));
    expect(systemPrompts[0]).toContain("You are in Clarification Mode");
    expect(faux.state.callCount).toBe(1);
    expect(executed).toEqual([]);
    expect(events.some((event) => event.type === "tool.completed" && event.callId === "clarification-question" && !event.isError)).toBe(true);
  });
});
