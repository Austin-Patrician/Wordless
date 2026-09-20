import { SIDEBAR_PINNED_ANCHOR } from "@wordless/domain";
import { CalendarClock, Command, Folder, Images, ListTodo, UserRoundSearch, type LucideIcon } from "lucide-react";
import type { MessageKey } from "../../shared/i18n";

/**
 * Views the shell can show. The sidebar is the one place all of them are
 * listed, so the union lives next to its catalog rather than in the shell that
 * happens to own the state.
 */
export type WorkbenchMainView = "thread" | "skills" | "experts" | "media" | "automation" | "tasks";

/**
 * Ids in the order "More" lists entries the user never touched. This tuple is
 * the whole list: the rows and the click handlers are declared against it, so
 * adding an entry here is a compile error until both exist.
 */
export const SIDEBAR_NAV_ITEM_IDS = ["new", "media", "automation", "tasks", "experts", "skills"] as const;

export type SidebarNavItemId = (typeof SIDEBAR_NAV_ITEM_IDS)[number];

export interface SidebarNavItemDef {
  /**
   * Stored key, `data-tour` suffix and the name shortcuts refer to. Stable on
   * purpose: the arrangement, the first-run guide and the tests all address an
   * entry by it, so none of them break when an entry moves between regions.
   */
  id: SidebarNavItemId;
  labelKey: MessageKey;
  icon: LucideIcon;
  /** View the entry opens; null for the entry that starts a new conversation. */
  view: WorkbenchMainView | null;
}

/**
 * Which entries exist is this table's job; which of them are shown inline
 * belongs to the user (`SidebarPreferences`), so adding an entry never takes a
 * row away from one they chose — new entries land in "More".
 */
const SIDEBAR_NAV_ITEM_DEFS: Record<SidebarNavItemId, Omit<SidebarNavItemDef, "id">> = {
  // Locked to the first inline row; see SIDEBAR_PINNED_ANCHOR.
  new: { labelKey: "newThread", icon: Folder, view: null },
  media: { labelKey: "imageVideoGeneration", icon: Images, view: "media" },
  automation: { labelKey: "automations", icon: CalendarClock, view: "automation" },
  tasks: { labelKey: "tasks", icon: ListTodo, view: "tasks" },
  experts: { labelKey: "digitalEmployees", icon: UserRoundSearch, view: "experts" },
  skills: { labelKey: "skillsMcp", icon: Command, view: "skills" },
};

export const SIDEBAR_NAV_ITEMS: readonly SidebarNavItemDef[] = SIDEBAR_NAV_ITEM_IDS.map((id) => ({
  id,
  ...SIDEBAR_NAV_ITEM_DEFS[id],
}));

/**
 * Which entries a first-time sidebar shows inline. The rest are one click away
 * in "More", and the guide's anchors (new / skills / experts) are all kept here
 * so no first-run step loses its spotlight.
 */
export const DEFAULT_PINNED_SIDEBAR_NAV_IDS: readonly string[] = ["media", "skills", "experts"];

export interface SidebarNavRow {
  id: SidebarNavItemId;
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Locked rows cannot be moved or hidden; see `SIDEBAR_PINNED_ANCHOR`. */
  locked: boolean;
}

/** What each entry does, named so a missing handler is a compile error. */
export interface SidebarNavActions {
  newThread: () => void;
  openMedia: () => void;
  openAutomation: () => void;
  openTasks: () => void;
  openExperts: () => void;
  openSkills: () => void;
}

export function toSidebarNavClickHandlers(actions: SidebarNavActions): Record<SidebarNavItemId, () => void> {
  return {
    new: actions.newThread,
    media: actions.openMedia,
    automation: actions.openAutomation,
    tasks: actions.openTasks,
    experts: actions.openExperts,
    skills: actions.openSkills,
  };
}

export function findSidebarNavItem(id: string): SidebarNavItemDef | undefined {
  return SIDEBAR_NAV_ITEMS.find((item) => item.id === id);
}

/**
 * An entry is current when the shell shows the view it opens. The entry that
 * starts a conversation is current only on an empty conversation view: once a
 * conversation is open, no entry claims the row.
 */
export function isSidebarNavItemActive(
  item: SidebarNavItemDef,
  view: WorkbenchMainView,
  selectedSessionId: string | null,
): boolean {
  if (item.view === null) return view === "thread" && selectedSessionId === null;
  return view === item.view;
}

/** Rows for a list of keys, in that order; unknown keys are skipped. */
export function toSidebarNavRows(
  ids: readonly string[],
  view: WorkbenchMainView,
  selectedSessionId: string | null,
  t: (key: MessageKey) => string,
): SidebarNavRow[] {
  const rows: SidebarNavRow[] = [];
  for (const id of ids) {
    const item = findSidebarNavItem(id);
    if (!item) continue;
    rows.push({
      id: item.id,
      label: t(item.labelKey),
      icon: item.icon,
      active: isSidebarNavItemActive(item, view, selectedSessionId),
      locked: item.id === SIDEBAR_PINNED_ANCHOR,
    });
  }
  return rows;
}

/**
 * Shared by the inline rows and the "More" trigger, so the two cannot drift.
 * A collapsed sidebar shows icons only and leans on the tooltip for the name.
 */
export function sidebarNavButtonClassName(active: boolean, collapsed: boolean): string {
  return `flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${collapsed ? "justify-center" : ""} ${
    active
      ? "bg-[#e3e3df] text-foreground dark:bg-[#2a2c22]"
      : "text-[#4c4c47] hover:bg-[#e7e7e3] dark:text-muted-foreground dark:hover:bg-[#282a21] dark:hover:text-foreground"
  }`;
}

/**
 * What the "More" trigger shows: the hidden entry itself while one of them is
 * the current view, so the sidebar still says where the user is.
 */
export function activeSidebarNavRow(rows: readonly SidebarNavRow[]): SidebarNavRow | undefined {
  return rows.find((row) => row.active);
}
