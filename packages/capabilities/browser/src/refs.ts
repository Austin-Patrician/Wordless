import type { SnapshotRef } from "./snapshot.js";

/**
 * Reference recovery for page actions.
 *
 * A `@eN` handle only means something for the snapshot that produced it: the page
 * may re-render, and the next snapshot renumbers from `@e1`. An action that simply
 * fails on an unknown handle would put the agent in a loop of click-fail-resnapshot,
 * burning context on a page that is otherwise fine.
 *
 * So a stale handle is re-resolved against the current snapshot by what the handle
 * actually described — role, accessible name, and rank among duplicates. The same
 * ordinal the snapshot text prints as "(2nd)" is what makes that recovery exact
 * rather than a guess.
 */

export type RefHint = {
  role: string;
  name: string;
  ordinal?: number;
};

export type RefHealing =
  | { kind: "exact"; ref: SnapshotRef }
  /** Recovered onto a different handle; the caller should say so, not pretend. */
  | { kind: "healed"; ref: SnapshotRef; previousRef: string }
  | { kind: "ambiguous"; candidates: SnapshotRef[] }
  | { kind: "missing" };

export function findRef(entries: readonly SnapshotRef[], ref: string): SnapshotRef | null {
  return entries.find((entry) => entry.ref === ref) ?? null;
}

/**
 * Re-resolves a handle against a newer snapshot.
 *
 * `previousRef` is only used to distinguish "same handle, still valid" from
 * "recovered onto a new handle", because the agent's next read has to reflect
 * which one it is.
 */
export function healRef(entries: readonly SnapshotRef[], hint: RefHint, previousRef?: string): RefHealing {
  const candidates = entries.filter((entry) => entry.role === hint.role && entry.name === hint.name);
  if (candidates.length === 0) return { kind: "missing" };
  if (hint.ordinal !== undefined) {
    const byOrdinal = candidates.find((entry) => entry.ordinal === hint.ordinal);
    // A supplied ordinal is honoured strictly. Falling back to a lone remaining
    // sibling would act on a different element than the agent chose, which is
    // worse than reporting the target as gone: the agent would believe it pressed
    // what it asked for.
    return byOrdinal ? classify(byOrdinal, previousRef) : { kind: "missing" };
  }
  if (candidates.length === 1) return classify(candidates[0]!, previousRef);
  // Several nodes share the role and name and the hint cannot separate them:
  // guessing here would click something the agent did not choose.
  return { kind: "ambiguous", candidates };
}

function classify(ref: SnapshotRef, previousRef?: string): RefHealing {
  if (previousRef === undefined || ref.ref === previousRef) return { kind: "exact", ref };
  return { kind: "healed", ref, previousRef };
}

/** One-line labels for the candidate list in an ambiguity error. */
export function describeRefs(entries: readonly SnapshotRef[], limit = 12): string[] {
  return entries.slice(0, Math.max(1, limit)).map((entry) => `[${entry.ref}] ${entry.role} "${entry.name}"`);
}
