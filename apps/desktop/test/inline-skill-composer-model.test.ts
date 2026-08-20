import assert from "node:assert/strict";
import test from "node:test";
import {
  composerTaskPromptParts,
  countSkillTokenOccurrences,
  filterComposerInsertableTasks,
  mentionQueryAtEnd,
  normalizeUserPromptParts,
  stripTrailingMentionStart,
  uniqueSkillIdsInDocumentOrder,
} from "../src/renderer/features/thread/inline-skill-composer-model.ts";

test("deduplicates repeated skill tokens in first-appearance order", () => {
  assert.deepEqual(uniqueSkillIdsInDocumentOrder(["skill-a", "skill-b", "skill-a", "skill-c", "skill-b"]), ["skill-a", "skill-b", "skill-c"]);
});

test("counts each visual skill token independently", () => {
  assert.deepEqual(countSkillTokenOccurrences(["skill-a", "skill-b", "skill-a"]), { "skill-a": 2, "skill-b": 1 });
});

test("preserves duplicate skill references while joining adjacent text segments", () => {
  assert.deepEqual(normalizeUserPromptParts([
    { type: "text", text: "Use " },
    { type: "text", text: "these " },
    { type: "skill-reference", skillId: "skill-a", name: "A", source: "wordless" },
    { type: "text", text: " then " },
    { type: "skill-reference", skillId: "skill-a", name: "A", source: "wordless" },
    { type: "text", text: " finish" },
  ]), [
    { type: "text", text: "Use these " },
    { type: "skill-reference", skillId: "skill-a", name: "A", source: "wordless" },
    { type: "text", text: " then " },
    { type: "skill-reference", skillId: "skill-a", name: "A", source: "wordless" },
    { type: "text", text: " finish" },
  ]);
});

test("keeps workspace references as structured parts between text", () => {
  assert.deepEqual(normalizeUserPromptParts([
    { type: "text", text: "Review " },
    { type: "workspace-reference", path: "src/app.ts", name: "app.ts", kind: "file" },
    { type: "text", text: " carefully" },
  ]), [
    { type: "text", text: "Review " },
    { type: "workspace-reference", path: "src/app.ts", name: "app.ts", kind: "file" },
    { type: "text", text: " carefully" },
  ]);
});

test("detects !, fullwidth ！, $ and @ mentions only at the end of a token", () => {
  assert.equal(mentionQueryAtEnd("!", "task"), "");
  assert.equal(mentionQueryAtEnd("draft !report", "task"), "report");
  assert.equal(mentionQueryAtEnd("draft ！报告", "task"), "报告");
  assert.equal(mentionQueryAtEnd("hello!", "task"), null);
  assert.equal(mentionQueryAtEnd("$notes", "skill"), "notes");
  assert.equal(mentionQueryAtEnd("@src", "workspace"), "src");
  assert.equal(mentionQueryAtEnd("!", "skill"), null);
  assert.equal(mentionQueryAtEnd("$notes", "task"), null);
});

test("strips the task mention trigger while keeping the preceding space", () => {
  assert.equal(stripTrailingMentionStart("hello !ops", "task"), 6);
  assert.equal(stripTrailingMentionStart("!ops", "task"), 0);
  assert.equal(stripTrailingMentionStart("hello $ops", "skill"), 6);
  assert.equal(stripTrailingMentionStart("hello @file", "workspace"), 6);
  assert.equal(stripTrailingMentionStart("hello", "task"), null);
});

test("lists only todo and in-progress tasks and filters by title", () => {
  const tasks = [
    { status: "done", title: "Ship notes", updatedAt: 3 },
    { status: "review", title: "Review notes", updatedAt: 4 },
    { status: "todo", title: "Write notes", updatedAt: 1 },
    { status: "in-progress", title: "Draft notes", updatedAt: 2 },
    { status: "todo", title: "Clean invoices", updatedAt: 5 },
  ];
  assert.deepEqual(
    filterComposerInsertableTasks(tasks, "").map((task) => task.title),
    ["Draft notes", "Clean invoices", "Write notes"],
  );
  assert.deepEqual(
    filterComposerInsertableTasks(tasks, "notes").map((task) => task.title),
    ["Draft notes", "Write notes"],
  );
  assert.deepEqual(filterComposerInsertableTasks(tasks, "missing"), []);
});

test("expands a task into title, detail parts, and expected result", () => {
  assert.deepEqual(
    composerTaskPromptParts(
      {
        title: "Write notes",
        detailParts: [
          { type: "text", text: "Summarize " },
          {
            type: "skill-reference",
            skillId: "skill-a",
            name: "A",
            source: "wordless",
          },
        ],
        expectedResult: "A one-page outline",
      },
      {
        title: "Task title",
        details: "Task details",
        expectedResult: "Expected result",
      },
    ),
    [
      { type: "text", text: "Task title: Write notes. Task details: Summarize " },
      {
        type: "skill-reference",
        skillId: "skill-a",
        name: "A",
        source: "wordless",
      },
      { type: "text", text: ". Expected result: A one-page outline." },
    ],
  );
});

test("flattens task detail line breaks into one sentence", () => {
  assert.deepEqual(
    composerTaskPromptParts(
      {
        title: "Write notes",
        detailParts: [{ type: "text", text: "Summarize the\nweekly report" }],
      },
      {
        title: "Task title",
        details: "Task details",
        expectedResult: "Expected result",
      },
    ),
    [
      {
        type: "text",
        text: "Task title: Write notes. Task details: Summarize the weekly report.",
      },
    ],
  );
});
