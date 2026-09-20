import { SIDEBAR_PINNED_LIMIT_MAX, SIDEBAR_PINNED_LIMIT_MIN } from "@wordless/domain";
import { GripVertical, Lock, Pin, PinOff, RotateCcw } from "lucide-react";
import { usePreferences } from "../../shared/preferences";
import type { SidebarNavRow } from "./sidebar-nav";
import type { SidebarNavDragHandlers, SidebarNavDragState, SidebarNavRegion } from "./use-sidebar-nav-drag";

/** One inline slot, so the control is not an open-ended number box. */
const PINNED_LIMIT_CHOICES: readonly number[] = Array.from(
  { length: SIDEBAR_PINNED_LIMIT_MAX - SIDEBAR_PINNED_LIMIT_MIN + 1 },
  (_, index) => SIDEBAR_PINNED_LIMIT_MIN + index,
);

export interface SidebarNavMorePanelProps {
  canPinMore: boolean;
  drag: SidebarNavDragState & SidebarNavDragHandlers;
  moreRows: readonly SidebarNavRow[];
  onItemClick: (row: SidebarNavRow) => void;
  onLimitChange: (pinnedLimit: number) => void;
  onPin: (id: string) => void;
  onReorder: (id: string, region: SidebarNavRegion, beforeId: string | null) => void;
  onReset: () => void;
  onUnpin: (id: string) => void;
  pinnedLimit: number;
  pinnedRows: readonly SidebarNavRow[];
}

function DropLine({ visible }: { visible: boolean }) {
  return <span aria-hidden className={`mx-1 block h-px rounded-full ${visible ? "bg-foreground/40" : "bg-transparent"}`} />;
}

function SidebarNavPanelRow({
  canPinMore,
  drag,
  onClick,
  onReorder,
  onTogglePin,
  region,
  rows,
  row,
}: {
  canPinMore: boolean;
  drag: SidebarNavMorePanelProps["drag"];
  onClick: () => void;
  onReorder: SidebarNavMorePanelProps["onReorder"];
  onTogglePin: (() => void) | null;
  region: SidebarNavRegion;
  rows: readonly SidebarNavRow[];
  row: SidebarNavRow;
}) {
  const { t } = usePreferences();
  const dragProps = drag.itemProps(row.id, region);
  const pinned = region === "pinned";

  /**
   * Dragging is the direct way; this is the same move for the keyboard, one
   * slot at a time. The locked row and the ends of a region simply do nothing.
   */
  const moveByKeyboard = (step: -1 | 1) => {
    const index = rows.findIndex((candidate) => candidate.id === row.id);
    const target = rows[index + step];
    if (!target) return;
    onReorder(row.id, region, step < 0 ? target.id : (rows[index + 2]?.id ?? null));
  };

  return (
    <div
      className={`group flex items-center gap-1 rounded-lg pr-1 ${drag.draggingId === row.id ? "opacity-40" : ""}`}
      data-sidebar-nav-row={row.id}
      draggable={dragProps.draggable && !row.locked}
      onDragEnd={dragProps.onDragEnd}
      onDragOver={dragProps.onDragOver}
      onDragStart={dragProps.onDragStart}
      onDrop={dragProps.onDrop}
      onKeyDown={(event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        moveByKeyboard(event.key === "ArrowUp" ? -1 : 1);
      }}
    >
      {row.locked ? (
        <Lock aria-label={t("sidebarNavLocked")} className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      ) : (
        <GripVertical aria-hidden className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40" />
      )}
      <button
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[12px] ${
          row.active ? "bg-[#e3e3df] font-semibold text-foreground dark:bg-[#2a2c22]" : "text-foreground hover:bg-[#e7e7e3] dark:hover:bg-[#282a21]"
        }`}
        onClick={onClick}
        title={row.label}
        type="button"
      >
        <row.icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
      </button>
      {onTogglePin ? (
        <button
          aria-label={pinned ? t("sidebarNavUnpin") : canPinMore ? t("sidebarNavPin") : t("sidebarNavPinFull")}
          aria-pressed={pinned}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground/60 hover:bg-[#e7e7e3] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-[#282a21] ${
            pinned ? "text-foreground" : ""
          }`}
          disabled={!pinned && !canPinMore}
          onClick={onTogglePin}
          title={pinned ? t("sidebarNavUnpin") : canPinMore ? t("sidebarNavPin") : t("sidebarNavPinFull")}
          type="button"
        >
          {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
        </button>
      ) : (
        <span aria-hidden className="h-6 w-6 shrink-0" />
      )}
    </div>
  );
}

/**
 * The "More" panel is two things at once: the list of entries that do not fit
 * inline, and the place where the sidebar is arranged. Rows are grouped by
 * region and can be dragged between them, pinned and unpinned, or moved with
 * Alt+arrow keys.
 */
export function SidebarNavMorePanel({
  canPinMore,
  drag,
  moreRows,
  onItemClick,
  onLimitChange,
  onPin,
  onReorder,
  onReset,
  onUnpin,
  pinnedLimit,
  pinnedRows,
}: SidebarNavMorePanelProps) {
  const { t } = usePreferences();
  const pinnedRegion = drag.regionProps("pinned");
  const moreRegion = drag.regionProps("more");

  const row = (candidate: SidebarNavRow, region: SidebarNavRegion) => (
    <div key={candidate.id}>
      <DropLine visible={drag.isDropBefore(candidate.id, region)} />
      <SidebarNavPanelRow
        canPinMore={canPinMore}
        drag={drag}
        onClick={() => onItemClick(candidate)}
        onReorder={onReorder}
        onTogglePin={candidate.locked ? null : region === "pinned" ? () => onUnpin(candidate.id) : () => onPin(candidate.id)}
        region={region}
        row={candidate}
        rows={region === "pinned" ? pinnedRows : moreRows}
      />
    </div>
  );

  return (
    <div className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto" data-sidebar-nav-panel="">
      <div className="flex items-center gap-1 px-2 pt-1">
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t("sidebarNavPinnedSection")}
        </p>
        <button
          aria-label={t("sidebarNavReset")}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-[#e7e7e3] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-[#282a21]"
          onClick={onReset}
          title={t("sidebarNavReset")}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col" onDragOver={pinnedRegion.onDragOver} onDrop={pinnedRegion.onDrop}>
        {pinnedRows.map((candidate) => row(candidate, "pinned"))}
        <DropLine visible={drag.isDropAtEnd("pinned")} />
      </div>

      <p className="px-2 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {t("sidebarNavMoreSection")}
      </p>
      <div className="flex min-h-6 flex-col" onDragOver={moreRegion.onDragOver} onDrop={moreRegion.onDrop}>
        {moreRows.map((candidate) => row(candidate, "more"))}
        <DropLine visible={drag.isDropAtEnd("more")} />
      </div>

      <div className="mt-1 flex items-center gap-1 border-t border-border px-2 pt-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={t("sidebarNavLimitHelp")}>
          {t("sidebarNavLimit")}
        </span>
        <div aria-label={t("sidebarNavLimit")} className="flex items-center gap-0.5" role="group">
          {PINNED_LIMIT_CHOICES.map((choice) => (
            <button
              aria-pressed={choice === pinnedLimit}
              className={`grid h-6 w-6 place-items-center rounded-md text-[11px] ${
                choice === pinnedLimit
                  ? "bg-[#e3e3df] font-semibold text-foreground dark:bg-[#2a2c22]"
                  : "text-muted-foreground hover:bg-[#e7e7e3] hover:text-foreground dark:hover:bg-[#282a21]"
              }`}
              key={choice}
              onClick={() => onLimitChange(choice)}
              type="button"
            >
              {choice}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
