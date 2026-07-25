import { ArrowLeft, ChevronDown, MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { SessionArtifactDiff, SessionArtifactFile, SessionContextSnapshot, SessionWorkspaceTextFile, WorkspaceFileEntry } from "@wordless/protocol";
import { getFileIcon, getFolderIcon } from "../../shared/fileIcons";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import type { WorkspaceAttachment } from "../thread/Composer";
import { DocumentPreview } from "./DocumentPreview";

export type ContextPanelView = "overview" | "files" | "changes";

type CodingContextPanelProps = {
  onAttachFile: (attachment: WorkspaceAttachment) => void;
  onViewChange: (view: ContextPanelView) => void;
  sessionId: string;
  view: ContextPanelView;
};

type ContextMenuState = {
  entry: WorkspaceFileEntry;
  x: number;
  y: number;
};

type PreviewState =
  | { kind: "file"; path: string; name: string }
  | { kind: "diff"; path: string; name: string };

function emptyContext(): SessionContextSnapshot {
  return { workspace: null, artifacts: [], changes: [] };
}

function extensionFrom(fileName: string): string | undefined {
  const index = fileName.lastIndexOf(".");
  return index > 0 && index < fileName.length - 1 ? fileName.slice(index + 1) : undefined;
}

function FileIcon({ entry, open = false }: { entry: Pick<WorkspaceFileEntry, "kind" | "name">; open?: boolean }) {
  const markup = entry.kind === "directory" ? getFolderIcon(entry.name, open) : getFileIcon(extensionFrom(entry.name), entry.name);
  return <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center [&_svg]:h-4 [&_svg]:w-4" dangerouslySetInnerHTML={{ __html: markup }} />;
}

function DiffPreview({ diff, name, onBack }: { diff: SessionArtifactDiff | null; name: string; onBack: () => void }) {
  const { t } = usePreferences();
  if (diff?.status === "unavailable") {
    const detail = diff.reason === "baseline-missing" ? t("diffUnavailable") : diff.reason === "binary" ? t("filePreviewBinary") : diff.reason === "too-large" ? t("filePreviewTooLarge") : t("filePreviewUnavailable");
    return <section className="flex min-h-0 flex-1 flex-col"><header className="flex shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 py-2 dark:border-border"><button aria-label={t("back")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={onBack} type="button"><ArrowLeft className="h-3.5 w-3.5" /></button><span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#3e3e39] dark:text-foreground">{name}</span></header><div className="grid flex-1 place-items-center px-5 text-center"><p className="text-[11px] leading-5 text-muted-foreground">{detail}</p></div></section>;
  }
  if (!diff) return <div className="grid min-h-0 flex-1 place-items-center text-[11px] text-muted-foreground">{t("running")}</div>;
  return <section className="flex min-h-0 flex-1 flex-col"><header className="flex shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 py-2 dark:border-border"><button aria-label={t("back")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={onBack} type="button">&larr;</button><span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#3e3e39] dark:text-foreground">{name}</span></header><div className="min-h-0 overflow-auto py-2 font-mono text-[11px] leading-5">{diff.patch.split("\n").map((line, index) => <div className={`min-w-max px-3 ${line.startsWith("+") && !line.startsWith("+++") ? "bg-[#eff7e7] text-[#547c36] dark:bg-[#29351d] dark:text-[#d8f28a]" : line.startsWith("-") && !line.startsWith("---") ? "bg-[#fbefec] text-[#9a564b] dark:bg-[#3a211d] dark:text-[#ffb4a8]" : line.startsWith("@@") ? "bg-[#f0f0ed] text-[#777770] dark:bg-muted dark:text-muted-foreground" : "text-[#65655f] dark:text-muted-foreground"}`} key={`${line}:${index}`}>{line || " "}</div>)}</div></section>;
}

export function CodingContextPanel({ onAttachFile, onViewChange, sessionId, view }: CodingContextPanelProps) {
  const client = useRuntimeClient();
  const { t } = usePreferences();
  const [context, setContext] = useState<SessionContextSnapshot>(emptyContext);
  const [directories, setDirectories] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [filePreview, setFilePreview] = useState<SessionWorkspaceTextFile | null>(null);
  const [diffPreview, setDiffPreview] = useState<SessionArtifactDiff | null>(null);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshContext = useCallback(async () => {
    try {
      setContext(await client.getSessionContext(sessionId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, sessionId]);

  const loadDirectory = useCallback(async (path: string) => {
    try {
      const entries = await client.listSessionWorkspaceDirectory(sessionId, path);
      setDirectories((current) => ({ ...current, [path]: entries }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, sessionId]);

  useEffect(() => {
    setDirectories({});
    setExpanded(new Set([""]));
    setSelectedPath(null);
    setPreview(null);
    setFilePreview(null);
    setDiffPreview(null);
    void refreshContext();
    void loadDirectory("");
    const unsubscribe = client.subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.event.type === "tool.completed" || event.event.type === "session.idle") void refreshContext();
    });
    return unsubscribe;
  }, [client, loadDirectory, refreshContext, sessionId]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (!preview) return;
    let active = true;
    if (preview.kind === "file") {
      setFilePreview(null);
      void client.readSessionWorkspaceTextFile(sessionId, preview.path).then((result) => { if (active) setFilePreview(result); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    } else {
      setDiffPreview(null);
      void client.getSessionArtifactDiff(sessionId, preview.path).then((result) => { if (active) setDiffPreview(result); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    }
    return () => { active = false; };
  }, [client, preview, sessionId]);

  const toggleDirectory = (entry: WorkspaceFileEntry) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else {
        next.add(entry.path);
        if (!directories[entry.path]) void loadDirectory(entry.path);
      }
      return next;
    });
  };

  const action = async (name: "open" | "reveal" | "save") => {
    if (!contextMenu) return;
    const path = contextMenu.entry.path;
    setContextMenu(null);
    try {
      if (name === "open") await client.openSessionWorkspaceFile(sessionId, path);
      if (name === "reveal") await client.revealSessionWorkspaceFile(sessionId, path);
      if (name === "save") await client.saveSessionWorkspaceFileAs(sessionId, path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const previewFile = (entry: Pick<SessionArtifactFile, "path" | "name">) => {
    setSelectedPath(entry.path);
    setPreview({ kind: "file", path: entry.path, name: entry.name });
  };

  if (!context.workspace) return <div className="p-4 text-[11px] text-muted-foreground">{t("noWorkspace")}</div>;
  if (preview?.kind === "file") return filePreview ? <DocumentPreview content={filePreview.status === "available" ? filePreview.content : null} name={preview.name} onBack={() => setPreview(null)} onOpen={() => void client.openSessionWorkspaceFile(sessionId, preview.path)} unavailableReason={filePreview.status === "unavailable" ? filePreview.reason : undefined} /> : <div className="grid min-h-0 flex-1 place-items-center text-[11px] text-muted-foreground">{t("running")}</div>;
  if (preview?.kind === "diff") return <DiffPreview diff={diffPreview} name={preview.name} onBack={() => setPreview(null)} />;

  if (view === "overview") {
    return <div className="p-4"><button aria-expanded={artifactsExpanded} className="flex w-full items-center gap-1.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[#86867f] dark:text-muted-foreground" onClick={() => setArtifactsExpanded((current) => !current)} type="button">{t("artifacts")}<ChevronDown className={`h-3 w-3 transition-transform ${artifactsExpanded ? "" : "-rotate-90"}`} /></button>{artifactsExpanded ? <div className="mt-2.5 space-y-0.5">{context.artifacts.length === 0 ? <p className="px-1 text-[11px] text-muted-foreground">{t("noArtifacts")}</p> : context.artifacts.map((artifact) => <button className="flex h-6 w-full items-center gap-2 rounded-[5px] px-1 text-left text-[8px] font-medium text-[#42423d] hover:bg-[#f0f0ec] dark:text-foreground dark:hover:bg-muted" key={artifact.path} onClick={() => previewFile(artifact)} type="button"><FileIcon entry={{ kind: "file", name: artifact.name }} /><span className="min-w-0 flex-1 truncate">{artifact.name}</span></button>)}</div> : null}</div>;
  }

  if (view === "changes") {
    return <div className="p-4"><p className="text-[12px] font-semibold text-[#4c4c47] dark:text-foreground">{t("fileChanges")}</p><div className="mt-3 space-y-0.5">{context.changes.length === 0 ? <p className="px-1 text-[11px] text-muted-foreground">{t("noSessionChanges")}</p> : context.changes.map((change) => <button className="flex h-7 w-full items-center gap-2 rounded-[5px] px-1 text-left text-[12px] text-[#454540] hover:bg-[#f0f0ec] dark:text-foreground dark:hover:bg-muted" key={change.path} onClick={() => setPreview({ kind: "diff", path: change.path, name: change.name })} type="button"><FileIcon entry={{ kind: "file", name: change.name }} /><span className="min-w-0 flex-1 truncate">{change.name}</span><span className={`font-mono text-[9px] ${change.kind === "created" ? "text-[#5d823e]" : "text-[#8a8a83]"}`}>{change.kind === "created" ? "A" : "M"}</span></button>)}</div></div>;
  }

  return <div className="relative p-3"><WorkspaceTree directories={directories} expanded={expanded} onContextMenu={(entry, event) => { event.preventDefault(); setSelectedPath(entry.path); setContextMenu({ entry, x: event.clientX, y: event.clientY }); }} onPreview={previewFile} onToggleDirectory={toggleDirectory} selectedPath={selectedPath} />{error ? <p className="mt-3 px-2 text-[10px] text-destructive">{error}</p> : null}{contextMenu ? <div className="fixed z-[100] w-[148px] rounded-[7px] border border-[#e4e4df] bg-white py-1 text-[11px] text-[#4c4c47] shadow-[0_8px_18px_rgba(0,0,0,0.12)] dark:border-border dark:bg-card dark:text-foreground" onPointerDown={(event) => event.stopPropagation()} style={{ left: contextMenu.x, top: contextMenu.y }}><button className="block w-full px-3 py-1.5 text-left hover:bg-[#f3f3f0] dark:hover:bg-muted" onClick={() => void action("open")} type="button">{t("openFile")}</button><button className="block w-full px-3 py-1.5 text-left hover:bg-[#f3f3f0] dark:hover:bg-muted" onClick={() => void action("reveal")} type="button">{t("openFileLocation")}</button><button className="block w-full px-3 py-1.5 text-left hover:bg-[#f3f3f0] dark:hover:bg-muted" onClick={() => void action("save")} type="button">{t("saveAs")}</button><button className="block w-full px-3 py-1.5 text-left hover:bg-[#f3f3f0] dark:hover:bg-muted" onClick={() => { onAttachFile({ path: contextMenu.entry.path, name: contextMenu.entry.name }); setContextMenu(null); }} type="button">{t("addToConversation")}</button></div> : null}</div>;
}

function WorkspaceTree({ directories, expanded, onContextMenu, onPreview, onToggleDirectory, selectedPath }: { directories: Record<string, WorkspaceFileEntry[]>; expanded: Set<string>; onContextMenu: (entry: WorkspaceFileEntry, event: ReactMouseEvent<HTMLButtonElement>) => void; onPreview: (entry: Pick<WorkspaceFileEntry, "path" | "name">) => void; onToggleDirectory: (entry: WorkspaceFileEntry) => void; selectedPath: string | null }) {
  const renderEntries = (path: string, depth: number): ReactNode[] => (directories[path] ?? []).flatMap((entry) => {
    const open = entry.kind === "directory" && expanded.has(entry.path);
    const row = <button className={`flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[8px] text-[#4b4b46] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted ${selectedPath === entry.path ? "border border-[#2bc6b2] bg-[#f0faf8] dark:bg-[#17312e]" : ""}`} key={entry.path} onClick={() => entry.kind === "directory" ? onToggleDirectory(entry) : onPreview(entry)} onContextMenu={(event) => entry.kind === "file" ? onContextMenu(entry, event) : undefined} style={{ paddingLeft: `${8 + depth * 14}px` }} type="button"><FileIcon entry={entry} open={open} /><span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.kind === "file" ? <MoreHorizontal className="h-3.5 w-3.5 text-[#aaa9a3]" /> : null}</button>;
    return open ? [row, ...renderEntries(entry.path, depth + 1)] : [row];
  });
  return <div className="space-y-0.5">{renderEntries("", 0)}</div>;
}
