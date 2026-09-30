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
import type { SessionUsageSnapshot } from "@wordless/protocol";
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

/**
 * 一个会话的全部子代理 journal。
 *
 * 平铺的 `<taskId>.jsonl` 是内置子代理,`members/<id>.jsonl` 是专家团成员。**必须递归** ——
 * 只读平铺那层会把专家成员的用量整段漏掉,而渲染层的工具块里又包含它,于是同一个会话会出现
 * 两个不相等的数字。
 */
export async function subagentJournalPaths(
  journalsRoot: string,
  sessionId: string,
): Promise<string[]> {
  const root = join(journalsRoot, "subagents", sessionId);
  const paths: string[] = [];
  const collect = async (directory: string, depth: number): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    for (const entry of entries) {
      if (entry.name.endsWith(".jsonl") && entry.isFile()) {
        paths.push(join(directory, entry.name));
        continue;
      }
      // 只往成员目录里再走一层,不做无界遍历。
      if (depth === 0 && entry.isDirectory()) await collect(join(directory, entry.name), depth + 1);
    }
  };
  await collect(root, 0);
  return paths.sort();
}

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

/**
 * 唯一的实现处是 `@wordless/domain`(见那里的注释:这曾有三份逐字重复的副本,而它们的
 * 全零判断并不一致)。这里只做再导出,免得又长出一份。
 */
import {
  conversationUsageFromAiUsage,
  conversationUsageFromUnknown,
  emptyTokenUsageSummary,
  summarizeTokenUsage,
} from "@wordless/domain";

export { conversationUsageFromAiUsage };

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

/**
 * 把收集结果装配成对外的会话总计。**纯函数**:分类与口径在这里,读取在那里。
 *
 * 对话与图片分开:图片的计费形态不同(按张 / 按 token 混着),把它并进对话的命中率分母是错的 ——
 * 那会让"命中率"这个数在混了图片的会话里失去意义。图片只报计数与金额。
 */
export function summarizeSessionUsage(
  collection: SessionUsageCollection,
): SessionUsageSnapshot {
  const bySource = (source: SessionUsageSource) =>
    collection.records.filter((record) => record.source === source);
  const primary = bySource("primary");
  const delegated = bySource("delegated");
  const chat =
    summarizeTokenUsage(
      [...primary, ...delegated].map((record) => record.usage),
      { primaryCalls: primary.length, delegatedCalls: delegated.length },
    ) ?? emptyTokenUsageSummary();
  let totalTokens = 0;
  let totalCost = 0;
  for (const record of bySource("image")) {
    totalTokens += record.usage.totalTokens;
    totalCost += record.usage.totalCost;
  }
  return {
    chat,
    image: {
      operations: collection.imageOperations,
      unmeteredOperations: collection.unmeteredImageOperations,
      totalTokens,
      totalCost,
    },
    unmeasuredCalls: collection.unmeasuredCalls,
  };
}

/** 一条会话级用量记录的来源。委派与图片分开计,因为它们的语义不同。 */
export type SessionUsageSource = "primary" | "delegated" | "image";

export interface SessionUsageRecord {
  source: SessionUsageSource;
  usage: ConversationUsage;
}

export interface SessionUsageCollection {
  records: readonly SessionUsageRecord[];
  /**
   * 有助手消息但拿不到用量的调用数(网络失败、被中断、历史记录没写用量)。
   * 与"用量为 0"是两件事 —— 这是"我们不知道",所以单独报出来。
   */
  unmeasuredCalls: number;
  /** 图片操作总数,以及其中没有用量的那些。 */
  imageOperations: number;
  unmeteredImageOperations: number;
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
      for (const path of await subagentJournalPaths(this.options.journalsRoot, session.id)) {
        await this.syncJournal(session, path, knownSources, seen);
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

  /**
   * 一个会话的用量记录,直接来自 journal —— **不经过派生表**。
   *
   * 为什么不用 `usage_events`:那张表是为"按时间跨会话聚合"建的,它的列里没有逐条调用的缓存
   * 观测级别,拿它算命中率就会把"未上报"当成"没命中"(§3 的 I2)。而 journal 里逐条记录带着
   * 原始事实,所以会话总计与逐轮面板由**同一套纯函数**算出,不可能给出两个口径。
   *
   * 同时也是唯一正确的地方:上下文被压缩后,早前的消息已经不在会话里,但 journal 里还在 ——
   * 从消息求和会少算,而花费不会因为压缩而消失。
   */
  async collectSessionUsage(session: SessionRecord): Promise<SessionUsageCollection> {
    const records: SessionUsageRecord[] = [];
    let unmeasuredCalls = 0;

    const collectJournal = async (path: string, source: SessionUsageSource): Promise<void> => {
      let details: Awaited<ReturnType<typeof stat>>;
      try {
        details = await stat(path);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
        throw cause;
      }
      if (!details.isFile()) return;
      const journal = await openWordlessSession(path);
      for (const entry of await journal.getEntries()) {
        if (entry.type !== "message") continue;
        const message = asRecord(entry.message);
        // 只读助手消息:工具块上的用量是**委派结果的副本**,这里的子代理 journal 已经各自
        // 记过一遍,两边都算就是重复计数。
        if (!message || message.role !== "assistant") continue;
        const usage = conversationUsageFromAiUsage(message.usage);
        if (usage) records.push({ source, usage });
        else unmeasuredCalls += 1;
      }
    };

    await collectJournal(session.journalPath, "primary");
    for (const path of await subagentJournalPaths(this.options.journalsRoot, session.id)) {
      await collectJournal(path, "delegated");
    }

    const project = this.options.getMediaProject(session.id);
    const operations = project?.operations ?? [];
    let unmeteredImageOperations = 0;
    for (const operation of operations) {
      if (!operation.providerId || !operation.modelId) {
        unmeteredImageOperations += 1;
        continue;
      }
      const events = operation.usageEvents ?? [];
      if (events.length === 0) {
        unmeteredImageOperations += 1;
        continue;
      }
      for (const event of events) {
        // 媒体用量事件存的是**已经折算过**的 `ConversationUsage`(camelCase 那套键),
        // 所以走 `conversationUsageFromUnknown`,不是适配器形状的那个映射。
        const usage = conversationUsageFromUnknown(event.usage);
        if (usage) records.push({ source: "image", usage });
        else unmeteredImageOperations += 1;
      }
    }

    return {
      records,
      unmeasuredCalls,
      imageOperations: operations.length,
      unmeteredImageOperations,
    };
  }
}
