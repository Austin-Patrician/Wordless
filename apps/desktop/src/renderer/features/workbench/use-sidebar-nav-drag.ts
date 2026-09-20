import type { DragEvent } from "react";
import { useCallback, useMemo, useState } from "react";

/** Custom payload type so this drag cannot be confused with a file or session drag. */
export const SIDEBAR_NAV_DRAG_MIME = "application/x-wordless-sidebar-nav";

export type SidebarNavRegion = "pinned" | "more";

export interface SidebarNavDropTarget {
  region: SidebarNavRegion;
  /** Insert before this entry; null means the end of the region. */
  beforeId: string | null;
}

export interface SidebarNavDragState {
  /** Entry being dragged, or null. */
  draggingId: string | null;
  /** Where the pointer currently sits, used to draw the insertion line. */
  dropTarget: SidebarNavDropTarget | null;
}

export interface SidebarNavDragHandlers {
  /** Bind to the draggable rows of a region. */
  itemProps: (id: string, region: SidebarNavRegion) => {
    draggable: boolean;
    onDragStart: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
  /** Bind to a region's list so the empty space below the rows accepts a drop. */
  regionProps: (region: SidebarNavRegion) => {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
  /** Whether the line above this entry is the current drop target. */
  isDropBefore: (id: string, region: SidebarNavRegion) => boolean;
  /** Whether the line at the end of this region is the current drop target. */
  isDropAtEnd: (region: SidebarNavRegion) => boolean;
  /** Drops the in-flight state, for when the panel closes mid-drag. */
  resetDrag: () => void;
}

/**
 * Reordering for the sidebar's "More" panel, using the browser's own drag and
 * drop: the rows are already buttons, so this needs no pointer layer and no new
 * dependency.
 *
 * The drop position means "before this entry": the upper half of a row inserts
 * before it, the lower half inserts before the next one, and the empty space of
 * a region appends. Which region may hold which entry, and how many, is decided
 * by the layout functions in the domain package — this hook only reports where
 * the pointer is.
 */
export function useSidebarNavDrag(
  onMove: (id: string, region: SidebarNavRegion, beforeId: string | null) => void,
  idsByRegion: Readonly<Record<SidebarNavRegion, readonly string[]>>,
): SidebarNavDragState & SidebarNavDragHandlers {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarNavDropTarget | null>(null);

  const reset = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const readDraggedId = useCallback(
    (event: DragEvent<HTMLElement>): string | null => {
      // Most browsers withhold the payload during dragover, so fall back to the
      // id kept in memory when the drag started.
      const fromData = event.dataTransfer?.getData(SIDEBAR_NAV_DRAG_MIME);
      return fromData || draggingId;
    },
    [draggingId],
  );

  const commit = useCallback(
    (event: DragEvent<HTMLElement>, target: SidebarNavDropTarget) => {
      event.preventDefault();
      event.stopPropagation();
      const id = readDraggedId(event);
      reset();
      if (!id || id === target.beforeId) return;
      onMove(id, target.region, target.beforeId);
    },
    [onMove, readDraggedId, reset],
  );

  const hover = useCallback((event: DragEvent<HTMLElement>, target: SidebarNavDropTarget) => {
    if (!event.dataTransfer?.types?.includes(SIDEBAR_NAV_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) =>
      current && current.region === target.region && current.beforeId === target.beforeId ? current : target,
    );
  }, []);

  const resolveRowTarget = useCallback(
    (event: DragEvent<HTMLElement>, id: string, region: SidebarNavRegion): SidebarNavDropTarget => {
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientY - rect.top > rect.height / 2;
      if (!after) return { region, beforeId: id };
      const list = idsByRegion[region];
      const index = list.indexOf(id);
      const next = index >= 0 ? list[index + 1] : undefined;
      return { region, beforeId: next ?? null };
    },
    [idsByRegion],
  );

  return useMemo(
    () => ({
      draggingId,
      dropTarget,
      itemProps: (id, region) => ({
        draggable: true,
        onDragStart: (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(SIDEBAR_NAV_DRAG_MIME, id);
          setDraggingId(id);
        },
        onDragEnd: reset,
        onDragOver: (event) => hover(event, resolveRowTarget(event, id, region)),
        onDrop: (event) => commit(event, resolveRowTarget(event, id, region)),
      }),
      regionProps: (region) => ({
        onDragOver: (event) => hover(event, { region, beforeId: null }),
        onDrop: (event) => commit(event, { region, beforeId: null }),
      }),
      isDropBefore: (id, region) => dropTarget !== null && dropTarget.region === region && dropTarget.beforeId === id,
      isDropAtEnd: (region) => dropTarget !== null && dropTarget.region === region && dropTarget.beforeId === null,
      resetDrag: reset,
    }),
    [commit, draggingId, dropTarget, hover, reset, resolveRowTarget],
  );
}
