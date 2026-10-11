import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { rawsResource } from "../src/main/knowledge/knowledge-diff.ts";
import { settleKnowledgeRound } from "../src/main/knowledge/knowledge-settle.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 一轮的收尾。
 *
 * 这是**已经出过事的那个洞**:失败对账以前只在"没有 agent 活"那条路上跑,于是会失败的那一轮
 * 从不记账 —— 日志写 `加工:+1`、库里 0 页,用户以为成功了。所以这里钉的不是"函数被调用了",
 * 而是**收尾之后能看见的三件事**:日志记的是产出、失败账本有那一笔、目录重建过。
 */

let directory = "";
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-settle-"));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

let counter = 0;
const service = () => new KnowledgeService(join(directory, `settle-${(counter += 1)}`), { stateDirectory: join(directory, "state") });

describe("收尾", () => {
  it("加工轮:日志记**产出**,失败账本记下没写成的那个", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "甲", "utf-8");
    await writeFile(join(kb.bundleRoot, "raws/b.pdf"), "乙", "utf-8");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");

    // agent 只写出了一个页(另一个它没写成)。
    await kb.writePage({
      path: "sources/a.md",
      type: "Source",
      title: "a",
      description: "甲的页。",
      tags: [],
      sources: [{ resource: rawsResource("a.pdf") }],
      body: "甲",
      by: "test",
      now: "2026-10-11T09:00:00Z",
      sourceHash: await kb.hashRawFile("a.pdf"),
    });

    await settleKnowledgeRound({ service: kb, kind: "process", needsAgent: true, plan, summary: "+2 ~0", now: "2026-10-11T09:00:00Z" });

    const log = await readFile(join(kb.bundleRoot, "log.md"), "utf-8");
    // 计划 2、写成 1、未成 1 —— 这一行是"到底成没成"的答案。
    assert.match(log, /写成 1 页,未成 1 页/);
    assert.match(log, /计划 \+2/);
    assert.doesNotMatch(log, /加工:\+2 ~0/, "不能只记计划");
    // 没写成的那个被记了一笔(界面据此显示"加工失败"的那一栏)。
    assert.deepEqual(Object.keys((await kb.readFailures()).entries), ["b.pdf"]);
    // 目录重建过:那一页出现在 index.md 里。
    assert.match(await readFile(join(kb.bundleRoot, "index.md"), "utf-8"), /a/);
  });

  it("只有工程动作的轮次:没有产出可言,但日志说清做了什么", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "甲", "utf-8");
    await kb.writePage({
      path: "sources/a.md",
      type: "Source",
      title: "a",
      description: "甲的页。",
      tags: [],
      sources: [{ resource: rawsResource("a.pdf") }],
      body: "甲",
      by: "test",
      now: "2026-10-10T09:00:00Z",
      sourceHash: await kb.hashRawFile("a.pdf"),
    });

    // 删掉原文 → 这一轮只有"标孤儿"这个工程动作。
    await rm(join(kb.bundleRoot, "raws/a.pdf"));
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.equal(plan.needsProcessing, false);

    const result = await settleKnowledgeRound({ service: kb, kind: "process", needsAgent: false, plan, summary: "+0 ~0", now: "2026-10-11T09:00:00Z" });

    assert.equal(result, null, "没跑 agent 就没有产出");
    const log = await readFile(join(kb.bundleRoot, "log.md"), "utf-8");
    assert.match(log, /删除 1/);
    assert.doesNotMatch(log, /写成/, "说「写成 0 页」会让一件正常的事看起来像失败");
    assert.deepEqual(Object.keys((await kb.readFailures()).entries), [], "工程动作不产生失败记录");
  });

  it("体检轮:记体检摘要,不碰失败账本", async () => {
    const kb = service();
    await kb.ensureBundle();
    await settleKnowledgeRound({ service: kb, kind: "lint", needsAgent: true, plan: null, summary: "死链 2", now: "2026-10-11T09:00:00Z" });
    const log = await readFile(join(kb.bundleRoot, "log.md"), "utf-8");
    assert.match(log, /体检:死链 2/);
  });
});
