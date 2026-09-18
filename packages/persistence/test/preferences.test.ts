import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AppPreferences } from "@wordless/domain";
import { WordlessDatabase } from "../src/index.ts";

function defaults(overrides: Partial<AppPreferences> = {}): AppPreferences {
  return {
    locale: "zh-CN",
    theme: "system",
    fontScale: 1,
    reduceMotion: false,
    notifications: { enabled: false, onActionRequired: true, onRunCompleted: true, onRunFailed: true },
    security: { customFileRules: [], customCommandRules: [] },
    appearance: { background: { source: { kind: "none" }, fit: "cover", position: { x: 50, y: 50 }, intensity: 40, blurPx: 0 } },
    defaultWorkspaceRoot: "/workspace",
    defaultModel: null,
    entryModels: {},
    translation: { targetLanguage: null, model: null, bubbleMaxChars: 600 },
    ...overrides,
  };
}

test("stored preferences written before translation existed fall back to the new defaults", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-preferences-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));

  // Preferences persisted by an older build carry no `translation` key at all.
  database.savePreferences({ ...defaults(), translation: undefined } as unknown as AppPreferences);

  const loaded = database.getPreferences(defaults());
  assert.deepEqual(loaded.translation, { targetLanguage: null, model: null, bubbleMaxChars: 600 });
  database.close();
});

test("stored translation preferences merge field by field instead of replacing the defaults", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-preferences-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));

  // Only one field was known when these preferences were written; the remaining
  // fields must survive the read instead of disappearing as `undefined`.
  database.savePreferences({ ...defaults(), translation: { targetLanguage: "ja" } as unknown as AppPreferences["translation"] });

  const loaded = database.getPreferences(defaults());
  assert.equal(loaded.translation.targetLanguage, "ja");
  assert.equal(loaded.translation.bubbleMaxChars, 600);
  assert.equal(loaded.translation.model, null);
  database.close();
});

test("stored preferences keep unrelated fields while translation is merged", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-preferences-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));

  database.savePreferences({
    ...defaults(),
    theme: "dark",
    translation: { targetLanguage: "en-US", model: { connectionId: "openai", modelId: "gpt" }, bubbleMaxChars: 1_200 },
  });

  const loaded = database.getPreferences(defaults());
  assert.equal(loaded.theme, "dark");
  assert.deepEqual(loaded.translation, { targetLanguage: "en-US", model: { connectionId: "openai", modelId: "gpt" }, bubbleMaxChars: 1_200 });
  database.close();
});
