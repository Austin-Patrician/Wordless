import assert from "node:assert/strict";
import test from "node:test";
import { latestSessionUpdatedAt, sortWorkspaceGroupsByRecentSession } from "../src/renderer/features/workbench/sidebar-sessions.ts";

test("uses the newest session updatedAt in a workspace", () => {
  assert.equal(
    latestSessionUpdatedAt([{ updatedAt: 10 }, { updatedAt: 40 }, { updatedAt: 25 }]),
    40,
  );
  assert.equal(latestSessionUpdatedAt([]), 0);
});

test("orders workspace groups by the most recent session inside them", () => {
  const groups = sortWorkspaceGroupsByRecentSession([
    { id: "older-workspace", sessions: [{ updatedAt: 10 }, { updatedAt: 30 }] },
    { id: "empty-workspace", sessions: [] },
    { id: "newer-workspace", sessions: [{ updatedAt: 20 }, { updatedAt: 50 }] },
  ]);
  assert.deepEqual(
    groups.map((group) => group.id),
    ["newer-workspace", "older-workspace", "empty-workspace"],
  );
});
