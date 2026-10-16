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
 * 这条判据错了不会报错,只会让列表里悄悄多出几行、或少掉几行 —— 而少掉的那几行可能是用户
 * 刚建的对话。两类各有各的判据,不能混:
 *
 *   - `media-canvas` 按 `workbenchId`:它那个 entry 是 `internal` 的,用户没有从新建页建出它
 *     的路径,所以"按工作台隐藏"恰好成立;
 *   - **加工轮次按 `source` 标记,不能按 `workbenchId`**:`knowledge` 那张"知识库整理"卡就在
 *     新建页上,用户自己起的知识库会话用的是同一个工作台 —— 按 `workbenchId` 认会把他的对话
 *     一起藏掉(既不在列表里,又冒充一轮加工出现在知识库页)。见 `isKnowledgeRound`。
 */
test("加工轮次不进会话列表", () => {
  const sessions = [
    { id: "chat", workbenchId: "conversation" },
    { id: "canvas", workbenchId: "media-canvas" },
    { id: "round-1", workbenchId: "knowledge", source: "knowledge" },
    { id: "round-2", workbenchId: "knowledge", source: "knowledge" },
    { id: "code", workbenchId: "code" },
  ];
  assert.deepEqual(
    sidebarVisibleSessions(sessions).map((session) => session.id),
    ["chat", "code"],
  );
});

test("用户自己起的知识库会话**要**进列表 —— 它与加工轮次共用同一个工作台", () => {
  const sessions = [
    { id: "round", workbenchId: "knowledge", source: "knowledge" },
    { id: "mine", workbenchId: "knowledge", source: null },
  ];
  assert.deepEqual(
    sidebarVisibleSessions(sessions).map((session) => session.id),
    ["mine"],
  );
});

test("自动化任务起的知识库会话按自动化显示(标记是 automation,不是轮次)", () => {
  // 定时任务可以选 knowledge 入口("每天整理我的知识库")。它是用户自己排的任务,该看得见;
  // 判据是**精确值**比较,不是"有没有 source"。
  const sessions = [{ id: "scheduled", workbenchId: "knowledge", source: "automation" }];
  assert.deepEqual(
    sidebarVisibleSessions(sessions).map((session) => session.id),
    ["scheduled"],
  );
});
