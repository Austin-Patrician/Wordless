import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionRecord } from "@wordless/domain";
import { WordlessDatabase } from "@wordless/persistence";
import { WorkspacePathService } from "@wordless/platform-node";
import { WordlessRuntime } from "../src/index.ts";

test("indexes scoped General Work artifacts with expert producers", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-session-artifacts-"));
  context.after(async () => await rm(root, { force: true, recursive: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  context.after(() => database.close());
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
  assert.equal(snapshot.artifacts.length, 1);
  const brief = snapshot.artifacts.find((artifact) => artifact.name === "brief.md");
  assert.equal(brief?.previewKind, "markdown");
  assert.deepEqual(brief?.producer, {
    kind: "primary",
    id: "lead",
    name: "Editor",
    portrait: { kind: "builtin", key: "content-studio" },
  });
  assert.ok(brief);
  assert.deepEqual(await runtime.readSessionArtifact(sessionId, brief.id), {
    status: "available",
    kind: "text",
    name: "brief.md",
    content: "# Brief\n",
  });
  await assert.rejects(
    runtime.readSessionArtifact(sessionId, "../../private.txt"),
    /unavailable/,
  );
});
