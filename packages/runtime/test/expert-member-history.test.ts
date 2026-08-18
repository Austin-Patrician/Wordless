import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConversationMessage, SessionRecord } from "@wordless/domain";
import { createWordlessSession, WordlessDatabase } from "@wordless/persistence";
import { WordlessRuntime } from "../src/index.ts";

type WritableJournal = {
  appendCustomEntry(type: string, data: unknown): Promise<string>;
  appendMessage(message: unknown): Promise<string>;
};

function messagesFromPage(
  page: Awaited<ReturnType<WordlessRuntime["getExpertMemberHistory"]>>,
): ConversationMessage[] {
  return page.items.flatMap((item) =>
    item.type === "turn" ? item.turn.messages : [],
  );
}

function toolBlock(messages: ConversationMessage[], callId: string) {
  return messages
    .flatMap((message) => message.blocks)
    .find((block) => block.type === "tool" && block.callId === callId);
}

test("projects expert member approvals into their tool history", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-member-history-"));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  context.after(async () => {
    database.close();
    await rm(root, { force: true, recursive: true });
  });
  const sessionId = "session-1";
  const memberId = "member-1";
  const record: SessionRecord = {
    id: sessionId,
    title: "Expert team",
    workspaceId: null,
    runtimeRootPath: join(root, "workspace"),
    mode: "everyday",
    entryId: "general-work",
    profile: { id: "general", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel: "default",
    model: { connectionId: "openai", modelId: "gpt-5" },
    thinkingLevel: "medium",
    journalPath: join(root, "sessions", `${sessionId}.jsonl`),
    connectorIds: [],
    toolApprovalMode: "manual",
    pinnedAt: null,
    expertSelection: { kind: "team", id: "team-1", version: "1" },
    createdAt: 1,
    updatedAt: 1,
  };
  database.upsertSession(record);
  database.saveSessionExpertSnapshot(sessionId, {
    kind: "team",
    selection: record.expertSelection!,
    name: "Lead",
    systemPrompt: "Lead the team.",
    skillIds: [],
    connectorIds: [],
    teamName: "Team",
    teamPortrait: { kind: "builtin", key: "content-studio" },
    leader: {
      expertId: "lead",
      expertName: "Lead",
      portrait: { kind: "builtin", key: "content-studio" },
      systemPrompt: "Lead the team.",
      skillIds: [],
      connectorIds: [],
    },
    teamMembers: [{
      id: memberId,
      name: "Writer",
      expertName: "Writer",
      portrait: { kind: "builtin", key: "product-strategist" },
      systemPrompt: "Write clearly.",
      skillIds: [],
      connectorIds: [],
      executionProfile: "workspace-write",
      responsibility: "Write the draft.",
    }],
  });

  const journalPath = join(
    root,
    "journals",
    "subagents",
    sessionId,
    "members",
    `${memberId}.jsonl`,
  );
  const journal = await createWordlessSession({
    id: `${sessionId}:member:${memberId}`,
    createdAt: new Date(1).toISOString(),
    cwd: record.runtimeRootPath,
    path: journalPath,
    metadata: { parentSessionId: sessionId, memberId },
  }) as unknown as WritableJournal;
  await journal.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Perform the delegated work." }],
    timestamp: 2,
  });
  await journal.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "pending", name: "bash", arguments: { command: "pending" } },
      { type: "toolCall", id: "approved", name: "bash", arguments: { command: "approved" } },
      { type: "toolCall", id: "rejected", name: "bash", arguments: { command: "rejected" } },
      { type: "toolCall", id: "mcp-failed", name: "mcp_connector_1_search", arguments: { query: "Wordless" } },
    ],
    provider: "openai",
    model: "gpt-5",
    timestamp: 3,
  });
  const approval = (approvalId: string, summary: string) => ({
    approvalId,
    risk: "command",
    severity: "normal",
    summary,
    preview: { type: "command", command: summary },
    matchedRules: [],
  });
  await journal.appendCustomEntry("wordless.operation-approval", {
    callId: "pending",
    approval: approval("approval-pending", "Pending command"),
  });
  await journal.appendCustomEntry("wordless.operation-approval", {
    callId: "approved",
    approval: approval("approval-approved", "Approved command"),
    resolution: { approvalId: "approval-approved", approved: true },
  });
  await journal.appendMessage({
    role: "toolResult",
    toolCallId: "approved",
    toolName: "bash",
    content: [{ type: "text", text: "complete" }],
    isError: false,
    timestamp: 4,
  });
  await journal.appendMessage({
    role: "toolResult",
    toolCallId: "mcp-failed",
    toolName: "mcp_connector_1_search",
    content: [{ type: "text", text: "Connector request failed" }],
    details: {
      toolSource: {
        kind: "mcp",
        connectorId: "connector-1",
        connectorName: "Web Search",
        toolName: "search",
        templateId: "web-search",
        transport: "streamable-http",
      },
    },
    isError: true,
    timestamp: 4,
  });
  await journal.appendCustomEntry("wordless.operation-approval", {
    callId: "rejected",
    approval: approval("approval-rejected", "Rejected command"),
    resolution: {
      approvalId: "approval-rejected",
      approved: false,
      feedback: "Not allowed",
    },
  });
  await journal.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Partial response before provider failure" }],
    provider: "openai",
    model: "gpt-5",
    stopReason: "error",
    errorMessage: "Stream ended without finish_reason",
    timestamp: 5,
  });
  await journal.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Partial response before cancellation" }],
    provider: "openai",
    model: "gpt-5",
    stopReason: "aborted",
    errorMessage: "Request was aborted",
    timestamp: 6,
  });

  const runtime = Object.create(WordlessRuntime.prototype) as WordlessRuntime;
  Object.assign(runtime, {
    database,
    options: { paths: { journalsRoot: join(root, "journals") } },
    runs: new Map([[sessionId, {}]]),
  });
  const activeMessages = messagesFromPage(
    await runtime.getExpertMemberHistory(sessionId, memberId, {}),
  );
  assert.deepEqual(toolBlock(activeMessages, "pending"), {
    type: "tool",
    callId: "pending",
    name: "bash",
    state: "awaiting-approval",
    input: { command: "pending" },
    approval: {
      ...approval("approval-pending", "Pending command"),
      status: "required",
    },
  });
  assert.equal(toolBlock(activeMessages, "approved")?.state, "complete");
  assert.equal(toolBlock(activeMessages, "approved")?.approval?.status, "approved");
  assert.equal(toolBlock(activeMessages, "rejected")?.state, "error");
  assert.equal(toolBlock(activeMessages, "rejected")?.approval?.status, "rejected");
  assert.deepEqual(toolBlock(activeMessages, "mcp-failed")?.source, {
    kind: "mcp",
    connectorId: "connector-1",
    connectorName: "Web Search",
    toolName: "search",
    templateId: "web-search",
    transport: "streamable-http",
  });

  Object.assign(runtime, { runs: new Map() });
  const interruptedMessages = messagesFromPage(
    await runtime.getExpertMemberHistory(sessionId, memberId, {}),
  );
  assert.equal(toolBlock(interruptedMessages, "pending")?.state, "error");
  assert.match(
    toolBlock(interruptedMessages, "pending")?.output ?? "",
    /interrupted before approval/,
  );
  const persistedTerminalMessages = interruptedMessages.filter(
    (message) => message.status === "error" || message.status === "aborted",
  );
  assert.deepEqual(
    persistedTerminalMessages.map((message) => ({
      status: message.status,
      text: message.blocks
        .flatMap((block) => block.type === "text" ? [block.text] : [])
        .join(""),
      error: message.errorMessage,
    })),
    [
      {
        status: "error",
        text: "Partial response before provider failure",
        error: "Stream ended without finish_reason",
      },
      {
        status: "aborted",
        text: "Partial response before cancellation",
        error: "Request was aborted",
      },
    ],
  );
});
