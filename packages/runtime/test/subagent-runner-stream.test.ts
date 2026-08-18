import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AgentDriver,
  AgentDriverEvent,
  AgentDriverSessionContext,
} from "@wordless/agent-driver-sdk";
import type { ConversationMessage, SessionRecord } from "@wordless/domain";
import {
  SessionSubagentRunner,
  type SessionSubagentRunnerOptions,
} from "../src/subagent-runner.ts";

test("streams a complete prefix, interrupts provider errors, and reuses member JSONL", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-subagent-stream-"));
  context.after(async () => await rm(root, { force: true, recursive: true }));

  const parent: SessionRecord = {
    id: "parent",
    title: "Team",
    workspaceId: null,
    runtimeRootPath: join(root, "workspace"),
    mode: "everyday",
    entryId: "general-work",
    profile: { id: "general", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel: "default",
    model: { connectionId: "test", modelId: "model" },
    thinkingLevel: "medium",
    journalPath: join(root, "parent.jsonl"),
    connectorIds: [],
    toolApprovalMode: "manual",
    pinnedAt: null,
    expertSelection: { kind: "team", id: "team", version: "1" },
    createdAt: 1,
    updatedAt: 1,
  };
  const contexts: AgentDriverSessionContext[] = [];
  const priorAssistantCounts: number[] = [];
  const promptSubmissionIds: string[] = [];
  const approvalModes: string[] = [];
  let notifySecondPromptStarted!: () => void;
  const secondPromptStarted = new Promise<void>((resolve) => {
    notifySecondPromptStarted = resolve;
  });
  let releaseSecondPrompt!: () => void;
  let runIndex = 0;
  const driver: AgentDriver = {
    id: "generic",
    features: [],
    async createSession(sessionContext) {
      contexts.push(sessionContext);
      const priorEntries = await sessionContext.session.getEntries();
      priorAssistantCounts.push(
        priorEntries.filter((entry) =>
          entry.type === "message" && entry.message.role === "assistant"
        ).length,
      );
      const listeners = new Set<(event: AgentDriverEvent) => void>();
      const currentRun = runIndex++;
      return {
        features: [],
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async execute(command) {
          if (command.type === "set-tool-approval-mode") {
            approvalModes.push(command.mode);
            return;
          }
          if (command.type !== "prompt") return;
          promptSubmissionIds.push(command.submission?.messageId ?? "");
          const id = `assistant-${currentRun}`;
          const started: ConversationMessage = {
            id,
            role: "assistant",
            status: "streaming",
            blocks: [],
            model: parent.model,
            timestamp: Date.now(),
          };
          for (const listener of listeners)
            listener({ type: "message.started", message: started });
          for (const listener of listeners)
            listener({ type: "tool.started", messageId: id, callId: `call-${currentRun}`, name: "bash", input: { command: "echo ok" } });
          for (const listener of listeners)
            listener({ type: "tool.updated", messageId: id, callId: `call-${currentRun}`, output: "ok" });
          for (const listener of listeners)
            listener({ type: "tool.completed", messageId: id, callId: `call-${currentRun}`, output: "ok", isError: false });
          if (currentRun === 1) {
            notifySecondPromptStarted();
            await new Promise<void>((resolve) => {
              releaseSecondPrompt = resolve;
            });
          }
          for (const delta of ["prefix ", "partial"]) {
            for (const listener of listeners)
              listener({ type: "message.text.delta", messageId: id, delta });
          }
          const failed = currentRun === 0;
          const message: ConversationMessage = {
            ...started,
            status: failed ? "error" : "complete",
            blocks: [{ type: "text", text: failed ? "prefix partial" : "continued" }],
            ...(failed
              ? { errorMessage: "Stream ended without finish_reason" }
              : {}),
          };
          await sessionContext.session.appendMessage({
            role: "assistant",
            content: [{ type: "text", text: message.blocks[0]!.text }],
            provider: "test",
            model: "model",
            ...(failed
              ? {
                  stopReason: "error",
                  errorMessage: message.errorMessage,
                }
              : { stopReason: "stop" }),
            timestamp: Date.now(),
          });
          for (const listener of listeners)
            listener({ type: "message.completed", message });
        },
        dispose() {},
      };
    },
  };

  let runner!: SessionSubagentRunner;
  const revisions: number[] = [];
  const liveTexts: string[] = [];
  const liveToolStates: string[] = [];
  const options = {
    parent,
    profile: {
      reference: parent.profile,
      driverId: "generic",
      modelRequirements: {},
      systemPrompt: "Work carefully.",
      activeToolNames: [],
      capabilityIds: [],
      skills: [],
      artifactKinds: [],
      workbenchId: "conversation",
    },
    driver,
    models: {},
    env: {},
    workspaceSearch: {},
    skills: [],
    connectorTools: [],
    connectorToolPolicies: [],
    security: {},
    journalsRoot: join(root, "journals"),
    resolveModel: () => ({ reasoning: false }),
    resolveCapabilities: () => ({ supportsToolUse: true }),
    onFilesChanged: async () => {},
    toolApprovalMode: "manual",
    expertTeamDelegates: [{
      id: "writer",
      name: "Writer",
      executionProfile: "workspace-write",
      responsibility: "Draft content.",
      systemPrompt: "Write clearly.",
      skillIds: [],
      connectorIds: [],
    }],
    onExpertMemberEvent: (event) => {
      const live = runner.getExpertMemberLiveState("writer");
      if (event.type.startsWith("message.")) {
        revisions.push(event.revision);
        liveTexts.push(
          live?.message.blocks
            .flatMap((block) => block.type === "text" ? [block.text] : [])
            .join("") ?? "",
        );
      }
      if (event.type === "tool.completed") {
        const tool = live?.message.blocks.find((block) => block.type === "tool");
        liveToolStates.push(tool?.state ?? "missing");
      }
    },
  } as unknown as SessionSubagentRunnerOptions;
  runner = new SessionSubagentRunner(options);
  context.after(async () => await runner.dispose());

  const first = await runner.run({
    kind: "expert-member",
    id: "task-1",
    memberId: "writer",
    prompt: "Draft",
    cwd: parent.runtimeRootPath,
  });
  assert.equal(first.status, "interrupted");
  assert.equal(first.text, "prefix partial");
  assert.match(first.error ?? "", /finish_reason/);
  assert.deepEqual(revisions.slice(0, 4), [0, 4, 5, 6]);
  assert.deepEqual(liveTexts.slice(0, 4), ["", "prefix ", "prefix partial", "prefix partial"]);
  assert.equal(liveToolStates[0], "complete");

  const secondRun = runner.run({
    kind: "expert-member",
    id: "task-2",
    memberId: "writer",
    prompt: "Continue the previous draft",
    cwd: parent.runtimeRootPath,
  });
  await secondPromptStarted;
  await runner.setToolApprovalMode("auto");
  assert.deepEqual(approvalModes, ["auto"]);
  releaseSecondPrompt();
  const second = await secondRun;
  assert.equal(second.status, "completed");
  assert.equal(contexts[0]?.record.journalPath, contexts[1]?.record.journalPath);
  assert.equal(contexts[1]?.toolApprovalMode, "manual");
  assert.deepEqual(priorAssistantCounts, [0, 1]);
  assert.deepEqual(promptSubmissionIds, ["task-1", "task-2"]);
});
