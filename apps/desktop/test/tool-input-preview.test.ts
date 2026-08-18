import assert from "node:assert/strict";
import test from "node:test";
import {
  formatToolInput,
  safeToolInput,
  summarizeToolInput,
} from "../src/renderer/features/workbench/tool-input-preview.ts";

test("redacts sensitive tool parameters recursively", () => {
  assert.deepEqual(
    safeToolInput({
      path: "docs/report.md",
      headers: {
        authorization: "Bearer secret",
        accept: "application/json",
      },
      apiKey: "secret-key",
    }),
    {
      path: "docs/report.md",
      headers: {
        authorization: "[redacted]",
        accept: "application/json",
      },
      apiKey: "[redacted]",
    },
  );
});

test("bounds large and circular tool parameters", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const formatted = formatToolInput({
    circular,
    items: Array.from({ length: 24 }, (_, index) => index),
    payload: "x".repeat(2_100),
  });

  assert.match(formatted, /\[circular\]/);
  assert.match(formatted, /4 more items/);
  assert.match(formatted, /100 more characters/);
  assert.ok(formatted.length < 3_000);
});

test("summarizes the most useful scalar parameter", () => {
  assert.equal(
    summarizeToolInput({ limit: 20, query: "quarterly revenue" }),
    "query: quarterly revenue",
  );
  assert.equal(
    summarizeToolInput({ token: "secret", count: 3 }),
    "token: [redacted]",
  );
  assert.equal(summarizeToolInput({ filters: ["active"] }), undefined);
});
