import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FolderOpen, Image, Layers3, LoaderCircle, Minus, Plus, RefreshCw, ScanSearch, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactDescriptor, ArtifactIssue, ArtifactPreviewManifest, OfficeEngineHealth, PresentationTemplate } from "@wordless/protocol";
import useSelectionIcon from "../../../icons/common-icons/Use_Selection.svg";
import checkPresentationIcon from "../../../icons/common-icons/check_presentation.svg";
import { useRuntimeClient } from "../../shared/runtime";
import type { WorkbenchContextPanelProps } from "../workbench/context-panel-types";

const minimumPreviewZoom = 25;
const maximumPreviewZoom = 300;
const previewZoomStep = 10;

function constrainedPreviewZoom(value: number): number {
  return Math.min(maximumPreviewZoom, Math.max(minimumPreviewZoom, value));
}

function issueTone(issues: ArtifactIssue[]): string {
  if (issues.some((issue) => issue.severity === "error")) return "text-[#b24d43] dark:text-[#f2aaa1]";
  if (issues.length) return "text-[#9a7023] dark:text-[#dfbb63]";
  return "text-[#667d3d] dark:text-[#c5df78]";
}

function previewFallback(): ArtifactPreviewManifest {
  return { artifactId: "", revision: 0, surfaces: [], issues: [] };
}

function qualityLabel(artifact: ArtifactDescriptor): string {
  if (!artifact.quality) return "Not checked";
  if (artifact.quality.status === "ready") return "Ready";
  if (artifact.quality.status === "needs-review") return `${artifact.quality.reviewedSlides}/${artifact.quality.totalSlides} reviewed`;
  if (artifact.quality.status === "needs-fix") return `${artifact.quality.issueCount} blocking`;
  return "Draft";
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
  const [templateId, setTemplateId] = useState("blank");
  const [name, setName] = useState("presentation.pptx");
  const [creating, setCreating] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewViewport, setPreviewViewport] = useState({ width: 0, height: 0 });
  const [previewImage, setPreviewImage] = useState({ width: 16, height: 9 });
  const [error, setError] = useState<string | null>(null);
  const presentationCalls = useRef(new Map<string, string>());
  const previewViewportRef = useRef<HTMLDivElement>(null);

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
      setIssues(next.issues);
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

  useEffect(() => {
    setPreviewZoom(100);
    setSelectionMode(false);
  }, [selectedArtifactId]);

  useEffect(() => {
    if (view !== "preview") setSelectionMode(false);
  }, [selectedArtifactId, view]);

  useEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport || view !== "preview") return;
    const updateSize = () => {
      if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
      setPreviewViewport({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    const zoomWithWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setPreviewZoom((current) => constrainedPreviewZoom(current + (event.deltaY < 0 ? previewZoomStep : -previewZoomStep)));
    };
    viewport.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", zoomWithWheel);
    };
  }, [selectedArtifactId, view]);

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
      if (selectedArtifactId && ["presentation_edit", "presentation_render", "presentation_quality_scan", "presentation_quality_review", "presentation_publish", "presentation_advanced"].includes(toolName)) void refreshPreview(selectedArtifactId);
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
    if (!selectionMode) {
      setSelectionLoading(true);
      setError(null);
      try {
        const next = await client.getPresentationPreview(sessionId, selectedArtifact.id);
        if (!next.watchUrl) {
          setError("The interactive presentation preview is unavailable. Try refreshing the preview.");
          return;
        }
        setPreview(next);
        setIssues(next.issues);
        setSelectionMode(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSelectionLoading(false);
      }
      return;
    }
    setSelectionLoading(true);
    setError(null);
    try {
      const selection = await client.getPresentationSelection(sessionId, selectedArtifact.id, selectedSurfaceId);
      if (!selection) {
        setError("Select an element in the presentation preview first.");
        return;
      }
      onArtifactSelection?.(selection);
      setSelectionMode(false);
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
      await refreshArtifacts();
      onViewChange("issues");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const activeSurfaceIndex = Math.max(0, preview.surfaces.findIndex((surface) => surface.id === selectedSurfaceId));
  const activeSurface = preview.surfaces[activeSurfaceIndex];
  const previewPadding = 24;
  const availablePreviewWidth = Math.max(1, previewViewport.width - previewPadding);
  // Presentation slides are horizontal; fit their base size to the panel width.
  const fitScale = availablePreviewWidth / previewImage.width;
  const renderedPreviewWidth = Math.max(1, Math.round(previewImage.width * fitScale * previewZoom / 100));
  const renderedPreviewHeight = Math.max(1, Math.round(previewImage.height * fitScale * previewZoom / 100));
  const previewViewportReady = previewViewport.width > 0 && previewViewport.height > 0;
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
    return <section className="min-h-0 flex-1 overflow-y-auto p-3"><div className="grid gap-3">{preview.surfaces.map((surface, index) => <button aria-label={`Open slide ${index + 1}`} className={`group relative aspect-[16/9] w-full overflow-hidden rounded-[4px] border bg-white transition-[border-color,box-shadow] ${surface.id === selectedSurfaceId ? "border-[#8eab55] shadow-[0_0_0_1px_rgba(142,171,85,0.18)] dark:border-[#a6c66e]" : "border-[#deded9] hover:border-[#b9b9b2] dark:border-border dark:hover:border-[#77786f]"}`} key={surface.id} onClick={() => { setSelectedSurfaceId(surface.id); onViewChange("preview"); }} type="button">{surface.thumbnailUrl ? <img alt={`Slide ${index + 1}`} className="h-full w-full object-contain" src={surface.thumbnailUrl} /> : <span className="grid h-full w-full place-items-center bg-[#f7f7f4] dark:bg-card"><Image className="h-4 w-4 text-[#a0a099]" /></span>}</button>)}{loadingPreview ? <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Rendering slides</div> : null}</div></section>;
  }

  if (view === "assets") {
    return <section className="p-4"><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-[#718747] dark:text-[#c4e07c]" /><h2 className="text-[12px] font-semibold text-[#3c3c37] dark:text-foreground">Presentation assets</h2></div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Workspace files, uploaded images, and optional generated images are available to the agent as references. This deck currently uses the managed PPTX artifact.</p><div className="mt-4 border-y border-[#e4e4df] py-3 text-[11px] text-[#55554f] dark:border-border dark:text-muted-foreground"><span className="font-mono text-[10px] text-[#85857e]">OUTPUT</span><p className="mt-1 truncate font-medium text-foreground">{selectedArtifact.sourcePath}</p></div></section>;
  }

  if (view === "issues") {
    return <section className="p-4"><div className="flex items-center gap-2"><ScanSearch className="h-4 w-4 text-[#718747] dark:text-[#c4e07c]" /><h2 className="text-[12px] font-semibold text-[#3c3c37] dark:text-foreground">Document checks</h2><span className={`ml-auto text-[10px] font-medium ${issueTone(issues)}`}>{qualityLabel(selectedArtifact)}</span></div>{selectedArtifact.quality ? <p className="mt-1.5 text-[10px] text-muted-foreground">Revision {selectedArtifact.quality.revision} · cycle {selectedArtifact.quality.cycle} · {selectedArtifact.quality.reviewedSlides}/{selectedArtifact.quality.totalSlides} slides reviewed</p> : null}<Button className="mt-3 w-full" onClick={() => void validate()} size="sm" type="button" variant="outline"><ScanSearch className="h-3.5 w-3.5" />Run full check</Button><div className="mt-3 divide-y divide-[#e8e8e3] border-y border-[#e8e8e3] dark:divide-border dark:border-border">{issues.length ? issues.map((issue, index) => <button className="block w-full py-2.5 text-left disabled:cursor-default" disabled={!issue.surfaceId} key={`${issue.message}:${index}`} onClick={() => { if (!issue.surfaceId) return; setSelectedSurfaceId(issue.surfaceId); onViewChange("preview"); }} type="button"><div className="flex items-center gap-2"><p className={`text-[11px] font-medium ${issue.severity === "error" ? "text-[#af5045] dark:text-[#f0aaa0]" : "text-[#8d6b28] dark:text-[#ddbd69]"}`}>{issue.code ?? (issue.severity === "error" ? "Error" : "Warning")}</p>{issue.category ? <span className="text-[9px] uppercase text-muted-foreground">{issue.category}</span> : null}</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{issue.message}</p>{issue.locator ? <p className="mt-1 truncate font-mono text-[10px] text-[#888880]">{issue.locator}</p> : null}{issue.suggestion ? <p className="mt-1 text-[10px] text-[#718747] dark:text-[#c4e07c]">{issue.suggestion}</p> : null}</button>) : <div className="py-5 text-center"><CheckCircle2 className="mx-auto h-4 w-4 text-[#708746] dark:text-[#c6df7d]" /><p className="mt-2 text-[11px] text-muted-foreground">No deterministic document issues reported.</p></div>}</div></section>;
  }

  return <section className="flex min-h-0 flex-1 flex-col"><div className="flex items-center justify-between border-b border-[#e4e4df] px-3 py-2.5 dark:border-border"><div className="min-w-0"><p className="truncate text-[12px] font-semibold text-[#3c3c37] dark:text-foreground">{selectedArtifact.displayName}</p><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">Slide {activeSurfaceIndex + 1} of {preview.surfaces.length || 1}</p></div><div className="flex items-center gap-0.5"><Tooltip><TooltipTrigger asChild><Button aria-label="Refresh preview" disabled={loadingPreview} onClick={() => void refreshPreview(selectedArtifact.id, true)} size="icon" type="button" variant="ghost"><RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? "animate-spin" : ""}`} /></Button></TooltipTrigger><TooltipContent>Refresh preview</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Open presentation" onClick={() => void client.openPresentationArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Open in PowerPoint</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Reveal presentation" onClick={() => void client.revealPresentationArtifact(sessionId, selectedArtifact.id)} size="icon" type="button" variant="ghost"><FolderOpen className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Reveal in Finder</TooltipContent></Tooltip></div></div><div className="relative min-h-0 flex-1 overflow-auto bg-[#e9e9e5] dark:bg-[#151710]" ref={previewViewportRef}>{selectionMode && preview.watchUrl ? <><iframe className="h-full w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin" src={preview.watchUrl} title="Interactive presentation selection" /><div className="pointer-events-none absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-[6px] border border-[#cbd8b5] bg-white/95 py-1 pl-2.5 pr-1 text-[10px] font-medium text-[#52663a] shadow-[0_2px_8px_rgba(0,0,0,0.12)] backdrop-blur-sm dark:border-[#53663a] dark:bg-[#23271d]/95 dark:text-[#cbe49e]"><span className="whitespace-nowrap">Select an element, then confirm</span><button aria-label="Cancel presentation selection" className="pointer-events-auto grid h-5 w-5 place-items-center rounded-[4px] text-[#758266] hover:bg-[#edf2e5] hover:text-[#39452b] dark:hover:bg-[#3a442d] dark:hover:text-white" onClick={() => setSelectionMode(false)} type="button"><X className="h-3 w-3" /></button></div></> : loadingPreview || !previewViewportReady ? <div className="grid h-full w-full place-items-center"><div className="flex items-center gap-2 text-[11px] text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Rendering preview</div></div> : activeSurface?.thumbnailUrl ? <div className="flex items-center justify-center" style={{ height: Math.max(previewViewport.height, renderedPreviewHeight + previewPadding), width: Math.max(previewViewport.width, renderedPreviewWidth + previewPadding) }}><img alt={activeSurface.label} className="block shrink-0 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.12)]" height={renderedPreviewHeight} key={activeSurface.id} onLoad={(event) => setPreviewImage({ width: event.currentTarget.naturalWidth || 16, height: event.currentTarget.naturalHeight || 9 })} src={activeSurface.thumbnailUrl} width={renderedPreviewWidth} /></div> : preview.htmlUrl ? <iframe className="h-full w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin" src={preview.htmlUrl} title="Presentation preview" /> : <div className="grid h-full w-full place-items-center px-6 text-center text-[11px] leading-5 text-muted-foreground">The preview will appear after the document is rendered.</div>}</div><div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-[#e4e4df] px-3 py-2 dark:border-border"><div className="flex min-w-0 items-center gap-1"><Button aria-label="Previous slide" disabled={selectionMode || activeSurfaceIndex === 0} onClick={() => moveSurface(-1)} size="icon" type="button" variant="ghost"><ChevronLeft className="h-3.5 w-3.5" /></Button><Button aria-label="Next slide" disabled={selectionMode || activeSurfaceIndex >= preview.surfaces.length - 1} onClick={() => moveSurface(1)} size="icon" type="button" variant="ghost"><ChevronRight className="h-3.5 w-3.5" /></Button></div><div className={`flex h-7 items-center rounded-[6px] border border-[#d8d8d2] bg-white p-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-border dark:bg-card ${selectionMode ? "invisible" : ""}`}><button aria-label="Zoom out" className="grid h-6 w-6 place-items-center rounded-[4px] text-[#777770] hover:bg-[#f0f0ec] hover:text-[#33332f] disabled:opacity-35 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground" disabled={previewZoom <= minimumPreviewZoom} onClick={() => setPreviewZoom((current) => constrainedPreviewZoom(current - previewZoomStep))} type="button"><Minus className="h-3 w-3" /></button><button aria-label="Reset zoom" className="h-6 min-w-[42px] rounded-[4px] px-1 font-mono text-[9px] font-semibold text-[#5d5d57] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={() => setPreviewZoom(100)} title="Reset zoom" type="button">{previewZoom}%</button><button aria-label="Zoom in" className="grid h-6 w-6 place-items-center rounded-[4px] text-[#777770] hover:bg-[#f0f0ec] hover:text-[#33332f] disabled:opacity-35 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground" disabled={previewZoom >= maximumPreviewZoom} onClick={() => setPreviewZoom((current) => constrainedPreviewZoom(current + previewZoomStep))} type="button"><Plus className="h-3 w-3" /></button></div><div className="flex items-center justify-end gap-0.5"><Tooltip><TooltipTrigger asChild><Button aria-label={selectionMode ? "Confirm presentation selection" : "Use selection"} className={selectionMode ? "bg-[#e8f0dc] text-[#52683a] hover:bg-[#dfe9cf] dark:bg-[#354329] dark:text-[#cce5a0] dark:hover:bg-[#405032]" : undefined} disabled={selectionLoading || !preview.watchUrl} onClick={() => void captureSelection()} size="icon" type="button" variant="ghost">{selectionLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <img alt="" className="h-4 w-4 object-contain" src={useSelectionIcon} />}</Button></TooltipTrigger><TooltipContent>{selectionMode ? "Use selected element" : "Use selection"}</TooltipContent></Tooltip><Tooltip><TooltipTrigger asChild><Button aria-label="Check presentation" onClick={() => void validate()} size="icon" type="button" variant="ghost"><img alt="" className="h-4 w-4 object-contain" src={checkPresentationIcon} /></Button></TooltipTrigger><TooltipContent>Check presentation</TooltipContent></Tooltip></div></div>{error ? <p className="border-t border-[#efd6d0] px-3 py-2 text-[10px] leading-4 text-destructive dark:border-[#5b3c35]" role="alert">{error}</p> : null}</section>;
}
