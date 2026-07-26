import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("workspace search skips ignored folders and returns portable paths", async () => {
  await withWorkspace(async (rootPath) => {
    await mkdir(path.join(rootPath, "src", "components"), { recursive: true });
    await mkdir(path.join(rootPath, "node_modules", "hidden"), { recursive: true });
    await writeFile(path.join(rootPath, "src", "components", "Button.tsx"), "export {};");
    await writeFile(path.join(rootPath, "node_modules", "hidden", "Button.tsx"), "ignored");

    const entries = await new WorkspacePathService().searchWorkspace(rootPath, "button", 50);

    assert.deepEqual(entries.map((entry) => entry.path), ["src/components/Button.tsx"]);
    assert.equal(entries[0]?.kind, "file");
  });
});

test("workspace search honors .gitignore rules when present", async () => {
  await withWorkspace(async (rootPath) => {
    await mkdir(path.join(rootPath, "src"), { recursive: true });
    await mkdir(path.join(rootPath, "generated"), { recursive: true });
    await writeFile(path.join(rootPath, ".gitignore"), "generated/\n*.secret\n");
    await writeFile(path.join(rootPath, "src", "visible.ts"), "export {};");
    await writeFile(path.join(rootPath, "src", "credentials.secret"), "hidden");
    await writeFile(path.join(rootPath, "generated", "output.ts"), "hidden");

    const entries = await new WorkspacePathService().searchWorkspace(rootPath, "", 50);

    assert.deepEqual(entries.map((entry) => entry.path), ["src", ".gitignore", "src/visible.ts"]);
  });
});
