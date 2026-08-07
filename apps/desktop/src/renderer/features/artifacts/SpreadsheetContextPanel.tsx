import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import type { ArtifactDescriptor, ArtifactIssue, ArtifactPreviewManifest, OfficeEngineHealth, SpreadsheetChangeRecord, SpreadsheetRangeProfile, SpreadsheetSelection } from "@wordless/protocol";
import { AlertTriangle, ArrowRightLeft, BarChart3, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ExternalLink, FolderOpen, FunctionSquare, LoaderCircle, Move, Pencil, Plus, RefreshCw, ScanSearch, Sheet, Sigma, Table2, Trash2, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSelectionIcon from "../../../icons/common-icons/Use_Selection.svg";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import type { WorkbenchContextPanelProps } from "../workbench/context-panel-types";

function emptyPreview(): ArtifactPreviewManifest {
  return { artifactId: "", revision: 0, surfaces: [], issues: [] };
}

function issueColor(issue: ArtifactIssue): string {
  return issue.severity === "error" ? "text-[#b24d43] dark:text-[#f2aaa1]" : "text-[#987022] dark:text-[#dfbb63]";
}

type IssueFilter = "all" | ArtifactIssue["severity"];
type SpreadsheetOperation = SpreadsheetChangeRecord["operations"][number];

function locatorParts(locator: string | undefined): { sheet: string; target: string } | undefined {
  if (!locator) return undefined;
  const [sheet = "", ...target] = locator.replace(/^\//, "").split("/");
  if (!sheet) return undefined;
  return { sheet, target: target.join("/") };
}

function operationLabel(operation: SpreadsheetOperation): string {
  if (operation.command === "add") return `Add ${operation.elementType ?? "element"}`;
  if (operation.command === "set") return "Update";
  if (operation.command === "remove") return "Remove";
  if (operation.command === "move") return "Move";
  return "Swap";
}

function OperationIcon({ command }: { command: string }) {
  if (command === "add") return <Plus className="h-3.5 w-3.5" />;
  if (command === "remove") return <Trash2 className="h-3.5 w-3.5" />;
  if (command === "move") return <Move className="h-3.5 w-3.5" />;
  if (command === "swap") return <ArrowRightLeft className="h-3.5 w-3.5" />;
  return <Pencil className="h-3.5 w-3.5" />;
}

function PanelError({ message }: { message: string | null }) {
  return message ? <p className="border-t border-[#ead5cf] px-4 py-2 text-[10px] leading-4 text-destructive dark:border-[#5b3932]" role="alert">{message}</p> : null;
}

function ChangeRevisionGroup({ children, initiallyOpen }: { children: ReactNode; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details className="group border-b border-[#e7e7e2] last:border-b-0 dark:border-border" onToggle={(event) => setOpen(event.currentTarget.open)} open={open}>{children}</details>;
}

export function SpreadsheetContextPanel({ onArtifactSelection, onViewChange, sessionId, view }: WorkbenchContextPanelProps) {
  const client = useRuntimeClient();
  const { t } = usePreferences();
  const [health, setHealth] = useState<OfficeEngineHealth | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactPreviewManifest>(emptyPreview);
  const [selectedSheetId, setSelectedSheetId] = useState("sheet-Sheet1");
  const [selection, setSelection] = useState<SpreadsheetSelection | null>(null);
  const [profiles, setProfiles] = useState<SpreadsheetRangeProfile[]>([]);
  const [changes, setChanges] = useState<SpreadsheetChangeRecord[]>([]);
  const [issues, setIssues] = useState<ArtifactIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const selectionRequest = useRef(false);

  const selectedArtifact = useMemo(() => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null, [artifacts, selectedArtifactId]);
  const selectedSheet = preview.surfaces.find((surface) => surface.id === selectedSheetId) ?? preview.surfaces[0];
  const changeOperationCount = changes.reduce((total, change) => total + Math.max(1, change.operations.length), 0);
  const issueCounts = issues.reduce((counts, issue) => ({ ...counts, [issue.severity]: counts[issue.severity] + 1 }), { error: 0, warning: 0 });
  const visibleIssues = issues
    .filter((issue) => issueFilter === "all" || issue.severity === issueFilter)
    .sort((left, right) => Number(right.severity === "error") - Number(left.severity === "error"));
  const selectionActions = [
    { id: "reference" as const, label: t("spreadsheetReference"), help: t("spreadsheetReferenceHelp"), icon: <img alt="" className="h-3.5 w-3.5 dark:invert" src={useSelectionIcon} /> },
    { id: "analyze" as const, label: t("spreadsheetAnalyze"), help: t("spreadsheetAnalyzeHelp"), icon: <Sigma className="h-3.5 w-3.5" /> },
    { id: "formula" as const, label: t("spreadsheetFormula"), help: t("spreadsheetFormulaHelp"), icon: <FunctionSquare className="h-3.5 w-3.5" /> },
    { id: "chart" as const, label: t("spreadsheetChart"), help: t("spreadsheetChartHelp"), icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { id: "pivot" as const, label: t("spreadsheetPivot"), help: t("spreadsheetPivotHelp"), icon: <Table2 className="h-3.5 w-3.5" /> },
  ];

  const refreshArtifacts = useCallback(async () => {
    const next = await client.listSpreadsheetArtifacts(sessionId);
    setArtifacts(next);
    setSelectedArtifactId((current) => current && next.some((artifact) => artifact.id === current) ? current : next[0]?.id ?? null);
  }, [client, sessionId]);

  const refreshArtifact = useCallback(async (artifactId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [nextPreview, nextChanges] = await Promise.all([client.getSpreadsheetPreview(sessionId, artifactId), client.getSpreadsheetChanges(sessionId, artifactId)]);
      setPreview(nextPreview);
      setChanges(nextChanges);
      setIssues(nextPreview.issues);
      setSelectedSheetId((current) => nextPreview.surfaces.some((surface) => surface.id === current) ? current : nextPreview.surfaces[0]?.id ?? "sheet-Sheet1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPreview(emptyPreview());
    } finally {
      setLoading(false);
    }
  }, [client, sessionId]);

  useEffect(() => {
    void Promise.all([client.getOfficeEngineHealth(), refreshArtifacts()]).then(([nextHealth]) => setHealth(nextHealth)).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [client, refreshArtifacts]);

  useEffect(() => {
    setSelection(null);
    setProfiles([]);
    setIssueFilter("all");
    if (selectedArtifactId) void refreshArtifact(selectedArtifactId);
    else setPreview(emptyPreview());
  }, [refreshArtifact, selectedArtifactId]);

  useEffect(() => client.subscribe((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.event.type !== "artifact.changed" || event.event.kind !== "spreadsheet") return;
    const artifactEvent = event.event;
    void refreshArtifacts()
      .then(() => selectedArtifactId === artifactEvent.artifactId ? refreshArtifact(artifactEvent.artifactId) : undefined)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }), [client, refreshArtifact, refreshArtifacts, selectedArtifactId, sessionId]);

  useEffect(() => {
    if (view !== "preview" || !selectedArtifactId) return;
    let active = true;
    const poll = async () => {
      if (selectionRequest.current) return;
      selectionRequest.current = true;
      try {
        const next = await client.getSpreadsheetSelection(sessionId, selectedArtifactId);
        if (!active) return;
        setSelection(next);
        setProfiles((current) => current.filter((profile) => next?.ranges.some((range) => profile.revision === next.revision && profile.sheetName === range.sheetName && profile.range === range.range)));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        selectionRequest.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [client, selectedArtifactId, sessionId, view]);

  const useSelection = async (intent: "reference" | "analyze" | "formula" | "chart" | "pivot", action: string) => {
    if (!selectedArtifact) return;
    setError(null);
    try {
      const next = await client.getSpreadsheetSelection(sessionId, selectedArtifact.id);
      if (!next) {
        setError(t("spreadsheetSelectRangeFirst"));
        return;
      }
      setSelection(next);
      if (intent === "analyze") {
        if (next.ranges.length === 0) { setError(t("spreadsheetAnalyzeRequiresCells")); return; }
        const profiles = await Promise.all(next.ranges.map((range) => client.profileSpreadsheetRange(sessionId, selectedArtifact.id, range.sheetName, range.range)));
        setProfiles(profiles);
      }
      if (intent === "pivot" && (next.ranges.length !== 1 || next.elements.length !== 0)) { setError(t("spreadsheetPivotRequiresRange")); return; }
      const locators = next.ranges.map((range) => range.locator).concat(next.elements);
      onArtifactSelection?.({ ...next, intent, locators, label: `${action} · ${locators.length === 1 ? locators[0] : `${locators.length} selections`}` });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const focusLocator = async (locator: string, surfaceId?: string) => {
    if (!selectedArtifact) return;
    const locatorSheet = locatorParts(locator)?.sheet;
    const targetSurfaceId = surfaceId ?? preview.surfaces.find((surface) => surface.label === locatorSheet)?.id;
    if (targetSurfaceId) setSelectedSheetId(targetSurfaceId);
    setError(null);
    onViewChange("preview");
  };

  const validate = async () => {
    if (!selectedArtifact) return;
    setLoading(true);
    setError(null);
    try {
      setIssues(await client.validateSpreadsheetArtifact(sessionId, selectedArtifact.id));
      onViewChange("issues");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  if (health && health.status !== "ready") return <section className="p-4"><div className="border-y border-[#e6d4cd] py-4 dark:border-[#5b3932]"><p className="text-[12px] font-semibold text-[#a05245] dark:text-[#e4a49a]">Office engine unavailable</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{health.message ?? "The bundled OfficeCLI engine could not be started."}</p></div></section>;

  if (!selectedArtifact) return <section className="flex min-h-0 flex-1 items-center justify-center px-6 text-center"><div><Table2 className="mx-auto h-5 w-5 text-[#74894b] dark:text-[#c4df7b]" /><p className="mt-3 text-[12px] font-semibold">No workbook yet</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Ask Wordless to create a spreadsheet or work with an attached XLSX, CSV, or TSV file.</p></div></section>;

  if (view === "sheets") return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[#e4e4df] px-4 pb-3 pt-4 dark:border-border">
        <div className="flex items-baseline justify-between gap-3"><h2 className="text-[12px] font-semibold text-[#363631] dark:text-foreground">Workbook sheets</h2><span className="font-mono text-[9px] text-muted-foreground">{preview.surfaces.length} {preview.surfaces.length === 1 ? "sheet" : "sheets"}</span></div>
        <p className="mt-1 truncate text-[10px] text-muted-foreground">{selectedSheet ? `${selectedSheet.label} is active` : "Choose a sheet to open it in Preview."}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {preview.surfaces.length ? <div className="divide-y divide-[#e6e6e1] border-y border-[#e6e6e1] dark:divide-border dark:border-border">{preview.surfaces.map((surface, index) => {
          const active = surface.id === selectedSheetId;
          return <button aria-current={active ? "page" : undefined} className={`group flex min-h-11 w-full items-center gap-2.5 px-2 text-left transition-colors ${active ? "bg-[#f3f6ed] text-[#587136] dark:bg-[#28301f] dark:text-[#c9e47e]" : "text-[#4f4f49] hover:bg-[#f7f7f4] hover:text-[#587136] dark:text-foreground dark:hover:bg-muted dark:hover:text-[#c9e47e]"}`} key={surface.id} onClick={() => void focusLocator(`/${surface.label}`, surface.id)} type="button">
            <span className="w-5 shrink-0 font-mono text-[9px] text-[#9a9a92]">{String(index + 1).padStart(2, "0")}</span><Sheet className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={surface.label}>{surface.label}</span>{active ? <Check className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#aaa9a1] opacity-0 transition-opacity group-hover:opacity-100" />}
          </button>;
        })}</div> : <div className="py-8 text-center"><Sheet className="mx-auto h-4 w-4 text-[#999991]" /><p className="mt-2 text-[10px] text-muted-foreground">No sheets are available in this workbook.</p></div>}
      </div>
      <PanelError message={error} />
    </section>
  );

  if (view === "changes") return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[#e4e4df] px-4 pb-3 pt-4 dark:border-border">
        <div className="flex items-baseline justify-between gap-3"><h2 className="text-[12px] font-semibold text-[#363631] dark:text-foreground">Workbook changes</h2><span className="font-mono text-[9px] text-muted-foreground">{changes.length} revisions</span></div>
        <p className="mt-1 text-[10px] text-muted-foreground">{changeOperationCount} recorded {changeOperationCount === 1 ? "operation" : "operations"}, newest first</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {changes.length ? <div className="border-y border-[#e4e4df] dark:border-border">{changes.map((change, changeIndex) => {
          const sheetNames = [...new Set(change.operations.flatMap((operation) => locatorParts(operation.locator)?.sheet ?? []))];
          const operationCount = Math.max(1, change.operations.length);
          return <ChangeRevisionGroup initiallyOpen={changeIndex === 0} key={`${change.revision}:${change.updatedAt}`}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-2 outline-none transition-colors hover:bg-[#f7f7f4] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-muted [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#92928a] transition-transform group-open:rotate-180" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-[10px] font-semibold text-[#5f743d] dark:text-[#c7df7c]">Revision {change.revision}</span><span className="text-[9px] text-muted-foreground">{operationCount} {operationCount === 1 ? "change" : "changes"}</span></div><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{sheetNames.length ? sheetNames.join(", ") : "Workbook import"}</p></div><time className="shrink-0 font-mono text-[9px] text-muted-foreground" dateTime={new Date(change.updatedAt).toISOString()}>{new Date(change.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </summary>
            <div className="border-t border-[#ecece7] bg-[#fafaf8] dark:border-border dark:bg-muted/30">{change.operations.length ? change.operations.map((operation, index) => {
              const location = locatorParts(operation.locator);
              const content = <><span className="grid h-6 w-6 shrink-0 place-items-center text-[#708548] dark:text-[#c7df7c]"><OperationIcon command={operation.command} /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-medium text-[#464640] dark:text-foreground">{operationLabel(operation)}</span><span className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-muted-foreground"><span className="shrink-0">{location?.sheet ?? "Workbook"}</span>{location?.target ? <><span className="text-[#b0b0a8]">/</span><span className="truncate" title={location.target}>{location.target}</span></> : null}</span></span>{operation.locator ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#aaa9a1]" /> : null}</>;
              return operation.locator ? <button className="flex min-h-11 w-full items-center gap-2 border-b border-[#ecece7] px-3 text-left transition-colors last:border-b-0 hover:bg-[#f2f5ec] dark:border-border dark:hover:bg-[#2b321f]" key={`${operation.command}:${operation.locator}:${index}`} onClick={() => void focusLocator(operation.locator!)} type="button">{content}</button> : <div className="flex min-h-11 items-center gap-2 border-b border-[#ecece7] px-3 last:border-b-0 dark:border-border" key={`${operation.command}:${index}`}>{content}</div>;
            }) : <div className="flex min-h-11 items-center gap-2 px-3"><span className="grid h-6 w-6 place-items-center text-[#708548] dark:text-[#c7df7c]"><Upload className="h-3.5 w-3.5" /></span><div><p className="text-[10px] font-medium text-[#464640] dark:text-foreground">Import tabular data</p><p className="mt-0.5 text-[9px] text-muted-foreground">Workbook contents were imported.</p></div></div>}</div>
          </ChangeRevisionGroup>;
        })}</div> : <div className="py-10 text-center"><Pencil className="mx-auto h-4 w-4 text-[#999991]" /><p className="mt-2 text-[10px] text-muted-foreground">No recorded workbook changes.</p></div>}
      </div>
      <PanelError message={error} />
    </section>
  );

  if (view === "issues") return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[#e4e4df] px-4 pb-3 pt-4 dark:border-border">
        <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><h2 className="text-[12px] font-semibold text-[#363631] dark:text-foreground">Workbook checks</h2><p className="mt-1 text-[10px] text-muted-foreground">{issueCounts.error} errors · {issueCounts.warning} warnings</p></div><Button className="h-7 px-2 text-[10px]" disabled={loading} onClick={() => void validate()} size="sm" type="button" variant="outline">{loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}{loading ? "Checking" : "Check"}</Button></div>
        {issues.length ? <div aria-label="Filter workbook issues" className="mt-3 grid h-7 grid-cols-3 rounded-[6px] bg-[#f0f0ec] p-0.5 dark:bg-muted" role="group">{(["all", "error", "warning"] as const).map((filter) => <button aria-pressed={issueFilter === filter} className={`min-w-0 rounded-[4px] px-1 text-[9px] font-medium transition-colors ${issueFilter === filter ? "bg-white text-[#3f3f3a] shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-card dark:text-foreground" : "text-muted-foreground hover:text-foreground"}`} key={filter} onClick={() => setIssueFilter(filter)} type="button">{filter === "all" ? `All ${issues.length}` : filter === "error" ? `Errors ${issueCounts.error}` : `Warnings ${issueCounts.warning}`}</button>)}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {visibleIssues.length ? <div className="divide-y divide-[#e6e6e1] border-y border-[#e6e6e1] dark:divide-border dark:border-border">{visibleIssues.map((issue, index) => {
          const content = <><span className={`mt-0.5 shrink-0 ${issueColor(issue)}`}>{issue.severity === "error" ? <AlertTriangle className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className={`truncate text-[10px] font-semibold ${issueColor(issue)}`}>{issue.code ?? (issue.severity === "error" ? "Error" : "Warning")}</span>{issue.category ? <span className="shrink-0 font-mono text-[8px] uppercase text-[#96968e]">{issue.category}</span> : null}</span><span className="mt-1 block text-[10px] leading-4 text-[#62625c] dark:text-muted-foreground">{issue.message}</span>{issue.locator ? <span className="mt-1.5 flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-[#777770] dark:text-muted-foreground"><Sheet className="h-3 w-3 shrink-0" /><span className="truncate" title={issue.locator}>{issue.locator}</span></span> : null}{issue.suggestion ? <span className="mt-1.5 block text-[9px] leading-4 text-[#667d3f] dark:text-[#c7df7c]"><span className="font-semibold">Suggestion</span> · {issue.suggestion}</span> : null}</span>{issue.locator ? <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#aaa9a1]" /> : null}</>;
          return issue.locator ? <button className="flex w-full items-start gap-2 px-2 py-3 text-left transition-colors hover:bg-[#f7f7f4] dark:hover:bg-muted" key={`${issue.code}:${issue.message}:${index}`} onClick={() => void focusLocator(issue.locator!, issue.surfaceId)} type="button">{content}</button> : <div className="flex items-start gap-2 px-2 py-3" key={`${issue.code}:${issue.message}:${index}`}>{content}</div>;
        })}</div> : issues.length ? <div className="py-10 text-center"><ScanSearch className="mx-auto h-4 w-4 text-[#999991]" /><p className="mt-2 text-[10px] text-muted-foreground">No {issueFilter === "error" ? "errors" : "warnings"} in this check.</p></div> : <div className="py-10 text-center"><CheckCircle2 className="mx-auto h-4 w-4 text-[#708548] dark:text-[#c7df7c]" /><p className="mt-2 text-[10px] text-muted-foreground">No deterministic workbook issues reported.</p></div>}
      </div>
      <PanelError message={error} />
    </section>
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-[#e4e4df] px-3 dark:border-border">
        {artifacts.length > 1 ? (
          <Select onValueChange={setSelectedArtifactId} value={selectedArtifact.id}>
            <SelectTrigger aria-label="Select workbook" className="h-7 min-w-0 flex-1 rounded-[5px] border-0 bg-transparent px-1 text-[11px] font-semibold shadow-none hover:bg-[#f1f1ec] dark:hover:bg-muted"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-56">{artifacts.map((artifact) => <SelectItem className="text-[11px]" key={artifact.id} value={artifact.id}>{artifact.displayName}</SelectItem>)}</SelectContent>
          </Select>
        ) : <p className="min-w-0 flex-1 truncate text-[11px] font-semibold">{selectedArtifact.displayName}</p>}
        <Tooltip><TooltipTrigger asChild><Button aria-label="Refresh workbook" disabled={loading} onClick={() => void refreshArtifact(selectedArtifact.id)} size="icon" type="button" variant="ghost"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button></TooltipTrigger><TooltipContent>Refresh preview</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button aria-label="Open workbook" onClick={() => void client.openSpreadsheetArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Open workbook</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button aria-label="Reveal workbook" onClick={() => void client.revealSpreadsheetArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><FolderOpen className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Show in folder</TooltipContent></Tooltip>
      </header>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[#e4e4df] bg-[#fafaf7] px-3 font-mono text-[10px] dark:border-border dark:bg-muted/35">
        <span className="min-w-0 flex-1 truncate font-semibold text-[#60743e] dark:text-[#c7df7c]">{selection?.locator ?? "No range selected"}</span>
        {selection?.formula ?? selection?.displayValue ? <span className="min-w-0 max-w-[55%] truncate text-muted-foreground">{selection.formula ?? selection.displayValue}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e4e4df] px-2 py-1.5 dark:border-border">
        {selectionActions.map((action) => <Tooltip key={action.id}><TooltipTrigger asChild><Button aria-label={action.label} className="h-7 shrink-0 px-2 text-[9px]" onClick={() => void useSelection(action.id, action.label)} size="sm" type="button" variant="ghost">{action.icon}{action.label}</Button></TooltipTrigger><TooltipContent>{action.help}</TooltipContent></Tooltip>)}
      </div>
      {profiles.map((profile) => <div className="grid shrink-0 grid-cols-4 gap-x-3 gap-y-1 border-b border-[#dce5ce] bg-[#f6f9f0] px-3 py-2 text-[9px] dark:border-[#455136] dark:bg-[#20251b]" key={`${profile.revision}:${profile.sheetName}:${profile.range}`}><p className="col-span-4 truncate font-mono font-semibold text-[#60743e] dark:text-[#c7df7c]">{profile.sheetName}!{profile.range} · {profile.rowCount} × {profile.columnCount}</p><span className="text-muted-foreground">Filled <b className="font-mono font-semibold text-foreground">{profile.populatedCells}</b></span><span className="text-muted-foreground">Blank <b className="font-mono font-semibold text-foreground">{profile.blankCells}</b></span><span className="text-muted-foreground">Numeric <b className="font-mono font-semibold text-foreground">{profile.numericCells}</b></span><span className="text-muted-foreground">Duplicates <b className="font-mono font-semibold text-foreground">{profile.duplicateValues}</b></span>{profile.average !== undefined ? <p className="col-span-4 truncate font-mono text-muted-foreground">min {profile.minimum?.toLocaleString()} · avg {profile.average.toLocaleString(undefined, { maximumFractionDigits: 2 })} · max {profile.maximum?.toLocaleString()}</p> : null}</div>)}
      <div className="relative min-h-0 flex-1 bg-[#f4f4f0] dark:bg-[#151610]">
        {preview.watchUrl ? <iframe className="h-full w-full border-0 bg-white" key={`${selectedArtifact.id}:${preview.revision}`} sandbox="allow-same-origin allow-scripts" src={preview.watchUrl} title="Workbook preview" /> : <div className="grid h-full place-items-center px-6 text-center text-[10px] text-muted-foreground">Interactive workbook preview is unavailable.</div>}
        {loading ? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white/55 dark:bg-black/35"><LoaderCircle className="h-4 w-4 animate-spin text-[#708548]" /></div> : null}
      </div>
      <PanelError message={error} />
    </section>
  );
}
