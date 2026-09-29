import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRecord, WorkspaceRecord } from "@wordless/domain";
import {
  DESIGN_LIBRARY_SESSION_LIMIT,
  designLibrarySources,
} from "../src/renderer/features/design/design-library-sources.ts";

/**
 * 这一层是**口径**,不是几何:哪些根该扫、按什么顺序、扫到多少为止。
 *
 * 它出错的样子很安静 —— 列表里少一份设计,或者同一份列两遍,没有别的症状。所以这里逐个把
 * 四种来源(工作区、绑工作区的会话、无工作区的会话、非设计会话)都摆出来。
 */

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: "w1",
    kind: "managed",
    name: "My project",
    rootPath: "/w/my-project",
    canonicalRootPath: "/w/my-project",
    availability: "available",
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: 0,
    ...overrides,
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    title: "Waste sorting",
    workspaceId: null,
    runtimeRootPath: "/secrets/session-workspaces/s1",
    mode: "create",
    entryId: "ui-design",
    profile: { id: "ui", version: "1" },
    driverId: "generic",
    journalFormat: "wordless-agent-v1",
    workbenchId: "ui-preview",
    accessLevel: "default",
    model: { connectionId: "openai", modelId: "gpt-5" },
    thinkingLevel: "medium",
    journalPath: "/journals/s1.jsonl",
    connectorIds: [],
    toolApprovalMode: "manual",
    pinnedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

test("工作区在前(保持用户顺序),设计会话在后(按最近更新)", () => {
  const sources = designLibrarySources({
    workspaces: [workspace({ id: "w1", name: "First" }), workspace({ id: "w2", name: "Second", rootPath: "/w/second", canonicalRootPath: "/w/second" })],
    sessions: [
      session({ id: "old", title: "Old", runtimeRootPath: "/sp/old", updatedAt: 100 }),
      session({ id: "new", title: "New", runtimeRootPath: "/sp/new", updatedAt: 300 }),
    ],
  });

  assert.deepEqual(
    sources.map((source) => source.key),
    ["workspace:/w/my-project", "workspace:/w/second", "session:new", "session:old"],
  );
});

test("绑在工作区上的设计会话不重复列 —— 它们本来就是同一个根", () => {
  const sources = designLibrarySources({
    workspaces: [workspace()],
    // 有工作区的会话,`runtimeRootPath` 就是那个工作区的 `canonicalRootPath`(建会话那行的左边)。
    sessions: [session({ id: "bound", runtimeRootPath: "/w/my-project" })],
  });

  assert.deepEqual(
    sources.map((source) => source.key),
    ["workspace:/w/my-project"],
  );
});

test("不可用的工作区与非设计会话都不扫", () => {
  const sources = designLibrarySources({
    workspaces: [workspace({ id: "gone", availability: "missing" })],
    sessions: [
      session({ id: "coding", workbenchId: "code", runtimeRootPath: "/sp/code" }),
      session({ id: "canvas", workbenchId: "media-canvas", runtimeRootPath: "/sp/canvas" }),
      session({ id: "design", runtimeRootPath: "/sp/design" }),
    ],
  });

  assert.deepEqual(
    sources.map((source) => source.key),
    ["session:design"],
  );
});

test("会话根有上限,取最近的那些 —— 每扫一个根都是一次递归遍历", () => {
  const sessions = Array.from({ length: DESIGN_LIBRARY_SESSION_LIMIT + 5 }, (_value, index) =>
    session({ id: `s${index}`, title: `S${index}`, runtimeRootPath: `/sp/s${index}`, updatedAt: index }),
  );

  const sources = designLibrarySources({ workspaces: [], sessions });

  const sessionSources = sources.filter((source) => source.kind === "session");
  assert.equal(sessionSources.length, DESIGN_LIBRARY_SESSION_LIMIT);
  // 最新的在最前,旧的被砍掉 —— 被砍的是 `updatedAt` 最小的那五个。
  assert.equal(sessionSources[0]?.key, `session:s${DESIGN_LIBRARY_SESSION_LIMIT + 4}`);
  assert.equal(sources.some((source) => source.key === "session:s0"), false);
});

test("缺席的输入不算错:没有工作区、没有会话就是没有根可扫", () => {
  assert.deepEqual(designLibrarySources({ workspaces: undefined, sessions: undefined }), []);
  assert.deepEqual(designLibrarySources({ workspaces: [], sessions: [] }), []);
});

test("没有标题的会话用 id 片段当名字,不当成空标签", () => {
  const sources = designLibrarySources({
    workspaces: [],
    sessions: [session({ id: "5deacdf1-94d6-4533-8cb3-100ee1f50c25", title: "  " })],
  });

  assert.equal(sources[0]?.name, "5deacdf1");
});
