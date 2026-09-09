import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AutomationRun, AutomationTask, SessionRecord } from "@wordless/domain";
import { WordlessDatabase } from "../src/index.ts";

const configuration = { prompt: "Run", entryId: "general-work", workspaceId: null, sessionId: null as string | null, accessLevel: "full" as const, toolApprovalMode: "bypass" as const, model: { connectionId: "openai", modelId: "gpt" }, thinkingLevel: "medium" as const, skillIds: [], connectorIds: [] };

test("automation migration preserves history after task deletion and cascades session deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-automation-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  const task: AutomationTask = { ...configuration, id: "task-1", name: "Task", schedule: { kind: "recurring", cadence: "daily", time: "09:00" }, activeFrom: null, activeUntil: null, enabled: true, nextRunAt: 10, createdAt: 1, updatedAt: 1 };
  const session: SessionRecord = { id: "session-1", title: "Run", workspaceId: null, runtimeRootPath: join(root, "workspace"), mode: "everyday", entryId: "general-work", profile: { id: "general", version: "1" }, driverId: "generic", journalFormat: "wordless-agent-v1", workbenchId: "conversation", accessLevel: "full", model: configuration.model, thinkingLevel: "medium", journalPath: join(root, "session.jsonl"), connectorIds: [], interactionMode: "default", toolApprovalMode: "bypass", pinnedAt: null, createdAt: 1, updatedAt: 1 };
  const run: AutomationRun = { id: "run-1", automationId: task.id, automationName: task.name, configuration, scheduledFor: 10, sessionId: session.id, status: "completed", error: null, createdAt: 10, startedAt: 10, completedAt: 20 };

  database.upsertAutomation(task);
  assert.equal(database.getAutomation(task.id)?.toolApprovalMode, "bypass");
  database.upsertSession(session);
  assert.equal(database.insertAutomationRun(run), true);
  assert.equal(database.insertAutomationRun({ ...run, id: "duplicate" }), false);
  database.deleteAutomation(task.id);
  assert.equal(database.getAutomationRun(run.id)?.automationId, null);
  assert.equal(database.getAutomationRun(run.id)?.sessionId, session.id);
  database.deleteSession(session.id);
  assert.equal(database.getAutomationRun(run.id), undefined);
  database.close();
});

test("automation documents written before linked sessions default sessionId to null", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "wordless-automation-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  const task: AutomationTask = { ...configuration, sessionId: "session-1", id: "task-legacy", name: "Legacy", schedule: { kind: "recurring", cadence: "daily", time: "09:00" }, activeFrom: null, activeUntil: null, enabled: true, nextRunAt: 10, createdAt: 1, updatedAt: 1 };
  const run: AutomationRun = { id: "run-legacy", automationId: task.id, automationName: task.name, configuration: { ...configuration, sessionId: "session-1" }, scheduledFor: 10, sessionId: "session-1", status: "completed", error: null, createdAt: 10, startedAt: 10, completedAt: 20 };

  const session: SessionRecord = { id: "session-1", title: "Run", workspaceId: null, runtimeRootPath: join(root, "workspace"), mode: "everyday", entryId: "general-work", profile: { id: "general", version: "1" }, driverId: "generic", journalFormat: "wordless-agent-v1", workbenchId: "conversation", accessLevel: "full", model: configuration.model, thinkingLevel: "medium", journalPath: join(root, "legacy-session.jsonl"), connectorIds: [], interactionMode: "default", toolApprovalMode: "bypass", pinnedAt: null, createdAt: 1, updatedAt: 1 };
  database.upsertSession(session);

  // Simulate pre-existing documents: strip the linked-session fields.
  const legacyTask = JSON.parse(JSON.stringify(task));
  delete legacyTask.sessionId;
  database.upsertAutomation(legacyTask as unknown as AutomationTask);
  const legacyRun = JSON.parse(JSON.stringify(run));
  delete legacyRun.configuration.sessionId;
  assert.equal(database.insertAutomationRun(legacyRun as unknown as AutomationRun), true);

  const storedTask = database.getAutomation("task-legacy");
  assert.equal(storedTask?.sessionId, null);
  const storedRun = database.getAutomationRun("run-legacy");
  assert.equal(storedRun?.configuration.sessionId, null);
  assert.equal(storedRun?.sessionId, "session-1");
  database.close();
});
