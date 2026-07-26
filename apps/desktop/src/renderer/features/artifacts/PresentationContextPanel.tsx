import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FileOutput, FolderOpen, Image, Layers3, LoaderCircle, MonitorUp, Plus, RefreshCw, ScanSearch, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactDescriptor, ArtifactIssue, ArtifactPreviewManifest, OfficeEngineHealth, PresentationTemplate } from "@wordless/protocol";
import { useRuntimeClient } from "../../shared/runtime";
import type { WorkbenchContextPanelProps } from "../workbench/context-panel-types";

function issueTone(issues: ArtifactIssue[]): string {
  if (issues.some((issue) => issue.severity === "error")) return "text-[#b24d43] dark:text-[#f2aaa1]";
  if (issues.length) return "text-[#9a7023] dark:text-[#dfbb63]";
  return "text-[#667d3d] dark:text-[#c5df78]";
}

function previewFallback(): ArtifactPreviewManifest {
  return { artifactId: "", revision: 0, surfaces: [], issues: [] };
}

export function PresentationContextPanel({ onArtifactSelection, onViewChange, sessionId, view }: WorkbenchContextPanelProps) {
  const client = useRuntimeClient();
  const [health, setHealth] = useState<OfficeEngineHealth | null>(null);
  const [templates, setTemplates] = useState<PresentationTemplate[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ArtifactPreviewManifest>(previewFallback);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState("slide-1");
  const [issues, setIssues] = useState<ArtifactIssue[]>([]);
  const [templateId, setTemplateId] = useState("auto");
  const [name, setName] = useState("presentation.pptx");
  const [creating, setCreating] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presentationCalls = useRef(new Map<string, string>());

  const selectedArtifact = useMemo(() => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null, [artifacts, selectedArtifactId]);

  const refreshArtifacts = useCallback(async () => {
    const next = await client.listPresentationArtifacts(sessionId);
    setArtifacts(next);
    setSelectedArtifactId((current) => current && next.some((artifact) => artifact.id === current) ? current : next[0]?.id ?? null);
  }, [client, sessionId]);

  const refreshPreview = useCallback(async (artifactId: string, force = false) => {
    setLoadingPreview(true);
    setError(null);
    try {
      const next = await client.getPresentationPreview(sessionId, artifactId, force);
      setPreview(next);
      setSelectedSurfaceId((current) => next.surfaces.some((surface) => surface.id === current) ? current : next.surfaces[0]?.id ?? "slide-1");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPreview(previewFallback());
    } finally {
      setLoadingPreview(false);
    }
  }, [client, sessionId]);

  useEffect(() => {
    void Promise.all([client.getOfficeEngineHealth(), client.listPresentationTemplates(), refreshArtifacts()])
      .then(([nextHealth, nextTemplates]) => { setHealth(nextHealth); setTemplates(nextTemplates); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [client, refreshArtifacts]);

  useEffect(() => {
    if (!selectedArtifactId) {
      setPreview(previewFallback());
      return;
    }
    void refreshPreview(selectedArtifactId);
  }, [refreshPreview, selectedArtifactId]);

  useEffect(() => client.subscribe((event) => {
    if (event.sessionId !== sessionId) return;
    if (event.event.type === "tool.started") {
      if (event.event.name.startsWith("presentation_")) presentationCalls.current.set(event.event.callId, event.event.name);
      return;
    }
    if (event.event.type !== "tool.completed") return;
    const toolName = presentationCalls.current.get(event.event.callId);
    presentationCalls.current.delete(event.event.callId);
    if (event.event.isError || !toolName) return;
    void refreshArtifacts().then(() => {
      if (toolName === "presentation_render" && selectedArtifactId) void refreshPreview(selectedArtifactId);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }), [client, refreshArtifacts, refreshPreview, selectedArtifactId, sessionId]);

  const create = async () => {
    if (creating || health?.status !== "ready") return;
    setCreating(true);
    setError(null);
    try {
      const artifact = await client.createPresentationArtifact(sessionId, { name, templateId: templateId === "auto" ? null : templateId });
      await refreshArtifacts();
      setSelectedArtifactId(artifact.id);
      onViewChange("preview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const captureSelection = async () => {
    if (!selectedArtifact || selectionLoading) return;
    setSelectionLoading(true);
    setError(null);
    try {
      const selection = await client.getPresentationSelection(sessionId, selectedArtifact.id, selectedSurfaceId);
      if (!selection) {
        setError("Select an element in the presentation preview first.");
        return;
      }
      onArtifactSelection?.(selection);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSelectionLoading(false);
    }
  };

  const validate = async () => {
    if (!selectedArtifact) return;
    setError(null);
    try {
      setIssues(await client.validatePresentationArtifact(sessionId, selectedArtifact.id));
      onViewChange("issues");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const activeSurfaceIndex = Math.max(0, preview.surfaces.findIndex((surface) => surface.id === selectedSurfaceId));
  const activeSurface = preview.surfaces[activeSurfaceIndex];
  const moveSurface = (step: -1 | 1) => {
    const next = preview.surfaces[activeSurfaceIndex + step];
    if (next) setSelectedSurfaceId(next.id);
  };

  if (health && health.status !== "ready") {
    return <section className="flex min-h-0 flex-1 flex-col px-4 py-5"><div className="border-y border-[#e6d4cd] py-4 dark:border-[#5b3932]"><div className="flex items-center gap-2 text-[#a05245] dark:text-[#e4a49a]"><CircleAlert className="h-4 w-4" /><span className="text-[12px] font-semibold">Office engine unavailable</span></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{health.message ?? "The bundled OfficeCLI engine could not be started. Reinstall this Wordless build or configure the desktop host binary."}</p></div></section>;
  }

  if (!selectedArtifact) {
    return <section className="flex min-h-0 flex-1 flex-col"><div className="px-4 pb-3 pt-4"><div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-[6px] bg-[#eaf0dc] text-[#5f7737] dark:bg-[#33401f] dark:text-[#c5e57b]"><WandSparkles className="h-4 w-4" /></span><div><h2 className="text-[13px] font-semibold text-[#32322e] dark:text-foreground">New presentation</h2><p className="text-[10px] text-muted-foreground">Create a deck here or ask the agent to build one.</p></div></div></div><div className="space-y-3 border-y border-[#e4e4df] px-4 py-4 dark:border-border"><label className="block"><span className="mb-1.5 block text-[10px] font-medium text-[#6d6d66] dark:text-muted-foreground">File name</span><input className="h-8 w-full rounded-[6px] border border-[#deded9] bg-white px-2 text-[12px] outline-none placeholder:text-[#9b9b94] focus:border-[#90a760] dark:border-border dark:bg-muted dark:text-foreground" onChange={(event) => setName(event.target.value)} value={name} /></label><label className="block"><span className="mb-1.5 block text-[10px] font-medium text-[#6d6d66] dark:text-muted-foreground">Starting point</span><select className="h-8 w-full rounded-[6px] border border-[#deded9] bg-white px-2 text-[12px] outline-none focus:border-[#90a760] dark:border-border dark:bg-muted dark:text-foreground" onChange={(event) => setTemplateId(event.target.value)} value={templateId}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>{templates.find((template) => template.id === templateId)?.description ? <p className="text-[10px] leading-4 text-muted-foreground">{templates.find((template) => template.id === templateId)?.description}</p> : null}<Button className="w-full" disabled={creating || health?.status !== "ready"} onClick={() => void create()} size="sm" type="button">{creating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{creating ? "Creating" : "Create presentation"}</Button></div>{error ? <p className="px-4 py-3 text-[10px] leading-4 text-destructive" role="alert">{error}</p> : null}</section>;
  }

  if (view === "slides") {
    return <section className="min-h-0"><div className="border-b border-[#e4e4df] px-3 py-2.5 dark:border-border"><p className="truncate text-[12px] font-semibold text-[#3c3c37] dark:text-foreground">{selectedArtifact.displayName}</p><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">revision {selectedArtifact.revision}</p></div><div className="space-y-2 p-3">{preview.surfaces.map((surface, index) => <button className={`flex w-full items-center gap-2 rounded-[6px] border p-1.5 text-left transition-colors ${surface.id === selectedSurfaceId ? "border-[#8eab55] bg-[#f1f6e7] dark:border-[#94b95b] dark:bg-[#2d391e]" : "border-transparent hover:bg-[#f1f1ed] dark:hover:bg-muted"}`} key={surface.id} onClick={() => { setSelectedSurfaceId(surface.id); onViewChange("preview"); }} type="button"><span className="grid aspect-[16/9] w-[88px] shrink-0 place-items-center overflow-hidden rounded-[3px] border border-[#deded9] bg-[#f7f7f4] dark:border-border dark:bg-card">{surface.thumbnailUrl ? <img alt="" className="h-full w-full object-cover" src={surface.thumbnailUrl} /> : <Image className="h-4 w-4 text-[#a0a099]" />}</span><span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-[#484843] dark:text-foreground">{surface.label}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span></span></button>)}{loadingPreview ? <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Rendering slides</div> : null}</div></section>;
  }

  if (view === "assets") {
    return <section className="p-4"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-[#718747] dark:text-[#c4e07c]" /><h2 className="text-[12px] font-semibold text-[#3c3c37] dark:text-foreground">Presentation assets</h2></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Workspace files, uploaded images, and optional generated images are available to the agent as references. This deck currently uses the managed PPTX artifact.</p><div className="mt-4 border-y border-[#e4e4df] py-3 text-[11px] text-[#55554f] dark:border-border dark:text-muted-foreground"><span className="font-mono text-[10px] text-[#85857e]">OUTPUT</span><p className="mt-1 truncate font-medium text-foreground">{selectedArtifact.sourcePath}</p></div></section>;
  }

  if (view === "issues") {
    return <section className="p-4"><div className="flex items-center gap-2"><ScanSearch className="h-4 w-4 text-[#718747] dark:text-[#c4e07c]" /><h2 className="text-[12px] font-semibold text-[#3c3c37] dark:text-foreground">Document checks</h2><span className={`ml-auto text-[10px] font-medium ${issueTone(issues)}`}>{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "Ready"}</span></div><Button className="mt-3 w-full" onClick={() => void validate()} size="sm" type="button" variant="outline"><ScanSearch className="h-3.5 w-3.5" />Run validation</Button><div className="mt-3 divide-y divide-[#e8e8e3] border-y border-[#e8e8e3] dark:divide-border dark:border-border">{issues.length ? issues.map((issue, index) => <div className="py-2.5" key={`${issue.message}:${index}`}><p className={`text-[11px] font-medium ${issue.severity === "error" ? "text-[#af5045] dark:text-[#f0aaa0]" : "text-[#8d6b28] dark:text-[#ddbd69]"}`}>{issue.severity === "error" ? "Error" : "Warning"}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{issue.message}</p>{issue.locator ? <p className="mt-1 truncate font-mono text-[10px] text-[#888880]">{issue.locator}</p> : null}</div>) : <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-4 w-4 text-[#708746] dark:text-[#c6df7d]" /><p className="mt-2 text-[11px] text-muted-foreground">Run a document check before delivery.</p></div>}</div></section>;
  }

  return <section className="flex min-h-0 flex-1 flex-col"><div className="flex items-center justify-between border-b border-[#e4e4df] px-3 py-2.5 dark:border-border"><div className="min-w-0"><p className="truncate text-[12px] font-semibold text-[#3c3c37] dark:text-foreground">{selectedArtifact.displayName}</p><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">Slide {activeSurfaceIndex + 1} of {preview.surfaces.length || 1}</p></div><div className="flex items-center gap-0.5"><Tooltip><TooltipTrigger asChild><Button aria-label="Refresh preview" disabled={loadingPreview} onClick={() => void refreshPreview(selectedArtifact.id, true)} size="icon" type="button" variant="ghost"><RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? "animate-spin" : ""}`} /></Button></TooltipTrigger><TooltipContent>Refresh preview</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Open presentation" onClick={() => void client.openPresentationArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Open in PowerPoint</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Reveal presentation" onClick={() => void client.revealPresentationArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><FolderOpen className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Reveal in Finder</TooltipContent></Tooltip></div></div><div className="relative m-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-[#dfdfd9] bg-[#f5f5f1] dark:border-border dark:bg-[#151710]">{loadingPreview ? <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Rendering preview</div> : preview.watchUrl || preview.htmlUrl ? <iframe className="h-full w-full bg-white" sandbox="allow-scripts allow-same-origin" src={preview.watchUrl ?? preview.htmlUrl} title="Presentation preview" /> : <div className="px-6 text-center text-[11px] leading-5 text-muted-foreground">The preview will appear after the document is rendered.</div>}</div><div className="flex shrink-0 items-center justify-between border-t border-[#e4e4df] px-3 py-2.5 dark:border-border"><div className="flex items-center gap-1"><Button aria-label="Previous slide" disabled={activeSurfaceIndex === 0} onClick={() => moveSurface(-1)} size="icon" type="button" variant="ghost"><ChevronLeft className="h-3.5 w-3.5" /></Button><Button aria-label="Next slide" disabled={activeSurfaceIndex >= preview.surfaces.length - 1} onClick={() => moveSurface(1)} size="icon" type="button" variant="ghost"><ChevronRight className="h-3.5 w-3.5" /></Button><span className="ml-1 max-w-[100px] truncate text-[10px] text-muted-foreground">{activeSurface?.label ?? "Slide 1"}</span></div><div className="flex items-center gap-0.5"><Tooltip><TooltipTrigger asChild><Button aria-label="Use selection" disabled={selectionLoading || !preview.watchUrl} onClick={() => void captureSelection()} size="icon" type="button" variant="ghost">{selectionLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <MonitorUp className="h-3.5 w-3.5" />}</Button></TooltipTrigger><TooltipContent>Use selection</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Check presentation" onClick={() => void validate()} size="icon" type="button" variant="ghost"><FileOutput className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Check presentation</TooltipContent></Tooltip></div></div>{error ? <p className="border-t border-[#efd6d0] px-3 py-2 text-[10px] leading-4 text-destructive dark:border-[#5b3c35]" role="alert">{error}</p> : null}</section>;
}
