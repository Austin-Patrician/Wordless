import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTreeEntry } from "@wordless/agent";
import { projectSessionTurnVersions } from "../src/session-branches.ts";

function user(id: string, parentId: string | null): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    message: { role: "user" } as never,
  };
}

function assistant(id: string, parentId: string | null): SessionTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    message: { role: "assistant" } as never,
  };
}

function retryDirective(id: string, parentId: string): SessionTreeEntry {
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
  };
}

function leafMarker(id: string, parentId: string, targetId: string): SessionTreeEntry {
  return {
    type: "leaf",
    id,
    parentId,
    timestamp: new Date(0).toISOString(),
    targetId,
  };
}

test("reports sibling response versions of a retried turn", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    leafMarker("L1", "A1", "U"),
    retryDirective("D1", "U"),
    assistant("A2", "D1"),
  ];
  const versions = projectSessionTurnVersions(entries, "A2");
  assert.deepEqual(versions.get("U"), {
    active: 2,
    tips: ["A1", "A2"],
    total: 2,
  });
});

test("a version tip stops before the next user turn", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    retryDirective("D1", "U"),
    assistant("A2", "D1"),
    user("U2", "A2"),
    assistant("A3", "U2"),
  ];
  const versions = projectSessionTurnVersions(entries, "A3");
  assert.deepEqual(versions.get("U"), {
    active: 2,
    tips: ["A1", "A2"],
    total: 2,
  });
  // A single response is not a version set.
  assert.equal(versions.get("U2"), undefined);
});

test("tracks versions per turn and follows a rewound leaf", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    retryDirective("D1", "U"),
    assistant("A2", "D1"),
    user("U2", "A2"),
    assistant("A3", "U2"),
    leafMarker("L2", "A3", "U2"),
    assistant("A4", "U2"),
  ];
  const retried = projectSessionTurnVersions(entries, "A4");
  assert.deepEqual(retried.get("U2"), {
    active: 2,
    tips: ["A3", "A4"],
    total: 2,
  });

  const rewound = projectSessionTurnVersions(entries, "A1");
  assert.deepEqual(rewound.get("U"), {
    active: 1,
    tips: ["A1", "A2"],
    total: 2,
  });
  const rewoundToSecond = projectSessionTurnVersions(entries, "A2");
  assert.equal(rewoundToSecond.get("U")?.active, 2);
});

test("ignores leaf markers and turns without alternative versions", () => {
  const entries = [
    user("U", null),
    assistant("A1", "U"),
    leafMarker("L1", "A1", "U"),
    leafMarker("L2", "U", "A1"),
  ];
  assert.equal(projectSessionTurnVersions(entries, "A1").size, 0);
});
