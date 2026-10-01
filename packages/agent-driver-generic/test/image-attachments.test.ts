import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider } from "@wordless/ai";
import { formatPromptWithWorkspaceAttachments, type AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

function contextFor(
  model: ReturnType<ReturnType<typeof fauxProvider>["getModel"]>,
  models: ReturnType<typeof createModels>,
  session: Session,
  overrides: Partial<AgentDriverSessionContext> = {},
): AgentDriverSessionContext {
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
    ...overrides,
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

describe("非多模态模型拿到的图片附件", () => {
  it("不把图片当图片递过去,而且明说看不了 —— 不再写「用工作区工具看看这个文件」", async () => {
    // `input` 里没有 image:这就是"看不了图的模型"(判定只认这一处)。
    const faux = fauxProvider({ models: [{ id: "text-only", name: "Text only", input: ["text"] }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const prompt = `Describe this${formatPromptWithWorkspaceAttachments([{ id: "img-1", path: ".attachments/img-1-photo.png", previewPath: ".attachments/img-1-photo.png", name: "photo.png", mediaType: "image/png", size: 12 }])}`;
    let imageCount = 0;
    let promptText = "";
    let resolveCalls = 0;
    faux.setResponses([(request) => {
      const blocks = request.messages.flatMap((message) => typeof message.content === "string" ? [] : message.content);
      imageCount = blocks.filter((block) => block.type === "image").length;
      promptText = blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
      return fauxAssistantMessage("ok");
    }]);
    const driverSession = await createGenericAgentDriver().createSession(contextFor(model, models, session, {
      // 即使宿主**能**提供图片,模型读不了就不该去读 —— 断言这个"不读"。
      resolvePromptImage: async () => {
        resolveCalls += 1;
        return { type: "image", mimeType: "image/png", data: "aW1hZ2U=" };
      },
    }));
    await driverSession.execute({ type: "prompt", text: prompt, submission: { messageId: "message-1", submittedAt: Date.now() } });

    expect(imageCount).toBe(0);
    expect(resolveCalls).toBe(0);
    expect(promptText).toContain("This model cannot view images");
    // 那句做不到的话必须消失:没有工具能从 PNG 里取字。
    expect(promptText).not.toContain("Inspect this user-attached file with the available workspace tools when needed.");
    driverSession.dispose();
  });

  it("非图片附件照旧:文本文件确实能用工作区工具读", async () => {
    const faux = fauxProvider({ models: [{ id: "text-only", name: "Text only", input: ["text"] }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const prompt = `Summarize this${formatPromptWithWorkspaceAttachments([{ id: "doc-1", path: ".attachments/doc-1-notes.md", previewPath: ".attachments/doc-1-notes.md", name: "notes.md", mediaType: "text/markdown", size: 40 }])}`;
    let promptText = "";
    faux.setResponses([(request) => {
      promptText = request.messages.flatMap((message) => typeof message.content === "string" ? [message.content] : message.content.flatMap((block) => block.type === "text" ? [block.text] : [])).join("\n");
      return fauxAssistantMessage("ok");
    }]);
    const driverSession = await createGenericAgentDriver().createSession(contextFor(model, models, session));
    await driverSession.execute({ type: "prompt", text: prompt, submission: { messageId: "message-1", submittedAt: Date.now() } });

    expect(promptText).toContain("Inspect this user-attached file with the available workspace tools when needed.");
    expect(promptText).not.toContain("cannot view images");
    driverSession.dispose();
  });
});

describe("非多模态模型 + 本地 OCR", () => {
  it("读得到字时把文字给它,并标注这是机器识别的结果", async () => {
    const faux = fauxProvider({ models: [{ id: "text-only", name: "Text only", input: ["text"] }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const prompt = `What is wrong here?${formatPromptWithWorkspaceAttachments([{ id: "img-1", path: ".attachments/img-1-error.png", previewPath: ".attachments/img-1-error.png", name: "error.png", mediaType: "image/png", size: 12 }])}`;
    let promptText = "";
    let ocrCalls = 0;
    faux.setResponses([(request) => {
      promptText = request.messages
        .flatMap((message) => typeof message.content === "string" ? [message.content] : message.content.flatMap((block) => block.type === "text" ? [block.text] : []))
        .join("\n");
      return fauxAssistantMessage("ok");
    }]);
    const driverSession = await createGenericAgentDriver().createSession(contextFor(model, models, session, {
      resolvePromptImageText: async (reference) => {
        ocrCalls += 1;
        expect(reference.path).toBe(".attachments/img-1-error.png");
        return { text: "TypeError: x is undefined", engine: "wordless-ocr/ppocrv5" };
      },
    }));
    await driverSession.execute({ type: "prompt", text: prompt, submission: { messageId: "message-1", submittedAt: Date.now() } });

    expect(ocrCalls).toBe(1);
    expect(promptText).toContain("TypeError: x is undefined");
    // 标注必须在:否则模型会把"识别到的文字"当成"我看过这张图"。
    expect(promptText).toContain("NOT a visual description");
    expect(promptText).toContain("wordless-ocr/ppocrv5");
    // 有了文字就不该再说"我看不了图"。
    expect(promptText).not.toContain("This model cannot view images");
    driverSession.dispose();
  });

  it("OCR 给不出文字时退回那句实话", async () => {
    const faux = fauxProvider({ models: [{ id: "text-only", name: "Text only", input: ["text"] }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const prompt = `Look${formatPromptWithWorkspaceAttachments([{ id: "img-1", path: ".attachments/img-1-photo.png", previewPath: ".attachments/img-1-photo.png", name: "photo.png", mediaType: "image/png", size: 12 }])}`;
    let promptText = "";
    faux.setResponses([(request) => {
      promptText = request.messages
        .flatMap((message) => typeof message.content === "string" ? [message.content] : message.content.flatMap((block) => block.type === "text" ? [block.text] : []))
        .join("\n");
      return fauxAssistantMessage("ok");
    }]);
    const driverSession = await createGenericAgentDriver().createSession(contextFor(model, models, session, {
      resolvePromptImageText: async () => undefined,
    }));
    await driverSession.execute({ type: "prompt", text: prompt, submission: { messageId: "message-1", submittedAt: Date.now() } });

    expect(promptText).toContain("This model cannot view images");
    driverSession.dispose();
  });

  it("能看图的模型不去跑 OCR(没有理由退化成文字)", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const session = new Session(new InMemorySessionStorage());
    const prompt = `Describe this${formatPromptWithWorkspaceAttachments([{ id: "img-1", path: ".attachments/img-1-photo.png", previewPath: ".attachments/img-1-photo.png", name: "photo.png", mediaType: "image/png", size: 12 }])}`;
    let ocrCalls = 0;
    let imageCount = 0;
    faux.setResponses([(request) => {
      const blocks = request.messages.flatMap((message) => typeof message.content === "string" ? [] : message.content);
      imageCount = blocks.filter((block) => block.type === "image").length;
      return fauxAssistantMessage("ok");
    }]);
    const driverSession = await createGenericAgentDriver().createSession(contextFor(model, models, session, {
      resolvePromptImageText: async () => {
        ocrCalls += 1;
        return { text: "should not happen", engine: "unused" };
      },
    }));
    await driverSession.execute({ type: "prompt", text: prompt, submission: { messageId: "message-1", submittedAt: Date.now() } });

    expect(ocrCalls).toBe(0);
    expect(imageCount).toBe(1);
    driverSession.dispose();
  });
});
