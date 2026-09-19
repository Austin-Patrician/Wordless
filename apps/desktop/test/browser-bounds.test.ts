import assert from "node:assert/strict";
import test from "node:test";
import { isDegenerateBounds, normalizeBounds, resolveVisibility, sameBounds } from "../src/main/browser/browser-bounds.ts";

test("rounds fractional device pixels instead of truncating them", () => {
  // Truncating 100.9 to 100 leaves a hairline of the page visible along the
  // edge of the native view, which is why this rounds.
  assert.deepEqual(normalizeBounds({ x: 100.4, y: 20.6, width: 300.5, height: 200.5 }), {
    x: 100,
    y: 21,
    width: 301,
    height: 201,
  });
});

test("clamps negative and non-finite geometry to something setBounds accepts", () => {
  // React briefly reports garbage during mount and hidden-tab renders, and
  // setBounds throws on NaN.
  assert.deepEqual(normalizeBounds({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: -40, height: -1 }), {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
});

test("accepts negative coordinates for a view pushed off the top-left edge", () => {
  // The sidebar can scroll, so a valid placeholder may sit outside the window.
  // Note `Math.round` breaks ties toward +Infinity, so -12.5 becomes -12, not
  // -13. That is fine here: a one-pixel bias is invisible, while a fractional
  // bound is not.
  assert.deepEqual(normalizeBounds({ x: -12.5, y: -3.2, width: 320, height: 640 }), {
    x: -12,
    y: -3,
    width: 320,
    height: 640,
  });
});

test("treats sub-pixel jitter as unchanged so no-op bounds calls are dropped", () => {
  const first = normalizeBounds({ x: 10.2, y: 20.2, width: 300.2, height: 400.2 });
  const second = normalizeBounds({ x: 10.4, y: 20.1, width: 300.4, height: 400.3 });
  assert.equal(sameBounds(first, second), true);
});

test("reports a real resize as changed", () => {
  const first = normalizeBounds({ x: 0, y: 0, width: 300, height: 400 });
  const second = normalizeBounds({ x: 0, y: 0, width: 360, height: 400 });
  assert.equal(sameBounds(first, second), false);
});

test("flags zero-area rects so the view is detached rather than collapsed", () => {
  assert.equal(isDegenerateBounds({ x: 0, y: 0, width: 0, height: 400 }), true);
  assert.equal(isDegenerateBounds({ x: 0, y: 0, width: 300, height: 0 }), true);
  assert.equal(isDegenerateBounds({ x: 0, y: 0, width: 300, height: 400 }), false);
});

test("keeps the view off the window until the panel both asks for it and has area", () => {
  // Ordering matters on mount: the panel can ask before the first
  // ResizeObserver callback, and attaching without bounds flashes a 0x0 view.
  assert.equal(resolveVisibility({ requested: true, bounds: null }), "detach");
  assert.equal(resolveVisibility({ requested: false, bounds: { x: 0, y: 0, width: 320, height: 600 } }), "detach");
  assert.equal(resolveVisibility({ requested: true, bounds: { x: 0, y: 0, width: 320, height: 600 } }), "attach");
});

test("survives a collapsing panel passing through zero width", () => {
  // Regression: treating a degenerate rect as a permanent hide dropped the view
  // on one animation frame and never brought it back, because nothing re-issued
  // show() after the sidebar finished collapsing.
  const requested = true;
  assert.equal(resolveVisibility({ requested, bounds: { x: 0, y: 0, width: 320, height: 600 } }), "attach");
  assert.equal(resolveVisibility({ requested, bounds: { x: 0, y: 0, width: 0, height: 600 } }), "detach");
  assert.equal(resolveVisibility({ requested, bounds: { x: 0, y: 0, width: 120, height: 600 } }), "attach");
});

test("keeps the view hidden while occlusion holds, even with good geometry", () => {
  // The panel keeps reporting bounds while occluded; that must not re-show it.
  assert.equal(resolveVisibility({ requested: false, bounds: { x: 900, y: 60, width: 360, height: 700 } }), "detach");
});

test("steps aside when the page failed to load so the error panel is reachable", () => {
  // A native view composites above the DOM, so keeping it mounted on failure
  // would hide the message explaining the failure behind a blank surface.
  const bounds = { x: 900, y: 60, width: 360, height: 700 };
  assert.equal(resolveVisibility({ requested: true, bounds, loadFailed: true }), "detach");
  assert.equal(resolveVisibility({ requested: true, bounds, loadFailed: false }), "attach");
});

test("re-attaches once the failure clears, without needing new geometry", () => {
  // A retry does not resize the panel, so visibility has to recover from the
  // same bounds it detached with.
  const bounds = { x: 900, y: 60, width: 360, height: 700 };
  assert.equal(resolveVisibility({ requested: true, bounds, loadFailed: true }), "detach");
  assert.equal(resolveVisibility({ requested: true, bounds, loadFailed: false }), "attach");
});

test("a failed load cannot force the view up while occlusion still holds", () => {
  const bounds = { x: 900, y: 60, width: 360, height: 700 };
  assert.equal(resolveVisibility({ requested: false, bounds, loadFailed: false }), "detach");
});
