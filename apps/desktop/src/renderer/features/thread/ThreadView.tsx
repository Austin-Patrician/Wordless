import { Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Copy,
  Layers3,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  UsersRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Virtuoso,
  type Components,
  type ListRange,
  type VirtuosoHandle,
} from "react-virtuoso";
import type {
  ArtifactSelection,
  ConversationMessage,
  ExpertCollaborationLeader,
  ExpertCollaborationMember,
  ExpertMemberLiveMessage,
  RuntimeEventEnvelope,
  SessionHistoryPage,
  SessionSnapshot,
  SessionTurnSummary,
  SessionViewSnapshot,
} from "@wordless/protocol";
import {
  calculateCurrentTurnUsage,
  type ContextCompactionRecord,
  type ExpertPortrait as ExpertPortraitDefinition,
  type MessageToolBlock,
  type MessageUserRequest,
  type ModelReference,
  type ToolApprovalMode,
  type ToolOperationApproval,
  type UserPromptPart,
  type UserRequestAnswer,
  type WorkbenchId,
} from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import type { MessageKey } from "../../shared/i18n";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { ModelPicker } from "../workbench/ModelPicker";
import type { ResearchTaskSelection } from "../workbench/context-panel-types";
import { workbenchRendererRegistry } from "../workbench/renderer-registry";
import { groupResearchDelegationBlocks } from "../workbench/research-delegation";
import { Composer } from "./Composer";
import { completeContextCompaction } from "./context-compaction-state";
import type {
  InlineSkillComposerValue,
  InlineWorkspaceReferenceToken,
} from "./InlineSkillComposer";
import { ConversationDensityRail } from "./ConversationDensityRail";
import {
  createPendingThreadTurn,
  createUserMessageSubmission,
  type PendingThreadTurn,
} from "./pending-thread-turn";
import {
  createThreadTimeline,
  dataIndexFromReportedIndex,
  firstItemIndexAfterPrepend,
  threadTimelineItemCount,
  type ThreadTimelineItem,
} from "./thread-virtual-list";
import {
  advanceAssistantRunPresentation,
  assistantRunActivityAt,
  assistantRunPresentationFromMessages,
  assistantToolActivity,
  createAssistantRunPresentation,
  isExpertMemberMessageEvent,
  isNewerRunEvent,
  mergeCompletedAssistantMessage,
  nextAssistantRunActivityUpdateAt,
  runEventCursor,
  type AssistantRunActivity,
  type AssistantRunPresentation,
  type RunEventCursor,
} from "./thread-run-state";
import { assistantToolSequenceContinuations } from "./tool-sequence-layout";
import { TurnTokenUsageRow } from "./TurnTokenUsageRow";
import { ThreadContentFrame } from "./ThreadContentFrame";
import { MessageMarkdown } from "./MessageMarkdown";
import {
  RESPONSE_ERROR_COLLAPSED_HEIGHT,
  shouldCollapseResponseError,
} from "./response-error-collapse";
import wordlessIcon from "../../../icons/common-icons/wordless.png";
import thinkingIcon from "../../../icons/common-icons/深度思考.svg";
import { skillIconText } from "../../shared/skill-icon";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { ExpertPortrait } from "../experts/ExpertPortrait";
import { parseExpertPortrait } from "../experts/avataaars-portrait";

type ThreadViewProps = {
  artifactSelection?: ArtifactSelection | null;
  composerDraft?: InlineSkillComposerValue;
  messageNavigationTarget?: ThreadMessageNavigationTarget | null;
  onArtifactSelectionConsumed?: () => void;
  onComposerDraftChange: (
    sessionId: string,
    draft: InlineSkillComposerValue,
  ) => void;
  onMessageNavigationConsumed?: (requestId: number) => void;
  pendingWorkspaceReferences: InlineWorkspaceReferenceToken[];
  onPendingWorkspaceReferencesConsumed: () => void;
  onOpenModels: () => void;
  onOpenSkillImport: () => void;
  onOpenSkills: () => void;
  onOpenResearchTask?: (selection: ResearchTaskSelection) => void;
  sessionId: string;
  initialPendingTurn?: PendingThreadTurn | null;
};

export type ThreadMessageNavigationTarget = {
  matchText: string;
  messageId: string;
  requestId: number;
  sessionId: string;
  turnId: string;
};

const SESSION_VIEW_CACHE_LIMIT = 3;
const sessionViewCache = new Map<string, SessionViewSnapshot>();

type ThreadVirtuosoContext = {
  compactionError?: string;
  compactionTrigger?: ContextCompactionRecord["trigger"];
  densityRail: boolean;
  isCompacting: boolean;
  onRetryCompaction: () => void;
  planMode: "off" | "planning" | "executing";
  planState?: Record<string, unknown>;
};

function ThreadVirtuosoHeader({
  context,
}: {
  context: ThreadVirtuosoContext;
}) {
  return context.planMode !== "off" ? (
    <ThreadContentFrame className="pb-7 pt-6" densityRail={context.densityRail}>
      <PlanModePanel mode={context.planMode} state={context.planState} />
    </ThreadContentFrame>
  ) : (
    <div className="h-6" />
  );
}

function ThreadVirtuosoFooter({
  context,
}: {
  context: ThreadVirtuosoContext;
}) {
  return (
    <ThreadContentFrame className="pb-10" densityRail={context.densityRail}>
      {context.isCompacting ? (
        <ContextCompactionPending trigger={context.compactionTrigger} />
      ) : null}
      {context.compactionError ? (
        <ContextCompactionFailure
          message={context.compactionError}
          onRetry={context.onRetryCompaction}
          trigger={context.compactionTrigger}
        />
      ) : null}
    </ThreadContentFrame>
  );
}

const THREAD_VIRTUOSO_COMPONENTS: Components<
  ThreadTimelineItem,
  ThreadVirtuosoContext
> = {
  Footer: ThreadVirtuosoFooter,
  Header: ThreadVirtuosoHeader,
};

function threadTimelineItemKey(_index: number, item: ThreadTimelineItem) {
  return item.type === "compaction"
    ? item.compaction.id
    : item.type === "assistant-run" ||
        item.messages[0]?.role === "assistant"
      ? `assistant:${item.turnId}`
      : item.messages[0]!.id;
}

type ExpertTaskView = {
  id: string;
  memberId?: string;
  memberName?: string;
  memberPortrait?: ExpertPortraitDefinition;
  executionProfile: string;
  task: string;
  status: string;
  phase?: string;
  revision?: number;
  queuedAt?: number;
  startedAt?: number;
  updatedAt?: number;
  finishedAt?: number;
  activeToolName?: string;
  blockedByTaskId?: string;
  terminalReason?: string;
  output?: string;
  error?: string;
  tool?: { name: string; output?: string };
  events: Array<
    | { id: string; type: "delegated"; text: string; at: number }
    | {
        id: string;
        type: "tool";
        name: string;
        state: string;
        output?: string;
        at: number;
      }
    | { id: string; type: "output" | "error"; text: string; at: number }
  >;
};

function expertTaskRunsFromExtensions(
  extensions: SessionSnapshot["extensions"],
): Map<string, Record<string, unknown>> {
  const state = extensions.find(
    (extension) => extension.extensionId === "wordless.expert-team",
  )?.state;
  const runs = asObject(state?.taskRuns);
  if (!runs) return new Map();
  return new Map(
    Object.entries(runs).flatMap(([taskId, value]) => {
      const run = asObject(value);
      return run && typeof run.id === "string" && run.id === taskId
        ? [[taskId, run] as const]
        : [];
    }),
  );
}

function overlayExpertTaskRuns(
  messages: ConversationMessage[],
  extensions: SessionSnapshot["extensions"],
): ConversationMessage[] {
  const runs = expertTaskRunsFromExtensions(extensions);
  if (!runs.size) return messages;
  return messages.map((message) => ({
    ...message,
    blocks: message.blocks.map((block) => {
      if (
        block.type !== "tool" ||
        block.name !== "delegate_expert" ||
        !asObject(block.details)
      )
        return block;
      const details = asObject(block.details)!;
      if (!Array.isArray(details.tasks)) return block;
      let changed = false;
      const tasks = details.tasks.map((value) => {
        const task = asObject(value);
        const run = task && typeof task.id === "string" ? runs.get(task.id) : undefined;
        if (!task || !run) return value;
        const currentRevision =
          typeof task.revision === "number" ? task.revision : 0;
        const nextRevision =
          typeof run.revision === "number" ? run.revision : 0;
        if (nextRevision < currentRevision) return value;
        changed = true;
        return { ...task, ...run };
      });
      return changed ? { ...block, details: { ...details, tasks } } : block;
    }),
  }));
}

function expertTasksFromMessages(
  messages: ConversationMessage[],
): ExpertTaskView[] {
  const tasks = new Map<string, ExpertTaskView>();
  for (const message of messages)
    for (const block of message.blocks) {
      if (
        block.type !== "tool" ||
        block.name !== "delegate_expert" ||
        typeof block.details !== "object" ||
        block.details === null ||
        Array.isArray(block.details)
      )
        continue;
      const values = (block.details as Record<string, unknown>).tasks;
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (typeof value !== "object" || value === null || Array.isArray(value))
          continue;
        const task = value as Record<string, unknown>;
        if (
          typeof task.id !== "string" ||
          typeof task.executionProfile !== "string" ||
          typeof task.task !== "string" ||
          typeof task.status !== "string"
        )
          continue;
        const tool =
          typeof task.tool === "object" &&
          task.tool !== null &&
          !Array.isArray(task.tool)
            ? (task.tool as Record<string, unknown>)
            : undefined;
        const portrait =
          typeof task.memberPortrait === "object" &&
          task.memberPortrait !== null &&
          !Array.isArray(task.memberPortrait)
            ? (task.memberPortrait as Record<string, unknown>)
            : undefined;
        const parsedPortrait = parseExpertPortrait(portrait);
        const events = Array.isArray(task.events)
          ? task.events.flatMap((candidate): ExpertTaskView["events"] => {
              if (
                typeof candidate !== "object" ||
                candidate === null ||
                Array.isArray(candidate)
              )
                return [];
              const event = candidate as Record<string, unknown>;
              if (
                typeof event.id !== "string" ||
                typeof event.type !== "string" ||
                typeof event.at !== "number"
              )
                return [];
              if (
                (event.type === "delegated" ||
                  event.type === "output" ||
                  event.type === "error") &&
                typeof event.text === "string"
              )
                return [
                  {
                    id: event.id,
                    type: event.type,
                    text: event.text,
                    at: event.at,
                  },
                ];
              if (
                event.type === "tool" &&
                typeof event.name === "string" &&
                typeof event.state === "string"
              )
                return [
                  {
                    id: event.id,
                    type: "tool",
                    name: event.name,
                    state: event.state,
                    ...(typeof event.output === "string"
                      ? { output: event.output }
                      : {}),
                    at: event.at,
                  },
                ];
              return [];
            })
          : [];
        tasks.set(task.id, {
          id: task.id,
          ...(typeof task.memberId === "string"
            ? { memberId: task.memberId }
            : {}),
          ...(typeof task.memberName === "string"
            ? { memberName: task.memberName }
            : {}),
          ...(parsedPortrait
            ? { memberPortrait: parsedPortrait }
            : {}),
          executionProfile: task.executionProfile,
          task: task.task,
          status: task.status,
          ...(typeof task.phase === "string" ? { phase: task.phase } : {}),
          ...(typeof task.revision === "number"
            ? { revision: task.revision }
            : {}),
          ...(typeof task.queuedAt === "number"
            ? { queuedAt: task.queuedAt }
            : {}),
          ...(typeof task.startedAt === "number"
            ? { startedAt: task.startedAt }
            : {}),
          ...(typeof task.updatedAt === "number"
            ? { updatedAt: task.updatedAt }
            : {}),
          ...(typeof task.finishedAt === "number"
            ? { finishedAt: task.finishedAt }
            : {}),
          ...(typeof task.activeToolName === "string"
            ? { activeToolName: task.activeToolName }
            : {}),
          ...(typeof task.blockedByTaskId === "string"
            ? { blockedByTaskId: task.blockedByTaskId }
            : {}),
          ...(typeof task.terminalReason === "string"
            ? { terminalReason: task.terminalReason }
            : {}),
          ...(typeof task.output === "string" ? { output: task.output } : {}),
          ...(typeof task.error === "string" ? { error: task.error } : {}),
          ...(tool && typeof tool.name === "string"
            ? {
                tool: {
                  name: tool.name,
                  ...(typeof tool.output === "string"
                    ? { output: tool.output }
                    : {}),
                },
              }
            : {}),
          events,
        });
      }
    }
  return [...tasks.values()];
}

function expertMemberExecutionProfile(
  value: string,
): ExpertCollaborationMember["executionProfile"] | undefined {
  return value === "read-only" ||
    value === "review" ||
    value === "research" ||
    value === "workspace-write"
    ? value
    : undefined;
}

function expertMemberStatus(
  value: string,
): ExpertCollaborationMember["latestStatus"] | undefined {
  return value === "queued" ||
    value === "running" ||
    value === "awaiting-approval" ||
    value === "awaiting-user-input" ||
    value === "completed" ||
    value === "interrupted" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "blocked" ||
    value === "skipped"
    ? value
    : undefined;
}

function mergeExpertCollaborationMembers(
  persisted: readonly ExpertCollaborationMember[],
  tasks: readonly ExpertTaskView[],
): ExpertCollaborationMember[] {
  const members = new Map(
    persisted.map((member) => [member.memberId, { ...member }]),
  );
  const taskIds = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (!task.memberId || !task.memberName || !task.memberPortrait) continue;
    const executionProfile = expertMemberExecutionProfile(
      task.executionProfile,
    );
    const status = expertMemberStatus(task.status);
    if (!executionProfile || !status) continue;
    const activeAt =
      task.updatedAt ??
      task.events.reduce((latest, event) => Math.max(latest, event.at), 0);
    const ids = taskIds.get(task.memberId) ?? new Set<string>();
    ids.add(task.id);
    taskIds.set(task.memberId, ids);
    const current = members.get(task.memberId);
    if (!current) {
      members.set(task.memberId, {
        memberId: task.memberId,
        name: task.memberName,
        portrait: task.memberPortrait,
        executionProfile,
        latestStatus: status,
        ...(task.phase
          ? { phase: task.phase as ExpertCollaborationMember["phase"] }
          : {}),
        ...(task.startedAt ? { startedAt: task.startedAt } : {}),
        ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
        ...(task.activeToolName ? { activeToolName: task.activeToolName } : {}),
        ...(task.blockedByTaskId
          ? { blockedByTaskId: task.blockedByTaskId }
          : {}),
        ...(task.terminalReason ? { terminalReason: task.terminalReason } : {}),
        taskCount: ids.size,
        lastActiveAt: activeAt,
      });
      continue;
    }
    current.taskCount = Math.max(current.taskCount, ids.size);
    if (activeAt >= current.lastActiveAt) {
      const next = {
        ...current,
        latestStatus: status,
        lastActiveAt: activeAt,
        ...(task.phase
          ? { phase: task.phase as ExpertCollaborationMember["phase"] }
          : {}),
        ...(task.startedAt ? { startedAt: task.startedAt } : {}),
        ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
        ...(task.activeToolName ? { activeToolName: task.activeToolName } : {}),
        ...(task.blockedByTaskId
          ? { blockedByTaskId: task.blockedByTaskId }
          : {}),
        ...(task.terminalReason ? { terminalReason: task.terminalReason } : {}),
      };
      if (!task.activeToolName) delete next.activeToolName;
      if (!task.blockedByTaskId) delete next.blockedByTaskId;
      if (!task.terminalReason) delete next.terminalReason;
      members.set(task.memberId, next);
    }
  }
  return [...members.values()];
}

function expertMemberIsActive(member: ExpertCollaborationMember): boolean {
  return (
    member.latestStatus === "running" ||
    member.latestStatus === "awaiting-approval" ||
    member.latestStatus === "awaiting-user-input"
  );
}

function useExpertActivityClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function compactElapsed(startedAt: number | undefined, now: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function expertActivityLabel(
  member: ExpertCollaborationMember,
  t: (key: MessageKey) => string,
): string {
  if (member.latestStatus === "queued")
    return member.blockedByTaskId
      ? t("threadWaitingForPreviousMember")
      : t("threadQueued");
  if (member.latestStatus === "awaiting-approval")
    return t("threadAwaitingApproval");
  if (member.latestStatus === "awaiting-user-input")
    return t("threadAwaitingInput");
  if (member.latestStatus === "completed")
    return t("threadCompleted");
  if (member.latestStatus === "interrupted")
    return t("threadInterrupted");
  if (member.latestStatus === "failed") return t("threadFailed");
  if (member.latestStatus === "cancelled")
    return t("threadCancelled");
  if (member.latestStatus === "blocked")
    return t("threadBlocked");
  if (member.latestStatus === "skipped")
    return t("threadSkipped");
  if (member.phase === "tool" && member.activeToolName)
    return t("threadUsingTool").replace("{tool}", member.activeToolName);
  return t("threadModelThinking");
}

function expertMemberActivityFromMessage(
  message: ConversationMessage,
  since: number,
): AssistantRunActivity {
  const tool = [...message.blocks]
    .reverse()
    .find((block): block is MessageToolBlock => block.type === "tool");
  if (tool?.state === "awaiting-approval")
    return { type: "awaiting-approval", since };
  if (tool?.state === "awaiting-user-input")
    return { type: "awaiting-user-input", since };
  if (tool?.state === "running" || tool?.state === "pending")
    return {
      type: "tool",
      tool: assistantToolActivity(tool.name),
      phase: "running",
      since,
    };
  const last = message.blocks.at(-1);
  if (last?.type === "text") return { type: "generating", since };
  if (last?.type === "reasoning") return { type: "thinking", since };
  if (tool?.state === "complete" || tool?.state === "error")
    return {
      type: "tool-result",
      tool: assistantToolActivity(tool.name),
      outcome: tool.state === "error" ? "failure" : "success",
      since,
    };
  return { type: "thinking", since };
}

function ExpertMemberAssistantBlocks({
  message,
  onEnableAutoApprove,
  onLoadToolOutput,
  onResolveApproval,
  workbenchId,
}: {
  message: ConversationMessage;
  onEnableAutoApprove?: () => Promise<void>;
  onLoadToolOutput: (callId: string) => Promise<void>;
  onResolveApproval: (
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => void;
  workbenchId: WorkbenchId;
}) {
  return message.blocks.map((block, index) => {
    if (block.type === "text")
      return (
        <div className="message-markdown" key={`text-${index}`}>
          <MessageMarkdown text={block.text} />
        </div>
      );
    if (block.type === "reasoning")
      return <ThinkingBlock key={`reasoning-${index}`} text={block.text} />;
    if (block.type === "tool") {
      const ToolActivity = workbenchRendererRegistry.resolveTool(
        workbenchId,
        block.name,
      );
      return (
        <div
          className="mt-3 border-y border-[#e7e7e2] dark:border-border"
          key={block.callId}
        >
          <ToolActivity
            block={block}
            onEnableAutoApprove={onEnableAutoApprove}
            onLoadToolOutput={onLoadToolOutput}
            onResolveApproval={onResolveApproval}
          />
        </div>
      );
    }
    if (block.type === "artifact")
      return (
        <p
          className="mt-3 text-[12px] font-semibold text-[#59732d]"
          key={`${block.artifactId}:${index}`}
        >
          {block.name}
        </p>
      );
    return null;
  });
}

function ExpertMemberStream({
  densityRail,
  expertName,
  leadExpert,
  member,
  onEnableAutoApprove,
  onResolveApproval,
  sessionId,
  workbenchId,
}: {
  densityRail: boolean;
  expertName: string;
  leadExpert: Pick<ExpertCollaborationLeader, "name" | "portrait">;
  member: ExpertCollaborationMember;
  onEnableAutoApprove?: () => Promise<void>;
  onResolveApproval: (
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => void;
  sessionId: string;
  workbenchId: WorkbenchId;
}) {
  const client = useRuntimeClient();
  const { t } = usePreferences();
  const active = expertMemberIsActive(member);
  const now = useExpertActivityClock(active);
  const activityLabel = expertActivityLabel(member, t);
  const elapsed = active ? compactElapsed(member.startedAt, now) : "";
  const scrollRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const loadingBeforeRef = useRef(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [liveMessage, setLiveMessage] =
    useState<ExpertMemberLiveMessage | null>(null);
  const liveMessageRef = useRef<ExpertMemberLiveMessage | null>(null);
  const [history, setHistory] = useState<SessionHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [runActivity, setRunActivity] = useState<AssistantRunActivity>(() => ({
    type: "thinking",
    since: member.startedAt ?? Date.now(),
  }));

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = scrollRef.current;
    if (!element) return;
    followLatestRef.current = true;
    setIsAtBottom(true);
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const page = await client.getExpertMemberHistory(
        sessionId,
        member.memberId,
        {},
      );
      const historyMessages = messagesFromHistoryPage(page);
      setMessages((current) =>
        mergeMessages(current, historyMessages),
      );
      const currentLive = liveMessageRef.current;
      if (
        currentLive &&
        historyMessages.some((message) =>
          expertMemberMessagesCorrelate(message, currentLive.message),
        )
      ) {
        liveMessageRef.current = null;
        setLiveMessage(null);
      }
      setHistory(page);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client, member.memberId, sessionId]);

  useEffect(() => {
    followLatestRef.current = true;
    setIsAtBottom(true);
    setMessages([]);
    liveMessageRef.current = null;
    setLiveMessage(null);
    setHistory(null);
    setLoading(true);
    setError(null);
    void loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    setRunActivity({
      type: "thinking",
      since: member.startedAt ?? Date.now(),
    });
  }, [member.memberId, member.startedAt]);

  useEffect(() => {
    const since = member.lastActiveAt || member.startedAt || Date.now();
    if (member.latestStatus === "awaiting-approval")
      setRunActivity({ type: "awaiting-approval", since });
    else if (member.latestStatus === "awaiting-user-input")
      setRunActivity({ type: "awaiting-user-input", since });
    else if (member.phase === "tool" && member.activeToolName)
      setRunActivity({
        type: "tool",
        tool: assistantToolActivity(member.activeToolName),
        phase: "running",
        since,
      });
  }, [
    member.activeToolName,
    member.lastActiveAt,
    member.latestStatus,
    member.phase,
    member.startedAt,
  ]);

  useEffect(() => {
    let mounted = true;
    const mergeLive = (incoming: ExpertMemberLiveMessage) => {
      if (!mounted || incoming.memberId !== member.memberId) return;
      const current = liveMessageRef.current;
      if (
        current?.taskId === incoming.taskId &&
        incoming.revision <= current.revision
      )
        return;
      setRunActivity(
        expertMemberActivityFromMessage(incoming.message, Date.now()),
      );
      liveMessageRef.current = incoming;
      setLiveMessage(incoming);
    };
    const unsubscribe = client.subscribe((envelope) => {
      if (envelope.sessionId !== sessionId) return;
      const payload = envelope.event;
      if (
        payload.type === "expert-member.message.started" &&
        payload.memberId === member.memberId
      ) {
        mergeLive({
          memberId: payload.memberId,
          taskId: payload.taskId,
          message: payload.message,
          revision: payload.revision,
        });
        return;
      }
      if (
        (payload.type === "expert-member.message.text.delta" ||
          payload.type === "expert-member.message.reasoning.delta") &&
        payload.memberId === member.memberId
      ) {
        const current = liveMessageRef.current;
        if (
          current?.taskId === payload.taskId &&
          payload.revision <= current.revision
        )
          return;
        setRunActivity({
          type:
            payload.type === "expert-member.message.text.delta"
              ? "generating"
              : "thinking",
          since: envelope.timestamp,
        });
        const message = appendExpertMemberMessageDelta(
            current?.taskId === payload.taskId
              ? current.message
              : {
                  id: payload.messageId,
                  role: "assistant",
                  status: "streaming",
                  blocks: [],
                  model: null,
                  timestamp: envelope.timestamp,
                },
            payload.messageId,
            payload.type === "expert-member.message.text.delta"
              ? "text"
              : "reasoning",
            payload.delta,
          );
        const next = {
          memberId: payload.memberId,
          taskId: payload.taskId,
          message,
          revision: payload.revision,
        };
        liveMessageRef.current = next;
        setLiveMessage(next);
        return;
      }
      if (
        payload.type === "expert-member.message.completed" &&
        payload.memberId === member.memberId
      ) {
        setRunActivity(
          expertMemberActivityFromMessage(
            payload.message,
            envelope.timestamp,
          ),
        );
        const completed = {
          memberId: payload.memberId,
          taskId: payload.taskId,
          message: payload.message,
          revision: payload.revision,
        };
        liveMessageRef.current = completed;
        setLiveMessage(completed);
        void loadLatest();
        return;
      }
      if (
        (payload.type === "expert-member.tool.started" ||
          payload.type === "expert-member.tool.updated" ||
          payload.type === "expert-member.tool.completed" ||
          payload.type === "expert-member.approval.requested" ||
          payload.type === "expert-member.approval.resolved") &&
        payload.memberId === member.memberId
      ) {
        if (payload.type === "expert-member.tool.started")
          setRunActivity({
            type: "tool",
            tool: assistantToolActivity(payload.name),
            phase: "running",
            since: envelope.timestamp,
          });
        else if (payload.type === "expert-member.tool.updated")
          setRunActivity((current) => ({
            type: "tool",
            tool:
              current.type === "tool" || current.type === "tool-result"
                ? current.tool
                : "tool",
            phase: "running",
            since: envelope.timestamp,
          }));
        else if (payload.type === "expert-member.tool.completed")
          setRunActivity((current) => ({
            type: "tool-result",
            tool:
              current.type === "tool" || current.type === "tool-result"
                ? current.tool
                : "tool",
            outcome: payload.isError ? "failure" : "success",
            since: envelope.timestamp,
          }));
        else if (payload.type === "expert-member.approval.requested")
          setRunActivity({
            type: "awaiting-approval",
            since: envelope.timestamp,
          });
        else
          setRunActivity({ type: "thinking", since: envelope.timestamp });
        setMessages((current) =>
          applyExpertMemberActivity(current, payload),
        );
        setLiveMessage((current) => {
          if (!current || current.taskId !== payload.taskId) return current;
          const [message] = applyExpertMemberActivity(
            [current.message],
            payload,
          );
          const next = message ? { ...current, message } : current;
          liveMessageRef.current = next;
          return next;
        });
      }
    });
    void client
      .getExpertMemberLiveState(sessionId, member.memberId)
      .then((snapshot) => {
        if (snapshot) mergeLive(snapshot);
      })
      .catch((cause) => {
        if (mounted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [client, loadLatest, member.memberId, sessionId]);

  const renderedMessages = useMemo(
    () =>
      liveMessage &&
      !messages.some((message) =>
        expertMemberMessagesCorrelate(message, liveMessage.message),
      )
        ? [...messages, liveMessage.message]
        : messages,
    [liveMessage, messages],
  );

  useEffect(() => {
    if (followLatestRef.current) scrollToLatest("auto");
  }, [renderedMessages, scrollToLatest]);

  useEffect(() => {
    if (!active) {
      void loadLatest();
      return;
    }
    const timer = window.setInterval(() => void loadLatest(), 1_500);
    return () => window.clearInterval(timer);
  }, [active, loadLatest]);

  const loadOlder = useCallback(async () => {
    if (
      loadingBeforeRef.current ||
      !history?.hasMoreBefore ||
      !history.nextBeforeCursor
    )
      return;
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    loadingBeforeRef.current = true;
    try {
      const page = await client.getExpertMemberHistory(
        sessionId,
        member.memberId,
        { before: history.nextBeforeCursor },
      );
      setMessages((current) =>
        mergeMessages(messagesFromHistoryPage(page), current),
      );
      setHistory((current) =>
        current
          ? {
              ...current,
              hasMoreBefore: page.hasMoreBefore,
              nextBeforeCursor: page.nextBeforeCursor,
              revision: page.revision,
            }
          : page,
      );
      window.requestAnimationFrame(() => {
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loadingBeforeRef.current = false;
    }
  }, [client, history, member.memberId, sessionId]);

  const loadToolOutput = useCallback(
    async (callId: string) => {
      const output = await client.getExpertMemberToolOutput(
        sessionId,
        member.memberId,
        callId,
      );
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          blocks: message.blocks.map((block) =>
            block.type === "tool" && block.callId === callId
              ? { ...block, output, outputTruncated: false }
              : block,
          ),
        })),
      );
    },
    [client, member.memberId, sessionId],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto py-8"
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
          followLatestRef.current = atBottom;
          setIsAtBottom(atBottom);
          if (element.scrollTop < 80) void loadOlder();
        }}
        ref={scrollRef}
      >
        <ThreadContentFrame densityRail={densityRail}>
          <header className="flex items-center gap-3 border-b border-[#ecece7] pb-4 dark:border-border">
            <ExpertPortrait
              className="h-10 w-10 shrink-0"
              name={member.name}
              portrait={member.portrait}
            />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#353530] dark:text-foreground">
                {member.name}
              </p>
              <p className="mt-0.5 text-[10px] text-[#8d8d85]">
                {expertName} · {activityLabel}{elapsed ? ` · ${elapsed}` : ""}
              </p>
            </div>
          </header>
          <section className="space-y-6 py-5">
            {loading ? (
              <div className="flex items-center gap-2 text-[12px] text-[#78835e]">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                {t("threadLoadingEmployeeMessages")}
              </div>
            ) : null}
            {error ? (
              <div className="flex items-center justify-between gap-3 rounded-[7px] border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                <span className="min-w-0 truncate">{error}</span>
                <button
                  className="shrink-0 font-semibold"
                  onClick={() => void loadLatest()}
                  type="button"
                >
                  {t("retry")}
                </button>
              </div>
            ) : null}
            {!loading && !error && renderedMessages.length === 0 ? (
              <p className="py-10 text-center text-[12px] text-[#8d8d85]">
                {t("threadNoSavedEmployeeMessages")}
              </p>
            ) : null}
            {renderedMessages.map((message) =>
              message.role === "user" ? (
                <div className="flex justify-end" key={message.id}>
                  <div className="flex max-w-[88%] flex-col items-end sm:max-w-[560px]">
                    <div className="mb-1.5 flex items-center gap-1.5 pr-0.5">
                      <span className="text-[10px] font-semibold text-[#66675f] dark:text-muted-foreground">
                        {leadExpert.name}
                      </span>
                      <ExpertPortrait
                        className="h-6 w-6 shrink-0"
                        name={leadExpert.name}
                        portrait={leadExpert.portrait}
                      />
                    </div>
                    <div className="w-fit max-w-full break-words rounded-[10px] bg-[#f0f0ed] px-3.5 py-2.5 text-[14px] leading-6 text-[#343431] dark:bg-muted dark:text-foreground">
                      <CollapsibleUserMessage contentKey={message.id}>
                        {message.blocks.map((block, index) =>
                          block.type === "text" ? (
                            <span
                              className="whitespace-pre-wrap break-words"
                              key={`text-${index}`}
                            >
                              {block.text}
                            </span>
                          ) : null,
                        )}
                      </CollapsibleUserMessage>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={message.id}>
                  <div className="flex h-7 items-center gap-3">
                    <ExpertPortrait
                      className="h-7 w-7 shrink-0"
                      name={member.name}
                      portrait={member.portrait}
                    />
                    <p className="text-[10px] font-semibold text-[#66675f] dark:text-muted-foreground">
                      {member.name}
                    </p>
                  </div>
                  <div className="mt-2 min-w-0">
                    <ExpertMemberAssistantBlocks
                      message={message}
                      onEnableAutoApprove={onEnableAutoApprove}
                      onLoadToolOutput={loadToolOutput}
                      onResolveApproval={onResolveApproval}
                      workbenchId={workbenchId}
                    />
                  </div>
                </div>
              ),
            )}
            {active ? (
              <AssistantRunStatus
                activity={runActivity}
                detail={elapsed || undefined}
              />
            ) : null}
          </section>
        </ThreadContentFrame>
      </div>
      {!isAtBottom ? (
        <button
          aria-label={t("threadJumpToLatest")}
          className="absolute bottom-4 left-1/2 z-10 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-[#deded8] bg-white text-[#4d4d48] shadow-[0_4px_12px_rgba(0,0,0,0.10)] hover:bg-[#f5f5f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
          onClick={() => scrollToLatest()}
          title={t("threadJumpToLatest")}
          type="button"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function ExpertCollaborationBar({
  lead,
  onSelectLead,
  onSelectMember,
  members,
  selectedMemberId,
  teamName,
}: {
  lead: ExpertCollaborationLeader;
  onSelectLead: () => void;
  onSelectMember: (memberId: string) => void;
  members: ExpertCollaborationMember[];
  selectedMemberId?: string;
  teamName: string;
}) {
  const { t } = usePreferences();
  const hasActiveMember = members.some(expertMemberIsActive);
  const activityNow = useExpertActivityClock(hasActiveMember);
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ left: number; moved: boolean; x: number } | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState(false);
  const visibleMembers = collapsed ? members.slice(0, 3) : members;
  const toggleLabel = collapsed
    ? t("threadExpandEmployeeMembers")
    : t("threadCollapseEmployeeMembers");
  const leadLabel = t("threadTeamLead");
  const leadSelected = selectedMemberId === undefined;
  return (
    <div className="mb-2 flex min-w-0 items-center gap-1.5">
      <button
        aria-current={leadSelected ? "true" : undefined}
        className={`flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] border px-2 text-left transition-colors ${
          leadSelected
            ? "border-[#aebd8e] bg-[#f1f5e7] ring-1 ring-[#d7dfc6] dark:border-[#728650] dark:bg-[#303b24] dark:ring-[#465536]"
            : "border-[#e1e3dc] bg-white hover:border-[#cfd8bc] hover:bg-[#f7f8f3] dark:border-border dark:bg-card dark:hover:bg-muted"
        }`}
        onClick={onSelectLead}
        title={`${lead.name} · ${leadLabel} · ${teamName}`}
        type="button"
      >
        <ExpertPortrait
          className="h-6 w-6 shrink-0"
          name={lead.name}
          portrait={lead.portrait}
        />
        <span className="min-w-0">
          <span className="block max-w-[132px] truncate text-[10px] font-semibold text-[#4e4f49] dark:text-foreground">
            {lead.name}
          </span>
          <span className="block text-[8px] font-medium text-[#7a855d] dark:text-[#b9c995]">
            {leadLabel}
          </span>
        </span>
      </button>
      {members.length ? (
        <div
          className={`flex min-w-0 flex-1 items-center gap-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
            collapsed
              ? "overflow-hidden"
              : "cursor-grab overflow-x-auto active:cursor-grabbing"
          }`}
          onPointerDown={(event) => {
            if (collapsed) return;
            const rail = railRef.current;
            if (!rail) return;
            dragRef.current = {
              left: rail.scrollLeft,
              moved: false,
              x: event.clientX,
            };
          }}
          onPointerMove={(event) => {
            if (collapsed) return;
            const rail = railRef.current;
            const drag = dragRef.current;
            if (!rail || !drag) return;
            const delta = event.clientX - drag.x;
            if (Math.abs(delta) > 4 && !drag.moved) {
              drag.moved = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            rail.scrollLeft = drag.left - delta;
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            window.setTimeout(() => {
              dragRef.current = null;
            }, 0);
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          ref={railRef}
        >
          {visibleMembers.map((member) => (
            <button
              aria-current={
                selectedMemberId === member.memberId ? "true" : undefined
              }
              className={`flex shrink-0 items-center rounded-[12px] border text-left transition-[width,height,padding,border-color,background-color] duration-150 ${
                collapsed ? "h-8 w-8 justify-center p-0" : "h-10 gap-1.5 px-2"
              } ${
                selectedMemberId === member.memberId
                  ? "border-[#aebd8e] bg-[#f1f5e7] ring-1 ring-[#d7dfc6] dark:border-[#728650] dark:bg-[#303b24] dark:ring-[#465536]"
                  : "border-[#e1e3dc] bg-white hover:border-[#cfd8bc] hover:bg-[#f7f8f3] dark:border-border dark:bg-card dark:hover:bg-muted"
              }`}
              key={member.memberId}
              onClick={() => {
                if (!dragRef.current?.moved) onSelectMember(member.memberId);
              }}
              title={`${member.name} · ${member.taskCount}`}
              type="button"
            >
              <ExpertPortrait
                className={collapsed ? "h-5 w-5 shrink-0" : "h-6 w-6 shrink-0"}
                name={member.name}
                portrait={member.portrait}
              />
              {!collapsed ? (
                <>
                  <span className="min-w-0">
                    <span className="block max-w-[112px] truncate text-[10px] font-semibold text-[#4e4f49] dark:text-foreground">
                      {member.name}
                    </span>
                    <span className="block max-w-[112px] truncate text-[8px] text-[#7a855d] dark:text-[#b9c995]">
                      {expertActivityLabel(member, t)}
                      {expertMemberIsActive(member) && member.startedAt
                        ? ` · ${compactElapsed(member.startedAt, activityNow)}`
                        : ""}
                    </span>
                  </span>
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
                    {expertMemberIsActive(member) ? (
                      <LoaderCircle className="h-3 w-3 animate-spin text-[#7a8f4f] dark:text-[#c7df7c]" />
                    ) : member.latestStatus === "completed" ? (
                      <Check className="h-3 w-3 text-[#6d8d3b]" />
                    ) : member.latestStatus === "interrupted" ||
                      member.latestStatus === "failed" ||
                      member.latestStatus === "blocked" ||
                      member.latestStatus === "skipped" ? (
                      <CircleAlert className="h-3 w-3 text-destructive" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-[#9b8a58]" />
                    )}
                  </span>
                </>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="min-w-0 flex-1" />
      )}
      {members.length ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-expanded={!collapsed}
              aria-label={toggleLabel}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-[#e1e3dc] bg-white text-[#74766d] transition-colors hover:border-[#c7d1b3] hover:bg-[#f5f7ef] hover:text-[#55663a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
              onClick={() => {
                dragRef.current = null;
                setCollapsed((value) => !value);
              }}
              type="button"
            >
              {collapsed ? (
                <PanelRightOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelRightClose className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function rememberSessionView(view: SessionViewSnapshot): void {
  sessionViewCache.delete(view.session.id);
  sessionViewCache.set(view.session.id, view);
  while (sessionViewCache.size > SESSION_VIEW_CACHE_LIMIT) {
    const oldest = sessionViewCache.keys().next().value;
    if (!oldest) break;
    sessionViewCache.delete(oldest);
  }
}

function normalizeApproval(
  approval: ToolOperationApproval | undefined,
): ToolOperationApproval | undefined {
  if (!approval) return undefined;
  return {
    ...approval,
    severity: approval.severity === "high" ? "high" : "normal",
    matchedRules: Array.isArray(approval.matchedRules)
      ? approval.matchedRules
      : [],
  };
}

function approvalFromDetails(
  details: unknown,
  existing: ToolOperationApproval | undefined,
): ToolOperationApproval | undefined {
  if (
    typeof details !== "object" ||
    details === null ||
    Array.isArray(details) ||
    !("approval" in details)
  )
    return normalizeApproval(existing);
  const approval = details.approval;
  if (
    typeof approval !== "object" ||
    approval === null ||
    Array.isArray(approval)
  )
    return normalizeApproval(existing);
  return normalizeApproval(approval as ToolOperationApproval);
}

function userRequestFromDetails(
  details: unknown,
  existing: MessageUserRequest | undefined,
): MessageUserRequest | undefined {
  if (
    typeof details !== "object" ||
    details === null ||
    Array.isArray(details) ||
    !("userRequest" in details)
  )
    return existing;
  const userRequest = details.userRequest;
  if (
    typeof userRequest !== "object" ||
    userRequest === null ||
    Array.isArray(userRequest) ||
    !("request" in userRequest)
  )
    return existing;
  const request = userRequest.request;
  if (
    typeof request !== "object" ||
    request === null ||
    Array.isArray(request) ||
    !("requestId" in request) ||
    typeof request.requestId !== "string"
  )
    return existing;
  return userRequest as MessageUserRequest;
}

function formatTokenCount(value: number): string {
  if (value < 1_000) return value.toLocaleString();
  const compact = Math.round((value / 1_000) * 10) / 10;
  return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function planModeFromSnapshot(
  snapshot: SessionSnapshot,
): "off" | "planning" | "executing" {
  const state = snapshot.extensions.find(
    (item) => item.extensionId === "wordless.plan-mode",
  )?.state;
  return state?.mode === "planning" || state?.mode === "executing"
    ? state.mode
    : "off";
}

function terminalizeToolDetails(details: unknown, reason: string): unknown {
  if (typeof details !== "object" || details === null || Array.isArray(details))
    return details;
  const record = details as Record<string, unknown>;
  if (!Array.isArray(record.tasks)) return details;
  return {
    ...record,
    updatedAt: Date.now(),
    tasks: record.tasks.map((value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return value;
      const task = value as Record<string, unknown>;
      if (
        task.status === "completed" ||
        task.status === "interrupted" ||
        task.status === "failed" ||
        task.status === "cancelled" ||
        task.status === "blocked"
      )
        return task;
      return {
        ...task,
        status: "cancelled",
        completedAt: Date.now(),
        error: typeof task.error === "string" ? task.error : reason,
        ...(typeof task.activeTool === "object" &&
        task.activeTool !== null &&
        !Array.isArray(task.activeTool)
          ? {
              activeTool: {
                ...(task.activeTool as Record<string, unknown>),
                state: "error",
              },
            }
          : {}),
      };
    }),
  };
}

function terminalizeActiveTools(
  messages: ConversationMessage[],
  reason: string,
): ConversationMessage[] {
  return messages.map((message) => ({
    ...message,
    blocks: message.blocks.map((block) => {
      if (block.type !== "tool" || ["complete", "error"].includes(block.state))
        return block;
      return {
        ...block,
        state: "error" as const,
        output: block.output ? `${block.output}\n\n${reason}` : reason,
        details: terminalizeToolDetails(block.details, reason),
      };
    }),
  }));
}

function applyEvent(
  snapshot: SessionSnapshot,
  event: RuntimeEventEnvelope,
  t: (key: MessageKey) => string,
): SessionSnapshot {
  const messages = [...snapshot.messages];
  const payload = event.event;
  if (
    payload.type === "extension.event" &&
    payload.event.type === "state.changed"
  ) {
    const state = asObject(payload.event.payload);
    if (
      typeof state?.extensionId !== "string" ||
      typeof state.updatedAt !== "number" ||
      !asObject(state.state)
    )
      return snapshot;
    const next = {
      extensionId: state.extensionId,
      updatedAt: state.updatedAt,
      state: asObject(state.state)!,
    };
    const extensions = snapshot.extensions.filter(
      (item) => item.extensionId !== next.extensionId,
    );
    const nextExtensions = [...extensions, next];
    return {
      ...snapshot,
      extensions: nextExtensions,
      messages: overlayExpertTaskRuns(messages, nextExtensions),
    };
  }
  if (payload.type === "context.compaction.started") {
    return {
      ...snapshot,
      isCompacting: true,
      compactionTrigger: payload.trigger,
      compactionError: undefined,
    };
  }
  if (payload.type === "context.compaction.completed") {
    const completed = completeContextCompaction(
      messages,
      snapshot.contextCompactions,
      payload.compaction,
      payload.recoveredFailureMessageId,
    );
    return {
      ...snapshot,
      ...completed,
      isCompacting: false,
      compactionTrigger: undefined,
      compactionError: undefined,
    };
  }
  if (payload.type === "context.compaction.failed") {
    return {
      ...snapshot,
      isCompacting: false,
      compactionTrigger: payload.trigger,
      compactionError: payload.message,
    };
  }
  if (payload.type === "message.started") {
    const existingIndex = messages.findIndex(
      (message) => message.id === payload.message.id,
    );
    if (existingIndex !== -1) {
      if (payload.message.role === "user")
        messages[existingIndex] = payload.message;
      return { ...snapshot, messages, isRunning: true };
    }
    const nextMessages = [...messages, payload.message];
    return {
      ...snapshot,
      messages: nextMessages,
      turnUsage: calculateCurrentTurnUsage(nextMessages) ?? snapshot.turnUsage,
      isRunning: true,
    };
  }
  if (payload.type === "message.text.delta") {
    const index = messages.findIndex(
      (message) => message.id === payload.messageId,
    );
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = [...message.blocks];
    const last = blocks.at(-1);
    if (last?.type === "text")
      blocks[blocks.length - 1] = {
        type: "text",
        text: last.text + payload.delta,
      };
    else blocks.push({ type: "text", text: payload.delta });
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "message.reasoning.delta") {
    const index = messages.findIndex(
      (message) => message.id === payload.messageId,
    );
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = [...message.blocks];
    const last = blocks.at(-1);
    if (last?.type === "reasoning")
      blocks[blocks.length - 1] = {
        type: "reasoning",
        text: last.text + payload.delta,
      };
    else blocks.push({ type: "reasoning", text: payload.delta });
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "message.completed") {
    const index = messages.findIndex(
      (message) => message.id === payload.message.id,
    );
    if (index === -1) {
      const nextMessages = [...messages, payload.message];
      return {
        ...snapshot,
        messages: nextMessages,
        turnUsage:
          calculateCurrentTurnUsage(nextMessages) ?? snapshot.turnUsage,
      };
    }
    const previous = messages[index]!;
    messages[index] = mergeCompletedAssistantMessage(previous, payload.message);
    return {
      ...snapshot,
      messages,
      turnUsage: calculateCurrentTurnUsage(messages) ?? snapshot.turnUsage,
    };
  }
  if (
    payload.type === "tool.started" ||
    payload.type === "tool.updated" ||
    payload.type === "tool.completed"
  ) {
    const index = messages.findIndex(
      (message) => message.id === payload.messageId,
    );
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const existing = message.blocks.find(
      (block): block is MessageToolBlock =>
        block.type === "tool" && block.callId === payload.callId,
    );
    const next: MessageToolBlock =
      payload.type === "tool.started"
        ? {
            type: "tool",
            callId: payload.callId,
            name: payload.name,
            input: payload.input,
            state: "running",
            startedAt: event.timestamp,
            ...(payload.name === "bash"
              ? {
                  timeoutSeconds:
                    typeof payload.input.timeout === "number"
                      ? payload.input.timeout
                      : 30,
                }
              : {}),
          }
        : {
            type: "tool",
            callId: payload.callId,
            name: existing?.name ?? "tool",
            startedAt: existing?.startedAt,
            timeoutSeconds: existing?.timeoutSeconds,
            input: existing?.input,
            output:
              payload.type === "tool.updated"
                ? `${existing?.output ?? ""}${payload.output}`
                : payload.output,
            details:
              payload.type === "tool.completed"
                ? payload.details
                : payload.type === "tool.updated"
                  ? (payload.details ?? existing?.details)
                  : existing?.details,
            usage: payload.usage ?? existing?.usage,
            approval:
              payload.type === "tool.completed"
                ? approvalFromDetails(payload.details, existing?.approval)
                : existing?.approval,
            userRequest:
              payload.type === "tool.completed"
                ? userRequestFromDetails(payload.details, existing?.userRequest)
                : existing?.userRequest,
            state:
              payload.type === "tool.completed"
                ? payload.isError
                  ? "error"
                  : "complete"
                : "running",
          };
    const blocks = existing
      ? message.blocks.map((block) =>
          block.type === "tool" && block.callId === payload.callId
            ? next
            : block,
        )
      : [...message.blocks, next];
    messages[index] = { ...message, blocks };
    return {
      ...snapshot,
      messages,
      turnUsage: calculateCurrentTurnUsage(messages) ?? snapshot.turnUsage,
      isRunning: true,
    };
  }
  if (payload.type === "approval.requested") {
    const index = messages.findIndex(
      (message) => message.id === payload.messageId,
    );
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) =>
      block.type === "tool" && block.callId === payload.approval.callId
        ? {
            ...block,
            state: "awaiting-approval" as const,
            approval: { ...payload.approval, status: "required" as const },
          }
        : block,
    );
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "approval.resolved") {
    const index = messages.findIndex(
      (message) => message.id === payload.messageId,
    );
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) =>
      block.type === "tool" &&
      block.approval?.approvalId === payload.resolution.approvalId
        ? {
            ...block,
            state: payload.resolution.approved
              ? ("running" as const)
              : ("error" as const),
            approval: {
              ...block.approval,
              status: payload.resolution.approved
                ? ("approved" as const)
                : ("rejected" as const),
              feedback: payload.resolution.feedback,
            },
            ...(!payload.resolution.approved
              ? {
                  output:
                    payload.resolution.feedback ??
                    t("threadOperationRejected"),
                }
              : {}),
          }
        : block,
    );
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "user-request.requested") {
    const index = messages.findIndex(
      (message) => message.id === payload.messageId,
    );
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) =>
      block.type === "tool" && block.callId === payload.request.callId
        ? {
            ...block,
            state: "awaiting-user-input" as const,
            userRequest: { request: payload.request },
          }
        : block,
    );
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "user-request.resolved") {
    const index = messages.findIndex(
      (message) => message.id === payload.messageId,
    );
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) =>
      block.type === "tool" &&
      block.userRequest?.request.requestId === payload.resolution.requestId
        ? {
            ...block,
            state: "running" as const,
            userRequest: {
              ...block.userRequest,
              resolution: payload.resolution,
            },
          }
        : block,
    );
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "run.failed" || payload.type === "run.cancelled") {
    const reason =
      payload.type === "run.failed"
        ? t("threadAgentRunFailed").replace("{message}", payload.message)
        : t("threadAgentRunCancelled");
    return {
      ...snapshot,
      messages: terminalizeActiveTools(messages, reason),
      isRunning: false,
      isCompacting: false,
      toolApprovalMode: "manual",
    };
  }
  if (payload.type === "session.idle") {
    return {
      ...snapshot,
      messages: terminalizeActiveTools(
        messages,
        t("threadAgentRunEndedBeforeToolCompleted"),
      ),
      isRunning: false,
      isCompacting: false,
      toolApprovalMode: "manual",
    };
  }
  if (payload.type === "run.started") {
    return {
      ...snapshot,
      isRunning: true,
      compactionTrigger: undefined,
      compactionError: undefined,
    };
  }
  return snapshot;
}

function ThinkingBlock({ text }: { text: string }) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      className="mt-4 border-b border-[#e4e4df] pb-3 dark:border-border"
      data-thread-search-exclude
    >
      <div>
        <button
          aria-expanded={expanded}
          aria-label={t("threadDeepThinking")}
          className="group flex min-h-8 w-full cursor-pointer items-center gap-2 text-left select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setExpanded((value) => !value)}
          title={t("threadDeepThinking")}
          type="button"
        >
          <img
            alt=""
            className="h-4 w-4 shrink-0 object-contain"
            draggable={false}
            src={thinkingIcon}
          />
          <span className="text-[12px] font-semibold text-[#5a6250] dark:text-[#c3cbb4]">
            {t("threadDeepThinking")}
          </span>
          <ChevronDown
            aria-hidden
            className={`h-3.5 w-3.5 text-[#89957a] transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {expanded ? (
          <div className="message-markdown-reasoning mt-2 text-[12px] leading-5 text-[#74746d] dark:text-muted-foreground">
            <MessageMarkdown text={text} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PlanModePanel({
  mode,
  state,
}: {
  mode: "planning" | "executing";
  state?: Record<string, unknown>;
}) {
  const { t } = usePreferences();
  const plan = Array.isArray(state?.plan)
    ? state.plan.flatMap((item) => {
        const value = asObject(item);
        if (
          typeof value?.id !== "string" ||
          typeof value.title !== "string" ||
          typeof value.detail !== "string"
        )
          return [];
        return [
          {
            id: value.id,
            title: value.title,
            detail: value.detail,
            status:
              value.status === "completed" || value.status === "in-progress"
                ? value.status
                : "pending",
          },
        ];
      })
    : [];
  return (
    <section className="mt-4 border-l-2 border-[#ccf257] pl-3.5 dark:border-[#819d4d]">
      <div className="flex items-center gap-2">
        <p className="text-[12px] font-semibold text-[#454540] dark:text-foreground">
          {mode === "planning" ? t("executePlan") : t("executingPlan")}
        </p>
        <span className="font-mono text-[10px] text-[#8d8d86] dark:text-muted-foreground">
          {plan.length} {t("steps")}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-[#777770] dark:text-muted-foreground">
        {t("planDescription")}
      </p>
      {plan.length > 0 ? (
        <ol className="mt-3 space-y-2.5">
          {plan.map((item, index) => {
            const done = item.status === "completed";
            const active = item.status === "in-progress";
            const stepIndex = String(index + 1).padStart(2, "0");
            return (
              <li className="flex gap-3" key={item.id}>
                <span
                  className={`mt-0.5 font-mono text-[10px] ${done ? "text-[#759344]" : active ? "text-[#3d3d38] dark:text-foreground" : "text-[#ababa3]"}`}
                >
                  {done ? "✓" : stepIndex}
                </span>
                <div>
                  <p
                    className={`text-[12px] font-medium ${item.status === "pending" ? "text-[#777770] dark:text-muted-foreground" : "text-[#3c3c37] dark:text-foreground"}`}
                  >
                    {item.title}
                    {active ? (
                      <span className="ml-2 font-mono text-[9px] text-[#759344]">
                        {t("inProgress")}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#8c8c85] dark:text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-[12px] text-[#8c8c85] dark:text-muted-foreground">
          {t("planWillAppear")}
        </p>
      )}
    </section>
  );
}

function ContextCompactionActivity({
  compaction,
}: {
  compaction: ContextCompactionRecord;
}) {
  const { t } = usePreferences();
  const title =
    compaction.trigger === "overflow"
      ? t("contextCompactedOverflow")
      : compaction.trigger === "automatic"
        ? t("contextCompactedAutomatic")
        : t("contextCompactedManual");
  const tokenSummary =
    compaction.tokensAfter > 0
      ? `${formatTokenCount(compaction.tokensBefore)} -> ${formatTokenCount(compaction.tokensAfter)} tokens`
      : t("contextTokens").replace(
          "{tokens}",
          formatTokenCount(compaction.tokensBefore),
        );
  return (
    <details className="group w-full min-w-0 max-w-full overflow-hidden border-y border-[#d7e5c4] bg-[#f5f9ed] text-[#586b3d] dark:border-[#4b6036] dark:bg-[#26301f] dark:text-[#c9dfa3]">
      <summary className="flex min-h-10 min-w-0 max-w-full cursor-pointer list-none items-center gap-2.5 overflow-hidden px-3 py-2.5 outline-none transition-colors hover:bg-[#eef5e2] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-[#303d27]">
        <Archive className="h-3.5 w-3.5 shrink-0 text-[#718b46] dark:text-[#b9d77d]" />
        <span className="min-w-0 truncate text-[11px] font-semibold">
          {title}
        </span>
        <span className="min-w-0 truncate font-mono text-[9px] text-[#82906e] dark:text-[#9eaf8b]">
          {tokenSummary}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[9px] text-[#99a28c] dark:text-[#8f9d82]">
          {new Date(compaction.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 text-[#849272] transition-transform duration-150 group-open:rotate-180 dark:text-[#9aaa8d]"
        />
      </summary>
      <div className="min-w-0 max-w-full overflow-hidden border-t border-[#dce8cc] px-3 pb-3 pt-2.5 dark:border-[#46583a]">
        <p
          className="mb-2 min-w-0 truncate font-mono text-[9px] text-[#7f8d6c] dark:text-[#9cab8f]"
          title={compaction.model.modelId}
        >
          {compaction.model.modelId}
        </p>
        <div className="context-compaction-summary min-w-0 max-w-full overflow-hidden text-[12px] leading-5 text-[#5d694d] dark:text-[#c1cfb2]">
          <MessageMarkdown text={compaction.summary} />
        </div>
      </div>
    </details>
  );
}

function ContextCompactionPending({
  trigger,
}: {
  trigger?: ContextCompactionRecord["trigger"];
}) {
  const { t } = usePreferences();
  return (
    <div className="flex items-center gap-2 border-y border-[#e4e4df] bg-[#fafaf8] px-3 py-2.5 text-[11px] text-[#696962] dark:border-border dark:bg-muted/30 dark:text-muted-foreground">
      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#738a44] dark:text-[#c2df6b]" />
      <span>
        {trigger === "overflow"
          ? t("compactingContextOverflow")
          : t("compactingContext")}
      </span>
    </div>
  );
}

function ContextCompactionFailure({
  message,
  onRetry,
  trigger,
}: {
  message: string;
  onRetry: () => void;
  trigger?: ContextCompactionRecord["trigger"];
}) {
  const { t } = usePreferences();
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-[#ead5cf] bg-[#fdf8f6] px-3 py-2.5 text-[11px] text-[#8d5448] dark:border-[#5c3d36] dark:bg-[#2b201d] dark:text-[#efb0a3]">
      <CircleAlert className="h-3.5 w-3.5" />
      <span className="font-medium">
        {trigger === "overflow"
          ? t("contextOverflowRecoveryFailed")
          : t("contextCompactionFailed")}
      </span>
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
      {trigger !== "overflow" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t("retryCompaction")}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border border-[#d9bbb3] hover:bg-[#f7ece8] dark:border-[#754b43] dark:hover:bg-[#392724]"
              onClick={onRetry}
              type="button"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("retryCompaction")}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function compactionFailureMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^AgentHarnessError:\s*/i, "")
    .trim();
}

function AssistantMessageBlocks({
  clarificationHandoffAvailable,
  continuesPreviousToolSequence = false,
  message,
  onEnableAutoApprove,
  onHandoffClarification,
  onLoadToolOutput,
  onOpenResearchTask,
  onResolveApproval,
  onResolveClarificationQuestion,
  onResolveUserRequest,
  canPlan,
  workbenchId,
}: {
  clarificationHandoffAvailable: boolean;
  continuesPreviousToolSequence?: boolean;
  message: ConversationMessage;
  onEnableAutoApprove?: () => Promise<void>;
  onHandoffClarification: (
    interactionMode: "default" | "clarify" | "plan",
  ) => Promise<void>;
  onLoadToolOutput: (callId: string) => Promise<void>;
  onOpenResearchTask?: (selection: ResearchTaskSelection) => void;
  onResolveApproval: (
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => void;
  onResolveClarificationQuestion: (
    callId: string,
    value: string | boolean,
  ) => Promise<void>;
  onResolveUserRequest: (
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, UserRequestAnswer>;
      feedback?: string;
    },
  ) => void;
  canPlan: boolean;
  workbenchId: WorkbenchId;
}) {
  const rendered: ReactNode[] = [];
  let firstToolGroup = true;
  for (let index = 0; index < message.blocks.length; index += 1) {
    const block = message.blocks[index]!;
    if (block.type === "tool") {
      const tools: MessageToolBlock[] = [];
      while (message.blocks[index]?.type === "tool") {
        tools.push(message.blocks[index] as MessageToolBlock);
        index += 1;
      }
      index -= 1;
      const joinsPreviousToolGroup =
        firstToolGroup && continuesPreviousToolSequence;
      firstToolGroup = false;
      let dividerAbove = joinsPreviousToolGroup;
      for (let i = index - tools.length; i >= 0; i -= 1) {
        const type = message.blocks[i]?.type;
        if (type === "tool" || type === "reasoning") {
          dividerAbove = true;
          break;
        }
        if (type !== "text") break;
      }
      rendered.push(
        <div
          className={`${joinsPreviousToolGroup ? "mt-0" : "mt-4"} divide-y divide-[#e7e7e2] border-[#e7e7e2] dark:divide-border dark:border-border ${dividerAbove ? "border-b" : "border-y"}`}
          data-thread-search-exclude
          key={`tools-${tools[0]?.callId}`}
        >
          {(() => {
            const researchGroups = groupResearchDelegationBlocks(
              tools.filter((tool) => tool.name === "research_delegate"),
            );
            const groupByAnalysisId = new Map(
              researchGroups.map((group) => [group.details.analysisId, group]),
            );
            const renderedResearch = new Set<string>();
            return tools.flatMap((tool) => {
              if (tool.name !== "research_delegate") {
                const ToolActivity = workbenchRendererRegistry.resolveTool(
                  workbenchId,
                  tool.name,
                );
                return [
                  <ToolActivity
                    block={tool}
                    canPlan={canPlan}
                    clarificationHandoffAvailable={
                      clarificationHandoffAvailable
                    }
                    key={tool.callId}
                    onEnableAutoApprove={onEnableAutoApprove}
                    onHandoffClarification={onHandoffClarification}
                    onLoadToolOutput={onLoadToolOutput}
                    onOpenResearchTask={onOpenResearchTask}
                    onResolveApproval={onResolveApproval}
                    onResolveClarificationQuestion={
                      onResolveClarificationQuestion
                    }
                    onResolveUserRequest={onResolveUserRequest}
                  />,
                ];
              }
              const group = groupByAnalysisId.get(
                groupResearchDelegationBlocks([tool])[0]?.details.analysisId ??
                  "",
              );
              if (!group || renderedResearch.has(group.details.analysisId))
                return [];
              renderedResearch.add(group.details.analysisId);
              const ToolActivity = workbenchRendererRegistry.resolveTool(
                workbenchId,
                tool.name,
              );
              return [
                <ToolActivity
                  block={{ ...group.block, details: group.details }}
                  canPlan={canPlan}
                  clarificationHandoffAvailable={clarificationHandoffAvailable}
                  key={`research-${group.details.analysisId}`}
                  onEnableAutoApprove={onEnableAutoApprove}
                  onHandoffClarification={onHandoffClarification}
                  onLoadToolOutput={onLoadToolOutput}
                  onOpenResearchTask={onOpenResearchTask}
                  onResolveApproval={onResolveApproval}
                  onResolveClarificationQuestion={
                    onResolveClarificationQuestion
                  }
                  onResolveUserRequest={onResolveUserRequest}
                  researchTaskCallIds={group.taskCallIds}
                />,
              ];
            });
          })()}
        </div>,
      );
      continue;
    }
    if (block.type === "text") {
      const followsReasoning = message.blocks[index - 1]?.type === "reasoning";
      rendered.push(
        <div
          className={followsReasoning ? "pt-3" : undefined}
          key={`text-${index}`}
        >
          <MessageMarkdown text={block.text} />
        </div>,
      );
    }
    if (block.type === "reasoning")
      rendered.push(
        <ThinkingBlock key={`reasoning-${index}`} text={block.text} />,
      );
    if (block.type === "artifact")
      rendered.push(
        <p
          className="mt-4 text-[13px] font-semibold text-[#59732d]"
          key={`artifact-${block.artifactId}`}
        >
          {block.name}
        </p>,
      );
  }
  return <>{rendered}</>;
}

function AssistantResponseError({ message }: { message: ConversationMessage }) {
  const { t } = usePreferences();
  if (message.status !== "error" || !message.errorMessage) return null;
  return (
    <div
      className="mt-4 flex items-start gap-2.5 border-y border-[#ead5cf] bg-[#fdf8f6] px-3 py-2.5 text-[#8d5448] dark:border-[#5c3d36] dark:bg-[#2b201d] dark:text-[#efb0a3]"
      data-thread-search-exclude
      role="alert"
    >
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold">
          {t("assistantResponseFailed")}
        </p>
        <p className="mt-0.5 text-[10px] text-[#9e675b] dark:text-[#dca095]">
          {t("assistantResponseFailedHelp")}
        </p>
        <CollapsibleResponseError
          contentKey={message.id}
          text={message.errorMessage}
        />
      </div>
    </div>
  );
}

function CollapsibleResponseError({
  contentKey,
  text,
}: {
  contentKey: string;
  text: string;
}) {
  const { t } = usePreferences();
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const measure = useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    setTruncated(shouldCollapseResponseError(element.scrollHeight));
  }, []);

  useLayoutEffect(() => {
    setExpanded(false);
    measure();
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [contentKey, measure, text]);

  const label = expanded
    ? t("threadCollapseError")
    : t("threadShowErrorDetails");
  return (
    <div className="mt-2">
      <p
        className={`whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[#8d5448] dark:text-[#efb0a3] ${!expanded && truncated ? "overflow-hidden" : ""}`}
        ref={contentRef}
        style={
          !expanded && truncated
            ? { maxHeight: RESPONSE_ERROR_COLLAPSED_HEIGHT }
            : undefined
        }
      >
        {text}
      </p>
      {truncated ? (
        <div className="mt-1 flex justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-expanded={expanded}
                aria-label={label}
                className="grid h-5 w-5 place-items-center rounded-[4px] text-[#9e675b] hover:bg-[#f4e2dd] hover:text-[#743f35] dark:text-[#dca095] dark:hover:bg-[#4a2a25] dark:hover:text-[#ffd0c6]"
                onClick={() => setExpanded((value) => !value)}
                type="button"
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

function AssistantIdentityHeader({
  identity,
}: {
  identity?: Pick<ExpertCollaborationLeader, "name" | "portrait">;
}) {
  const { t } = usePreferences();
  return (
    <header className="flex h-7 items-center gap-3">
      {identity ? (
        <ExpertPortrait
          className="h-7 w-7 shrink-0"
          name={identity.name}
          portrait={identity.portrait}
        />
      ) : (
        <img
          alt=""
          className="h-7 w-7 shrink-0 rounded-[8px] object-cover"
          draggable={false}
          src={wordlessIcon}
        />
      )}
      <span className="text-[14px] font-semibold">
        {identity?.name ?? t("assistantName")}
      </span>
    </header>
  );
}

function AssistantRunStatus({
  activity,
  detail,
}: {
  activity: AssistantRunActivity;
  detail?: string;
}) {
  const { t } = usePreferences();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const updateAt = nextAssistantRunActivityUpdateAt(activity);
    if (updateAt === undefined) return;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, updateAt - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [activity]);

  const current = assistantRunActivityAt(activity, now);
  const waitingForUser =
    current.type === "awaiting-approval" ||
    current.type === "awaiting-user-input";
  const label =
    current.type === "thinking" ? (
      t("assistantThinking")
    ) : current.type === "waiting" ? (
      <>
        <span>{t("assistantWaitingForModel")}</span>
        <span aria-hidden="true"> · </span>
        <span>{t("assistantWaitingDetail")}</span>
      </>
    ) : current.type === "generating" ? (
      t("assistantGeneratingResponse")
    ) : current.type === "awaiting-approval" ? (
      t("assistantAwaitingApproval")
    ) : current.type === "awaiting-user-input" ? (
      t("assistantAwaitingUserInput")
    ) : current.type === "compacting-context" ? (
      t("assistantCompactingContext")
    ) : current.type === "tool-result" ? (
      current.outcome === "failure" ? (
        t("assistantToolFailedContinuing")
      ) : (
        t("assistantAnalyzingToolResult")
      )
    ) : current.tool === "read" ? (
      t("assistantReadingFiles")
    ) : current.tool === "search" ? (
      t("assistantSearchingWorkspace")
    ) : current.tool === "edit" ? (
      t("assistantEditingFile")
    ) : current.tool === "write" ? (
      t("assistantWritingFile")
    ) : current.tool === "command" ? (
      current.phase === "preparing" ? (
        t("assistantPreparingCommand")
      ) : (
        t("assistantRunningCommand")
      )
    ) : current.tool === "delegate" ? (
      t("assistantDelegatingTask")
    ) : current.tool === "skill" ? (
      t("assistantLoadingSkill")
    ) : current.tool === "connector" ? (
      t("assistantCallingConnector")
    ) : (
      t("assistantCallingTool")
    );

  return (
    <div className="mt-3 min-h-5 text-[12px] leading-5">
      <p
        className={
          waitingForUser
            ? "text-[#8b6932] dark:text-[#d6b878]"
            : "assistant-run-status-shimmer"
        }
      >
        {label}
        {detail ? <span className="text-[#92928b]"> · {detail}</span> : null}
      </p>
    </div>
  );
}

function AssistantRunPlaceholder({
  identity,
  presentation,
}: {
  identity?: Pick<ExpertCollaborationLeader, "name" | "portrait">;
  presentation: AssistantRunPresentation;
}) {
  return (
    <article>
      <AssistantIdentityHeader identity={identity} />
      <div className="mt-2">
        <AssistantRunStatus activity={presentation.activity} />
      </div>
    </article>
  );
}

function PlanResultActions({
  onResolve,
}: {
  onResolve: (action: "implement" | "stay") => Promise<void>;
}) {
  const { t } = usePreferences();
  const [pending, setPending] = useState<"implement" | "stay" | null>(null);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (resolved) return null;
  const resolve = async (action: "implement" | "stay") => {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      await onResolve(action);
      setResolved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(null);
    }
  };
  return (
    <div className="mt-3 border-l-2 border-[#a9bc70] bg-[#f7f9ef] px-3 py-2 dark:border-[#9fba55] dark:bg-[#28321d]">
      <div className="flex flex-wrap gap-1">
        <button
          className="h-6 rounded-[5px] bg-[#252624] px-2 text-[10px] font-semibold text-white hover:bg-[#3a3b37] disabled:opacity-50 dark:bg-[#d9f37a] dark:text-[#252624] dark:hover:bg-[#e4f99c]"
          disabled={pending !== null}
          onClick={() => void resolve("implement")}
          type="button"
        >
          {pending === "implement" ? "..." : t("implementPlan")}
        </button>
        <button
          className="h-6 rounded-[5px] border border-[#b7c98b] bg-white px-2 text-[10px] font-medium text-[#53652d] hover:bg-[#eef4dc] disabled:opacity-50 dark:border-[#718b43] dark:bg-[#202719] dark:text-[#d7ec9a] dark:hover:bg-[#354321]"
          disabled={pending !== null}
          onClick={() => void resolve("stay")}
          type="button"
        >
          {pending === "stay" ? "..." : t("stayInPlanMode")}
        </button>
      </div>
      {error ? (
        <p className="mt-1.5 text-[10px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AssistantMessageBody({
  assistantIdentity,
  messages,
  onEnableAutoApprove,
  onHandoffClarification,
  onLoadToolOutput,
  onOpenResearchTask,
  onResolveApproval,
  onResolveClarificationQuestion,
  onResolveUserRequest,
  onResolvePlanResult,
  canPlan,
  planMode,
  runPresentation,
  showFooter,
  workbenchId,
}: {
  assistantIdentity?: Pick<ExpertCollaborationLeader, "name" | "portrait">;
  messages: ConversationMessage[];
  onEnableAutoApprove?: () => Promise<void>;
  onHandoffClarification: (
    interactionMode: "default" | "clarify" | "plan",
  ) => Promise<void>;
  onLoadToolOutput: (callId: string) => Promise<void>;
  onOpenResearchTask?: (selection: ResearchTaskSelection) => void;
  onResolveApproval: (
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => void;
  onResolveClarificationQuestion: (
    callId: string,
    value: string | boolean,
  ) => Promise<void>;
  onResolveUserRequest: (
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, UserRequestAnswer>;
      feedback?: string;
    },
  ) => void;
  onResolvePlanResult: (action: "implement" | "stay") => Promise<void>;
  canPlan: boolean;
  planMode: "off" | "planning" | "executing";
  runPresentation: AssistantRunPresentation | null;
  showFooter: boolean;
  workbenchId: WorkbenchId;
}) {
  const { t } = usePreferences();
  const message = messages.at(-1)!;
  const blocks = useMemo(
    () => messages.flatMap((candidate) => candidate.blocks),
    [messages],
  );
  const toolSequenceContinuations = useMemo(
    () => assistantToolSequenceContinuations(messages),
    [messages],
  );
  const hasPendingInteraction = blocks.some(
    (block) =>
      block.type === "tool" &&
      (block.state === "awaiting-approval" ||
        block.state === "awaiting-user-input"),
  );
  const isStreaming = messages.some(
    (candidate) => candidate.status === "streaming",
  );
  const presentedAssistantMessageId =
    runPresentation?.assistantMessageId ?? null;
  const showRunStatus =
    presentedAssistantMessageId !== null &&
    messages.some((candidate) => candidate.id === presentedAssistantMessageId);
  return (
    <article>
      <AssistantIdentityHeader identity={assistantIdentity} />
      <div className="mt-2 min-w-0">
        {messages.map((candidate, index) => (
          <section
            className={`min-h-px outline-none focus-visible:ring-2 focus-visible:ring-ring ${index > 0 && !toolSequenceContinuations[index] ? "mt-5" : ""}`}
            data-thread-message-id={candidate.id}
            key={candidate.id}
            tabIndex={-1}
          >
            <AssistantMessageBlocks
              canPlan={canPlan}
              clarificationHandoffAvailable={
                showFooter &&
                !isStreaming &&
                !hasPendingInteraction &&
                candidate.id === message.id
              }
              continuesPreviousToolSequence={toolSequenceContinuations[index]}
              message={candidate}
              onEnableAutoApprove={onEnableAutoApprove}
              onHandoffClarification={onHandoffClarification}
              onLoadToolOutput={onLoadToolOutput}
              onOpenResearchTask={onOpenResearchTask}
              onResolveApproval={onResolveApproval}
              onResolveClarificationQuestion={onResolveClarificationQuestion}
              onResolveUserRequest={onResolveUserRequest}
              workbenchId={workbenchId}
            />
            <AssistantResponseError message={candidate} />
          </section>
        ))}
        {showRunStatus && runPresentation ? (
          <AssistantRunStatus activity={runPresentation.activity} />
        ) : null}
        {showFooter &&
        !isStreaming &&
        !hasPendingInteraction &&
        planMode === "planning" ? (
          <PlanResultActions onResolve={onResolvePlanResult} />
        ) : null}
        {showFooter && !isStreaming && !hasPendingInteraction ? (
          <div className="mt-4 flex items-center gap-2 text-[#898981]">
            <button
              aria-label={t("threadCopyResponse")}
              className="grid h-6 w-6 place-items-center rounded-[5px] hover:bg-[#efefeb] hover:text-[#454540]"
              onClick={() =>
                void navigator.clipboard.writeText(
                  blocks
                    .filter((block) => block.type === "text")
                    .map((block) => block.text)
                    .join("\n"),
                )
              }
              type="button"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <span className="ml-auto font-mono text-[11px] text-[#aaa9a1]">
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        ) : null}
      </div>
    </article>
  );
}

const USER_MESSAGE_COLLAPSED_HEIGHT = 72;

function CollapsibleUserMessage({
  children,
  contentKey,
}: {
  children: ReactNode;
  contentKey: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const measure = useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    setTruncated(element.scrollHeight > USER_MESSAGE_COLLAPSED_HEIGHT + 1);
  }, []);

  useLayoutEffect(() => {
    setExpanded(false);
    measure();
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [contentKey, measure]);

  return (
    <div>
      <div
        className={
          !expanded && truncated ? "max-h-[72px] overflow-hidden" : undefined
        }
        ref={contentRef}
      >
        {children}
      </div>
      {truncated ? (
        <div className="mt-1 flex justify-center">
          <button
            aria-expanded={expanded}
            className="flex h-5 items-center text-[10px] font-medium text-[#6d7f53] hover:text-[#45582f] dark:text-[#b8d98e] dark:hover:text-[#d6edaf]"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MessageBody({
  assistantIdentity,
  messages,
  onEnableAutoApprove,
  onHandoffClarification,
  onLoadToolOutput,
  onOpenResearchTask,
  onResolveApproval,
  onResolveClarificationQuestion,
  onResolveUserRequest,
  onResolvePlanResult,
  canPlan,
  isFirstMessage,
  planMode,
  runPresentation,
  showFooter,
  workbenchId,
}: {
  assistantIdentity?: Pick<ExpertCollaborationLeader, "name" | "portrait">;
  messages: ConversationMessage[];
  onEnableAutoApprove?: () => Promise<void>;
  onHandoffClarification: (
    interactionMode: "default" | "clarify" | "plan",
  ) => Promise<void>;
  onLoadToolOutput: (callId: string) => Promise<void>;
  onOpenResearchTask?: (selection: ResearchTaskSelection) => void;
  onResolveApproval: (
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => void;
  onResolveClarificationQuestion: (
    callId: string,
    value: string | boolean,
  ) => Promise<void>;
  onResolveUserRequest: (
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, UserRequestAnswer>;
      feedback?: string;
    },
  ) => void;
  onResolvePlanResult: (action: "implement" | "stay") => Promise<void>;
  canPlan: boolean;
  isFirstMessage: boolean;
  planMode: "off" | "planning" | "executing";
  runPresentation: AssistantRunPresentation | null;
  showFooter: boolean;
  workbenchId: WorkbenchId;
}) {
  const { t } = usePreferences();
  const message = messages[0]!;
  if (message.role === "user") {
    const contentBlocks = message.blocks.filter(
      (block) =>
        block.type === "text" ||
        block.type === "skill-reference" ||
        block.type === "workspace-reference" ||
        block.type === "artifact",
    );
    const attachments = message.blocks.filter(
      (block) => block.type === "attachment",
    );
    return (
      <div
        className={`group relative min-h-px ${isFirstMessage ? "pt-4" : "pt-8"} outline-none focus-visible:ring-2 focus-visible:ring-ring ${contentBlocks.length > 0 ? "pb-7" : ""}`}
        data-thread-message-id={message.id}
        tabIndex={-1}
      >
        <div className="ml-auto flex w-fit max-w-[88%] flex-col items-end sm:max-w-[560px]">
          {contentBlocks.length > 0 ? (
            <div className="w-fit max-w-full break-words rounded-[10px] bg-[#f0f0ed] px-3.5 py-2.5 text-[14px] leading-6 text-[#343431] dark:bg-muted dark:text-foreground">
              <CollapsibleUserMessage contentKey={message.id}>
                {contentBlocks.map((block, index) =>
                  block.type === "text" ? (
                    <span
                      className="whitespace-pre-wrap break-words"
                      key={`text-${index}`}
                    >
                      {block.text}
                    </span>
                  ) : block.type === "workspace-reference" ? (
                    <span
                      className="mx-1.5 inline-flex h-6 max-w-[230px] select-none items-center gap-1 rounded-[5px] border border-[#bed7cf] bg-[#eef8f5] px-1.5 align-bottom text-[13px] font-normal leading-4 text-[#34574d] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#3b675c] dark:bg-[#20332d] dark:text-[#c5e3d9]"
                      key={block.id}
                      title={block.path}
                    >
                      <FileTypeIcon
                        className="h-3 w-3 shrink-0 [&_svg]:h-3 [&_svg]:w-3"
                        kind={block.kind}
                        name={block.name}
                      />
                      <span className="min-w-0 truncate">{block.name}</span>
                    </span>
                  ) : block.type === "artifact" ? (
                    <span
                      className="mx-1.5 inline-flex h-6 max-w-[250px] select-none items-center gap-1 rounded-[5px] border border-[#b8d6cb] bg-[#edf8f4] px-1.5 align-bottom text-[13px] font-normal leading-4 text-[#345f53] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#416b5e] dark:bg-[#20372f] dark:text-[#bae2d3]"
                      key={`${block.artifactId}:${block.surfaceId ?? block.name}`}
                      title={block.locator ?? block.name}
                    >
                      <Layers3
                        aria-hidden
                        className="h-3 w-3 shrink-0 text-[#4f8b79] dark:text-[#9ccfbd]"
                      />
                      <span className="min-w-0 truncate">{block.name}</span>
                    </span>
                  ) : (
                    <span
                      className="mx-1.5 inline-flex h-6 max-w-[210px] select-none items-center gap-1 rounded-[5px] border border-[#deded9] bg-[#f8f8f6] px-1.5 align-bottom text-[13px] font-normal leading-4 text-[#45453f] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#4b4c45] dark:bg-[#2b2c27] dark:text-[#deded8]"
                      key={block.id}
                      title={block.name}
                    >
                      <span
                        aria-hidden
                        className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] bg-[#e6e7e1] text-[9px] font-semibold leading-none text-[#5b5c55] dark:bg-[#41423b] dark:text-[#d0d1c9]"
                      >
                        {skillIconText(block.name)}
                      </span>
                      <span className="min-w-0 truncate">{block.name}</span>
                    </span>
                  ),
                )}
              </CollapsibleUserMessage>
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="mt-1 flex w-fit max-w-full flex-wrap justify-end gap-1.5">
              {attachments.map((attachment) => (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-[5px] bg-[#f0f0ed] px-2 py-1 font-mono text-[11px] text-[#6d6d67] dark:bg-muted"
                  key={attachment.id}
                  title={attachment.name}
                >
                  <FileTypeIcon
                    className="h-3 w-3 shrink-0 [&_svg]:h-3 [&_svg]:w-3"
                    kind="file"
                    name={attachment.name}
                  />
                  <span className="min-w-0 truncate">{attachment.name}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {contentBlocks.length > 0 ? (
          <button
            aria-label={t("copyMessage")}
            className="pointer-events-none absolute bottom-0 right-0 grid h-6 w-6 place-items-center rounded-[5px] text-[#898981] opacity-0 transition-opacity hover:bg-[#efefeb] hover:text-[#454540] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-muted"
            onClick={() =>
              void navigator.clipboard.writeText(
                contentBlocks
                  .map((block) =>
                    block.type === "text" ? block.text : `@${block.name}`,
                  )
                  .join(""),
              )
            }
            title={t("copyMessage")}
            type="button"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <AssistantMessageBody
      assistantIdentity={assistantIdentity}
      canPlan={canPlan}
      messages={messages}
      onEnableAutoApprove={onEnableAutoApprove}
      onHandoffClarification={onHandoffClarification}
      onLoadToolOutput={onLoadToolOutput}
      onOpenResearchTask={onOpenResearchTask}
      onResolveApproval={onResolveApproval}
      onResolveClarificationQuestion={onResolveClarificationQuestion}
      onResolvePlanResult={onResolvePlanResult}
      onResolveUserRequest={onResolveUserRequest}
      planMode={planMode}
      runPresentation={runPresentation}
      showFooter={showFooter}
      workbenchId={workbenchId}
    />
  );
}

function createTimeline(
  snapshot: SessionSnapshot,
  runPresentation: AssistantRunPresentation | null,
): ThreadTimelineItem[] {
  return createThreadTimeline(
    snapshot.messages,
    snapshot.contextCompactions,
    runPresentation,
  );
}

function withPendingTurn(
  snapshot: SessionSnapshot,
  pendingTurn: PendingThreadTurn | null | undefined,
): SessionSnapshot {
  if (
    !pendingTurn ||
    snapshot.messages.some((message) => message.id === pendingTurn.message.id)
  )
    return snapshot;
  return {
    ...snapshot,
    messages: [...snapshot.messages, pendingTurn.message],
    isRunning: true,
  };
}

type LoadedHistory = {
  hasMoreAfter: boolean;
  hasMoreBefore: boolean;
  nextAfterCursor?: string;
  nextBeforeCursor?: string;
  revision: string;
  turnSummaries: SessionTurnSummary[];
};

function messagesFromHistoryPage(
  page: SessionHistoryPage,
): ConversationMessage[] {
  return page.items.flatMap((item) =>
    item.type === "turn" ? item.turn.messages : [],
  );
}

function userMessageHistory(
  messages: readonly ConversationMessage[],
): Array<{ id: string; parts: UserPromptPart[] }> {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    const parts = message.blocks.flatMap((block): UserPromptPart[] => {
      if (block.type === "text") return [{ type: "text", text: block.text }];
      if (block.type === "skill-reference")
        return [
          {
            type: "skill-reference",
            skillId: block.skillId,
            name: block.name,
            source: block.source,
          },
        ];
      if (block.type === "workspace-reference")
        return [
          {
            type: "workspace-reference",
            path: block.path,
            name: block.name,
            kind: block.kind,
          },
        ];
      return [];
    });
    return parts.length > 0 ? [{ id: message.id, parts }] : [];
  });
}

function compactionsFromHistoryPage(
  page: SessionHistoryPage,
): ContextCompactionRecord[] {
  return page.items.flatMap((item) =>
    item.type === "compaction" ? [item.compaction] : [],
  );
}

function snapshotFromSessionView(view: SessionViewSnapshot): SessionSnapshot {
  const messages = overlayExpertTaskRuns(
    messagesFromHistoryPage(view.history),
    view.extensions,
  );
  return {
    session: view.session,
    messages,
    contextUsage: view.contextUsage,
    turnUsage: view.turnUsage,
    contextCompactions: compactionsFromHistoryPage(view.history),
    isRunning: view.isRunning,
    isCompacting: view.isCompacting,
    compactionTrigger: view.compactionTrigger,
    compactionError: view.compactionError,
    extensions: view.extensions,
    toolApprovalMode: view.toolApprovalMode,
    expertCollaboration: view.expertCollaboration,
  };
}

function loadedHistoryFromView(view: SessionViewSnapshot): LoadedHistory {
  return {
    hasMoreAfter: view.history.hasMoreAfter,
    hasMoreBefore: view.history.hasMoreBefore,
    nextAfterCursor: view.history.nextAfterCursor,
    nextBeforeCursor: view.history.nextBeforeCursor,
    revision: view.history.revision,
    turnSummaries: view.turnSummaries,
  };
}

function mergeMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
): ConversationMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
}

type ExpertMemberActivityEvent = Extract<
  RuntimeEventEnvelope["event"],
  {
    type:
      | "expert-member.tool.started"
      | "expert-member.tool.updated"
      | "expert-member.tool.completed"
      | "expert-member.approval.requested"
      | "expert-member.approval.resolved";
  }
>;

function expertMemberMessagesCorrelate(
  canonical: ConversationMessage,
  live: ConversationMessage,
): boolean {
  if (canonical.id === live.id) return true;
  if (canonical.role !== live.role) return false;
  const canonicalCalls = new Set(
    canonical.blocks.flatMap((block) =>
      block.type === "tool" ? [block.callId] : [],
    ),
  );
  const liveCalls = live.blocks.flatMap((block) =>
    block.type === "tool" ? [block.callId] : [],
  );
  if (
    liveCalls.length > 0 &&
    liveCalls.every((callId) => canonicalCalls.has(callId))
  )
    return true;
  if (Math.abs(canonical.timestamp - live.timestamp) > 30_000) return false;
  const visibleContent = (message: ConversationMessage) => {
    const text = message.blocks
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n");
    if (text.length > 0) return text;
    return message.blocks
      .flatMap((block) =>
        block.type === "reasoning" ? [block.text] : [],
      )
      .join("\n");
  };
  const liveContent = visibleContent(live);
  return liveContent.length > 0 && visibleContent(canonical) === liveContent;
}

function applyExpertMemberActivity(
  messages: ConversationMessage[],
  event: ExpertMemberActivityEvent,
): ConversationMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (
      message.id !== event.messageId &&
      !message.blocks.some(
        (block) =>
          block.type === "tool" &&
          (event.type === "expert-member.approval.requested"
            ? block.callId === event.approval.callId
            : event.type === "expert-member.approval.resolved"
              ? block.approval?.approvalId === event.resolution.approvalId
              : block.callId === event.callId),
      )
    )
      return message;
    const callId =
      event.type === "expert-member.approval.requested"
        ? event.approval.callId
        : event.type === "expert-member.approval.resolved"
          ? undefined
          : event.callId;
    let found = false;
    let created = false;
    const blocks = message.blocks.map((block) => {
      if (block.type !== "tool") return block;
      if (
        event.type === "expert-member.approval.resolved"
          ? block.approval?.approvalId !== event.resolution.approvalId
          : block.callId !== callId
      )
        return block;
      found = true;
      changed = true;
      if (event.type === "expert-member.tool.started")
        return {
          ...block,
          name: event.name,
          input: event.input,
          state: "running" as const,
        };
      if (event.type === "expert-member.tool.updated")
        return {
          ...block,
          output: event.output,
          details: event.details,
          state: "running" as const,
        };
      if (event.type === "expert-member.tool.completed")
        return {
          ...block,
          output: event.output,
          details: event.details,
          state: event.isError ? ("error" as const) : ("complete" as const),
        };
      if (event.type === "expert-member.approval.requested")
        return {
          ...block,
          state: "awaiting-approval" as const,
          approval: { ...event.approval, status: "required" as const },
        };
      return {
        ...block,
        state: event.resolution.approved
          ? ("running" as const)
          : ("error" as const),
        approval: {
          ...block.approval!,
          status: event.resolution.approved
            ? ("approved" as const)
            : ("rejected" as const),
          feedback: event.resolution.feedback,
        },
      };
    });
    if (
      !found &&
      event.type === "expert-member.tool.started" &&
      message.id === event.messageId
    ) {
      changed = true;
      created = true;
      blocks.push({
        type: "tool",
        callId: event.callId,
        name: event.name,
        input: event.input,
        state: "running",
      });
    }
    return found || created ? { ...message, blocks } : message;
  });
  return changed ? next : messages;
}

function appendExpertMemberMessageDelta(
  message: ConversationMessage,
  messageId: string,
  type: "text" | "reasoning",
  delta: string,
): ConversationMessage {
  if (message.id !== messageId) return message;
  const blocks = [...message.blocks];
  const last = blocks.at(-1);
  if (last?.type === type)
    blocks[blocks.length - 1] = { ...last, text: last.text + delta };
  else blocks.push({ type, text: delta });
  return { ...message, blocks };
}

function mergeCompactions(
  current: ContextCompactionRecord[],
  incoming: ContextCompactionRecord[],
): ContextCompactionRecord[] {
  const compactions = new Map(
    current.map((compaction) => [compaction.id, compaction]),
  );
  for (const compaction of incoming) compactions.set(compaction.id, compaction);
  return [...compactions.values()].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
}

function applySearchHighlight(
  element: HTMLElement,
  matchText: string,
): () => void {
  const query = matchText.trim();
  if (!query) return () => {};
  const normalizedQuery = query.toLocaleLowerCase();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          "script, style, [data-thread-search-highlight], [data-thread-search-exclude]",
        )
      )
        return NodeFilter.FILTER_REJECT;
      return node.textContent?.toLocaleLowerCase().includes(normalizedQuery)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  const match = walker.nextNode();
  if (!match || match.nodeType !== Node.TEXT_NODE) return () => {};
  const text = match.textContent ?? "";
  const start = text.toLocaleLowerCase().indexOf(normalizedQuery);
  if (start === -1) return () => {};
  const mark = document.createElement("mark");
  mark.dataset.threadSearchHighlight = "true";
  mark.className =
    "rounded-[2px] bg-[#dfe9b7] px-0.5 text-inherit shadow-[inset_0_-1px_0_rgba(113,136,57,0.5)] dark:bg-[#687b39]";
  mark.textContent = text.slice(start, start + query.length);
  const fragment = document.createDocumentFragment();
  if (start > 0) fragment.append(document.createTextNode(text.slice(0, start)));
  fragment.append(mark);
  if (start + query.length < text.length)
    fragment.append(document.createTextNode(text.slice(start + query.length)));
  (match as Text).replaceWith(fragment);
  return () => {
    if (mark.isConnected)
      mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  };
}

function waitForScrollSettled(
  element: HTMLElement,
  reduceMotion: boolean,
  onSettled: () => void,
): () => void {
  let frame = 0;
  let cancelled = false;
  let stableFrames = 0;
  let attempts = 0;
  let previousTop = element.getBoundingClientRect().top;
  const check = () => {
    if (cancelled || !element.isConnected) return;
    const top = element.getBoundingClientRect().top;
    stableFrames = Math.abs(top - previousTop) < 0.5 ? stableFrames + 1 : 0;
    previousTop = top;
    if (reduceMotion || stableFrames >= 4 || attempts++ >= 120) {
      onSettled();
      return;
    }
    frame = window.requestAnimationFrame(check);
  };
  frame = window.requestAnimationFrame(check);
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}

export function ThreadView({
  artifactSelection,
  composerDraft,
  initialPendingTurn,
  messageNavigationTarget,
  onArtifactSelectionConsumed,
  onComposerDraftChange,
  onMessageNavigationConsumed,
  onOpenModels,
  onOpenResearchTask,
  onOpenSkillImport,
  onOpenSkills,
  pendingWorkspaceReferences,
  onPendingWorkspaceReferencesConsumed,
  sessionId,
}: ThreadViewProps) {
  const client = useRuntimeClient();
  const { snapshot: appSnapshot } = useRuntime();
  const { reduceMotion, t } = usePreferences();
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [history, setHistory] = useState<LoadedHistory | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(100_000);
  const [pendingNavigation, setPendingNavigation] = useState<{
    matchText?: string;
    messageId?: string;
    turnId: string;
  } | null>(null);
  const [virtualListVersion, setVirtualListVersion] = useState(0);
  const [runPresentation, setRunPresentation] =
    useState<AssistantRunPresentation | null>(null);
  const [selectedExpertMemberId, setSelectedExpertMemberId] = useState<
    string | null
  >(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const hydratedRef = useRef(false);
  const pendingEventsRef = useRef<RuntimeEventEnvelope[]>([]);
  const pendingTextEventsRef = useRef<RuntimeEventEnvelope[]>([]);
  const textFrameRef = useRef<number | null>(null);
  const lastSequenceRef = useRef<RunEventCursor | undefined>(undefined);
  const loadingBeforeRef = useRef(false);
  const loadingAfterRef = useRef(false);
  const navigationSequenceRef = useRef(0);
  const firstItemIndexRef = useRef(firstItemIndex);
  const searchHighlightCleanupRef = useRef<(() => void) | null>(null);
  const searchHighlightTimerRef = useRef<number | null>(null);
  const updateComposerDraft = useCallback(
    (draft: InlineSkillComposerValue) =>
      onComposerDraftChange(sessionId, draft),
    [onComposerDraftChange, sessionId],
  );

  const scrollToBottom = useCallback(
    (behavior: "auto" | "smooth" = "smooth") => {
      setIsAtBottom(true);
      const count = timelineRef.current.length;
      if (count > 0)
        virtuosoRef.current?.scrollToIndex({
          index: count - 1,
          align: "end",
          behavior,
        });
    },
    [],
  );

  const timeline = useMemo(
    () => (snapshot ? createTimeline(snapshot, runPresentation) : []),
    [runPresentation, snapshot],
  );
  const timelineRef = useRef<ThreadTimelineItem[]>([]);
  timelineRef.current = timeline;
  firstItemIndexRef.current = firstItemIndex;

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    setIsAtBottom((current) => (current === atBottom ? current : atBottom));
  }, []);

  const handleVisibleRangeChange = useCallback((range: ListRange) => {
    const middleReportedIndex =
      range.startIndex + Math.floor((range.endIndex - range.startIndex) / 2);
    const item =
      timelineRef.current[
        dataIndexFromReportedIndex(
          middleReportedIndex,
          firstItemIndexRef.current,
        )
      ];
    if (item?.type === "messages" || item?.type === "assistant-run")
      setActiveTurnId((current) =>
        current === item.turnId ? current : item.turnId,
      );
  }, []);

  useEffect(() => {
    setIsAtBottom(true);
    setActiveTurnId(null);
    setFirstItemIndex(100_000);
    if (searchHighlightTimerRef.current !== null)
      window.clearTimeout(searchHighlightTimerRef.current);
    searchHighlightTimerRef.current = null;
    searchHighlightCleanupRef.current?.();
    searchHighlightCleanupRef.current = null;
    setPendingNavigation(null);
    setVirtualListVersion(0);
    setHistory(null);
    setSnapshot(null);
    setRunPresentation(
      initialPendingTurn
        ? createAssistantRunPresentation(
            initialPendingTurn.message.id,
            initialPendingTurn.submission.submittedAt,
          )
        : null,
    );
    setSelectedExpertMemberId(null);
    hydratedRef.current = false;
    pendingEventsRef.current = [];
    pendingTextEventsRef.current = [];
    if (textFrameRef.current !== null)
      window.cancelAnimationFrame(textFrameRef.current);
    textFrameRef.current = null;
    lastSequenceRef.current = undefined;
    navigationSequenceRef.current += 1;
    const cached = sessionViewCache.get(sessionId);
    if (cached) {
      setSnapshot(
        withPendingTurn(snapshotFromSessionView(cached), initialPendingTurn),
      );
      setHistory(loadedHistoryFromView(cached));
      setFirstItemIndex(100_000 - threadTimelineItemCount(cached.history));
    }
    let active = true;
    const updateRunPresentation = (event: RuntimeEventEnvelope) => {
      setSnapshot((current) =>
        current ? applyEvent(current, event, t) : current,
      );
      setRunPresentation((current) => {
        const next = advanceAssistantRunPresentation(current, event);
        if (
          event.event.type === "run.failed" ||
          event.event.type === "run.cancelled" ||
          event.event.type === "session.idle"
        )
          return null;
        return next;
      });
    };
    const flushTextEvents = () => {
      textFrameRef.current = null;
      const events = pendingTextEventsRef.current;
      pendingTextEventsRef.current = [];
      if (events.length === 0) return;
      setSnapshot((current) => {
        let next = current;
        for (const event of events)
          next = next ? applyEvent(next, event, t) : next;
        return next;
      });
      const last = events.at(-1);
      if (last)
        setRunPresentation((current) =>
          advanceAssistantRunPresentation(current, last),
        );
    };
    const applyRuntimeEvent = (event: RuntimeEventEnvelope) => {
      if (isExpertMemberMessageEvent(event)) return;
      if (!isNewerRunEvent(event, lastSequenceRef.current)) return;
      lastSequenceRef.current = runEventCursor(event);
      if (
        event.event.type === "message.text.delta" ||
        event.event.type === "message.reasoning.delta"
      ) {
        pendingTextEventsRef.current.push(event);
        if (textFrameRef.current === null)
          textFrameRef.current = window.requestAnimationFrame(flushTextEvents);
        return;
      }
      if (textFrameRef.current !== null) {
        window.cancelAnimationFrame(textFrameRef.current);
        flushTextEvents();
      }
      updateRunPresentation(event);
      if (event.event.type === "session.idle") {
        void client
          .getSessionView(sessionId)
          .then((view) => {
            if (!active) return;
            rememberSessionView(view);
            setSnapshot((current) =>
              current && current.session.id === sessionId
                ? {
                    ...current,
                    session: view.session,
                    contextUsage: view.contextUsage,
                    turnUsage: view.turnUsage,
                    isRunning: view.isRunning,
                    isCompacting: view.isCompacting,
                    compactionTrigger: view.compactionTrigger,
                    compactionError:
                      view.compactionError ?? current.compactionError,
                    extensions: view.extensions,
                    toolApprovalMode: view.toolApprovalMode,
                    expertCollaboration: view.expertCollaboration,
                  }
                : snapshotFromSessionView(view),
            );
            setHistory(loadedHistoryFromView(view));
          })
          .catch(() => {});
      }
    };
    const unsubscribe = client.subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      if (isExpertMemberMessageEvent(event)) return;
      if (!hydratedRef.current) pendingEventsRef.current.push(event);
      else applyRuntimeEvent(event);
    });
    void client
      .getSessionView(sessionId)
      .then((view) => {
        if (!active) return;
        rememberSessionView(view);
        const pendingEvents = pendingEventsRef.current;
        pendingEventsRef.current = [];
        setSnapshot(() => {
          let current = withPendingTurn(
            snapshotFromSessionView(view),
            initialPendingTurn,
          );
          for (const event of pendingEvents) {
            if (!isNewerRunEvent(event, lastSequenceRef.current)) continue;
            lastSequenceRef.current = runEventCursor(event);
            current = applyEvent(current, event, t);
          }
          return current;
        });
        setHistory(loadedHistoryFromView(view));
        setFirstItemIndex(100_000 - threadTimelineItemCount(view.history));
        setRunPresentation((current) => {
          const persistedMessages = messagesFromHistoryPage(view.history);
          const initialTurnFinished =
            !view.isRunning &&
            initialPendingTurn !== null &&
            initialPendingTurn !== undefined &&
            persistedMessages.some(
              (message) => message.id === initialPendingTurn.message.id,
            );
          let presentation = initialTurnFinished
            ? null
            : (current ??
              (view.isRunning
                ? assistantRunPresentationFromMessages(
                    persistedMessages,
                    Date.now(),
                  )
                : null));
          for (const event of pendingEvents) {
            if (
              event.event.type === "run.failed" ||
              event.event.type === "run.cancelled" ||
              event.event.type === "session.idle"
            )
              presentation = null;
            else
              presentation = advanceAssistantRunPresentation(
                presentation,
                event,
              );
          }
          return presentation;
        });
        hydratedRef.current = true;
      })
      .catch(() => {
        if (!active) return;
        hydratedRef.current = true;
        for (const event of pendingEventsRef.current) applyRuntimeEvent(event);
        pendingEventsRef.current = [];
      });
    return () => {
      active = false;
      if (textFrameRef.current !== null)
        window.cancelAnimationFrame(textFrameRef.current);
      textFrameRef.current = null;
      unsubscribe();
    };
  }, [client, sessionId, t]);

  useEffect(() => {
    if (!pendingNavigation) return;
    const index = timeline.findIndex(
      (item) =>
        item.type === "messages" &&
        `turn:${item.messages[0]!.id}` === pendingNavigation.turnId,
    );
    if (index === -1) return;
    setIsAtBottom(false);
    setActiveTurnId(pendingNavigation.turnId);
    virtuosoRef.current?.scrollToIndex({
      index,
      align: "start",
      behavior: reduceMotion ? "auto" : "smooth",
    });
    if (!pendingNavigation.messageId) {
      setPendingNavigation(null);
      return;
    }
    const messageId = pendingNavigation.messageId;
    const matchText = pendingNavigation.matchText;
    let frame = 0;
    let attempts = 0;
    let cancelWaitForScroll = () => {};
    const focusMessage = () => {
      const element = document.querySelector<HTMLElement>(
        `[data-thread-message-id="${CSS.escape(messageId)}"]`,
      );
      if (!element && attempts++ < 20) {
        frame = window.requestAnimationFrame(focusMessage);
        return;
      }
      if (element) {
        element.scrollIntoView({
          block: "center",
          behavior: reduceMotion ? "auto" : "smooth",
        });
        element.focus({ preventScroll: true });
        cancelWaitForScroll = waitForScrollSettled(
          element,
          reduceMotion,
          () => {
            if (searchHighlightTimerRef.current !== null)
              window.clearTimeout(searchHighlightTimerRef.current);
            searchHighlightTimerRef.current = null;
            searchHighlightCleanupRef.current?.();
            const cleanup = matchText
              ? applySearchHighlight(element, matchText)
              : null;
            searchHighlightCleanupRef.current = cleanup;
            if (cleanup) {
              searchHighlightTimerRef.current = window.setTimeout(
                () => {
                  if (searchHighlightCleanupRef.current !== cleanup) return;
                  cleanup();
                  searchHighlightCleanupRef.current = null;
                  searchHighlightTimerRef.current = null;
                },
                reduceMotion ? 1_400 : 2_800,
              );
            }
            setPendingNavigation((current) =>
              current?.messageId === messageId ? null : current,
            );
          },
        );
        return;
      }
      setPendingNavigation((current) =>
        current?.messageId === messageId ? null : current,
      );
    };
    frame = window.requestAnimationFrame(focusMessage);
    return () => {
      window.cancelAnimationFrame(frame);
      cancelWaitForScroll();
    };
  }, [pendingNavigation, reduceMotion, timeline, virtualListVersion]);

  useEffect(() => {
    return () => {
      if (searchHighlightTimerRef.current !== null)
        window.clearTimeout(searchHighlightTimerRef.current);
      searchHighlightCleanupRef.current?.();
    };
  }, []);

  const currentModel = snapshot?.session.model ?? null;
  const currentEnabledModel = appSnapshot?.models.find(
    (model) =>
      model.connectionId === currentModel?.connectionId &&
      model.modelId === currentModel.modelId,
  );
  const planExtensionEnabled =
    appSnapshot?.extensions.configurations["wordless.plan-mode"]?.enabled ??
    false;
  const interactionMode = snapshot?.session.interactionMode ?? "default";
  const canPlan =
    planExtensionEnabled && snapshot?.session.driverId === "coding";
  const planMode = snapshot ? planModeFromSnapshot(snapshot) : "off";
  const modelLabel = useMemo(
    () => currentEnabledModel?.displayName ?? t("modelRequired"),
    [currentEnabledModel?.displayName, t],
  );
  const currentConnection = appSnapshot?.connections.find(
    (connection) => connection.id === currentModel?.connectionId,
  );
  const canPrompt =
    currentEnabledModel !== undefined &&
    currentConnection?.authStatus === "configured";
  const entry = appSnapshot?.entries.find(
    (candidate) => candidate.id === snapshot?.session.entryId,
  );
  const availableSkills =
    appSnapshot?.skills.skills.filter(
      (skill) =>
        skill.workspaceId === null ||
        skill.workspaceId === snapshot?.session.workspaceId,
    ) ?? [];
  const availableConnectors = appSnapshot?.connectors.connectors ?? [];
  const showDensityRail = (history?.turnSummaries.length ?? 0) >= 2;
  const selectedExpert = appSnapshot?.experts.find(
    (expert) =>
      expert.id === snapshot?.session.expertSelection?.id &&
      expert.kind === snapshot.session.expertSelection.kind,
  );
  const expertTasks = useMemo(
    () => expertTasksFromMessages(snapshot?.messages ?? []),
    [snapshot?.messages],
  );
  const expertCollaborationMembers = useMemo(
    () =>
      mergeExpertCollaborationMembers(
        snapshot?.expertCollaboration?.members ?? [],
        expertTasks,
      ),
    [expertTasks, snapshot?.expertCollaboration?.members],
  );
  const selectedExpertMember = expertCollaborationMembers.find(
    (member) => member.memberId === selectedExpertMemberId,
  );

  const send = async (parts: UserPromptPart[]) => {
    const submission = createUserMessageSubmission();
    const pendingTurn = createPendingThreadTurn(parts, submission);
    setSnapshot((current) =>
      current ? withPendingTurn(current, pendingTurn) : current,
    );
    setRunPresentation(
      createAssistantRunPresentation(
        submission.messageId,
        submission.submittedAt,
      ),
    );
    try {
      await client.promptSession(sessionId, parts, submission);
    } catch (cause) {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: current.messages.filter(
                (message) => message.id !== submission.messageId,
              ),
              isRunning: false,
            }
          : current,
      );
      setRunPresentation(null);
      throw cause;
    }
  };

  const selectModel = async (
    model: ModelReference,
    thinkingLevel?: Parameters<typeof client.setSessionModel>[2],
  ) => {
    await client.setSessionModel(sessionId, model, thinkingLevel);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) =>
      current
        ? { ...current, session: view.session }
        : snapshotFromSessionView(view),
    );
    setHistory(loadedHistoryFromView(view));
  };

  const setAccessLevel = async (accessLevel: "default" | "full") => {
    const session = await client.setSessionAccess(sessionId, accessLevel);
    setSnapshot((current) => (current ? { ...current, session } : current));
  };

  const setInteractionMode = async (
    nextMode: "default" | "clarify" | "plan",
  ) => {
    const session = await client.setSessionInteractionMode(sessionId, nextMode);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) =>
      current
        ? { ...current, session, extensions: view.extensions }
        : snapshotFromSessionView(view),
    );
    setHistory(loadedHistoryFromView(view));
  };

  const setToolApprovalMode = async (mode: ToolApprovalMode) => {
    await client.setSessionToolApprovalMode(sessionId, mode);
    setSnapshot((current) =>
      current ? { ...current, toolApprovalMode: mode } : current,
    );
  };

  const resolveClarificationQuestion = async (
    callId: string,
    value: string | boolean,
  ) => {
    // 1. 获取问题文本以便显示
    const question = snapshot?.messages
      .flatMap((message) => message.blocks)
      .find(
        (block): block is MessageToolBlock =>
          block.type === "tool" &&
          block.callId === callId &&
          block.name === "ask_clarifying_question",
      );

    const questionDetails = question ? asObject(question.details) : undefined;
    const clarificationQuestion = asObject(
      questionDetails?.clarificationQuestion,
    );
    const questionText =
      typeof clarificationQuestion?.question === "string"
        ? clarificationQuestion.question
        : t("threadClarificationQuestionFallback");

    // 2. 调用服务器端，获取 submission 信息
    const submission = await client.resolveClarificationQuestion(
      sessionId,
      callId,
      value,
    );

    // 3. 立即创建 pending turn（用户消息 + 运行状态）
    const displayValue =
      typeof value === "boolean"
        ? value
          ? t("threadYes")
          : t("threadNo")
        : value;
    const parts: UserPromptPart[] = [
      {
        type: "text",
        text: t("threadClarificationAnswer")
          .replace("{question}", questionText)
          .replace("{answer}", displayValue),
      },
    ];
    const pendingTurn = createPendingThreadTurn(parts, submission);

    // 4. 立即更新 UI（乐观更新）
    setSnapshot((current) =>
      current ? withPendingTurn(current, pendingTurn) : current,
    );
    setRunPresentation(
      createAssistantRunPresentation(
        submission.messageId,
        submission.submittedAt,
      ),
    );

    // 5. 稍后获取完整状态进行同步（保险措施）
    try {
      const view = await client.getSessionView(sessionId);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              session: view.session,
              messages: messagesFromHistoryPage(view.history),
              contextUsage: view.contextUsage,
              turnUsage: view.turnUsage,
              extensions: view.extensions,
            }
          : snapshotFromSessionView(view),
      );
      setHistory(loadedHistoryFromView(view));
    } catch (error) {
      // 错误处理：如果同步失败，至少乐观更新已经显示了
      console.error("Failed to sync after clarification answer:", error);
    }
  };

  const handoffClarification = async (
    nextMode: "default" | "clarify" | "plan",
  ) => {
    await client.handoffClarification(sessionId, nextMode);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) =>
      current
        ? {
            ...current,
            session: view.session,
            messages: messagesFromHistoryPage(view.history),
            contextUsage: view.contextUsage,
            turnUsage: view.turnUsage,
            extensions: view.extensions,
          }
        : snapshotFromSessionView(view),
    );
    setHistory(loadedHistoryFromView(view));
    if (nextMode === "default") {
      await send([
        {
          type: "text",
          text: "Implement the clarified list above. Follow the confirmed goals, constraints, and decisions, complete the work, and verify the result.",
        },
      ]);
    }
  };

  const setConnectors = async (connectorIds: string[]) => {
    await client.setSessionConnectors(sessionId, connectorIds);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) =>
      current
        ? { ...current, session: view.session, contextUsage: view.contextUsage }
        : snapshotFromSessionView(view),
    );
    setHistory(loadedHistoryFromView(view));
  };

  const setExpertSelection = async (
    selection: import("@wordless/domain").ExpertSelection | null,
  ) => {
    await client.setSessionExpert(sessionId, selection);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) =>
      current
        ? { ...current, session: view.session, contextUsage: view.contextUsage }
        : snapshotFromSessionView(view),
    );
    setHistory(loadedHistoryFromView(view));
  };

  const resolveApproval = async (
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => {
    await client.resolveOperationApproval(
      sessionId,
      approvalId,
      approved,
      feedback,
    );
  };

  const resolveUserRequest = async (
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, UserRequestAnswer>;
      feedback?: string;
    },
  ) => {
    await client.resolveUserRequest(sessionId, requestId, resolution);
  };

  const loadToolOutput = useCallback(
    async (callId: string) => {
      const output = await client.getSessionToolOutput(sessionId, callId);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((message) => ({
                ...message,
                blocks: message.blocks.map((block) =>
                  block.type === "tool" && block.callId === callId
                    ? { ...block, output, outputTruncated: undefined }
                    : block,
                ),
              })),
            }
          : current,
      );
    },
    [client, sessionId],
  );

  const setPlanMode = async (nextMode: "off" | "planning" | "executing") => {
    if (!snapshot) return;
    const currentState = snapshot.extensions.find(
      (item) => item.extensionId === "wordless.plan-mode",
    )?.state;
    const nextState = {
      mode: nextMode,
      plan: Array.isArray(currentState?.plan) ? currentState.plan : [],
    };
    if (snapshot.isRunning)
      await client.interactWithSessionExtension(
        sessionId,
        "wordless.plan-mode",
        "set-mode",
        nextMode,
      );
    else
      await client.setSessionExtensionState(
        sessionId,
        "wordless.plan-mode",
        nextState,
      );
    setSnapshot((current) =>
      current
        ? {
            ...current,
            extensions: [
              ...current.extensions.filter(
                (item) => item.extensionId !== "wordless.plan-mode",
              ),
              {
                extensionId: "wordless.plan-mode",
                state: nextState,
                updatedAt: Date.now(),
              },
            ],
          }
        : current,
    );
  };

  const togglePlanMode = async () =>
    await setPlanMode(planMode === "off" ? "planning" : "off");

  const resolvePlanResult = async (action: "implement" | "stay") => {
    if (action === "stay") return;
    await setPlanMode("executing");
    await send([
      {
        type: "text",
        text: "Implement the approved plan above. Follow the plan, make the necessary changes, and verify the result.",
      },
    ]);
  };

  const compactContext = useCallback(async () => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            isCompacting: true,
            compactionTrigger: "manual",
            compactionError: undefined,
          }
        : current,
    );
    try {
      await client.compactSession(sessionId);
    } catch (cause) {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              isCompacting: false,
              compactionTrigger: "manual",
              compactionError: compactionFailureMessage(cause),
            }
          : current,
      );
    }
  }, [client, sessionId]);

  const loadOlder = useCallback(async () => {
    if (
      !history?.hasMoreBefore ||
      !history.nextBeforeCursor ||
      loadingBeforeRef.current
    )
      return;
    loadingBeforeRef.current = true;
    setIsAtBottom(false);
    try {
      const page = await client.getSessionHistoryPage(sessionId, {
        before: history.nextBeforeCursor,
        limit: 24,
      });
      const prependedItemCount = threadTimelineItemCount(page);
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: mergeMessages(
                current.messages,
                messagesFromHistoryPage(page),
              ),
              contextCompactions: mergeCompactions(
                current.contextCompactions,
                compactionsFromHistoryPage(page),
              ),
            }
          : current,
      );
      setHistory((current) =>
        current
          ? {
              ...current,
              hasMoreBefore: page.hasMoreBefore,
              nextBeforeCursor: page.nextBeforeCursor,
              revision: page.revision,
            }
          : current,
      );
      setFirstItemIndex((current) =>
        firstItemIndexAfterPrepend(current, prependedItemCount),
      );
    } finally {
      loadingBeforeRef.current = false;
    }
  }, [client, history, sessionId]);

  const loadNewer = useCallback(async () => {
    if (
      !history?.hasMoreAfter ||
      !history.nextAfterCursor ||
      loadingAfterRef.current
    )
      return;
    loadingAfterRef.current = true;
    try {
      const page = await client.getSessionHistoryPage(sessionId, {
        after: history.nextAfterCursor,
        limit: 24,
      });
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: mergeMessages(
                current.messages,
                messagesFromHistoryPage(page),
              ),
              contextCompactions: mergeCompactions(
                current.contextCompactions,
                compactionsFromHistoryPage(page),
              ),
            }
          : current,
      );
      setHistory((current) =>
        current
          ? {
              ...current,
              hasMoreAfter: page.hasMoreAfter,
              nextAfterCursor: page.nextAfterCursor,
              revision: page.revision,
            }
          : current,
      );
    } finally {
      loadingAfterRef.current = false;
    }
  }, [client, history, sessionId]);

  const navigateToTurn = useCallback(
    async (turnId: string, messageId?: string, matchText?: string) => {
      const sequence = ++navigationSequenceRef.current;
      const existing = timelineRef.current.findIndex(
        (item) =>
          item.type === "messages" && `turn:${item.messages[0]!.id}` === turnId,
      );
      setIsAtBottom(false);
      if (searchHighlightTimerRef.current !== null)
        window.clearTimeout(searchHighlightTimerRef.current);
      searchHighlightTimerRef.current = null;
      searchHighlightCleanupRef.current?.();
      searchHighlightCleanupRef.current = null;
      setPendingNavigation({ turnId, messageId, matchText });
      if (existing !== -1) {
        return;
      }
      const page = await client.getSessionHistoryPage(sessionId, {
        aroundTurnId: turnId,
        limit: 24,
      });
      if (sequence !== navigationSequenceRef.current) return;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              messages: messagesFromHistoryPage(page),
              contextCompactions: compactionsFromHistoryPage(page),
            }
          : current,
      );
      setHistory((current) =>
        current
          ? {
              ...current,
              hasMoreAfter: page.hasMoreAfter,
              hasMoreBefore: page.hasMoreBefore,
              nextAfterCursor: page.nextAfterCursor,
              nextBeforeCursor: page.nextBeforeCursor,
              revision: page.revision,
            }
          : current,
      );
      setFirstItemIndex(100_000 - threadTimelineItemCount(page));
      setVirtualListVersion((current) => current + 1);
    },
    [client, sessionId],
  );

  useEffect(() => {
    if (!messageNavigationTarget) return;
    if (messageNavigationTarget.sessionId !== sessionId) return;
    onMessageNavigationConsumed?.(messageNavigationTarget.requestId);
    void navigateToTurn(
      messageNavigationTarget.turnId,
      messageNavigationTarget.messageId,
      messageNavigationTarget.matchText,
    );
  }, [
    messageNavigationTarget,
    navigateToTurn,
    onMessageNavigationConsumed,
    sessionId,
  ]);

  const threadVirtuosoContext = useMemo<ThreadVirtuosoContext>(
    () => ({
      compactionError: snapshot?.compactionError,
      compactionTrigger: snapshot?.compactionTrigger,
      densityRail: showDensityRail,
      isCompacting: snapshot?.isCompacting ?? false,
      onRetryCompaction: compactContext,
      planMode:
        planExtensionEnabled && planMode !== "off" ? planMode : "off",
      planState: asObject(
        snapshot?.extensions.find(
          (item) => item.extensionId === "wordless.plan-mode",
        )?.state,
      ),
    }),
    [
      compactContext,
      planExtensionEnabled,
      planMode,
      showDensityRail,
      snapshot?.compactionError,
      snapshot?.compactionTrigger,
      snapshot?.extensions,
      snapshot?.isCompacting,
    ],
  );

  if (!snapshot || snapshot.session.id !== sessionId || !appSnapshot || !entry)
    return (
      <div className="grid min-h-0 flex-1 place-items-center text-[13px] text-muted-foreground">
        Loading session
      </div>
    );

  const composerUserMessageHistory = userMessageHistory(snapshot.messages);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {selectedExpertMember &&
        selectedExpert &&
        snapshot.expertCollaboration ? (
          <ExpertMemberStream
            densityRail={showDensityRail}
            expertName={selectedExpert.name}
            leadExpert={snapshot.expertCollaboration.leader}
            member={selectedExpertMember}
            onEnableAutoApprove={
              snapshot.toolApprovalMode === "manual"
                ? () => setToolApprovalMode("auto")
                : undefined
            }
            onResolveApproval={resolveApproval}
            sessionId={sessionId}
            workbenchId={snapshot.session.workbenchId}
          />
        ) : (
          <>
            <Virtuoso
              key={`${sessionId}:${virtualListVersion}`}
              atBottomStateChange={handleAtBottomStateChange}
              atBottomThreshold={24}
              className="h-full"
              components={THREAD_VIRTUOSO_COMPONENTS}
              computeItemKey={threadTimelineItemKey}
              context={threadVirtuosoContext}
              data={timeline}
              endReached={loadNewer}
              firstItemIndex={firstItemIndex}
              followOutput="auto"
              initialTopMostItemIndex={{ index: "LAST", align: "end" }}
              itemContent={(index, item) => {
                const dataIndex = dataIndexFromReportedIndex(
                  index,
                  firstItemIndex,
                );
                const followsCompaction =
                  timeline[dataIndex - 1]?.type === "compaction" &&
                  item.type !== "compaction";
                return (
                  <ThreadContentFrame
                    className={followsCompaction ? "pt-[26px]" : ""}
                    densityRail={showDensityRail}
                  >
                    {item.type === "compaction" ? (
                      <ContextCompactionActivity compaction={item.compaction} />
                    ) : item.type === "assistant-run" ? (
                      <AssistantRunPlaceholder
                        identity={snapshot.expertCollaboration?.leader}
                        presentation={item.presentation}
                      />
                    ) : (
                      <MessageBody
                        assistantIdentity={snapshot.expertCollaboration?.leader}
                        canPlan={canPlan}
                        isFirstMessage={
                          item.messages[0]?.id === snapshot.messages[0]?.id
                        }
                        messages={item.messages}
                        onEnableAutoApprove={
                          snapshot.toolApprovalMode === "manual"
                            ? () => setToolApprovalMode("auto")
                            : undefined
                        }
                        onHandoffClarification={handoffClarification}
                        onLoadToolOutput={loadToolOutput}
                        onOpenResearchTask={onOpenResearchTask}
                        onResolveApproval={resolveApproval}
                        onResolveClarificationQuestion={
                          resolveClarificationQuestion
                        }
                        onResolvePlanResult={resolvePlanResult}
                        onResolveUserRequest={resolveUserRequest}
                        planMode={planMode}
                        runPresentation={
                          runPresentation?.userMessageId &&
                          item.turnId ===
                            `turn:${runPresentation.userMessageId}`
                            ? runPresentation
                            : null
                        }
                        showFooter={
                          !snapshot.isRunning &&
                          index === firstItemIndex + timeline.length - 1
                        }
                        workbenchId={snapshot.session.workbenchId}
                      />
                    )}
                  </ThreadContentFrame>
                );
              }}
              rangeChanged={handleVisibleRangeChange}
              ref={virtuosoRef}
              startReached={loadOlder}
            />
            <ConversationDensityRail
              activeTurnId={activeTurnId}
              fallbackExcerpt={t("unnamedMessage")}
              navigationLabel={t("conversationNavigation")}
              onNavigate={(turnId) => void navigateToTurn(turnId)}
              summaries={history?.turnSummaries ?? []}
            />
            {!isAtBottom ? (
              <button
                aria-label={t("threadJumpToLatest")}
                className="absolute bottom-4 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-[#deded8] bg-white text-[#4d4d48] shadow-[0_4px_12px_rgba(0,0,0,0.10)] hover:bg-[#f5f5f2] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
                onClick={() => scrollToBottom()}
                type="button"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="bg-[var(--wordless-shell-workspace)] pb-3 pt-5">
        <ThreadContentFrame densityRail={showDensityRail}>
          {selectedExpert &&
          selectedExpert.kind === "team" &&
          snapshot.expertCollaboration ? (
            <ExpertCollaborationBar
              lead={snapshot.expertCollaboration.leader}
              members={expertCollaborationMembers}
              onSelectLead={() => setSelectedExpertMemberId(null)}
              onSelectMember={setSelectedExpertMemberId}
              selectedMemberId={selectedExpertMember?.memberId}
              teamName={snapshot.expertCollaboration.teamName}
            />
          ) : null}
          <div className="relative">
            <div
              aria-hidden={selectedExpertMember ? true : undefined}
              className={
                selectedExpertMember
                  ? "pointer-events-none select-none"
                  : undefined
              }
              inert={selectedExpertMember ? true : undefined}
            >
              <div className="relative">
                <Composer
                  key={sessionId}
                  accessLevel={snapshot.session.accessLevel}
                  compact
                  compacting={snapshot.isCompacting}
                  connectors={availableConnectors}
                  contextUsage={snapshot.contextUsage}
                  contextCompactionAvailable={snapshot.messages.length > 1}
                  canPlan={canPlan}
                  interactionMode={interactionMode}
                  modelLabel={modelLabel}
                  modelProviderAvatarId={currentConnection?.avatarId}
                  modelProviderId={currentModel?.connectionId}
                  onTogglePlanMode={
                    planExtensionEnabled
                      ? () => void togglePlanMode()
                      : undefined
                  }
                  onInteractionModeChange={(nextMode) => {
                    if (
                      nextMode === "clarify" &&
                      currentEnabledModel?.capabilities.supportsToolUse ===
                        false
                    ) {
                      setModelOpen(true);
                      return;
                    }
                    void setInteractionMode(nextMode);
                  }}
                  onOpenModelPicker={() => setModelOpen(true)}
                  onAccessLevelChange={setAccessLevel}
                  onToolApprovalModeChange={setToolApprovalMode}
                  toolApprovalMode={snapshot?.toolApprovalMode ?? "manual"}
                  onCompactContext={compactContext}
                  onConnectorIdsChange={setConnectors}
                  experts={
                    entry.id === "general-work"
                      ? (appSnapshot.experts ?? [])
                      : []
                  }
                  selectedExpertSelection={snapshot.session.expertSelection}
                  onExpertSelectionChange={async (selection) => {
                    if (entry.id !== "general-work" || snapshot.isRunning)
                      return;
                    await setExpertSelection(selection);
                  }}
                  showExpertPicker={entry.id === "general-work"}
                  onImportSkill={onOpenSkillImport}
                  onOpenSkills={onOpenSkills}
                  onSend={send}
                  artifactSelection={artifactSelection}
                  onArtifactSelectionConsumed={onArtifactSelectionConsumed}
                  pendingWorkspaceReferences={pendingWorkspaceReferences}
                  onPendingWorkspaceReferencesConsumed={
                    onPendingWorkspaceReferencesConsumed
                  }
                  searchWorkspaceReferences={
                    snapshot.session.workspaceId
                      ? (query) =>
                          client.searchSessionWorkspace(sessionId, query)
                      : undefined
                  }
                  workspaceSearchScope={
                    snapshot.session.workspaceId ? sessionId : "no-workspace"
                  }
                  onStop={() => client.cancelSession(sessionId)}
                  planMode={planMode}
                  running={snapshot.isRunning}
                  sendDisabled={
                    !canPrompt ||
                    (interactionMode === "clarify" &&
                      currentEnabledModel?.capabilities.supportsToolUse ===
                        false)
                  }
                  selectedConnectorIds={snapshot.session.connectorIds}
                  skillContextWindow={
                    currentEnabledModel?.capabilities.contextWindow
                  }
                  skills={availableSkills}
                  showWorkspacePicker={false}
                  showAccessControl={snapshot.session.workbenchId === "code"}
                  userMessageHistory={composerUserMessageHistory}
                  initialDraft={composerDraft}
                  onDraftChange={updateComposerDraft}
                />
                <ModelPicker
                  connections={appSnapshot.connections}
                  disabled={snapshot.isRunning}
                  entry={entry}
                  models={appSnapshot.models}
                  onConfigure={onOpenModels}
                  onOpenChange={setModelOpen}
                  onSelect={(connectionId, modelId, thinkingLevel) =>
                    selectModel({ connectionId, modelId }, thinkingLevel)
                  }
                  open={modelOpen}
                  selected={currentModel}
                  thinkingLevel={snapshot.session.thinkingLevel}
                />
              </div>
              <TurnTokenUsageRow usage={snapshot.turnUsage} />
              <p className="mt-2 text-center text-[11px] text-[#96968e] dark:text-muted-foreground">
                {t("aiContentNotice")}
              </p>
            </div>
            {selectedExpertMember ? (
              <button
                className="group absolute inset-0 z-20 flex items-center justify-center rounded-[10px] bg-white/85 text-[#55564f] backdrop-blur-[1px] transition-colors hover:bg-[#f7f8f3]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#171914]/85 dark:text-[#d4d8cc] dark:hover:bg-[#20241b]/90"
                onClick={() => setSelectedExpertMemberId(null)}
                type="button"
              >
                <span className="flex items-center gap-2 text-[12px] font-semibold">
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
                  {t("threadBackToMainConversation")}
                </span>
              </button>
            ) : null}
          </div>
        </ThreadContentFrame>
      </div>
    </div>
  );
}
