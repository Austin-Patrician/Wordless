import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { BarChart3, BookOpenCheck, Clock3, Database, ExternalLink, FileCode2, FileJson2, FileText, FolderOpen, LoaderCircle, Maximize2, RefreshCw, TriangleAlert, CircleAlert, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalysisRunDescriptor, AnalysisSessionSnapshot } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import type { WorkbenchContextPanelProps } from "../workbench/context-panel-types";
import { ResearchInspector } from "./ResearchInspector";
import { resolveAnalysisReportLink } from "./analysis-report-links";
import "./analysis-context-panel.css";

function emptySnapshot(): AnalysisSessionSnapshot {
  return {
    sessionId: "",
    capabilities: {
      status: "missing",
      command: null,
      version: null,
      supportedFormats: [],
    },
    runs: [],
  };
}

function outputIcon(kind: AnalysisRunDescriptor["files"][number]["kind"]) {
  if (kind === "chart") return BarChart3;
  if (kind === "manifest") return FileJson2;
  if (kind === "script") return FileCode2;
  return FileText;
}

function fileGroupLabel(kind: AnalysisRunDescriptor["files"][number]["kind"]): string {
  if (kind === "manifest") return "Manifests";
  if (kind === "chart") return "Charts";
  if (kind === "script") return "Scripts";
  if (kind === "data") return "Data";
  if (kind === "report") return "Reports";
  return "Other";
}

function compactTimestamp(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function runStatusLabel(status: AnalysisRunDescriptor["status"]): string {
  if (status === "published") return "Published";
  if (status === "validated") return "Validated";
  if (status === "failed") return "Failed";
  if (status === "working") return "Working";
  return "Inspecting";
}

function researchStatusLabel(research: NonNullable<AnalysisRunDescriptor["research"]>): string {
  if (research.status === "ready") return "Deep Research complete";
  if (research.status === "blocked") return "Research blocked";
  if (research.status === "failed") return "Research failed";
  if (research.status === "awaiting-confirmation") return "Awaiting confirmation";
  if (research.status === "reviewing") return "Reviewing evidence";
  if (research.dimensions.length > 0 && research.completedDimensions >= research.dimensions.length && research.claims.length > 0) return "Validation pending";
  return "Researching";
}

type AnalysisReportMode = "data-only" | "research-pending" | "research-blocked" | "research-validated" | "unified" | "report-failed";

function reportMode(run: AnalysisRunDescriptor): AnalysisReportMode {
  if (run.status === "failed") return "report-failed";
  const researchStatus = run.research?.status;
  if (!researchStatus) return "data-only";
  if (researchStatus === "blocked") return "research-blocked";
  if (researchStatus === "ready") return run.reportContent && run.status === "published" ? "unified" : "research-validated";
  return "research-pending";
}

function reportTypeLabel(run: AnalysisRunDescriptor): string {
  const mode = reportMode(run);
  if (mode === "unified") return "Deep Research report";
  if (mode === "report-failed") return "Report failed";
  return "Data report";
}

function reportTypeIcon(run: AnalysisRunDescriptor) {
  const mode = reportMode(run);
  if (mode === "unified") return BookOpenCheck;
  if (mode === "report-failed") return CircleAlert;
  if (mode === "research-pending" || mode === "research-validated") return LoaderCircle;
  return FileText;
}

function AnalysisPanelToolbar({ run, runs, selectedId, loading, onRefresh, onSelectRun, onClearResearchSelection }: { run: AnalysisRunDescriptor | null; runs: AnalysisRunDescriptor[]; selectedId: string | null; loading: boolean; onRefresh: () => void; onSelectRun: (id: string) => void; onClearResearchSelection?: () => void }) {
  const title = run?.title ?? "Data analysis";
  const TypeIcon = run ? reportTypeIcon(run) : FileText;
  return (
    <header className="analysis-panel-toolbar shrink-0 border-b border-[#e4e4df] px-4 py-3 dark:border-border">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Tooltip><TooltipTrigger asChild><span className="analysis-report-type-icon" tabIndex={0} title={run ? reportTypeLabel(run) : "Data report"}><TypeIcon className={`mt-1 h-3.5 w-3.5 shrink-0 ${run?.status === "failed" ? "text-[#b45f50]" : run && reportMode(run) === "unified" ? "text-[#6c813e]" : "text-[#71819b]"} ${run && (reportMode(run) === "research-pending" || reportMode(run) === "research-validated") ? "motion-safe:animate-pulse" : ""}`} /></span></TooltipTrigger><TooltipContent>{run ? reportTypeLabel(run) : "Data report"}</TooltipContent></Tooltip>
      <div className="min-w-0 flex-1">
        {runs.length > 1 && run ? (
          <Select
            onValueChange={(id) => {
              onSelectRun(id);
              onClearResearchSelection?.();
            }}
            value={selectedId ?? run.id}
          >
            <SelectTrigger aria-label="Select analysis run" className="analysis-panel-run-select h-7 w-full min-w-0 max-w-full rounded-[6px] border-0 bg-transparent px-0 text-left text-[13px] font-semibold shadow-none hover:bg-muted/50" title={title}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[300px]">
              {runs.map((candidate) => (
                <SelectItem className="max-w-[280px] truncate text-[11px]" key={candidate.id} title={candidate.title} value={candidate.id}>
                  {candidate.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="truncate text-[13px] font-semibold text-[#30302d] dark:text-foreground" tabIndex={0} title={title}>
                {title}
              </p>
            </TooltipTrigger>
            <TooltipContent>{title}</TooltipContent>
          </Tooltip>
        )}
        {run ? (
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[9px] text-muted-foreground">
            <span className={`analysis-status-dot ${run.status === "failed" ? "is-error" : run.status === "published" || run.status === "validated" ? "is-ready" : "is-active"}`} /> <span>{runStatusLabel(run.status)}</span>
            <span aria-hidden>·</span>
            <span className="flex min-w-0 items-center gap-1 truncate">
              <Clock3 className="h-3 w-3 shrink-0" />
              {compactTimestamp(run.updatedAt)}
            </span>
            <span aria-hidden>·</span>
            <span className="flex min-w-0 items-center gap-1 truncate">
              <Database className="h-3 w-3 shrink-0" />
              {run.datasets.length} datasets
            </span>
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">Select an analysis run to inspect.</p>
        )}
      </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label="Refresh analysis results" className="ml-3 shrink-0" disabled={loading} onClick={onRefresh} size="icon" type="button" variant="ghost">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh analysis results</TooltipContent>
      </Tooltip>
    </header>
  );
}

export function AnalysisContextPanel({ onClearResearchSelection, onViewChange, researchSelection, sessionId, view }: WorkbenchContextPanelProps) {
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

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.sessionId !== sessionId) return;
        if (event.event.type === "tool.updated" || event.event.type === "tool.completed" || event.event.type === "run.completed" || event.event.type === "run.failed") void refresh();
      }),
    [client, refresh, sessionId],
  );

  const selected = useMemo(() => snapshot.runs.find((run) => run.id === researchSelection?.analysisId) ?? snapshot.runs.find((run) => run.id === selectedId) ?? snapshot.runs[0] ?? null, [researchSelection?.analysisId, selectedId, snapshot.runs]);
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  const content = view === "report" ? <AnalysisReport run={selected} /> : view === "research" ? researchSelection ? <ResearchInspector client={client} onBack={() => onClearResearchSelection?.()} run={selected} selection={researchSelection} sessionId={sessionId} /> : <AnalysisResearch client={client} run={selected} /> : view === "data" ? <AnalysisData run={selected} loading={loading} /> : view === "charts" ? <AnalysisCharts run={selected} /> : view === "files" ? <AnalysisFiles client={client} run={selected} /> : null;
  if (content)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <AnalysisPanelToolbar loading={loading} onClearResearchSelection={onClearResearchSelection} onRefresh={() => void refresh()} onSelectRun={setSelectedId} run={selected} runs={snapshot.runs} selectedId={selectedId} />
        {content}
      </div>
    );

  return (
    <section className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-[6px] bg-[#edf2df] text-[#607a35] dark:bg-[#29351d] dark:text-[#c8e883]">
          <BarChart3 className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[12px] font-semibold">Data analysis</h2>
          <p className="truncate text-[10px] text-muted-foreground">{snapshot.capabilities.status === "ready" ? snapshot.capabilities.version : (snapshot.capabilities.message ?? "Analysis runtime unavailable")}</p>
        </div>
        <Button aria-label="Refresh analysis" onClick={() => void refresh()} size="icon" type="button" variant="ghost">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {error ? <p className="mt-4 text-[10px] text-destructive">{error}</p> : null}
      {snapshot.runs.length === 0 ? (
        <div className="mt-10 text-center text-[11px] text-muted-foreground">
          <BarChart3 className="mx-auto h-5 w-5 opacity-50" />
          <p className="mt-3">Start with a data file in this workspace.</p>
        </div>
      ) : (
        <div className="mt-5 space-y-1.5">
          {snapshot.runs.map((run) => (
            <button
              className={`flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left ${run.id === selected?.id ? "bg-[#edf2df] text-[#435b22] dark:bg-[#29351d] dark:text-[#d3ec9c]" : "hover:bg-muted/60"}`}
              key={run.id}
              onClick={() => {
                setSelectedId(run.id);
                onViewChange("report");
              }}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{run.title}</span>
              <span className="text-[9px] text-muted-foreground">{run.status}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function AnalysisReport({ run }: { run: AnalysisRunDescriptor | null }) {
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
  return (
    <section className="analysis-panel-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="analysis-report text-[12px] leading-6 text-[#53534d] dark:text-muted-foreground">
        {linkError ? (
          <p className="mb-3 rounded-[6px] border border-[#ead1cb] bg-[#fff8f6] px-3 py-2.5 text-[11px] text-[#a34b42] dark:border-[#5b3932] dark:bg-[#321e1b] dark:text-[#f0aaa0]" role="alert">
            {linkError}
          </p>
        ) : null}
        {run.errors.map((message) => (
          <p className="mb-3 rounded-[6px] border border-[#ead1cb] bg-[#fff8f6] px-3 py-2.5 text-[11px] text-[#a34b42] dark:border-[#5b3932] dark:bg-[#321e1b] dark:text-[#f0aaa0]" key={message} role="alert">
            {message}
          </p>
        ))}
        {run.reportContent ? (
          <ReactMarkdown
            components={{
              a: ({ children, href }) => {
                const link = resolveAnalysisReportLink(href, run.outputRoot);
                return link && link.kind !== "anchor" ? (
                  <button className="inline break-all font-medium text-[#587846] underline decoration-[#a8bb91] underline-offset-2 hover:text-[#3f6230] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ca863] dark:text-[#c3df8a] dark:decoration-[#667b46] dark:hover:text-[#d8efa8]" onClick={() => void openLink(href)} type="button">
                    {children}
                  </button>
                ) : (
                  <span className="text-muted-foreground">{children}</span>
                );
              },
              h1: ({ children }) => <h1 className="mb-4 text-[18px] font-semibold leading-7 text-foreground">{children}</h1>,
              h2: ({ children }) => <h2 className="mb-2 mt-8 border-t border-[#e8e8e3] pt-5 text-[14px] font-semibold leading-6 text-foreground dark:border-border">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-1.5 mt-5 text-[12px] font-semibold leading-5 text-foreground">{children}</h3>,
              p: ({ children }) => <p className="my-3 max-w-[72ch]">{children}</p>,
              ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5">{children}</ul>,
              ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
              blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-[#9bb477] bg-[#f4f7ee] px-3 py-2.5 text-[11px] text-[#5e6e4a] dark:border-[#829c5c] dark:bg-[#252c20] dark:text-[#c7d9ad]">{children}</blockquote>,
              table: ({ children }) => (
                <div className="my-4 overflow-x-auto rounded-[6px] border border-[#e3e3dd] dark:border-border">
                  <table className="min-w-full border-collapse text-[11px]">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-[#f4f5f1] dark:bg-muted/60">{children}</thead>,
              th: ({ children }) => <th className="whitespace-nowrap border-b border-[#deded8] px-2.5 py-2 text-left text-[10px] font-semibold text-foreground dark:border-border">{children}</th>,
              td: ({ children }) => <td className="border-b border-[#eeeeea] px-2.5 py-2 align-top dark:border-border">{children}</td>,
              pre: ({ children }) => <pre className="my-4 max-w-full overflow-x-auto rounded-[6px] border border-[#e2e2dc] bg-[#f6f6f3] p-3 font-mono text-[10px] leading-5 text-[#464640] dark:border-border dark:bg-[#151610] dark:text-[#d5d8c9]">{children}</pre>,
              code: ({ children, className }) => <code className={`${className ?? ""} font-mono text-[10px]`}>{children}</code>,
              img: ({ src, alt }) => {
                const chart = chartByPath.get((src ?? "").replace(/^\.\//, ""));
                return chart ? (
                  <figure className="my-4 overflow-hidden rounded-[6px] border border-[#e3e3dd] dark:border-border">
                    <img alt={alt ?? chart.title} className="block aspect-video w-full object-contain bg-[#f7f7f4] dark:bg-[#151610]" loading="lazy" src={chart.url} />
                    <figcaption className="border-t border-[#e3e3dd] px-2.5 py-2 text-[10px] text-muted-foreground dark:border-border">{chart.title}</figcaption>
                  </figure>
                ) : null;
              },
            }}
            remarkPlugins={[remarkGfm]}
            skipHtml
          >
            {run.reportContent}
          </ReactMarkdown>
        ) : (
          <div className="analysis-empty-state py-16 text-center">
            <FileText className="mx-auto h-6 w-6 text-[#9a9b91] dark:text-muted-foreground" />
            <p className="mt-3 text-[12px] font-medium text-foreground">The report will appear after the Agent publishes the analysis.</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Publish the validated analysis to render the unified report.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function AnalysisData({ run, loading }: { run: AnalysisRunDescriptor | null; loading: boolean }) {
  if (!run) return <EmptyAnalysis />;
  return (
    <section className="analysis-panel-scroll min-h-0 flex-1 overflow-y-auto p-4">
      {loading ? (
        <p className="mb-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Refreshing data profile...
        </p>
      ) : null}
      {run.datasets.length === 0 ? (
        <div className="analysis-empty-state py-16 text-center">
          <Database className="mx-auto h-6 w-6 text-[#9a9b91] dark:text-muted-foreground" />
          <p className="mt-3 text-[12px] font-medium text-foreground">No datasets found.</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Add a supported CSV, JSON, XLSX, or Parquet file to this workspace.</p>
        </div>
      ) : null}
      {run.datasets.map((dataset) => (
        <article className="border-b border-[#e5e5df] py-3 dark:border-border" key={dataset.path}>
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-[#6c813e]" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" tabIndex={0} title={dataset.path}>
                  {dataset.path}
                </span>
              </TooltipTrigger>
              <TooltipContent>{dataset.path}</TooltipContent>
            </Tooltip>
            <span className="font-mono text-[9px] text-muted-foreground">{dataset.format}</span>
          </div>
          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
            {formatBytes(dataset.size)} · {dataset.datasets.reduce((total, item) => total + item.rows, 0).toLocaleString()} rows
          </p>
          <div className="mt-3 divide-y divide-[#e5e5df] border-t border-[#e5e5df] dark:divide-border dark:border-border">
            {dataset.datasets.map((table) => (
              <section className="py-3 first:pt-2" key={table.name}>
                <p className="text-[10px] font-semibold">
                  {table.name} · {table.columns.length} columns
                </p>
                <div className="mt-1.5 overflow-x-auto rounded-[4px] border border-[#e5e5df] dark:border-border">
                  <table className="min-w-full text-left text-[9px]">
                    <thead className="sticky top-0 z-[1] bg-muted/90">
                      <tr>
                        {table.columns.map((column) => (
                          <th className="max-w-[140px] truncate whitespace-nowrap px-2 py-1.5 text-left font-medium" key={column.name} title={column.name}>
                            {column.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.sample.slice(0, 8).map((row, index) => (
                        <tr className="border-t border-[#eeeeea] dark:border-border" key={index}>
                          {table.columns.map((column) => {
                            const value = String(row[column.name] ?? "");
                            return (
                              <td className="max-w-[130px] truncate whitespace-nowrap px-2 py-1.5 text-muted-foreground" key={column.name} title={value}>
                                {value}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
          {dataset.warnings.map((warning) => (
            <p className="mt-2 flex gap-1 text-[9px] text-[#987022]" key={warning}>
              <TriangleAlert className="h-3 w-3 shrink-0" />
              {warning}
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}

function AnalysisCharts({ run }: { run: AnalysisRunDescriptor | null }) {
  const [previewChart, setPreviewChart] = useState<AnalysisRunDescriptor["charts"][number] | null>(null);
  if (!run) return <EmptyAnalysis />;
  return (
    <>
      <section className="analysis-panel-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {run.charts.length === 0 ? (
        <div className="analysis-empty-state py-16 text-center">
          <BarChart3 className="mx-auto h-6 w-6 text-[#9a9b91] dark:text-muted-foreground" />
          <p className="mt-3 text-[12px] font-medium text-foreground">No charts have been published.</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Charts will appear after the analysis outputs are published.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {run.charts.map((chart) => (
            <figure className="analysis-chart-row overflow-hidden rounded-[6px] border border-[#e2e2dc] dark:border-border" key={chart.id}>
              <div className="analysis-chart-frame bg-[#f7f7f4] p-2 dark:bg-[#151610]">
                <button
                  aria-label={`Open chart ${chart.title}`}
                  className="group relative block h-full w-full cursor-zoom-in overflow-hidden rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-[#8ca863] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f7f4] dark:focus-visible:ring-[#b4d477] dark:focus-visible:ring-offset-[#151610]"
                  onClick={() => setPreviewChart(chart)}
                  title="Open chart preview"
                  type="button"
                >
                  <img alt={chart.title} className="block h-full w-full object-contain" draggable={false} loading="lazy" src={chart.url} />
                  <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center bg-black/20 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white shadow-[0_2px_10px_rgba(0,0,0,0.22)] backdrop-blur-[2px]">
                      <Maximize2 className="h-5 w-5" />
                    </span>
                  </span>
                </button>
              </div>
              <figcaption className="flex min-w-0 items-center gap-2 border-t border-[#e2e2dc] px-3 py-2.5 dark:border-border">
                <BarChart3 className="h-3.5 w-3.5 shrink-0 text-[#6c813e]" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground" tabIndex={0} title={chart.title}>
                      {chart.title}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{chart.title}</TooltipContent>
                </Tooltip>
                <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{chart.mimeType.replace("image/", "")}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      </section>
      <Dialog onOpenChange={(open) => { if (!open) setPreviewChart(null); }} open={previewChart !== null}>
        <DialogContent
          aria-describedby={undefined}
          className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none items-center justify-center rounded-none border-0 bg-transparent p-8 shadow-none"
          overlayClassName="bg-black/70 backdrop-blur-[2px]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">{previewChart?.title ?? "Chart preview"}</DialogTitle>
          {previewChart ? (
            <div className="relative max-h-full max-w-full overflow-hidden rounded-[10px]">
              <img alt={previewChart.title} className="block max-h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)] rounded-[10px] object-contain" draggable={false} src={previewChart.url} />
              <DialogClose asChild>
                <button aria-label="Close chart preview" className="absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-[7px] bg-black/45 text-white/90 backdrop-blur-[2px] transition-colors hover:bg-black/65 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" title="Close chart preview" type="button">
                  <X className="h-5 w-5" />
                </button>
              </DialogClose>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AnalysisResearch({ client, run }: { client: ReturnType<typeof useRuntimeClient>; run: AnalysisRunDescriptor | null }) {
  const { locale } = usePreferences();
  if (!run) return <EmptyAnalysis />;
  const research = run.research;
  if (!research)
    return (
      <section className="grid min-h-0 flex-1 place-items-center p-6 text-center text-[10px] text-muted-foreground">
        <div>
          <BookOpenCheck className="mx-auto h-5 w-5 opacity-50" />
          <p className="mt-3">External research has not been started for this analysis.</p>
        </div>
      </section>
    );
  const progress = research.dimensions.length === 0 ? 0 : Math.round((research.completedDimensions / research.dimensions.length) * 100);
  return (
    <section className="analysis-research-overview analysis-panel-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <header className="border-b border-[#e5e5df] pb-3 dark:border-border">
        <div className="analysis-research-heading">
          <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6c813e]" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold">Deep Research</p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">{research.mode ? `${research.mode} research` : "Research"} · {researchStatusLabel(research)}</p>
          </div>
          <span className="font-mono text-[9px] text-muted-foreground">{progress}%</span>
        </div>
        {research.objective ? (
          <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-muted-foreground" title={research.objective}>
            {research.objective}
          </p>
        ) : null}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#e7e7e1] dark:bg-muted">
          <div className="h-full bg-[#829b50] transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1.5 font-mono text-[9px] text-muted-foreground">
          {research.completedDimensions}/{research.dimensions.length} dimensions · {research.sourceCount} sources · {research.claims.length} claims
        </p>
        {research.status === "awaiting-confirmation" ? <p className="mt-2 text-[10px] text-[#8a6623] dark:text-[#e5bf70]">{locale === "zh-CN" ? "请在主对话中确认研究计划后开始外部检索。" : "Confirm the research plan in the conversation before external research starts."}</p> : null}
        {research.blockedReason ? <p className="mt-2 rounded-[5px] bg-[#fbf1dc] px-2.5 py-2 text-[10px] text-[#8a6623] dark:bg-[#3a3020] dark:text-[#e5bf70]">{research.blockedReason}</p> : null}
        {research.error ? <p className="mt-2 rounded-[5px] bg-[#f8e8e5] px-2.5 py-2 text-[10px] text-[#a34b42] dark:bg-[#432622] dark:text-[#f0aaa0]">{research.error}</p> : null}
      </header>
      <div className="divide-y divide-[#e5e5df] dark:divide-border">
        {research.dimensions.map((dimension) => (
          <details className="analysis-research-dimension py-2.5" key={dimension.id}>
            <summary className="flex cursor-pointer list-none items-start gap-2">
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dimension.status === "ready" ? "bg-[#7d9947]" : dimension.status === "failed" || dimension.status === "needs-research" ? "bg-[#b56852]" : "bg-[#c6a45c]"}`} />
              <div className="min-w-0 flex-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="truncate text-[10px] font-semibold text-foreground" tabIndex={0} title={dimension.name}>
                      {dimension.name}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>{dimension.name}</TooltipContent>
                </Tooltip>
                <p className="mt-1 font-mono text-[8px] text-muted-foreground">
                  {dimension.claimCount} claims · {dimension.sourceCount} sources
                  {dimension.review ? ` · review ${dimension.review.verdict}` : ""}
                </p>
              </div>
            </summary>
            <div className="analysis-research-dimension-detail">
              <p className="text-[10px] leading-4 text-muted-foreground" title={dimension.question}>{dimension.question}</p>
              {dimension.review?.notes.map((note) => <p className="mt-1 text-[9px] text-[#8a6623]" key={note}>{note}</p>)}
            </div>
          </details>
        ))}
      </div>
      {research.claims.length > 0 ? (
        <details className="border-t border-[#e5e5df] py-3 dark:border-border">
          <summary className="cursor-pointer text-[10px] font-semibold">Claims · {research.claims.length}</summary>
          <div className="mt-2 space-y-2.5">
            {research.claims.map((claim) => (
              <div key={claim.id}>
                <p className="line-clamp-3 text-[10px] leading-4" title={claim.statement}>
                  {claim.statement}
                </p>
                <p className="mt-1 font-mono text-[8px] uppercase text-muted-foreground">
                  {claim.confidence} · {claim.evidenceRefs.length} citations
                </p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {research.sources.length > 0 ? (
        <details className="border-t border-[#e5e5df] py-3 dark:border-border">
          <summary className="cursor-pointer text-[10px] font-semibold">Sources · {research.sources.length}</summary>
          <div className="mt-1 divide-y divide-[#ededE8] dark:divide-border">
            {research.sources.map((source, index) => (
              <button className="flex w-full items-start gap-2 py-2 text-left hover:text-[#587846]" key={source.id} onClick={() => void client.openExternalUrl(source.url)} type="button">
                <span className="font-mono text-[8px] text-muted-foreground">[{index + 1}]</span>
                <span className="min-w-0 flex-1">
                  <span className="block line-clamp-2 text-[9px] font-medium leading-4" title={source.title}>
                    {source.title}
                  </span>
                  <span className="block truncate font-mono text-[8px] text-muted-foreground">{source.publisher ?? new URL(source.url).hostname}</span>
                </span>
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function AnalysisFiles({ client, run }: { client: ReturnType<typeof useRuntimeClient>; run: AnalysisRunDescriptor | null }) {
  if (!run) return <EmptyAnalysis />;
  const groups = ["report", "manifest", "data", "chart", "script", "other"] as const;
  const grouped = new Map(groups.map((kind) => [kind, run.files.filter((file) => file.kind === kind)]));
  return (
    <section className="analysis-panel-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[12px] font-semibold text-foreground">Output files</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{run.files.length} files in this analysis</p>
        </div>
      </div>
      {run.files.length === 0 ? (
        <div className="analysis-empty-state py-16 text-center">
          <FolderOpen className="mx-auto h-6 w-6 text-[#9a9b91] dark:text-muted-foreground" />
          <p className="mt-3 text-[12px] font-medium text-foreground">No output files yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((kind) => {
            const files = grouped.get(kind) ?? [];
            if (files.length === 0) return null;
            return (
              <section key={kind}>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{fileGroupLabel(kind)}</h3>
                  <span className="font-mono text-[9px] text-muted-foreground">{files.length}</span>
                </div>
                <div className="divide-y divide-[#e8e8e3] border-y border-[#e8e8e3] dark:divide-border dark:border-border">
                  {files.map((file) => {
                    const Icon = outputIcon(file.kind);
                    return (
                      <div className="flex min-h-11 items-center gap-2 px-2 py-2" key={file.path}>
                        <Icon className="h-3.5 w-3.5 shrink-0 text-[#6c813e]" />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground" tabIndex={0} title={file.path}>
                              {file.path}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{file.path}</TooltipContent>
                        </Tooltip>
                        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{formatBytes(file.size)}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button aria-label={`Open ${file.name}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ca863]" onClick={() => void client.openAnalysisOutput(run.sessionId, run.id, file.path)} type="button">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Open file</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button aria-label={`Reveal ${file.name}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ca863]" onClick={() => void client.revealAnalysisOutput(run.sessionId, run.id, file.path)} type="button">
                              <FolderOpen className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Show in folder</TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EmptyAnalysis() {
  return (
    <section className="grid min-h-0 flex-1 place-items-center p-6 text-center text-[10px] text-muted-foreground">
      <BarChart3 className="h-5 w-5 opacity-50" />
      <p className="mt-2">No analysis run selected.</p>
    </section>
  );
}
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
