import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@wordless/ai";
import { preflightWorkspaceOperation } from "@wordless/agent-workspace-policy";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import type { AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { generalProfile } from "@wordless/profile-general";
import { describe, expect, it } from "vitest";
import { createGenericAgentDriver } from "../src/index.ts";

describe("General Work tools", () => {
  it("advertises foundational workspace tools to the model", async () => {
    const advertisedTools: string[][] = [];
    const models = createModels();
    const faux = fauxProvider({ provider: `general-tools-${crypto.randomUUID()}` });
    models.setProvider(faux.provider);
    faux.setResponses([
      (context) => {
        advertisedTools.push((context.tools ?? []).map((tool) => tool.name));
        return fauxAssistantMessage([fauxText("Done")]);
      },
    ]);
    const model = faux.getModel();
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: "General Work",
      workspaceId: null,
      runtimeRootPath: process.cwd(),
      mode: "everyday",
      entryId: "general-work",
      profile: generalProfile.reference,
      driverId: generalProfile.driverId,
      journalFormat: "wordless-agent-v1",
      workbenchId: generalProfile.workbenchId,
      accessLevel: "default",
      model: { connectionId: model.provider, modelId: model.id },
      journalPath: "memory",
      connectorIds: [],
      interactionMode: "default",
      pinnedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const context: AgentDriverSessionContext = {
      record,
      profile: generalProfile,
      model,
      modelCapabilities: {
        supportsText: true,
        supportsVision: false,
        supportsToolUse: true,
        supportsReasoning: false,
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
    };
    const driverSession = await createGenericAgentDriver({
      createTools: (driverContext) => createHeadlessCodingTools(driverContext.env),
      preflightOperation: preflightWorkspaceOperation,
    }).createSession(context);

    await driverSession.execute({ type: "prompt", text: "Inspect the workspace." });

    expect(advertisedTools[0]).toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "write", "edit", "bash"]));
    driverSession.dispose();
  });
});
