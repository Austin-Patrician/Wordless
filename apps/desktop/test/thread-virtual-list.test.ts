import assert from "node:assert/strict";
import test from "node:test";
import { dataIndexFromReportedIndex } from "../src/renderer/features/thread/thread-virtual-list.ts";

test("converts a Virtuoso reported index back to the data index", () => {
  assert.equal(dataIndexFromReportedIndex(99_978, 99_976), 2);
});
