import assert from "node:assert/strict";
import test from "node:test";
import {
  displayTabTitle,
  hostFromUrl,
  MAX_BROWSER_TABS,
  nextActiveTabId,
  shouldOpenInPanel,
  tabToEvict,
} from "../src/main/browser/browser-tabs.ts";

test("closing an inactive tab leaves focus where it was", () => {
  assert.equal(nextActiveTabId(["a", "b", "c"], "c", "a"), "a");
});

test("closing the active tab hands focus to its right-hand neighbour", () => {
  assert.equal(nextActiveTabId(["a", "b", "c"], "b", "b"), "c");
});

test("closing the last tab falls back to the left, not the first", () => {
  // Jumping back to the first tab after closing the last one loses the user's
  // place in a long strip.
  assert.equal(nextActiveTabId(["a", "b", "c"], "c", "c"), "b");
});

test("closing the only tab leaves nothing active", () => {
  assert.equal(nextActiveTabId(["a"], "a", "a"), null);
});

test("recovers focus when the active tab is no longer in the strip", () => {
  // Happens when a tab is force-closed (renderer gone, eviction) without going
  // through the normal close path.
  assert.equal(nextActiveTabId(["a", "b"], "missing", "gone"), "a");
});

test("closing an id that was never listed is a no-op", () => {
  assert.equal(nextActiveTabId(["a", "b"], "zzz", "b"), "b");
});

test("labels an untitled tab with its host so a strip of blanks stays readable", () => {
  assert.equal(displayTabTitle({ id: "1", url: "http://localhost:3000/todos", title: "" }), "localhost:3000");
  assert.equal(displayTabTitle({ id: "1", url: "https://example.com/a/b", title: "   " }), "example.com");
});

test("prefers a real page title over the host", () => {
  assert.equal(displayTabTitle({ id: "1", url: "https://example.com", title: "Example Domain" }), "Example Domain");
});

test("falls back to a placeholder before the first navigation", () => {
  assert.equal(displayTabTitle({ id: "1", url: "", title: "" }), "New tab");
  assert.equal(displayTabTitle({ id: "1", url: "about:blank", title: "" }), "New tab");
});

test("only renders http and https links in the panel", () => {
  assert.equal(shouldOpenInPanel("https://example.com"), true);
  assert.equal(shouldOpenInPanel("http://localhost:3000"), true);
  // Handing these to the panel would render nothing; they belong to the OS.
  assert.equal(shouldOpenInPanel("mailto:someone@example.com"), false);
  assert.equal(shouldOpenInPanel("file:///etc/passwd"), false);
  assert.equal(shouldOpenInPanel("javascript:alert(1)"), false);
  assert.equal(shouldOpenInPanel("not a url"), false);
});

test("returns no host for blank pages", () => {
  assert.equal(hostFromUrl(""), null);
  assert.equal(hostFromUrl("about:blank"), null);
  assert.equal(hostFromUrl("garbage"), null);
  assert.equal(hostFromUrl("http://localhost:3000/x"), "localhost:3000");
});

test("never evicts the active tab when the strip is full", () => {
  const ids = Array.from({ length: MAX_BROWSER_TABS }, (_, index) => `t${index}`);
  assert.equal(tabToEvict(ids, "t3"), "t0");
});

test("does not evict while there is room", () => {
  assert.equal(tabToEvict(["a", "b"], "a"), null);
});
