import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import type { ArtifactDescriptor, ArtifactIssue, ArtifactPreviewManifest, OfficeEngineHealth, SpreadsheetChangeRecord, SpreadsheetSelection } from "@wordless/protocol";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, LoaderCircle, RefreshCw, ScanSearch, Sheet, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSelectionIcon from "../../../icons/common-icons/Use_Selection.svg";
import { useRuntimeClient } from "../../shared/runtime";
import type { WorkbenchContextPanelProps } from "../workbench/context-panel-types";

function emptyPreview(): ArtifactPreviewManifest {
  return { artifactId: "", revision: 0, surfaces: [], issues: [] };
}

function issueColor(issue: ArtifactIssue): string {
  return issue.severity === "error" ? "text-[#b24d43] dark:text-[#f2aaa1]" : "text-[#987022] dark:text-[#dfbb63]";
}

export function SpreadsheetContextPanel({ onArtifactSelection, onViewChange, sessionId, view }: WorkbenchContextPanelProps) {
  const client = useRuntimeClient();
  const [health, setHealth] = useState<OfficeEngineHealth | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactPreviewManifest>(emptyPreview);
  const [selectedSheetId, setSelectedSheetId] = useState("sheet-Sheet1");
  const [selection, setSelection] = useState<SpreadsheetSelection | null>(null);
  const [changes, setChanges] = useState<SpreadsheetChangeRecord[]>([]);
  const [issues, setIssues] = useState<ArtifactIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spreadsheetCalls = useRef(new Set<string>());

  const selectedArtifact = useMemo(() => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null, [artifacts, selectedArtifactId]);

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
    if (selectedArtifactId) void refreshArtifact(selectedArtifactId);
    else setPreview(emptyPreview());
  }, [refreshArtifact, selectedArtifactId]);

  useEffect(() => client.subscribe((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.event.type === "tool.started" && event.event.name.startsWith("spreadsheet_")) {
      spreadsheetCalls.current.add(event.event.callId);
      return;
    }
    if (event.event.type !== "tool.completed" || !spreadsheetCalls.current.delete(event.event.callId) || event.event.isError) return;
    void refreshArtifacts().then(() => selectedArtifactId ? refreshArtifact(selectedArtifactId) : undefined).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }), [client, refreshArtifact, refreshArtifacts, selectedArtifactId, sessionId]);

  const captureSelection = async () => {
    if (!selectedArtifact) return;
    setError(null);
    try {
      const next = await client.getSpreadsheetSelection(sessionId, selectedArtifact.id);
      if (!next) {
        setError("Select a cell or range in the workbook preview first.");
        return;
      }
      setSelection(next);
      onArtifactSelection?.(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
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

  if (view === "sheets") return <section className="min-h-0 flex-1 overflow-y-auto p-3"><div className="divide-y divide-[#e6e6e1] border-y border-[#e6e6e1] dark:divide-border dark:border-border">{preview.surfaces.map((surface) => <button className={`flex w-full items-center gap-2 px-1 py-2.5 text-left ${surface.id === selectedSheetId ? "text-[#587136] dark:text-[#c9e47e]" : "text-[#4f4f49] dark:text-foreground"}`} key={surface.id} onClick={() => { setSelectedSheetId(surface.id); onViewChange("preview"); }} type="button"><Sheet className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate text-[11px] font-medium">{surface.label}</span></button>)}</div></section>;

  if (view === "changes") return <section className="min-h-0 flex-1 overflow-y-auto p-4"><h2 className="text-[12px] font-semibold">Workbook changes</h2><div className="mt-3 divide-y divide-[#e6e6e1] border-y border-[#e6e6e1] dark:divide-border dark:border-border">{changes.length ? changes.map((change) => <div className="py-3" key={`${change.revision}:${change.updatedAt}`}><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-semibold text-[#5f743d] dark:text-[#c7df7c]">Revision {change.revision}</span><span className="text-[9px] text-muted-foreground">{new Date(change.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div><div className="mt-1.5 space-y-1">{change.operations.length ? change.operations.map((operation, index) => <p className="truncate font-mono text-[10px] text-muted-foreground" key={`${operation.command}:${operation.locator}:${index}`}>{operation.command}{operation.elementType ? ` ${operation.elementType}` : ""} · {operation.locator ?? "imported data"}</p>) : <p className="text-[10px] text-muted-foreground">Imported tabular data</p>}</div></div>) : <p className="py-5 text-center text-[10px] text-muted-foreground">No recorded workbook changes.</p>}</div></section>;

  if (view === "issues") return <section className="min-h-0 flex-1 overflow-y-auto p-4"><div className="flex items-center"><h2 className="text-[12px] font-semibold">Workbook checks</h2><Button className="ml-auto" disabled={loading} onClick={() => void validate()} size="sm" type="button" variant="outline"><ScanSearch className="h-3.5 w-3.5" />Check</Button></div><div className="mt-3 divide-y divide-[#e6e6e1] border-y border-[#e6e6e1] dark:divide-border dark:border-border">{issues.length ? issues.map((issue, index) => <div className="py-3" key={`${issue.code}:${issue.message}:${index}`}><div className="flex items-center gap-1.5">{issue.severity === "error" ? <AlertTriangle className={`h-3.5 w-3.5 ${issueColor(issue)}`} /> : <ScanSearch className={`h-3.5 w-3.5 ${issueColor(issue)}`} />}<span className={`text-[10px] font-semibold ${issueColor(issue)}`}>{issue.code ?? issue.severity}</span></div><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{issue.message}</p>{issue.locator ? <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">{issue.locator}</p> : null}{issue.suggestion ? <p className="mt-1 text-[9px] leading-4 text-[#708548] dark:text-[#c7df7c]">{issue.suggestion}</p> : null}</div>) : <div className="py-6 text-center"><CheckCircle2 className="mx-auto h-4 w-4 text-[#708548] dark:text-[#c7df7c]" /><p className="mt-2 text-[10px] text-muted-foreground">No deterministic workbook issues reported.</p></div>}</div></section>;

  return <section className="flex min-h-0 flex-1 flex-col"><div className="flex items-center gap-2 border-b border-[#e4e4df] px-3 py-2 dark:border-border"><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold">{selectedArtifact.displayName}</p><p className="truncate font-mono text-[9px] text-muted-foreground">Revision {preview.revision} · {preview.surfaces.find((surface) => surface.id === selectedSheetId)?.label ?? "Sheet1"}</p></div><Tooltip><TooltipTrigger asChild><Button aria-label="Use selected range" onClick={() => void captureSelection()} size="icon" type="button" variant="ghost"><img alt="" className="h-3.5 w-3.5 dark:invert" src={useSelectionIcon} /></Button></TooltipTrigger><TooltipContent>Use selected range</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Refresh workbook" disabled={loading} onClick={() => void refreshArtifact(selectedArtifact.id)} size="icon" type="button" variant="ghost"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button></TooltipTrigger><TooltipContent>Refresh preview</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Open workbook" onClick={() => void client.openSpreadsheetArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Open workbook</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Reveal workbook" onClick={() => void client.revealSpreadsheetArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><FolderOpen className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Show in folder</TooltipContent></Tooltip></div><div className="flex h-8 items-center border-b border-[#e4e4df] bg-[#fafaf7] px-3 font-mono text-[10px] dark:border-border dark:bg-muted/35"><span className="w-28 shrink-0 truncate font-semibold text-[#60743e] dark:text-[#c7df7c]">{selection?.locator ?? "No range selected"}</span><span className="ml-2 min-w-0 flex-1 truncate text-muted-foreground">{selection?.formula ?? selection?.displayValue ?? "Select cells in the preview, then use the selection button."}</span></div><div className="relative min-h-0 flex-1 bg-[#f4f4f0] dark:bg-[#151610]">{preview.watchUrl ? <iframe className="h-full w-full border-0 bg-white" key={`${selectedArtifact.id}:${preview.revision}`} sandbox="allow-same-origin allow-scripts" src={preview.watchUrl} title="Workbook preview" /> : <div className="grid h-full place-items-center px-6 text-center text-[10px] text-muted-foreground">Interactive workbook preview is unavailable.</div>}{loading ? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-white/55 dark:bg-black/35"><LoaderCircle className="h-4 w-4 animate-spin text-[#708548]" /></div> : null}</div>{error ? <p className="border-t border-[#ead5cf] px-3 py-2 text-[10px] text-destructive dark:border-[#5b3932]">{error}</p> : null}</section>;
}
