import type { WorkspaceRecord } from "@wordless/domain";
import { Folder, FolderOpen, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { usePreferences } from "../../shared/preferences";

type WorkspacePickerProps = {
  allowNoWorkspace?: boolean;
  onCreate: (name: string) => Promise<WorkspaceRecord>;
  onOpenLocal: () => Promise<WorkspaceRecord | null>;
  onOpenChange: (open: boolean) => void;
  onSelect: (workspaceId: string | null) => void;
  open: boolean;
  selectedWorkspaceId: string | null;
  workspaces: WorkspaceRecord[];
  placement?: "composer" | "below";
};

export function WorkspacePicker({ allowNoWorkspace = true, onCreate, onOpenChange, onOpenLocal, onSelect, open, placement = "composer", selectedWorkspaceId, workspaces }: WorkspacePickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { t } = usePreferences();
  const matchingWorkspaces = useMemo(
    () => [...workspaces]
      .filter((workspace) => workspace.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt),
    [query, workspaces],
  );
  const visibleWorkspaces = query.trim() ? matchingWorkspaces : matchingWorkspaces.slice(0, 5);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onOpenChange, open]);

  const chooseWorkspace = (workspaceId: string | null) => {
    onSelect(workspaceId);
    onOpenChange(false);
  };

  const createWorkspace = async (name: string) => {
    const workspace = await onCreate(name);
    setCreateDialogOpen(false);
    chooseWorkspace(workspace.id);
  };

  const openLocal = async () => {
    const workspace = await onOpenLocal();
    if (workspace) chooseWorkspace(workspace.id);
  };

  if (!open && !createDialogOpen) return null;

  return (
    <>
      {open ? (
        <div className={`absolute ${placement === "below" ? "bottom-[34px]" : "bottom-[50px]"} left-0 z-[60] w-[250px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-b-[15px] rounded-tr-[15px] border border-[#e5e6e8] bg-white p-2 font-['Inter','Noto_Sans_SC','Manrope',sans-serif] text-[#1d2025] shadow-[0_11px_26px_rgba(30,35,43,0.09)] dark:border-[#3c3f43] dark:bg-[#202225] dark:text-[#edf0f2]`} ref={panelRef} role="menu">
          <label className="flex h-[32px] items-center gap-2 rounded-[8px] bg-[#f5f5f5] px-2.5 text-[#777b82] transition focus-within:ring-2 focus-within:ring-[#bfc9d6] dark:bg-[#2b2e32] dark:text-[#aeb3b9]">
            <Search className="shrink-0 text-[#60646b] dark:text-[#d8dce0]" size={16} strokeWidth={2} />
            <input
              aria-label={t("searchWorkspace")}
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-[13px] leading-none text-[#25282d] outline-none placeholder:text-[#9b9ea3] dark:text-[#f0f2f4]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchWorkspace")}
              value={query}
            />
          </label>
          <div className="my-1 max-h-[190px] overflow-y-auto border-b border-[#eeeeef] pb-1 dark:border-[#3b3e42]">
            {visibleWorkspaces.map((workspace) => {
              const available = workspace.availability === "available";
              return <button className="flex h-[32px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] font-medium text-[#272a30] transition hover:bg-[#f5f6f7] disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#edf0f2] dark:hover:bg-[#2a2d31]" disabled={!available} key={workspace.id} onClick={() => chooseWorkspace(workspace.id)} title={available ? undefined : t("unavailable")} type="button">
                <FolderOpen className="shrink-0 text-[#4b4f55] dark:text-[#c5c9cd]" size={16} strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {available && selectedWorkspaceId === workspace.id ? <span className="size-1.5 shrink-0 rounded-full bg-[#8eb526]" /> : null}
                {!available ? <span className="shrink-0 text-[10px] text-[#8d675f] dark:text-[#d5a199]">{t("unavailable")}</span> : null}
              </button>
            })}
            {query.trim() && visibleWorkspaces.length === 0 ? <p className="px-2 py-2 text-[12px] text-[#989ba0]">{t("noMatchingWorkspace")}</p> : null}
          </div>
          <div className="space-y-0.5">
            <button className="flex h-[32px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] font-medium text-[#272a30] transition hover:bg-[#f5f6f7] dark:text-[#edf0f2] dark:hover:bg-[#2a2d31]" onClick={() => { setCreateDialogOpen(true); onOpenChange(false); }} type="button">
              <Plus className="shrink-0 text-[#4c5056] dark:text-[#c5c9cd]" size={16} strokeWidth={1.9} />
              <span className="truncate">{t("newProjectSpace")}</span>
            </button>
            <button className="flex h-[32px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] font-medium text-[#272a30] transition hover:bg-[#f5f6f7] dark:text-[#edf0f2] dark:hover:bg-[#2a2d31]" onClick={() => void openLocal()} type="button">
              <Folder className="shrink-0 text-[#4c5056] dark:text-[#c5c9cd]" size={16} strokeWidth={1.8} />
              <span className="truncate">{t("openLocalFolder")}</span>
            </button>
          </div>
          {allowNoWorkspace && selectedWorkspaceId !== null ? (
            <div className="mt-1 border-t border-[#eeeeef] pt-1 dark:border-[#3b3e42]">
              <button className="flex h-[32px] w-full items-center gap-2 rounded-[7px] px-2 text-left text-[13px] font-medium text-[#676b70] transition hover:bg-[#f5f6f7] dark:text-[#c5c9cd] dark:hover:bg-[#2a2d31]" onClick={() => chooseWorkspace(null)} type="button">
                <X className="shrink-0" size={16} strokeWidth={1.8} />
                <span className="truncate">{t("noWorkspace")}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <CreateWorkspaceDialog onCreate={createWorkspace} onOpenChange={setCreateDialogOpen} open={createDialogOpen} />
    </>
  );
}
