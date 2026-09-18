import type { SessionTreeEntry } from "@wordless/agent";

/**
 * Retry versions of a turn live in the session journal tree as sibling subtrees
 * of the turn's user message entry. The active version is the one the session
 * leaf points into; earlier versions stay on disk as inactive branches.
 */
export type SessionTurnVersions = {
  /** 1-based index of the version the session leaf currently points into. */
  active: number;
  /** Journal entry ids that end each version, in creation order. */
  tips: string[];
  total: number;
};

/**
 * Entry types that never carry conversation content. `leaf` markers are written
 * by `Session.moveTo` and must not be mistaken for version children.
 */
const NON_CONTENT_ENTRY_TYPES = new Set(["leaf", "label", "session_info"]);

type ContentEntry = SessionTreeEntry & { parentId: string | null };

function isContentEntry(entry: SessionTreeEntry): entry is ContentEntry {
  return !NON_CONTENT_ENTRY_TYPES.has(entry.type);
}

function messageRole(entry: SessionTreeEntry): string | undefined {
  const role = (entry.message as { role?: unknown } | undefined)?.role;
  return typeof role === "string" ? role : undefined;
}

function isUserTurn(entry: SessionTreeEntry): boolean {
  return entry.type === "message" && messageRole(entry) === "user";
}

/**
 * Reports, for every user turn that has sibling response subtrees, how many
 * assistant response versions exist and which one is active.
 *
 * `entries` must be in journal (append) order, which the JSONL storage already
 * guarantees.
 */
export function projectSessionTurnVersions(
  entries: readonly SessionTreeEntry[],
  activeLeafId: string | null,
): Map<string, SessionTurnVersions> {
  const byId = new Map<string, SessionTreeEntry>();
  const childrenByParent = new Map<string, SessionTreeEntry[]>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    if (typeof entry.parentId !== "string") continue;
    const siblings = childrenByParent.get(entry.parentId);
    if (siblings) siblings.push(entry);
    else childrenByParent.set(entry.parentId, [entry]);
  }

  const activePathIds = new Set<string>();
  for (
    let entry = typeof activeLeafId === "string" ? byId.get(activeLeafId) : undefined;
    entry !== undefined;
    entry = typeof entry.parentId === "string" ? byId.get(entry.parentId) : undefined
  ) {
    activePathIds.add(entry.id);
  }

  /**
   * Last content entry of a version chain. Descending stops at the next user
   * message, which is the same turn boundary the transcript uses: anything
   * below it belongs to a later turn, not to this response version.
   */
  function versionTip(head: SessionTreeEntry): string | undefined {
    let tip: string | undefined;
    let cursor: SessionTreeEntry | undefined = head;
    while (cursor !== undefined) {
      if (isUserTurn(cursor)) break;
      tip = cursor.id;
      cursor = childrenByParent
        .get(cursor.id)
        ?.filter((child) => isContentEntry(child) && !isUserTurn(child))
        .at(-1);
    }
    return tip;
  }

  const versions = new Map<string, SessionTurnVersions>();
  for (const entry of entries) {
    if (!isUserTurn(entry)) continue;
    const children = (childrenByParent.get(entry.id) ?? []).filter(
      isContentEntry,
    );
    if (children.length < 2) continue;
    const tips: string[] = [];
    let activeIndex = -1;
    for (const child of children) {
      const tip = versionTip(child);
      if (tip === undefined) continue;
      tips.push(tip);
      if (activePathIds.has(child.id) || activePathIds.has(tip)) {
        activeIndex = tips.length - 1;
      }
    }
    if (tips.length < 2) continue;
    versions.set(entry.id, {
      active: activeIndex === -1 ? tips.length : activeIndex + 1,
      tips,
      total: tips.length,
    });
  }
  return versions;
}
