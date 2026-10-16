import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_ROUND_SOURCE,
  isKnowledgeRound,
  isKnowledgeRoundOfLibrary,
  knowledgeRoundSessionsForLibrary,
} from "@wordless/domain";

/**
 * "哪些会话是加工轮次、以及它属于哪个库" —— 侧边栏、知识库页、用量三处共用这一个判据。
 *
 * 它错了不会报错,只会让列表里悄悄多几行/少几行,或者让某个库的页面上出现**别的库**的数字。
 * 所以判据本身必须有测试。
 */

const LIBRARY = "/kb/知识库";
const OTHER_LIBRARY = "/kb/工作";

const round = (id: string, libraryRoot = LIBRARY, updatedAt = 1) => ({
  id,
  source: KNOWLEDGE_ROUND_SOURCE,
  runtimeRootPath: libraryRoot,
  updatedAt,
});

describe("加工轮次的判据", () => {
  it("带轮次标记的才是轮次", () => {
    assert.equal(isKnowledgeRound({ source: KNOWLEDGE_ROUND_SOURCE }), true);
  });

  it("用户自己从新建页起的知识库会话不是轮次(没有标记)", () => {
    // 这就是那个 bug 的形状:它与轮次共用 workbenchId、共用工具面,唯一差别是这个字段。
    assert.equal(isKnowledgeRound({ source: null }), false);
    assert.equal(isKnowledgeRound({ source: undefined }), false);
    assert.equal(isKnowledgeRound({}), false);
  });

  it("自动化任务起的不算轮次(标记是 automation)", () => {
    assert.equal(isKnowledgeRound({ source: "automation" }), false);
  });
});

describe("轮次属于哪个库", () => {
  it("按会话根认:会话根就是这个库的才算", () => {
    assert.equal(isKnowledgeRoundOfLibrary(round("r1"), LIBRARY), true);
    assert.equal(isKnowledgeRoundOfLibrary(round("r2", OTHER_LIBRARY), LIBRARY), false);
  });

  it("**用户自己的知识库会话即使会话根就是库,也不算轮次** —— 轮次由 source 认", () => {
    // 新建页那条路的会话根也是库(宿主注入的),所以"根相同"不足以说明它是轮次。
    const mine = { id: "mine", source: null, runtimeRootPath: LIBRARY, updatedAt: 9 };
    assert.equal(isKnowledgeRoundOfLibrary(mine, LIBRARY), false);
  });

  it("只列这个库的轮次,别的库的排除掉(多库时数字才对得上)", () => {
    const sessions = [round("a"), round("b", OTHER_LIBRARY, 5), round("c", LIBRARY, 3), { id: "chat", source: null, runtimeRootPath: LIBRARY }];
    assert.deepEqual(
      knowledgeRoundSessionsForLibrary(sessions, LIBRARY).map((session) => session.id),
      ["a", "c"],
    );
    assert.deepEqual(
      knowledgeRoundSessionsForLibrary(sessions, OTHER_LIBRARY).map((session) => session.id),
      ["b"],
    );
  });

  it("一个轮次都没有时是空数组,不是 undefined", () => {
    assert.deepEqual(knowledgeRoundSessionsForLibrary([], LIBRARY), []);
    assert.deepEqual(knowledgeRoundSessionsForLibrary([{ id: "chat", source: null, runtimeRootPath: LIBRARY }], LIBRARY), []);
  });
});
