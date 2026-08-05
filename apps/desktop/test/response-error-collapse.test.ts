import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSE_ERROR_COLLAPSED_HEIGHT, shouldCollapseResponseError } from "../src/renderer/features/thread/response-error-collapse.ts";

test("collapses model response errors only after three rendered lines", () => {
  assert.equal(RESPONSE_ERROR_COLLAPSED_HEIGHT, 60);
  assert.equal(shouldCollapseResponseError(60), false);
  assert.equal(shouldCollapseResponseError(61), false);
  assert.equal(shouldCollapseResponseError(62), true);
});
