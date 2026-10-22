import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionRecord, WorkspaceRecord } from "@wordless/domain";
import { WordlessDatabase } from "@wordless/persistence";
import { WorkspacePathService } from "@wordless/platform-node";
import { WordlessRuntime } from "../src/index.ts";

/**
 * 工作区里的「在 Finder 里显示」。
 *
 * 守的是一个**只报错、不静默**的坏法:文件树里**每一个文件夹**都有「Reveal in Finder」,
 * 而宿主那边曾经拿"解析一个文件"(`resolveSessionWorkspaceFile`,内部要求 `isFile()`)去做
 * 这件事 —— 于是点文件夹得到的是一句 `Selected path is not a file`(实测报过)。
 *
 * 不用 mock 任何界面:错的就在这两个解析入口的判据上,而"在 Finder 里选中一个目录"本身
 * 是完全成立的(父目录里选中它)。
 */

type Fixture = {
  runtime: WordlessRuntime;
  sessionId: string;
  runtimeRootPath: string;
  /** 目录(`docs/`)与文件(`notes.md`)各一 —— 差别正是这条测试要钉的那条。 */
  directory: string;
  file: string;
};

async function withWorkspaceSession(
  run: (fixture: Fixture) => Promise<void>,
  options: { running?: boolean } = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "wordless-workspace-paths-"));
  const database = new WordlessDatabase(join(root, "wordless.db"));
  try {
    const workspaceRoot = join(root, "workspace");
    const runtimeRootPath = join(workspaceRoot, "session-root");
    await mkdir(join(runtimeRootPath, "docs"), { recursive: true });
    await writeFile(join(runtimeRootPath, "notes.md"), "# Notes\n");

    const workspace: WorkspaceRecord = {
      id: "workspace-1",
      kind: "managed",
      name: "Workspace",
      rootPath: workspaceRoot,
      canonicalRootPath: await realpath(workspaceRoot),
      availability: "available",
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    };
    database.upsertWorkspace(workspace);

    const sessionId = "session-1";
    const record: SessionRecord = {
      id: sessionId,
      title: "Workspace paths",
      workspaceId: workspace.id,
      runtimeRootPath,
      mode: "code",
      entryId: "coding",
      profile: { id: "coding", version: "1" },
      driverId: "generic",
      journalFormat: "wordless-agent-v1",
      workbenchId: "code",
      accessLevel: "default",
      model: { connectionId: "openai", modelId: "gpt-5" },
      thinkingLevel: "medium",
      journalPath: join(root, "sessions", `${sessionId}.jsonl`),
      connectorIds: [],
      toolApprovalMode: "manual",
      pinnedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    database.upsertSession(record);

    const runtime = Object.create(WordlessRuntime.prototype) as WordlessRuntime;
    Object.assign(runtime, {
      database,
      pathService: new WorkspacePathService(),
      runs: new Map(options.running === true ? [[sessionId, {}]] : []),
    });

    await run({
      runtime,
      sessionId,
      runtimeRootPath,
      directory: await realpath(join(runtimeRootPath, "docs")),
      file: await realpath(join(runtimeRootPath, "notes.md")),
    });
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
}

test("「在 Finder 里显示」对目录也成立 —— 点文件夹不该报 「Selected path is not a file」", async () => {
  await withWorkspaceSession(async ({ runtime, sessionId, directory, file }) => {
    assert.equal(await runtime.resolveSessionWorkspacePath(sessionId, "docs"), directory);
    // 文件照旧,一条路管两种项。
    assert.equal(await runtime.resolveSessionWorkspacePath(sessionId, "notes.md"), file);
    // 而"只认文件"的那个入口对目录仍然拒绝 —— 那句错的来处就是它。
    await assert.rejects(
      runtime.resolveSessionWorkspaceFile(sessionId, "docs"),
      /Selected path is not a file/,
    );
  });
});

test("工作区在跑的时候:移进废纸篓仍然被挡住,而「在 Finder 里显示」不受影响", async () => {
  // 两者共用同一段路径解析,但"跑着的时候别动工作区"只属于**会改东西**的那个。
  await withWorkspaceSession(
    async ({ runtime, sessionId, directory }) => {
      await assert.rejects(
        runtime.resolveSessionWorkspaceEntry(sessionId, "docs"),
        /while the agent is running/,
      );
      assert.equal(await runtime.resolveSessionWorkspacePath(sessionId, "docs"), directory);
    },
    { running: true },
  );
});

test("工作区路径不许跑出根目录 —— 目录也不例外", async () => {
  await withWorkspaceSession(async ({ runtime, sessionId }) => {
    await assert.rejects(
      runtime.resolveSessionWorkspacePath(sessionId, "../outside"),
      /escapes the session root/,
    );
  });
});
