import assert from "node:assert/strict";
import test from "node:test";
import {
  canPinSidebarNavItem,
  clampSidebarPinnedLimit,
  moveSidebarNavItem,
  normalizeSidebarPreferences,
  pinSidebarNavItem,
  resolveSidebarNavLayout,
  SIDEBAR_PINNED_ANCHOR,
  SIDEBAR_PINNED_LIMIT_DEFAULT,
  SIDEBAR_PINNED_LIMIT_MAX,
  SIDEBAR_PINNED_LIMIT_MIN,
  sidebarPinnedCapacity,
  toStoredSidebarNavLayout,
  unpinSidebarNavItem,
  type ResolvedSidebarNavLayout,
  type SidebarNavLayout,
} from "@wordless/domain";

/** The catalog the sidebar ships with, in the order it lists entries. */
const CATALOG = ["new", "media", "automation", "tasks", "experts", "skills"] as const;
/** The entries a first-time sidebar shows inline. */
const DEFAULT_PINNED = ["media", "skills", "experts"] as const;
const EMPTY: SidebarNavLayout = { pinned: [], more: [] };

function layout(pinned: readonly string[], more: readonly string[] = []): SidebarNavLayout {
  return { pinned, more };
}

function resolve(stored: SidebarNavLayout, pinnedLimit = SIDEBAR_PINNED_LIMIT_DEFAULT): ResolvedSidebarNavLayout {
  return resolveSidebarNavLayout(CATALOG, stored, pinnedLimit, DEFAULT_PINNED);
}

test("nothing arranged yet: the defaults show a few entries and the rest wait in More", () => {
  const resolved = resolve(EMPTY);

  assert.deepEqual(resolved.pinned, ["new", "media", "experts", "skills"]);
  assert.deepEqual(resolved.more, ["automation", "tasks"]);
  // Exactly one inline slot stays free, so "Show inline" works out of the box.
  assert.equal(sidebarPinnedCapacity(SIDEBAR_PINNED_LIMIT_DEFAULT) - (resolved.pinned.length - 1), 1);
});

test("the anchor is always the first inline row and never appears in More", () => {
  const arranged = resolve(layout(["automation", "media"], ["new", "skills"], undefined));

  assert.equal(arranged.pinned[0], SIDEBAR_PINNED_ANCHOR);
  assert.equal(arranged.pinned.filter((key) => key === SIDEBAR_PINNED_ANCHOR).length, 1);
  assert.equal(arranged.more.includes(SIDEBAR_PINNED_ANCHOR), false);
});

test("the anchor cannot be moved or hidden, from the pointer or from storage", () => {
  const resolved = resolve(EMPTY);

  assert.deepEqual(unpinSidebarNavItem(resolved, SIDEBAR_PINNED_ANCHOR), resolved);
  assert.deepEqual(moveSidebarNavItem(resolved, SIDEBAR_PINNED_ANCHOR, "more", null, 4), resolved);
  assert.equal(resolve(layout([SIDEBAR_PINNED_ANCHOR])).pinned[0], SIDEBAR_PINNED_ANCHOR);
});

test("a drop before the anchor lands after it", () => {
  const resolved = resolve(layout(["media", "experts", "skills"]));
  const moved = moveSidebarNavItem(resolved, "skills", "pinned", SIDEBAR_PINNED_ANCHOR, 4);

  assert.equal(moved.pinned[0], SIDEBAR_PINNED_ANCHOR);
  assert.deepEqual(moved.pinned, ["new", "skills", "media", "experts"]);
});

test("entries the catalog no longer offers leave the sidebar", () => {
  const resolved = resolve(layout(["media", "removed"], ["tasks", "gone"]));

  assert.equal(resolved.pinned.includes("removed"), false);
  assert.equal(resolved.more.includes("gone"), false);
  // Entries the arrangement knew keep their order; the one it never mentioned
  // is appended, because nothing about it is more important than a known row.
  assert.deepEqual(resolved.more, ["tasks", "automation"]);
});

test("an entry that lands in the catalog later waits in More instead of taking a row", () => {
  const stored = layout(["media", "experts", "skills"], ["automation", "tasks"]);
  const resolved = resolveSidebarNavLayout([...CATALOG, "brand-new"], stored, 4, DEFAULT_PINNED);

  assert.deepEqual(resolved.pinned, ["new", "media", "experts", "skills"]);
  assert.deepEqual(resolved.more, ["automation", "tasks", "brand-new"]);
});

test("arranging survives the stored form, which does not name the locked anchor", () => {
  const resolved = resolve(EMPTY);
  const stored = toStoredSidebarNavLayout(resolved);

  assert.deepEqual(stored.pinned, ["media", "experts", "skills"]);
  assert.deepEqual(resolve(stored).pinned, resolved.pinned);
  assert.deepEqual(resolve(stored).more, resolved.more);
});

test("lowering the limit moves the rows that no longer fit into More instead of dropping them", () => {
  const resolved = resolve(layout(["media", "experts", "skills"]), 3);

  assert.deepEqual(resolved.pinned, ["new", "media", "experts"]);
  assert.deepEqual(resolved.more, ["skills", "automation", "tasks"]);
  // Nothing vanished: every catalog entry is still reachable from one region.
  assert.equal(new Set([...resolved.pinned, ...resolved.more]).size, CATALOG.length);
});

test("raising the limit does not drag hidden entries back inline", () => {
  const resolved = resolve(layout(["media"], ["automation", "tasks", "experts", "skills"]), 6);

  assert.deepEqual(resolved.pinned, ["new", "media"]);
  assert.deepEqual(resolved.more, ["automation", "tasks", "experts", "skills"]);
});

test("pinning appends to the end of the inline list", () => {
  const pinned = pinSidebarNavItem(resolve(EMPTY), "automation", 5);

  assert.deepEqual(pinned.pinned, ["new", "media", "experts", "skills", "automation"]);
  assert.deepEqual(pinned.more, ["tasks"]);
});

test("a full inline list refuses the pin instead of evicting an entry the user chose", () => {
  const full = resolve(EMPTY, 4);

  assert.equal(canPinSidebarNavItem(full, 4), false);
  assert.deepEqual(pinSidebarNavItem(full, "automation", 4), full);
  assert.equal(canPinSidebarNavItem(resolve(EMPTY, 5), 5), true);
});

test("unpinning puts the entry back at the front of More, where it is visible", () => {
  const resolved = resolve(EMPTY);
  const unpinned = unpinSidebarNavItem(resolved, "skills");

  assert.deepEqual(unpinned.pinned, ["new", "media", "experts"]);
  assert.deepEqual(unpinned.more, ["skills", "automation", "tasks"]);
});

test("dragging across regions honours the limit as well", () => {
  const resolved = resolve(EMPTY, 4);

  assert.deepEqual(moveSidebarNavItem(resolved, "tasks", "pinned", null, 4), resolved);
  assert.deepEqual(moveSidebarNavItem(resolved, "tasks", "pinned", null, 5).pinned, ["new", "media", "experts", "skills", "tasks"]);
});

test("reordering inside a region keeps every other entry in place", () => {
  const resolved = resolve(EMPTY);
  const moved = moveSidebarNavItem(resolved, "skills", "pinned", "media", 4);

  assert.deepEqual(moved.pinned, ["new", "skills", "media", "experts"]);
  assert.deepEqual(moved.more, resolved.more);
});

test("dropping an entry back where it came from changes nothing", () => {
  const resolved = resolve(EMPTY);
  const rowAfter = resolved.pinned[2];

  assert.deepEqual(moveSidebarNavItem(resolved, "media", "pinned", rowAfter, 4), resolved);
});

test("the limit is clamped to the offered range and a broken value falls back", () => {
  assert.equal(clampSidebarPinnedLimit(SIDEBAR_PINNED_LIMIT_MIN - 1), SIDEBAR_PINNED_LIMIT_MIN);
  assert.equal(clampSidebarPinnedLimit(SIDEBAR_PINNED_LIMIT_MAX + 1), SIDEBAR_PINNED_LIMIT_MAX);
  assert.equal(clampSidebarPinnedLimit(4.4), 4);
  assert.equal(clampSidebarPinnedLimit(undefined), SIDEBAR_PINNED_LIMIT_DEFAULT);
  assert.equal(clampSidebarPinnedLimit(Number.NaN), SIDEBAR_PINNED_LIMIT_DEFAULT);
  assert.equal(clampSidebarPinnedLimit("4"), SIDEBAR_PINNED_LIMIT_DEFAULT);
});

test("reading repairs a malformed arrangement instead of trusting it", () => {
  for (const broken of [undefined, null, "x", 7, [], { layout: null }]) {
    assert.deepEqual(normalizeSidebarPreferences(broken), {
      layout: { pinned: [], more: [] },
      pinnedLimit: SIDEBAR_PINNED_LIMIT_DEFAULT,
    });
  }

  const repaired = normalizeSidebarPreferences({
    layout: { pinned: ["media", "media", SIDEBAR_PINNED_ANCHOR, 42, ""], more: ["tasks", "media"] },
    pinnedLimit: 99,
  });
  assert.deepEqual(repaired.layout.pinned, ["media"]);
  // A key in both regions is an inline row: that is the region the user sees.
  assert.deepEqual(repaired.layout.more, ["tasks"]);
  assert.equal(repaired.pinnedLimit, SIDEBAR_PINNED_LIMIT_MAX);
});

test("a table entry with no click handler is impossible, and labels come from one key each", async () => {
  const { SIDEBAR_NAV_ITEM_IDS, SIDEBAR_NAV_ITEMS, toSidebarNavClickHandlers } = await import(
    "../src/renderer/features/workbench/sidebar-nav.ts"
  );

  assert.deepEqual(SIDEBAR_NAV_ITEMS.map((item) => item.id), [...SIDEBAR_NAV_ITEM_IDS]);
  const labels = SIDEBAR_NAV_ITEMS.map((item) => item.labelKey);
  assert.equal(new Set(labels).size, labels.length, "two entries share a label key");

  const called: string[] = [];
  const handlers = toSidebarNavClickHandlers({
    newThread: () => called.push("newThread"),
    openMedia: () => called.push("openMedia"),
    openAutomation: () => called.push("openAutomation"),
    openTasks: () => called.push("openTasks"),
    openExperts: () => called.push("openExperts"),
    openSkills: () => called.push("openSkills"),
  });
  assert.deepEqual(Object.keys(handlers).sort(), [...SIDEBAR_NAV_ITEM_IDS].sort());
});

test("the guide keeps an anchor for every first-run step that points at the sidebar", () => {
  // The tour's sidebar selectors: a step loses its spotlight if none of the
  // entries it names is inline, so the default arrangement has to keep them.
  const tourAnchors: readonly string[] = ["new", "skills", "experts"];
  const resolved = resolve(EMPTY);

  for (const anchor of tourAnchors) assert.ok(resolved.pinned.includes(anchor), `${anchor} is not shown inline by default`);
});
