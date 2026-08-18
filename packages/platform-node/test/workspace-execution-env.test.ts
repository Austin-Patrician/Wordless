import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspacePathService, WorkspaceSearchService, type ToolCallAccessController } from "../src/index.ts";

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

test("member write root isolates writes while keeping the session root readable", async () => {
  await withWorkspace(async (rootPath) => {
    const memberRoot = path.join(rootPath, "artifacts", "content-reviewer");
    await mkdir(memberRoot, { recursive: true });
    await writeFile(path.join(rootPath, "artifacts", "primary.md"), "primary\n");
    const env = new WorkspacePathService().createExecutionEnv(rootPath, "default", {
      writableRoot: memberRoot,
    });

    const read = await env.readTextFile("artifacts/primary.md");
    const write = await env.writeFile("artifacts/content-reviewer/review.md", "review\n");
    const blocked = await env.writeFile("artifacts/primary.md", "overwritten\n");

    assert.equal(read.ok, true);
    assert.equal(write.ok, true);
    assert.equal(blocked.ok, false);
    assert.equal(await readFile(path.join(memberRoot, "review.md"), "utf8"), "review\n");
    assert.equal(await readFile(path.join(rootPath, "artifacts", "primary.md"), "utf8"), "primary\n");
  });
});

test("default access canonicalizes paths inside a configured read-only root", async () => {
  await withWorkspace(async (rootPath) => {
    const readOnlyRoot = await mkdtemp(path.join(os.tmpdir(), "wordless-read-only-"));
    try {
      const filePath = path.join(readOnlyRoot, "SKILL.md");
      await writeFile(filePath, "# Skill\n");
      const env = new WorkspacePathService().createExecutionEnv(rootPath, "default", { readOnlyRoots: [readOnlyRoot] });

      const result = await env.canonicalPath(filePath);

      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.value, await realpath(filePath));
    } finally {
      await rm(readOnlyRoot, { force: true, recursive: true });
    }
  });
});

test("workspace search skips ignored folders and returns portable paths", async () => {
  await withWorkspace(async (rootPath) => {
    await mkdir(path.join(rootPath, "src", "components"), { recursive: true });
    await mkdir(path.join(rootPath, "node_modules", "hidden"), { recursive: true });
    await writeFile(path.join(rootPath, "src", "components", "Button.tsx"), "export {};");
    await writeFile(path.join(rootPath, "node_modules", "hidden", "Button.tsx"), "ignored");

    const service = new WorkspaceSearchService();
    try {
      const entries = await service.forRoot(rootPath).searchReferences("button", 50);
      assert.deepEqual(entries.map((entry) => entry.path), ["src/components/Button.tsx"]);
      assert.equal(entries[0]?.kind, "file");
    } finally {
      service.dispose();
    }
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

    const service = new WorkspaceSearchService();
    try {
      const entries = await service.forRoot(rootPath).searchReferences("", 50);
      assert.deepEqual(new Set(entries.map((entry) => entry.path)), new Set(["src", "src/visible.ts"]));
    } finally {
      service.dispose();
    }
  });
});

test("indexed find and grep support cursors, regex, context, and watcher updates", async () => {
  await withWorkspace(async (rootPath) => {
    await mkdir(path.join(rootPath, "src"), { recursive: true });
    await writeFile(path.join(rootPath, "src", "alpha.ts"), "before\nconst Alpha = 1\nafter\n");
    await writeFile(path.join(rootPath, "src", "alphabet.ts"), "const Alphabet = 2\n");
    const service = new WorkspaceSearchService();
    try {
      const search = service.forRoot(rootPath);
      const first = await search.find({ pattern: "alpha", path: "src", limit: 1 });
      assert.equal(first.items.length, 1);
      assert.ok(first.nextCursor);
      const second = await search.find({ pattern: "alpha", path: "src", limit: 1, cursor: first.nextCursor });
      assert.equal(second.items.length, 1);
      assert.notEqual(second.items[0]?.path, first.items[0]?.path);
      assert.equal((await search.find({ pattern: "alpha", exclude: "**/alphabet.ts" })).items.some((item) => item.path.endsWith("alphabet.ts")), false);

      const grep = await search.grep({ pattern: "Alpha(?:bet)?", path: "src", literal: false, context: 1, limit: 10 });
      assert.equal(grep.items.length, 2);
      assert.deepEqual(grep.items.find((item) => item.path.endsWith("alpha.ts"))?.contextBefore, ["before"]);
      assert.equal((await search.grep({ pattern: "alpha", ignoreCase: false })).items.length, 0);
      assert.equal((await search.grep({ pattern: "alpha", ignoreCase: true })).items.length, 2);

      await writeFile(path.join(rootPath, "src", "new-search-result.ts"), "export const ready = true;\n");
      let updated = false;
      for (let attempt = 0; attempt < 30 && !updated; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        updated = (await search.find({ pattern: "new search result" })).items.some((item) => item.path === "src/new-search-result.ts");
      }
      assert.equal(updated, true);
    } finally {
      service.dispose();
    }
  });
});

test("one-time outside access is isolated to one tool call and can be revoked", async () => {
  await withWorkspace(async (rootPath) => {
    const outsidePath = path.resolve(rootPath, "..", `wordless-outside-${path.basename(rootPath)}.txt`);
    await writeFile(outsidePath, "outside", "utf8");
    try {
      const env = new WorkspacePathService().createExecutionEnv(rootPath, "default") as ReturnType<WorkspacePathService["createExecutionEnv"]> & ToolCallAccessController;
      assert.equal((await env.readTextFile(outsidePath)).ok, false);

      env.grantOutsideWorkspaceAccess("call-1");
      const allowed = await env.runWithToolCall("call-1", async () => await env.readTextFile(outsidePath));
      const otherCall = await env.runWithToolCall("call-2", async () => await env.readTextFile(outsidePath));
      assert.deepEqual(allowed, { ok: true, value: "outside" });
      assert.equal(otherCall.ok, false);

      env.revokeOutsideWorkspaceAccess("call-1");
      const revoked = await env.runWithToolCall("call-1", async () => await env.readTextFile(outsidePath));
      assert.equal(revoked.ok, false);
    } finally {
      await rm(outsidePath, { force: true });
    }
  });
});
