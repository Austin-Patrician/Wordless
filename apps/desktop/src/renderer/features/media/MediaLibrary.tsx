import { Button, Dialog, DialogContent, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@wordless/ui-kit";
import type { MediaProjectSummary } from "@wordless/domain";
import { Clock3, EllipsisVertical, ImagePlus, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRuntime } from "../../shared/runtime";

type MediaLibraryProps = {
  onOpenProject: (sessionId: string) => void;
};

function formattedDate(value: number, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(value);
}

export function MediaLibrary({ onOpenProject }: MediaLibraryProps) {
  const { client, refresh, snapshot } = useRuntime();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [renamingProject, setRenamingProject] = useState<MediaProjectSummary | null>(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [deletingProject, setDeletingProject] = useState<MediaProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const projects = (snapshot?.mediaProjects ?? []).filter((project) => project.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const locale = snapshot?.preferences.locale ?? "zh-CN";

  useEffect(() => {
    if (!renamingProject) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renamingProject]);

  const createProject = async () => {
    if (!client || creating) return;
    setCreating(true);
    try {
      const project = await client.createMediaProject();
      await refresh();
      onOpenProject(project.sessionId);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const beginRename = (project: MediaProjectSummary) => {
    setOperationError(null);
    setProjectTitle(project.title);
    setRenamingProject(project);
  };

  const saveRename = async () => {
    if (!client || !renamingProject) return;
    const title = projectTitle.trim();
    if (!title) {
      setOperationError(locale === "zh-CN" ? "画布名称不能为空" : "Canvas name is required");
      return;
    }
    try {
      await client.renameSession(renamingProject.sessionId, title);
      await refresh();
      setRenamingProject(null);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteProject = async () => {
    if (!client || !deletingProject) return;
    setDeleting(true);
    try {
      await client.deleteSession(deletingProject.sessionId);
      await refresh();
      setDeletingProject(null);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-[var(--wordless-shell-workspace)] px-7 py-7 sm:px-9">
      <div className="mx-auto max-w-[1160px]">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-full max-w-[320px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#909089]" />
            <input aria-label="Search media projects" className="h-9 w-full rounded-[7px] border border-[#dfdfda] bg-white pl-9 pr-3 text-[12px] text-[#44453f] outline-none transition-shadow placeholder:text-[#a3a39c] focus:border-[#9cac70] focus:ring-2 focus:ring-[#e5eec8] dark:border-border dark:bg-card dark:text-foreground" onChange={(event) => setQuery(event.target.value)} placeholder={locale === "zh-CN" ? "搜索项目" : "Search projects"} value={query} />
          </div>
          <button className="flex h-9 shrink-0 items-center gap-2 rounded-[7px] bg-[#292a27] px-3.5 text-[12px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-colors hover:bg-[#3a3b37] disabled:opacity-55" disabled={creating} onClick={() => void createProject()} type="button">
            <Plus className="h-3.5 w-3.5" />
            {creating ? (locale === "zh-CN" ? "正在创建" : "Creating") : (locale === "zh-CN" ? "新建画布" : "New canvas")}
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="grid min-h-[520px] place-items-center">
            <div className="max-w-[390px] text-center">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-[8px] border border-[#ddddD7] bg-[#f5f5f1] text-[#687840] dark:border-border dark:bg-muted dark:text-[#d1e993]"><ImagePlus className="h-5 w-5" /></span>
              <p className="mt-5 text-[15px] font-semibold text-[#343530] dark:text-foreground">{locale === "zh-CN" ? "创建你的第一个图片画布" : "Create your first image canvas"}</p>
              <p className="mx-auto mt-2 max-w-[320px] text-[12px] leading-5 text-[#7d7d76] dark:text-muted-foreground">{locale === "zh-CN" ? "在无限画布中组织参考图、生成候选和最终画面。" : "Organize references, generated candidates, and final frames on an infinite canvas."}</p>
              <button className="mt-5 inline-flex h-8 items-center gap-2 rounded-[7px] border border-[#d9d9d3] bg-white px-3 text-[12px] font-semibold text-[#42433e] hover:bg-[#f3f3ef] dark:border-border dark:bg-card dark:text-foreground" disabled={creating} onClick={() => void createProject()} type="button"><Sparkles className="h-3.5 w-3.5 text-[#71823e]" />{locale === "zh-CN" ? "新建画布" : "New canvas"}</button>
            </div>
          </div>
        ) : (
          <div className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-5 gap-y-7">
            {projects.map((project) => {
              const renaming = renamingProject?.sessionId === project.sessionId;
              return <article className="group relative min-w-0" key={project.sessionId}>
              <button aria-label={project.title} className="block w-full text-left" onClick={() => onOpenProject(project.sessionId)} type="button">
                <div className="relative aspect-[16/10] overflow-hidden rounded-[7px] border border-[#e0e0db] bg-[#eff0eb] shadow-[0_1px_2px_rgba(0,0,0,0.025)] transition-all group-hover:-translate-y-0.5 group-hover:border-[#afb99a] group-hover:shadow-[0_8px_22px_rgba(42,45,32,0.09)] dark:border-border dark:bg-muted">
                {project.previewImageUrl ? <img alt="" className="h-full w-full object-cover grayscale-[10%]" src={project.previewImageUrl} /> : <div className="absolute inset-0 bg-[radial-gradient(#d1d2ca_0.6px,transparent_0.6px)] bg-[size:14px_14px]"><div className="absolute inset-x-5 bottom-5 border-t border-dashed border-[#cacbc3]" /><span className="absolute left-5 top-5 font-mono text-[9px] tracking-[.13em] text-[#888980]">SEQUENCE</span></div>}
                <span className="absolute bottom-2.5 left-2.5 rounded-[3px] bg-[#fbfbfa]/90 px-1.5 py-1 font-mono text-[8px] tracking-[.1em] text-[#51524d] dark:bg-[#23241f]/90 dark:text-[#e7eadf]">{String(project.readyAssetCount).padStart(2, "0")} / {String(project.assetCount).padStart(2, "0")} ASSETS</span>
                </div>
              </button>
              <DropdownMenu><DropdownMenuTrigger asChild><button aria-label={locale === "zh-CN" ? "画布操作" : "Canvas actions"} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-[5px] bg-white/92 text-[#52534d] opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100 focus:opacity-100 dark:bg-[#282a22]/92 dark:text-muted-foreground dark:hover:bg-[#30332a]" type="button"><EllipsisVertical className="h-4 w-4" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-28" onCloseAutoFocus={(event) => event.preventDefault()}><DropdownMenuItem onSelect={() => beginRename(project)}><Pencil className="h-3.5 w-3.5" />{locale === "zh-CN" ? "重命名" : "Rename"}</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeletingProject(project)}><Trash2 className="h-3.5 w-3.5" />{locale === "zh-CN" ? "删除" : "Delete"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
              <div className="mt-3 min-w-0">{renaming ? <input aria-label={locale === "zh-CN" ? "画布名称" : "Canvas name"} className="h-6 w-full rounded-[4px] border border-[#a4af80] bg-white px-1.5 text-[12px] font-semibold text-[#3d3e39] outline-none ring-2 ring-[#e5eec8] dark:border-[#a4af80] dark:bg-card dark:text-foreground dark:ring-[#46512c]" maxLength={120} onBlur={() => void saveRename()} onChange={(event) => setProjectTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.preventDefault(); setRenamingProject(null); } }} ref={renameInputRef} value={projectTitle} /> : <button className="block w-full truncate text-left text-[12px] font-semibold text-[#3d3e39] dark:text-foreground" onClick={() => onOpenProject(project.sessionId)} type="button">{project.title}</button>}<button className="mt-1 flex items-center gap-1.5 font-mono text-[9px] tracking-[.06em] text-[#94948d]" onClick={() => onOpenProject(project.sessionId)} type="button"><Clock3 className="h-3 w-3" />{formattedDate(project.updatedAt, locale)}</button></div>
            </article>;
            })}
          </div>
        )}
        {operationError ? <p className="mt-5 text-[11px] text-destructive">{operationError}</p> : null}
      </div>
      <Dialog onOpenChange={(open) => { if (!open && !deleting) setDeletingProject(null); }} open={deletingProject !== null}><DialogContent className="w-[min(25rem,calc(100vw-2rem))] rounded-[10px] border-[#d9d9d4] px-5 py-5 shadow-[0_18px_42px_rgba(20,20,17,0.18)]" showCloseButton={false}><DialogTitle className="text-[15px] font-bold text-foreground">{locale === "zh-CN" ? "删除画布" : "Delete canvas"}</DialogTitle><p className="mt-2 text-[12px] leading-5 text-muted-foreground">{locale === "zh-CN" ? `确定删除“${deletingProject?.title ?? ""}”吗？此操作会同时删除画布中的图片和生成记录。` : `Delete “${deletingProject?.title ?? ""}”? This also deletes its images and generation history.`}</p><div className="mt-5 flex justify-end gap-2"><Button className="h-8 px-3 text-[11px]" disabled={deleting} onClick={() => setDeletingProject(null)} type="button" variant="outline">{locale === "zh-CN" ? "取消" : "Cancel"}</Button><Button className="h-8 bg-destructive px-3 text-[11px] text-destructive-foreground hover:bg-destructive/90" disabled={deleting} onClick={() => void deleteProject()} type="button">{locale === "zh-CN" ? "删除" : "Delete"}</Button></div></DialogContent></Dialog>
    </section>
  );
}
