/**
 * Tab bookkeeping for the browser panel.
 *
 * Kept separate from the service and free of Electron imports so the rules that
 * are easy to get subtly wrong — which tab takes focus after a close, what a tab
 * is called before its title arrives — are testable on their own.
 */

export type TabIdentity = {
  id: string;
  url: string;
  title: string;
};

/**
 * Which tab should be active after `closedId` is removed.
 *
 * Mirrors browser behaviour: a non-active tab closing changes nothing, and the
 * active tab closing hands focus to its right-hand neighbour, falling back to
 * the left one at the end of the strip so closing the last tab does not jump the
 * user back to the first.
 */
export function nextActiveTabId(
  tabIds: readonly string[],
  closedId: string,
  activeId: string | null,
): string | null {
  if (activeId !== closedId) return activeId !== null && tabIds.includes(activeId) ? activeId : tabIds[0] ?? null;
  const index = tabIds.indexOf(closedId);
  if (index === -1) return activeId;
  const remaining = tabIds.filter((id) => id !== closedId);
  if (remaining.length === 0) return null;
  // `index` in the original list is the position of the right-hand neighbour.
  return remaining[Math.min(index, remaining.length - 1)] ?? null;
}

/**
 * Label for a tab chip. An untitled page shows its host so a row of blank tabs
 * stays distinguishable, and a page that never loaded still shows something the
 * user recognises.
 */
export function displayTabTitle(tab: TabIdentity): string {
  const trimmed = tab.title.trim();
  if (trimmed) return trimmed;
  const fromUrl = hostFromUrl(tab.url);
  return fromUrl ?? "New tab";
}

/** Short host label for the address bar and tab strip. */
export function hostFromUrl(url: string): string | null {
  if (!url || url === "about:blank") return null;
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

/**
 * True when a link target should open as another tab in the panel rather than
 * being handed to the OS or dropped.
 *
 * Only the schemes the panel can actually render qualify; `mailto:` and friends
 * belong to the system handler.
 */
export function shouldOpenInPanel(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Keeps the strip navigable: beyond this many tabs the oldest inactive ones are
 * closed, because every tab is a live renderer process.
 */
export const MAX_BROWSER_TABS = 8;

/**
 * Chooses which tab to evict when the strip is full. Never evicts the active tab.
 */
export function tabToEvict(tabIds: readonly string[], activeId: string | null): string | null {
  if (tabIds.length < MAX_BROWSER_TABS) return null;
  const candidate = tabIds.find((id) => id !== activeId);
  return candidate ?? null;
}
