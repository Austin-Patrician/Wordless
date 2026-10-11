import assert from "node:assert/strict";
import test from "node:test";
import { latestSessionUpdatedAt, sidebarVisibleSessions, sortWorkspaceGroupsByRecentSession } from "../src/renderer/features/workbench/sidebar-sessions.ts";

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

/**
 * 会话列表里显示哪些会话。
 *
 * 这条判据错了不会报错,只会让列表里悄悄多出几行 —— 而加工轮次是"一轮一个会话",
 * 定时一开就会把最近会话那 5 格占满(见 docs/architecture/knowledge-base.md §13)。
 */
test("不是对话的东西不进会话列表", () => {
  const sessions = [
    { id: "chat", workbenchId: "conversation" },
    { id: "canvas", workbenchId: "media-canvas" },
    { id: "round-1", workbenchId: "knowledge" },
    { id: "round-2", workbenchId: "knowledge" },
    { id: "code", workbenchId: "code" },
  ];
  assert.deepEqual(
    sidebarVisibleSessions(sessions).map((session) => session.id),
    ["chat", "code"],
  );
});
