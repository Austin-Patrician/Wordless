import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspacePathService } from "../src/index.ts";

async function withWorkspace(run: (rootPath: string) => Promise<void>): Promise<void> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "wordless-workspace-"));
  try {
    await run(rootPath);
  } finally {
    await rm(rootPath, { force: true, recursive: true });
  }
}

test("default access permits an absolute write path inside the workspace", async () => {
  await withWorkspace(async (rootPath) => {
    const env = new WorkspacePathService().createExecutionEnv(rootPath, "default");
    const filePath = path.join(rootPath, "plan.md");

    const result = await env.writeFile(filePath, "# Plan\n");

    assert.equal(result.ok, true);
    assert.equal(await readFile(filePath, "utf8"), "# Plan\n");
  });
});

test("default access rejects an absolute write path outside the workspace", async () => {
  await withWorkspace(async (rootPath) => {
    const env = new WorkspacePathService().createExecutionEnv(rootPath, "default");
    const filePath = path.resolve(rootPath, "..", "outside-workspace.md");

    const result = await env.writeFile(filePath, "blocked");

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /inside the workspace/);
  });
});
