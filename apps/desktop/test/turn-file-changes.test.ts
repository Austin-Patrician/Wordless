import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationMessage, MessageBlock } from "@wordless/domain";
import {
  turnFileChanges,
  visibleTurnFileChanges,
  VISIBLE_TURN_FILE_CHANGE_LIMIT,
} from "../src/renderer/features/thread/turn-file-changes.ts";

function assistant(blocks: MessageBlock[]): ConversationMessage {
  return {
    blocks,
    id: "assistant-1",
    model: null,
    role: "assistant",
    status: "complete",
    timestamp: 1,
  };
}

function write(
  path: string,
  kind: "created" | "modified",
  state: "complete" | "running" | "error" = "complete",
): MessageBlock {
  return {
    type: "tool",
    callId: `write:${path}:${kind}`,
    name: "write",
    state,
    details: { path, change: { kind } },
  };
}

function edit(path: string, state: "complete" | "running" | "error" = "complete"): MessageBlock {
  return {
    type: "tool",
    callId: `edit:${path}`,
    name: "edit",
    state,
    details: { path, change: { kind: "modified" } },
  };
}

test("returns an empty list when the turn has no write or edit tools", () => {
  assert.deepEqual(
    turnFileChanges([
      assistant([
        { type: "text", text: "Done" },
        { type: "tool", callId: "bash-1", name: "bash", state: "complete", details: { command: "rm gone.ts" } },
      ]),
    ]),
    [],
  );
});

test("aggregates successful write and edit paths and uses the file name", () => {
  assert.deepEqual(
    turnFileChanges([
      assistant([
        write("src/a.ts", "modified"),
        write("src\\b.ts", "created"),
      ]),
    ]),
    [
      { path: "src/a.ts", name: "a.ts", kind: "modified" },
      { path: "src\\b.ts", name: "b.ts", kind: "created" },
    ],
  );
});

test("keeps created when a path is created then edited", () => {
  assert.deepEqual(
    turnFileChanges([
      assistant([write("app.ts", "created"), edit("app.ts")]),
    ]),
    [{ path: "app.ts", name: "app.ts", kind: "created" }],
  );
});

test("deduplicates repeated edits to the same path", () => {
  assert.deepEqual(
    turnFileChanges([assistant([edit("app.ts"), edit("app.ts")])]),
    [{ path: "app.ts", name: "app.ts", kind: "modified" }],
  );
});

test("ignores running, failed, and pathless write results", () => {
  assert.deepEqual(
    turnFileChanges([
      assistant([
        write("ok.ts", "modified"),
        write("running.ts", "modified", "running"),
        write("failed.ts", "modified", "error"),
        {
          type: "tool",
          callId: "write-empty",
          name: "write",
          state: "complete",
          details: { change: { kind: "created" } },
        },
      ]),
    ]),
    [{ path: "ok.ts", name: "ok.ts", kind: "modified" }],
  );
});

test("does not treat bash rm as a file change", () => {
  assert.deepEqual(
    turnFileChanges([
      assistant([
        {
          type: "tool",
          callId: "rm-1",
          name: "bash",
          state: "complete",
          details: { command: "rm src/gone.ts", path: "src/gone.ts" },
        },
      ]),
    ]),
    [],
  );
});

test("caps visible chips and reports the hidden remainder", () => {
  const changes = Array.from({ length: VISIBLE_TURN_FILE_CHANGE_LIMIT + 3 }, (_, index) => ({
    path: `f${index}.ts`,
    name: `f${index}.ts`,
    kind: "modified" as const,
  }));
  const visible = visibleTurnFileChanges(changes);
  assert.equal(visible.visible.length, VISIBLE_TURN_FILE_CHANGE_LIMIT);
  assert.equal(visible.hiddenCount, 3);
  assert.deepEqual(visibleTurnFileChanges(changes.slice(0, 2)), {
    hiddenCount: 0,
    visible: changes.slice(0, 2),
  });
});
