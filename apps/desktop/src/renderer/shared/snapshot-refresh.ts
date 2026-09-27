import type { RuntimeEvent } from "@wordless/protocol";

/**
 * Which runtime events invalidate the app snapshot.
 *
 * Most events are session-scoped, and the views that care about them subscribe
 * directly — the thread view draws its own turns, the runs list listens to its own
 * changes. These are the ones that can change what the *snapshot* holds, and the
 * snapshot is the only thing the sidebar reads its session list from.
 *
 * This list used to omit anything about sessions, on the assumption that the
 * renderer refreshes after its own mutations (which it does). The gap was a session
 * created by the *host*: an automation or a task creates one in the main process, so
 * nothing in the renderer had a reason to re-read, and the conversation stayed
 * invisible in the sidebar until some unrelated event happened to refresh.
 *
 * Kept as a named set rather than a chain of `||` so the reason for each entry has
 * somewhere to live, and so the rule is testable without rendering anything.
 */
const SNAPSHOT_EVENTS: ReadonlySet<RuntimeEvent["type"]> = new Set<RuntimeEvent["type"]>([
  "preferences.changed",
  "skills.changed",
  "experts.changed",
  "connectors.changed",
  "model-configuration.changed",
  "media.project.changed",
  "sessions.changed",
]);

export function shouldRefreshSnapshot(eventType: RuntimeEvent["type"]): boolean {
  return SNAPSHOT_EVENTS.has(eventType);
}

/** Exposed for the test, so the rule and the expectations cannot drift apart. */
export const SNAPSHOT_REFRESH_EVENTS: readonly RuntimeEvent["type"][] = [...SNAPSHOT_EVENTS].sort();
