import assert from "node:assert/strict";
import test from "node:test";
import { foregroundSessionId } from "../src/renderer/features/workbench/foreground-session.ts";

/**
 * The renderer's half of the notification suppression rule.
 *
 * Its value is entirely in the cases that return null: those are the moments a
 * focused window is showing something other than the completed run, and the host
 * must therefore still notify.
 */
const base = { mainView: "thread" as const, selectedSessionId: "s1", settingsOpen: false, tourActive: false };

test("a visible chat reports its session", () => {
  assert.equal(foregroundSessionId(base), "s1");
});

test("anything covering the chat reports nothing", () => {
  // The settings dialog is an overlay over the thread, so the thread is not visible.
  assert.equal(foregroundSessionId({ ...base, settingsOpen: true }), null);
  // The welcome screen and the tour sit on top of everything.
  assert.equal(foregroundSessionId({ ...base, tourActive: true }), null);
  assert.equal(foregroundSessionId({ ...base, settingsOpen: true, tourActive: true }), null);
});

test("another main view reports nothing", () => {
  for (const mainView of ["skills", "experts", "media", "automation", "tasks"] as const) {
    assert.equal(foregroundSessionId({ ...base, mainView }), null, mainView);
  }
});

test("no session selected reports nothing", () => {
  assert.equal(foregroundSessionId({ ...base, selectedSessionId: null }), null);
  // Even with no overlay: there is simply no chat on screen.
  assert.equal(foregroundSessionId({ ...base, selectedSessionId: null, settingsOpen: false }), null);
});
