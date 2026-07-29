import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRecord } from "@wordless/domain";
import { searchSidebarSessions } from "../src/renderer/features/workbench/session-search.ts";

function session(id: string, title: string, updatedAt: number, workbenchId: SessionRecord["workbenchId"] = "conversation"): SessionRecord {
  return {
    id,
    title,
    workspaceId: null,
    runtimeRootPath: `/sessions/${id}`,
    mode: "everyday",
    entryId: "general-work",
    profile: { id: "general", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId,
    accessLevel: "default",
    model: { connectionId: "test", modelId: "test" },
    journalPath: `/sessions/${id}.jsonl`,
    connectorIds: [],
    pinnedAt: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

test("shows the ten most recently updated sidebar sessions", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => session(`session-${index}`, `Task ${index}`, index));
  sessions.push(session("canvas", "Task canvas", 100, "media-canvas"));

  assert.deepEqual(searchSidebarSessions(sessions, "").map((item) => item.id), [
    "session-11", "session-10", "session-9", "session-8", "session-7", "session-6", "session-5", "session-4", "session-3", "session-2",
  ]);
});

test("matches only titles and ranks exact and prefix matches before contains matches", () => {
  const sessions = [
    session("contains", "Review project budget", 30),
    session("prefix-old", "Project architecture", 10),
    session("exact", "Project", 5),
    session("prefix-new", "PROJECT notes", 20),
    session("unmatched", "Architecture", 100),
  ];

  assert.deepEqual(searchSidebarSessions(sessions, " project ").map((item) => item.id), ["exact", "prefix-new", "prefix-old", "contains"]);
});
