import { Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { Archive, ArrowDown, ChevronDown, ChevronUp, CircleAlert, Command, Copy, FileText, Folder, Layers3, LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ArtifactSelection, ConversationMessage, RuntimeEventEnvelope, SessionHistoryPage, SessionSnapshot, SessionTurnSummary, SessionViewSnapshot } from "@wordless/protocol";
import { calculateCurrentTurnUsage, type ContextCompactionRecord, type MessageToolBlock, type MessageUserRequest, type ModelReference, type ToolApprovalMode, type ToolOperationApproval, type UserPromptPart, type UserRequestAnswer, type WorkbenchId } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { ModelPicker } from "../workbench/ModelPicker";
import { workbenchRendererRegistry } from "../workbench/renderer-registry";
import { Composer } from "./Composer";
import type { InlineWorkspaceReferenceToken } from "./InlineSkillComposer";
import { ConversationDensityRail } from "./ConversationDensityRail";
import { createPendingThreadTurn, createUserMessageSubmission, type PendingThreadTurn } from "./pending-thread-turn";
import { createThreadTimeline, dataIndexFromReportedIndex, firstItemIndexAfterPrepend, threadTimelineItemCount, type ThreadTimelineItem } from "./thread-virtual-list";
import { advanceAssistantRunPresentation, assistantRunActivityAt, assistantRunPresentationFromMessages, createAssistantRunPresentation, isNewerRunEvent, mergeCompletedAssistantMessage, nextAssistantRunActivityUpdateAt, runEventCursor, type AssistantRunActivity, type AssistantRunPresentation, type RunEventCursor } from "./thread-run-state";
import { TurnTokenUsageRow } from "./TurnTokenUsageRow";
import { ThreadContentFrame } from "./ThreadContentFrame";
import { MessageMarkdown } from "./MessageMarkdown";
import wordlessIcon from "../../../icons/common-icons/wordless.png";

type ThreadViewProps = {
  artifactSelection?: ArtifactSelection | null;
  messageNavigationTarget?: ThreadMessageNavigationTarget | null;
  onArtifactSelectionConsumed?: () => void;
  onMessageNavigationConsumed?: (requestId: number) => void;
  pendingWorkspaceReferences: InlineWorkspaceReferenceToken[];
  onPendingWorkspaceReferencesConsumed: () => void;
  onOpenModels: () => void;
  onOpenSkillImport: () => void;
  onOpenSkills: () => void;
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

function rememberSessionView(view: SessionViewSnapshot): void {
  sessionViewCache.delete(view.session.id);
  sessionViewCache.set(view.session.id, view);
  while (sessionViewCache.size > SESSION_VIEW_CACHE_LIMIT) {
    const oldest = sessionViewCache.keys().next().value;
    if (!oldest) break;
    sessionViewCache.delete(oldest);
  }
}

function normalizeApproval(approval: ToolOperationApproval | undefined): ToolOperationApproval | undefined {
  if (!approval) return undefined;
  return {
    ...approval,
    severity: approval.severity === "high" ? "high" : "normal",
    matchedRules: Array.isArray(approval.matchedRules) ? approval.matchedRules : [],
  };
}

function approvalFromDetails(details: unknown, existing: ToolOperationApproval | undefined): ToolOperationApproval | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details) || !("approval" in details)) return normalizeApproval(existing);
  const approval = details.approval;
  if (typeof approval !== "object" || approval === null || Array.isArray(approval)) return normalizeApproval(existing);
  return normalizeApproval(approval as ToolOperationApproval);
}

function userRequestFromDetails(details: unknown, existing: MessageUserRequest | undefined): MessageUserRequest | undefined {
  if (typeof details !== "object" || details === null || Array.isArray(details) || !("userRequest" in details)) return existing;
  const userRequest = details.userRequest;
  if (typeof userRequest !== "object" || userRequest === null || Array.isArray(userRequest) || !("request" in userRequest)) return existing;
  const request = userRequest.request;
  if (typeof request !== "object" || request === null || Array.isArray(request) || !("requestId" in request) || typeof request.requestId !== "string") return existing;
  return userRequest as MessageUserRequest;
}

function formatTokenCount(value: number): string {
  if (value < 1_000) return value.toLocaleString();
  const compact = Math.round((value / 1_000) * 10) / 10;
  return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}k`;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function planModeFromSnapshot(snapshot: SessionSnapshot): "off" | "planning" | "executing" {
  const state = snapshot.extensions.find((item) => item.extensionId === "wordless.plan-mode")?.state;
  return state?.mode === "planning" || state?.mode === "executing" ? state.mode : "off";
}

function applyEvent(snapshot: SessionSnapshot, event: RuntimeEventEnvelope): SessionSnapshot {
  const messages = [...snapshot.messages];
  const payload = event.event;
  if (payload.type === "extension.event" && payload.event.type === "state.changed") {
    const state = asObject(payload.event.payload);
    if (typeof state?.extensionId !== "string" || typeof state.updatedAt !== "number" || !asObject(state.state)) return snapshot;
    const next = { extensionId: state.extensionId, updatedAt: state.updatedAt, state: asObject(state.state)! };
    const extensions = snapshot.extensions.filter((item) => item.extensionId !== next.extensionId);
    return { ...snapshot, extensions: [...extensions, next] };
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
    const contextCompactions = [...snapshot.contextCompactions.filter((item) => item.id !== payload.compaction.id), payload.compaction]
      .sort((left, right) => left.timestamp - right.timestamp);
    return { ...snapshot, contextCompactions, isCompacting: false, compactionTrigger: undefined, compactionError: undefined };
  }
  if (payload.type === "context.compaction.failed") {
    return { ...snapshot, isCompacting: false, compactionTrigger: payload.trigger, compactionError: payload.message };
  }
  if (payload.type === "message.started") {
    const existingIndex = messages.findIndex((message) => message.id === payload.message.id);
    if (existingIndex !== -1) {
      if (payload.message.role === "user") messages[existingIndex] = payload.message;
      return { ...snapshot, messages, isRunning: true };
    }
    const nextMessages = [...messages, payload.message];
    return { ...snapshot, messages: nextMessages, turnUsage: calculateCurrentTurnUsage(nextMessages) ?? snapshot.turnUsage, isRunning: true };
  }
  if (payload.type === "message.text.delta") {
    const index = messages.findIndex((message) => message.id === payload.messageId);
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = [...message.blocks];
    const last = blocks.at(-1);
    if (last?.type === "text") blocks[blocks.length - 1] = { type: "text", text: last.text + payload.delta };
    else blocks.push({ type: "text", text: payload.delta });
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "message.reasoning.delta") {
    const index = messages.findIndex((message) => message.id === payload.messageId);
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = [...message.blocks];
    const last = blocks.at(-1);
    if (last?.type === "reasoning") blocks[blocks.length - 1] = { type: "reasoning", text: last.text + payload.delta };
    else blocks.push({ type: "reasoning", text: payload.delta });
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "message.completed") {
    const index = messages.findIndex((message) => message.id === payload.message.id);
    if (index === -1) {
      const nextMessages = [...messages, payload.message];
      return { ...snapshot, messages: nextMessages, turnUsage: calculateCurrentTurnUsage(nextMessages) ?? snapshot.turnUsage };
    }
    const previous = messages[index]!;
    messages[index] = mergeCompletedAssistantMessage(previous, payload.message);
    return { ...snapshot, messages, turnUsage: calculateCurrentTurnUsage(messages) ?? snapshot.turnUsage };
  }
  if (payload.type === "tool.started" || payload.type === "tool.updated" || payload.type === "tool.completed") {
    const index = messages.findIndex((message) => message.id === payload.messageId);
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const existing = message.blocks.find((block): block is MessageToolBlock => block.type === "tool" && block.callId === payload.callId);
    const next: MessageToolBlock = payload.type === "tool.started"
      ? {
        type: "tool",
        callId: payload.callId,
        name: payload.name,
        input: payload.input,
        state: "running",
        startedAt: event.timestamp,
        ...(payload.name === "bash" ? { timeoutSeconds: typeof payload.input.timeout === "number" ? payload.input.timeout : 30 } : {}),
      }
      : {
        type: "tool",
        callId: payload.callId,
        name: existing?.name ?? "tool",
        startedAt: existing?.startedAt,
        timeoutSeconds: existing?.timeoutSeconds,
        input: existing?.input,
        output: payload.type === "tool.updated" ? `${existing?.output ?? ""}${payload.output}` : payload.output,
        details: payload.type === "tool.completed" ? payload.details : payload.type === "tool.updated" ? payload.details ?? existing?.details : existing?.details,
        usage: payload.usage ?? existing?.usage,
        approval: payload.type === "tool.completed" ? approvalFromDetails(payload.details, existing?.approval) : existing?.approval,
        userRequest: payload.type === "tool.completed" ? userRequestFromDetails(payload.details, existing?.userRequest) : existing?.userRequest,
        state: payload.type === "tool.completed" ? (payload.isError ? "error" : "complete") : "running",
      };
    const blocks = existing ? message.blocks.map((block) => block.type === "tool" && block.callId === payload.callId ? next : block) : [...message.blocks, next];
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, turnUsage: calculateCurrentTurnUsage(messages) ?? snapshot.turnUsage, isRunning: true };
  }
  if (payload.type === "approval.requested") {
    const index = messages.findIndex((message) => message.id === payload.messageId);
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) => block.type === "tool" && block.callId === payload.approval.callId
      ? { ...block, state: "awaiting-approval" as const, approval: { ...payload.approval, status: "required" as const } }
      : block);
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "approval.resolved") {
    const index = messages.findIndex((message) => message.id === payload.messageId);
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) => block.type === "tool" && block.approval?.approvalId === payload.resolution.approvalId
      ? {
          ...block,
          state: payload.resolution.approved ? "running" as const : "error" as const,
          approval: { ...block.approval, status: payload.resolution.approved ? "approved" as const : "rejected" as const, feedback: payload.resolution.feedback },
          ...(!payload.resolution.approved ? { output: payload.resolution.feedback ?? "Operation rejected by the user" } : {}),
        }
      : block);
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "user-request.requested") {
    const index = messages.findIndex((message) => message.id === payload.messageId);
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) => block.type === "tool" && block.callId === payload.request.callId
      ? { ...block, state: "awaiting-user-input" as const, userRequest: { request: payload.request } }
      : block);
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "user-request.resolved") {
    const index = messages.findIndex((message) => message.id === payload.messageId);
    if (index === -1) return snapshot;
    const message = messages[index]!;
    const blocks = message.blocks.map((block) => block.type === "tool" && block.userRequest?.request.requestId === payload.resolution.requestId
      ? { ...block, state: "running" as const, userRequest: { ...block.userRequest, resolution: payload.resolution } }
      : block);
    messages[index] = { ...message, blocks };
    return { ...snapshot, messages, isRunning: true };
  }
  if (payload.type === "session.idle") {
    return {
      ...snapshot,
      isRunning: false,
      isCompacting: false,
      toolApprovalMode: "manual",
    };
  }
  if (payload.type === "run.started") {
    return { ...snapshot, isRunning: true, compactionTrigger: undefined, compactionError: undefined };
  }
  return snapshot;
}

function ThinkingBlock({ text }: { text: string }) {
  return (
    <details className="mt-4 border-l-2 border-[#d9dfca] pl-3.5 dark:border-[#4c5939]" data-thread-search-exclude>
      <summary className="group flex w-fit cursor-pointer list-none items-center gap-1 select-none text-[13px] font-semibold text-[#5a6250] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden dark:text-[#c3cbb4]"><span>深度思考</span><ChevronDown aria-hidden className="h-3.5 w-3.5 text-[#89957a] transition-transform duration-150 group-open:rotate-180" /></summary>
      <div className="message-markdown-reasoning mt-2 text-[#74746d] dark:text-muted-foreground"><MessageMarkdown text={text} /></div>
    </details>
  );
}

function PlanModePanel({ snapshot, mode }: { snapshot: SessionSnapshot; mode: "planning" | "executing" }) {
  const { t } = usePreferences();
  const state = snapshot.extensions.find((item) => item.extensionId === "wordless.plan-mode")?.state;
  const plan = Array.isArray(state?.plan) ? state.plan.flatMap((item) => {
    const value = asObject(item);
    if (typeof value?.id !== "string" || typeof value.title !== "string" || typeof value.detail !== "string") return [];
    return [{ id: value.id, title: value.title, detail: value.detail, status: value.status === "completed" || value.status === "in-progress" ? value.status : "pending" }];
  }) : [];
  return (
    <section className="mt-4 border-l-2 border-[#ccf257] pl-3.5 dark:border-[#819d4d]">
      <div className="flex items-center gap-2"><p className="text-[12px] font-semibold text-[#454540] dark:text-foreground">{mode === "planning" ? t("executePlan") : t("executingPlan")}</p><span className="font-mono text-[10px] text-[#8d8d86] dark:text-muted-foreground">{plan.length} {t("steps")}</span></div>
      <p className="mt-1 text-[12px] leading-5 text-[#777770] dark:text-muted-foreground">{t("planDescription")}</p>
      {plan.length > 0 ? <ol className="mt-3 space-y-2.5">{plan.map((item, index) => {
        const done = item.status === "completed";
        const active = item.status === "in-progress";
        const stepIndex = String(index + 1).padStart(2, "0");
        return <li className="flex gap-3" key={item.id}><span className={`mt-0.5 font-mono text-[10px] ${done ? "text-[#759344]" : active ? "text-[#3d3d38] dark:text-foreground" : "text-[#ababa3]"}`}>{done ? "✓" : stepIndex}</span><div><p className={`text-[12px] font-medium ${item.status === "pending" ? "text-[#777770] dark:text-muted-foreground" : "text-[#3c3c37] dark:text-foreground"}`}>{item.title}{active ? <span className="ml-2 font-mono text-[9px] text-[#759344]">{t("inProgress")}</span> : null}</p><p className="mt-0.5 text-[11px] text-[#8c8c85] dark:text-muted-foreground">{item.detail}</p></div></li>;
      })}</ol> : <p className="mt-3 text-[12px] text-[#8c8c85] dark:text-muted-foreground">{t("planWillAppear")}</p>}
    </section>
  );
}

function ContextCompactionActivity({ compaction }: { compaction: ContextCompactionRecord }) {
  const { t } = usePreferences();
  const title = compaction.trigger === "overflow"
    ? t("contextCompactedOverflow")
    : compaction.trigger === "automatic" ? t("contextCompactedAutomatic") : t("contextCompactedManual");
  const tokenSummary = compaction.tokensAfter > 0
    ? `${formatTokenCount(compaction.tokensBefore)} -> ${formatTokenCount(compaction.tokensAfter)} tokens`
    : t("contextTokens").replace("{tokens}", formatTokenCount(compaction.tokensBefore));
  return (
    <details className="group border-y border-[#d7e5c4] bg-[#f5f9ed] text-[#586b3d] dark:border-[#4b6036] dark:bg-[#26301f] dark:text-[#c9dfa3]">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 outline-none transition-colors hover:bg-[#eef5e2] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-[#303d27]">
        <Archive className="h-3.5 w-3.5 shrink-0 text-[#718b46] dark:text-[#b9d77d]" />
        <span className="min-w-0 truncate text-[11px] font-semibold">{title}</span>
        <span className="min-w-0 truncate font-mono text-[9px] text-[#82906e] dark:text-[#9eaf8b]">{tokenSummary}</span>
        <span className="ml-auto shrink-0 font-mono text-[9px] text-[#99a28c] dark:text-[#8f9d82]">{new Date(compaction.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#849272] transition-transform duration-150 group-open:rotate-180 dark:text-[#9aaa8d]" />
      </summary>
      <div className="border-t border-[#dce8cc] px-3 pb-3 pt-2.5 dark:border-[#46583a]"><p className="mb-2 font-mono text-[9px] text-[#7f8d6c] dark:text-[#9cab8f]">{compaction.model.modelId}</p><div className="text-[12px] leading-5 text-[#5d694d] dark:text-[#c1cfb2]"><MessageMarkdown text={compaction.summary} /></div></div>
    </details>
  );
}

function ContextCompactionPending({ trigger }: { trigger?: ContextCompactionRecord["trigger"] }) {
  const { t } = usePreferences();
  return <div className="flex items-center gap-2 border-y border-[#e4e4df] bg-[#fafaf8] px-3 py-2.5 text-[11px] text-[#696962] dark:border-border dark:bg-muted/30 dark:text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#738a44] dark:text-[#c2df6b]" /><span>{trigger === "overflow" ? t("compactingContextOverflow") : t("compactingContext")}</span></div>;
}

function ContextCompactionFailure({ message, onRetry, trigger }: { message: string; onRetry: () => void; trigger?: ContextCompactionRecord["trigger"] }) {
  const { t } = usePreferences();
  return <div className="flex flex-wrap items-center gap-2 border-y border-[#ead5cf] bg-[#fdf8f6] px-3 py-2.5 text-[11px] text-[#8d5448] dark:border-[#5c3d36] dark:bg-[#2b201d] dark:text-[#efb0a3]"><CircleAlert className="h-3.5 w-3.5" /><span className="font-medium">{trigger === "overflow" ? t("contextOverflowRecoveryFailed") : t("contextCompactionFailed")}</span><span className="min-w-0 flex-1 truncate" title={message}>{message}</span>{trigger !== "overflow" ? <Tooltip><TooltipTrigger asChild><button aria-label={t("retryCompaction")} className="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border border-[#d9bbb3] hover:bg-[#f7ece8] dark:border-[#754b43] dark:hover:bg-[#392724]" onClick={onRetry} type="button"><RotateCcw className="h-3.5 w-3.5" /></button></TooltipTrigger><TooltipContent>{t("retryCompaction")}</TooltipContent></Tooltip> : null}</div>;
}

function compactionFailureMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^AgentHarnessError:\s*/i, "")
    .trim();
}

function AssistantMessageBlocks({ clarificationHandoffAvailable, message, onEnableAutoApprove, onHandoffClarification, onLoadToolOutput, onResolveApproval, onResolveClarificationQuestion, onResolveUserRequest, canPlan, workbenchId }: { clarificationHandoffAvailable: boolean; message: ConversationMessage; onEnableAutoApprove?: () => Promise<void>; onHandoffClarification: (interactionMode: "default" | "clarify" | "plan") => Promise<void>; onLoadToolOutput: (callId: string) => Promise<void>; onResolveApproval: (approvalId: string, approved: boolean, feedback?: string) => void; onResolveClarificationQuestion: (callId: string, value: string | boolean) => Promise<void>; onResolveUserRequest: (requestId: string, resolution: { status: "submitted" | "cancelled"; answers?: Record<string, UserRequestAnswer>; feedback?: string }) => void; canPlan: boolean; workbenchId: WorkbenchId }) {
  const rendered: ReactNode[] = [];
  for (let index = 0; index < message.blocks.length; index += 1) {
    const block = message.blocks[index]!;
    if (block.type === "tool") {
      const tools: MessageToolBlock[] = [];
      while (message.blocks[index]?.type === "tool") {
        tools.push(message.blocks[index] as MessageToolBlock);
        index += 1;
      }
      index -= 1;
      rendered.push(
        <div className="mt-4 divide-y divide-[#e7e7e2] border-y border-[#e7e7e2] dark:divide-border dark:border-border" data-thread-search-exclude key={`tools-${tools[0]?.callId}`}>
          {tools.map((tool) => {
            const ToolActivity = workbenchRendererRegistry.resolveTool(workbenchId, tool.name);
            return <ToolActivity block={tool} canPlan={canPlan} clarificationHandoffAvailable={clarificationHandoffAvailable} key={tool.callId} onEnableAutoApprove={onEnableAutoApprove} onHandoffClarification={onHandoffClarification} onLoadToolOutput={onLoadToolOutput} onResolveApproval={onResolveApproval} onResolveClarificationQuestion={onResolveClarificationQuestion} onResolveUserRequest={onResolveUserRequest} />;
          })}
        </div>,
      );
      continue;
    }
    if (block.type === "text") rendered.push(<MessageMarkdown key={`text-${index}`} text={block.text} />);
    if (block.type === "reasoning") rendered.push(<ThinkingBlock key={`reasoning-${index}`} text={block.text} />);
    if (block.type === "artifact") rendered.push(<p className="mt-4 text-[13px] font-semibold text-[#59732d]" key={`artifact-${block.artifactId}`}>{block.name}</p>);
  }
  return <>{rendered}</>;
}

function AssistantResponseError({ message }: { message: ConversationMessage }) {
  const { t } = usePreferences();
  if (message.status !== "error" || !message.errorMessage) return null;
  return (
    <div className="mt-4 flex items-start gap-2.5 border-y border-[#ead5cf] bg-[#fdf8f6] px-3 py-2.5 text-[#8d5448] dark:border-[#5c3d36] dark:bg-[#2b201d] dark:text-[#efb0a3]" data-thread-search-exclude role="alert">
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">{t("assistantResponseFailed")}</p>
        <p className="mt-0.5 text-[10px] text-[#9e675b] dark:text-[#dca095]">{t("assistantResponseFailedHelp")}</p>
        <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[#8d5448] dark:text-[#efb0a3]">{message.errorMessage}</p>
      </div>
    </div>
  );
}

function AssistantIdentityHeader() {
  const { t } = usePreferences();
  return <header className="flex h-7 items-center gap-3"><img alt="" className="h-7 w-7 shrink-0 rounded-[8px] object-cover" draggable={false} src={wordlessIcon} /><span className="text-[14px] font-semibold">{t("assistantName")}</span></header>;
}

function AssistantRunStatus({ activity }: { activity: AssistantRunActivity }) {
  const { t } = usePreferences();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const updateAt = nextAssistantRunActivityUpdateAt(activity);
    if (updateAt === undefined) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.max(0, updateAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [activity]);

  const current = assistantRunActivityAt(activity, now);
  const waitingForUser = current.type === "awaiting-approval" || current.type === "awaiting-user-input";
  const label = current.type === "thinking" ? t("assistantThinking")
    : current.type === "waiting" ? <><span>{t("assistantWaitingForModel")}</span><span aria-hidden="true"> · </span><span>{t("assistantWaitingDetail")}</span></>
      : current.type === "generating" ? t("assistantGeneratingResponse")
        : current.type === "awaiting-approval" ? t("assistantAwaitingApproval")
          : current.type === "awaiting-user-input" ? t("assistantAwaitingUserInput")
            : current.type === "compacting-context" ? t("assistantCompactingContext")
              : current.type === "tool-result" ? current.outcome === "failure" ? t("assistantToolFailedContinuing") : t("assistantAnalyzingToolResult")
                : current.tool === "read" ? t("assistantReadingFiles")
                  : current.tool === "search" ? t("assistantSearchingWorkspace")
                    : current.tool === "edit" ? t("assistantEditingFile")
                      : current.tool === "write" ? t("assistantWritingFile")
                        : current.tool === "command" ? current.phase === "preparing" ? t("assistantPreparingCommand") : t("assistantRunningCommand")
                          : current.tool === "delegate" ? t("assistantDelegatingTask")
                            : current.tool === "skill" ? t("assistantLoadingSkill")
                              : current.tool === "connector" ? t("assistantCallingConnector")
                                : t("assistantCallingTool");

  return <div className="mt-3 min-h-5 text-[12px] leading-5"><p className={waitingForUser ? "text-[#8b6932] dark:text-[#d6b878]" : "assistant-run-status-shimmer"}>{label}</p></div>;
}

function AssistantRunPlaceholder({ presentation }: { presentation: AssistantRunPresentation }) {
  return <article><AssistantIdentityHeader /><div className="mt-2"><AssistantRunStatus activity={presentation.activity} /></div></article>;
}

function PlanResultActions({ onResolve }: { onResolve: (action: "implement" | "stay") => Promise<void> }) {
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
  return <div className="mt-3 border-l-2 border-[#a9bc70] bg-[#f7f9ef] px-3 py-2 dark:border-[#9fba55] dark:bg-[#28321d]"><div className="flex flex-wrap gap-1"><button className="h-6 rounded-[5px] bg-[#252624] px-2 text-[10px] font-semibold text-white hover:bg-[#3a3b37] disabled:opacity-50 dark:bg-[#d9f37a] dark:text-[#252624] dark:hover:bg-[#e4f99c]" disabled={pending !== null} onClick={() => void resolve("implement")} type="button">{pending === "implement" ? "..." : t("implementPlan")}</button><button className="h-6 rounded-[5px] border border-[#b7c98b] bg-white px-2 text-[10px] font-medium text-[#53652d] hover:bg-[#eef4dc] disabled:opacity-50 dark:border-[#718b43] dark:bg-[#202719] dark:text-[#d7ec9a] dark:hover:bg-[#354321]" disabled={pending !== null} onClick={() => void resolve("stay")} type="button">{pending === "stay" ? "..." : t("stayInPlanMode")}</button></div>{error ? <p className="mt-1.5 text-[10px] text-destructive" role="alert">{error}</p> : null}</div>;
}

function AssistantMessageBody({ messages, onEnableAutoApprove, onHandoffClarification, onLoadToolOutput, onResolveApproval, onResolveClarificationQuestion, onResolveUserRequest, onResolvePlanResult, canPlan, planMode, runPresentation, showFooter, workbenchId }: { messages: ConversationMessage[]; onEnableAutoApprove?: () => Promise<void>; onHandoffClarification: (interactionMode: "default" | "clarify" | "plan") => Promise<void>; onLoadToolOutput: (callId: string) => Promise<void>; onResolveApproval: (approvalId: string, approved: boolean, feedback?: string) => void; onResolveClarificationQuestion: (callId: string, value: string | boolean) => Promise<void>; onResolveUserRequest: (requestId: string, resolution: { status: "submitted" | "cancelled"; answers?: Record<string, UserRequestAnswer>; feedback?: string }) => void; onResolvePlanResult: (action: "implement" | "stay") => Promise<void>; canPlan: boolean; planMode: "off" | "planning" | "executing"; runPresentation: AssistantRunPresentation | null; showFooter: boolean; workbenchId: WorkbenchId }) {
  const message = messages.at(-1)!;
  const blocks = messages.flatMap((candidate) => candidate.blocks);
  const hasPendingInteraction = blocks.some((block) => block.type === "tool" && (block.state === "awaiting-approval" || block.state === "awaiting-user-input"));
  const isStreaming = messages.some((candidate) => candidate.status === "streaming");
  const presentedAssistantMessageId = runPresentation?.assistantMessageId ?? null;
  const showRunStatus = presentedAssistantMessageId !== null && messages.some((candidate) => candidate.id === presentedAssistantMessageId);
  return (
    <article>
      <AssistantIdentityHeader />
      <div className="mt-2 min-w-0">
        {messages.map((candidate, index) => <section className={`min-h-px outline-none focus-visible:ring-2 focus-visible:ring-ring ${index > 0 ? "mt-5" : ""}`} data-thread-message-id={candidate.id} key={candidate.id} tabIndex={-1}><AssistantMessageBlocks canPlan={canPlan} clarificationHandoffAvailable={showFooter && !isStreaming && !hasPendingInteraction && candidate.id === message.id} message={candidate} onEnableAutoApprove={onEnableAutoApprove} onHandoffClarification={onHandoffClarification} onLoadToolOutput={onLoadToolOutput} onResolveApproval={onResolveApproval} onResolveClarificationQuestion={onResolveClarificationQuestion} onResolveUserRequest={onResolveUserRequest} workbenchId={workbenchId} /><AssistantResponseError message={candidate} /></section>)}
        {showRunStatus && runPresentation ? <AssistantRunStatus activity={runPresentation.activity} /> : null}
        {showFooter && !isStreaming && !hasPendingInteraction && planMode === "planning" ? <PlanResultActions onResolve={onResolvePlanResult} /> : null}
        {showFooter && !isStreaming && !hasPendingInteraction ? <div className="mt-4 flex items-center gap-2 text-[#898981]">
          <button aria-label="Copy response" className="grid h-6 w-6 place-items-center rounded-[5px] hover:bg-[#efefeb] hover:text-[#454540]" onClick={() => void navigator.clipboard.writeText(blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n"))} type="button"><Copy className="h-3.5 w-3.5" /></button>
          <span className="ml-auto font-mono text-[11px] text-[#aaa9a1]">{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        </div> : null}
      </div>
    </article>
  );
}

const USER_MESSAGE_COLLAPSED_HEIGHT = 72;

function CollapsibleUserMessage({ children, contentKey }: { children: ReactNode; contentKey: string }) {
  const { locale } = usePreferences();
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

  return <div><div className={!expanded && truncated ? "max-h-[72px] overflow-hidden" : undefined} ref={contentRef}>{children}</div>{truncated ? <button aria-expanded={expanded} className="mt-1 flex h-5 items-center gap-0.5 text-[10px] font-medium text-[#6d7f53] hover:text-[#45582f] dark:text-[#b8d98e] dark:hover:text-[#d6edaf]" onClick={() => setExpanded((value) => !value)} type="button">{expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{expanded ? locale === "zh-CN" ? "收起" : "Collapse" : locale === "zh-CN" ? "展开全文" : "Show more"}</button> : null}</div>;
}

function MessageBody({ messages, onEnableAutoApprove, onHandoffClarification, onLoadToolOutput, onResolveApproval, onResolveClarificationQuestion, onResolveUserRequest, onResolvePlanResult, canPlan, isFirstMessage, planMode, runPresentation, showFooter, workbenchId }: { messages: ConversationMessage[]; onEnableAutoApprove?: () => Promise<void>; onHandoffClarification: (interactionMode: "default" | "clarify" | "plan") => Promise<void>; onLoadToolOutput: (callId: string) => Promise<void>; onResolveApproval: (approvalId: string, approved: boolean, feedback?: string) => void; onResolveClarificationQuestion: (callId: string, value: string | boolean) => Promise<void>; onResolveUserRequest: (requestId: string, resolution: { status: "submitted" | "cancelled"; answers?: Record<string, UserRequestAnswer>; feedback?: string }) => void; onResolvePlanResult: (action: "implement" | "stay") => Promise<void>; canPlan: boolean; isFirstMessage: boolean; planMode: "off" | "planning" | "executing"; runPresentation: AssistantRunPresentation | null; showFooter: boolean; workbenchId: WorkbenchId }) {
  const { t } = usePreferences();
  const message = messages[0]!;
  if (message.role === "user") {
    const contentBlocks = message.blocks.filter((block) => block.type === "text" || block.type === "skill-reference" || block.type === "workspace-reference" || block.type === "artifact");
    const attachments = message.blocks.filter((block) => block.type === "attachment");
    return (
      <div className={`group relative min-h-px ${isFirstMessage ? "pt-4" : "pt-8"} outline-none focus-visible:ring-2 focus-visible:ring-ring ${contentBlocks.length > 0 ? "pb-7" : ""}`} data-thread-message-id={message.id} tabIndex={-1}>
        <div className="ml-auto flex w-fit max-w-[88%] flex-col items-end sm:max-w-[560px]">
          {contentBlocks.length > 0 ? <div className="w-fit max-w-full break-words rounded-[10px] bg-[#f0f0ed] px-3.5 py-2.5 text-[14px] leading-6 text-[#343431] dark:bg-muted dark:text-foreground"><CollapsibleUserMessage contentKey={message.id}>{contentBlocks.map((block, index) => block.type === "text"
            ? <span className="whitespace-pre-wrap break-words" key={`text-${index}`}>{block.text}</span>
            : block.type === "workspace-reference" ? <span className="mx-1.5 inline-flex h-6 max-w-[230px] select-none items-center gap-1 rounded-[5px] border border-[#bed7cf] bg-[#eef8f5] px-1.5 align-middle text-[13px] font-normal leading-6 text-[#34574d] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#3b675c] dark:bg-[#20332d] dark:text-[#c5e3d9]" key={block.id} title={block.path}>{block.kind === "directory" ? <Folder aria-hidden className="h-3 w-3 shrink-0 text-[#4f8b79]" /> : <FileText aria-hidden className="h-3 w-3 shrink-0 text-[#4f8b79]" />}<span className="min-w-0 truncate">{block.name}</span></span>
            : block.type === "artifact" ? <span className="mx-1.5 inline-flex h-6 max-w-[250px] select-none items-center gap-1 rounded-[5px] border border-[#b8d6cb] bg-[#edf8f4] px-1.5 align-middle text-[13px] font-normal leading-6 text-[#345f53] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#416b5e] dark:bg-[#20372f] dark:text-[#bae2d3]" key={`${block.artifactId}:${block.surfaceId ?? block.name}`} title={block.locator ?? block.name}><Layers3 aria-hidden className="h-3 w-3 shrink-0 text-[#4f8b79] dark:text-[#9ccfbd]" /><span className="min-w-0 truncate">{block.name}</span></span>
            : <span className="mx-1.5 inline-flex h-6 max-w-[210px] select-none items-center gap-1 rounded-[5px] border border-[#deded9] bg-[#f8f8f6] px-1.5 align-middle text-[13px] font-normal leading-6 text-[#45453f] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] dark:border-[#4b4c45] dark:bg-[#2b2c27] dark:text-[#deded8]" key={block.id} title={block.name}><Command aria-hidden className="h-3 w-3 shrink-0 text-[#686861] dark:text-[#b7b8ae]" /><span className="min-w-0 truncate">{block.name}</span></span>)}</CollapsibleUserMessage></div> : null}
          {attachments.length > 0 ? <div className="mt-1 flex w-fit max-w-full flex-wrap justify-end gap-1.5">{attachments.map((attachment) => <span className="max-w-full truncate rounded-[5px] bg-[#f0f0ed] px-2 py-1 font-mono text-[11px] text-[#6d6d67] dark:bg-muted" key={attachment.id}>{attachment.name}</span>)}</div> : null}
        </div>
        {contentBlocks.length > 0 ? <button aria-label={t("copyMessage")} className="pointer-events-none absolute bottom-0 right-0 grid h-6 w-6 place-items-center rounded-[5px] text-[#898981] opacity-0 transition-opacity hover:bg-[#efefeb] hover:text-[#454540] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-muted" onClick={() => void navigator.clipboard.writeText(contentBlocks.map((block) => block.type === "text" ? block.text : `@${block.name}`).join(""))} title={t("copyMessage")} type="button"><Copy className="h-3.5 w-3.5" /></button> : null}
      </div>
    );
  }
  return <AssistantMessageBody canPlan={canPlan} messages={messages} onEnableAutoApprove={onEnableAutoApprove} onHandoffClarification={onHandoffClarification} onLoadToolOutput={onLoadToolOutput} onResolveApproval={onResolveApproval} onResolveClarificationQuestion={onResolveClarificationQuestion} onResolvePlanResult={onResolvePlanResult} onResolveUserRequest={onResolveUserRequest} planMode={planMode} runPresentation={runPresentation} showFooter={showFooter} workbenchId={workbenchId} />;
}

function createTimeline(snapshot: SessionSnapshot, runPresentation: AssistantRunPresentation | null): ThreadTimelineItem[] {
  return createThreadTimeline(snapshot.messages, snapshot.contextCompactions, runPresentation);
}

function withPendingTurn(snapshot: SessionSnapshot, pendingTurn: PendingThreadTurn | null | undefined): SessionSnapshot {
  if (!pendingTurn || snapshot.messages.some((message) => message.id === pendingTurn.message.id)) return snapshot;
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

function messagesFromHistoryPage(page: SessionHistoryPage): ConversationMessage[] {
  return page.items.flatMap((item) => item.type === "turn" ? item.turn.messages : []);
}

function userMessageHistory(messages: readonly ConversationMessage[]): Array<{ id: string; parts: UserPromptPart[] }> {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    const parts = message.blocks.flatMap((block): UserPromptPart[] => {
      if (block.type === "text") return [{ type: "text", text: block.text }];
      if (block.type === "skill-reference") return [{ type: "skill-reference", skillId: block.skillId, name: block.name, source: block.source }];
      if (block.type === "workspace-reference") return [{ type: "workspace-reference", path: block.path, name: block.name, kind: block.kind }];
      return [];
    });
    return parts.length > 0 ? [{ id: message.id, parts }] : [];
  });
}

function compactionsFromHistoryPage(page: SessionHistoryPage): ContextCompactionRecord[] {
  return page.items.flatMap((item) => item.type === "compaction" ? [item.compaction] : []);
}

function snapshotFromSessionView(view: SessionViewSnapshot): SessionSnapshot {
  return {
    session: view.session,
    messages: messagesFromHistoryPage(view.history),
    contextUsage: view.contextUsage,
    turnUsage: view.turnUsage,
    contextCompactions: compactionsFromHistoryPage(view.history),
    isRunning: view.isRunning,
    isCompacting: view.isCompacting,
    compactionTrigger: view.compactionTrigger,
    compactionError: view.compactionError,
    extensions: view.extensions,
    toolApprovalMode: view.toolApprovalMode,
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

function mergeMessages(current: ConversationMessage[], incoming: ConversationMessage[]): ConversationMessage[] {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function mergeCompactions(current: ContextCompactionRecord[], incoming: ContextCompactionRecord[]): ContextCompactionRecord[] {
  const compactions = new Map(current.map((compaction) => [compaction.id, compaction]));
  for (const compaction of incoming) compactions.set(compaction.id, compaction);
  return [...compactions.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function applySearchHighlight(element: HTMLElement, matchText: string): () => void {
  const query = matchText.trim();
  if (!query) return () => {};
  const normalizedQuery = query.toLocaleLowerCase();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, [data-thread-search-highlight], [data-thread-search-exclude]")) return NodeFilter.FILTER_REJECT;
      return node.textContent?.toLocaleLowerCase().includes(normalizedQuery) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const match = walker.nextNode();
  if (!match || match.nodeType !== Node.TEXT_NODE) return () => {};
  const text = match.textContent ?? "";
  const start = text.toLocaleLowerCase().indexOf(normalizedQuery);
  if (start === -1) return () => {};
  const mark = document.createElement("mark");
  mark.dataset.threadSearchHighlight = "true";
  mark.className = "rounded-[2px] bg-[#dfe9b7] px-0.5 text-inherit shadow-[inset_0_-1px_0_rgba(113,136,57,0.5)] dark:bg-[#687b39]";
  mark.textContent = text.slice(start, start + query.length);
  const fragment = document.createDocumentFragment();
  if (start > 0) fragment.append(document.createTextNode(text.slice(0, start)));
  fragment.append(mark);
  if (start + query.length < text.length) fragment.append(document.createTextNode(text.slice(start + query.length)));
  (match as Text).replaceWith(fragment);
  return () => {
    if (mark.isConnected) mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  };
}

function waitForScrollSettled(element: HTMLElement, reduceMotion: boolean, onSettled: () => void): () => void {
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

export function ThreadView({ artifactSelection, initialPendingTurn, messageNavigationTarget, onArtifactSelectionConsumed, onMessageNavigationConsumed, onOpenModels, onOpenSkillImport, onOpenSkills, pendingWorkspaceReferences, onPendingWorkspaceReferencesConsumed, sessionId }: ThreadViewProps) {
  const client = useRuntimeClient();
  const { snapshot: appSnapshot } = useRuntime();
  const { reduceMotion, t } = usePreferences();
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [history, setHistory] = useState<LoadedHistory | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(100_000);
  const [pendingNavigation, setPendingNavigation] = useState<{ matchText?: string; messageId?: string; turnId: string } | null>(null);
  const [virtualListVersion, setVirtualListVersion] = useState(0);
  const [runPresentation, setRunPresentation] = useState<AssistantRunPresentation | null>(null);
  const followLatestRef = useRef(true);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const hydratedRef = useRef(false);
  const pendingEventsRef = useRef<RuntimeEventEnvelope[]>([]);
  const pendingTextEventsRef = useRef<RuntimeEventEnvelope[]>([]);
  const textFrameRef = useRef<number | null>(null);
  const lastSequenceRef = useRef<RunEventCursor | undefined>(undefined);
  const loadingBeforeRef = useRef(false);
  const loadingAfterRef = useRef(false);
  const navigationSequenceRef = useRef(0);
  const searchHighlightCleanupRef = useRef<(() => void) | null>(null);
  const searchHighlightTimerRef = useRef<number | null>(null);

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "smooth") => {
    followLatestRef.current = true;
    setIsAtBottom(true);
    const count = timelineRef.current.length;
    if (count > 0) virtuosoRef.current?.scrollToIndex({ index: count - 1, align: "end", behavior });
  }, []);

  const timeline = useMemo(() => snapshot ? createTimeline(snapshot, runPresentation) : [], [runPresentation, snapshot]);
  const timelineRef = useRef<ThreadTimelineItem[]>([]);
  timelineRef.current = timeline;

  useEffect(() => {
    followLatestRef.current = true;
    setIsAtBottom(true);
    setActiveTurnId(null);
    setFirstItemIndex(100_000);
    if (searchHighlightTimerRef.current !== null) window.clearTimeout(searchHighlightTimerRef.current);
    searchHighlightTimerRef.current = null;
    searchHighlightCleanupRef.current?.();
    searchHighlightCleanupRef.current = null;
    setPendingNavigation(null);
    setVirtualListVersion(0);
    setHistory(null);
    setSnapshot(null);
    setRunPresentation(initialPendingTurn ? createAssistantRunPresentation(initialPendingTurn.message.id, initialPendingTurn.submission.submittedAt) : null);
    hydratedRef.current = false;
    pendingEventsRef.current = [];
    pendingTextEventsRef.current = [];
    if (textFrameRef.current !== null) window.cancelAnimationFrame(textFrameRef.current);
    textFrameRef.current = null;
    lastSequenceRef.current = undefined;
    navigationSequenceRef.current += 1;
    const cached = sessionViewCache.get(sessionId);
    if (cached) {
      setSnapshot(withPendingTurn(snapshotFromSessionView(cached), initialPendingTurn));
      setHistory(loadedHistoryFromView(cached));
      setFirstItemIndex(100_000 - threadTimelineItemCount(cached.history));
    }
    let active = true;
    const updateRunPresentation = (event: RuntimeEventEnvelope) => {
      setSnapshot((current) => current ? applyEvent(current, event) : current);
      setRunPresentation((current) => {
        const next = advanceAssistantRunPresentation(current, event);
        if (event.event.type === "run.failed" || event.event.type === "run.cancelled" || event.event.type === "session.idle") return null;
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
        for (const event of events) next = next ? applyEvent(next, event) : next;
        return next;
      });
      const last = events.at(-1);
      if (last) setRunPresentation((current) => advanceAssistantRunPresentation(current, last));
    };
    const applyRuntimeEvent = (event: RuntimeEventEnvelope) => {
      if (!isNewerRunEvent(event, lastSequenceRef.current)) return;
      lastSequenceRef.current = runEventCursor(event);
      if (event.event.type === "message.text.delta" || event.event.type === "message.reasoning.delta") {
        pendingTextEventsRef.current.push(event);
        if (textFrameRef.current === null) textFrameRef.current = window.requestAnimationFrame(flushTextEvents);
        return;
      }
      if (textFrameRef.current !== null) {
        window.cancelAnimationFrame(textFrameRef.current);
        flushTextEvents();
      }
      updateRunPresentation(event);
      if (event.event.type === "session.idle") {
        void client.getSessionView(sessionId).then((view) => {
          if (!active) return;
          rememberSessionView(view);
          setSnapshot((current) => current && current.session.id === sessionId ? {
            ...current,
            session: view.session,
            contextUsage: view.contextUsage,
            turnUsage: view.turnUsage,
            isRunning: view.isRunning,
            isCompacting: view.isCompacting,
            compactionTrigger: view.compactionTrigger,
            compactionError: view.compactionError ?? current.compactionError,
            extensions: view.extensions,
            toolApprovalMode: view.toolApprovalMode,
          } : snapshotFromSessionView(view));
          setHistory(loadedHistoryFromView(view));
        }).catch(() => {});
      }
    };
    const unsubscribe = client.subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      if (!hydratedRef.current) pendingEventsRef.current.push(event);
      else applyRuntimeEvent(event);
    });
    void client.getSessionView(sessionId).then((view) => {
      if (!active) return;
      rememberSessionView(view);
      const pendingEvents = pendingEventsRef.current;
      pendingEventsRef.current = [];
      setSnapshot(() => {
        let current = withPendingTurn(snapshotFromSessionView(view), initialPendingTurn);
        for (const event of pendingEvents) {
          if (!isNewerRunEvent(event, lastSequenceRef.current)) continue;
          lastSequenceRef.current = runEventCursor(event);
          current = applyEvent(current, event);
        }
        return current;
      });
      setHistory(loadedHistoryFromView(view));
      setFirstItemIndex(100_000 - threadTimelineItemCount(view.history));
      setRunPresentation((current) => {
        const persistedMessages = messagesFromHistoryPage(view.history);
        const initialTurnFinished = !view.isRunning && initialPendingTurn !== null && initialPendingTurn !== undefined && persistedMessages.some((message) => message.id === initialPendingTurn.message.id);
        let presentation = initialTurnFinished ? null : current ?? (view.isRunning ? assistantRunPresentationFromMessages(persistedMessages, Date.now()) : null);
        for (const event of pendingEvents) {
          if (event.event.type === "run.failed" || event.event.type === "run.cancelled" || event.event.type === "session.idle") presentation = null;
          else presentation = advanceAssistantRunPresentation(presentation, event);
        }
        return presentation;
      });
      hydratedRef.current = true;
    }).catch(() => {
      if (!active) return;
      hydratedRef.current = true;
      for (const event of pendingEventsRef.current) applyRuntimeEvent(event);
      pendingEventsRef.current = [];
    });
    return () => {
      active = false;
      if (textFrameRef.current !== null) window.cancelAnimationFrame(textFrameRef.current);
      textFrameRef.current = null;
      unsubscribe();
    };
  }, [client, sessionId]);

  useEffect(() => {
    if (!pendingNavigation) return;
    const index = timeline.findIndex((item) => item.type === "messages" && `turn:${item.messages[0]!.id}` === pendingNavigation.turnId);
    if (index === -1) return;
    followLatestRef.current = false;
    setIsAtBottom(false);
    setActiveTurnId(pendingNavigation.turnId);
    virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: reduceMotion ? "auto" : "smooth" });
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
      const element = document.querySelector<HTMLElement>(`[data-thread-message-id="${CSS.escape(messageId)}"]`);
      if (!element && attempts++ < 20) {
        frame = window.requestAnimationFrame(focusMessage);
        return;
      }
      if (element) {
        element.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
        element.focus({ preventScroll: true });
        cancelWaitForScroll = waitForScrollSettled(element, reduceMotion, () => {
          if (searchHighlightTimerRef.current !== null) window.clearTimeout(searchHighlightTimerRef.current);
          searchHighlightTimerRef.current = null;
          searchHighlightCleanupRef.current?.();
          const cleanup = matchText ? applySearchHighlight(element, matchText) : null;
          searchHighlightCleanupRef.current = cleanup;
          if (cleanup) {
            searchHighlightTimerRef.current = window.setTimeout(() => {
              if (searchHighlightCleanupRef.current !== cleanup) return;
              cleanup();
              searchHighlightCleanupRef.current = null;
              searchHighlightTimerRef.current = null;
            }, reduceMotion ? 1_400 : 2_800);
          }
          setPendingNavigation((current) => current?.messageId === messageId ? null : current);
        });
        return;
      }
      setPendingNavigation((current) => current?.messageId === messageId ? null : current);
    };
    frame = window.requestAnimationFrame(focusMessage);
    return () => {
      window.cancelAnimationFrame(frame);
      cancelWaitForScroll();
    };
  }, [pendingNavigation, reduceMotion, timeline, virtualListVersion]);

  useEffect(() => {
    return () => {
      if (searchHighlightTimerRef.current !== null) window.clearTimeout(searchHighlightTimerRef.current);
      searchHighlightCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!followLatestRef.current || timeline.length === 0) return;
    virtuosoRef.current?.scrollToIndex({ index: timeline.length - 1, align: "end", behavior: "auto" });
  }, [timeline.length, snapshot?.messages, virtualListVersion]);

  const currentModel = snapshot?.session.model ?? null;
  const currentEnabledModel = appSnapshot?.models.find((model) => model.connectionId === currentModel?.connectionId && model.modelId === currentModel.modelId);
  const planExtensionEnabled = appSnapshot?.extensions.configurations["wordless.plan-mode"]?.enabled ?? false;
  const interactionMode = snapshot?.session.interactionMode ?? "default";
  const canPlan = planExtensionEnabled && snapshot?.session.driverId === "coding";
  const planMode = snapshot ? planModeFromSnapshot(snapshot) : "off";
  const modelLabel = useMemo(
    () => currentEnabledModel?.displayName ?? t("modelRequired"),
    [currentEnabledModel?.displayName, t],
  );
  const currentConnection = appSnapshot?.connections.find((connection) => connection.id === currentModel?.connectionId);
  const canPrompt = currentEnabledModel !== undefined && currentConnection?.authStatus === "configured";
  const entry = appSnapshot?.entries.find((candidate) => candidate.id === snapshot?.session.entryId);
  const availableSkills = appSnapshot?.skills.skills.filter((skill) => skill.workspaceId === null || skill.workspaceId === snapshot?.session.workspaceId) ?? [];
  const availableConnectors = appSnapshot?.connectors.connectors ?? [];
  const showDensityRail = (history?.turnSummaries.length ?? 0) >= 2;

  const send = async (parts: UserPromptPart[]) => {
    const submission = createUserMessageSubmission();
    const pendingTurn = createPendingThreadTurn(parts, submission);
    setSnapshot((current) => current ? withPendingTurn(current, pendingTurn) : current);
    setRunPresentation(createAssistantRunPresentation(submission.messageId, submission.submittedAt));
    try {
      await client.promptSession(sessionId, parts, submission);
    } catch (cause) {
      setSnapshot((current) => current ? { ...current, messages: current.messages.filter((message) => message.id !== submission.messageId), isRunning: false } : current);
      setRunPresentation(null);
      throw cause;
    }
  };

  const selectModel = async (model: ModelReference) => {
    await client.setSessionModel(sessionId, model);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) => current ? { ...current, session: view.session } : snapshotFromSessionView(view));
    setHistory(loadedHistoryFromView(view));
  };

  const setAccessLevel = async (accessLevel: "default" | "full") => {
    const session = await client.setSessionAccess(sessionId, accessLevel);
    setSnapshot((current) => current ? { ...current, session } : current);
  };

  const setInteractionMode = async (nextMode: "default" | "clarify" | "plan") => {
    const session = await client.setSessionInteractionMode(sessionId, nextMode);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) => current ? { ...current, session, extensions: view.extensions } : snapshotFromSessionView(view));
    setHistory(loadedHistoryFromView(view));
  };

  const setToolApprovalMode = async (mode: ToolApprovalMode) => {
    await client.setSessionToolApprovalMode(sessionId, mode);
    setSnapshot((current) => current ? { ...current, toolApprovalMode: mode } : current);
  };

  const resolveClarificationQuestion = async (callId: string, value: string | boolean) => {
    await client.resolveClarificationQuestion(sessionId, callId, value);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) => current ? { ...current, session: view.session, messages: messagesFromHistoryPage(view.history), contextUsage: view.contextUsage, turnUsage: view.turnUsage, extensions: view.extensions } : snapshotFromSessionView(view));
    setHistory(loadedHistoryFromView(view));
  };

  const handoffClarification = async (nextMode: "default" | "clarify" | "plan") => {
    await client.handoffClarification(sessionId, nextMode);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) => current ? { ...current, session: view.session, messages: messagesFromHistoryPage(view.history), contextUsage: view.contextUsage, turnUsage: view.turnUsage, extensions: view.extensions } : snapshotFromSessionView(view));
    setHistory(loadedHistoryFromView(view));
    if (nextMode === "default") {
      await send([{ type: "text", text: "Implement the clarified list above. Follow the confirmed goals, constraints, and decisions, complete the work, and verify the result." }]);
    }
  };

  const setConnectors = async (connectorIds: string[]) => {
    await client.setSessionConnectors(sessionId, connectorIds);
    const view = await client.getSessionView(sessionId);
    setSnapshot((current) => current ? { ...current, session: view.session, contextUsage: view.contextUsage } : snapshotFromSessionView(view));
    setHistory(loadedHistoryFromView(view));
  };

  const resolveApproval = async (approvalId: string, approved: boolean, feedback?: string) => {
    await client.resolveOperationApproval(sessionId, approvalId, approved, feedback);
  };

  const resolveUserRequest = async (
    requestId: string,
    resolution: { status: "submitted" | "cancelled"; answers?: Record<string, UserRequestAnswer>; feedback?: string },
  ) => {
    await client.resolveUserRequest(sessionId, requestId, resolution);
  };

  const loadToolOutput = useCallback(async (callId: string) => {
    const output = await client.getSessionToolOutput(sessionId, callId);
    setSnapshot((current) => current ? {
      ...current,
      messages: current.messages.map((message) => ({
        ...message,
        blocks: message.blocks.map((block) => block.type === "tool" && block.callId === callId ? { ...block, output, outputTruncated: undefined } : block),
      })),
    } : current);
  }, [client, sessionId]);

  const setPlanMode = async (nextMode: "off" | "planning" | "executing") => {
    if (!snapshot) return;
    const currentState = snapshot.extensions.find((item) => item.extensionId === "wordless.plan-mode")?.state;
    const nextState = { mode: nextMode, plan: Array.isArray(currentState?.plan) ? currentState.plan : [] };
    if (snapshot.isRunning) await client.interactWithSessionExtension(sessionId, "wordless.plan-mode", "set-mode", nextMode);
    else await client.setSessionExtensionState(sessionId, "wordless.plan-mode", nextState);
    setSnapshot((current) => current ? {
      ...current,
      extensions: [...current.extensions.filter((item) => item.extensionId !== "wordless.plan-mode"), { extensionId: "wordless.plan-mode", state: nextState, updatedAt: Date.now() }],
    } : current);
  };

  const togglePlanMode = async () => await setPlanMode(planMode === "off" ? "planning" : "off");

  const resolvePlanResult = async (action: "implement" | "stay") => {
    if (action === "stay") return;
    await setPlanMode("executing");
    await send([{ type: "text", text: "Implement the approved plan above. Follow the plan, make the necessary changes, and verify the result." }]);
  };

  const compactContext = async () => {
    setSnapshot((current) => current ? { ...current, isCompacting: true, compactionTrigger: "manual", compactionError: undefined } : current);
    try {
      await client.compactSession(sessionId);
    } catch (cause) {
      setSnapshot((current) => current ? { ...current, isCompacting: false, compactionTrigger: "manual", compactionError: compactionFailureMessage(cause) } : current);
    }
  };

  const loadOlder = useCallback(async () => {
    if (!history?.hasMoreBefore || !history.nextBeforeCursor || loadingBeforeRef.current) return;
    loadingBeforeRef.current = true;
    followLatestRef.current = false;
    setIsAtBottom(false);
    try {
      const page = await client.getSessionHistoryPage(sessionId, { before: history.nextBeforeCursor, limit: 24 });
      const prependedItemCount = threadTimelineItemCount(page);
      setSnapshot((current) => current ? {
        ...current,
        messages: mergeMessages(current.messages, messagesFromHistoryPage(page)),
        contextCompactions: mergeCompactions(current.contextCompactions, compactionsFromHistoryPage(page)),
      } : current);
      setHistory((current) => current ? {
        ...current,
        hasMoreBefore: page.hasMoreBefore,
        nextBeforeCursor: page.nextBeforeCursor,
        revision: page.revision,
      } : current);
      setFirstItemIndex((current) => firstItemIndexAfterPrepend(current, prependedItemCount));
    } finally {
      loadingBeforeRef.current = false;
    }
  }, [client, history, sessionId]);

  const loadNewer = useCallback(async () => {
    if (!history?.hasMoreAfter || !history.nextAfterCursor || loadingAfterRef.current) return;
    loadingAfterRef.current = true;
    try {
      const page = await client.getSessionHistoryPage(sessionId, { after: history.nextAfterCursor, limit: 24 });
      setSnapshot((current) => current ? {
        ...current,
        messages: mergeMessages(current.messages, messagesFromHistoryPage(page)),
        contextCompactions: mergeCompactions(current.contextCompactions, compactionsFromHistoryPage(page)),
      } : current);
      setHistory((current) => current ? {
        ...current,
        hasMoreAfter: page.hasMoreAfter,
        nextAfterCursor: page.nextAfterCursor,
        revision: page.revision,
      } : current);
    } finally {
      loadingAfterRef.current = false;
    }
  }, [client, history, sessionId]);

  const navigateToTurn = useCallback(async (turnId: string, messageId?: string, matchText?: string) => {
    const sequence = ++navigationSequenceRef.current;
    const existing = timelineRef.current.findIndex((item) => item.type === "messages" && `turn:${item.messages[0]!.id}` === turnId);
    followLatestRef.current = false;
    setIsAtBottom(false);
    if (searchHighlightTimerRef.current !== null) window.clearTimeout(searchHighlightTimerRef.current);
    searchHighlightTimerRef.current = null;
    searchHighlightCleanupRef.current?.();
    searchHighlightCleanupRef.current = null;
    setPendingNavigation({ turnId, messageId, matchText });
    if (existing !== -1) {
      return;
    }
    const page = await client.getSessionHistoryPage(sessionId, { aroundTurnId: turnId, limit: 24 });
    if (sequence !== navigationSequenceRef.current) return;
    setSnapshot((current) => current ? {
      ...current,
      messages: messagesFromHistoryPage(page),
      contextCompactions: compactionsFromHistoryPage(page),
    } : current);
    setHistory((current) => current ? {
      ...current,
      hasMoreAfter: page.hasMoreAfter,
      hasMoreBefore: page.hasMoreBefore,
      nextAfterCursor: page.nextAfterCursor,
      nextBeforeCursor: page.nextBeforeCursor,
      revision: page.revision,
    } : current);
    setFirstItemIndex(100_000 - threadTimelineItemCount(page));
    setVirtualListVersion((current) => current + 1);
  }, [client, sessionId]);

  useEffect(() => {
    if (!messageNavigationTarget) return;
    if (messageNavigationTarget.sessionId !== sessionId) return;
    onMessageNavigationConsumed?.(messageNavigationTarget.requestId);
    void navigateToTurn(messageNavigationTarget.turnId, messageNavigationTarget.messageId, messageNavigationTarget.matchText);
  }, [messageNavigationTarget, navigateToTurn, onMessageNavigationConsumed, sessionId]);

  if (!snapshot || snapshot.session.id !== sessionId || !appSnapshot || !entry) return <div className="grid min-h-0 flex-1 place-items-center text-[13px] text-muted-foreground">Loading session</div>;

  const composerUserMessageHistory = userMessageHistory(snapshot.messages);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <Virtuoso
          key={`${sessionId}:${virtualListVersion}`}
          atBottomStateChange={(atBottom) => { followLatestRef.current = atBottom; setIsAtBottom(atBottom); }}
          className="h-full"
          components={{ Header: () => planExtensionEnabled && planMode !== "off" ? <ThreadContentFrame className="pb-7 pt-6" densityRail={showDensityRail}><PlanModePanel mode={planMode} snapshot={snapshot} /></ThreadContentFrame> : <div className="h-6" />, Footer: () => <ThreadContentFrame className="pb-10" densityRail={showDensityRail}>{snapshot.isCompacting ? <ContextCompactionPending trigger={snapshot.compactionTrigger} /> : null}{snapshot.compactionError ? <ContextCompactionFailure message={snapshot.compactionError} onRetry={() => void compactContext()} trigger={snapshot.compactionTrigger} /> : null}</ThreadContentFrame> }}
          computeItemKey={(_index, item) => item.type === "compaction" ? item.compaction.id : item.type === "assistant-run" || item.messages[0]?.role === "assistant" ? `assistant:${item.turnId}` : item.messages[0]!.id}
          data={timeline}
          endReached={() => void loadNewer()}
          firstItemIndex={firstItemIndex}
          followOutput={isAtBottom ? "auto" : false}
          itemContent={(index, item) => {
            const dataIndex = dataIndexFromReportedIndex(index, firstItemIndex);
            const followsCompaction = timeline[dataIndex - 1]?.type === "compaction" && item.type !== "compaction";
            return <ThreadContentFrame className={followsCompaction ? "pt-[26px]" : ""} densityRail={showDensityRail}>{item.type === "compaction"
              ? <ContextCompactionActivity compaction={item.compaction} />
              : item.type === "assistant-run" ? <AssistantRunPlaceholder presentation={item.presentation} />
              : <MessageBody canPlan={canPlan} isFirstMessage={item.messages[0]?.id === snapshot.messages[0]?.id} messages={item.messages} onEnableAutoApprove={snapshot.toolApprovalMode === "manual" ? () => setToolApprovalMode("auto") : undefined} onHandoffClarification={handoffClarification} onLoadToolOutput={loadToolOutput} onResolveApproval={resolveApproval} onResolveClarificationQuestion={resolveClarificationQuestion} onResolvePlanResult={resolvePlanResult} onResolveUserRequest={resolveUserRequest} planMode={planMode} runPresentation={runPresentation?.userMessageId && item.turnId === `turn:${runPresentation.userMessageId}` ? runPresentation : null} showFooter={!snapshot.isRunning && index === firstItemIndex + timeline.length - 1} workbenchId={snapshot.session.workbenchId} />}</ThreadContentFrame>;
          }}
          rangeChanged={(range) => {
            const middleReportedIndex = range.startIndex + Math.floor((range.endIndex - range.startIndex) / 2);
            const item = timeline[dataIndexFromReportedIndex(middleReportedIndex, firstItemIndex)];
            if (item?.type === "messages" || item?.type === "assistant-run") setActiveTurnId(item.turnId);
          }}
          ref={virtuosoRef}
          startReached={() => void loadOlder()}
        />
        <ConversationDensityRail activeTurnId={activeTurnId} fallbackExcerpt={t("unnamedMessage")} navigationLabel={t("conversationNavigation")} onNavigate={(turnId) => void navigateToTurn(turnId)} summaries={history?.turnSummaries ?? []} />
        {!isAtBottom ? <button aria-label="Jump to latest message" className="absolute bottom-4 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-[#deded8] bg-white text-[#4d4d48] shadow-[0_4px_12px_rgba(0,0,0,0.10)] hover:bg-[#f5f5f2] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted" onClick={() => scrollToBottom()} type="button"><ArrowDown className="h-4 w-4" /></button> : null}
      </div>
      <div className="bg-[var(--wordless-shell-workspace)] pb-3 pt-5">
        <ThreadContentFrame densityRail={showDensityRail}>
          <div className="relative">
            <Composer
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
              onTogglePlanMode={planExtensionEnabled ? () => void togglePlanMode() : undefined}
              onInteractionModeChange={(nextMode) => {
                if (nextMode === "clarify" && currentEnabledModel?.capabilities.supportsToolUse === false) {
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
              onImportSkill={onOpenSkillImport}
              onOpenSkills={onOpenSkills}
              onSend={send}
              artifactSelection={artifactSelection}
              onArtifactSelectionConsumed={onArtifactSelectionConsumed}
              pendingWorkspaceReferences={pendingWorkspaceReferences}
              onPendingWorkspaceReferencesConsumed={onPendingWorkspaceReferencesConsumed}
              searchWorkspaceReferences={snapshot.session.workspaceId ? (query) => client.searchSessionWorkspace(sessionId, query) : undefined}
              workspaceSearchScope={snapshot.session.workspaceId ? sessionId : "no-workspace"}
              onStop={() => client.cancelSession(sessionId)}
              planMode={planMode}
              running={snapshot.isRunning}
              sendDisabled={!canPrompt || (interactionMode === "clarify" && currentEnabledModel?.capabilities.supportsToolUse === false)}
              selectedConnectorIds={snapshot.session.connectorIds}
              skillContextWindow={currentEnabledModel?.capabilities.contextWindow}
              skills={availableSkills}
              showWorkspacePicker={false}
              showAccessControl={snapshot.session.workbenchId === "code"}
              userMessageHistory={composerUserMessageHistory}
            />
            <ModelPicker connections={appSnapshot.connections} entry={entry} models={appSnapshot.models} onConfigure={onOpenModels} onOpenChange={setModelOpen} onSelect={(connectionId, modelId) => void selectModel({ connectionId, modelId })} open={modelOpen} selected={currentModel} />
          </div>
          <TurnTokenUsageRow usage={snapshot.turnUsage} />
          <p className="mt-2 text-center text-[11px] text-[#96968e] dark:text-muted-foreground">{t("aiContentNotice")}</p>
        </ThreadContentFrame>
      </div>
    </div>
  );
}
