import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ConversationUsage, SessionRecord } from "@wordless/domain";
import { WordlessDatabase } from "@wordless/persistence";
import { UsageReportService } from "../../src/usage-report.ts";

/**
 * 用量测试的共享夹具:真 journal 文件 + 真 SQLite。
 *
 * 对账测试要求"两条独立路径读到同一批字节",所以夹具必须落盘 —— 内存里的假对象对不出账来。
 */

export type JournalEntry = {
  id: string;
  usage?: Partial<ConversationUsage> & { cacheUsageReporting?: ConversationUsage["cacheUsageReporting"] };
  role?: "assistant" | "user";
};

export function sessionRecord(root: string, journalPath: string): SessionRecord {
  return {
    id: "session-1",
    title: "Session usage",
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

export async function writeJournal(path: string, sessionId: string, entries: readonly JournalEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const lines = [
    JSON.stringify({
      type: "wordless.session",
      metadata: {
        id: sessionId,
        createdAt: new Date(0).toISOString(),
        cwd: dirname(path),
        path,
        metadata: {},
      },
    }),
  ];
  for (const [index, entry] of entries.entries()) {
    const role = entry.role ?? "assistant";
    const usage = entry.usage;
    lines.push(
      JSON.stringify({
        type: "message",
        id: entry.id,
        parentId: index === 0 ? null : entries[index - 1]!.id,
        timestamp: new Date(index + 1).toISOString(),
        message: {
          role,
          content: [],
          provider: "openai",
          model: "gpt-5",
          timestamp: index + 1,
          ...(usage === undefined
            ? {}
            : {
                usage: {
                  input: usage.inputTokens ?? 0,
                  output: usage.outputTokens ?? 0,
                  cacheRead: usage.cacheReadTokens ?? 0,
                  cacheWrite: usage.cacheWriteTokens ?? 0,
                  totalTokens: usage.totalTokens ?? 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.totalCost ?? 0 },
                  ...(usage.cacheUsageReporting === undefined
                    ? {}
                    : { cacheUsageReporting: usage.cacheUsageReporting }),
                },
              }),
        },
      }),
    );
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

export async function withService(
  run: (context: { service: UsageReportService; session: SessionRecord; root: string; journalsRoot: string }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wordless-session-usage-"));
  try {
    const journalsRoot = join(root, "journals");
    const database = new WordlessDatabase(join(root, "wordless.db"));
    const session = sessionRecord(root, join(journalsRoot, "session-1.jsonl"));
    database.upsertSession(session);
    const service = new UsageReportService({
      database,
      journalsRoot,
      getMediaProject: () => undefined,
      listSessions: () => database.listSessions(),
    });
    // 关库必须在断言失败时也发生:否则文件还锁着,`rm` 抛 EBUSY,真正的错误被它盖掉。
    try {
      await run({ service, session, root, journalsRoot });
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
}
