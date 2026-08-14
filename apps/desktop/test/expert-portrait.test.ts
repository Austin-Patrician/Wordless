import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import { SaveExpertSchema } from "@wordless/protocol";
import {
  DEFAULT_AVATAAARS_OPTIONS,
  avataaarsDataUri,
} from "../src/renderer/features/experts/avataaars-portrait.ts";

const input = {
  name: "Editor",
  description: "Edits content",
  systemPrompt: "Edit clearly.",
  portrait: {
    kind: "avataaars",
    schemaVersion: 1,
    options: DEFAULT_AVATAAARS_OPTIONS,
  },
};

test("expert portrait schema accepts a complete Avataaars portrait", () => {
  assert.equal(Value.Check(SaveExpertSchema, { input }), true);
  assert.equal(
    Value.Check(SaveExpertSchema, {
      input: {
        ...input,
        portrait: {
          ...input.portrait,
          options: { ...input.portrait.options, top: "unknownHair" },
        },
      },
    }),
    false,
  );
  assert.equal(
    Value.Check(SaveExpertSchema, {
      input: {
        ...input,
        portrait: {
          ...input.portrait,
          options: { ...input.portrait.options, skinColor: "#not-a-color" },
        },
      },
    }),
    false,
  );
});

test("Avataaars portrait generation is deterministic", () => {
  const first = avataaarsDataUri(DEFAULT_AVATAAARS_OPTIONS);
  const second = avataaarsDataUri({ ...DEFAULT_AVATAAARS_OPTIONS });
  assert.equal(first, second);
  assert.match(first, /^data:image\/svg\+xml/);
});
