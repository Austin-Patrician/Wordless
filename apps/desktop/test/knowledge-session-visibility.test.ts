import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWLEDGE_ROUND_SOURCE, knowledgeRoundSessionsForLibrary } from "@wordless/domain";
import { knowledgeSessionRequest } from "../src/main/knowledge/knowledge-session.ts";
import { sidebarVisibleSessions } from "../src/renderer/features/workbench/sidebar-sessions.ts";

/**
 * 知识库会话出现在哪 —— **三条验收标准**。
 *
 *   1. 新建页那张"知识库整理"卡建的会话 → 进侧边栏;
 *   2. 知识库页"立即整理" → 不进侧边栏,但"最近整理"里能点开看;
 *   3. 定时整理 → 与手动同一条路(同一个工厂、同一个标记),同样不进侧边栏。
 *
 * 这里钉的不是某一个函数,而是**两条列表的关系**:它们是同一判据的两个方向,合起来必须
 * 不重不漏。只改一边就会破 —— 那正是这个 bug 的形状:侧边栏按 `workbenchId` 隐藏轮次,
 * 而新建页那张卡用的是同一个 `workbenchId`,于是用户的会话一起被藏了,还冒充一轮加工出现在
 * 知识库页里。
 *
 * 加工轮次那条记录**由真正的工厂产生**(`knowledgeSessionRequest` —— 定时、立即整理、归档
 * 三条路共用它),所以"工厂不再写标记"这类改动会让这里红。新建页那条没有工厂可借:它的草稿
 * 由渲染层直接给出,`WelcomeView.tsx` 不传 `source`(见 `packages/runtime` 的
 * `...(draft.source ? { source: draft.source } : {})`),所以这里如实写成 `null`。
 *
 * **两条路的会话根是同一个**(都是这个库:轮次由主进程直接传,新建页那条由宿主注入)——
 * 所以"根相同"区分不出它们,区分靠 `source` 标记。
 */

const LIBRARY = "/kb/知识库";
const OTHER_LIBRARY = "/kb/工作";

/** 一轮加工:草稿来自真工厂,`workbenchId` 由运行时按 entry 补上(见 BUILTIN_ENTRIES)。 */
function roundRecord(id: string, updatedAt: number, libraryRoot = LIBRARY) {
  const { draft } = knowledgeSessionRequest({
    bundleRoot: libraryRoot,
    modelKey: null,
    title: "整理一轮",
    messageId: "m1",
    submittedAt: updatedAt,
  });
  return { id, workbenchId: "knowledge", source: draft.source, runtimeRootPath: libraryRoot, updatedAt };
}

/** 新建页那张卡建的会话:同一个入口、同一个工作台、同一个会话根,只是没有轮次标记。 */
function welcomeRecord(id: string, updatedAt: number) {
  return { id, workbenchId: "knowledge", source: null, runtimeRootPath: LIBRARY, updatedAt };
}

describe("知识库会话出现在哪", () => {
  it("新建页建的 → 进侧边栏,不进加工轮次列表", () => {
    const mine = welcomeRecord("mine", 2);
    assert.deepEqual(sidebarVisibleSessions([mine]).map((session) => session.id), ["mine"]);
    assert.deepEqual(knowledgeRoundSessionsForLibrary([mine], LIBRARY), []);
  });

  it("加工轮次(立即整理 / 定时同一条路)→ 不进侧边栏,但在轮次列表里", () => {
    const round = roundRecord("round-1", 1);
    assert.equal(round.source, KNOWLEDGE_ROUND_SOURCE, "工厂必须写下轮次标记");
    assert.deepEqual(sidebarVisibleSessions([round]), []);
    assert.deepEqual(knowledgeRoundSessionsForLibrary([round], LIBRARY).map((session) => session.id), ["round-1"]);
  });

  it("两者共存时,两条列表互补:不重不漏", () => {
    const sessions = [roundRecord("round-1", 1), welcomeRecord("mine", 3), roundRecord("round-2", 2)];
    const sidebar = sidebarVisibleSessions(sessions).map((session) => session.id);
    const rounds = knowledgeRoundSessionsForLibrary(sessions, LIBRARY).map((session) => session.id);
    assert.deepEqual(sidebar, ["mine"]);
    assert.deepEqual(rounds, ["round-1", "round-2"]);
    // 交集为空、并集是全集 —— 一个会话不会同时出现在两处,也不会两处都不在。
    assert.equal(sidebar.some((id) => rounds.includes(id)), false);
    assert.deepEqual([...sidebar, ...rounds].sort(), sessions.map((session) => session.id).sort());
  });

  it("别的库的加工轮次两处都不出现 —— 它不属于这一页", () => {
    const mine = welcomeRecord("mine", 3);
    const theirs = roundRecord("other-round", 4, OTHER_LIBRARY);
    assert.deepEqual(sidebarVisibleSessions([mine, theirs]).map((session) => session.id), ["mine"]);
    assert.deepEqual(knowledgeRoundSessionsForLibrary([mine, theirs], LIBRARY), []);
  });
});
