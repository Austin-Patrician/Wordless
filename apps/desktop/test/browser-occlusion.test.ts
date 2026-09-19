import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksPlaceholder,
  isInvisibleStyle,
  OcclusionCoordinator,
  rectsIntersect,
  sampleOcclusion,
} from "../src/renderer/features/browser/occlusion.ts";

const rect = { left: 100, top: 50, width: 320, height: 600 };

test("reports occluded as soon as one sample is covered", () => {
  assert.equal(sampleOcclusion(rect, (x, y) => x === 100 + 320 * 0.5 && y === 50 + 600 * 0.5), true);
});

test("stays clear when every sample belongs to the placeholder", () => {
  assert.equal(sampleOcclusion(rect, () => false), false);
});

test("never samples outside the rect, so the panel's own toolbar is not an overlay", () => {
  const seen: Array<[number, number]> = [];
  sampleOcclusion(rect, (x, y) => {
    seen.push([x, y]);
    return false;
  });
  assert.ok(seen.length > 0);
  for (const [x, y] of seen) {
    assert.ok(x > rect.left && x < rect.left + rect.width, `x ${x} inside rect`);
    assert.ok(y > rect.top && y < rect.top + rect.height, `y ${y} inside rect`);
  }
});

test("treats a zero-area placeholder as clear rather than occluded", () => {
  // A collapsed panel has nothing to occlude, and reporting otherwise would
  // detach a view on every collapse animation frame.
  assert.equal(sampleOcclusion({ left: 0, top: 0, width: 0, height: 600 }, () => true), false);
  assert.equal(sampleOcclusion({ left: 0, top: 0, width: 320, height: 0 }, () => true), false);
});

test("acquiring occlusion is idempotent per token and releases exactly once", () => {
  const coordinator = new OcclusionCoordinator();
  const seen: boolean[] = [];
  coordinator.subscribe((occluded) => seen.push(occluded));

  const release = coordinator.acquire("dialog");
  assert.equal(coordinator.occluded, true);
  const releaseAgain = coordinator.acquire("toast");
  assert.equal(coordinator.occluded, true);

  release();
  // The second holder keeps it occluded, so no notification should fire.
  assert.equal(coordinator.occluded, true);
  releaseAgain();
  assert.equal(coordinator.occluded, false);

  // Releasing twice must not drive the count negative.
  release();
  assert.equal(coordinator.occluded, false);
  assert.deepEqual(seen, [true, false]);
});

test("overlapping overlays cannot release each other early", () => {
  const coordinator = new OcclusionCoordinator();
  const releaseDialog = coordinator.acquire("dialog");
  const releaseMenu = coordinator.acquire("menu");
  releaseDialog();
  assert.equal(coordinator.occluded, true, "menu is still open");
  assert.deepEqual(coordinator.reasons, ["menu"]);
  releaseMenu();
  assert.equal(coordinator.occluded, false);
});

test("unsubscribing stops notifications", () => {
  const coordinator = new OcclusionCoordinator();
  const seen: boolean[] = [];
  const unsubscribe = coordinator.subscribe((occluded) => seen.push(occluded));
  unsubscribe();
  const release = coordinator.acquire("dialog");
  release();
  assert.deepEqual(seen, []);
});

test("catches a narrow popover anchored to the top edge of a tall panel", () => {
  // Regression: the previous point set was centre plus four 20%/80% insets. On a
  // tall panel every one of those samples fell below a header-anchored dropdown,
  // so the page stayed painted on top of the menu the user was trying to click.
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  const popover = { left: 12, top: 0, width: 168, height: 130 };
  const covered = (x: number, y: number) =>
    x >= popover.left && x <= popover.left + popover.width &&
    y >= popover.top && y <= popover.top + popover.height;

  assert.equal(sampleOcclusion(placeholder, covered), true, "header popover is detected");

  // The old sample set, kept here to show what it missed.
  const oldPoints: Array<[number, number]> = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]];
  const oldHit = oldPoints.some(([fx, fy]) =>
    covered(placeholder.left + placeholder.width * fx, placeholder.top + placeholder.height * fy));
  assert.equal(oldHit, false, "the previous sampling missed it entirely");
});

test("treats overlapping rectangles as intersecting only when they truly overlap", () => {
  const a = { left: 0, top: 0, width: 100, height: 100 };
  assert.equal(rectsIntersect(a, { left: 50, top: 50, width: 100, height: 100 }), true);
  assert.equal(rectsIntersect(a, { left: 100, top: 0, width: 50, height: 50 }), false, "touching edges do not overlap");
  assert.equal(rectsIntersect(a, { left: 200, top: 0, width: 50, height: 50 }), false);
  assert.equal(rectsIntersect(a, { left: 0, top: 0, width: 0, height: 0 }), false, "zero-area never overlaps");
});

test("never treats an ancestor of the placeholder as an overlay", () => {
  // The app root is a body child that always intersects, so counting it would
  // detach the view permanently.
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  assert.equal(
    blocksPlaceholder(placeholder, {
      rect: { left: 0, top: 0, width: 1280, height: 800 },
      containsPlaceholder: true,
      pointerEventsNone: false,
      invisible: false,
    }),
    false,
  );
});

test("ignores overlays that cannot receive pointer input", () => {
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  assert.equal(
    blocksPlaceholder(placeholder, {
      rect: { left: 0, top: 0, width: 300, height: 800 },
      containsPlaceholder: false,
      pointerEventsNone: true,
      invisible: false,
    }),
    false,
  );
});

test("blocks on a non-ancestor portal that overlaps", () => {
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  assert.equal(
    blocksPlaceholder(placeholder, {
      rect: { left: 0, top: 0, width: 1280, height: 800 },
      containsPlaceholder: false,
      pointerEventsNone: false,
      invisible: false,
    }),
    true,
  );
});

test("ignores a closed popover wrapper that keeps its box", () => {
  // Radix leaves closed popover wrappers mounted with visibility:hidden, which
  // still reports a non-zero rect. Counting those would detach the view forever.
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  assert.equal(
    blocksPlaceholder(placeholder, {
      rect: { left: 0, top: 0, width: 300, height: 800 },
      containsPlaceholder: false,
      pointerEventsNone: false,
      invisible: false,
      invisible: true,
    }),
    false,
  );
});

test("recognises styles that paint nothing", () => {
  assert.equal(isInvisibleStyle({ visibility: "hidden", opacity: "1" }), true);
  assert.equal(isInvisibleStyle({ visibility: "collapse", opacity: "1" }), true);
  assert.equal(isInvisibleStyle({ visibility: "visible", opacity: "0" }), true);
  assert.equal(isInvisibleStyle({ visibility: "visible", opacity: "1" }), false);
  assert.equal(isInvisibleStyle({ visibility: "visible", opacity: "" }), false, "unparsable opacity is not invisible");
});

test("an invisible overlay does not block even with a real aura of overlap", () => {
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  assert.equal(
    blocksPlaceholder(placeholder, {
      rect: { left: 10, top: 10, width: 100, height: 100 },
      containsPlaceholder: false,
      pointerEventsNone: false,
      invisible: false,
      invisible: false,
    }),
    true,
  );
});

test("ignores the panel's own resize gutter along the left edge", () => {
  // Regression: the panel keeps a 12px resize handle hard against the left edge
  // for its full height. An earlier probe inset by a *fraction* of the width
  // drifted onto it as the panel narrowed, so every probe reported the page as
  // occluded and the native view was detached permanently — the page never
  // appeared even though it had loaded.
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  const gutter = { left: 0, top: 0, width: 12, height: 800 };
  const onGutter = (x: number) => x <= gutter.width;
  assert.equal(sampleOcclusion(placeholder, onGutter), false, "the gutter must not count as an overlay");
});

test("still catches a header popover while ignoring the gutter", () => {
  // Both at once, which is the real layout: a header-anchored dropdown beside the
  // resize gutter.
  const placeholder = { left: 0, top: 0, width: 300, height: 800 };
  const gutter = { left: 0, width: 12 };
  const popover = { left: 12, top: 0, width: 168, height: 130 };
  const covered = (x: number, y: number) =>
    x <= gutter.width ||
    (x >= popover.left && x <= popover.left + popover.width && y >= popover.top && y <= popover.top + popover.height);
  assert.equal(sampleOcclusion(placeholder, covered), true);
});

test("keeps sampling a very narrow panel instead of inverting the inset", () => {
  // The inset is capped at a quarter of the box so a squeezed panel still
  // produces points inside it.
  const placeholder = { left: 0, top: 0, width: 40, height: 40 };
  const seen: Array<[number, number]> = [];
  sampleOcclusion(placeholder, (x, y) => {
    seen.push([x, y]);
    return false;
  });
  assert.ok(seen.length > 0);
  for (const [x, y] of seen) {
    assert.ok(x >= 0 && x <= 40 && y >= 0 && y <= 40, `sample ${x},${y} inside a 40x40 box`);
  }
});
