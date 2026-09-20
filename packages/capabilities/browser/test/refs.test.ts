import { expect, it } from "vitest";
import { findRef, healRef } from "../src/refs.ts";
import type { SnapshotRef } from "../src/snapshot.ts";

function ref(value: string, role: string, name: string, ordinal: number, node: number | null = null): SnapshotRef {
  return { ref: value, role, name, ordinal, backendDOMNodeId: node };
}

const CURRENT: SnapshotRef[] = [
  ref("@e1", "textbox", "Email", 1, 11),
  ref("@e2", "textbox", "Password", 1, 12),
  ref("@e3", "button", "Submit", 1, 13),
  ref("@e4", "button", "Submit", 2, 14),
];

it("finds a handle that is still valid", () => {
  expect(findRef(CURRENT, "@e2")?.name).toBe("Password");
  expect(findRef(CURRENT, "@e9")).toBeNull();
});

it("recovers a stale handle onto the same element by role, name and ordinal", () => {
  // The page re-rendered, so handles were renumbered, but the element the agent
  // meant is still identifiable.
  const healed = healRef(CURRENT, { role: "button", name: "Submit", ordinal: 2 }, "@e2");
  expect(healed).toEqual({ kind: "healed", ref: CURRENT[3], previousRef: "@e2" });
});

it("reports a match on the same handle as exact, not healed", () => {
  expect(healRef(CURRENT, { role: "button", name: "Submit", ordinal: 1 }, "@e3")).toEqual({
    kind: "exact",
    ref: CURRENT[2],
  });
});

it("recovers a unique element when no ordinal is supplied", () => {
  expect(healRef(CURRENT, { role: "textbox", name: "Email" })).toEqual({ kind: "exact", ref: CURRENT[0] });
});

it("refuses to guess between duplicates", () => {
  // Clicking the wrong one of two "Submit" buttons is worse than failing: the
  // agent would believe it pressed what it chose.
  const healed = healRef(CURRENT, { role: "button", name: "Submit" });
  expect(healed.kind).toBe("ambiguous");
  if (healed.kind !== "ambiguous") throw new Error("unreachable");
  expect(healed.candidates).toHaveLength(2);
});

it("reports a missing element separately from an ambiguous one", () => {
  expect(healRef(CURRENT, { role: "button", name: "Delete" })).toEqual({ kind: "missing" });
});

it("treats a vanished ordinal as missing rather than falling back to the only sibling", () => {
  // The second Submit is gone; acting on the first would be a different action.
  const single = [ref("@e1", "button", "Submit", 1, 13)];
  expect(healRef(single, { role: "button", name: "Submit", ordinal: 2 })).toEqual({ kind: "missing" });
});

it("carries no match for an empty snapshot", () => {
  expect(healRef([], { role: "button", name: "Submit" })).toEqual({ kind: "missing" });
});
