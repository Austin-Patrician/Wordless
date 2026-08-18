import type { ComponentType, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Code2,
  FileOutput,
  Image,
  LoaderCircle,
  Presentation,
  ScanSearch,
  ShieldCheck,
  Table2,
  UsersRound,
  WandSparkles,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ExpertPortrait as ExpertPortraitValue,
  MessageArtifactBlock,
  MessageToolBlock,
  MessageToolSource,
  WorkbenchId,
} from "@wordless/domain";
import dataAnalysisIcon from "../../../icons/common-icons/数据分析.svg";
import dataPublishIcon from "../../../icons/common-icons/data_publish.svg";
import dataValidateIcon from "../../../icons/common-icons/data_validate.svg";
import delegateTaskIcon from "../../../icons/common-icons/delegate_task.svg";
import deepThinkingIcon from "../../../icons/common-icons/深度思考.svg";
import editIcon from "../../../icons/common-icons/edit.svg";
import findIcon from "../../../icons/common-icons/find.svg";
import folderIcon from "../../../icons/common-icons/floder.svg";
import grepIcon from "../../../icons/common-icons/grep.svg";
import innovationIcon from "../../../icons/common-icons/innovation.svg";
import listIcon from "../../../icons/common-icons/list.svg";
import loadSkillIcon from "../../../icons/common-icons/load_skill.svg";
import modelRequestIcon from "../../../icons/common-icons/模型请求.svg";
import readIcon from "../../../icons/common-icons/read.svg";
import readFileIcon from "../../../icons/common-icons/read_file.svg";
import researchSnapshotIcon from "../../../icons/common-icons/research_snapshot.svg";
import researchSubmitDimensionIcon from "../../../icons/common-icons/research_submit_dimension.svg";
import researchValidateIcon from "../../../icons/common-icons/research_validate.svg";
import planIcon from "../../../icons/common-icons/plan.svg";
import writeIcon from "../../../icons/common-icons/Write.svg";
import terminalBashIcon from "../../../icons/common-icons/terminal-bash.svg";
import { ConnectorIcon } from "../../shared/ConnectorIcon";
import { ExpertPortrait } from "../experts/ExpertPortrait";
import { parseExpertPortrait } from "../experts/avataaars-portrait";
import type { MessageKey } from "../../shared/i18n";
import { usePreferences } from "../../shared/preferences";
import {
  ClarificationBriefToolActivity,
  ClarificationQuestionToolActivity,
} from "./ClarificationToolActivity";
import { ResearchDelegateToolActivity } from "./ResearchDelegateToolActivity";
import { UserRequestToolActivity } from "./UserRequestToolActivity";
import type { ResearchTaskSelection } from "./context-panel-types";
import { formatToolInput, summarizeToolInput } from "./tool-input-preview";

type StandardToolIconSource = {
  path: string;
  invertOnDark?: boolean;
};

type Translate = ReturnType<typeof usePreferences>["t"];

function formatMessage(
  t: Translate,
  key: MessageKey,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    t(key),
  );
}

const standardToolIconSources: Record<string, StandardToolIconSource> = {
  ask_clarifying_question: { path: innovationIcon, invertOnDark: true },
  bash: { path: terminalBashIcon, invertOnDark: true },
  complete_clarification: { path: innovationIcon, invertOnDark: true },
  data_catalog: { path: folderIcon, invertOnDark: true },
  data_inspect: { path: readFileIcon, invertOnDark: true },
  data_materialize: { path: dataAnalysisIcon },
  data_publish: { path: dataPublishIcon },
  data_validate: { path: dataValidateIcon, invertOnDark: true },
  delegate_task: { path: delegateTaskIcon },
  delegate_expert: { path: delegateTaskIcon },
  edit: { path: editIcon, invertOnDark: true },
  find: { path: findIcon, invertOnDark: true },
  grep: { path: grepIcon, invertOnDark: true },
  load_skill: { path: loadSkillIcon, invertOnDark: true },
  ls: { path: listIcon, invertOnDark: true },
  read: { path: readIcon, invertOnDark: true },
  research_prepare: { path: planIcon, invertOnDark: true },
  research_review_dimension: { path: researchValidateIcon },
  research_snapshot: { path: researchSnapshotIcon, invertOnDark: true },
  research_start: { path: deepThinkingIcon },
  research_submit_dimension: {
    path: researchSubmitDimensionIcon,
    invertOnDark: true,
  },
  research_validate: { path: researchValidateIcon },
  request_user_input: { path: modelRequestIcon },
  workspace_changes: { path: listIcon, invertOnDark: true },
  write: { path: writeIcon, invertOnDark: true },
};

export type ToolActivityProps = {
  block: MessageToolBlock;
  researchTaskCallIds?: Record<string, string>;
  onOpenResearchTask?: (selection: ResearchTaskSelection) => void;
  onEnableAutoApprove?: () => void | Promise<void>;
  onLoadToolOutput?: (callId: string) => Promise<void>;
  onResolveApproval?: (
    approvalId: string,
    approved: boolean,
    feedback?: string,
  ) => void | Promise<void>;
  onResolveUserRequest?: (
    requestId: string,
    resolution: {
      status: "submitted" | "cancelled";
      answers?: Record<string, string | string[] | boolean>;
      feedback?: string;
    },
  ) => void | Promise<void>;
  canPlan?: boolean;
  clarificationHandoffAvailable?: boolean;
  onHandoffClarification?: (
    interactionMode: "default" | "clarify" | "plan",
  ) => void | Promise<void>;
  onResolveClarificationQuestion?: (
    callId: string,
    value: string | boolean,
  ) => void | Promise<void>;
};

export type ArtifactActivityProps = {
  block: MessageArtifactBlock;
};

type ToolRendererRegistration = {
  workbenchId?: WorkbenchId;
  toolName?: string;
  component: ComponentType<ToolActivityProps>;
};

type ArtifactRendererRegistration = {
  workbenchId?: WorkbenchId;
  artifactKind?: string;
  component: ComponentType<ArtifactActivityProps>;
};

export interface WorkbenchRendererRegistry {
  resolveTool(
    workbenchId: WorkbenchId,
    toolName: string,
  ): ComponentType<ToolActivityProps>;
  resolveArtifact(
    workbenchId: WorkbenchId,
    artifactKind: string,
  ): ComponentType<ArtifactActivityProps>;
}

function toolKey(workbenchId?: WorkbenchId, toolName?: string): string {
  return `${workbenchId ?? "*"}:${toolName ?? "*"}`;
}

function artifactKey(workbenchId?: WorkbenchId, artifactKind?: string): string {
  return `${workbenchId ?? "*"}:${artifactKind ?? "*"}`;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function McpToolIcon({ source }: { source: MessageToolSource }) {
  return (
    <span
      aria-label={source.connectorName}
      role="img"
      title={source.connectorName}
    >
      <ConnectorIcon
        className="h-3.5 w-3.5"
        templateId={source.templateId}
        transport={source.transport}
      />
    </span>
  );
}

function standardToolIcon(toolName: string): ReactNode | undefined {
  const source = standardToolIconSources[toolName];
  return source ? (
    <img
      alt=""
      className={`h-3.5 w-3.5 object-contain ${source.invertOnDark ? "dark:invert" : ""}`}
      src={source.path}
    />
  ) : undefined;
}

function AutoApproveIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} fill="none" viewBox="0 0 16 16">
      <path
        d="M3.25 5.15A5.15 5.15 0 0 1 12.6 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M3.2 2.7v2.6h2.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M12.75 10.85A5.15 5.15 0 0 1 3.4 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M12.8 13.3v-2.6h-2.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="m5.65 8.15 1.55 1.5 3.25-3.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function activityIcon(block: MessageToolBlock, completedWarning = false) {
  if (block.state === "running" || block.state === "pending")
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
  if (
    block.state === "awaiting-approval" ||
    block.state === "awaiting-user-input"
  )
    return <CircleAlert className="h-3.5 w-3.5" />;
  if (block.state === "error" || completedWarning)
    return <CircleAlert className="h-3.5 w-3.5" />;
  return <CheckCircle2 className="h-3.5 w-3.5" />;
}

function activityState(
  block: MessageToolBlock,
  t: Translate,
): string | undefined {
  if (block.state === "awaiting-approval") return t("toolAwaitingApproval");
  if (block.state === "awaiting-user-input") return t("toolAwaitingInput");
  if (block.state === "running") return t("toolRunning");
  if (block.state === "pending") return t("toolQueued");
  if (block.state === "error") return t("toolFailed");
  return undefined;
}

function activityStatusClass(
  block: MessageToolBlock,
  completedWarning = false,
): string {
  if (block.state === "error") return "text-[#b34b42] dark:text-[#f29a8f]";
  if (completedWarning) return "text-[#9a6b24] dark:text-[#e2bd72]";
  if (block.state === "complete") return "text-[#6c8542] dark:text-[#c3df75]";
  if (
    block.state === "awaiting-approval" ||
    block.state === "awaiting-user-input"
  )
    return "text-[#9a6b24] dark:text-[#e2bd72]";
  return "text-muted-foreground";
}

function ToolActivityRow({
  block,
  completedWarning = false,
  detail,
  icon,
  runningLabel,
  summary,
}: {
  block: MessageToolBlock;
  completedWarning?: boolean;
  detail?: ReactNode;
  icon: ReactNode;
  runningLabel?: string;
  summary?: string;
}) {
  const { t } = usePreferences();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (block.state !== "running" || block.startedAt === undefined) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [block.startedAt, block.state]);
  const runningTime =
    block.state === "running" && block.startedAt !== undefined
      ? `${Math.max(0, Math.floor((now - block.startedAt) / 1_000))}s${block.timeoutSeconds !== undefined ? ` / ${block.timeoutSeconds}s` : ""}`
      : undefined;
  const stateLabel =
    block.state === "complete"
      ? summary
      : block.state === "error"
        ? t("toolFailed")
        : block.state === "running" && runningLabel
          ? `${runningLabel}${runningTime ? ` · ${runningTime}` : ""}`
          : block.state === "running" && runningTime
            ? `${t("toolRunning")} · ${runningTime}`
            : activityState(block, t);
  const accessibleStateLabel =
    stateLabel ??
    (block.state === "complete" ? t("toolCompleted") : t("toolStatus"));
  const statusClass = activityStatusClass(block, completedWarning);

  return (
    <div className="flex min-h-5 items-center gap-3 text-[13px]">
      <span
        className={
          block.state === "error"
            ? "text-destructive"
            : "text-[#70842f] dark:text-[#c2df6b]"
        }
      >
        {icon}
      </span>
      <span className="shrink-0 font-mono text-[12px] text-[#2d2d2a] dark:text-foreground">
        {block.name}
      </span>
      <div
        className={`min-w-0 flex-1 font-mono text-[11px] text-[#777770] dark:text-muted-foreground ${typeof detail === "string" ? "truncate" : ""}`}
      >
        {detail ?? ""}
      </div>
      {stateLabel ? (
        <span
          className={`hidden shrink-0 text-[12px] sm:block ${block.state === "error" ? statusClass : "text-[#8a8a83] dark:text-muted-foreground"}`}
        >
          {stateLabel}
        </span>
      ) : null}
      <span
        aria-label={accessibleStateLabel}
        className={`shrink-0 ${statusClass}`}
        role="img"
      >
        {activityIcon(block, completedWarning)}
      </span>
    </div>
  );
}

function GrepToolOutput({
  block,
  onLoadToolOutput,
  path,
  pattern,
}: Pick<ToolActivityProps, "block" | "onLoadToolOutput"> & {
  path: string;
  pattern: string;
}) {
  const { t } = usePreferences();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const details = readRecord(block.details);
  const count = typeof details?.count === "number" ? details.count : undefined;
  const hasMore = textValue(details?.nextCursor) !== undefined;
  const ignoreCase = block.input?.ignoreCase;
  const caseLabel =
    ignoreCase === true
      ? t("toolCaseInsensitive")
      : ignoreCase === false
        ? t("toolCaseSensitive")
        : t("toolCaseSmart");
  const limit = typeof block.input?.limit === "number" ? block.input.limit : 20;
  const canExpand = block.output !== undefined || count !== undefined;
  const load = () => {
    if (!block.outputTruncated || !onLoadToolOutput || loading) return;
    setLoading(true);
    void onLoadToolOutput(block.callId)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  if (!canExpand) return null;
  const resultLabel =
    count === undefined
      ? t("toolSearchResults")
      : hasMore
        ? formatMessage(t, "toolSearchMoreAvailable", { count })
        : formatMessage(t, "toolSearchMatches", { count });
  return (
    <details
      className="group mt-2"
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded(open);
        if (open) load();
      }}
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-mono text-[11px] text-[#777770] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {loading ? t("toolLoadingResults") : t("toolViewSearch")}
        <ChevronDown
          aria-hidden
          className="h-3.5 w-3.5 text-[#999991] transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      {expanded ? <div className="mt-2 border-y border-[#e1e1dc] bg-[#fafaf9] font-mono text-[11px] text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-3 py-2.5">
          <dt className="text-[#96968e]">{t("toolQuery")}</dt>
          <dd className="min-w-0 break-all text-[#3f3f3a] dark:text-foreground">
            &quot;{pattern}&quot;
          </dd>
          <dt className="text-[#96968e]">{t("toolScope")}</dt>
          <dd className="min-w-0 break-all">{path}</dd>
          <dt className="text-[#96968e]">{t("toolCase")}</dt>
          <dd>{caseLabel}</dd>
          <dt className="text-[#96968e]">{t("toolLimit")}</dt>
          <dd>{limit}</dd>
        </dl>
        <div className="border-t border-[#e7e7e2] px-3 py-1.5 text-[10px] text-[#888880] dark:border-border">
          {resultLabel}
        </div>
        {block.output ? (
          <pre className="m-0 max-h-52 overflow-auto border-t border-[#e7e7e2] px-3 py-2 whitespace-pre-wrap text-[11px] leading-5 dark:border-border">
            {block.output}
          </pre>
        ) : count === 0 ? (
          <p className="border-t border-[#e7e7e2] px-3 py-3 text-[#888880] dark:border-border">
            {t("toolSearchNoMatches")}
          </p>
        ) : null}
      </div> : null}
    </details>
  );
}

function ToolOutput({
  block,
  onLoadToolOutput,
}: Pick<ToolActivityProps, "block" | "onLoadToolOutput">) {
  const { t } = usePreferences();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const load = () => {
    if (!block.outputTruncated || !onLoadToolOutput || loading) return;
    setLoading(true);
    void onLoadToolOutput(block.callId)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  if (!block.output) return null;
  return (
    <details
      className="group mt-2"
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded(open);
        if (open) load();
      }}
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-mono text-[11px] text-[#777770] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {loading ? t("toolLoadingOutput") : t("toolViewOutput")}
        <ChevronDown
          aria-hidden
          className="h-3.5 w-3.5 text-[#999991] transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      {expanded ? <pre className="m-0 mt-2 max-h-52 overflow-auto bg-[#fafaf9] px-3 py-2 font-mono text-[11px] leading-5 text-[#4d4d47] dark:bg-muted dark:text-muted-foreground">
        {block.output}
      </pre> : null}
    </details>
  );
}

function ToolInputDetails({
  input,
}: {
  input: Record<string, unknown> | undefined;
}) {
  const { t } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  if (!input || Object.keys(input).length === 0) return null;
  return (
    <details
      className="group mt-2"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-mono text-[11px] text-[#777770] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        {t("toolViewParameters")}
        <ChevronDown
          aria-hidden
          className="h-3.5 w-3.5 text-[#999991] transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      {expanded ? (
        <pre className="m-0 mt-2 max-h-60 overflow-auto border-y border-[#e1e1dc] bg-[#fafaf9] px-3 py-2 font-mono text-[11px] leading-5 text-[#4d4d47] whitespace-pre-wrap break-words dark:border-border dark:bg-muted dark:text-muted-foreground">
          {formatToolInput(input)}
        </pre>
      ) : null}
    </details>
  );
}

function GenericToolActivity({
  block,
  onEnableAutoApprove,
  onLoadToolOutput,
  onResolveApproval,
}: ToolActivityProps) {
  if (block.state === "awaiting-approval" && block.approval)
    return (
      <ToolApprovalCard
        block={block}
        onEnableAutoApprove={onEnableAutoApprove}
        onResolveApproval={onResolveApproval}
      />
    );
  return (
    <section className="py-3">
      <ToolActivityRow
        block={block}
        detail={summarizeToolInput(block.input)}
        icon={
          block.source?.kind === "mcp" ? (
            <McpToolIcon source={block.source} />
          ) : (
            (standardToolIcon(block.name) ?? <Wrench className="h-3.5 w-3.5" />)
          )
        }
      />
      <ToolInputDetails input={block.input} />
      <ToolOutput block={block} onLoadToolOutput={onLoadToolOutput} />
    </section>
  );
}

type SubagentTaskDetails = {
  id: string;
  memberId?: string;
  memberName?: string;
  memberPortrait?: ExpertPortraitValue;
  role?: string;
  executionProfile?: string;
  task: string;
  scope?: string;
  responsibility?: string;
  expectedOutput: string;
  reason?: string;
  status:
    | "queued"
    | "running"
    | "awaiting-approval"
    | "awaiting-user-input"
    | "completed"
    | "interrupted"
    | "failed"
    | "cancelled"
    | "blocked"
    | "skipped";
  phase?: "queued" | "thinking" | "tool" | "approval" | "user-input" | "finished";
  revision?: number;
  queuedAt?: number;
  startedAt?: number;
  updatedAt?: number;
  finishedAt?: number;
  activeToolName?: string;
  blockedByTaskId?: string;
  terminalReason?: string;
  output?: string;
  usage?: { totalTokens: number; totalCost?: number };
  error?: string;
  tool?: {
    name: string;
    output?: string;
    state: "running" | "complete" | "error";
  };
  approval?: unknown;
  userRequest?: unknown;
  modelResolution?: {
    requested: { connectionId: string; modelId: string } | null;
    resolved: { connectionId: string; modelId: string };
    thinkingLevel: string;
    fallbackReason?: "unavailable" | "tools-unsupported";
  };
};

type SubagentDetails = {
  mode: "single" | "parallel" | "chain";
  tasks: SubagentTaskDetails[];
};

function subagentDetails(value: unknown): SubagentDetails | undefined {
  const details = readRecord(value);
  if (
    !details ||
    (details.mode !== "single" &&
      details.mode !== "parallel" &&
      details.mode !== "chain") ||
    !Array.isArray(details.tasks)
  )
    return undefined;
  const tasks = details.tasks.flatMap((candidate): SubagentTaskDetails[] => {
    const task = readRecord(candidate);
    if (
      !task ||
      typeof task.id !== "string" ||
      (typeof task.role !== "string" &&
        typeof task.executionProfile !== "string") ||
      typeof task.task !== "string" ||
      typeof task.expectedOutput !== "string"
    )
      return [];
    if (
      task.status !== "queued" &&
      task.status !== "running" &&
      task.status !== "awaiting-approval" &&
      task.status !== "awaiting-user-input" &&
      task.status !== "completed" &&
      task.status !== "interrupted" &&
      task.status !== "failed" &&
      task.status !== "cancelled" &&
      task.status !== "blocked" &&
      task.status !== "skipped"
    )
      return [];
    const usage = readRecord(task.usage);
    const tool = readRecord(task.tool);
    const modelResolution = readRecord(task.modelResolution);
    const requestedModel = readRecord(modelResolution?.requested);
    const resolvedModel = readRecord(modelResolution?.resolved);
    const memberPortrait = readRecord(task.memberPortrait);
    const parsedPortrait = parseExpertPortrait(memberPortrait);
    return [
      {
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
        ...(typeof task.role === "string" ? { role: task.role } : {}),
        ...(typeof task.executionProfile === "string"
          ? { executionProfile: task.executionProfile }
          : {}),
        task: task.task,
        ...(typeof task.scope === "string" ? { scope: task.scope } : {}),
        ...(typeof task.responsibility === "string"
          ? { responsibility: task.responsibility }
          : {}),
        expectedOutput: task.expectedOutput,
        ...(typeof task.reason === "string" ? { reason: task.reason } : {}),
        status: task.status,
        ...(typeof task.phase === "string" &&
        ["queued", "thinking", "tool", "approval", "user-input", "finished"].includes(task.phase)
          ? { phase: task.phase as SubagentTaskDetails["phase"] }
          : {}),
        ...(typeof task.revision === "number" ? { revision: task.revision } : {}),
        ...(typeof task.queuedAt === "number" ? { queuedAt: task.queuedAt } : {}),
        ...(typeof task.startedAt === "number" ? { startedAt: task.startedAt } : {}),
        ...(typeof task.updatedAt === "number" ? { updatedAt: task.updatedAt } : {}),
        ...(typeof task.finishedAt === "number" ? { finishedAt: task.finishedAt } : {}),
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
        ...(typeof usage?.totalTokens === "number"
          ? {
              usage: {
                totalTokens: usage.totalTokens,
                ...(typeof usage.totalCost === "number"
                  ? { totalCost: usage.totalCost }
                  : {}),
              },
            }
          : {}),
        ...(typeof tool?.name === "string" &&
        (tool.state === "running" ||
          tool.state === "complete" ||
          tool.state === "error")
          ? {
              tool: {
                name: tool.name,
                state: tool.state,
                ...(typeof tool.output === "string"
                  ? { output: tool.output }
                  : {}),
              },
            }
          : {}),
        ...(task.approval !== undefined ? { approval: task.approval } : {}),
        ...(task.userRequest !== undefined
          ? { userRequest: task.userRequest }
          : {}),
        ...(modelResolution &&
        resolvedModel &&
        typeof resolvedModel.connectionId === "string" &&
        typeof resolvedModel.modelId === "string" &&
        typeof modelResolution.thinkingLevel === "string"
          ? {
              modelResolution: {
                requested:
                  requestedModel &&
                  typeof requestedModel.connectionId === "string" &&
                  typeof requestedModel.modelId === "string"
                    ? {
                        connectionId: requestedModel.connectionId,
                        modelId: requestedModel.modelId,
                      }
                    : null,
                resolved: {
                  connectionId: resolvedModel.connectionId,
                  modelId: resolvedModel.modelId,
                },
                thinkingLevel: modelResolution.thinkingLevel,
                ...(modelResolution.fallbackReason === "unavailable" ||
                modelResolution.fallbackReason === "tools-unsupported"
                  ? { fallbackReason: modelResolution.fallbackReason }
                  : {}),
              },
            }
          : {}),
      },
    ];
  });
  return { mode: details.mode, tasks };
}

function nestedApproval(
  task: SubagentTaskDetails,
): MessageToolBlock["approval"] | undefined {
  const value = readRecord(task.approval);
  const preview = readRecord(value?.preview);
  if (
    !value ||
    typeof value.approvalId !== "string" ||
    (value.status !== "required" &&
      value.status !== "approved" &&
      value.status !== "rejected") ||
    (value.risk !== "file-write" &&
      value.risk !== "command" &&
      value.risk !== "connector" &&
      value.risk !== "workspace-access") ||
    (value.severity !== "normal" && value.severity !== "high") ||
    typeof value.summary !== "string" ||
    !preview ||
    typeof preview.type !== "string" ||
    !Array.isArray(value.matchedRules)
  )
    return undefined;
  return value as unknown as MessageToolBlock["approval"];
}

function nestedUserRequest(
  task: SubagentTaskDetails,
): MessageToolBlock["userRequest"] | undefined {
  const interaction = readRecord(task.userRequest);
  const request = readRecord(interaction?.request) ?? interaction;
  if (
    !request ||
    typeof request.requestId !== "string" ||
    typeof request.callId !== "string" ||
    typeof request.toolName !== "string" ||
    typeof request.title !== "string" ||
    !Array.isArray(request.fields)
  )
    return undefined;
  const resolution = readRecord(interaction?.resolution);
  return {
    request: request as unknown as NonNullable<
      MessageToolBlock["userRequest"]
    >["request"],
    ...(resolution
      ? {
          resolution: resolution as unknown as NonNullable<
            MessageToolBlock["userRequest"]
          >["resolution"],
        }
      : {}),
  };
}

function subagentState(task: SubagentTaskDetails) {
  if (task.status === "completed")
    return <Check className="h-3.5 w-3.5 text-[#6c8542] dark:text-[#c3df75]" />;
  if (
    task.status === "interrupted" ||
    task.status === "failed" ||
    task.status === "cancelled" ||
    task.status === "blocked" ||
    task.status === "skipped"
  )
    return <CircleAlert className="h-3.5 w-3.5 text-destructive" />;
  return (
    <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#738a44] dark:text-[#c2df6b]" />
  );
}

function subagentElapsed(startedAt: number | undefined, now: number): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function subagentActivityLabel(task: SubagentTaskDetails, t: Translate): string {
  if (task.status === "queued")
    return task.blockedByTaskId
      ? t("threadWaitingForPreviousMember")
      : t("toolQueued");
  if (task.status === "awaiting-approval") return t("toolAwaitingApproval");
  if (task.status === "awaiting-user-input") return t("toolAwaitingInput");
  if (task.status === "completed") return t("toolCompleted");
  if (task.status === "interrupted") return t("threadInterrupted");
  if (task.status === "failed") return t("toolFailed");
  if (task.status === "cancelled") return t("threadCancelled");
  if (task.status === "blocked") return t("threadBlocked");
  if (task.status === "skipped") return t("threadSkipped");
  if (task.phase === "tool" && task.activeToolName)
    return formatMessage(t, "threadUsingTool", { tool: task.activeToolName });
  return t("threadModelThinking");
}

function formatCompactTokenCount(tokens: number): string {
  const absolute = Math.abs(tokens);
  const unit =
    absolute >= 1_000_000_000
      ? { divisor: 1_000_000_000, suffix: "B" }
      : absolute >= 1_000_000
        ? { divisor: 1_000_000, suffix: "M" }
        : absolute >= 1_000
          ? { divisor: 1_000, suffix: "K" }
          : undefined;
  if (!unit) return Math.round(tokens).toLocaleString();
  const value = tokens / unit.divisor;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")}${unit.suffix}`;
}

function SubagentToolActivity({
  block,
  onEnableAutoApprove,
  onLoadToolOutput,
  onResolveApproval,
  onResolveUserRequest,
}: ToolActivityProps) {
  const details = subagentDetails(block.details);
  const { t } = usePreferences();
  const active = details?.tasks.some(
    (task) =>
      task.status === "running" ||
      task.status === "awaiting-approval" ||
      task.status === "awaiting-user-input",
  ) ?? false;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!details)
    return (
      <GenericToolActivity block={block} onLoadToolOutput={onLoadToolOutput} />
    );
  return (
    <section className="py-3.5">
      <div className="flex min-w-0 items-center gap-2 text-[12px]">
        <span className="shrink-0" title={block.name}>
          {standardToolIcon(block.name)}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {details.tasks.map((task) => (
            <span className="flex min-w-0 items-center gap-1.5" key={task.id}>
              {task.memberPortrait ? (
                <ExpertPortrait
                  className="h-5 w-5 shrink-0"
                  name={task.memberName ?? task.role ?? t("digitalEmployee")}
                  portrait={task.memberPortrait}
                />
              ) : (
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#e5ead9] text-[9px] font-semibold text-[#68774a]">
                  {(task.memberName ?? task.role ?? t("digitalEmployee"))
                    .slice(0, 1)
                    .toUpperCase()}
                </span>
              )}
              <span className="truncate font-semibold text-[#41413c] dark:text-foreground">
                {task.memberName ?? task.role ?? t("digitalEmployee")}
              </span>
            </span>
          ))}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-[#93938b]">
          {details.tasks.filter((task) => task.status === "completed").length}/
          {details.tasks.length}
        </span>
      </div>
      <div className="mt-2 divide-y divide-[#e7e7e2] border-y border-[#e7e7e2] dark:divide-border dark:border-border">
        {details.tasks.map((task) => {
          const approval = nestedApproval(task);
          const userRequest = nestedUserRequest(task);
          const nestedBlock: MessageToolBlock = {
            type: "tool",
            callId: task.id,
            name: task.tool?.name ?? block.name,
            state:
              task.status === "awaiting-approval"
                ? "awaiting-approval"
                : task.status === "awaiting-user-input"
                  ? "awaiting-user-input"
                  : task.status === "interrupted" ||
                      task.status === "failed" ||
                      task.status === "blocked" ||
                      task.status === "skipped"
                    ? "error"
                    : task.status === "completed"
                      ? "complete"
                      : "running",
            ...(approval ? { approval } : {}),
            ...(userRequest ? { userRequest } : {}),
          };
          return (
            <div className="px-1 py-3" key={task.id}>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5">{subagentState(task)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-[#4c4c47] dark:text-foreground">
                      {task.memberName ?? task.role ?? t("digitalEmployee")}
                    </span>
                    <span className="truncate text-[11px] text-[#82827b] dark:text-muted-foreground">
                      {task.scope ?? task.responsibility}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-[#999991]">
                      {subagentActivityLabel(task, t)}
                      {(task.status === "running" ||
                        task.status === "awaiting-approval" ||
                        task.status === "awaiting-user-input") && task.startedAt
                        ? ` · ${subagentElapsed(task.startedAt, now)}`
                        : ""}
                    </span>
                  </div>
                </div>
              </div>
              {approval && task.status === "awaiting-approval" ? (
                <ToolApprovalCard
                  block={nestedBlock}
                  onEnableAutoApprove={onEnableAutoApprove}
                  onResolveApproval={onResolveApproval}
                />
              ) : null}
              {userRequest && task.status === "awaiting-user-input" ? (
                <UserRequestToolActivity
                  block={nestedBlock}
                  onResolveUserRequest={onResolveUserRequest}
                />
              ) : null}
              {task.output ? (
                <details className="group mt-2">
                  <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-mono text-[10px] text-[#777770] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {t("toolViewResult")}
                    <ChevronDown
                      aria-hidden
                      className="h-3.5 w-3.5 text-[#999991] transition-transform duration-150 group-open:rotate-180"
                    />
                  </summary>
                  <pre className="m-0 mt-2 max-h-60 overflow-auto bg-[#fafaf9] px-3 py-2 whitespace-pre-wrap font-mono text-[11px] leading-5 text-[#4d4d47] dark:bg-muted dark:text-muted-foreground">
                    {task.output}
                  </pre>
                </details>
              ) : null}
              {task.error ? (
                <p className="mt-2 text-[11px] text-destructive">
                  {task.error}
                </p>
              ) : null}
              {task.modelResolution?.fallbackReason ? (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[#9a6a35] dark:text-[#d6aa72]">
                  <CircleAlert className="h-3 w-3 shrink-0" />
                  {formatMessage(t, task.modelResolution.fallbackReason === "tools-unsupported" ? "threadMemberModelToolsFallback" : "threadMemberModelFallback", {
                    requested:
                      task.modelResolution.requested?.modelId ?? t("expertsFollowComposer"),
                    resolved: task.modelResolution.resolved.modelId,
                  })}
                </p>
              ) : null}
              {task.usage ? (
                <p className="mt-2 font-mono text-[10px] text-[#92928a]">
                  {block.name === "delegate_expert"
                    ? formatMessage(t, "toolTokens", {
                        count: formatCompactTokenCount(task.usage.totalTokens),
                      })
                    : `${formatMessage(t, "toolTokens", {
                        count: task.usage.totalTokens.toLocaleString(),
                      })}${
                        typeof task.usage.totalCost === "number"
                          ? ` · $${task.usage.totalCost.toFixed(4)}`
                          : ""
                      }`}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CodeToolActivity({
  block,
  onEnableAutoApprove,
  onLoadToolOutput,
  onResolveApproval,
}: ToolActivityProps) {
  const { t } = usePreferences();
  const inputPath = textValue(block.input?.path);
  const inputPattern = textValue(block.input?.pattern);
  const command = textValue(block.input?.command);
  const details = readRecord(block.details);
  const detailPath = textValue(details?.path);
  const detailPattern = textValue(details?.pattern);
  const path = inputPath ?? detailPath;
  const pattern = inputPattern ?? detailPattern;
  const changed = readRecord(details?.diff);
  const oldText = textValue(changed?.oldText);
  const newText = textValue(changed?.newText);
  const exitCode =
    typeof details?.exitCode === "number" ? details.exitCode : undefined;
  const nonZeroExit = exitCode !== undefined && exitCode !== 0;
  const hideEmptySuccessfulBashOutput =
    block.name === "bash" &&
    exitCode === 0 &&
    !textValue(details?.stdout) &&
    !textValue(details?.stderr);
  const icon = standardToolIcon(block.name) ?? (
    <Code2 className="h-3.5 w-3.5" />
  );
  if (block.state === "awaiting-approval" && block.approval)
    return (
      <ToolApprovalCard
        block={block}
        onEnableAutoApprove={onEnableAutoApprove}
        onResolveApproval={onResolveApproval}
      />
    );
  const grepHasMore =
    block.name === "grep" && textValue(details?.nextCursor) !== undefined;
  const summary = nonZeroExit
    ? formatMessage(t, "toolExitCode", { code: exitCode! })
    : block.name === "read" && typeof details?.lineCount === "number"
      ? formatMessage(t, "toolLinesRead", { count: details.lineCount })
      : block.name === "grep" && typeof details?.count === "number"
        ? `${formatMessage(t, "toolSearchMatches", { count: details.count })}${grepHasMore ? "+" : ""}`
        : block.name === "find" && typeof details?.count === "number"
          ? formatMessage(t, "toolFilesFound", { count: details.count })
          : activityState(block, t);
  const detail =
    block.name === "grep" && pattern ? (
      <>
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className="min-w-0 flex-1 truncate text-[#4f4f49] dark:text-foreground"
            title={pattern}
          >
            &quot;{pattern}&quot;
          </span>
          {path ? (
            <span
              className="hidden min-w-0 max-w-[45%] shrink truncate text-[#898981] dark:text-muted-foreground sm:inline"
              title={path}
            >
              {formatMessage(t, "toolSearchIn", { path })}
            </span>
          ) : null}
        </div>
        {path ? (
          <span
            className="mt-0.5 block truncate text-[10px] text-[#92928a] dark:text-muted-foreground sm:hidden"
            title={path}
          >
            {path}
          </span>
        ) : null}
      </>
    ) : (
      (command ?? path)
    );

  return (
    <section className="py-3">
      <ToolActivityRow
        block={block}
        completedWarning={nonZeroExit}
        detail={detail}
        icon={icon}
        summary={summary}
      />
      {oldText !== undefined && newText !== undefined ? (
        <details className="group mt-2">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-mono text-[11px] font-semibold text-[#777770] outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {t("toolViewChange")}
            <ChevronDown
              aria-hidden
              className="h-3.5 w-3.5 text-[#999991] transition-transform duration-150 group-open:rotate-180"
            />
          </summary>
          <div className="mt-2 max-h-80 overflow-auto border-y border-[#e1e1dc] font-mono text-[11px] leading-5 dark:border-border">
            <pre className="m-0 min-w-max whitespace-pre bg-[#fbefec] px-3 text-[#9a564b] dark:bg-[#3a211d] dark:text-[#ffb4a8]">
              - {oldText}
            </pre>
            <pre className="m-0 min-w-max whitespace-pre bg-[#eff7e7] px-3 text-[#547c36] dark:bg-[#29351d] dark:text-[#d8f28a]">
              + {newText}
            </pre>
          </div>
        </details>
      ) : null}
      {block.name === "grep" && pattern ? (
        <GrepToolOutput
          block={block}
          onLoadToolOutput={onLoadToolOutput}
          path={path ?? "."}
          pattern={pattern}
        />
      ) : hideEmptySuccessfulBashOutput ? null : (
        <ToolOutput block={block} onLoadToolOutput={onLoadToolOutput} />
      )}
    </section>
  );
}

function jsonRecord(
  value: string | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function PresentationToolActivity({
  block,
  onEnableAutoApprove,
  onLoadToolOutput,
  onResolveApproval,
}: ToolActivityProps) {
  const { t } = usePreferences();
  if (block.state === "awaiting-approval" && block.approval)
    return (
      <ToolApprovalCard
        block={block}
        onEnableAutoApprove={onEnableAutoApprove}
        onResolveApproval={onResolveApproval}
      />
    );

  const sharedToolIcon = standardToolIcon(block.name);
  const details = readRecord(block.details);
  const artifact = readRecord(details?.artifact);
  const quality = readRecord(details?.quality);
  const outline =
    block.name === "presentation_inspect" ||
    (block.name === "presentation_read" &&
      readRecord(block.input?.request)?.mode === "outline")
      ? jsonRecord(block.output)
      : undefined;
  const surfaces = Array.isArray(details?.surfaces) ? details.surfaces : [];
  const issues = Array.isArray(quality?.issues)
    ? quality.issues
    : Array.isArray(details?.issues)
      ? details.issues
      : [];
  const artifacts = Array.isArray(details?.artifacts) ? details.artifacts : [];
  const revision =
    typeof details?.revision === "number"
      ? details.revision
      : typeof artifact?.revision === "number"
        ? artifact.revision
        : undefined;
  const displayName =
    textValue(artifact?.displayName) ?? textValue(block.input?.name);
  const operationCount =
    typeof details?.operationCount === "number"
      ? details.operationCount
      : Array.isArray(block.input?.operations)
        ? block.input.operations.length
        : undefined;
  const slideCount =
    typeof outline?.totalSlides === "number" ? outline.totalSlides : undefined;

  const presentation = sharedToolIcon
    ? {
        icon: sharedToolIcon,
        running: t("toolPresentationRunning"),
        detail: undefined,
        summary: t("toolCompleted"),
      }
    : block.name === "presentation_create"
      ? {
          icon: <Presentation className="h-3.5 w-3.5" />,
          running: t("toolPresentationCreating"),
          detail: displayName,
          summary: displayName
            ? formatMessage(t, "toolPresentationCreated", { name: displayName })
            : t("toolPresentationCreatedFallback"),
        }
      : block.name === "presentation_apply" ||
          block.name === "presentation_edit"
        ? {
            icon: <WandSparkles className="h-3.5 w-3.5" />,
            running: t("toolPresentationApplyingChanges"),
            detail: displayName,
            summary:
              [
                operationCount === undefined
                  ? undefined
                  : formatMessage(t, "toolChangesApplied", {
                      count: operationCount,
                    }),
                revision === undefined
                  ? undefined
                  : formatMessage(t, "toolRevision", { revision }),
              ]
                .filter(Boolean)
                .join(" · ") || t("toolChangesAppliedFallback"),
          }
        : block.name === "presentation_render"
          ? {
              icon: <Image className="h-3.5 w-3.5" />,
              running: t("toolPresentationRendering"),
              detail:
                revision === undefined
                  ? undefined
                  : formatMessage(t, "toolRevision", { revision }),
              summary:
                [
                  surfaces.length > 0
                    ? formatMessage(t, "toolSlides", { count: surfaces.length })
                    : undefined,
                  revision === undefined
                    ? undefined
                    : formatMessage(t, "toolRevision", { revision }),
                ]
                  .filter(Boolean)
                  .join(" · ") || t("toolPreviewRendered"),
            }
          : block.name === "presentation_inspect" ||
              block.name === "presentation_read"
            ? {
                icon: <ScanSearch className="h-3.5 w-3.5" />,
                running: t("toolPresentationInspecting"),
                detail: textValue(block.input?.artifactId),
                summary:
                  slideCount === undefined
                    ? t("toolInspectionComplete")
                    : formatMessage(t, "toolSlidesInspected", {
                        count: slideCount,
                      }),
              }
            : block.name === "presentation_validate" ||
                block.name === "presentation_quality_scan" ||
                block.name === "presentation_quality_review"
              ? {
                  icon: <ShieldCheck className="h-3.5 w-3.5" />,
                  running: t("toolPresentationChecking"),
                  detail: textValue(block.input?.artifactId),
                  summary:
                    issues.length === 0
                      ? t("toolValidationPassed")
                      : formatMessage(t, "toolIssues", { count: issues.length }),
                }
              : block.name === "presentation_publish"
                ? {
                    icon: <FileOutput className="h-3.5 w-3.5" />,
                    running: t("toolPreparingOutput"),
                    detail: displayName,
                    summary: displayName
                      ? formatMessage(t, "toolNamedReady", { name: displayName })
                      : artifacts.length === 0
                        ? t("toolOutputReady")
                        : formatMessage(t, "toolPresentationsReady", {
                            count: artifacts.length,
                          }),
                  }
                : block.name === "presentation_help" ||
                    block.name === "presentation_guidance"
                  ? {
                      icon: <ScanSearch className="h-3.5 w-3.5" />,
                      running: t("toolLoadingOfficeCliGuidance"),
                      detail:
                        textValue(block.input?.element) ??
                        textValue(block.input?.name),
                      summary: t("toolGuidanceLoaded"),
                    }
                  : block.name === "presentation_sources"
                    ? {
                        icon: <FileOutput className="h-3.5 w-3.5" />,
                        running: t("toolRegisteringSources"),
                        detail: textValue(block.input?.artifactId),
                        summary: t("toolSourcesRegistered"),
                      }
                    : {
                        icon: <Presentation className="h-3.5 w-3.5" />,
                        running: t("toolPresentationRunning"),
                        detail: undefined,
                        summary: t("toolCompleted"),
                      };

  return (
    <section className="py-3">
      <ToolActivityRow
        block={block}
        detail={presentation.detail}
        icon={presentation.icon}
        runningLabel={presentation.running}
        summary={presentation.summary}
      />
      {block.state === "error" && block.output ? (
        <p className="mt-2 max-h-10 overflow-hidden whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-destructive">
          {block.output}
        </p>
      ) : null}
      <ToolOutput block={block} onLoadToolOutput={onLoadToolOutput} />
    </section>
  );
}

function SpreadsheetToolActivity({
  block,
  onEnableAutoApprove,
  onLoadToolOutput,
  onResolveApproval,
}: ToolActivityProps) {
  const { t } = usePreferences();
  if (block.state === "awaiting-approval" && block.approval)
    return (
      <ToolApprovalCard
        block={block}
        onEnableAutoApprove={onEnableAutoApprove}
        onResolveApproval={onResolveApproval}
      />
    );
  const details = readRecord(block.details);
  const artifact = readRecord(details?.artifact);
  const quality = readRecord(details?.quality);
  const displayName =
    textValue(artifact?.displayName) ?? textValue(block.input?.name);
  const operationCount =
    typeof details?.operationCount === "number"
      ? details.operationCount
      : Array.isArray(block.input?.operations)
        ? block.input.operations.length
        : undefined;
  const issues = Array.isArray(quality?.issues) ? quality.issues : [];
  const activity =
    block.name === "spreadsheet_create"
      ? {
          running: t("toolCreatingWorkbook"),
          summary: displayName
            ? formatMessage(t, "toolWorkbookCreatedNamed", { name: displayName })
            : t("toolWorkbookCreated"),
          detail: displayName,
        }
      : block.name === "spreadsheet_open"
        ? {
            running: t("toolOpeningWorkbook"),
            summary: displayName
              ? formatMessage(t, "toolWorkbookOpenedNamed", {
                  name: displayName,
                })
              : t("toolWorkbookOpened"),
            detail: textValue(block.input?.sourcePath),
          }
        : block.name === "spreadsheet_import"
          ? {
              running: t("toolImportingTabularData"),
              summary: t("toolDataImported"),
              detail: textValue(block.input?.sourcePath),
            }
          : block.name === "spreadsheet_edit"
            ? {
                running: t("toolUpdatingWorkbook"),
                summary:
                  operationCount === undefined
                    ? t("toolWorkbookUpdated")
                    : formatMessage(t, "toolChangesApplied", {
                        count: operationCount,
                      }),
                detail: displayName,
              }
            : block.name === "spreadsheet_render"
              ? {
                  running: t("toolRenderingWorkbookRange"),
                  summary: t("toolRangeRendered"),
                  detail: [
                    textValue(block.input?.sheet),
                    textValue(block.input?.range),
                  ]
                    .filter(Boolean)
                    .join("!"),
                }
              : block.name === "spreadsheet_quality_scan"
                ? {
                    running: t("toolCheckingWorkbook"),
                    summary: issues.length
                      ? formatMessage(t, "toolIssues", { count: issues.length })
                      : t("toolWorkbookCheckComplete"),
                    detail: textValue(block.input?.artifactId),
                  }
                : block.name === "spreadsheet_publish"
                  ? {
                      running: t("toolPreparingWorkbook"),
                      summary: displayName
                        ? formatMessage(t, "toolNamedReady", { name: displayName })
                        : t("toolWorkbookReady"),
                      detail: displayName,
                    }
                  : block.name === "spreadsheet_read"
                    ? {
                        running: t("toolReadingWorkbook"),
                        summary: t("toolWorkbookInspected"),
                        detail: textValue(block.input?.artifactId),
                      }
                    : {
                        running: t("toolLoadingSpreadsheetSchema"),
                        summary: t("toolSpreadsheetOperationComplete"),
                        detail: textValue(block.input?.element),
                      };
  return (
    <section className="py-3">
      <ToolActivityRow
        block={block}
        detail={activity.detail}
        icon={
          standardToolIcon(block.name) ?? <Table2 className="h-3.5 w-3.5" />
        }
        runningLabel={activity.running}
        summary={activity.summary}
      />
      {block.state === "error" && block.output ? (
        <p className="mt-2 max-h-10 overflow-hidden whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-destructive">
          {block.output}
        </p>
      ) : null}
      <ToolOutput block={block} onLoadToolOutput={onLoadToolOutput} />
    </section>
  );
}

function ToolApprovalCard({
  block,
  onEnableAutoApprove,
  onResolveApproval,
}: ToolActivityProps) {
  const { t } = usePreferences();
  const [rejected, setRejected] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<"approve" | "auto" | null>(null);
  const approval = block.approval;
  if (!approval) return null;
  const submit = async (approved: boolean) => {
    if (!approved) {
      setRejected(true);
      return;
    }
    if (!onResolveApproval) {
      setError(t("toolApprovalControlsUnavailable"));
      return;
    }
    setError(null);
    setResolving("approve");
    try {
      await onResolveApproval(approval.approvalId, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResolving(null);
    }
  };
  const enableAutoApprove = async () => {
    if (!onEnableAutoApprove) return;
    setError(null);
    setResolving("auto");
    try {
      await onEnableAutoApprove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResolving(null);
    }
  };
  const preview = approval.preview;
  const elevated =
    approval.requiresElevation === true || approval.risk === "workspace-access";
  const highRisk = approval.severity === "high";
  const autoApproveLabel = t("toolAutoApproveNormalTools");
  return (
    <section className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold">
            {elevated
              ? t("toolAllowExternalAccessOnce")
              : t("toolApprovalRequired")}
          </p>
          <p className="mt-1 font-mono text-[10px] text-[#6e6e68] dark:text-muted-foreground">
            {block.name} ·{" "}
            {preview.type === "external-access"
              ? preview.paths[0]
              : preview.type === "diff"
                ? preview.path
                : preview.type === "command"
                  ? preview.command
                  : preview.type === "spreadsheet"
                    ? preview.workbookName
                    : `${preview.connectorName} / ${preview.toolName}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {elevated ? (
            <span className="inline-flex items-center gap-1 rounded bg-[#f9e9e6] px-1.5 py-0.5 text-[10px] font-semibold text-[#b34b42] dark:bg-[#3a241f] dark:text-[#f29a8f]">
              <ShieldCheck className="h-3 w-3" />
              {t("toolOutsideWorkspace")}
            </span>
          ) : highRisk ? (
            <span className="rounded bg-[#f9e9e6] px-1.5 py-0.5 text-[10px] font-semibold text-[#b34b42] dark:bg-[#3a241f] dark:text-[#f29a8f]">
              {t("highRisk")}
            </span>
          ) : null}
          <span
            className={
              highRisk
                ? "text-[10px] font-medium text-[#a34b40] dark:text-[#f29a8f]"
                : "text-[10px] font-medium text-[#8b604c]"
            }
          >
            {approval.risk === "workspace-access"
              ? t("toolTemporaryFileAccessRequired")
              : approval.risk === "command"
                ? t("toolRunLocalCommandWarning")
                : approval.risk === "connector"
                  ? t("toolCallExternalConnectorWarning")
                  : t("toolModifyLocalFilesWarning")}
          </span>
        </div>
      </div>
      {preview.type === "external-access" ? (
        <div className="mt-3 border-y border-[#e5d8d3] bg-[#fdf9f7] px-3 py-2.5 text-[10px] leading-5 dark:border-[#543b35] dark:bg-[#2b211e]">
          <p className="font-medium text-[#7e4d43] dark:text-[#efb0a3]">
            {formatMessage(t, "toolOperation", {
              operation: preview.operation,
            })}
          </p>
          <div className="mt-1 max-h-24 overflow-auto font-mono text-[#5f5e59] dark:text-muted-foreground">
            {preview.paths.map((path) => (
              <p className="break-all" key={path}>
                {path}
              </p>
            ))}
          </div>
          <p className="mt-2 text-[#81736e] dark:text-[#cbbab4]">
            {t("toolExternalAccessOnlyThisCall")}
          </p>
        </div>
      ) : preview.type === "diff" ? (
        <div className="mt-3 max-h-80 overflow-auto border-y border-[#e1e1dc] bg-[#fafaf9] font-mono text-[10px] leading-5 dark:border-border dark:bg-muted">
          <div className="border-b border-[#e8e8e3] bg-[#f2f2ef] px-3 py-1.5 text-[#777770] dark:border-border dark:bg-secondary">
            @@ {preview.path}
          </div>
          <pre className="m-0 min-w-max whitespace-pre bg-[#fbefec] px-3 text-[#9a564b] dark:bg-[#3a211d] dark:text-[#ffb4a8]">
            - {preview.before}
          </pre>
          <pre className="m-0 min-w-max whitespace-pre bg-[#eff7e7] px-3 text-[#547c36] dark:bg-[#29351d] dark:text-[#d8f28a]">
            + {preview.after}
          </pre>
        </div>
      ) : preview.type === "command" ? (
        <div className="mt-3 border-y border-[#e1e1dc] bg-[#fafaf9] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground">
          <p>{preview.command}</p>
          <p className="mt-1 text-[#878780]">
            {formatMessage(t, "toolWorkingDirectory", {
              directory: preview.cwd,
            })}
            {preview.timeoutSeconds
              ? ` · ${formatMessage(t, "toolTimeout", {
                  seconds: preview.timeoutSeconds,
                })}`
              : ""}
          </p>
        </div>
      ) : preview.type === "spreadsheet" ? (
        <div className="mt-3 max-h-56 overflow-auto border-y border-[#e1e1dc] bg-[#fafaf9] font-mono text-[10px] dark:border-border dark:bg-muted">
          <div className="border-b border-[#e8e8e3] bg-[#f2f2ef] px-3 py-1.5 text-[#777770] dark:border-border dark:bg-secondary">
            {preview.affectedSheets.join(", ") || t("toolWorkbook")}
          </div>
          {preview.changes.map((change, index) => (
            <div
              className="border-b border-[#e8e8e3] px-3 py-2 last:border-b-0 dark:border-border"
              key={`${change.locator}:${index}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[#61763f] dark:text-[#c7df7c]">
                  {change.locator}
                </span>
                <span className="truncate text-[#777770]">
                  {change.summary}
                </span>
              </div>
              {change.before ? (
                <p className="mt-1 truncate text-[#9a564b] dark:text-[#ffb4a8]">
                  - {change.before}
                </p>
              ) : null}
              {change.after ? (
                <p className="truncate text-[#547c36] dark:text-[#d8f28a]">
                  + {change.after}
                </p>
              ) : null}
            </div>
          ))}
          {preview.truncated ? (
            <p className="px-3 py-2 text-[#8a6a2d]">
              {t("toolAdditionalChangesNotShown")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 border-y border-[#e1e1dc] bg-[#fafaf9] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground">
          <p>
            {preview.connectorName} / {preview.toolName}
          </p>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[#777770]">
            {JSON.stringify(preview.input, null, 2)}
          </pre>
        </div>
      )}
      {approval.matchedRules.length > 0 ? (
        <div className="mt-3 border-l-2 border-[#d98477] bg-[#fdf8f6] px-3 py-2 dark:border-[#9b554b] dark:bg-[#2b201d]">
          <p className="text-[10px] font-semibold text-[#8b5045] dark:text-[#efb0a3]">
            {t("matchedSecurityRules")}
          </p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-[#795f59] dark:text-[#d7b9b1]">
            {approval.matchedRules.map((rule) => (
              <li key={rule.id}>
                {rule.label} ·{" "}
                {rule.source === "builtin"
                  ? t("builtinRule")
                  : t("customRules")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-1.5">
        <button
          aria-label={t("toolRejectOperation")}
          className="grid h-7 w-7 place-items-center rounded-[6px] text-[#7b5d52] hover:bg-[#f8efeb] disabled:opacity-50"
          disabled={resolving !== null}
          onClick={() => void submit(false)}
          title={t("toolRejectOperation")}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          aria-label={
            elevated ? t("toolAllowOperationOnce") : t("toolApproveOperation")
          }
          className="grid h-7 w-7 place-items-center rounded-[6px] bg-[#252624] text-white hover:bg-[#3a3b37] disabled:opacity-50"
          disabled={resolving !== null}
          onClick={() => void submit(true)}
          title={
            elevated ? t("toolAllowOnce") : t("toolApproveAndRun")
          }
          type="button"
        >
          {resolving === "approve" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </button>
        {!elevated && !highRisk && onEnableAutoApprove ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={autoApproveLabel}
                className="grid h-7 w-7 place-items-center rounded-[6px] border border-[#b9c99a] bg-[#f7f9f1] text-[#61763f] transition-colors hover:border-[#9eb375] hover:bg-[#edf3df] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-[#59683e] dark:bg-[#252d1e] dark:text-[#c7df7c] dark:hover:bg-[#303b25]"
                disabled={resolving !== null}
                onClick={() => void enableAutoApprove()}
                type="button"
              >
                {resolving === "auto" ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AutoApproveIcon className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{autoApproveLabel}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {rejected ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-w-0 flex-1 rounded-[7px] border border-[#dcdcd6] bg-white px-3 py-2 text-[12px] outline-none placeholder:text-[#9c9c95] dark:border-border dark:bg-card"
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={t("toolRejectFeedbackPlaceholder")}
            value={feedback}
          />
          <button
            className="rounded-[7px] border border-[#d5d5cf] bg-white px-3 py-2 text-[12px] font-semibold text-[#4c4c47] hover:bg-[#f5f5f2] dark:border-border dark:bg-card dark:text-foreground"
            disabled={resolving !== null}
            onClick={() => {
              if (onResolveApproval)
                void Promise.resolve(
                  onResolveApproval(
                    approval.approvalId,
                    false,
                    feedback || undefined,
                  ),
                ).catch((cause) =>
                  setError(
                    cause instanceof Error ? cause.message : String(cause),
                  ),
                );
            }}
            type="button"
          >
            {t("toolSubmitRejectionReason")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function GenericArtifactActivity({ block }: ArtifactActivityProps) {
  return (
    <div className="rounded-[7px] border border-border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">
      {block.name}
    </div>
  );
}

export function createWorkbenchRendererRegistry(
  toolRenderers: ToolRendererRegistration[],
  artifactRenderers: ArtifactRendererRegistration[],
): WorkbenchRendererRegistry {
  const tools = new Map(
    toolRenderers.map((renderer) => [
      toolKey(renderer.workbenchId, renderer.toolName),
      renderer.component,
    ]),
  );
  const artifacts = new Map(
    artifactRenderers.map((renderer) => [
      artifactKey(renderer.workbenchId, renderer.artifactKind),
      renderer.component,
    ]),
  );
  return {
    resolveTool(workbenchId, toolName) {
      if (toolName.startsWith("mcp_")) return GenericToolActivity;
      return (
        tools.get(toolKey(workbenchId, toolName)) ??
        tools.get(toolKey(undefined, toolName)) ??
        tools.get(toolKey(workbenchId)) ??
        tools.get(toolKey()) ??
        GenericToolActivity
      );
    },
    resolveArtifact(workbenchId, artifactKind) {
      return (
        artifacts.get(artifactKey(workbenchId, artifactKind)) ??
        artifacts.get(artifactKey(workbenchId)) ??
        artifacts.get(artifactKey(undefined, artifactKind)) ??
        artifacts.get(artifactKey()) ??
        GenericArtifactActivity
      );
    },
  };
}

export const workbenchRendererRegistry = createWorkbenchRendererRegistry(
  [
    {
      toolName: "ask_clarifying_question",
      component: ({ block, onResolveClarificationQuestion }) => (
        <ClarificationQuestionToolActivity
          block={block}
          onResolveQuestion={onResolveClarificationQuestion}
        />
      ),
    },
    {
      toolName: "complete_clarification",
      component: ({
        block,
        clarificationHandoffAvailable,
        onHandoffClarification,
      }) => (
        <ClarificationBriefToolActivity
          block={block}
          handoffAvailable={clarificationHandoffAvailable}
          onHandoff={onHandoffClarification}
        />
      ),
    },
    { toolName: "request_user_input", component: UserRequestToolActivity },
    { toolName: "research_delegate", component: ResearchDelegateToolActivity },
    { toolName: "delegate_task", component: SubagentToolActivity },
    { toolName: "delegate_expert", component: SubagentToolActivity },
    { toolName: "bash", component: CodeToolActivity },
    { toolName: "edit", component: CodeToolActivity },
    { toolName: "find", component: CodeToolActivity },
    { toolName: "grep", component: CodeToolActivity },
    { toolName: "ls", component: CodeToolActivity },
    { toolName: "read", component: CodeToolActivity },
    { toolName: "write", component: CodeToolActivity },
    { workbenchId: "code", component: CodeToolActivity },
    { workbenchId: "presentation", component: PresentationToolActivity },
    { workbenchId: "workbook", component: SpreadsheetToolActivity },
  ],
  [{ component: GenericArtifactActivity }],
);
