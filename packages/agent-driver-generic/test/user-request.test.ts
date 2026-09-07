import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@wordless/ai";
import type {
  AgentDriverEvent,
  AgentDriverSessionContext,
} from "@wordless/agent-driver-sdk";
import type { SessionRecord, UserRequest } from "@wordless/domain";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

function createRecord(
  model: { provider: string; id: string },
): SessionRecord {
  return {
    id: crypto.randomUUID(),
    title: "User request",
    workspaceId: null,
    runtimeRootPath: process.cwd(),
    mode: "everyday",
    entryId: "generic",
    profile: { id: "generic", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId: "general",
    accessLevel: "default",
    model: { connectionId: model.provider, modelId: model.id },
    thinkingLevel: "off",
    journalPath: "memory",
    connectorIds: [],
    interactionMode: "default",
    toolApprovalMode: "manual",
    pinnedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe("request_user_input custom answers", () => {
  it("normalizes choice fields and validates custom answers in the execution path", async () => {
    const models = createModels();
    const faux = fauxProvider({
      provider: `user-request-${crypto.randomUUID()}`,
    });
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "request_user_input",
            {
              title: "Choose requirements",
              fields: [
                {
                  id: "direction",
                  type: "select",
                  label: "Direction",
                  required: true,
                  options: [{ value: "preset", label: "Preset" }],
                },
                {
                  id: "features",
                  type: "multi-select",
                  label: "Features",
                  required: true,
                  options: [{ value: "export", label: "Export" }],
                },
              ],
            },
            { id: "request-1" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Done")]),
    ]);
    const model = faux.getModel();
    const record = createRecord(model);
    const context: AgentDriverSessionContext = {
      record,
      profile: {
        reference: record.profile,
        driverId: "generic",
        modelRequirements: { requiresToolUse: true },
        systemPrompt: "Ask the user.",
        activeToolNames: [],
        capabilityIds: [],
        skills: [],
        artifactKinds: [],
        workbenchId: "general",
      },
      model,
      modelCapabilities: {
        supportsText: true,
        supportsVision: false,
        supportsToolUse: true,
        supportsReasoning: false,
        supportedThinkingLevels: ["off"],
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxTokens,
      },
      models,
      session: new Session(new InMemorySessionStorage()),
      env: new NodeExecutionEnv({ cwd: process.cwd() }),
      skills: [],
      connectorTools: [],
      connectorToolPolicies: [],
      security: { fileRules: [], commandRules: [] },
      resolveModel: () => model,
      toolApprovalMode: "manual",
    };
    const driverSession = await createGenericAgentDriver().createSession(context);
    const events: AgentDriverEvent[] = [];
    let resolveRequested: ((request: UserRequest) => void) | undefined;
    const requested = new Promise<UserRequest>((resolve) => {
      resolveRequested = resolve;
    });
    driverSession.subscribe((event) => {
      events.push(event);
      if (event.type === "user-request.requested")
        resolveRequested?.(event.request);
    });

    const prompt = driverSession.execute({
      type: "prompt",
      text: "Ask me first",
    });
    const request = await requested;

    expect(request.fields).toEqual([
      expect.objectContaining({ type: "select", allowCustom: true }),
      expect.objectContaining({ type: "multi-select", allowCustom: true }),
    ]);
    await expect(
      driverSession.execute({
        type: "resolve-user-request",
        resolution: {
          requestId: request.requestId,
          status: "submitted",
          answers: { direction: ["preset"] },
        },
      }),
    ).rejects.toThrow("selected response is invalid");
    await expect(
      driverSession.execute({
        type: "resolve-user-request",
        resolution: {
          requestId: request.requestId,
          status: "submitted",
          answers: {
            direction: "x".repeat(4_001),
            features: ["export"],
          },
        },
      }),
    ).rejects.toThrow("custom response is too long");
    await expect(
      driverSession.execute({
        type: "resolve-user-request",
        resolution: {
          requestId: request.requestId,
          status: "submitted",
          answers: { direction: "   ", features: ["   "] },
        },
      }),
    ).rejects.toThrow("required response is missing");

    await driverSession.execute({
      type: "resolve-user-request",
      resolution: {
        requestId: request.requestId,
        status: "submitted",
        answers: {
          direction: "  custom direction  ",
          features: ["export", "  custom feature  "],
        },
      },
    });
    await prompt;

    expect(
      events.find((event) => event.type === "user-request.resolved"),
    ).toEqual(
      expect.objectContaining({
        resolution: expect.objectContaining({
          answers: {
            direction: "custom direction",
            features: ["export", "custom feature"],
          },
        }),
      }),
    );
    driverSession.dispose();
  });
});
