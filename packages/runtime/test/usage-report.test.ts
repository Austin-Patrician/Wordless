import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ConversationUsage, MediaProject, SessionRecord } from "@wordless/domain";
import { WordlessDatabase } from "@wordless/persistence";
import { UsageReportService } from "../src/usage-report.ts";

type JournalAssistant = {
  id: string;
  model: string;
  provider: string;
  timestamp: number;
  usage: ConversationUsage;
};

function sessionRecord(root: string, journalPath: string): SessionRecord {
  return {
    id: "session-1",
    title: "Usage test",
    workspaceId: null,
    runtimeRootPath: join(root, "workspace"),
    mode: "code",
    entryId: "code-development",
    profile: { id: "coding", version: "1" },
    driverId: "coding",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel: "default",
    model: { connectionId: "openai", modelId: "gpt-5" },
    thinkingLevel: "medium",
    journalPath,
    connectorIds: [],
    toolApprovalMode: "manual",
    pinnedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function writeJournal(path: string, sessionId: string, entries: readonly JournalAssistant[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const header = {
    type: "wordless.session",
    metadata: {
      id: sessionId,
      createdAt: new Date(entries[0]?.timestamp ?? 0).toISOString(),
      cwd: dirname(path),
      path,
      metadata: {},
    },
  };
  const lines = [JSON.stringify(header)];
  for (const [index, entry] of entries.entries()) {
    lines.push(JSON.stringify({
      type: "message",
      id: entry.id,
      parentId: index === 0 ? null : entries[index - 1]!.id,
      timestamp: new Date(entry.timestamp).toISOString(),
      message: {
        role: "assistant",
        content: [],
        provider: entry.provider,
        model: entry.model,
        timestamp: entry.timestamp,
        usage: {
          input: entry.usage.inputTokens,
          output: entry.usage.outputTokens,
          cacheRead: entry.usage.cacheReadTokens,
          cacheWrite: entry.usage.cacheWriteTokens,
          totalTokens: entry.usage.totalTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: entry.usage.totalCost },
        },
      },
    }));
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

function mediaProject(timestamp: number): MediaProject {
  return {
    documentVersion: 3,
    sessionId: "session-1",
    title: "Image project",
    assets: [],
    coverAssetId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: timestamp,
    updatedAt: timestamp,
    operations: [
      {
        id: "image-1",
        kind: "generate",
        inputs: [],
        outputAssetIds: [],
        prompt: "A test image",
        ratio: "1:1",
        outputCount: 1,
        outputTotal: 1,
        providerId: "openai",
        modelId: "gpt-image-1",
        parameters: {},
        status: "ready",
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        usageEvents: [{
          id: "image-response-1",
          timestamp,
          usage: { inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 10, totalCost: 0.04 },
        }],
      },
      {
        id: "image-legacy",
        kind: "generate",
        inputs: [],
        outputAssetIds: [],
        prompt: "A legacy image",
        ratio: "1:1",
        outputCount: 1,
        outputTotal: 1,
        providerId: "openrouter",
        modelId: "legacy-image",
        parameters: {},
        status: "ready",
        errorMessage: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

test("aggregates chat, subagent, and media usage without duplication and removes deleted sessions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-usage-"));
  const journalsRoot = join(root, "journals");
  const journalPath = join(journalsRoot, "session-1.jsonl");
  const subagentPath = join(journalsRoot, "subagents", "session-1", "reviewer.jsonl");
  const timestamp = Date.UTC(2026, 0, 12, 9, 30);
  const database = new WordlessDatabase(join(root, "wordless.db"));
  context.after(async () => {
    database.close();
    await rm(root, { force: true, recursive: true });
  });

  await writeJournal(journalPath, "session-1", [{
    id: "main-response",
    provider: "openai",
    model: "gpt-5",
    timestamp,
    usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 0, totalTokens: 150, totalCost: 0.02 },
  }]);
  await writeJournal(subagentPath, "subagent-reviewer", [{
    id: "review-response",
    provider: "openai",
    model: "gpt-5-mini",
    timestamp: timestamp + 60_000,
    usage: { inputTokens: 80, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 0, totalTokens: 110, totalCost: 0.006 },
  }]);

  const record = sessionRecord(root, journalPath);
  database.upsertSession(record);
  const service = new UsageReportService({
    database,
    journalsRoot,
    getMediaProject: (sessionId) => sessionId === record.id ? mediaProject(timestamp + 120_000) : undefined,
    listSessions: () => database.listSessions(),
  });

  const query = { startAt: timestamp - 60_000, endAt: timestamp + 24 * 60 * 60 * 1_000, groupBy: "provider" as const };
  const first = await service.getReport(query);
  const second = await service.getReport(query);

  assert.equal(first.totals.requestCount, 3);
  assert.equal(first.totals.totalTokens, 270);
  assert.ok(Math.abs(first.totals.estimatedCost - 0.066) < 1e-12);
  assert.equal(first.totals.unmeteredOperationCount, 1);
  assert.equal(second.totals.requestCount, 3);
  assert.equal(second.totals.totalTokens, 270);
  const openai = first.groups.find((group) => group.providerId === "openai");
  assert.equal(openai?.modelKind, "mixed");
  assert.equal(openai?.usage.requestCount, 3);

  const models = await service.getReport({ ...query, groupBy: "model" });
  assert.deepEqual(models.groups.filter((group) => group.providerId === "openai").map((group) => group.modelId).sort(), ["gpt-5", "gpt-5-mini", "gpt-image-1"]);

  database.deleteSession(record.id);
  const afterDeletion = await service.getReport(query);
  assert.equal(afterDeletion.groups.length, 0);
  assert.equal(afterDeletion.totals.totalTokens, 0);
});
