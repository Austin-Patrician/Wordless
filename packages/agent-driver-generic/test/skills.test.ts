import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxAssistantMessage, fauxProvider, type FauxResponseFactory } from "@wordless/ai";
import { formatPromptArtifactReferencesForModel, formatPromptWithSkillReferences, formatPromptWorkspaceReferencesForModel, projectUserMessageContent, selectedSkillIdsFromPromptParts, stripPromptSkillReferences, type AgentDriverEvent, type AgentDriverSessionContext, type AgentRuntimeSkill } from "@wordless/agent-driver-sdk";
import type { SessionRecord } from "@wordless/domain";
import { describe, expect, it } from "vitest";
import { createAgentHarnessDriver } from "../src/index.ts";

function selectedSkill(): AgentRuntimeSkill {
  return {
    id: "selected-skill",
    name: "release-notes",
    description: "Write release notes.",
    content: "Use the release note structure from this skill.",
    filePath: "/skills/release-notes/SKILL.md",
    disableModelInvocation: false,
    source: "wordless",
    workspaceId: null,
    baseDir: "/skills/release-notes",
  };
}

async function createDriverSession(responses: Array<ReturnType<typeof fauxAssistantMessage> | FauxResponseFactory>) {
  const models = createModels();
  const faux = fauxProvider({ provider: `skills-${crypto.randomUUID()}` });
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  const model = faux.getModel();
  const session = new Session(new InMemorySessionStorage());
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    title: "Skills test",
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
    skills: [selectedSkill()],
    connectorTools: [],
    connectorToolPolicies: [],
    security: { fileRules: [], commandRules: [] },
    resolveModel: () => model,
  };
  const driver = createAgentHarnessDriver({ id: "test", createTools: () => [] });
  return { driverSession: await driver.createSession(context), session };
}

describe("selected skills", () => {
  it("preserves inline references in history and removes their markers from provider context", async () => {
    const parts = [
      { type: "text" as const, text: "Use " },
      { type: "skill-reference" as const, skillId: "selected-skill", name: "release-notes", source: "wordless" as const },
      { type: "text" as const, text: " for this release." },
      { type: "skill-reference" as const, skillId: "selected-skill", name: "release-notes", source: "wordless" as const },
    ];
    const prompt = formatPromptWithSkillReferences(parts);
    expect(selectedSkillIdsFromPromptParts(parts)).toEqual(["selected-skill"]);
    expect(projectUserMessageContent(prompt)).toEqual([
      { type: "text", text: "Use " },
      { type: "skill-reference", id: "selected-skill:1", skillId: "selected-skill", name: "release-notes", source: "wordless" },
      { type: "text", text: " for this release." },
      { type: "skill-reference", id: "selected-skill:3", skillId: "selected-skill", name: "release-notes", source: "wordless" },
    ]);
    expect(stripPromptSkillReferences(prompt)).toBe("Use  for this release.");

    const providerContexts: string[] = [];
    const { driverSession } = await createDriverSession([
      (context) => {
        providerContexts.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("Done");
      },
    ]);
    await driverSession.execute({ type: "prompt", text: prompt, selectedSkills: [selectedSkill()] });

    expect(providerContexts).toHaveLength(1);
    expect(providerContexts[0]).toContain("Use  for this release.");
    expect(providerContexts[0]).not.toContain("wordless-skill-reference");
  });

  it("hides legacy selected-skill payloads stored in text content arrays", () => {
    const skill = selectedSkill();
    const serialized = JSON.stringify({
      version: 2,
      attachments: [{ path: "README.md", name: "README.md", mediaType: "text/plain", content: "# Readme" }],
      skills: [{ id: skill.id, name: skill.name, source: skill.source, baseDir: skill.baseDir, content: skill.content }],
    });
    const content = [{ type: "text", text: `Review this change.\n<wordless-workspace-attachments>\n${serialized}\n</wordless-workspace-attachments>` }];

    expect(projectUserMessageContent(content)).toEqual([
      { type: "text", text: "Review this change." },
      { type: "attachment", id: "README.md:0", name: "README.md", mediaType: "text/plain" },
    ]);
  });

  it("passes workspace references to the provider as paths without file contents", async () => {
    const parts = [
      { type: "text" as const, text: "Review " },
      { type: "workspace-reference" as const, path: "reports/large-workbook.xlsx", name: "large-workbook.xlsx", kind: "file" as const },
      { type: "text" as const, text: " and " },
      { type: "workspace-reference" as const, path: "references/source.pdf", name: "source.pdf", kind: "file" as const },
    ];
    const prompt = formatPromptWithSkillReferences(parts);

    expect(projectUserMessageContent(prompt)).toEqual([
      { type: "text", text: "Review " },
      { type: "workspace-reference", id: "reports/large-workbook.xlsx:1", path: "reports/large-workbook.xlsx", name: "large-workbook.xlsx", kind: "file" },
      { type: "text", text: " and " },
      { type: "workspace-reference", id: "references/source.pdf:3", path: "references/source.pdf", name: "source.pdf", kind: "file" },
    ]);
    const modelContext = formatPromptWorkspaceReferencesForModel(prompt);
    expect(modelContext).toContain('path="reports/large-workbook.xlsx"');
    expect(modelContext).toContain('path="references/source.pdf"');
    expect(modelContext).toContain("Use the available workspace tools to inspect it when needed.");
    expect(modelContext).not.toContain("wordless-workspace-reference");

    const providerContexts: string[] = [];
    const { driverSession } = await createDriverSession([
      (context) => {
        providerContexts.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("Done");
      },
    ]);
    await driverSession.execute({ type: "prompt", text: prompt });

    expect(providerContexts).toHaveLength(1);
    expect(providerContexts[0]).toContain('path=\\"reports/large-workbook.xlsx\\"');
    expect(providerContexts[0]).toContain('path=\\"references/source.pdf\\"');
    expect(providerContexts[0]).not.toContain("wordless-workspace-reference");
    expect(providerContexts[0]).not.toContain("PK\\u0003\\u0004");
  });

  it("keeps artifact selections compact in history and explicit in model context", () => {
    const prompt = formatPromptWithSkillReferences([
      { type: "text", text: "Create a chart from " },
      {
        type: "artifact-reference",
        artifactId: "workbook-1",
        kind: "spreadsheet",
        name: "report.xlsx",
        revision: 4,
        surfaceId: "sheet-Summary",
        locator: "/Summary/A3:A9",
        locators: ["/Summary/A3:A9", "/Summary/C3:C9"],
        intent: "chart",
      },
    ]);

    expect(projectUserMessageContent(prompt)).toEqual([
      { type: "text", text: "Create a chart from " },
      { type: "artifact", artifactId: "workbook-1", kind: "spreadsheet", name: "report.xlsx", revision: 4, surfaceId: "sheet-Summary", locator: "/Summary/A3:A9" },
    ]);
    const modelContext = formatPromptArtifactReferencesForModel(prompt);
    expect(modelContext).toContain("intent=chart");
    expect(modelContext).toContain('exact_selection=["/Summary/A3:A9","/Summary/C3:C9"]');
    expect(modelContext).toContain("Do not replace it with the used range or the whole sheet.");
    expect(modelContext).not.toContain("wordless-artifact-reference");
  });

  it("injects an explicitly selected skill into this run only", async () => {
    const systemPrompts: string[] = [];
    const { driverSession, session } = await createDriverSession([
      (context) => {
        systemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("First response");
      },
      (context) => {
        systemPrompts.push(context.systemPrompt ?? "");
        return fauxAssistantMessage("Second response");
      },
    ]);
    const events: AgentDriverEvent[] = [];
    driverSession.subscribe((event) => events.push(event));

    const submission = { messageId: "submitted-user-1", submittedAt: 1_700_000_000_000 };
    await driverSession.execute({ type: "prompt", text: "Prepare the release notes.", selectedSkills: [selectedSkill()], submission });

    const userStart = events.find((event) => event.type === "message.started" && event.message.role === "user");
    const userCompleted = events.find((event) => event.type === "message.completed" && event.message.role === "user");
    const persistedUserEntry = (await session.getEntries()).find((entry) => entry.type === "message" && entry.message.role === "user");
    expect(persistedUserEntry).toBeDefined();
    expect(persistedUserEntry?.id).toBe(submission.messageId);
    expect(userStart).toMatchObject({
      message: {
        blocks: [{ type: "text", text: "Prepare the release notes." }],
      },
    });
    expect(userCompleted).toMatchObject({ message: { id: persistedUserEntry?.id } });
    expect(userStart).toMatchObject({ message: { id: persistedUserEntry?.id } });
    expect(events.indexOf(userStart!)).toBeLessThan(events.indexOf(userCompleted!));
    expect(systemPrompts[0]).toContain("Use the release note structure from this skill.");

    const firstUserMessage = (await session.buildContext()).messages.find((message) => message.role === "user");
    expect(JSON.stringify(firstUserMessage)).not.toContain("Use the release note structure from this skill.");

    await driverSession.execute({ type: "prompt", text: "Continue without the skill." });

    expect(systemPrompts[1]).not.toContain("Use the release note structure from this skill.");
  });
});
