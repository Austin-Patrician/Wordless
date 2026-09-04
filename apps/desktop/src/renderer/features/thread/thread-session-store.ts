import type {
  ConversationMessage,
  RuntimeEventEnvelope,
  SessionHistoryPage,
  SessionSnapshot,
  SessionTurnSummary,
  SessionViewSnapshot,
} from "@wordless/protocol";
import type {
  ContextCompactionRecord,
  MessageToolBlock,
  ModelRetryState,
  ToolApprovalMode,
} from "@wordless/domain";
import { calculateCurrentTurnUsage } from "@wordless/domain";
import type { RuntimeClient } from "../../bridge/runtime-client";
import type { MessageKey } from "../../shared/i18n";
import type { PendingThreadTurn } from "./pending-thread-turn";
import { ExpertMemberSessionStore } from "./expert-member-session-store.ts";
import {
  advanceAssistantRunPresentation,
  assistantRunPresentationFromMessages,
  createAssistantRunPresentation,
  mergeCompletedAssistantMessage,
  type AssistantRunPresentation,
} from "./thread-run-state.ts";
import type { AnimationFrameScheduler } from "./thread-viewport-store";
import {
  BoundedIdCache,
  ChunkAccumulator,
  sameReferenceArray,
  TextDeltaAccumulator,
  ThreadProjectionPublisher,
} from "./thread-projection-core.ts";
import { buildSessionTurnSummary, sessionTurnSummaryEquals } from "./turn-summary.ts";

export type ThreadTimelineDescriptor =
  | { type: "user"; key: string; turnId: string; messageId: string }
  | { type: "assistant"; key: string; turnId: string }
  | { type: "compaction"; key: string; compactionId: string };

export type ThreadRowSnapshot = {
  key: string;
  type: "user" | "assistant" | "compaction";
  messages: readonly ConversationMessage[];
  presentation: AssistantRunPresentation | null;
  compaction?: ContextCompactionRecord;
};

export type ThreadTimelineSnapshot = {
  items: readonly ThreadTimelineDescriptor[];
  firstItemIndex: number;
};

export type ThreadHistorySnapshot = {
  hasMoreAfter: boolean;
  hasMoreBefore: boolean;
  nextAfterCursor?: string;
  nextBeforeCursor?: string;
  revision: string;
  turnSummaries: SessionViewSnapshot["turnSummaries"];
};

export type ThreadMetadataSnapshot = {
  compactionError?: string;
  compactionTrigger?: ContextCompactionRecord["trigger"];
  contextUsage?: SessionSnapshot["contextUsage"];
  error: string | null;
  expertCollaboration?: SessionSnapshot["expertCollaboration"];
  extensions: SessionSnapshot["extensions"];
  isCompacting: boolean;
  isRunning: boolean;
  modelRetry?: ModelRetryState;
  loading: boolean;
  needsRehydrate: boolean;
  session: SessionSnapshot["session"] | null;
  toolApprovalMode: ToolApprovalMode;
  turnUsage?: SessionSnapshot["turnUsage"];
};

export type ThreadRuntimeSubscribe = (
  listener: (event: RuntimeEventEnvelope) => void,
) => () => void;

type TurnRecord = {
  assistantIds: string[];
  assistantOrder: number;
  timestamp: number;
  turnId: string;
  userId?: string;
};

type ToolLocation = { blockIndex: number; messageId: string };
type ToolUpdatedEvent = Extract<RuntimeEventEnvelope["event"], { type: "tool.updated" }>;

const EMPTY_ROW: ThreadRowSnapshot = {
  key: "missing",
  type: "assistant",
  messages: [],
  presentation: null,
};

const EMPTY_HISTORY: ThreadHistorySnapshot = {
  hasMoreAfter: false,
  hasMoreBefore: false,
  revision: "",
  turnSummaries: [],
};

const browserFrameScheduler: AnimationFrameScheduler = {
  cancel: (handle) => window.cancelAnimationFrame(handle),
  request: (callback) => window.requestAnimationFrame(callback),
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function approvalFromDetails(
  details: unknown,
  existing: MessageToolBlock["approval"],
): MessageToolBlock["approval"] {
  const approval = asRecord(details)?.approval;
  if (!asRecord(approval)) return existing;
  return approval as MessageToolBlock["approval"];
}

function userRequestFromDetails(
  details: unknown,
  existing: MessageToolBlock["userRequest"],
): MessageToolBlock["userRequest"] {
  const userRequest = asRecord(details)?.userRequest;
  return asRecord(userRequest) ? userRequest as MessageToolBlock["userRequest"] : existing;
}

function messagesFromPage(page: SessionHistoryPage): ConversationMessage[] {
  return page.items.flatMap((item) => item.type === "turn" ? item.turn.messages : []);
}

function compactionsFromPage(page: SessionHistoryPage): ContextCompactionRecord[] {
  return page.items.flatMap((item) => item.type === "compaction" ? [item.compaction] : []);
}

export class ThreadSessionStore {
  private readonly client: RuntimeClient;
  private readonly runtimeSubscribe: ThreadRuntimeSubscribe;
  readonly sessionId: string;
  private translate: (key: MessageKey) => string;
  private readonly scheduler: AnimationFrameScheduler;
  private readonly messagesById = new Map<string, ConversationMessage>();
  private readonly messageToTurn = new Map<string, string>();
  private readonly toolsByCallId = new Map<string, ToolLocation>();
  private readonly toolCallIdsByMessage = new Map<string, Set<string>>();
  private readonly toolCallIdsByName = new Map<string, Set<string>>();
  private readonly toolNameByCallId = new Map<string, string>();
  private readonly toolsByNameSnapshots = new Map<string, readonly MessageToolBlock[]>();
  private readonly activeToolCallIds = new Set<string>();
  private readonly approvalToCallId = new Map<string, string>();
  private readonly requestToCallId = new Map<string, string>();
  private readonly expertTaskToCallId = new Map<string, string>();
  private readonly turns = new Map<string, TurnRecord>();
  private readonly compactions = new Map<string, ContextCompactionRecord>();
  private readonly descriptorCache = new Map<string, ThreadTimelineDescriptor>();
  private readonly timelineIndexByKey = new Map<string, number>();
  private readonly rows = new Map<string, ThreadRowSnapshot>();
  private readonly publisher = new ThreadProjectionPublisher();
  private readonly seenEventIds = new BoundedIdCache(20_000);
  private readonly pendingDeltas = new TextDeltaAccumulator<RuntimeEventEnvelope>();
  private readonly pendingToolUpdates = new ChunkAccumulator<string, ToolUpdatedEvent>();
  private readonly memberStores = new Map<string, ExpertMemberSessionStore>();
  private readonly bufferedEvents: RuntimeEventEnvelope[] = [];
  private unsubscribeRuntime: (() => void) | null = null;
  private deltaFrame: number | null = null;
  private disposed = false;
  private hydrating = false;
  private recoveryGeneration = 0;
  private runtimeInstanceId: string | null = null;
  private cursorRunId: string | undefined;
  private cursorSequence: number | null = null;
  private activeTurnId: string | null = null;
  private loadingBefore = false;
  private loadingAfter = false;
  private timelineSnapshot: ThreadTimelineSnapshot = { items: [], firstItemIndex: 100_000 };
  private messagesSnapshot: ConversationMessage[] = [];
  private userMessagesSnapshot: ConversationMessage[] = [];
  private compactionsSnapshot: ContextCompactionRecord[] = [];
  private messagesSnapshotDirty = true;
  private userMessagesSnapshotDirty = true;
  private compactionsSnapshotDirty = true;
  private historySnapshot: ThreadHistorySnapshot = EMPTY_HISTORY;
  private metadataSnapshot: ThreadMetadataSnapshot = {
    error: null,
    extensions: [],
    isCompacting: false,
    isRunning: false,
    loading: true,
    needsRehydrate: false,
    session: null,
    toolApprovalMode: "manual",
  };

  constructor(
    client: RuntimeClient,
    sessionId: string,
    translate: (key: MessageKey) => string,
    scheduler: AnimationFrameScheduler = browserFrameScheduler,
    runtimeSubscribe: ThreadRuntimeSubscribe = (listener) => client.subscribe(listener),
  ) {
    this.client = client;
    this.sessionId = sessionId;
    this.translate = translate;
    this.scheduler = scheduler;
    this.runtimeSubscribe = runtimeSubscribe;
  }

  readonly getTimelineSnapshot = (): ThreadTimelineSnapshot => this.timelineSnapshot;
  readonly getMetadataSnapshot = (): ThreadMetadataSnapshot => this.metadataSnapshot;
  readonly getLoadingSnapshot = (): boolean => this.metadataSnapshot.loading;
  readonly getHistorySnapshot = (): ThreadHistorySnapshot => this.historySnapshot;

  readonly subscribeTimeline = (listener: () => void): (() => void) => {
    return this.publisher.subscribe("timeline", listener);
  };

  readonly subscribeTailGrowth = (listener: () => void): (() => void) => {
    return this.publisher.subscribe("tail-growth", listener);
  };

  readonly subscribeMetadata = (listener: () => void): (() => void) => {
    return this.publisher.subscribe("metadata", listener);
  };
  readonly subscribeLoading = (listener: () => void): (() => void) => {
    return this.publisher.subscribe("loading", listener);
  };

  readonly subscribeHistory = (listener: () => void): (() => void) => {
    return this.publisher.subscribe("history", listener);
  };

  getRowSnapshot = (key: string): ThreadRowSnapshot => this.rows.get(key) ?? EMPTY_ROW;

  subscribeRow = (key: string, listener: () => void): (() => void) => {
    return this.publisher.subscribeRow(key, listener);
  };

  getMessages(): ConversationMessage[] {
    if (!this.messagesSnapshotDirty) return this.messagesSnapshot;
    this.messagesSnapshot = [...this.turns.values()]
      .sort((left, right) => left.timestamp - right.timestamp)
      .flatMap((turn) => [
        ...(turn.userId ? [this.messagesById.get(turn.userId)] : []),
        ...turn.assistantIds.map((id) => this.messagesById.get(id)),
      ])
      .filter((message): message is ConversationMessage => Boolean(message));
    this.messagesSnapshotDirty = false;
    return this.messagesSnapshot;
  }

  getCompactions(): ContextCompactionRecord[] {
    if (!this.compactionsSnapshotDirty) return this.compactionsSnapshot;
    this.compactionsSnapshot = [...this.compactions.values()].sort((left, right) => left.timestamp - right.timestamp);
    this.compactionsSnapshotDirty = false;
    return this.compactionsSnapshot;
  }

  getUserMessages(): readonly ConversationMessage[] {
    if (!this.userMessagesSnapshotDirty) return this.userMessagesSnapshot;
    this.userMessagesSnapshot = [...this.turns.values()]
      .sort((left, right) => left.timestamp - right.timestamp)
      .flatMap((turn) => {
        const message = turn.userId ? this.messagesById.get(turn.userId) : undefined;
        return message ? [message] : [];
      });
    this.userMessagesSnapshotDirty = false;
    return this.userMessagesSnapshot;
  }

  getMessage(messageId: string): ConversationMessage | undefined {
    return this.messagesById.get(messageId);
  }

  getMessageCount(): number {
    return this.messagesById.size;
  }

  getTimelineIndex(key: string): number {
    return this.timelineIndexByKey.get(key) ?? -1;
  }

  getTool(callId: string): MessageToolBlock | undefined {
    const location = this.toolsByCallId.get(callId);
    const block = location
      ? this.messagesById.get(location.messageId)?.blocks[location.blockIndex]
      : undefined;
    return block?.type === "tool" ? block : undefined;
  }

  getToolsByName(name: string): readonly MessageToolBlock[] {
    const cached = this.toolsByNameSnapshots.get(name);
    if (cached) return cached;
    const tools = [...(this.toolCallIdsByName.get(name) ?? [])]
      .map((callId) => this.getTool(callId))
      .filter((tool): tool is MessageToolBlock => Boolean(tool));
    this.toolsByNameSnapshots.set(name, tools);
    return tools;
  }

  getExpertMemberStore(memberId: string, startedAt = Date.now()): ExpertMemberSessionStore {
    const existing = this.memberStores.get(memberId);
    if (existing) return existing;
    const store = new ExpertMemberSessionStore(
      this.client,
      this.sessionId,
      memberId,
      startedAt,
      this.scheduler,
    );
    this.memberStores.set(memberId, store);
    return store;
  }

  setTranslate(translate: (key: MessageKey) => string): void {
    this.translate = translate;
  }

  async start(initialPendingTurn?: PendingThreadTurn | null): Promise<void> {
    if (this.unsubscribeRuntime || this.disposed) return;
    this.hydrating = true;
    this.unsubscribeRuntime = this.runtimeSubscribe((event) => {
      if (event.sessionId !== this.sessionId || this.disposed) return;
      if (this.hydrating) this.bufferedEvents.push(event);
      else this.acceptEnvelope(event);
    });
    try {
      const view = await this.client.getSessionView(this.sessionId);
      if (this.disposed) return;
      this.transaction(() => {
        this.installView(view, true);
        if (initialPendingTurn) this.addPendingTurn(initialPendingTurn);
      });
      const buffered = this.bufferedEvents.splice(0);
      this.hydrating = false;
      for (const event of buffered) this.acceptEnvelope(event);
    } catch (cause) {
      if (this.disposed) return;
      this.hydrating = false;
      this.patchMetadata({
        error: cause instanceof Error ? cause.message : String(cause),
        loading: false,
      });
      if (initialPendingTurn) this.addPendingTurn(initialPendingTurn);
      for (const event of this.bufferedEvents.splice(0)) this.acceptEnvelope(event);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.recoveryGeneration += 1;
    this.unsubscribeRuntime?.();
    this.unsubscribeRuntime = null;
    if (this.deltaFrame !== null) this.scheduler.cancel(this.deltaFrame);
    this.deltaFrame = null;
    this.pendingDeltas.clear();
    this.pendingToolUpdates.clear();
    this.bufferedEvents.length = 0;
    for (const store of this.memberStores.values()) store.dispose();
    this.memberStores.clear();
    this.publisher.dispose();
  }

  addPendingTurn(turn: PendingThreadTurn): void {
    this.transaction(() => this.addPendingTurnNow(turn));
  }

  private addPendingTurnNow(turn: PendingThreadTurn): void {
    if (this.messagesById.has(turn.message.id)) return;
    const turnId = `turn:${turn.message.id}`;
    const record: TurnRecord = {
      assistantIds: [],
      assistantOrder: turn.submission.submittedAt + 0.1,
      timestamp: turn.message.timestamp,
      turnId,
      userId: turn.message.id,
    };
    this.turns.set(turnId, record);
    this.messagesById.set(turn.message.id, turn.message);
    this.messagesSnapshotDirty = true;
    this.userMessagesSnapshotDirty = true;
    this.messageToTurn.set(turn.message.id, turnId);
    this.activeTurnId = turnId;
    this.setRow(this.userKey(turnId), {
      key: this.userKey(turnId),
      type: "user",
      messages: [turn.message],
      presentation: null,
    });
    this.setRow(this.assistantKey(turnId), {
      key: this.assistantKey(turnId),
      type: "assistant",
      messages: [],
      presentation: createAssistantRunPresentation(turn.message.id, turn.submission.submittedAt),
    });
    this.patchMetadata({ isRunning: true });
    this.rebuildTimeline();
    this.upsertTurnSummary(turnId);
  }

  removePendingTurn(messageId: string): void {
    this.transaction(() => this.removePendingTurnNow(messageId));
  }

  private removePendingTurnNow(messageId: string): void {
    const turnId = this.messageToTurn.get(messageId);
    const turn = turnId ? this.turns.get(turnId) : undefined;
    if (!turnId || !turn || turn.assistantIds.length > 0) return;
    this.turns.delete(turnId);
    this.messagesById.delete(messageId);
    this.messagesSnapshotDirty = true;
    this.userMessagesSnapshotDirty = true;
    this.messageToTurn.delete(messageId);
    this.deleteRow(this.userKey(turnId));
    this.deleteRow(this.assistantKey(turnId));
    this.patchMetadata({ isRunning: false });
    this.rebuildTimeline();
    this.removeTurnSummary(turnId);
  }

  patchSession(session: SessionSnapshot["session"]): void {
    this.patchMetadata({ session });
  }

  patchToolApprovalMode(toolApprovalMode: ToolApprovalMode): void {
    this.patchMetadata({ toolApprovalMode });
  }

  markCompactionStarted(trigger: ContextCompactionRecord["trigger"]): void {
    this.patchMetadata({
      compactionError: undefined,
      compactionTrigger: trigger,
      isCompacting: true,
    });
  }

  markCompactionFailed(
    trigger: ContextCompactionRecord["trigger"],
    message: string,
  ): void {
    this.patchMetadata({
      compactionError: message,
      compactionTrigger: trigger,
      isCompacting: false,
    });
  }

  mergeSessionView(view: SessionViewSnapshot, mergeHistory = false): void {
    this.transaction(() => {
      if (mergeHistory) this.installHistoryPage(view.history, "merge");
      this.installViewMetadata(view);
    });
  }

  updateToolOutput(callId: string, output: string): void {
    this.transaction(() => {
      const tool = this.getTool(callId);
      if (!tool) return;
      this.replaceTool(callId, { ...tool, output, outputTruncated: false });
    });
  }

  async loadOlder(): Promise<number> {
    if (this.loadingBefore || !this.historySnapshot.hasMoreBefore || !this.historySnapshot.nextBeforeCursor)
      return 0;
    this.loadingBefore = true;
    try {
      const previousLength = this.timelineSnapshot.items.length;
      const page = await this.client.getSessionHistoryPage(this.sessionId, {
        before: this.historySnapshot.nextBeforeCursor,
        limit: 24,
      });
      this.transaction(() => this.installHistoryPage(page, "prepend"));
      return this.timelineSnapshot.items.length - previousLength;
    } finally {
      this.loadingBefore = false;
    }
  }

  async loadNewer(): Promise<number> {
    if (this.loadingAfter || !this.historySnapshot.hasMoreAfter || !this.historySnapshot.nextAfterCursor)
      return 0;
    this.loadingAfter = true;
    try {
      const previousLength = this.timelineSnapshot.items.length;
      const page = await this.client.getSessionHistoryPage(this.sessionId, {
        after: this.historySnapshot.nextAfterCursor,
        limit: 24,
      });
      this.transaction(() => this.installHistoryPage(page, "append"));
      return this.timelineSnapshot.items.length - previousLength;
    } finally {
      this.loadingAfter = false;
    }
  }

  async ensureTurnLoaded(turnId: string): Promise<number> {
    const existing = this.timelineSnapshot.items.findIndex((item) =>
      item.type !== "compaction" && item.turnId === turnId,
    );
    if (existing !== -1) return existing;
    const page = await this.client.getSessionHistoryPage(this.sessionId, {
      aroundTurnId: turnId,
      limit: 24,
    });
    this.installHistoryPage(page, "merge");
    return this.timelineSnapshot.items.findIndex((item) =>
      item.type !== "compaction" && item.turnId === turnId,
    );
  }

  private installView(view: SessionViewSnapshot, replace: boolean): void {
    this.installHistoryPage(view.history, replace ? "replace" : "merge");
    this.installViewMetadata(view);
    if (view.isRunning) {
      const messages = messagesFromPage(view.history);
      const presentation = assistantRunPresentationFromMessages(messages, Date.now());
      if (presentation.userMessageId) {
        const turnId = `turn:${presentation.userMessageId}`;
        this.activeTurnId = turnId;
        if (view.modelRetry)
          presentation.activity = { type: "reconnecting", retry: view.modelRetry };
        this.updateAssistantRow(turnId, presentation);
      }
    }
  }

  private installViewMetadata(view: SessionViewSnapshot): void {
    this.historySnapshot = {
      hasMoreAfter: view.history.hasMoreAfter,
      hasMoreBefore: view.history.hasMoreBefore,
      nextAfterCursor: view.history.nextAfterCursor,
      nextBeforeCursor: view.history.nextBeforeCursor,
      revision: view.history.revision,
      turnSummaries: this.withLocalTurnSummaries(view.turnSummaries),
    };
    this.patchMetadata({
      compactionError: view.compactionError,
      compactionTrigger: view.compactionTrigger,
      contextUsage: view.contextUsage,
      error: null,
      expertCollaboration: view.expertCollaboration,
      extensions: view.extensions,
      isCompacting: view.isCompacting,
      isRunning: view.isRunning,
      modelRetry: view.modelRetry,
      loading: false,
      session: view.session,
      toolApprovalMode: view.toolApprovalMode,
      turnUsage: view.turnUsage,
    });
    this.publishHistory();
  }

  private installHistoryPage(page: SessionHistoryPage, mode: "append" | "merge" | "prepend" | "replace"): void {
    if (mode === "replace") this.clearProjection();
    for (const item of page.items) {
      if (item.type === "compaction") {
        this.compactions.set(item.compaction.id, item.compaction);
        this.compactionsSnapshotDirty = true;
        this.setRow(this.compactionKey(item.compaction.id), {
          key: this.compactionKey(item.compaction.id),
          type: "compaction",
          messages: [],
          presentation: null,
          compaction: item.compaction,
        });
        continue;
      }
      const existing = this.turns.get(item.turn.id);
      const user = item.turn.messages.find((message) => message.role === "user");
      const assistants = item.turn.messages.filter((message) => message.role === "assistant");
      const record: TurnRecord = existing ?? {
        assistantIds: [],
        assistantOrder: assistants[0]?.timestamp ?? item.turn.timestamp + 0.1,
        timestamp: item.turn.timestamp,
        turnId: item.turn.id,
      };
      if (user) record.userId = user.id;
      for (const message of item.turn.messages) {
        const current = this.messagesById.get(message.id);
        if (!current) this.messagesById.set(message.id, message);
        else if (mode === "replace")
          this.messagesById.set(message.id, mergeCompletedAssistantMessage(current, message));
        else
          this.messagesById.set(message.id, mergeCompletedAssistantMessage(message, current));
        this.messagesSnapshotDirty = true;
        if (message.role === "user") this.userMessagesSnapshotDirty = true;
        this.messageToTurn.set(message.id, item.turn.id);
        this.indexMessage(this.messagesById.get(message.id)!);
      }
      record.assistantIds = [...new Set([...record.assistantIds, ...assistants.map((message) => message.id)])]
        .sort((left, right) => (this.messagesById.get(left)?.timestamp ?? 0) - (this.messagesById.get(right)?.timestamp ?? 0));
      if (assistants[0]) record.assistantOrder = assistants[0].timestamp;
      this.turns.set(item.turn.id, record);
      this.updateUserRow(item.turn.id);
      this.updateAssistantRow(item.turn.id);
    }
    this.historySnapshot = {
      ...this.historySnapshot,
      hasMoreAfter: mode === "prepend" ? this.historySnapshot.hasMoreAfter : page.hasMoreAfter,
      hasMoreBefore: mode === "append" ? this.historySnapshot.hasMoreBefore : page.hasMoreBefore,
      nextAfterCursor: mode === "prepend" ? this.historySnapshot.nextAfterCursor : page.nextAfterCursor,
      nextBeforeCursor: mode === "append" ? this.historySnapshot.nextBeforeCursor : page.nextBeforeCursor,
      revision: page.revision,
    };
    const previousLength = this.timelineSnapshot.items.length;
    this.rebuildTimeline(
      mode === "replace"
        ? 100_000 - this.projectedItemCount()
        : mode === "prepend"
          ? this.timelineSnapshot.firstItemIndex - Math.max(0, this.projectedItemCount() - previousLength)
          : undefined,
    );
    this.publishHistory();
  }

  private acceptEnvelope(envelope: RuntimeEventEnvelope): void {
    if (this.runtimeInstanceId && envelope.runtimeInstanceId !== this.runtimeInstanceId) {
      if (this.deltaFrame !== null) this.scheduler.cancel(this.deltaFrame);
      this.deltaFrame = null;
      this.pendingDeltas.clear();
      this.pendingToolUpdates.clear();
      this.seenEventIds.clear();
      this.runtimeInstanceId = envelope.runtimeInstanceId;
      this.cursorRunId = undefined;
      this.cursorSequence = null;
      this.bufferedEvents.push(envelope);
      void this.rehydrateForRuntimeChange();
      return;
    }
    if (this.seenEventIds.has(envelope.eventId)) return;
    this.seenEventIds.add(envelope.eventId);
    this.runtimeInstanceId ??= envelope.runtimeInstanceId;
    if (this.cursorSequence !== null && envelope.runId === this.cursorRunId && envelope.sequence > this.cursorSequence + 1)
      this.patchMetadata({ needsRehydrate: true });
    if (envelope.runId === this.cursorRunId && this.cursorSequence !== null && envelope.sequence <= this.cursorSequence)
      return;
    if (envelope.event.type === "run.started" || envelope.runId === this.cursorRunId || this.cursorSequence === null) {
      this.cursorRunId = envelope.runId;
      this.cursorSequence = envelope.sequence;
    }
    if (envelope.event.type.startsWith("expert-member.") && "memberId" in envelope.event) {
      this.getExpertMemberStore(envelope.event.memberId, envelope.timestamp).acceptEnvelope(envelope);
      return;
    }
    this.transaction(() => this.applyMainEvent(envelope));
  }

  private applyMainEvent(envelope: RuntimeEventEnvelope): void {
    const event = envelope.event;
    if (event.type === "message.text.delta" || event.type === "message.reasoning.delta") {
      const kind = event.type === "message.text.delta" ? "text" : "reasoning";
      this.pendingDeltas.add(event.messageId, kind, event.delta, envelope);
      if (this.deltaFrame === null)
        this.deltaFrame = this.scheduler.request(() => this.flushDeltas());
      return;
    }
    if (event.type === "tool.updated") {
      this.pendingToolUpdates.add(event.callId, event.output, event);
      if (this.deltaFrame === null)
        this.deltaFrame = this.scheduler.request(() => this.flushDeltas());
      return;
    }
    this.flushDeltas();
    const presentationTurnId = envelope.turnId ?? this.activeTurnId;
    if (presentationTurnId && event.type !== "message.started") {
      const row = this.rows.get(this.assistantKey(presentationTurnId));
      if (row?.presentation)
        this.updateAssistantRow(
          presentationTurnId,
          advanceAssistantRunPresentation(row.presentation, envelope),
        );
    }
    if (event.type === "message.started") {
      const turnId = envelope.turnId ?? (event.message.role === "user" ? `turn:${event.message.id}` : this.activeTurnId);
      if (!turnId) return;
      const currentPresentation = this.rows.get(this.assistantKey(turnId))?.presentation ?? null;
      const presentation = event.message.role === "assistant"
        ? advanceAssistantRunPresentation(currentPresentation, envelope)
        : currentPresentation;
      this.upsertLiveMessage(turnId, event.message, presentation);
      this.activeTurnId = turnId;
      this.patchMetadata({ isRunning: true });
      if (event.message.role === "user" || this.turnSummaryIndex(turnId) === -1)
        this.upsertTurnSummary(turnId);
      return;
    }
    if (event.type === "message.completed") {
      const previous = this.messagesById.get(event.message.id);
      const turnId = this.messageToTurn.get(event.message.id) ?? envelope.turnId ?? this.activeTurnId;
      if (!turnId) return;
      this.upsertLiveMessage(turnId, previous ? mergeCompletedAssistantMessage(previous, event.message) : event.message);
      this.patchMetadata({ turnUsage: calculateCurrentTurnUsage([...this.messagesForTurn(turnId)]) ?? this.metadataSnapshot.turnUsage });
      this.upsertTurnSummary(turnId);
      return;
    }
    if (event.type === "context.usage.updated") {
      this.patchMetadata({ contextUsage: event.contextUsage });
      return;
    }
    if (event.type === "tool.started") {
      const tool: MessageToolBlock = {
        type: "tool",
        callId: event.callId,
        name: event.name,
        input: event.input,
        source: event.source,
        state: "running",
        startedAt: envelope.timestamp,
      };
      this.appendOrReplaceTool(event.messageId, tool);
      this.patchMetadata({ isRunning: true });
      return;
    }
    if (event.type === "tool.completed") {
      const existing = this.getTool(event.callId);
      const tool: MessageToolBlock = {
        type: "tool",
        callId: event.callId,
        name: existing?.name ?? "tool",
        input: existing?.input,
        output: event.output,
        details: event.details ?? existing?.details,
        source: event.source ?? existing?.source,
        usage: event.usage ?? existing?.usage,
        approval: approvalFromDetails(event.details, existing?.approval),
        userRequest: userRequestFromDetails(event.details, existing?.userRequest),
        state: event.isError ? "error" : "complete",
        startedAt: existing?.startedAt,
        timeoutSeconds: existing?.timeoutSeconds,
      };
      this.appendOrReplaceTool(event.messageId, tool);
      return;
    }
    if (event.type === "approval.requested") {
      const callId = event.approval.callId;
      const tool = this.getTool(callId);
      if (tool) {
        this.approvalToCallId.set(event.approval.approvalId, callId);
        this.replaceTool(callId, { ...tool, state: "awaiting-approval", approval: { ...event.approval, status: "required" } });
      }
      return;
    }
    if (event.type === "approval.resolved") {
      const callId = this.approvalToCallId.get(event.resolution.approvalId);
      const tool = callId ? this.getTool(callId) : undefined;
      if (callId && tool?.approval)
        this.replaceTool(callId, {
          ...tool,
          state: event.resolution.approved ? "running" : "error",
          approval: {
            ...tool.approval,
            status: event.resolution.approved ? "approved" : "rejected",
            feedback: event.resolution.feedback,
          },
          ...(!event.resolution.approved ? { output: event.resolution.feedback ?? this.translate("threadOperationRejected") } : {}),
        });
      return;
    }
    if (event.type === "user-request.requested") {
      const callId = event.request.callId;
      const tool = this.getTool(callId);
      if (tool) {
        this.requestToCallId.set(event.request.requestId, callId);
        this.replaceTool(callId, { ...tool, state: "awaiting-user-input", userRequest: { request: event.request } });
      }
      return;
    }
    if (event.type === "user-request.resolved") {
      const callId = this.requestToCallId.get(event.resolution.requestId);
      const tool = callId ? this.getTool(callId) : undefined;
      if (callId && tool?.userRequest)
        this.replaceTool(callId, { ...tool, state: "running", userRequest: { ...tool.userRequest, resolution: event.resolution } });
      return;
    }
    if (event.type === "extension.event" && event.event.type === "state.changed") {
      this.applyExtensionState(event.event.payload);
      return;
    }
    if (event.type === "context.compaction.started") {
      this.patchMetadata({ isCompacting: true, compactionTrigger: event.trigger, compactionError: undefined });
      return;
    }
    if (event.type === "context.compaction.completed") {
      this.compactions.set(event.compaction.id, event.compaction);
      this.compactionsSnapshotDirty = true;
      this.setRow(this.compactionKey(event.compaction.id), {
        key: this.compactionKey(event.compaction.id),
        type: "compaction",
        messages: [],
        presentation: null,
        compaction: event.compaction,
      });
      const active = this.activeTurnId ? this.turns.get(this.activeTurnId) : undefined;
      if (active) active.assistantOrder = Math.max(active.assistantOrder, event.compaction.timestamp + 0.1);
      this.patchMetadata({ isCompacting: false, compactionError: undefined, compactionTrigger: undefined });
      this.rebuildTimeline();
      void this.client
        .getSessionView(this.sessionId)
        .then((view) => {
          if (view.contextUsage) {
            this.patchMetadata({ contextUsage: view.contextUsage });
          }
        })
        .catch(() => {});
      return;
    }
    if (event.type === "context.compaction.failed") {
      this.patchMetadata({ isCompacting: false, compactionError: event.message, compactionTrigger: event.trigger });
      return;
    }
    if (event.type === "run.started") {
      this.patchMetadata({ isRunning: true, compactionError: undefined, compactionTrigger: undefined });
      return;
    }
    if (event.type === "model.retry.scheduled") {
      const turnId = envelope.turnId ?? this.activeTurnId;
      const failedId = event.retry.failedMessageId;
      const turn = turnId ? this.turns.get(turnId) : undefined;
      if (turn && turn.assistantIds.includes(failedId)) {
        turn.assistantIds = turn.assistantIds.filter((id) => id !== failedId);
        this.messagesById.delete(failedId);
        this.messageToTurn.delete(failedId);
        this.messagesSnapshotDirty = true;
      }
      const row = turnId ? this.rows.get(this.assistantKey(turnId)) : undefined;
      const presentation = row?.presentation ?? (turn?.userId
        ? createAssistantRunPresentation(turn.userId, turn.timestamp)
        : null);
      if (turnId && turn && presentation) {
        this.activeTurnId = turnId;
        this.updateAssistantRow(turnId, {
          ...presentation,
          activity: { type: "reconnecting", retry: event.retry },
          assistantMessageId: turn.assistantIds.at(-1) ?? null,
        });
      } else if (turnId && turn) {
        this.updateAssistantRow(turnId);
      }
      this.patchMetadata({ modelRetry: event.retry, isRunning: true });
      return;
    }
    if (event.type === "model.retry.started") {
      const turnId = envelope.turnId ?? this.activeTurnId;
      const row = turnId ? this.rows.get(this.assistantKey(turnId)) : undefined;
      if (turnId && row?.presentation && row.presentation.activity.type === "reconnecting")
        this.updateAssistantRow(turnId, {
          ...row.presentation,
          activity: { type: "thinking", since: Date.now() },
        });
      this.patchMetadata({ modelRetry: undefined, isRunning: true });
      return;
    }
    if (event.type === "run.failed" || event.type === "run.cancelled") {
      this.terminalizeActiveTools(event.type === "run.failed"
        ? this.translate("threadAgentRunFailed").replace("{message}", event.message)
        : this.translate("threadAgentRunCancelled"));
      this.patchMetadata({ isRunning: false, isCompacting: false, toolApprovalMode: "manual" });
      this.clearPresentation();
      return;
    }
    if (event.type === "session.idle") {
      this.terminalizeActiveTools(this.translate("threadAgentRunEndedBeforeToolCompleted"));
      this.patchMetadata({ isRunning: false, isCompacting: false, toolApprovalMode: "manual" });
      this.clearPresentation();
      if (this.metadataSnapshot.needsRehydrate) void this.recoverAtIdle(envelope);
      return;
    }
    if (event.type === "model.changed" && this.metadataSnapshot.session)
      this.patchMetadata({ session: { ...this.metadataSnapshot.session, model: event.model } });
  }

  private flushDeltas(): void {
    this.transaction(() => this.flushDeltasNow());
  }

  private flushDeltasNow(): void {
    if (this.deltaFrame !== null) this.scheduler.cancel(this.deltaFrame);
    this.deltaFrame = null;
    if (this.pendingDeltas.size === 0 && this.pendingToolUpdates.size === 0) return;
    for (const [messageId, deltas] of this.pendingDeltas.entries()) {
      const message = this.messagesById.get(messageId);
      if (!message) continue;
      const blocks = [...message.blocks];
      for (const pending of deltas) {
        const delta = pending.chunks.join("");
        const last = blocks.at(-1);
        if (last?.type === pending.kind)
          blocks[blocks.length - 1] = { ...last, text: last.text + delta };
        else blocks.push({ type: pending.kind, text: delta });
      }
      this.messagesById.set(messageId, { ...message, blocks, status: "streaming" });
      this.messagesSnapshotDirty = true;
      const turnId = this.messageToTurn.get(messageId);
      if (turnId) {
        const row = this.rows.get(this.assistantKey(turnId));
        let presentation = row?.presentation ?? null;
        for (const pending of deltas)
          presentation = advanceAssistantRunPresentation(presentation, pending.metadata);
        this.updateAssistantRow(turnId, presentation);
      }
    }
    this.pendingDeltas.clear();
    for (const [callId, pending] of this.pendingToolUpdates.entries()) {
      const existing = this.getTool(callId);
      if (!existing) continue;
      const event = pending.metadata;
      this.replaceTool(callId, {
        ...existing,
        output: `${existing.output ?? ""}${pending.chunks.join("")}`,
        details: event.details ?? existing.details,
        source: event.source ?? existing.source,
        usage: event.usage ?? existing.usage,
        state: "running",
      });
    }
    this.pendingToolUpdates.clear();
    this.patchMetadata({ isRunning: true });
  }

  private upsertLiveMessage(
    turnId: string,
    message: ConversationMessage,
    presentationOverride?: AssistantRunPresentation | null,
  ): void {
    let turn = this.turns.get(turnId);
    const structural = !turn;
    if (!turn) {
      turn = {
        assistantIds: [],
        assistantOrder: message.timestamp + 0.1,
        timestamp: message.timestamp,
        turnId,
      };
      this.turns.set(turnId, turn);
    }
    this.messagesById.set(message.id, message);
    this.messagesSnapshotDirty = true;
    if (message.role === "user") this.userMessagesSnapshotDirty = true;
    this.messageToTurn.set(message.id, turnId);
    this.indexMessage(message);
    if (message.role === "user") {
      turn.userId = message.id;
      turn.timestamp = message.timestamp;
      this.updateUserRow(turnId);
    } else {
      if (!turn.assistantIds.includes(message.id)) turn.assistantIds.push(message.id);
      if (turn.assistantIds.length === 1) turn.assistantOrder = message.timestamp;
      const current = this.rows.get(this.assistantKey(turnId));
      const presentation = presentationOverride !== undefined
        ? presentationOverride
        : current?.presentation ?? (turn.userId
          ? createAssistantRunPresentation(turn.userId, turn.timestamp)
          : null);
      this.updateAssistantRow(turnId, presentation
        ? { ...presentation, assistantMessageId: message.id }
        : null);
    }
    if (structural || message.role === "user") this.rebuildTimeline();
  }

  private updateUserRow(turnId: string): void {
    const turn = this.turns.get(turnId);
    const message = turn?.userId ? this.messagesById.get(turn.userId) : undefined;
    if (!message) return;
    this.setRow(this.userKey(turnId), {
      key: this.userKey(turnId),
      type: "user",
      messages: [message],
      presentation: null,
    });
  }

  private updateAssistantRow(turnId: string, presentation?: AssistantRunPresentation | null): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    const key = this.assistantKey(turnId);
    const current = this.rows.get(key);
    const messages = turn.assistantIds
      .map((id) => this.messagesById.get(id))
      .filter((message): message is ConversationMessage => Boolean(message));
    this.setRow(key, {
      key,
      type: "assistant",
      messages,
      presentation: presentation === undefined ? current?.presentation ?? null : presentation,
    });
  }

  private appendOrReplaceTool(messageId: string, tool: MessageToolBlock): void {
    const message = this.messagesById.get(messageId);
    if (!message) return;
    const location = this.toolsByCallId.get(tool.callId);
    const existingIndex = location?.messageId === messageId ? location.blockIndex : -1;
    const blocks = [...message.blocks];
    if (existingIndex === -1) blocks.push(tool);
    else blocks[existingIndex] = tool;
    this.messagesById.set(messageId, { ...message, blocks });
    this.messagesSnapshotDirty = true;
    this.indexTool(messageId, existingIndex === -1 ? blocks.length - 1 : existingIndex, tool);
    const turnId = this.messageToTurn.get(messageId);
    if (turnId) this.updateAssistantRow(turnId);
  }

  private replaceTool(callId: string, tool: MessageToolBlock): void {
    const location = this.toolsByCallId.get(callId);
    const message = location ? this.messagesById.get(location.messageId) : undefined;
    if (!location || !message) return;
    const blocks = [...message.blocks];
    blocks[location.blockIndex] = tool;
    this.messagesById.set(message.id, { ...message, blocks });
    this.messagesSnapshotDirty = true;
    this.indexTool(message.id, location.blockIndex, tool);
    const turnId = this.messageToTurn.get(message.id);
    if (turnId) this.updateAssistantRow(turnId);
  }

  private indexMessage(message: ConversationMessage): void {
    const previousCallIds = this.toolCallIdsByMessage.get(message.id);
    if (previousCallIds)
      for (const callId of previousCallIds) {
        this.removeToolNameIndex(callId);
        this.toolsByCallId.delete(callId);
        this.activeToolCallIds.delete(callId);
      }
    const callIds = new Set<string>();
    message.blocks.forEach((block, blockIndex) => {
      if (block.type !== "tool") return;
      callIds.add(block.callId);
      this.indexTool(message.id, blockIndex, block);
    });
    if (callIds.size > 0) this.toolCallIdsByMessage.set(message.id, callIds);
    else this.toolCallIdsByMessage.delete(message.id);
  }

  private indexTool(messageId: string, blockIndex: number, tool: MessageToolBlock): void {
    const previousName = this.toolNameByCallId.get(tool.callId);
    if (previousName && previousName !== tool.name) this.removeToolNameIndex(tool.callId);
    this.toolsByCallId.set(tool.callId, { messageId, blockIndex });
    const callIds = this.toolCallIdsByMessage.get(messageId) ?? new Set<string>();
    callIds.add(tool.callId);
    this.toolCallIdsByMessage.set(messageId, callIds);
    const namedCallIds = this.toolCallIdsByName.get(tool.name) ?? new Set<string>();
    namedCallIds.add(tool.callId);
    this.toolCallIdsByName.set(tool.name, namedCallIds);
    this.toolNameByCallId.set(tool.callId, tool.name);
    this.toolsByNameSnapshots.delete(tool.name);
    if (tool.state === "complete" || tool.state === "error") this.activeToolCallIds.delete(tool.callId);
    else this.activeToolCallIds.add(tool.callId);
    if (tool.approval) this.approvalToCallId.set(tool.approval.approvalId, tool.callId);
    if (tool.userRequest) this.requestToCallId.set(tool.userRequest.request.requestId, tool.callId);
    const tasks = asRecord(tool.details)?.tasks;
    if (Array.isArray(tasks))
      for (const task of tasks) {
        const id = asRecord(task)?.id;
        if (typeof id === "string") this.expertTaskToCallId.set(id, tool.callId);
      }
  }

  private removeToolNameIndex(callId: string): void {
    const name = this.toolNameByCallId.get(callId);
    if (!name) return;
    const callIds = this.toolCallIdsByName.get(name);
    callIds?.delete(callId);
    if (callIds?.size === 0) this.toolCallIdsByName.delete(name);
    this.toolNameByCallId.delete(callId);
    this.toolsByNameSnapshots.delete(name);
  }

  private applyExtensionState(payload: unknown): void {
    const value = asRecord(payload);
    if (typeof value?.extensionId !== "string" || typeof value.updatedAt !== "number" || !asRecord(value.state))
      return;
    const next = { extensionId: value.extensionId, updatedAt: value.updatedAt, state: asRecord(value.state)! };
    const extensions = [...this.metadataSnapshot.extensions.filter((item) => item.extensionId !== next.extensionId), next];
    this.patchMetadata({ extensions });
    if (next.extensionId !== "wordless.expert-team") return;
    const runs = asRecord(next.state.taskRuns);
    if (!runs) return;
    const updatesByCallId = new Map<string, Map<string, Record<string, unknown>>>();
    for (const [taskId, run] of Object.entries(runs)) {
      const callId = this.expertTaskToCallId.get(taskId);
      const runValue = asRecord(run);
      if (!callId || !runValue) continue;
      const updates = updatesByCallId.get(callId) ?? new Map<string, Record<string, unknown>>();
      updates.set(taskId, runValue);
      updatesByCallId.set(callId, updates);
    }
    for (const [callId, updates] of updatesByCallId) {
      const tool = this.getTool(callId);
      if (!tool) continue;
      const details = asRecord(tool.details);
      const tasks = details?.tasks;
      if (!Array.isArray(tasks)) continue;
      const nextTasks = tasks.map((task) => {
        const taskValue = asRecord(task);
        const taskId = taskValue?.id;
        const update = typeof taskId === "string" ? updates.get(taskId) : undefined;
        return update ? { ...taskValue, ...update } : task;
      });
      this.replaceTool(callId, { ...tool, details: { ...details, tasks: nextTasks } });
    }
  }

  private terminalizeActiveTools(reason: string): void {
    for (const callId of [...this.activeToolCallIds]) {
      const tool = this.getTool(callId);
      if (!tool || tool.state === "complete" || tool.state === "error") {
        this.activeToolCallIds.delete(callId);
        continue;
      }
      this.replaceTool(callId, { ...tool, state: "error", output: tool.output ? `${tool.output}\n\n${reason}` : reason });
    }
  }

  private clearPresentation(): void {
    if (!this.activeTurnId) return;
    this.updateAssistantRow(this.activeTurnId, null);
  }

  private messagesForTurn(turnId: string): readonly ConversationMessage[] {
    const turn = this.turns.get(turnId);
    if (!turn) return [];
    return [
      ...(turn.userId ? [this.messagesById.get(turn.userId)] : []),
      ...turn.assistantIds.map((id) => this.messagesById.get(id)),
    ].filter((message): message is ConversationMessage => Boolean(message));
  }

  private turnSummaryIndex(turnId: string): number {
    return this.historySnapshot.turnSummaries.findIndex((item) => item.turnId === turnId);
  }

  private summaryFromTurn(turn: TurnRecord, ordinal: number): SessionTurnSummary | null {
    const messages = this.messagesForTurn(turn.turnId);
    const messageId = turn.userId ?? messages[0]?.id;
    if (!messageId) return null;
    return buildSessionTurnSummary({
      messageId,
      messages,
      ordinal,
      timestamp: turn.timestamp,
      turnId: turn.turnId,
    });
  }

  private withLocalTurnSummaries(server: readonly SessionTurnSummary[]): SessionTurnSummary[] {
    const known = new Set(server.map((item) => item.turnId));
    const missing = [...this.turns.values()]
      .filter((turn) => !known.has(turn.turnId))
      .sort((left, right) => left.timestamp - right.timestamp)
      .flatMap((turn, index) => {
        const summary = this.summaryFromTurn(turn, server.length + index);
        return summary ? [summary] : [];
      });
    return missing.length === 0 ? [...server] : [...server, ...missing];
  }

  private upsertTurnSummary(turnId: string): void {
    const turn = this.turns.get(turnId);
    if (!turn) return;
    const summaries = this.historySnapshot.turnSummaries;
    const index = this.turnSummaryIndex(turnId);
    const next = this.summaryFromTurn(turn, index === -1 ? summaries.length : summaries[index]!.ordinal);
    if (!next) return;
    if (index === -1) {
      this.historySnapshot = {
        ...this.historySnapshot,
        turnSummaries: [...summaries, next],
      };
      this.publishHistory();
      return;
    }
    if (sessionTurnSummaryEquals(summaries[index]!, next)) return;
    const copy = summaries.slice();
    copy[index] = next;
    this.historySnapshot = { ...this.historySnapshot, turnSummaries: copy };
    this.publishHistory();
  }

  private removeTurnSummary(turnId: string): void {
    const summaries = this.historySnapshot.turnSummaries;
    const index = this.turnSummaryIndex(turnId);
    if (index === -1) return;
    this.historySnapshot = {
      ...this.historySnapshot,
      turnSummaries: summaries.flatMap((item, ordinal) => {
        if (item.turnId === turnId) return [];
        const nextOrdinal = ordinal > index ? ordinal - 1 : ordinal;
        return item.ordinal === nextOrdinal ? [item] : [{ ...item, ordinal: nextOrdinal }];
      }),
    };
    this.publishHistory();
  }

  private setRow(key: string, snapshot: ThreadRowSnapshot): void {
    const current = this.rows.get(key);
    if (current && current.presentation === snapshot.presentation && current.compaction === snapshot.compaction && sameReferenceArray(current.messages, snapshot.messages))
      return;
    this.rows.set(key, snapshot);
    if (this.timelineSnapshot.items.at(-1)?.key === key)
      this.publishTailGrowth();
    this.publishRow(key);
  }

  private deleteRow(key: string): void {
    if (!this.rows.delete(key)) return;
    this.publishRow(key);
  }

  private rebuildTimeline(firstItemIndex = this.timelineSnapshot.firstItemIndex): void {
    const ordered: Array<{ descriptor: ThreadTimelineDescriptor; order: number; tie: number }> = [];
    for (const turn of this.turns.values()) {
      if (turn.userId) {
        const key = this.userKey(turn.turnId);
        ordered.push({ descriptor: this.descriptor(key, { type: "user", key, turnId: turn.turnId, messageId: turn.userId }), order: turn.timestamp, tie: 0 });
      }
      const key = this.assistantKey(turn.turnId);
      ordered.push({ descriptor: this.descriptor(key, { type: "assistant", key, turnId: turn.turnId }), order: turn.assistantOrder, tie: 2 });
    }
    for (const compaction of this.compactions.values()) {
      const key = this.compactionKey(compaction.id);
      ordered.push({ descriptor: this.descriptor(key, { type: "compaction", key, compactionId: compaction.id }), order: compaction.timestamp, tie: 1 });
    }
    ordered.sort((left, right) => left.order - right.order || left.tie - right.tie);
    const items = ordered.map((item) => item.descriptor);
    if (firstItemIndex === this.timelineSnapshot.firstItemIndex && sameReferenceArray(items, this.timelineSnapshot.items)) return;
    this.timelineSnapshot = { items, firstItemIndex };
    this.timelineIndexByKey.clear();
    items.forEach((item, index) => this.timelineIndexByKey.set(item.key, index));
    this.publishTimeline();
  }

  private descriptor<T extends ThreadTimelineDescriptor>(key: string, next: T): T {
    const existing = this.descriptorCache.get(key);
    if (existing && existing.type === next.type) return existing as T;
    this.descriptorCache.set(key, next);
    return next;
  }

  private projectedItemCount(): number {
    return this.turns.size * 2 + this.compactions.size;
  }

  private patchMetadata(patch: Partial<ThreadMetadataSnapshot>): void {
    const next = { ...this.metadataSnapshot, ...patch };
    if (Object.keys(patch).every((key) => Object.is(
      this.metadataSnapshot[key as keyof ThreadMetadataSnapshot],
      next[key as keyof ThreadMetadataSnapshot],
    ))) return;
    const loadingChanged = this.metadataSnapshot.loading !== next.loading;
    this.metadataSnapshot = next;
    if (loadingChanged) this.publisher.publish("loading");
    this.publishMetadata();
  }

  private async rehydrateForRuntimeChange(): Promise<void> {
    if (this.hydrating || this.disposed) return;
    this.hydrating = true;
    const generation = ++this.recoveryGeneration;
    this.patchMetadata({ loading: true, needsRehydrate: false });
    try {
      const view = await this.client.getSessionView(this.sessionId);
      if (this.disposed || generation !== this.recoveryGeneration) return;
      this.transaction(() => this.installView(view, true));
      void Promise.all([...this.memberStores.values()].map((store) => store.handleRuntimeChange()));
      const events = this.bufferedEvents.splice(0);
      this.hydrating = false;
      for (const event of events) this.acceptEnvelope(event);
    } catch (cause) {
      if (generation !== this.recoveryGeneration) return;
      this.hydrating = false;
      this.patchMetadata({ error: cause instanceof Error ? cause.message : String(cause), loading: false });
    }
  }

  private async recoverAtIdle(idle: RuntimeEventEnvelope): Promise<void> {
    const generation = ++this.recoveryGeneration;
    const runtimeInstanceId = idle.runtimeInstanceId;
    const runId = idle.runId;
    const sequence = idle.sequence;
    try {
      const [snapshot, view] = await Promise.all([
        this.client.getSessionSnapshot(this.sessionId),
        this.client.getSessionView(this.sessionId),
      ]);
      if (
        this.disposed || generation !== this.recoveryGeneration ||
        this.runtimeInstanceId !== runtimeInstanceId || this.cursorRunId !== runId ||
        this.cursorSequence !== sequence || this.metadataSnapshot.isRunning
      ) return;
      this.transaction(() => {
        this.installFullSnapshot(snapshot, view);
        this.patchMetadata({ needsRehydrate: false });
      });
      void Promise.all([...this.memberStores.values()].map((store) => store.handleRuntimeChange()));
    } catch {
      // Keep the live projection and retry after the next idle boundary.
    }
  }

  private installFullSnapshot(snapshot: SessionSnapshot, view: SessionViewSnapshot): void {
    const persistedTurnByMessage = new Map<string, string>();
    for (const item of view.history.items) {
      if (item.type !== "turn") continue;
      for (const message of item.turn.messages)
        persistedTurnByMessage.set(message.id, item.turn.id);
    }
    this.clearProjection();
    let currentTurnId: string | null = null;
    for (const message of snapshot.messages) {
      const persistedTurnId = persistedTurnByMessage.get(message.id);
      if (persistedTurnId) currentTurnId = persistedTurnId;
      else if (message.role === "user" || !currentTurnId) currentTurnId = `turn:${message.id}`;
      this.upsertLiveMessage(currentTurnId, message);
    }
    for (const compaction of snapshot.contextCompactions) {
      this.compactions.set(compaction.id, compaction);
      this.compactionsSnapshotDirty = true;
      this.setRow(this.compactionKey(compaction.id), {
        key: this.compactionKey(compaction.id), type: "compaction", messages: [], presentation: null, compaction,
      });
    }
    this.installViewMetadata(view);
    this.rebuildTimeline(100_000 - this.projectedItemCount());
  }

  private clearProjection(): void {
    this.messagesById.clear();
    this.messagesSnapshot = [];
    this.messagesSnapshotDirty = false;
    this.userMessagesSnapshot = [];
    this.userMessagesSnapshotDirty = false;
    this.messageToTurn.clear();
    this.toolsByCallId.clear();
    this.toolCallIdsByMessage.clear();
    this.toolCallIdsByName.clear();
    this.toolNameByCallId.clear();
    this.toolsByNameSnapshots.clear();
    this.activeToolCallIds.clear();
    this.approvalToCallId.clear();
    this.requestToCallId.clear();
    this.expertTaskToCallId.clear();
    this.turns.clear();
    this.compactions.clear();
    this.compactionsSnapshot = [];
    this.compactionsSnapshotDirty = false;
    this.rows.clear();
    this.descriptorCache.clear();
    this.timelineIndexByKey.clear();
    this.activeTurnId = null;
    this.timelineSnapshot = { items: [], firstItemIndex: 100_000 };
  }

  private transaction<T>(operation: () => T): T {
    return this.publisher.transaction(operation);
  }

  private publishRow(key: string): void {
    this.publisher.publishRow(key);
  }

  private publishTimeline(): void {
    this.publisher.publish("timeline");
  }

  private publishMetadata(): void {
    this.publisher.publish("metadata");
  }

  private publishTailGrowth(): void {
    this.publisher.publish("tail-growth");
  }

  private publishHistory(): void {
    this.publisher.publish("history");
  }

  private userKey(turnId: string): string { return `user:${turnId}`; }
  private assistantKey(turnId: string): string { return `assistant:${turnId}`; }
  private compactionKey(id: string): string { return `compaction:${id}`; }
}
