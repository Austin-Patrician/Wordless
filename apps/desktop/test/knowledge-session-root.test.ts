import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { knowledgeSessionRootOption } from "../src/main/knowledge/knowledge-session-root.ts";
import { KNOWLEDGE_SESSION_ENTRY_ID } from "../src/main/knowledge/knowledge-session.ts";

/**
 * 渲染层建的"知识库整理"会话,会话根由宿主补上。
 *
 * 这条规则错了**不会报错**:会话照常建出来,只是根落在一个一次性临时目录,于是 agent 拿着
 * `raws/x.md` 去别处找、拿到 ENOENT(它明明照着说明书在做)。而"能写"会掩盖这件事 ——
 * `kb_write_page` 是宿主侧按配置的库解析的,所以症状是"半能用"。
 */

const knowledgeDraft = { entryId: KNOWLEDGE_SESSION_ENTRY_ID };

describe("给知识库会话补会话根", () => {
  it("知识库入口 → 根就是当前库", async () => {
    const option = await knowledgeSessionRootOption(knowledgeDraft, async () => "/kb/知识库");
    assert.deepEqual(option, { sessionRootPath: "/kb/知识库" });
  });

  it("别的入口一个字段都不加,而且**不去读库**", async () => {
    // 解析器要读文件系统(库清单就是目录)。普通会话不该为这个付一次 IO。
    let called = 0;
    for (const entryId of ["general-work", "code-development", "ui-design"]) {
      const option = await knowledgeSessionRootOption({ entryId }, async () => {
        called += 1;
        return "/kb/知识库";
      });
      assert.deepEqual(option, {}, entryId);
    }
    assert.equal(called, 0);
  });

  it("宿主没给解析器时不注入(测试、以及没有知识库的宿主)", async () => {
    assert.deepEqual(await knowledgeSessionRootOption(knowledgeDraft, undefined), {});
  });

  it("解析不出库时不注入 —— 空字符串不是根", async () => {
    // 宁可让它落到兜底目录(能跑起来、但读不到库),也不要把 "" 传下去当根。
    assert.deepEqual(await knowledgeSessionRootOption(knowledgeDraft, async () => undefined), {});
    assert.deepEqual(await knowledgeSessionRootOption(knowledgeDraft, async () => ""), {});
  });

  it("入口 id 与加工轮次那个工厂是同一个", () => {
    // 两处各写一份字面量的话,改了一处另一处会静默失效(注入不再发生,而没有任何报错)。
    assert.equal(KNOWLEDGE_SESSION_ENTRY_ID, "knowledge");
  });
});
