import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@wordless/ai";
import type { AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { generalProfile } from "@wordless/profile-general";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

/**
 * 画像声明的是一份**愿望清单**,而可选能力可能根本没装配出来 —— 知识库开关关掉之后
 * `create-runtime.ts` 就不给 `kb_query` / `kb_list_tags`,浏览器或文档服务不在时同理。
 *
 * 不取交集的话 `AgentHarness` 会因为"声明了却没有"直接抛错,而那不是一个工具少了,是
 * **整个会话起不来**:用户只是关掉了一个设置,应用就不能用了。
 */

type Models = ReturnType<typeof createModels>;
type Model = ReturnType<Models["getModel"]>;

function contextFor(profile: typeof generalProfile, models: Models, model: Model): AgentDriverSessionContext {
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    title: "Declared tools",
    workspaceId: null,
    runtimeRootPath: process.cwd(),
    mode: "everyday",
    entryId: "general-work",
    profile: profile.reference,
    driverId: profile.driverId,
    journalFormat: "wordless-agent-v1",
    workbenchId: profile.workbenchId,
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
  return {
    record,
    profile,
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
    executionKind: "subagent",
    allowUserRequests: false,
  } as unknown as AgentDriverSessionContext;
}

describe("画像声明了但没装配的工具", () => {
  it("被丢掉,而不是让整个会话起不来", async () => {
    const advertised: string[][] = [];
    const models = createModels();
    const faux = fauxProvider({ provider: `declared-tools-${crypto.randomUUID()}`, models: [{ id: "m" }] });
    models.setProvider(faux.provider);
    faux.setResponses([
      (context) => {
        advertised.push((context.tools ?? []).map((tool) => tool.name));
        return fauxAssistantMessage([fauxText("ok")]);
      },
    ]);
    const model = faux.getModel();

    // `generalProfile` 声明了二十来个名字(含 kb_query / kb_list_tags / browser_*),
    // 而这里只装配出一个 —— 正是"关掉知识库"那天的现场。
    const session = await createGenericAgentDriver({
      createTools: () => [
        {
          name: "read",
          label: "Read",
          description: "read",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          execute: async () => ({ content: [{ type: "text", text: "" }] }),
        },
      ],
    }).createSession(contextFor(generalProfile, models, model));

    // 起得来 —— 这条就是回归测试本身(以前这里抛 `Unknown tool(s): kb_query, kb_list_tags`)。
    await session.execute({ type: "prompt", text: "go" });

    expect(advertised[0]).toEqual(["read"]);
    expect(advertised[0]).not.toContain("kb_query");
    session.dispose();
  });

  it("装上了的照常留下 —— 别把声明当成可选项", async () => {
    const advertised: string[][] = [];
    const models = createModels();
    const faux = fauxProvider({ provider: `declared-tools-keep-${crypto.randomUUID()}`, models: [{ id: "m" }] });
    models.setProvider(faux.provider);
    faux.setResponses([
      (context) => {
        advertised.push((context.tools ?? []).map((tool) => tool.name));
        return fauxAssistantMessage([fauxText("ok")]);
      },
    ]);
    const model = faux.getModel();

    const tool = (name: string) => ({
      name,
      label: name,
      description: name,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ content: [{ type: "text", text: "" }] }),
    });
    // 声明了 read/grep/kb_query,装配了 read/grep/kb_query + 一个没声明的 extra。
    const session = await createGenericAgentDriver({
      createTools: () => [tool("read"), tool("grep"), tool("kb_query"), tool("extra")],
    }).createSession(contextFor(generalProfile, models, model));
    await session.execute({ type: "prompt", text: "go" });

    expect(advertised[0]).toEqual(expect.arrayContaining(["read", "grep", "kb_query"]));
    // 没声明的不给模型 —— 这是"声明"这一侧的纪律(反向由 knowledge-tool-declaration 钉住)。
    expect(advertised[0]).not.toContain("extra");
    session.dispose();
  });
});
