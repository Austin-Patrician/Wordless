import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@wordless/ui-kit";
import { BarChart3, BookOpenCheck, ExternalLink, FileCode2, FileJson2, FileText, FolderOpen, RefreshCw, TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalysisRunDescriptor, AnalysisSessionSnapshot } from "@wordless/protocol";
import { useRuntimeClient } from "../../shared/runtime";
import type { WorkbenchContextPanelProps } from "../workbench/context-panel-types";
import { resolveAnalysisReportLink } from "./analysis-report-links";

function emptySnapshot(): AnalysisSessionSnapshot {
  return { sessionId: "", capabilities: { status: "missing", command: null, version: null, supportedFormats: [] }, runs: [] };
}

function outputIcon(kind: AnalysisRunDescriptor["files"][number]["kind"]) {
  if (kind === "chart") return BarChart3;
  if (kind === "manifest") return FileJson2;
  if (kind === "script") return FileCode2;
  return FileText;
}

export function AnalysisContextPanel({ onViewChange, sessionId, view }: WorkbenchContextPanelProps) {
  const client = useRuntimeClient();
  const [snapshot, setSnapshot] = useState<AnalysisSessionSnapshot>(emptySnapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await client.getAnalysisSnapshot(sessionId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [client, sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => client.subscribe((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.event.type === "tool.updated" || event.event.type === "tool.completed" || event.event.type === "run.completed" || event.event.type === "run.failed") void refresh();
  }), [client, refresh, sessionId]);

  const selected = useMemo(() => snapshot.runs.find((run) => run.id === selectedId) ?? snapshot.runs[0] ?? null, [selectedId, snapshot.runs]);
  useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id); }, [selected, selectedId]);

  const content = view === "report"
    ? <AnalysisReport run={selected} loading={loading} onRefresh={() => void refresh()} />
    : view === "research"
      ? <AnalysisResearch client={client} run={selected} />
    : view === "data"
      ? <AnalysisData run={selected} loading={loading} />
      : view === "charts"
        ? <AnalysisCharts run={selected} />
        : view === "files"
          ? <AnalysisFiles client={client} run={selected} />
          : null;
  if (content) return <div className="flex min-h-0 flex-1 flex-col">{snapshot.runs.length > 1 && selected ? <div className="shrink-0 border-b border-[#e4e4df] px-3 py-2 dark:border-border"><Select onValueChange={setSelectedId} value={selected.id}><SelectTrigger aria-label="Select analysis" className="h-7 w-full rounded-[5px] border-0 bg-transparent px-2 text-[10px] font-medium shadow-none hover:bg-muted/60"><SelectValue /></SelectTrigger><SelectContent>{snapshot.runs.map((run) => <SelectItem className="text-[10px]" key={run.id} value={run.id}>{run.title}</SelectItem>)}</SelectContent></Select></div> : null}{content}</div>;

  return <section className="min-h-0 flex-1 overflow-y-auto p-4"><div className="flex items-center gap-2"><div className="grid h-7 w-7 place-items-center rounded-[6px] bg-[#edf2df] text-[#607a35] dark:bg-[#29351d] dark:text-[#c8e883]"><BarChart3 className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><h2 className="truncate text-[12px] font-semibold">Data analysis</h2><p className="truncate text-[10px] text-muted-foreground">{snapshot.capabilities.status === "ready" ? snapshot.capabilities.version : snapshot.capabilities.message ?? "Analysis runtime unavailable"}</p></div><Button aria-label="Refresh analysis" onClick={() => void refresh()} size="icon" type="button" variant="ghost"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button></div>{error ? <p className="mt-4 text-[10px] text-destructive">{error}</p> : null}{snapshot.runs.length === 0 ? <div className="mt-10 text-center text-[11px] text-muted-foreground"><BarChart3 className="mx-auto h-5 w-5 opacity-50" /><p className="mt-3">Start with a data file in this workspace.</p></div> : <div className="mt-5 space-y-1.5">{snapshot.runs.map((run) => <button className={`flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left ${run.id === selected?.id ? "bg-[#edf2df] text-[#435b22] dark:bg-[#29351d] dark:text-[#d3ec9c]" : "hover:bg-muted/60"}`} key={run.id} onClick={() => { setSelectedId(run.id); onViewChange("report"); }} type="button"><span className="min-w-0 flex-1 truncate text-[11px] font-medium">{run.title}</span><span className="text-[9px] text-muted-foreground">{run.status}</span></button>)}</div>}</section>;
}

function AnalysisRunPicker(_props: { run: AnalysisRunDescriptor | null }) {
  return null;
}

function AnalysisReport({ run, loading, onRefresh }: { run: AnalysisRunDescriptor | null; loading: boolean; onRefresh: () => void }) {
  const client = useRuntimeClient();
  const [linkError, setLinkError] = useState<string | null>(null);
  if (!run) return <EmptyAnalysis />;
  const chartByPath = new Map(run.charts.map((chart) => [chart.path.replace(/\\/g, "/"), chart]));
  const openLink = async (href: string | undefined) => {
    const link = resolveAnalysisReportLink(href, run.outputRoot);
    if (!link || link.kind === "anchor") return;
    setLinkError(null);
    try {
      if (link.kind === "external") await client.openExternalUrl(link.url);
      else if (link.kind === "output") await client.openAnalysisOutput(run.sessionId, run.id, link.path);
      else await client.openSessionWorkspaceFile(run.sessionId, link.path);
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return <section className="min-h-0 flex-1 overflow-y-auto p-4"><div className="flex items-center"><AnalysisRunPicker run={run} /><Button aria-label="Refresh report" className="ml-auto" disabled={loading} onClick={onRefresh} size="icon" type="button" variant="ghost"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button></div>{linkError ? <p className="mb-2 rounded-[5px] bg-[#f8e8e5] px-2.5 py-2 text-[10px] text-[#a34b42] dark:bg-[#432622] dark:text-[#f0aaa0]">{linkError}</p> : null}{run.errors.map((message) => <p className="mb-2 rounded-[5px] bg-[#f8e8e5] px-2.5 py-2 text-[10px] text-[#a34b42] dark:bg-[#432622] dark:text-[#f0aaa0]" key={message}>{message}</p>)}{run.reportContent ? <div className="analysis-report text-[11px] leading-5 text-[#53534d] dark:text-muted-foreground"><ReactMarkdown components={{ a: ({ children, href }) => { const link = resolveAnalysisReportLink(href, run.outputRoot); return link && link.kind !== "anchor" ? <button className="inline break-all font-medium text-[#587846] underline decoration-[#a8bb91] underline-offset-2 hover:text-[#3f6230] dark:text-[#c3df8a] dark:decoration-[#667b46] dark:hover:text-[#d8efa8]" onClick={() => void openLink(href)} type="button">{children}</button> : <span className="text-muted-foreground">{children}</span>; }, h1: ({ children }) => <h1 className="mb-3 text-[16px] font-semibold text-foreground">{children}</h1>, h2: ({ children }) => <h2 className="mb-2 mt-5 text-[13px] font-semibold text-foreground">{children}</h2>, h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-[11px] font-semibold text-foreground">{children}</h3>, p: ({ children }) => <p className="my-2">{children}</p>, ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-4">{children}</ul>, table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="min-w-full border-collapse text-[10px]">{children}</table></div>, th: ({ children }) => <th className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold">{children}</th>, td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>, img: ({ src, alt }) => { const chart = chartByPath.get((src ?? "").replace(/^\.\//, "")); return chart ? <img alt={alt ?? chart.title} className="my-3 max-h-[260px] w-full object-contain" src={chart.url} /> : null; } }} remarkPlugins={[remarkGfm]} skipHtml>{run.reportContent}</ReactMarkdown></div> : <div className="py-12 text-center text-[10px] text-muted-foreground"><FileText className="mx-auto h-5 w-5 opacity-50" /><p className="mt-3">The report will appear after the Agent publishes the analysis.</p></div>}</section>;
}

function AnalysisData({ run, loading }: { run: AnalysisRunDescriptor | null; loading: boolean }) {
  if (!run) return <EmptyAnalysis />;
  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-4">
      <AnalysisRunPicker run={run} />
      {loading ? <p className="text-[10px] text-muted-foreground">Refreshing data profile...</p> : null}
      {run.datasets.map((dataset) => (
        <article className="border-b border-[#e5e5df] py-3 dark:border-border" key={dataset.path}>
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-[#6c813e]" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{dataset.path}</span>
            <span className="font-mono text-[9px] text-muted-foreground">{dataset.format}</span>
          </div>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground">{formatBytes(dataset.size)} · {dataset.datasets.reduce((total, item) => total + item.rows, 0).toLocaleString()} rows</p>
          <div className="mt-3 divide-y divide-[#e5e5df] border-t border-[#e5e5df] dark:divide-border dark:border-border">
            {dataset.datasets.map((table) => (
              <section className="py-3 first:pt-2" key={table.name}>
                <p className="text-[10px] font-semibold">{table.name} · {table.columns.length} columns</p>
                <div className="mt-1.5 overflow-x-auto rounded-[4px] border border-[#e5e5df] dark:border-border">
                  <table className="min-w-full text-left text-[9px]">
                    <thead className="bg-muted/40"><tr>{table.columns.map((column) => <th className="whitespace-nowrap px-2 py-1 font-medium" key={column.name}>{column.name}</th>)}</tr></thead>
                    <tbody>{table.sample.slice(0, 8).map((row, index) => <tr className="border-t border-[#eeeeea] dark:border-border" key={index}>{table.columns.map((column) => <td className="max-w-[130px] truncate whitespace-nowrap px-2 py-1 text-muted-foreground" key={column.name}>{String(row[column.name] ?? "")}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
          {dataset.warnings.map((warning) => <p className="mt-2 flex gap-1 text-[9px] text-[#987022]" key={warning}><TriangleAlert className="h-3 w-3 shrink-0" />{warning}</p>)}
        </article>
      ))}
    </section>
  );
}

function AnalysisCharts({ run }: { run: AnalysisRunDescriptor | null }) {
  if (!run) return <EmptyAnalysis />;
  return <section className="min-h-0 flex-1 overflow-y-auto p-4"><AnalysisRunPicker run={run} />{run.charts.length === 0 ? <p className="py-10 text-center text-[10px] text-muted-foreground">No charts have been published.</p> : <div className="space-y-3">{run.charts.map((chart) => <figure className="overflow-hidden rounded-[6px] border border-[#e4e4df] dark:border-border" key={chart.id}><div className="bg-[#fafaf7] p-2 dark:bg-muted/20"><img alt={chart.title} className="block max-h-[220px] w-full object-contain" src={chart.url} /></div><figcaption className="flex items-center gap-2 border-t border-[#e4e4df] px-2.5 py-2 text-[10px] font-medium dark:border-border"><BarChart3 className="h-3 w-3 text-[#6c813e]" />{chart.title}</figcaption></figure>)}</div>}</section>;
}

function AnalysisResearch({ client, run }: { client: ReturnType<typeof useRuntimeClient>; run: AnalysisRunDescriptor | null }) {
  if (!run) return <EmptyAnalysis />;
  const research = run.research;
  if (!research) return <section className="grid min-h-0 flex-1 place-items-center p-6 text-center text-[10px] text-muted-foreground"><div><BookOpenCheck className="mx-auto h-5 w-5 opacity-50" /><p className="mt-3">External research has not been started for this analysis.</p></div></section>;
  const progress = research.dimensions.length === 0 ? 0 : Math.round((research.completedDimensions / research.dimensions.length) * 100);
  return <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3"><header className="border-b border-[#e5e5df] pb-3 dark:border-border"><div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-[#6c813e]" /><span className="text-[11px] font-semibold">{research.mode ? `${research.mode} research` : "Research"}</span><span className="ml-auto rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{research.status}</span></div>{research.objective ? <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{research.objective}</p> : null}<div className="mt-3 h-1 overflow-hidden rounded-full bg-[#e7e7e1] dark:bg-muted"><div className="h-full bg-[#829b50] transition-[width]" style={{ width: `${progress}%` }} /></div><p className="mt-1.5 font-mono text-[9px] text-muted-foreground">{research.completedDimensions}/{research.dimensions.length} dimensions · {research.sourceCount} sources</p>{research.blockedReason ? <p className="mt-2 rounded-[5px] bg-[#fbf1dc] px-2.5 py-2 text-[10px] text-[#8a6623] dark:bg-[#3a3020] dark:text-[#e5bf70]">{research.blockedReason}</p> : null}{research.error ? <p className="mt-2 rounded-[5px] bg-[#f8e8e5] px-2.5 py-2 text-[10px] text-[#a34b42] dark:bg-[#432622] dark:text-[#f0aaa0]">{research.error}</p> : null}</header><div className="divide-y divide-[#e5e5df] dark:divide-border">{research.dimensions.map((dimension) => <section className="py-3" key={dimension.id}><div className="flex items-start gap-2"><span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dimension.status === "ready" ? "bg-[#7d9947]" : dimension.status === "failed" || dimension.status === "needs-research" ? "bg-[#b56852]" : "bg-[#c6a45c]"}`} /><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">{dimension.name}</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">{dimension.question}</p><p className="mt-1 font-mono text-[8px] text-muted-foreground">{dimension.claimCount} claims · {dimension.sourceCount} sources{dimension.review ? ` · review ${dimension.review.verdict}` : ""}</p>{dimension.review?.notes.map((note) => <p className="mt-1 text-[9px] text-[#8a6623]" key={note}>{note}</p>)}</div></div></section>)}</div>{research.claims.length > 0 ? <section className="border-t border-[#e5e5df] py-3 dark:border-border"><h3 className="text-[10px] font-semibold">Claims</h3><div className="mt-2 space-y-2.5">{research.claims.map((claim) => <div key={claim.id}><p className="text-[10px] leading-4">{claim.statement}</p><p className="mt-1 font-mono text-[8px] uppercase text-muted-foreground">{claim.confidence} · {claim.evidenceRefs.length} citations</p></div>)}</div></section> : null}{research.sources.length > 0 ? <section className="border-t border-[#e5e5df] py-3 dark:border-border"><h3 className="text-[10px] font-semibold">Sources</h3><div className="mt-1 divide-y divide-[#ededE8] dark:divide-border">{research.sources.map((source, index) => <button className="flex w-full items-start gap-2 py-2 text-left hover:text-[#587846]" key={source.id} onClick={() => void client.openExternalUrl(source.url)} type="button"><span className="font-mono text-[8px] text-muted-foreground">[{index + 1}]</span><span className="min-w-0 flex-1"><span className="block text-[9px] font-medium leading-4">{source.title}</span><span className="block truncate font-mono text-[8px] text-muted-foreground">{source.publisher ?? new URL(source.url).hostname}</span></span><ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" /></button>)}</div></section> : null}</section>;
}

function AnalysisFiles({ client, run }: { client: ReturnType<typeof useRuntimeClient>; run: AnalysisRunDescriptor | null }) {
  if (!run) return <EmptyAnalysis />;
  return <section className="min-h-0 flex-1 overflow-y-auto p-4"><AnalysisRunPicker run={run} /><div className="divide-y divide-[#e5e5df] border-y border-[#e5e5df] dark:divide-border dark:border-border">{run.files.map((file) => { const Icon = outputIcon(file.kind); return <div className="flex items-center gap-2 px-1 py-2.5" key={file.path}><Icon className="h-3.5 w-3.5 shrink-0 text-[#6c813e]" /><span className="min-w-0 flex-1 truncate text-[10px] font-medium" title={file.path}>{file.path}</span><button aria-label={`Open ${file.name}`} className="grid h-6 w-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted" onClick={() => void client.openAnalysisOutput(run.sessionId, run.id, file.path)} type="button"><ExternalLink className="h-3 w-3" /></button><button aria-label={`Reveal ${file.name}`} className="grid h-6 w-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted" onClick={() => void client.revealAnalysisOutput(run.sessionId, run.id, file.path)} type="button"><FolderOpen className="h-3 w-3" /></button></div>; })}</div></section>;
}

function EmptyAnalysis() { return <section className="grid min-h-0 flex-1 place-items-center p-6 text-center text-[10px] text-muted-foreground"><BarChart3 className="h-5 w-5 opacity-50" /><p className="mt-2">No analysis run selected.</p></section>; }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
