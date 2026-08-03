import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { InMemorySessionStorage, Session } from "@wordless/agent";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createModels, fauxProvider } from "@wordless/ai";
import { resolveFileSecurityRules } from "@wordless/capability-filesystem";
import { resolveCommandSecurityRules } from "@wordless/capability-shell";
import type { AgentDriverSessionContext } from "@wordless/agent-driver-sdk";
import type { SessionAccessLevel, SessionRecord } from "@wordless/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preflightWorkspaceOperation } from "../src/index.ts";

let rootPath: string;

beforeEach(async () => {
  rootPath = await mkdtemp(join(tmpdir(), "wordless-workspace-policy-"));
});

afterEach(async () => {
  await rm(rootPath, { force: true, recursive: true });
});

function createContext(accessLevel: SessionAccessLevel): AgentDriverSessionContext {
  const models = createModels();
  const provider = fauxProvider({ provider: `workspace-policy-${crypto.randomUUID()}` });
  models.setProvider(provider.provider);
  const model = provider.getModel();
  const record: SessionRecord = {
    id: crypto.randomUUID(),
    title: "Workspace policy",
    workspaceId: null,
    runtimeRootPath: rootPath,
    mode: "everyday",
    entryId: "general-work",
    profile: { id: "general", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel,
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
    profile: {
      reference: record.profile,
      driverId: record.driverId,
      modelRequirements: { requiresToolUse: true },
      systemPrompt: "Use workspace tools.",
      activeToolNames: ["read", "bash", "edit", "write", "grep", "find", "ls"],
      capabilityIds: ["filesystem", "shell"],
      skills: [],
      artifactKinds: [],
      workbenchId: record.workbenchId,
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
    env: new NodeExecutionEnv({ cwd: rootPath }),
    skills: [],
    connectorTools: [],
    connectorToolPolicies: [],
    security: {
      fileRules: resolveFileSecurityRules([]),
      commandRules: resolveCommandSecurityRules([]),
    },
    resolveModel: () => model,
  };
}

describe("workspace operation policy", () => {
  it("requires approval for ordinary commands with default access", async () => {
    const decision = await preflightWorkspaceOperation(createContext("default"), {
      toolName: "bash",
      input: { command: "git status" },
    });

    expect(decision.type).toBe("approval");
    if (decision.type === "approval") expect(decision.approval.severity).toBe("normal");
  });

  it("allows ordinary commands with full access", async () => {
    const decision = await preflightWorkspaceOperation(createContext("full"), {
      toolName: "bash",
      input: { command: "git status" },
    });

    expect(decision).toEqual({ type: "allow" });
  });

  it("requires high-risk approval for matched commands with full access", async () => {
    const decision = await preflightWorkspaceOperation(createContext("full"), {
      toolName: "bash",
      input: { command: "git reset --hard" },
    });

    expect(decision.type).toBe("approval");
    if (decision.type === "approval") {
      expect(decision.approval.severity).toBe("high");
      expect(decision.approval.matchedRules).not.toHaveLength(0);
    }
  });

  it("requires approval for workspace writes with default access", async () => {
    const decision = await preflightWorkspaceOperation(createContext("default"), {
      toolName: "write",
      input: { path: "notes.txt", content: "Updated" },
    });

    expect(decision.type).toBe("approval");
    if (decision.type === "approval") {
      expect(decision.approval.risk).toBe("file-write");
      expect(decision.approval.severity).toBe("normal");
    }
  });

  it("blocks writes outside the workspace with default access", async () => {
    const decision = await preflightWorkspaceOperation(createContext("default"), {
      toolName: "write",
      input: { path: resolve(rootPath, "..", "outside.txt"), content: "Blocked" },
    });

    expect(decision).toEqual({ type: "block", reason: "Default access only permits files inside the workspace" });
  });

  it("requires high-risk approval for protected files with full access", async () => {
    const path = join(rootPath, ".env");
    await writeFile(path, "TOKEN=old", "utf8");
    const decision = await preflightWorkspaceOperation(createContext("full"), {
      toolName: "edit",
      input: { path, oldText: "old", newText: "new" },
    });

    expect(decision.type).toBe("approval");
    if (decision.type === "approval") {
      expect(decision.approval.severity).toBe("high");
      expect(decision.approval.matchedRules).not.toHaveLength(0);
    }
  });
});
