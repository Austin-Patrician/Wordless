import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  type ConversationUsage,
  type MediaProject,
  type SessionRecord,
  type UsageAggregate,
  type UsageBucket,
  type UsageGroup,
  type UsageGroupBy,
  type UsageModelKind,
  type UsageReport,
  type UsageReportQuery,
  type UsageTrendPoint,
} from "@wordless/domain";
import {
  openWordlessSession,
  type UsageEventRecord,
  type UsageSourceRecord,
  type WordlessDatabase,
} from "@wordless/persistence";

type UsageReportServiceOptions = {
  database: WordlessDatabase;
  journalsRoot: string;
  getMediaProject: (sessionId: string) => MediaProject | undefined;
  listSessions: () => SessionRecord[];
};

type AggregateState = {
  modelKinds: Set<UsageModelKind>;
  usage: UsageAggregate;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function emptyUsageAggregate(): UsageAggregate {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    requestCount: 0,
    incompleteUsageCount: 0,
    unmeteredOperationCount: 0,
  };
}

function addUsageEvent(target: UsageAggregate, event: UsageEventRecord): void {
  target.inputTokens += event.inputTokens;
  target.outputTokens += event.outputTokens;
  target.cacheReadTokens += event.cacheReadTokens;
  target.cacheWriteTokens += event.cacheWriteTokens;
  target.totalTokens += event.totalTokens;
  target.estimatedCost += event.estimatedCost;
  target.requestCount += event.requestCount;
  target.incompleteUsageCount += event.usageAvailable ? 0 : event.requestCount;
  target.unmeteredOperationCount += event.unmeteredOperationCount;
}

export function conversationUsageFromAiUsage(value: unknown): ConversationUsage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const cost = asRecord(usage.cost);
  const inputTokens = typeof usage.input === "number" ? usage.input : 0;
  const outputTokens = typeof usage.output === "number" ? usage.output : 0;
  const cacheReadTokens = typeof usage.cacheRead === "number" ? usage.cacheRead : 0;
  const cacheWriteTokens = typeof usage.cacheWrite === "number" ? usage.cacheWrite : 0;
  const totalTokens = typeof usage.totalTokens === "number"
    ? usage.totalTokens
    : typeof usage.total === "number"
      ? usage.total
      : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalCost = typeof cost?.total === "number" ? cost.total : 0;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, totalCost };
}

function toUsageEvent(
  sourceId: string,
  eventId: string,
  occurredAt: number,
  providerId: string,
  modelId: string,
  modelKind: UsageModelKind,
  usage: ConversationUsage | undefined,
  requestCount = 1,
  unmeteredOperationCount = 0,
): UsageEventRecord {
  return {
    sourceId,
    eventId,
    occurredAt,
    providerId,
    modelId,
    modelKind,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    estimatedCost: usage?.totalCost ?? 0,
    requestCount,
    usageAvailable: usage !== undefined,
    unmeteredOperationCount,
  };
}

function sourceIdForJournal(path: string): string {
  return `journal:${path}`;
}

function sourceIdForMedia(sessionId: string): string {
  return `media:${sessionId}`;
}

function groupKey(event: UsageEventRecord, groupBy: UsageGroupBy): string {
  return groupBy === "provider"
    ? `provider:${event.providerId}`
    : `model:${event.modelKind}:${event.providerId}:${event.modelId}`;
}

function chooseBucket(query: UsageReportQuery): UsageBucket {
  const duration = query.endAt - query.startAt;
  if (duration <= 48 * 60 * 60 * 1_000) return "hour";
  if (duration <= 45 * 24 * 60 * 60 * 1_000) return "day";
  if (duration <= 180 * 24 * 60 * 60 * 1_000) return "week";
  return "month";
}

function bucketStart(timestamp: number, bucket: UsageBucket): number {
  const date = new Date(timestamp);
  if (bucket === "hour") date.setMinutes(0, 0, 0);
  if (bucket === "day") date.setHours(0, 0, 0, 0);
  if (bucket === "week") {
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  }
  if (bucket === "month") {
    date.setHours(0, 0, 0, 0);
    date.setDate(1);
  }
  return date.getTime();
}

function nextBucketStart(timestamp: number, bucket: UsageBucket): number {
  const date = new Date(timestamp);
  if (bucket === "hour") date.setHours(date.getHours() + 1);
  if (bucket === "day") date.setDate(date.getDate() + 1);
  if (bucket === "week") date.setDate(date.getDate() + 7);
  if (bucket === "month") date.setMonth(date.getMonth() + 1);
  return date.getTime();
}

function eventFromAssistantMessage(sourceId: string, entryId: string, message: Record<string, unknown>, fallbackTimestamp: number): UsageEventRecord | undefined {
  if (message.role !== "assistant" || typeof message.provider !== "string" || typeof message.model !== "string") return undefined;
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : fallbackTimestamp;
  return toUsageEvent(sourceId, entryId, timestamp, message.provider, message.model, "chat", conversationUsageFromAiUsage(message.usage));
}

export class UsageReportService {
  private readonly options: UsageReportServiceOptions;

  constructor(options: UsageReportServiceOptions) {
    this.options = options;
  }

  async getReport(query: UsageReportQuery): Promise<UsageReport> {
    if (!Number.isFinite(query.startAt) || !Number.isFinite(query.endAt) || query.startAt >= query.endAt) throw new Error("Usage range must have a valid start and end time");
    await this.syncSources();
    const bucket = chooseBucket(query);
    const events = this.options.database.listUsageEvents(query.startAt, query.endAt);
    const groups = new Map<string, AggregateState>();
    const trend = new Map<number, Map<string, UsageAggregate>>();
    const totals = emptyUsageAggregate();

    for (const event of events) {
      const key = groupKey(event, query.groupBy);
      const current = groups.get(key) ?? { modelKinds: new Set<UsageModelKind>(), usage: emptyUsageAggregate() };
      current.modelKinds.add(event.modelKind);
      addUsageEvent(current.usage, event);
      groups.set(key, current);
      addUsageEvent(totals, event);

      const pointStart = bucketStart(event.occurredAt, bucket);
      const point = trend.get(pointStart) ?? new Map<string, UsageAggregate>();
      const pointUsage = point.get(key) ?? emptyUsageAggregate();
      addUsageEvent(pointUsage, event);
      point.set(key, pointUsage);
      trend.set(pointStart, point);
    }

    const groupRows: UsageGroup[] = [...groups.entries()]
      .map(([key, state]) => {
        const [kind, ...parts] = key.split(":");
        const providerId = kind === "provider" ? parts[0]! : parts[1]!;
        const modelId = kind === "provider" ? null : parts.slice(2).join(":");
        const modelKind: UsageGroup["modelKind"] = state.modelKinds.size === 1 ? [...state.modelKinds][0]! : "mixed";
        return {
          key,
          providerId,
          modelId,
          modelKind,
          usage: state.usage,
        };
      })
      .sort((left, right) => right.usage.estimatedCost - left.usage.estimatedCost || right.usage.totalTokens - left.usage.totalTokens || right.usage.requestCount - left.usage.requestCount);

    const points: UsageTrendPoint[] = [];
    for (let startAt = bucketStart(query.startAt, bucket); startAt < query.endAt; startAt = nextBucketStart(startAt, bucket)) {
      points.push({
        startAt,
        values: [...(trend.get(startAt) ?? new Map<string, UsageAggregate>()).entries()].map(([key, usage]) => ({ groupKey: key, usage })),
      });
    }

    return { query, bucket, generatedAt: Date.now(), totals, groups: groupRows, trend: points };
  }

  private async syncSources(): Promise<void> {
    const knownSources = new Map(this.options.database.listUsageSources().map((source) => [source.sourceId, source]));
    const seen = new Set<string>();
    const sessions = this.options.listSessions();
    for (const session of sessions) {
      await this.syncJournal(session, session.journalPath, knownSources, seen);
      const subagentsRoot = join(this.options.journalsRoot, "subagents", session.id);
      try {
        const entries = await readdir(subagentsRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
          await this.syncJournal(session, join(subagentsRoot, entry.name), knownSources, seen);
        }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
      const project = this.options.getMediaProject(session.id);
      if (project) this.syncMediaProject(session, project, knownSources, seen);
    }
    for (const sourceId of knownSources.keys()) {
      if (!seen.has(sourceId)) this.options.database.deleteUsageSource(sourceId);
    }
  }

  private async syncJournal(session: SessionRecord, path: string, knownSources: Map<string, UsageSourceRecord>, seen: Set<string>): Promise<void> {
    let details: Awaited<ReturnType<typeof stat>>;
    try {
      details = await stat(path);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    const sourceId = sourceIdForJournal(path);
    seen.add(sourceId);
    const revision = `${details.size}:${Math.round(details.mtimeMs)}`;
    if (knownSources.get(sourceId)?.revision === revision) return;
    const journal = await openWordlessSession(path);
    const events = (await journal.getEntries()).flatMap((entry) => {
      if (entry.type !== "message") return [];
      const message = asRecord(entry.message);
      if (!message) return [];
      const event = eventFromAssistantMessage(sourceId, entry.id, message, session.updatedAt);
      return event ? [event] : [];
    });
    this.options.database.replaceUsageEvents({ sourceId, sessionId: session.id, sourceKind: "journal", revision, updatedAt: Date.now() }, events);
  }

  private syncMediaProject(session: SessionRecord, project: MediaProject, knownSources: Map<string, UsageSourceRecord>, seen: Set<string>): void {
    const sourceId = sourceIdForMedia(session.id);
    seen.add(sourceId);
    const revision = String(project.updatedAt);
    if (knownSources.get(sourceId)?.revision === revision) return;
    const events = project.operations.flatMap((operation) => {
      if (!operation.providerId || !operation.modelId) return [];
      if (operation.usageEvents && operation.usageEvents.length > 0) {
        return operation.usageEvents.map((usageEvent) => toUsageEvent(
          sourceId,
          usageEvent.id,
          usageEvent.timestamp,
          operation.providerId!,
          operation.modelId!,
          "image",
          usageEvent.usage,
        ));
      }
      return [toUsageEvent(
        sourceId,
        `legacy:${operation.id}`,
        operation.createdAt,
        operation.providerId,
        operation.modelId,
        "image",
        undefined,
        0,
        1,
      )];
    });
    this.options.database.replaceUsageEvents({ sourceId, sessionId: session.id, sourceKind: "media", revision, updatedAt: Date.now() }, events);
  }
}
