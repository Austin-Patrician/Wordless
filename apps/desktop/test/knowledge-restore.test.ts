import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { rawsResource } from "../src/main/knowledge/knowledge-diff.ts";
import { parseKnowledgePage } from "../src/main/knowledge/knowledge-schema.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 宽限期的后路:**把一页从"待回收"里救回来**。
 *
 * 设计里给孤儿留了一轮宽限期(下一轮才真删),但界面上看不见它的话那条后路就走不通 ——
 * 用户救不了一个看不见的东西。所以这一层要同时管两头:
 *   - **看得见**:待回收的页要出现在列表里(界面上那一组);
 *   - **救得回**:而且救回来之后要**顶住下一轮** —— 只清标记是不够的。
 */

let directory = "";
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-restore-"));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

let counter = 0;
const service = () => new KnowledgeService(join(directory, `restore-${(counter += 1)}`), { stateDirectory: join(directory, "state") });

/** 一份原文 + 一个源页(可指定是否复核)。 */
async function bundleWithPage(options: { verified?: boolean } = {}): Promise<KnowledgeService> {
  const kb = service();
  await kb.ensureBundle();
  await writeFile(join(kb.bundleRoot, "raws/health.md"), "原文", "utf-8");
  await kb.writePage({
    path: "sources/health.md",
    type: "Source",
    title: "健康问答",
    description: "一份问答。",
    tags: [],
    sources: [{ resource: rawsResource("health.md") }],
    body: "正文。",
    by: "test",
    now: "2026-10-11T09:00:00Z",
    sourceHash: await kb.hashRawFile("health.md"),
  });
  if (options.verified === true) await kb.setPageVerification("sources/health.md", true, "2026-10-11T09:00:00Z");
  return kb;
}

const pageOf = async (kb: KnowledgeService, path: string) => {
  const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, path), "utf-8"));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.page;
};

describe("原文被删:标孤儿 → 看得见 → 救得回", () => {
  it("待回收的页在快照里**列得出来**,而且说得出为什么", async () => {
    const kb = await bundleWithPage();
    await rm(join(kb.bundleRoot, "raws/health.md"));
    await kb.prepareRound("2026-10-11T10:00:00Z");

    const snapshot = await kb.snapshot();
    const orphaned = snapshot.pages.filter((page) => page.orphaned);
    assert.deepEqual(orphaned.map((page) => page.path), ["sources/health.md"]);
    // 界面靠这个字段分清"被退役"还是"原文已删" —— 两者该做的事不同。
    assert.equal(orphaned[0]!.status, "deprecated");
  });

  it("**保留**之后,下一轮不再被标回来(只清标记是不够的)", async () => {
    const kb = await bundleWithPage();
    await rm(join(kb.bundleRoot, "raws/health.md"));
    await kb.prepareRound("2026-10-11T10:00:00Z");

    await kb.restorePage("sources/health.md", "2026-10-11T10:05:00Z");
    const restored = await pageOf(kb, "sources/health.md");
    // 三件事是一句话:"这一页我要留着"。
    assert.equal(restored.private?.orphaned_at, undefined, "不再是待回收的");
    assert.equal(restored.status, undefined, "退役是被回收的理由,留着它自相矛盾");
    assert.equal(restored.verified?.by, "human:local", "人工背书 —— 这才是让它顶住下一轮的机制");

    // 关键:再跑一轮,它**不该**又被标成孤儿。
    const next = await kb.prepareRound("2026-10-11T11:00:00Z");
    assert.deepEqual((await kb.snapshot()).pages.filter((page) => page.orphaned), []);
    // 也不该再催 agent 去合并/重指 —— 用户已经说了要留着它。
    assert.deepEqual(next.diff.deleted, []);
  });

  it("**不**保留的话,宽限期一过就被回收(后路是有限期的)", async () => {
    const kb = await bundleWithPage();
    await rm(join(kb.bundleRoot, "raws/health.md"));
    await kb.prepareRound("2026-10-11T10:00:00Z");
    // 下一轮:上一轮标的孤儿到期 → 回收。
    const plan = await kb.prepareRound("2026-10-11T11:00:00Z");
    assert.deepEqual(plan.reaped.map((entry) => entry.pagePath), ["sources/health.md"]);
    assert.deepEqual((await kb.snapshot()).pages, []);
  });
});

describe("被退役的重复页", () => {
  it("救回来之后是**活页**(不再是退役状态)", async () => {
    const kb = await bundleWithPage();
    // 复刻现场:agent 把重复页退役了(标 deprecated + 孤儿)。
    await writeFile(
      join(kb.bundleRoot, "sources/duplicate.md"),
      [
        "---",
        "type: Source",
        "title: 重复页",
        "description: 同一份原文的另一份转写。",
        "tags: []",
        "status: deprecated",
        "sources:",
        "  - resource: /raws/health.md",
        "generated:",
        "  by: wordless-agent/knowledge",
        "  at: 2026-10-11T10:00:00Z",
        "x-wordless:",
        `  source_hash: ${await kb.hashRawFile("health.md")}`,
        "  orphaned_at: 2026-10-11T10:00:00Z",
        "---",
        "",
        "正文。",
        "",
      ].join("\n"),
      "utf-8",
    );
    assert.deepEqual((await kb.snapshot()).pages.filter((page) => page.orphaned).map((page) => page.path), ["sources/duplicate.md"]);

    await kb.restorePage("sources/duplicate.md", "2026-10-11T10:05:00Z");
    const restored = await pageOf(kb, "sources/duplicate.md");
    assert.equal(restored.status, undefined);
    assert.equal(restored.verified?.by, "human:local");
    // 原文还在,所以它照常是"已加工"的那一页 —— 和另一页并存(用户要的就是两页都留)。
    const snapshot = await kb.snapshot();
    assert.equal(snapshot.pages.filter((page) => page.orphaned).length, 0);
    assert.equal(snapshot.pages.length, 2);
  });
});

describe("立即删除(不等宽限期)", () => {
  it("走的是**回收同一个实现** —— 别处对它的来源引用会被摘掉", async () => {
    const kb = await bundleWithPage();
    // 一个概念页综合了这份原文 —— 回收时它的来源该被摘掉,而不是整页消失。
    await kb.writePage({
      path: "concepts/健康.md",
      type: "Concept",
      title: "健康",
      description: "综合页。",
      tags: [],
      sources: [{ resource: rawsResource("health.md") }],
      body: "正文。",
      by: "test",
      now: "2026-10-11T09:00:00Z",
    });
    await rm(join(kb.bundleRoot, "raws/health.md"));
    await kb.prepareRound("2026-10-11T10:00:00Z"); // 源页标孤儿

    await kb.deleteOrphanNow("sources/health.md", "2026-10-11T10:05:00Z");
    // 源页没了。
    await assert.rejects(() => readFile(join(kb.bundleRoot, "sources/health.md"), "utf-8"));
    // 概念页还在,只是少了一条来源 —— "摘引用不删整页"。
    const concept = await pageOf(kb, "concepts/健康.md");
    assert.deepEqual(concept.sources, undefined);
    assert.equal((await kb.snapshot()).pages.filter((page) => page.orphaned).length, 0);
  });

  it("复核过的一律不删(与定时回收同一道闸)", async () => {
    const kb = await bundleWithPage({ verified: true });
    await rm(join(kb.bundleRoot, "raws/health.md"));
    await kb.prepareRound("2026-10-11T10:00:00Z");
    // 先复核的页不会被标孤儿,所以它压根不在"待回收"里 —— 那道闸在下面这条上。
    await assert.rejects(
      () => kb.deleteOrphanNow("sources/health.md", "2026-10-11T10:05:00Z"),
      /不是待回收的页/,
    );
  });

  it("不是待回收的页不给删 —— 破坏性动作挡在服务里,不只靠界面", async () => {
    const kb = await bundleWithPage();
    await assert.rejects(
      () => kb.deleteOrphanNow("sources/health.md", "2026-10-11T10:05:00Z"),
      /不是待回收的页/,
    );
    // 页还在。
    assert.equal((await readFile(join(kb.bundleRoot, "sources/health.md"), "utf-8")).length > 0, true);
  });
});

describe("清空整理结果(保留原始文件)", () => {
  it("只清派生物:raws 一根不动,目录与时间线也清掉", async () => {
    const kb = await bundleWithPage();
    await kb.rebuildIndex();
    await kb.appendLog({ at: "2026-10-11T09:00:00Z", kind: "Creation", text: "加工:+1" });
    await kb.writePage({
      path: "concepts/健康.md",
      type: "Concept",
      title: "健康",
      description: "综合页。",
      tags: [],
      sources: [{ resource: rawsResource("health.md") }],
      body: "正文。",
      by: "test",
      now: "2026-10-11T09:00:00Z",
    });

    const plan = await kb.clearPlan();
    assert.deepEqual(plan, { pages: 2, withoutRaw: 0, verified: 0 });

    await kb.clearDerivedPages();
    // 派生物没了。
    assert.deepEqual((await kb.snapshot()).pages, []);
    await assert.rejects(() => readFile(join(kb.bundleRoot, "index.md"), "utf-8"));
    await assert.rejects(() => readFile(join(kb.bundleRoot, "log.md"), "utf-8"));
    // **原件一根不动** —— 这是它与"删库"的分界线。
    assert.deepEqual(await kb.listRawFiles(), ["health.md"]);
    // 而且下一轮会把它重新加工(它变成"新增")。
    const next = await kb.prepareRound("2026-10-11T10:00:00Z");
    assert.deepEqual(next.diff.added.map((raw) => raw.path), ["health.md"]);
  });

  it("先看再清:**没有原文**与**人工复核过**的页要报出来", async () => {
    const kb = await bundleWithPage({ verified: true });
    // 一页导入来的:来源指向一份不存在的原文 —— 清掉就真的没了。
    await kb.writePage({
      path: "concepts/外来的.md",
      type: "Concept",
      title: "外来的",
      description: "从别人的库导进来的。",
      tags: [],
      sources: [{ resource: "/raws/不存在.pdf" }],
      body: "正文。",
      by: "import",
      now: "2026-10-11T09:00:00Z",
    });

    const plan = await kb.clearPlan();
    assert.deepEqual(plan, { pages: 2, withoutRaw: 1, verified: 1 });
  });
});
