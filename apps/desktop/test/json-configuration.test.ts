import assert from "node:assert/strict";
import test from "node:test";
import { jsonSyntaxIssue } from "../src/renderer/features/settings/json-configuration.ts";

test("treats empty and valid JSON configuration as syntax-safe", () => {
  assert.equal(jsonSyntaxIssue(""), null);
  assert.equal(jsonSyntaxIssue('{"baseUrl":"https://api.example.com/v1"}'), null);
});

test("reports the line and column of malformed JSON configuration", () => {
  const issue = jsonSyntaxIssue('{"name":"Studio",\n  "models": [}');
  assert.ok(issue);
  assert.equal(issue.line, 2);
  assert.equal(issue.column, 15);
  assert.match(issue.message, /Unexpected token|Expected/);
});
