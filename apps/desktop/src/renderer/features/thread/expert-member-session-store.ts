import type {
  ConversationMessage,
  ExpertMemberLiveMessage,
  RuntimeEventEnvelope,
  SessionHistoryPage,
} from "@wordless/protocol";
import type { MessageToolBlock } from "@wordless/domain";
import type { RuntimeClient } from "../../bridge/runtime-client";
import type {
  ThreadRowSnapshot,
  ThreadTimelineDescriptor,
  ThreadTimelineSnapshot,
} from "./thread-session-store.ts";
import {
  assistantToolActivity,
  mergeCompletedAssistantMessage,
  type AssistantRunActivity,
} from "./thread-run-state.ts";
import type { AnimationFrameScheduler } from "./thread-viewport-store.ts";
import {
  ChunkAccumulator,
  sameReferenceArray,
  TextDeltaAccumulator,
  type TextDeltaSegment,
  ThreadProjectionPublisher,
} from "./thread-projection-core.ts";

export type ExpertMemberMetadataSnapshot = {
  activity: AssistantRunActivity;
  error: string | null;
  loading: boolean;
};

type MemberDeltaMetadata = {
  revision: number;
  since: number;
  taskId: string;
};
type MemberToolUpdatedEvent = Extract<RuntimeEventEnvelope["event"], { type: "expert-member.tool.updated" }>;

const EMPTY_ROW: ThreadRowSnapshot = {
  key: "missing",
  messages: [],
  presentation: null,
  type: "assistant",
};

const browserFrames: AnimationFrameScheduler = {
  cancel: (handle) => window.cancelAnimationFrame(handle),
  request: (callback) => window.requestAnimationFrame(callback),
};

function taskIdFromMemberTurnId(turnId: string): string | undefined {
  const prefix = "turn:";
  if (!turnId.startsWith(prefix)) return undefined;
  const taskId = turnId.slice(prefix.length);
  return taskId.length > 0 ? taskId : undefined;
}

export class ExpertMemberSessionStore {
  private readonly client: RuntimeClient;
  private readonly scheduler: AnimationFrameScheduler;
  readonly sessionId: string;
  readonly memberId: string;
  private readonly rows = new Map<string, ThreadRowSnapshot>();
  private readonly descriptors = new Map<string, ThreadTimelineDescriptor>();
  private readonly taskToRow = new Map<string, string>();
  private readonly messageToRow = new Map<string, string>();
  private readonly messageAliases = new Map<string, string>();
  private readonly toolToMessage = new Map<string, string>();
  private readonly publisher = new ThreadProjectionPublisher();
  private readonly pendingDeltas = new TextDeltaAccumulator<MemberDeltaMetadata>();
  private readonly pendingToolUpdates = new ChunkAccumulator<string, MemberToolUpdatedEvent>();
  private readonly bufferedEvents: RuntimeEventEnvelope[] = [];
  private readonly revisions = new Map<string, number>();
  private timeline: ThreadTimelineSnapshot = { items: [], firstItemIndex: 100_000 };
  private metadata: ExpertMemberMetadataSnapshot;
  private history: SessionHistoryPage | null = null;
  private frame: number | null = null;
  private started = false;
  private hydrating = false;
  private disposed = false;
  private loadingBefore = false;
  private refreshLatestPromise: Promise<void> | null = null;
  private refreshLatestQueued = false;

  constructor(
    client: RuntimeClient,
    sessionId: string,
    memberId: string,
    startedAt: number,
    scheduler: AnimationFrameScheduler = browserFrames,
  ) {
    this.client = client;
    this.scheduler = scheduler;
    this.sessionId = sessionId;
    this.memberId = memberId;
    this.metadata = {
      activity: { type: "thinking", since: startedAt },
      error: null,
      loading: true,
    };
  }

  readonly getTimelineSnapshot = () => this.timeline;
  readonly getMetadataSnapshot = () => this.metadata;
  readonly getLoadingSnapshot = () => this.metadata.loading;
  readonly getRowSnapshot = (key: string) => this.rows.get(key) ?? EMPTY_ROW;
  readonly subscribeTimeline = (listener: () => void) => {
    return this.publisher.subscribe("timeline", listener);
  };
  readonly subscribeTailGrowth = (listener: () => void) => {
    return this.publisher.subscribe("tail-growth", listener);
  };
  readonly subscribeMetadata = (listener: () => void) => {
    return this.publisher.subscribe("metadata", listener);
  };
  readonly subscribeLoading = (listener: () => void) => {
    return this.publisher.subscribe("loading", listener);
  };
  readonly subscribeRow = (key: string, listener: () => void) => {
    return this.publisher.subscribeRow(key, listener);
  };

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    await this.hydrate();
  }

  async rehydrate(): Promise<void> {
    if (this.disposed) return;
    await this.hydrate(true);
  }

  async handleRuntimeChange(): Promise<void> {
    if (this.disposed) return;
    if (this.started) {
      await this.hydrate(true);
      return;
    }
    this.publisher.transaction(() => this.clearProjection());
  }

  private async hydrate(replace = false): Promise<void> {
    if (this.hydrating || this.disposed) return;
    this.hydrating = true;
    this.patchMetadata({ loading: true });
    try {
      const [history, live] = await Promise.all([
        this.client.getExpertMemberHistory(this.sessionId, this.memberId, {}),
        this.client.getExpertMemberLiveState(this.sessionId, this.memberId),
      ]);
      if (this.disposed) return;
      this.publisher.transaction(() => {
        this.installHistory(history, replace || this.timeline.items.length === 0);
        if (live) this.installLive(live);
        this.patchMetadata({ error: null, loading: false });
      });
      this.hydrating = false;
      for (const envelope of this.bufferedEvents.splice(0)) this.acceptEnvelope(envelope);
    } catch (cause) {
      if (!this.disposed) {
        this.hydrating = false;
        this.patchMetadata({
          error: cause instanceof Error ? cause.message : String(cause),
          loading: false,
        });
        for (const envelope of this.bufferedEvents.splice(0)) this.acceptEnvelope(envelope);
      }
    }
  }

  acceptEnvelope(envelope: RuntimeEventEnvelope): void {
    const event = envelope.event;
    if (!event.type.startsWith("expert-member.") || !("memberId" in event) || event.memberId !== this.memberId)
      return;
    if (this.hydrating) {
      this.bufferedEvents.push(envelope);
      return;
    }
    if (event.type === "expert-member.message.text.delta" || event.type === "expert-member.message.reasoning.delta") {
      if (event.revision <= (this.revisions.get(event.taskId) ?? 0)) return;
      const kind = event.type === "expert-member.message.text.delta" ? "text" : "reasoning";
      this.pendingDeltas.add(event.messageId, kind, event.delta, {
        revision: event.revision,
        since: envelope.timestamp,
        taskId: event.taskId,
      });
      if (this.frame === null) this.frame = this.scheduler.request(() => this.flushDeltas());
      return;
    }
    if (event.type === "expert-member.tool.updated") {
      this.pendingToolUpdates.add(event.callId, event.output, event);
      if (this.frame === null) this.frame = this.scheduler.request(() => this.flushDeltas());
      return;
    }
    this.flushDeltas();
    this.publisher.transaction(() => this.applyEnvelope(envelope));
  }

  private applyEnvelope(envelope: RuntimeEventEnvelope): void {
    const event = envelope.event;
    if (!event.type.startsWith("expert-member.") || !("memberId" in event) || event.memberId !== this.memberId)
      return;
    if (event.type === "expert-member.message.started" || event.type === "expert-member.message.completed") {
      this.installLive({
        memberId: event.memberId,
        taskId: event.taskId,
        message: event.message,
        revision: event.revision,
      });
      if (event.type === "expert-member.message.completed" && this.started && this.shouldRefreshAfterCompletion(event.message))
        void this.refreshLatest();
      return;
    }
    if (event.type === "expert-member.message.text.delta" || event.type === "expert-member.message.reasoning.delta")
      return;
    const messageId = event.messageId;
    const key = this.taskToRow.get(event.taskId) ?? this.ensureLiveRow(event.taskId, messageId, envelope.timestamp);
    const row = this.rows.get(key);
    const message = this.resolveMessage(row, messageId, key);
    if (!message) return;
    const updatedMessage = this.applyActivity(message, event);
    this.replaceMessage(key, updatedMessage);
    if (event.type === "expert-member.tool.started")
      this.patchMetadata({ activity: { type: "tool", tool: assistantToolActivity(event.name, event.source), phase: "running", since: envelope.timestamp } });
    else if (event.type === "expert-member.tool.completed") {
      const completedTool = updatedMessage.blocks.find(
        (block): block is MessageToolBlock => block.type === "tool" && block.callId === event.callId,
      );
      this.patchMetadata({
        activity: {
          type: "tool-result",
          tool: assistantToolActivity(completedTool?.name ?? "tool", event.source),
          outcome: event.isError ? "failure" : "success",
          since: envelope.timestamp,
        },
      });
    }
    else if (event.type === "expert-member.approval.requested")
      this.patchMetadata({ activity: { type: "awaiting-approval", since: envelope.timestamp } });
  }

  async loadOlder(): Promise<void> {
    if (this.loadingBefore || !this.history?.hasMoreBefore || !this.history.nextBeforeCursor) return;
    this.loadingBefore = true;
    try {
      this.installHistory(await this.client.getExpertMemberHistory(
        this.sessionId,
        this.memberId,
        { before: this.history.nextBeforeCursor },
      ), false);
    } finally {
      this.loadingBefore = false;
    }
  }

  async loadToolOutput(callId: string): Promise<void> {
    const output = await this.client.getExpertMemberToolOutput(this.sessionId, this.memberId, callId);
    const messageId = this.toolToMessage.get(callId);
    const key = messageId ? this.messageToRow.get(messageId) : undefined;
    const row = key ? this.rows.get(key) : undefined;
    const message = key && messageId ? this.resolveMessage(row, messageId, key) : undefined;
    if (!key || !message) return;
    this.replaceMessage(key, {
      ...message,
      blocks: message.blocks.map((block) => block.type === "tool" && block.callId === callId
        ? { ...block, output, outputTruncated: false }
        : block),
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.pendingDeltas.clear();
    this.pendingToolUpdates.clear();
    this.bufferedEvents.length = 0;
    this.publisher.dispose();
  }

  private refreshLatest(): Promise<void> {
    if (this.refreshLatestPromise) {
      this.refreshLatestQueued = true;
      return this.refreshLatestPromise;
    }
    this.refreshLatestQueued = false;
    this.refreshLatestPromise = this.client.getExpertMemberHistory(this.sessionId, this.memberId, {})
      .then((page) => {
        if (!this.disposed) this.installHistory(page, false);
      })
      .catch(() => {
        // Live state remains canonical until the next successful merge.
      })
      .finally(() => {
        this.refreshLatestPromise = null;
        if (this.refreshLatestQueued && !this.disposed) void this.refreshLatest();
      });
    return this.refreshLatestPromise;
  }

  private installHistory(page: SessionHistoryPage, replace: boolean): void {
    this.publisher.transaction(() => this.installHistoryNow(page, replace));
  }

  private installHistoryNow(page: SessionHistoryPage, replace: boolean): void {
    const previousTimeline = this.timeline;
    if (replace) {
      if (this.frame !== null) this.scheduler.cancel(this.frame);
      this.frame = null;
      this.pendingDeltas.clear();
      this.pendingToolUpdates.clear();
      this.revisions.clear();
      this.rows.clear();
      this.descriptors.clear();
      this.messageToRow.clear();
      this.taskToRow.clear();
      this.messageAliases.clear();
      this.toolToMessage.clear();
    }
    const ordered = new Map((replace ? [] : this.timeline.items).map((item) => [item.key, item]));
    for (const item of page.items) {
      if (item.type !== "turn") continue;
      // Expert member prompts are persisted with the delegated task id as
      // their submission id. Keep the history assistant row on the exact
      // same key as its live task row so a refresh cannot duplicate identity
      // headers while the journal catches up.
      const taskId = taskIdFromMemberTurnId(item.turn.id);
      const user = item.turn.messages.find((message) => message.role === "user");
      const assistants = item.turn.messages.filter((message) => message.role === "assistant");
      if (user) {
        const key = `user:${item.turn.id}`;
        const descriptor = this.descriptors.get(key) ?? { type: "user" as const, key, turnId: item.turn.id, messageId: user.id };
        this.descriptors.set(key, descriptor);
        ordered.set(key, descriptor);
        this.messageToRow.set(user.id, key);
        this.setRow(key, { key, type: "user", messages: [user], presentation: null });
      }
      const key = taskId
        ? `assistant:member:${taskId}`
        : `assistant:${item.turn.id}`;
      if (taskId) this.taskToRow.set(taskId, key);
      const descriptor = this.descriptors.get(key) ?? { type: "assistant" as const, key, turnId: item.turn.id };
      this.descriptors.set(key, descriptor);
      ordered.set(key, descriptor);
      const existingMessages = [...(this.rows.get(key)?.messages ?? [])];
      const merged = new Map(existingMessages.map((message) => [message.id, message]));
      const legacyLiveRows = new Map<string, readonly ConversationMessage[]>();
      for (const message of assistants) {
        const oldKey = this.messageToRow.get(message.id);
        if (oldKey && oldKey !== key && !legacyLiveRows.has(oldKey))
          legacyLiveRows.set(oldKey, this.rows.get(oldKey)?.messages ?? []);
      }
      for (const [index, message] of assistants.entries()) {
        const oldKey = this.messageToRow.get(message.id);
        const liveMessage = oldKey && oldKey !== key
          ? legacyLiveRows.get(oldKey)?.find((candidate) => candidate.id === message.id)
          : undefined;
        if (oldKey && oldKey !== key) {
          ordered.delete(oldKey);
          this.rows.delete(oldKey);
        }
        // Live driver ids and journal entry ids are different namespaces. For
        // a task row, assistant message order is the stable correspondence;
        // pair persisted messages with the same-position live message before
        // inserting the persisted id, otherwise one response is rendered twice.
        const positionalLive = existingMessages[index] ?? (oldKey ? legacyLiveRows.get(oldKey)?.[index] : undefined);
        const current = merged.get(message.id) ?? liveMessage ?? positionalLive;
        if (current && current.id !== message.id) merged.delete(current.id);
        // The live projection is newer than a just-read history preview. Keep
        // its text/status while importing any persisted tool metadata.
        merged.set(message.id, current ? mergeCompletedAssistantMessage(message, current) : message);
        this.messageToRow.set(message.id, key);
        const mergedMessage = merged.get(message.id);
        if (mergedMessage) this.indexMessage(mergedMessage);
      }
      this.setRow(key, { key, type: "assistant", messages: [...merged.values()], presentation: null });
    }
    const items = [...ordered.values()].sort((left, right) => {
      const leftRow = this.rows.get(left.key);
      const rightRow = this.rows.get(right.key);
      const leftTime = leftRow?.messages[0]?.timestamp ?? 0;
      const rightTime = rightRow?.messages[0]?.timestamp ?? 0;
      if (leftTime !== rightTime) return leftTime - rightTime;
      if (
        left.type !== "compaction" && right.type !== "compaction" &&
        left.turnId === right.turnId && left.type !== right.type
      )
        return left.type === "user" ? -1 : 1;
      return left.key.localeCompare(right.key);
    });
    const added = items.length - this.timeline.items.length;
    const nextTimeline = {
      items,
      firstItemIndex: replace ? 100_000 - items.length : previousTimeline.firstItemIndex - Math.max(0, added),
    };
    this.history = page;
    if (
      nextTimeline.firstItemIndex !== previousTimeline.firstItemIndex ||
      !sameReferenceArray(nextTimeline.items, previousTimeline.items)
    ) {
      this.timeline = nextTimeline;
      this.publisher.publish("timeline");
    }
  }

  private clearProjection(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.pendingDeltas.clear();
    this.pendingToolUpdates.clear();
    this.revisions.clear();
    this.rows.clear();
    this.descriptors.clear();
    this.messageToRow.clear();
    this.taskToRow.clear();
    this.messageAliases.clear();
    this.toolToMessage.clear();
    const hadItems = this.timeline.items.length > 0;
    this.timeline = { items: [], firstItemIndex: 100_000 };
    if (hadItems) this.publisher.publish("timeline");
  }

  private installLive(live: ExpertMemberLiveMessage): void {
    if (live.revision <= (this.revisions.get(live.taskId) ?? 0)) return;
    this.revisions.set(live.taskId, live.revision);
    const key = this.taskToRow.get(live.taskId) ?? this.ensureLiveRow(live.taskId, live.message.id, live.message.timestamp);
    this.replaceMessage(key, live.message);
    this.indexMessage(live.message);
    this.patchMetadata({ activity: this.activityFromMessage(live.message, Date.now()) });
  }

  private ensureLiveRow(taskId: string, messageId: string, timestamp: number): string {
    // A delegated member task is one conversational turn. Tool loops may
    // produce several assistant messages, but they must share one row and
    // therefore one member identity header.
    const key = `assistant:member:${taskId}`;
    this.taskToRow.set(taskId, key);
    if (!this.descriptors.has(key)) {
      const descriptor = { type: "assistant" as const, key, turnId: `turn:${taskId}` };
      this.descriptors.set(key, descriptor);
      this.timeline = { items: [...this.timeline.items, descriptor], firstItemIndex: this.timeline.firstItemIndex };
      this.publisher.publish("timeline");
    }
    if (!this.rows.has(key))
      this.setRow(key, { key, type: "assistant", messages: [{ id: messageId, role: "assistant", status: "streaming", blocks: [], model: null, timestamp }], presentation: null });
    this.messageToRow.set(messageId, key);
    return key;
  }

  private resolveMessage(
    row: ThreadRowSnapshot | undefined,
    messageId: string,
    key: string,
  ): ConversationMessage | undefined {
    if (!row) return undefined;
    const exact = row.messages.find((candidate) => candidate.id === messageId);
    if (exact) return exact;
    const aliasedId = this.messageAliases.get(messageId);
    const aliased = aliasedId
      ? row.messages.find((candidate) => candidate.id === aliasedId)
      : undefined;
    if (aliased) return aliased;
    const fallback = [...row.messages].reverse().find((candidate) => candidate.role === "assistant");
    if (!fallback) return undefined;
    this.messageAliases.set(messageId, fallback.id);
    this.messageToRow.set(messageId, key);
    return fallback;
  }

  private flushDeltas(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    if (this.pendingDeltas.size === 0 && this.pendingToolUpdates.size === 0) return;
    this.publisher.transaction(() => {
      let latest: TextDeltaSegment<MemberDeltaMetadata> | undefined;
      for (const [messageId, deltas] of this.pendingDeltas.entries()) {
        const last = deltas.at(-1)!;
        const key = this.messageToRow.get(messageId) ?? this.ensureLiveRow(last.metadata.taskId, messageId, last.metadata.since);
        const row = this.rows.get(key)!;
        const message = this.resolveMessage(row, messageId, key);
        if (!message) continue;
        const blocks = [...message.blocks];
        for (const delta of deltas) {
          const text = delta.chunks.join("");
          const block = blocks.at(-1);
          if (block?.type === delta.kind) blocks[blocks.length - 1] = { ...block, text: block.text + text };
          else blocks.push({ type: delta.kind, text });
        }
        this.revisions.set(last.metadata.taskId, last.metadata.revision);
        this.replaceMessage(key, { ...message, blocks });
        if (!latest || last.metadata.since >= latest.metadata.since) latest = last;
      }
      if (latest)
        this.patchMetadata({ activity: { type: latest.kind === "text" ? "generating" : "thinking", since: latest.metadata.since } });
      this.pendingDeltas.clear();
      for (const pending of this.pendingToolUpdates.values()) {
        const event = { ...pending.metadata, output: pending.chunks.join("") };
        const key = this.taskToRow.get(event.taskId) ?? this.messageToRow.get(event.messageId);
        const row = key ? this.rows.get(key) : undefined;
        const message = key ? this.resolveMessage(row, event.messageId, key) : undefined;
        if (!key || !message) continue;
        this.replaceMessage(key, this.applyActivity(message, event));
      }
      this.pendingToolUpdates.clear();
    });
  }

  private applyActivity(
    message: ConversationMessage,
    event: Exclude<Extract<RuntimeEventEnvelope["event"], { type: `expert-member.${string}` }>, { type: `expert-member.message.${string}` }>,
  ): ConversationMessage {
    const callId = event.type === "expert-member.approval.requested"
      ? event.approval.callId
      : event.type === "expert-member.approval.resolved"
        ? event.resolution.approvalId
        : event.callId;
    const existing = message.blocks.find((block): block is MessageToolBlock => block.type === "tool" && (block.callId === callId || block.approval?.approvalId === callId));
    let tool: MessageToolBlock | undefined;
    if (event.type === "expert-member.tool.started")
      tool = { type: "tool", callId: event.callId, name: event.name, input: event.input, source: event.source, state: "running" };
    else if (event.type === "expert-member.tool.updated" || event.type === "expert-member.tool.completed")
      tool = {
        ...(existing ?? { type: "tool", callId: event.callId, name: "tool" }),
        output: event.type === "expert-member.tool.updated" ? `${existing?.output ?? ""}${event.output}` : event.output,
        details: event.details ?? existing?.details,
        source: event.source ?? existing?.source,
        state: event.type === "expert-member.tool.completed" ? (event.isError ? "error" : "complete") : "running",
      };
    else if (event.type === "expert-member.approval.requested")
      tool = { ...(existing ?? { type: "tool", callId: event.approval.callId, name: event.approval.toolName }), state: "awaiting-approval", approval: { ...event.approval, status: "required" } };
    else if (existing)
      tool = { ...existing, state: event.resolution.approved ? "running" : "error", approval: existing.approval ? { ...existing.approval, status: event.resolution.approved ? "approved" : "rejected", feedback: event.resolution.feedback } : undefined };
    if (!tool) return message;
    return {
      ...message,
      blocks: existing
        ? message.blocks.map((block) => block === existing ? tool! : block)
        : [...message.blocks, tool],
    };
  }

  private replaceMessage(key: string, message: ConversationMessage): void {
    const current = this.rows.get(key);
    const messages = current?.messages.some((candidate) => candidate.id === message.id)
      ? current.messages.map((candidate) => candidate.id === message.id ? message : candidate)
      : [...(current?.messages ?? []), message];
    this.setRow(key, { key, type: "assistant", messages, presentation: null });
    this.messageToRow.set(message.id, key);
    this.indexMessage(message);
  }

  private indexMessage(message: ConversationMessage): void {
    for (const block of message.blocks)
      if (block.type === "tool") this.toolToMessage.set(block.callId, message.id);
  }

  private activityFromMessage(message: ConversationMessage, since: number): AssistantRunActivity {
    const tool = [...message.blocks].reverse().find((block): block is MessageToolBlock => block.type === "tool");
    if (tool?.state === "awaiting-approval") return { type: "awaiting-approval", since };
    if (tool?.state === "running") return { type: "tool", tool: assistantToolActivity(tool.name, tool.source), phase: "running", since };
    return message.blocks.at(-1)?.type === "text" ? { type: "generating", since } : { type: "thinking", since };
  }

  private shouldRefreshAfterCompletion(message: ConversationMessage): boolean {
    return !message.blocks.some((block) => block.type === "tool" && (
      block.state === "pending" ||
      block.state === "running" ||
      block.state === "awaiting-approval" ||
      block.state === "awaiting-user-input"
    ));
  }

  private setRow(key: string, row: ThreadRowSnapshot): void {
    const current = this.rows.get(key);
    if (
      current && current.presentation === row.presentation &&
      current.compaction === row.compaction &&
      sameReferenceArray(current.messages, row.messages)
    ) return;
    this.rows.set(key, row);
    if (this.timeline.items.at(-1)?.key === key)
      this.publisher.publish("tail-growth");
    this.publisher.publishRow(key);
  }

  private patchMetadata(patch: Partial<ExpertMemberMetadataSnapshot>): void {
    const next = { ...this.metadata, ...patch };
    if (Object.keys(patch).every((key) => Object.is(
      this.metadata[key as keyof ExpertMemberMetadataSnapshot],
      next[key as keyof ExpertMemberMetadataSnapshot],
    ))) return;
    const loadingChanged = this.metadata.loading !== next.loading;
    this.metadata = next;
    if (loadingChanged) this.publisher.publish("loading");
    this.publisher.publish("metadata");
  }
}
