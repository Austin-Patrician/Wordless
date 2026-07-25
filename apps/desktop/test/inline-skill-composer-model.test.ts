import assert from "node:assert/strict";
import test from "node:test";
import { countSkillTokenOccurrences, normalizeUserPromptParts, uniqueSkillIdsInDocumentOrder } from "../src/renderer/features/thread/inline-skill-composer-model.ts";

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
