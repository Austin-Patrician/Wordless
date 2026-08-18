import assert from "node:assert/strict";
import test from "node:test";
import { supportsGeneralWorkAccessSelection } from "../src/renderer/features/thread/access-control.ts";

test("General Work exposes per-session access selection", () => {
  assert.equal(supportsGeneralWorkAccessSelection("general-work"), true);
  assert.equal(supportsGeneralWorkAccessSelection("presentation"), false);
  assert.equal(supportsGeneralWorkAccessSelection(undefined), false);
});
