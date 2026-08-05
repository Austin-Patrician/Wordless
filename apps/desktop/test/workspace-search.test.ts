import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeExecutionEnv } from "@wordless/agent/node";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { WorkspaceSearchService } from "@wordless/platform-node";
import type { WorkspaceSearchProvider } from "@wordless/workspace-search";

test("FFF native workspace search is loadable on the host platform", async () => {
  const root = await mkdtemp(join(tmpdir(), "wordless-fff-smoke-"));
  const service = new WorkspaceSearchService();
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "ignored"));
    await writeFile(join(root, ".gitignore"), "ignored/\n");
    await writeFile(join(root, "src", "Composer.tsx"), "const workspaceToken = true;\n");
    await writeFile(join(root, "ignored", "Hidden.ts"), "workspaceToken\n");
    const search = service.forRoot(root);
    assert.deepEqual((await search.find({ pattern: "composer" })).items.map((item) => item.path), ["src/Composer.tsx"]);
    assert.deepEqual((await search.grep({ pattern: "workspaceToken" })).items.map((item) => item.path), ["src/Composer.tsx"]);
    assert.deepEqual((await search.searchReferences("composer")).map((item) => item.path), ["src/Composer.tsx"]);
  } finally {
    service.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("coding find and grep tools expose and forward the indexed search contract", async () => {
  const calls: string[] = [];
  const search: WorkspaceSearchProvider = {
    async find(request) {
      calls.push(`find:${request.pattern}:${request.limit}`);
      return { items: [{ path: "src/Composer.tsx", name: "Composer.tsx", size: 10, modifiedAt: 0 }], total: 2, nextCursor: "find-next" };
    },
    async grep(request) {
      calls.push(`grep:${request.pattern}:${request.literal}`);
      return { items: [{ path: "src/Composer.tsx", line: 4, column: 8, text: "workspaceToken", contextBefore: [], contextAfter: [] }], total: 1 };
    },
    async searchReferences() {
      return [];
    },
  };
  const tools = createHeadlessCodingTools(new NodeExecutionEnv({ cwd: process.cwd() }), search);
  const find = tools.find((tool) => tool.name === "find");
  const grep = tools.find((tool) => tool.name === "grep");
  assert.ok(find && grep);
  const findResult = await find.execute("find-call", { pattern: "composer", limit: 1 });
  const grepResult = await grep.execute("grep-call", { pattern: "workspaceToken", literal: true });
  assert.deepEqual(calls, ["find:composer:1", "grep:workspaceToken:true"]);
  assert.equal(findResult.details.nextCursor, "find-next");
  assert.equal(grepResult.content[0]?.type === "text" ? grepResult.content[0].text : "", "src/Composer.tsx:4:8: workspaceToken");
});
