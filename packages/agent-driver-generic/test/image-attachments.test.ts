import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider } from "@wordless/ai";
import { formatPromptWithWorkspaceAttachments, type AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

function contextFor(model: ReturnType<ReturnType<typeof fauxProvider>["getModel"]>, models: ReturnType<typeof createModels>, session: Session): AgentDriverSessionContext {
  const record: SessionRecord = {
    id: crypto.randomUUID(), title: "Images", workspaceId: null, runtimeRootPath: process.cwd(), mode: "everyday",
    entryId: "test", profile: { id: "test", version: "1" }, driverId: "test", journalFormat: "wordless-agent-v1",
    workbenchId: "conversation", accessLevel: "full", model: { connectionId: model.provider, modelId: model.id },
    thinkingLevel: "off", journalPath: "memory", connectorIds: [], interactionMode: "default", toolApprovalMode: "manual",
    pinnedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  return {
    record, profile: { reference: record.profile, driverId: "test", modelRequirements: {}, systemPrompt: "You are helpful.", activeToolNames: [], capabilityIds: [], skills: [], artifactKinds: [], workbenchId: "conversation" },
    model, modelCapabilities: { supportsText: true, supportsVision: true, supportsToolUse: true, supportsReasoning: false, supportedThinkingLevels: ["off"], contextWindow: model.contextWindow, maxOutputTokens: model.maxTokens },
    models, session, env: new NodeExecutionEnv({ cwd: process.cwd() }), skills: [], connectorTools: [], connectorToolPolicies: [], security: { fileRules: [], commandRules: [] }, resolveModel: () => model,
    resolvePromptImage: async () => ({ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }),
  };
}

describe("image attachment hydration", () => {
  it("hydrates staged image references only at provider-request time", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const prompt = `Describe this${formatPromptWithWorkspaceAttachments([{ id: "img-1", path: ".attachments/img-1-photo.png", previewPath: ".attachments/img-1-photo.png", name: "photo.png", mediaType: "image/png", size: 12 }])}`;
    let providerImageCount = 0;
    faux.setResponses([(request) => {
      providerImageCount = request.messages.flatMap((message) => typeof message.content === "string" ? [] : message.content).filter((block) => block.type === "image").length;
      return fauxAssistantMessage("ok");
    }]);
    const driverSession = await createGenericAgentDriver().createSession(contextFor(model, models, session));
    await driverSession.execute({ type: "prompt", text: prompt, submission: { messageId: "message-1", submittedAt: Date.now() } });
    expect(providerImageCount).toBe(1);
    const entries = await session.getEntries();
    expect(JSON.stringify(entries)).not.toContain("aW1hZ2U=");
    driverSession.dispose();
  });
});
