import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { prepareUserDataPathAt } from "../src/main/bootstrap/user-data-path.ts";

async function withAppData(run: (appDataRoot: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wordless-user-data-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("migrates the full legacy user-data directory when no target exists", async () => {
  await withAppData(async (appDataRoot) => {
    const legacy = path.join(appDataRoot, "@wordless", "desktop");
    await mkdir(path.join(legacy, "sessions"), { recursive: true });
    await writeFile(path.join(legacy, "models.json"), "{}\n");
    await writeFile(path.join(legacy, "sessions", "thread.jsonl"), "journal\n");

    const result = prepareUserDataPathAt(appDataRoot);
    const target = path.join(appDataRoot, "Wordless");

    assert.equal(result.path, target);
    assert.equal(result.notice, undefined);
    assert.equal(await readFile(path.join(target, "sessions", "thread.jsonl"), "utf8"), "journal\n");
  });
});

test("rewrites persisted session paths after migration", async () => {
  await withAppData(async (appDataRoot) => {
    const legacy = path.join(appDataRoot, "@wordless", "desktop");
    await mkdir(legacy, { recursive: true });
    const database = new DatabaseSync(path.join(legacy, "wordless.db"));
    database.exec("CREATE TABLE sessions(journal_path TEXT NOT NULL, runtime_root_path TEXT NOT NULL); CREATE TABLE workspaces(root_path TEXT NOT NULL, canonical_root_path TEXT NOT NULL);");
    database.prepare("INSERT INTO sessions(journal_path, runtime_root_path) VALUES(?, ?)").run(path.join(legacy, "sessions", "thread.jsonl"), path.join(legacy, "session-workspaces", "session-1"));
    database.prepare("INSERT INTO workspaces(root_path, canonical_root_path) VALUES(?, ?)").run(path.join(legacy, "workspace"), path.join(legacy, "workspace"));
    database.close();

    const result = prepareUserDataPathAt(appDataRoot);
    const migrated = new DatabaseSync(path.join(result.path, "wordless.db"));
    const session = migrated.prepare("SELECT journal_path, runtime_root_path FROM sessions").get() as { journal_path: string; runtime_root_path: string };
    const workspace = migrated.prepare("SELECT root_path, canonical_root_path FROM workspaces").get() as { root_path: string; canonical_root_path: string };
    migrated.close();

    assert.equal(session.journal_path, path.join(result.path, "sessions", "thread.jsonl"));
    assert.equal(session.runtime_root_path, path.join(result.path, "session-workspaces", "session-1"));
    assert.equal(workspace.root_path, path.join(result.path, "workspace"));
    assert.equal(workspace.canonical_root_path, path.join(result.path, "workspace"));
  });
});

test("migrates into an empty target directory", async () => {
  await withAppData(async (appDataRoot) => {
    const legacy = path.join(appDataRoot, "@wordless", "desktop");
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, "models.json"), "{}\n");
    await mkdir(path.join(appDataRoot, "Wordless"), { recursive: true });

    const result = prepareUserDataPathAt(appDataRoot);

    assert.equal(result.path, path.join(appDataRoot, "Wordless"));
    assert.equal(await readFile(path.join(result.path, "models.json"), "utf8"), "{}\n");
  });
});

test("keeps legacy data active when the target already contains Wordless data", async () => {
  await withAppData(async (appDataRoot) => {
    const legacy = path.join(appDataRoot, "@wordless", "desktop");
    const target = path.join(appDataRoot, "Wordless");
    await mkdir(legacy, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(path.join(legacy, "models.json"), "{\"legacy\":true}\n");
    await writeFile(path.join(target, "wordless.db"), "target database");

    const result = prepareUserDataPathAt(appDataRoot);

    assert.equal(result.path, legacy);
    assert.match(result.notice ?? "", /both/);
  });
});
