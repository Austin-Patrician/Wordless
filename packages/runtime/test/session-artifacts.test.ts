import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionRecord } from "@wordless/domain";
import { WordlessDatabase } from "@wordless/persistence";
import { WorkspacePathService } from "@wordless/platform-node";
import { WordlessRuntime } from "../src/index.ts";

test("indexes scoped General Work artifacts with expert producers", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-session-artifacts-"));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  context.after(async () => {
    await database.close();
    await rm(root, { force: true, recursive: true });
  });
  const sessionId = "session-1";
  const runtimeRootPath = join(root, "session-root");
  const record: SessionRecord = {
    id: sessionId,
    title: "Artifact test",
    workspaceId: null,
    runtimeRootPath,
    mode: "everyday",
    entryId: "general-work",
    profile: { id: "general", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel: "default",
    model: { connectionId: "openai", modelId: "gpt-5" },
    thinkingLevel: "medium",
    journalPath: join(root, "sessions", `${sessionId}.jsonl`),
    connectorIds: [],
    toolApprovalMode: "manual",
    pinnedAt: null,
    expertSelection: { kind: "team", id: "team-1", version: "1" },
    createdAt: 1,
    updatedAt: 1,
  };
  database.upsertSession(record);
  database.saveSessionExpertSnapshot(sessionId, {
    kind: "team",
    selection: record.expertSelection!,
    name: "Editorial team",
    systemPrompt: "Lead.",
    skillIds: [],
    connectorIds: [],
    teamName: "Editorial team",
    teamPortrait: { kind: "builtin", key: "content-studio" },
    leader: {
      expertId: "lead",
      expertName: "Editor",
      portrait: { kind: "builtin", key: "content-studio" },
      systemPrompt: "Lead.",
      skillIds: [],
      connectorIds: [],
    },
    teamMembers: [{
      id: "writer-1",
      name: "Writer",
      expertName: "Writer",
      portrait: { kind: "builtin", key: "product-strategist" },
      systemPrompt: "Write.",
      skillIds: [],
      connectorIds: [],
      executionProfile: "workspace-write",
      responsibility: "Draft the article.",
    }],
  });

  await mkdir(join(runtimeRootPath, "artifacts", "primary"), { recursive: true });
  await mkdir(join(runtimeRootPath, "artifacts", "writer-1"), { recursive: true });
  await mkdir(join(runtimeRootPath, "artifacts", "subagents", "worker", "task-1"), { recursive: true });
  await writeFile(join(runtimeRootPath, "artifacts", "primary", "brief.md"), "# Brief\n");
  await writeFile(join(runtimeRootPath, "artifacts", "primary", "diagram.svg"), "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" /></svg>\n");
  await writeFile(join(runtimeRootPath, "artifacts", "writer-1", "draft.txt"), "Draft copy");
  await writeFile(join(runtimeRootPath, "artifacts", "subagents", "worker", "task-1", "notes.json"), "{}\n");
  await writeFile(join(runtimeRootPath, "private.txt"), "not an artifact");

  const runtime = Object.create(WordlessRuntime.prototype) as WordlessRuntime;
  Object.assign(runtime, {
    database,
    pathService: new WorkspacePathService(),
    artifactRevisions: new Map(),
  });

  const snapshot = await runtime.getSessionArtifacts(sessionId);
  assert.equal(snapshot.artifacts.length, 3);
  const brief = snapshot.artifacts.find((artifact) => artifact.name === "brief.md");
  assert.equal(brief?.previewKind, "markdown");
  assert.deepEqual(brief?.producer, {
    kind: "primary",
    id: "lead",
    name: "Editor",
    portrait: { kind: "builtin", key: "content-studio" },
  });
  assert.equal(brief?.group, "primary");
  const draft = snapshot.artifacts.find((artifact) => artifact.name === "draft.txt");
  assert.equal(draft?.group, "writer-1");
  assert.deepEqual(draft?.producer, {
    kind: "expert-member",
    id: "writer-1",
    name: "Writer",
    portrait: { kind: "builtin", key: "product-strategist" },
  });
  assert.ok(brief);
  assert.deepEqual(await runtime.readSessionArtifact(sessionId, brief.id), {
    status: "available",
    kind: "text",
    name: "brief.md",
    content: "# Brief\n",
  });
  const diagram = snapshot.artifacts.find((artifact) => artifact.name === "diagram.svg");
  assert.equal(diagram?.previewKind, "text");
  assert.deepEqual(await runtime.readSessionArtifact(sessionId, diagram!.id), {
    status: "available",
    kind: "text",
    name: "diagram.svg",
    content: "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" /></svg>\n",
  });
  await assert.rejects(
    runtime.readSessionArtifact(sessionId, "../../private.txt"),
    /unavailable/,
  );
});

test("filters deleted session changes from the current context", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-session-context-"));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  context.after(async () => {
    await database.close();
    await rm(root, { force: true, recursive: true });
  });

  const runtimeRootPath = join(root, "session-root");
  const journalPath = join(root, "sessions", "session-1.jsonl");
  const record: SessionRecord = {
    id: "session-1",
    title: "Context test",
    workspaceId: null,
    runtimeRootPath,
    mode: "code",
    entryId: "code-development",
    profile: { id: "coding", version: "1" },
    driverId: "coding",
    journalFormat: "wordless-agent-v1",
    workbenchId: "conversation",
    accessLevel: "default",
    model: { connectionId: "openai", modelId: "gpt-5" },
    thinkingLevel: "medium",
    journalPath,
    connectorIds: [],
    toolApprovalMode: "manual",
    pinnedAt: null,
    expertSelection: null,
    createdAt: 1,
    updatedAt: 1,
  };
  database.upsertSession(record);

  const createdPath = join(runtimeRootPath, "created.txt");
  const modifiedPath = join(runtimeRootPath, "modified.txt");
  await mkdir(runtimeRootPath, { recursive: true });
  await writeFile(createdPath, "created");
  await writeFile(modifiedPath, "modified");
  await mkdir(join(root, "sessions"), { recursive: true });
  await writeFile(journalPath, [
    JSON.stringify({ type: "wordless.session", metadata: { id: "session-1", createdAt: new Date(1).toISOString(), cwd: root, path: journalPath, metadata: {} } }),
    JSON.stringify({ type: "message", id: "tool-result-1", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "toolResult", toolCallId: "write-1", toolName: "write", details: { path: "created.txt", change: { kind: "created" } } } }),
    JSON.stringify({ type: "message", id: "tool-result-2", parentId: "tool-result-1", timestamp: new Date(2).toISOString(), message: { role: "toolResult", toolCallId: "edit-1", toolName: "edit", details: { path: "modified.txt", change: { kind: "modified" } } } }),
  ].join("\n") + "\n");

  const runtime = Object.create(WordlessRuntime.prototype) as WordlessRuntime;
  Object.assign(runtime, { database, artifactRevisions: new Map() });

  const beforeDelete = await runtime.getSessionContext(record.id);
  assert.deepEqual(beforeDelete.artifacts.map((change) => change.path), ["created.txt"]);
  assert.deepEqual(beforeDelete.changes.map((change) => change.path), ["created.txt", "modified.txt"]);

  await unlink(createdPath);
  const afterDelete = await runtime.getSessionContext(record.id);
  assert.deepEqual(afterDelete.artifacts, []);
  assert.deepEqual(afterDelete.changes.map((change) => change.path), ["modified.txt"]);
});
