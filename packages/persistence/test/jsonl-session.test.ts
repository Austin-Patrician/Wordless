import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { AppPreferences } from "@wordless/domain";
import { WordlessDatabase, createWordlessSession, openWordlessSession } from "../src/index.ts";

const defaultPreferences: AppPreferences = {
  locale: "zh-CN",
  theme: "system",
  fontScale: 1,
  reduceMotion: false,
  notifications: { enabled: false, onActionRequired: true, onRunCompleted: true, onRunFailed: true },
  security: { customFileRules: [], customCommandRules: [] },
  appearance: { background: { source: { kind: "none" }, fit: "cover", position: { x: 50, y: 50 }, intensity: 40, blurPx: 0 } },
  defaultWorkspaceRoot: "C:/Wordless",
  defaultModel: null,
  entryModels: {},
};

test("persists workspace metadata and JSONL model changes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-persistence-"));
  context.after(async () => await rm(root, { force: true, recursive: true }));

  const database = new WordlessDatabase(join(root, "wordless.db"));
  database.upsertWorkspace({
    id: "workspace-1",
    kind: "managed",
    name: "Research",
    rootPath: join(root, "Research"),
    canonicalRootPath: join(root, "Research"),
    availability: "available",
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
  });
  assert.equal(database.listWorkspaces()[0]?.name, "Research");

  const journalPath = join(root, "sessions", "session-1.jsonl");
  const session = await createWordlessSession({
    id: "session-1",
    createdAt: new Date(1).toISOString(),
    cwd: join(root, "Research"),
    path: journalPath,
    metadata: { workspaceId: "workspace-1" },
  });
  await session.appendModelChange("openai", "gpt-4.1-mini");
  await session.appendModelChange("custom-1", "local-model");

  const reopened = await openWordlessSession(journalPath);
  const entries = await reopened.getEntries();
  assert.equal(entries.filter((entry) => entry.type === "model_change").length, 2);
  assert.match(await readFile(journalPath, "utf8"), /custom-1/);
  database.close();
});

test("persists session rename, pin state, and deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-persistence-"));
  context.after(async () => await rm(root, { force: true, recursive: true }));
  const databasePath = join(root, "wordless.db");
  let database = new WordlessDatabase(databasePath);
  const createSession = (id: string, updatedAt: number) => ({
    id,
    title: id,
    workspaceId: null,
    runtimeRootPath: join(root, "session-workspaces", id),
    mode: "everyday" as const,
    entryId: "general-work",
    profile: { id: "general", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1" as const,
    workbenchId: "conversation" as const,
    accessLevel: "default" as const,
    model: { connectionId: "openai", modelId: "gpt-4.1-mini" },
    thinkingLevel: "medium" as const,
    journalPath: join(root, "sessions", `${id}.jsonl`),
    connectorIds: [],
    interactionMode: id === "older" ? "clarify" as const : undefined,
    toolApprovalMode: id === "older" ? "bypass" as const : "auto" as const,
    pinnedAt: null,
    createdAt: updatedAt,
    updatedAt,
  });

  database.upsertSession(createSession("older", 1));
  database.upsertSession(createSession("newer", 2));
  database.close();
  database = new WordlessDatabase(databasePath);

  assert.deepEqual(database.listSessions().map((session) => session.id), ["newer", "older"]);
  assert.equal(database.getSession("older")?.interactionMode, "clarify");
  assert.equal(database.getSession("newer")?.interactionMode, "default");
  assert.equal(database.getSession("older")?.toolApprovalMode, "bypass");
  assert.equal(database.getSession("newer")?.toolApprovalMode, "auto");
  assert.equal(database.getSession("newer")?.thinkingLevel, "medium");

  const renamed = database.renameSession("older", "Renamed session");
  assert.equal(renamed?.title, "Renamed session");
  const pinned = database.setSessionPinned("older", true);
  assert.notEqual(pinned?.pinnedAt, null);
  assert.deepEqual(database.listSessions().map((session) => session.id), ["older", "newer"]);
  assert.equal(database.deleteSession("older"), true);
  assert.equal(database.getSession("older"), undefined);
  database.close();
});

test("keeps an immutable expert snapshot for existing sessions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-persistence-"));
  context.after(async () => await rm(root, { force: true, recursive: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  const expert = { id: "expert-1", version: "1", name: "Analyst", description: "Evidence-first analysis", portrait: { kind: "builtin" as const, key: "research-analyst" }, kind: "expert" as const, systemPrompt: "Use evidence.", skillIds: ["research"], connectorIds: ["web"], skillCount: 1, connectorCount: 1, source: "local" as const, createdAt: 1, updatedAt: 1 };
  database.upsertExpert(expert);
  database.upsertSession({ id: "session-expert", title: "Expert run", workspaceId: null, runtimeRootPath: join(root, "workspace"), mode: "everyday", entryId: "general-work", profile: { id: "general", version: "1" }, driverId: "generic", journalFormat: "wordless-agent-v1", workbenchId: "conversation", accessLevel: "default", model: { connectionId: "openai", modelId: "gpt-4.1-mini" }, thinkingLevel: "medium", journalPath: join(root, "session.jsonl"), connectorIds: ["web"], toolApprovalMode: "manual", pinnedAt: null, expertSelection: { kind: "expert", id: expert.id, version: expert.version }, createdAt: 1, updatedAt: 1 });
  database.saveSessionExpertSnapshot("session-expert", { selection: { kind: "expert", id: expert.id, version: expert.version }, name: expert.name, systemPrompt: expert.systemPrompt, skillIds: expert.skillIds, connectorIds: expert.connectorIds });
  database.deleteExpert(expert.id);
  assert.equal(database.getExpert(expert.id), undefined);
  assert.deepEqual(database.getSessionExpertSnapshot("session-expert")?.skillIds, ["research"]);
  database.deleteSession("session-expert");
  assert.equal(database.getSessionExpertSnapshot("session-expert"), undefined);
  database.close();
});

test("merges appearance defaults into preferences written before background support", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-persistence-"));
  context.after(async () => await rm(root, { force: true, recursive: true }));
  const databasePath = join(root, "wordless.db");
  const initialized = new WordlessDatabase(databasePath);
  initialized.close();

  const raw = new DatabaseSync(databasePath);
  raw.prepare("INSERT INTO preferences(key, value, updated_at) VALUES(?, ?, ?)").run("app", JSON.stringify({ locale: "en-US", appearance: { background: { intensity: 72 } } }), Date.now());
  raw.close();

  const database = new WordlessDatabase(databasePath);
  const preferences = database.getPreferences(defaultPreferences);
  database.close();

  assert.equal(preferences.locale, "en-US");
  assert.equal(preferences.appearance.background.source.kind, "none");
  assert.equal(preferences.appearance.background.fit, "cover");
  assert.deepEqual(preferences.appearance.background.position, { x: 50, y: 50 });
  assert.equal(preferences.appearance.background.intensity, 72);
  assert.equal(preferences.appearance.background.blurPx, 0);
});
