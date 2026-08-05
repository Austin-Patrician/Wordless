import type { AnalysisRunDescriptor, SessionViewSnapshot } from "@wordless/protocol";
import type { ResearchDelegationDetails, ResearchDelegationEvent, ResearchDelegationTask } from "@wordless/domain";
import { ArrowLeft, BookOpenCheck, Check, CircleAlert, ExternalLink, FileSearch, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import type { RuntimeClient } from "../../bridge/runtime-client";
import type { ResearchTaskSelection } from "../workbench/context-panel-types";
import { researchDelegationDetails } from "../workbench/research-delegation";

type Props = {
  client: RuntimeClient;
  run: AnalysisRunDescriptor | null;
  sessionId: string;
  selection: ResearchTaskSelection;
  onBack: () => void;
};

function taskFromView(view: SessionViewSnapshot, selection: ResearchTaskSelection): ResearchDelegationTask | undefined {
  const messages = view.history.items.flatMap((item) => item.type === "turn" ? item.turn.messages : []);
  for (const message of messages) {
    const block = message.blocks.find((candidate) => candidate.type === "tool" && candidate.callId === selection.callId);
    if (block?.type !== "tool") continue;
    const details = researchDelegationDetails(block.details);
    const task = details?.tasks.find((candidate) => candidate.taskId === selection.taskId || candidate.dimensionId === selection.dimensionId);
    if (task) return task;
  }
  return undefined;
}

function eventIcon(event: ResearchDelegationEvent) {
  if (event.state === "error") return <CircleAlert className="h-3.5 w-3.5 text-[#b45f50] dark:text-[#ef9487]" />;
  if (event.state === "complete") return <Check className="h-3.5 w-3.5 text-[#789346] dark:text-[#b9d972]" />;
  return <LoaderCircle className="h-3.5 w-3.5 text-[#637fbb] motion-safe:animate-spin dark:text-[#91b4f4]" />;
}

function shortTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function InspectorActivity({ task, chinese }: { task: ResearchDelegationTask; chinese: boolean }) {
  return <div className="mt-3"><div className="border-l border-[#dfe2d8] pl-3 dark:border-border">{task.events.length === 0 ? <p className="py-8 text-center text-[10px] text-muted-foreground">{chinese ? "等待第一个工具事件…" : "Waiting for the first tool event…"}</p> : task.events.map((event) => <div className="relative pb-4 last:pb-1" key={event.id}><span className="absolute -left-[19px] top-0.5 grid h-4 w-4 place-items-center rounded-full bg-[var(--wordless-shell-workspace)]">{eventIcon(event)}</span><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-[10px] font-medium text-[#44453f] dark:text-foreground">{event.label}</p><p className="mt-0.5 font-mono text-[8px] text-muted-foreground">{event.toolName ?? "status"} · {shortTime(event.timestamp)}</p>{event.inputSummary ? <details className="mt-1"><summary className="cursor-pointer text-[9px] text-[#77816c] dark:text-[#b8cd91]">{chinese ? "查看输入摘要" : "View input summary"}</summary><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-muted/50 p-1.5 font-mono text-[8px] leading-4 text-muted-foreground">{event.inputSummary}</pre></details> : null}{event.outputPreview ? <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[8px] leading-4 text-muted-foreground">{event.outputPreview}</p> : null}</div></div></div>)}</div>{task.error ? <p className="mt-3 rounded-[5px] bg-[#f8e8e5] px-2.5 py-2 text-[9px] leading-4 text-[#a34b42] dark:bg-[#432622] dark:text-[#f0aaa0]" role="alert">{task.error}</p> : null}{task.output ? <details className="mt-3"><summary className="cursor-pointer text-[9px] font-medium text-[#77816c] dark:text-[#b8cd91]">{chinese ? "查看子任务输出" : "View task output"}</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[4px] bg-muted/50 p-2 font-mono text-[8px] leading-4 text-muted-foreground">{task.output}</pre></details> : null}</div>;
}

export function ResearchInspector({ client, run, selection, sessionId, onBack }: Props) {
  const { locale } = usePreferences();
  const chinese = locale === "zh-CN";
  const [task, setTask] = useState<ResearchDelegationTask | undefined>(() => selection.details?.tasks.find((candidate) => candidate.taskId === selection.taskId || candidate.dimensionId === selection.dimensionId));
  const [tab, setTab] = useState<"activity" | "evidence" | "result">("activity");
  useEffect(() => {
    let active = true;
    setTask(selection.details?.tasks.find((candidate) => candidate.taskId === selection.taskId || candidate.dimensionId === selection.dimensionId));
    void client.getSessionView(sessionId).then((view) => { if (active) setTask(taskFromView(view, selection)); }).catch(() => {});
    const unsubscribe = client.subscribe((event) => {
      if (!active || event.sessionId !== sessionId) return;
      if (event.event.type === "tool.updated" || event.event.type === "tool.completed") {
        if (event.event.callId !== selection.callId || !event.event.details) return;
        const details = researchDelegationDetails(event.event.details);
        setTask(details?.tasks.find((candidate) => candidate.taskId === selection.taskId || candidate.dimensionId === selection.dimensionId));
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [client, selection, sessionId]);

  const selectedRun = run?.id === selection.analysisId ? run : null;
  const selectedDimension = selectedRun?.research?.dimensions.find((dimension) => dimension.id === selection.dimensionId);
  const claims = useMemo(() => selectedRun?.research?.claims.filter((claim) => claim.dimensionId === selection.dimensionId) ?? [], [selectedRun, selection.dimensionId]);
  const sourceIds = useMemo(() => new Set(claims.flatMap((claim) => claim.evidenceRefs)), [claims]);
  const sources = selectedRun?.research?.sources.filter((source) => sourceIds.has(source.id)) ?? [];
  const missingRun = !selectedRun;
  const missingStructuredResult = task?.status === "completed" && claims.length === 0;

  return <section className="research-inspector min-h-0 flex-1 overflow-y-auto px-4 py-3">
    <header className="border-b border-[#e5e5df] pb-3 dark:border-border">
      <button aria-label={chinese ? "返回 Deep Research 总览" : "Back to Deep Research overview"} className="mb-3 flex items-center gap-1 text-[10px] font-medium text-[#687b4d] hover:text-[#465a31] dark:text-[#c3df85]" onClick={onBack} type="button"><ArrowLeft className="h-3.5 w-3.5" />{chinese ? "Deep Research 总览" : "Deep Research overview"}</button>
      <div className="flex items-start gap-2"><div className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] bg-[#edf2df] text-[#607a35] dark:bg-[#29351d] dark:text-[#c8e883]"><BookOpenCheck className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold" title={selectedDimension?.name ?? task?.dimensionName ?? selection.dimensionId}>{selectedDimension?.name ?? task?.dimensionName ?? selection.dimensionId}</p><p className="mt-0.5 line-clamp-2 text-[9px] leading-4 text-muted-foreground" title={selectedDimension?.question ?? task?.question}>{selectedDimension?.question ?? task?.question}</p></div></div>
      <div className="mt-3 flex items-center gap-1 rounded-[6px] bg-muted/60 p-0.5" role="tablist">
        {(["activity", "evidence", "result"] as const).map((item) => <button aria-selected={tab === item} className={`flex-1 rounded-[4px] px-1.5 py-1.5 text-[9px] font-medium transition-colors ${tab === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} key={item} onClick={() => setTab(item)} role="tab" type="button">{item === "activity" ? chinese ? "活动" : "Activity" : item === "evidence" ? chinese ? "证据" : "Evidence" : chinese ? "结果" : "Result"}</button>)}
      </div>
    </header>
    {!task ? <div className="grid min-h-40 place-items-center text-center text-[10px] text-muted-foreground"><FileSearch className="h-5 w-5 opacity-50" /><p className="mt-2">{chinese ? "正在加载研究轨迹…" : "Loading research trace…"}</p></div> : tab === "activity" ? <InspectorActivity chinese={chinese} task={task} /> : missingRun ? <div className="mt-3 rounded-[5px] bg-[#f8e8e5] px-2.5 py-3 text-[10px] leading-4 text-[#a34b42] dark:bg-[#432622] dark:text-[#f0aaa0]" role="alert">{chinese ? `找不到该任务对应的分析结果（${selection.analysisId}）。` : `The analysis result for this task is unavailable (${selection.analysisId}).`}</div> : tab === "evidence" ? <div className="mt-3 space-y-2">{sources.length === 0 ? <p className={`py-8 text-center text-[10px] ${missingStructuredResult ? "text-destructive" : "text-muted-foreground"}`}>{missingStructuredResult ? chinese ? "任务已结束，但没有写入可验证来源。请查看活动中的错误。" : "The task finished without writing verifiable sources. Check Activity for errors." : chinese ? "该维度还没有已确认来源。" : "No confirmed sources for this dimension yet."}</p> : sources.map((source) => <button className="flex w-full items-start gap-2 border-b border-border/70 py-2 text-left hover:text-[#587846]" key={source.id} onClick={() => void client.openExternalUrl(source.url)} type="button"><span className="min-w-0 flex-1"><span className="block text-[10px] font-medium leading-4">{source.title}</span><span className="mt-0.5 block truncate font-mono text-[8px] text-muted-foreground">{source.publisher ?? source.url}</span></span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" /></button>)}</div> : <div className="mt-3 space-y-3">{claims.length === 0 ? <p className={`py-8 text-center text-[10px] ${missingStructuredResult ? "text-destructive" : "text-muted-foreground"}`}>{missingStructuredResult ? chinese ? "任务已结束，但没有提交结构化结论。请查看活动中的错误。" : "The task finished without submitting structured claims. Check Activity for errors." : chinese ? "该维度还没有提交结构化结论。" : "No structured claims submitted yet."}</p> : claims.map((claim) => <article className="border-b border-border/70 pb-3" key={claim.id}><p className="text-[10px] leading-4">{claim.statement}</p><p className="mt-1 font-mono text-[8px] uppercase text-muted-foreground">{claim.confidence} · {claim.evidenceRefs.length} {chinese ? "条引用" : "citations"}</p>{claim.caveats.length > 0 ? <p className="mt-1 text-[9px] leading-4 text-[#8a6623]">{claim.caveats.join(" · ")}</p> : null}</article>)}</div>}
  </section>;
}
