import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

function createContext(accessLevel: SessionAccessLevel, trustedSkillReadRoots: Set<string> = new Set()): AgentDriverSessionContext {
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
    trustedSkillReadRoots,
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

  it("requires one-time elevated approval for writes outside the workspace with default access", async () => {
    const decision = await preflightWorkspaceOperation(createContext("default"), {
      toolName: "write",
      input: { path: resolve(rootPath, "..", "outside.txt"), content: "Blocked" },
    });

    expect(decision.type).toBe("approval");
    if (decision.type === "approval") {
      expect(decision.approval.risk).toBe("workspace-access");
      expect(decision.approval.severity).toBe("high");
      expect(decision.approval.requiresElevation).toBe(true);
      expect(decision.approval.preview).toMatchObject({ type: "external-access", operation: "write" });
    }
  });

  it("requires one-time elevated approval for nested external source paths", async () => {
    const externalPath = resolve(rootPath, "..", "source.csv");
    const decision = await preflightWorkspaceOperation(createContext("default"), {
      toolName: "data_import",
      input: { options: { sourcePath: externalPath } },
    });

    expect(decision.type).toBe("approval");
    if (decision.type === "approval" && decision.approval.preview.type === "external-access") {
      expect(decision.approval.preview.paths).toEqual([externalPath]);
      expect(decision.approval.requiresElevation).toBe(true);
    }
  });

  it("allows read-only tools inside a loaded skill directory outside the workspace", async () => {
    const skillRoot = await mkdtemp(join(tmpdir(), "wordless-skill-"));
    try {
      await mkdir(join(skillRoot, "references"));
      await writeFile(join(skillRoot, "references", "guide.md"), "guide", "utf8");
      const context = createContext("default", new Set([skillRoot]));
      for (const toolName of ["read", "ls", "find", "grep"]) {
        const input = toolName === "read"
          ? { path: join(skillRoot, "references", "guide.md") }
          : { path: join(skillRoot, "references") };
        await expect(preflightWorkspaceOperation(context, { toolName, input })).resolves.toEqual({ type: "allow" });
      }
    } finally {
      await rm(skillRoot, { force: true, recursive: true });
    }
  });

  it("does not extend skill trust to writes or commands", async () => {
    const skillRoot = await mkdtemp(join(tmpdir(), "wordless-skill-"));
    try {
      const context = createContext("default", new Set([skillRoot]));
      const writeDecision = await preflightWorkspaceOperation(context, {
        toolName: "write",
        input: { path: join(skillRoot, "notes.md"), content: "no" },
      });
      expect(writeDecision.type).toBe("approval");
      if (writeDecision.type === "approval") expect(writeDecision.approval.risk).toBe("workspace-access");
      const bashDecision = await preflightWorkspaceOperation(context, {
        toolName: "bash",
        input: { command: `cat "${join(skillRoot, "notes.md")}"` },
      });
      expect(bashDecision.type).toBe("approval");
    } finally {
      await rm(skillRoot, { force: true, recursive: true });
    }
  });

  it("does not trust a symlink that resolves outside the loaded skill directory", async () => {
    const skillRoot = await mkdtemp(join(tmpdir(), "wordless-skill-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "wordless-outside-"));
    try {
      await writeFile(join(outsideRoot, "secret.md"), "secret", "utf8");
      const linkPath = join(skillRoot, "secret.md");
      try {
        await (await import("node:fs/promises")).symlink(join(outsideRoot, "secret.md"), linkPath);
      } catch {
        return;
      }
      const decision = await preflightWorkspaceOperation(createContext("default", new Set([skillRoot])), {
        toolName: "read",
        input: { path: linkPath },
      });
      expect(decision.type).toBe("approval");
    } finally {
      await rm(skillRoot, { force: true, recursive: true });
      await rm(outsideRoot, { force: true, recursive: true });
    }
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
