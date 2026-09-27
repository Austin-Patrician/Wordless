import assert from "node:assert/strict";
import test from "node:test";
import { SNAPSHOT_REFRESH_EVENTS, shouldRefreshSnapshot } from "../src/renderer/shared/snapshot-refresh.ts";

/**
 * Which events make the renderer re-read the app snapshot.
 *
 * The sidebar reads its session list from that snapshot and nothing else, so an
 * event missing here is invisible in a way no manual test reliably catches: the
 * list is simply stale until something unrelated refreshes it. That is exactly how
 * an automation's conversation ended up in the runs list but not in the sidebar.
 */

test("a host-created session reaches the sidebar", () => {
  // The regression: sessions.changed was absent, so a session created in the main
  // process by an automation or a task never invalidated the snapshot.
  assert.equal(shouldRefreshSnapshot("sessions.changed"), true);
});

test("every collection the snapshot carries has an invalidation event", () => {
  const expected = [
    "connectors.changed",
    "experts.changed",
    "media.project.changed",
    "model-configuration.changed",
    "preferences.changed",
    "sessions.changed",
    "skills.changed",
  ];
  assert.deepEqual([...SNAPSHOT_REFRESH_EVENTS], expected);
});

test("session-scoped events do not refresh the snapshot", () => {
  // These fire constantly during a turn, and the views that need them subscribe
  // directly; refreshing on them would rebuild the whole snapshot per token.
  for (const type of [
    "run.started",
    "run.completed",
    "run.failed",
    "message.delta",
    "tool.updated",
    "context.usage.updated",
    "session.artifacts.changed",
    "automation-run.changed",
  ] as const) {
    assert.equal(shouldRefreshSnapshot(type), false, type);
  }
});
