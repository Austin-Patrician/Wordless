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
    shortcuts: { bindings: {} },
    ocr: { cache: true, granularity: "text" },
    knowledge: { enabled: true, activeKnowledgeBase: null, libraries: {} },
    dismissedNotices: {},
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

test("shortcut bindings are filtered when they are read back", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-preferences-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));

  // A row that was hand-edited or written by a build with a different action
  // table: only the usable binding may survive.
  database.savePreferences({
    ...defaults(),
    shortcuts: {
      bindings: {
        "open-settings": "Shift+Mod+,",
        "removed-action": "mod+j",
        "new-thread": "mod+n",
        "bad-combo": "mod+",
      },
    } as unknown as AppPreferences["shortcuts"],
  });

  const loaded = database.getPreferences(defaults());
  assert.deepEqual(loaded.shortcuts.bindings, { "open-settings": "mod+shift+," });
  database.close();
});

test("stored preferences written before shortcuts existed fall back to no bindings", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-preferences-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));

  database.savePreferences({ ...defaults(), shortcuts: undefined } as unknown as AppPreferences);

  const loaded = database.getPreferences(defaults());
  assert.deepEqual(loaded.shortcuts, { bindings: {} });
  database.close();
});

test("多库之前那份扁平的 knowledge 偏好,读的时候被迁移到当前库名下", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-preferences-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));

  // 老结构:没有 `libraries`,设置是扁平的。这里的合并是**浅合并**,所以不归一的话
  // `libraries` 会是默认的空对象、老的 `autoProcessMinutes` 却还在顶层 ——
  // 宿主侧(轮询、每轮预算、归档模型)读到的就全是默认值:用户配好的自动加工静默不再跑。
  database.savePreferences({
    ...defaults(),
    knowledge: { enabled: true, activeKnowledgeBase: "工作", processingModel: { connectionId: "a", modelId: "b" }, autoProcessMinutes: 10, maxFilesPerRound: 20 },
  } as unknown as AppPreferences);

  const loaded = database.getPreferences(defaults());
  assert.deepEqual(loaded.knowledge, {
    enabled: true,
    activeKnowledgeBase: "工作",
    libraries: { 工作: { processingModel: { connectionId: "a", modelId: "b" }, autoProcessMinutes: 10, maxFilesPerRound: 20 } },
  });
  database.close();
});

test("全新的安装不会在偏好里凭空留一个库", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-preferences-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));

  assert.deepEqual(database.getPreferences(defaults()).knowledge.libraries, {});
  database.close();
});
