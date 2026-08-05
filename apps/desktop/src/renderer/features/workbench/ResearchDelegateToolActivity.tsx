import type { MessageToolBlock, ResearchDelegationTask } from "@wordless/domain";
import { BookOpenCheck, Check, CircleAlert, Clock3, PanelRightOpen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import type { ResearchTaskSelection } from "./context-panel-types";
import { researchClaimsSubmitted, researchDelegationDetails, researchDelegationPhase, researchEvidenceCount } from "./research-delegation";

type Props = {
  block: MessageToolBlock;
  researchTaskCallIds?: Record<string, string>;
  onOpenResearchTask?: (selection: ResearchTaskSelection) => void;
  onResolveApproval?: (approvalId: string, approved: boolean, feedback?: string) => void | Promise<void>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function statusTone(status: ResearchDelegationTask["status"]): string {
  if (status === "completed") return "bg-[#789346] dark:bg-[#b9d972]";
  if (status === "failed" || status === "cancelled") return "bg-[#b45f50] dark:bg-[#ef9487]";
  if (status === "awaiting-approval" || status === "awaiting-user-input") return "bg-[#c4933f] dark:bg-[#e4bd6f]";
  if (status === "running") return "bg-[#637fbb] dark:bg-[#91b4f4]";
  return "bg-[#d8d8d1] dark:bg-[#505149]";
}

function StatusIcon({ task }: { task: ResearchDelegationTask }) {
  if (task.status === "completed") return <Check className="h-3.5 w-3.5" />;
  if (task.status === "failed" || task.status === "cancelled" || task.status === "awaiting-approval" || task.status === "awaiting-user-input") return <CircleAlert className="h-3.5 w-3.5" />;
  return <span className={`h-2 w-2 rounded-full ${statusTone(task.status)} ${task.status === "running" ? "motion-safe:animate-pulse" : ""}`} />;
}

function taskPhase(task: ResearchDelegationTask, chinese: boolean): string {
  if (task.status === "queued") return chinese ? "等待调度" : "Queued";
  if (task.status === "awaiting-approval") return chinese ? "等待审批" : "Awaiting approval";
  if (task.status === "awaiting-user-input") return chinese ? "等待输入" : "Awaiting input";
  if (task.status === "completed") return chinese ? "研究完成" : "Completed";
  if (task.status === "failed") return chinese ? "执行失败" : "Failed";
  if (task.status === "cancelled") return chinese ? "已取消" : "Cancelled";
  if (task.activeTool?.name === "research_snapshot") return chinese ? "正在捕获证据" : "Capturing evidence";
  if (task.activeTool?.name === "research_submit_dimension") return chinese ? "正在整理结论" : "Structuring claims";
  if (task.activeTool?.name === "research_review_dimension") return chinese ? "正在审查证据" : "Reviewing evidence";
  if (task.activeTool?.name?.startsWith("mcp_")) return chinese ? "正在搜索来源" : "Searching sources";
  return chinese ? "正在研究" : "Researching";
}

export function ResearchDelegateToolActivity({ block, researchTaskCallIds, onOpenResearchTask, onResolveApproval }: Props) {
  const { locale } = usePreferences();
  const chinese = locale === "zh-CN";
  const details = useMemo(() => researchDelegationDetails(block.details), [block.details]);
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!details || !details.tasks.some((task) => task.status === "running")) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [details]);
  if (!details) return null;

  const completed = details.tasks.filter((task) => task.status === "completed").length;
  const active = details.tasks.filter((task) => task.status === "running" || task.status === "awaiting-approval" || task.status === "awaiting-user-input").length;
  const queued = details.tasks.filter((task) => task.status === "queued").length;
  const terminal = details.tasks.every((task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled");
  const elapsed = Math.max(0, Math.floor(((terminal ? Math.max(...details.tasks.map((task) => task.completedAt ?? details.updatedAt)) : Date.now()) - details.startedAt) / 1_000));

  return (
    <section className="py-4">
      <header className="flex items-start gap-3">
        <div className="relative mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-[#dfe5d2] bg-[#f3f6eb] text-[#60783b] dark:border-[#455334] dark:bg-[#27301f] dark:text-[#c9df8b]">
          <BookOpenCheck className="h-4 w-4" />
          {active > 0 ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border-2 border-white bg-[#637fbb] motion-safe:animate-pulse dark:border-[#1b1d19]" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-[12px] font-semibold text-[#343530] dark:text-foreground">{chinese ? "深度研究" : "Deep research"}</h3>
            <span className="shrink-0 text-[9px] font-medium text-[#6d8240] dark:text-[#b9d972]">{researchDelegationPhase(details, chinese)}</span>
            <span className="rounded-[4px] bg-[#eeefea] px-1.5 py-0.5 font-mono text-[8px] uppercase text-[#777871] dark:bg-muted dark:text-muted-foreground">{details.mode}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[9px] tabular-nums text-[#92938c] dark:text-muted-foreground"><Clock3 className="h-3 w-3" />{elapsed}s</span>
          </div>
          <p className="mt-1 text-[10px] text-[#7b7c75] dark:text-muted-foreground">{completed}/{details.tasks.length} {chinese ? "个维度完成" : "dimensions complete"}{active ? ` · ${active} ${chinese ? "进行中" : "active"}` : ""}{queued ? ` · ${queued} ${chinese ? "等待中" : "queued"}` : ""}</p>
          <div aria-label={`${completed} of ${details.tasks.length} research dimensions complete`} className="mt-2.5 grid h-1.5 gap-1" role="progressbar" style={{ gridTemplateColumns: `repeat(${details.tasks.length}, minmax(0, 1fr))` }}>
            {details.tasks.map((task) => <span className={`overflow-hidden rounded-full bg-[#e4e4de] dark:bg-[#3d3f38]`} key={task.taskId}><span className={`block h-full origin-left rounded-full transition-transform duration-300 motion-reduce:transition-none ${statusTone(task.status)} ${task.status === "queued" ? "scale-x-0" : "scale-x-100"}`} /></span>)}
          </div>
        </div>
      </header>

      <div className="mt-3 divide-y divide-[#e8e8e3] border-y border-[#e8e8e3] dark:divide-border dark:border-border">
        {details.tasks.map((task, index) => {
          const evidenceCount = researchEvidenceCount(task);
          const claimsSubmitted = researchClaimsSubmitted(task);
          const actionable = task.status === "awaiting-approval" || task.status === "awaiting-user-input";
          const approval = record(task.approval);
          const approvalId = typeof approval?.approvalId === "string" ? approval.approvalId : undefined;
          return (
            <div key={task.taskId}>
            <button
              aria-label={`${chinese ? "查看研究维度" : "Open research dimension"} ${task.dimensionName}`}
              className="group flex min-h-12 w-full items-center gap-2.5 px-1.5 py-2 text-left transition-colors duration-150 hover:bg-[#f5f6f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-muted/45"
              onClick={() => onOpenResearchTask?.({ analysisId: details.analysisId, callId: researchTaskCallIds?.[task.taskId] ?? block.callId, taskId: task.taskId, dimensionId: task.dimensionId, details })}
              type="button"
            >
              <span className="w-5 shrink-0 font-mono text-[9px] tabular-nums text-[#a0a199]">{String(index + 1).padStart(2, "0")}</span>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#70716a] dark:text-muted-foreground ${actionable ? "text-[#a57425] dark:text-[#e4bd6f]" : task.status === "failed" ? "text-destructive" : ""}`}><StatusIcon task={task} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2"><span className="truncate text-[11px] font-medium text-[#484943] dark:text-foreground">{task.dimensionName}</span><span className="shrink-0 text-[9px] text-[#888981] dark:text-muted-foreground">{task.agent === "research-reviewer" ? chinese ? "证据审查" : "Review" : chinese ? "研究" : "Research"}</span><span className={`shrink-0 text-[9px] ${actionable ? "font-medium text-[#a57425] dark:text-[#e4bd6f]" : "text-[#888981] dark:text-muted-foreground"}`}>{taskPhase(task, chinese)}</span></span>
                <span className="mt-0.5 block truncate font-mono text-[8px] text-[#a0a199] dark:text-muted-foreground">{evidenceCount ? `${evidenceCount} ${chinese ? "条证据" : "evidence"}` : task.activeTool?.name ?? task.agent}{claimsSubmitted ? ` · ${chinese ? "已提交结论" : "claims submitted"}` : ""}</span>
              </span>
              <PanelRightOpen className="h-3.5 w-3.5 shrink-0 text-[#a2a39c] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
            {approvalId && task.status === "awaiting-approval" && onResolveApproval ? <div className="mb-2 ml-10 mr-1 flex items-center gap-2 rounded-[5px] bg-[#faf4e7] px-2 py-1.5 text-[9px] text-[#8b682b] dark:bg-[#352d20] dark:text-[#e4bd6f]"><span className="min-w-0 flex-1 truncate">{chinese ? "该研究员需要工具审批" : "This researcher needs tool approval"}</span><button aria-label={chinese ? "拒绝" : "Reject"} className="grid h-6 w-6 place-items-center rounded-[4px] hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void onResolveApproval(approvalId, false)} type="button"><X className="h-3.5 w-3.5" /></button><button aria-label={chinese ? "批准" : "Approve"} className="grid h-6 w-6 place-items-center rounded-[4px] bg-[#71612f] text-white hover:bg-[#5e5027] dark:bg-[#d8c078] dark:text-[#29271f]" onClick={() => void onResolveApproval(approvalId, true)} type="button"><Check className="h-3.5 w-3.5" /></button></div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
