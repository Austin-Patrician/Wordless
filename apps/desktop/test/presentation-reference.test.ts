import assert from "node:assert/strict";
import test from "node:test";
import { formatPromptWithSkillReferences, projectUserMessageContent } from "@wordless/agent-driver-sdk";

test("preserves a selected presentation element as structured user-message content", () => {
  const prompt = formatPromptWithSkillReferences([
    { type: "text", text: "Refine " },
    {
      type: "artifact-reference",
      artifactId: "a601a30f-0a86-4161-a01a-311951217b13",
      kind: "presentation",
      name: "Selected element · /slide[2]/shape[4]",
      revision: 3,
      surfaceId: "slide-2",
      locator: "/slide[2]/shape[4]",
    },
    { type: "text", text: " for the executive audience." },
  ]);

  assert.deepEqual(projectUserMessageContent(prompt), [
    { type: "text", text: "Refine " },
    {
      type: "artifact",
      artifactId: "a601a30f-0a86-4161-a01a-311951217b13",
      kind: "presentation",
      name: "Selected element · /slide[2]/shape[4]",
      revision: 3,
      surfaceId: "slide-2",
      locator: "/slide[2]/shape[4]",
    },
    { type: "text", text: " for the executive audience." },
  ]);
});

test("hides internal Wordless presentation instructions from projected user messages", () => {
  const prompt = `Create a quarterly review.\n\n<wordless-presentation mode="guided" template="auto">
Use the Presentation workflow and wait for confirmation.
</wordless-presentation>`;

  assert.deepEqual(projectUserMessageContent(prompt), [
    { type: "text", text: "Create a quarterly review." },
  ]);
});
