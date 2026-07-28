import type { ComponentType, ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Code2,
  FileOutput,
  FilePenLine,
  FolderSearch,
  Image,
  ListTree,
  LoaderCircle,
  Presentation,
  ScanSearch,
  ShieldCheck,
  Terminal,
  UsersRound,
  WandSparkles,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import type { MessageArtifactBlock, MessageToolBlock, WorkbenchId } from "@wordless/domain";
import grepIcon from "../../../icons/common-icons/grep.svg";
import readFileIcon from "../../../icons/common-icons/read_file.svg";
import { usePreferences } from "../../shared/preferences";
import { ClarificationBriefToolActivity, ClarificationQuestionToolActivity } from "./ClarificationToolActivity";
import { UserRequestToolActivity } from "./UserRequestToolActivity";

export type ToolActivityProps = {
  block: MessageToolBlock;
  onLoadToolOutput?: (callId: string) => Promise<void>;
  onResolveApproval?: (approvalId: string, approved: boolean, feedback?: string) => void | Promise<void>;
  onResolveUserRequest?: (
    requestId: string,
    resolution: { status: "submitted" | "cancelled"; answers?: Record<string, string | string[] | boolean>; feedback?: string },
  ) => void | Promise<void>;
  canPlan?: boolean;
  onHandoffClarification?: (interactionMode: "default" | "clarify" | "plan") => void | Promise<void>;
  onResolveClarificationQuestion?: (callId: string, value: string | boolean) => void | Promise<void>;
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
  resolveTool(workbenchId: WorkbenchId, toolName: string): ComponentType<ToolActivityProps>;
  resolveArtifact(workbenchId: WorkbenchId, artifactKind: string): ComponentType<ArtifactActivityProps>;
}

function toolKey(workbenchId?: WorkbenchId, toolName?: string): string {
  return `${workbenchId ?? "*"}:${toolName ?? "*"}`;
}

function artifactKey(workbenchId?: WorkbenchId, artifactKind?: string): string {
  return `${workbenchId ?? "*"}:${artifactKind ?? "*"}`;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function activityIcon(block: MessageToolBlock) {
  if (block.state === "running" || block.state === "pending" || block.state === "awaiting-user-input") return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
  if (block.state === "error") return <CircleAlert className="h-3.5 w-3.5" />;
  return <CheckCircle2 className="h-3.5 w-3.5" />;
}

function activityState(block: MessageToolBlock): string | undefined {
  if (block.state === "awaiting-approval") return "Awaiting approval";
  if (block.state === "awaiting-user-input") return "Waiting for input";
  if (block.state === "running") return "Running";
  if (block.state === "pending") return "Queued";
  if (block.state === "error") return "Failed";
  return undefined;
}

function activityStatusClass(block: MessageToolBlock): string {
  if (block.state === "error") return "text-[#b34b42] dark:text-[#f29a8f]";
  if (block.state === "complete") return "text-[#6c8542] dark:text-[#c3df75]";
  return "text-muted-foreground";
}

function ToolActivityRow({ block, detail, icon, runningLabel, summary }: { block: MessageToolBlock; detail?: string; icon: ReactNode; runningLabel?: string; summary?: string }) {
  const stateLabel = block.state === "complete"
    ? summary ?? "Completed"
    : block.state === "error"
      ? "Failed"
      : block.state === "running" && runningLabel
        ? runningLabel
        : activityState(block);
  const statusClass = activityStatusClass(block);

  return (
    <div className="flex min-h-5 items-center gap-3 text-[13px]">
      <span className={block.state === "error" ? "text-destructive" : "text-[#70842f] dark:text-[#c2df6b]"}>{icon}</span>
      <span className="shrink-0 font-mono text-[12px] text-[#2d2d2a] dark:text-foreground">{block.name}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#777770] dark:text-muted-foreground">{detail ?? ""}</span>
      {stateLabel ? <span className={`hidden shrink-0 text-[12px] sm:block ${block.state === "error" ? statusClass : "text-[#8a8a83] dark:text-muted-foreground"}`}>{stateLabel}</span> : null}
      <span aria-label={stateLabel ?? "Tool status"} className={`shrink-0 ${statusClass}`} role="img">{activityIcon(block)}</span>
    </div>
  );
}

function ToolOutput({ block, onLoadToolOutput }: Pick<ToolActivityProps, "block" | "onLoadToolOutput">) {
  const [loading, setLoading] = useState(false);
  const load = () => {
    if (!block.outputTruncated || !onLoadToolOutput || loading) return;
    setLoading(true);
    void onLoadToolOutput(block.callId).catch(() => {}).finally(() => setLoading(false));
  };
  if (!block.output) return null;
  return <details className="mt-2" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) load(); }}><summary className="cursor-pointer font-mono text-[11px] text-[#777770]">{loading ? "Loading output" : "View output"}</summary><pre className="m-0 mt-2 max-h-52 overflow-auto border-y border-[#e1e1dc] bg-[#fafaf9] px-3 py-2 font-mono text-[11px] leading-5 text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground">{block.output}</pre></details>;
}

function GenericToolActivity({ block, onLoadToolOutput, onResolveApproval }: ToolActivityProps) {
  if (block.state === "awaiting-approval" && block.approval) return <ToolApprovalCard block={block} onResolveApproval={onResolveApproval} />;
  return (
    <section className="py-3">
      <ToolActivityRow block={block} icon={<Wrench className="h-3.5 w-3.5" />} />
      <ToolOutput block={block} onLoadToolOutput={onLoadToolOutput} />
    </section>
  );
}

type SubagentTaskDetails = {
  id: string;
  role: string;
  task: string;
  scope: string;
  expectedOutput: string;
  reason: string;
  status: "queued" | "running" | "awaiting-approval" | "awaiting-user-input" | "completed" | "failed" | "cancelled";
  output?: string;
  usage?: { totalTokens: number; totalCost: number };
  error?: string;
  tool?: { name: string; output?: string; state: "running" | "complete" | "error" };
  approval?: unknown;
  userRequest?: unknown;
};

type SubagentDetails = { mode: "single" | "parallel" | "chain"; tasks: SubagentTaskDetails[] };

function subagentDetails(value: unknown): SubagentDetails | undefined {
  const details = readRecord(value);
  if (!details || (details.mode !== "single" && details.mode !== "parallel" && details.mode !== "chain") || !Array.isArray(details.tasks)) return undefined;
  const tasks = details.tasks.flatMap((candidate): SubagentTaskDetails[] => {
    const task = readRecord(candidate);
    if (!task || typeof task.id !== "string" || typeof task.role !== "string" || typeof task.task !== "string" || typeof task.scope !== "string" || typeof task.expectedOutput !== "string" || typeof task.reason !== "string") return [];
    if (task.status !== "queued" && task.status !== "running" && task.status !== "awaiting-approval" && task.status !== "awaiting-user-input" && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled") return [];
    const usage = readRecord(task.usage);
    const tool = readRecord(task.tool);
    return [{
      id: task.id,
      role: task.role,
      task: task.task,
      scope: task.scope,
      expectedOutput: task.expectedOutput,
      reason: task.reason,
      status: task.status,
      ...(typeof task.output === "string" ? { output: task.output } : {}),
      ...(typeof task.error === "string" ? { error: task.error } : {}),
      ...(typeof usage?.totalTokens === "number" && typeof usage.totalCost === "number" ? { usage: { totalTokens: usage.totalTokens, totalCost: usage.totalCost } } : {}),
      ...(typeof tool?.name === "string" && (tool.state === "running" || tool.state === "complete" || tool.state === "error") ? { tool: { name: tool.name, state: tool.state, ...(typeof tool.output === "string" ? { output: tool.output } : {}) } } : {}),
      ...(task.approval !== undefined ? { approval: task.approval } : {}),
      ...(task.userRequest !== undefined ? { userRequest: task.userRequest } : {}),
    }];
  });
  return { mode: details.mode, tasks };
}

function nestedApproval(task: SubagentTaskDetails): MessageToolBlock["approval"] | undefined {
  const value = readRecord(task.approval);
  const preview = readRecord(value?.preview);
  if (!value || typeof value.approvalId !== "string" || (value.status !== "required" && value.status !== "approved" && value.status !== "rejected") || (value.risk !== "file-write" && value.risk !== "command" && value.risk !== "connector") || (value.severity !== "normal" && value.severity !== "high") || typeof value.summary !== "string" || !preview || typeof preview.type !== "string" || !Array.isArray(value.matchedRules)) return undefined;
  return value as unknown as MessageToolBlock["approval"];
}

function nestedUserRequest(task: SubagentTaskDetails): MessageToolBlock["userRequest"] | undefined {
  const interaction = readRecord(task.userRequest);
  const request = readRecord(interaction?.request) ?? interaction;
  if (!request || typeof request.requestId !== "string" || typeof request.callId !== "string" || typeof request.toolName !== "string" || typeof request.title !== "string" || !Array.isArray(request.fields)) return undefined;
  const resolution = readRecord(interaction?.resolution);
  return {
    request: request as unknown as NonNullable<MessageToolBlock["userRequest"]>["request"],
    ...(resolution ? { resolution: resolution as unknown as NonNullable<MessageToolBlock["userRequest"]>["resolution"] } : {}),
  };
}

function subagentState(task: SubagentTaskDetails) {
  if (task.status === "completed") return <Check className="h-3.5 w-3.5 text-[#6c8542] dark:text-[#c3df75]" />;
  if (task.status === "failed" || task.status === "cancelled") return <CircleAlert className="h-3.5 w-3.5 text-destructive" />;
  return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#738a44] dark:text-[#c2df6b]" />;
}

function SubagentToolActivity({ block, onLoadToolOutput, onResolveApproval, onResolveUserRequest }: ToolActivityProps) {
  const details = subagentDetails(block.details);
  if (!details) return <GenericToolActivity block={block} onLoadToolOutput={onLoadToolOutput} />;
  return <section className="py-3.5">
    <div className="flex items-center gap-2 text-[12px]"><UsersRound className="h-3.5 w-3.5 text-[#6d8240] dark:text-[#c3df75]" /><span className="font-semibold text-[#41413c] dark:text-foreground">Subagents</span><span className="font-mono text-[10px] uppercase text-[#93938b]">{details.mode}</span><span className="ml-auto font-mono text-[10px] text-[#93938b]">{details.tasks.filter((task) => task.status === "completed").length}/{details.tasks.length}</span></div>
    <div className="mt-2 divide-y divide-[#e7e7e2] border-y border-[#e7e7e2] dark:divide-border dark:border-border">
      {details.tasks.map((task) => {
        const approval = nestedApproval(task);
        const userRequest = nestedUserRequest(task);
        const nestedBlock: MessageToolBlock = { type: "tool", callId: task.id, name: task.tool?.name ?? "delegate_task", state: task.status === "awaiting-approval" ? "awaiting-approval" : task.status === "awaiting-user-input" ? "awaiting-user-input" : task.status === "failed" ? "error" : task.status === "completed" ? "complete" : "running", ...(approval ? { approval } : {}), ...(userRequest ? { userRequest } : {}) };
        return <div className="px-1 py-3" key={task.id}>
          <div className="flex items-start gap-2.5"><span className="mt-0.5">{subagentState(task)}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[11px] font-semibold text-[#4c4c47] dark:text-foreground">{task.role}</span><span className="truncate text-[11px] text-[#82827b] dark:text-muted-foreground">{task.scope}</span><span className="ml-auto shrink-0 font-mono text-[10px] text-[#999991]">{task.status}</span></div><p className="mt-1 text-[12px] leading-5 text-[#5b5b55] dark:text-muted-foreground">{task.task}</p>{task.tool ? <p className="mt-1 font-mono text-[10px] text-[#888880] dark:text-muted-foreground">{task.tool.name}{task.tool.output ? ` · ${task.tool.output.slice(-120)}` : ""}</p> : null}</div></div>
          {approval && task.status === "awaiting-approval" ? <ToolApprovalCard block={nestedBlock} onResolveApproval={onResolveApproval} /> : null}
          {userRequest && task.status === "awaiting-user-input" ? <UserRequestToolActivity block={nestedBlock} onResolveUserRequest={onResolveUserRequest} /> : null}
          {task.output ? <details className="mt-2"><summary className="cursor-pointer font-mono text-[10px] text-[#777770]">View result</summary><pre className="m-0 mt-2 max-h-60 overflow-auto border-y border-[#e1e1dc] bg-[#fafaf9] px-3 py-2 whitespace-pre-wrap font-mono text-[11px] leading-5 text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground">{task.output}</pre></details> : null}
          {task.error ? <p className="mt-2 text-[11px] text-destructive">{task.error}</p> : null}
          {task.usage ? <p className="mt-2 font-mono text-[10px] text-[#92928a]">{task.usage.totalTokens.toLocaleString()} tokens · ${task.usage.totalCost.toFixed(4)}</p> : null}
        </div>;
      })}
    </div>
  </section>;
}

function CodeToolActivity({ block, onLoadToolOutput, onResolveApproval }: ToolActivityProps) {
  const inputPath = textValue(block.input?.path);
  const command = textValue(block.input?.command);
  const details = readRecord(block.details);
  const detailPath = textValue(details?.path);
  const path = inputPath ?? detailPath;
  const changed = readRecord(details?.diff);
  const oldText = textValue(changed?.oldText);
  const newText = textValue(changed?.newText);
  const exitCode = typeof details?.exitCode === "number" ? details.exitCode : undefined;
  const icon = block.name === "bash" ? <Terminal className="h-3.5 w-3.5" /> : block.name === "edit" || block.name === "write" ? <FilePenLine className="h-3.5 w-3.5" /> : block.name === "read" ? <img alt="" className="h-3.5 w-3.5 dark:invert" src={readFileIcon} /> : block.name === "grep" ? <img alt="" className="h-3.5 w-3.5 dark:invert" src={grepIcon} /> : block.name === "ls" || block.name === "find" ? <FolderSearch className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />;
  if (block.state === "awaiting-approval" && block.approval) return <ToolApprovalCard block={block} onResolveApproval={onResolveApproval} />;
  const summary = block.name === "read" && typeof details?.lineCount === "number"
    ? `${details.lineCount} lines read`
    : block.name === "grep" && typeof details?.count === "number"
      ? `${details.count} matches`
      : block.name === "find" && typeof details?.count === "number"
        ? `${details.count} files found`
        : activityState(block);

  return (
    <section className="py-3">
      <ToolActivityRow block={block} detail={command ?? path} icon={icon} summary={summary} />
      {oldText !== undefined && newText !== undefined ? <details className="mt-2"><summary className="cursor-pointer font-mono text-[11px] text-[#777770]">View change</summary><div className="mt-2 grid overflow-hidden border-y border-[#e1e1dc] font-mono text-[11px] leading-5 dark:border-border"><pre className="m-0 max-h-40 overflow-auto bg-[#fbefec] px-3 text-[#9a564b] dark:bg-[#3a211d] dark:text-[#ffb4a8]">- {oldText}</pre><pre className="m-0 max-h-40 overflow-auto bg-[#eff7e7] px-3 text-[#547c36] dark:bg-[#29351d] dark:text-[#d8f28a]">+ {newText}</pre></div></details> : null}
      <ToolOutput block={block} onLoadToolOutput={onLoadToolOutput} />
      {exitCode !== undefined ? <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"><ListTree className="h-3 w-3" />Exit {exitCode}</p> : null}
    </section>
  );
}

function jsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function PresentationToolActivity({ block, onLoadToolOutput, onResolveApproval }: ToolActivityProps) {
  if (block.state === "awaiting-approval" && block.approval) return <ToolApprovalCard block={block} onResolveApproval={onResolveApproval} />;

  const details = readRecord(block.details);
  const artifact = readRecord(details?.artifact);
  const quality = readRecord(details?.quality);
  const outline = block.name === "presentation_inspect" || (block.name === "presentation_read" && readRecord(block.input?.request)?.mode === "outline") ? jsonRecord(block.output) : undefined;
  const surfaces = Array.isArray(details?.surfaces) ? details.surfaces : [];
  const issues = Array.isArray(quality?.issues) ? quality.issues : Array.isArray(details?.issues) ? details.issues : [];
  const artifacts = Array.isArray(details?.artifacts) ? details.artifacts : [];
  const revision = typeof details?.revision === "number"
    ? details.revision
    : typeof artifact?.revision === "number" ? artifact.revision : undefined;
  const displayName = textValue(artifact?.displayName) ?? textValue(block.input?.name);
  const operationCount = typeof details?.operationCount === "number"
    ? details.operationCount
    : Array.isArray(block.input?.operations) ? block.input.operations.length : undefined;
  const slideCount = typeof outline?.totalSlides === "number" ? outline.totalSlides : undefined;

  const presentation = block.name === "presentation_create"
    ? { icon: <Presentation className="h-3.5 w-3.5" />, running: "Creating presentation", detail: displayName, summary: displayName ? `Created ${displayName}` : "Presentation created" }
    : block.name === "presentation_apply" || block.name === "presentation_edit"
      ? { icon: <WandSparkles className="h-3.5 w-3.5" />, running: "Applying changes", detail: displayName, summary: [operationCount === undefined ? undefined : `${operationCount} changes`, revision === undefined ? undefined : `revision ${revision}`].filter(Boolean).join(" · ") || "Changes applied" }
      : block.name === "presentation_render"
        ? { icon: <Image className="h-3.5 w-3.5" />, running: "Rendering slides", detail: revision === undefined ? undefined : `revision ${revision}`, summary: [surfaces.length > 0 ? `${surfaces.length} slides` : undefined, revision === undefined ? undefined : `revision ${revision}`].filter(Boolean).join(" · ") || "Preview rendered" }
        : block.name === "presentation_inspect" || block.name === "presentation_read"
          ? { icon: <ScanSearch className="h-3.5 w-3.5" />, running: "Inspecting presentation", detail: textValue(block.input?.artifactId), summary: slideCount === undefined ? "Inspection complete" : `${slideCount} slides inspected` }
          : block.name === "presentation_validate" || block.name === "presentation_quality_scan" || block.name === "presentation_quality_review"
            ? { icon: <ShieldCheck className="h-3.5 w-3.5" />, running: "Checking presentation", detail: textValue(block.input?.artifactId), summary: issues.length === 0 ? "Validation passed" : `${issues.length} issue${issues.length === 1 ? "" : "s"}` }
            : block.name === "presentation_publish"
              ? { icon: <FileOutput className="h-3.5 w-3.5" />, running: "Preparing output", detail: displayName, summary: displayName ? `${displayName} ready` : artifacts.length === 0 ? "Output ready" : `${artifacts.length} presentation${artifacts.length === 1 ? "" : "s"} ready` }
              : block.name === "presentation_help" || block.name === "presentation_guidance"
                ? { icon: <ScanSearch className="h-3.5 w-3.5" />, running: "Loading OfficeCLI guidance", detail: textValue(block.input?.element) ?? textValue(block.input?.name), summary: "Guidance loaded" }
                : block.name === "presentation_sources"
                  ? { icon: <FileOutput className="h-3.5 w-3.5" />, running: "Registering sources", detail: textValue(block.input?.artifactId), summary: "Sources registered" }
                  : { icon: <Presentation className="h-3.5 w-3.5" />, running: "Running presentation tool", detail: undefined, summary: "Completed" };

  return (
    <section className="py-3">
      <ToolActivityRow block={block} detail={presentation.detail} icon={presentation.icon} runningLabel={presentation.running} summary={presentation.summary} />
      {block.state === "error" && block.output ? <p className="mt-2 max-h-10 overflow-hidden whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-destructive">{block.output}</p> : null}
      <ToolOutput block={block} onLoadToolOutput={onLoadToolOutput} />
    </section>
  );
}

function ToolApprovalCard({ block, onResolveApproval }: ToolActivityProps) {
  const { t } = usePreferences();
  const [rejected, setRejected] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const approval = block.approval;
  if (!approval) return null;
  const submit = async (approved: boolean) => {
    if (!approved) {
      setRejected(true);
      return;
    }
    if (!onResolveApproval) {
      setError("Approval controls are unavailable for this session.");
      return;
    }
    setError(null);
    setResolving(true);
    try {
      await onResolveApproval(approval.approvalId, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResolving(false);
    }
  };
  const preview = approval.preview;
  const highRisk = approval.severity === "high";
  return (
    <section className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[13px] font-semibold">需要你的确认</p><p className="mt-1 font-mono text-[10px] text-[#6e6e68] dark:text-muted-foreground">{block.name} · {preview.type === "diff" ? preview.path : preview.type === "command" ? preview.command : `${preview.connectorName} / ${preview.toolName}`}</p></div><div className="flex items-center gap-2">{highRisk ? <span className="rounded bg-[#f9e9e6] px-1.5 py-0.5 text-[10px] font-semibold text-[#b34b42] dark:bg-[#3a241f] dark:text-[#f29a8f]">{t("highRisk")}</span> : null}<span className={highRisk ? "text-[10px] font-medium text-[#a34b40] dark:text-[#f29a8f]" : "text-[10px] font-medium text-[#8b604c]"}>{approval.risk === "command" ? "小心：将运行本地命令" : approval.risk === "connector" ? "小心：将调用外部连接器" : "小心：将修改本地文件"}</span></div></div>
      {preview.type === "diff" ? <div className="mt-3 max-h-48 overflow-auto border-y border-[#e1e1dc] bg-[#fafaf9] font-mono text-[10px] leading-5 dark:border-border dark:bg-muted"><div className="border-b border-[#e8e8e3] bg-[#f2f2ef] px-3 py-1.5 text-[#777770] dark:border-border dark:bg-secondary">@@ {preview.path}</div><pre className="m-0 whitespace-pre-wrap bg-[#fbefec] px-3 text-[#9a564b] dark:bg-[#3a211d] dark:text-[#ffb4a8]">- {preview.before}</pre><pre className="m-0 whitespace-pre-wrap bg-[#eff7e7] px-3 text-[#547c36] dark:bg-[#29351d] dark:text-[#d8f28a]">+ {preview.after}</pre></div> : preview.type === "command" ? <div className="mt-3 border-y border-[#e1e1dc] bg-[#fafaf9] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground"><p>{preview.command}</p><p className="mt-1 text-[#878780]">cwd: {preview.cwd}{preview.timeoutSeconds ? ` · timeout: ${preview.timeoutSeconds}s` : ""}</p></div> : <div className="mt-3 border-y border-[#e1e1dc] bg-[#fafaf9] px-3 py-2.5 font-mono text-[10px] leading-5 text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground"><p>{preview.connectorName} / {preview.toolName}</p><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[#777770]">{JSON.stringify(preview.input, null, 2)}</pre></div>}
      {approval.matchedRules.length > 0 ? <div className="mt-3 border-l-2 border-[#d98477] bg-[#fdf8f6] px-3 py-2 dark:border-[#9b554b] dark:bg-[#2b201d]"><p className="text-[10px] font-semibold text-[#8b5045] dark:text-[#efb0a3]">{t("matchedSecurityRules")}</p><ul className="mt-1 space-y-0.5 text-[10px] text-[#795f59] dark:text-[#d7b9b1]">{approval.matchedRules.map((rule) => <li key={rule.id}>{rule.label} · {rule.source === "builtin" ? t("builtinRule") : t("customRules")}</li>)}</ul></div> : null}
      <div className="mt-3 flex items-center gap-1.5"><button aria-label="Reject operation" className="grid h-7 w-7 place-items-center rounded-[6px] text-[#7b5d52] hover:bg-[#f8efeb] disabled:opacity-50" disabled={resolving} onClick={() => void submit(false)} title="拒绝" type="button"><X className="h-4 w-4" /></button><button aria-label="Approve operation" className="grid h-7 w-7 place-items-center rounded-[6px] bg-[#252624] text-white hover:bg-[#3a3b37] disabled:opacity-50" disabled={resolving} onClick={() => void submit(true)} title="批准并执行" type="button"><Check className="h-4 w-4" /></button></div>
      {error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}
      {rejected ? <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className="min-w-0 flex-1 rounded-[7px] border border-[#dcdcd6] bg-white px-3 py-2 text-[12px] outline-none placeholder:text-[#9c9c95] dark:border-border dark:bg-card" onChange={(event) => setFeedback(event.target.value)} placeholder="告诉 Agent 应如何调整（可选）" value={feedback} /><button className="rounded-[7px] border border-[#d5d5cf] bg-white px-3 py-2 text-[12px] font-semibold text-[#4c4c47] hover:bg-[#f5f5f2] dark:border-border dark:bg-card dark:text-foreground" disabled={resolving} onClick={() => { if (onResolveApproval) void Promise.resolve(onResolveApproval(approval.approvalId, false, feedback || undefined)).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))); }} type="button">提交拒绝原因</button></div> : null}
    </section>
  );
}

function GenericArtifactActivity({ block }: ArtifactActivityProps) {
  return <div className="rounded-[7px] border border-border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground">{block.name}</div>;
}

export function createWorkbenchRendererRegistry(
  toolRenderers: ToolRendererRegistration[],
  artifactRenderers: ArtifactRendererRegistration[],
): WorkbenchRendererRegistry {
  const tools = new Map(toolRenderers.map((renderer) => [toolKey(renderer.workbenchId, renderer.toolName), renderer.component]));
  const artifacts = new Map(artifactRenderers.map((renderer) => [artifactKey(renderer.workbenchId, renderer.artifactKind), renderer.component]));
  return {
    resolveTool(workbenchId, toolName) {
      return tools.get(toolKey(workbenchId, toolName)) ?? tools.get(toolKey(undefined, toolName)) ?? tools.get(toolKey(workbenchId)) ?? tools.get(toolKey()) ?? GenericToolActivity;
    },
    resolveArtifact(workbenchId, artifactKind) {
      return artifacts.get(artifactKey(workbenchId, artifactKind)) ?? artifacts.get(artifactKey(workbenchId)) ?? artifacts.get(artifactKey(undefined, artifactKind)) ?? artifacts.get(artifactKey()) ?? GenericArtifactActivity;
    },
  };
}

export const workbenchRendererRegistry = createWorkbenchRendererRegistry(
  [
    { toolName: "ask_clarifying_question", component: ({ block, onResolveClarificationQuestion }) => <ClarificationQuestionToolActivity block={block} onResolveQuestion={onResolveClarificationQuestion} /> },
    { toolName: "complete_clarification", component: ({ block, canPlan, onHandoffClarification }) => <ClarificationBriefToolActivity block={block} canPlan={canPlan} onHandoff={onHandoffClarification} /> },
    { toolName: "request_user_input", component: UserRequestToolActivity },
    { toolName: "delegate_task", component: SubagentToolActivity },
    { workbenchId: "code", component: CodeToolActivity },
    { workbenchId: "presentation", component: PresentationToolActivity },
  ],
  [{ component: GenericArtifactActivity }],
);
