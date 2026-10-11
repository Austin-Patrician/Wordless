import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { diffKnowledge, isDiffEmpty, diffNeedsProcessing, planOrphanReaping, rawsResource, withoutSourceReference } from "../src/main/knowledge/knowledge-diff.ts";
import { KNOWLEDGE_MAX_ATTEMPTS, applyQuarantine, normalizeKnowledgeFailures, quarantinedPaths, reconcileFailures } from "../src/main/knowledge/knowledge-failures.ts";
import { buildKnowledgeRoundPrompt } from "../src/main/knowledge/knowledge-round-prompt.ts";
import { parseKnowledgePage } from "../src/main/knowledge/knowledge-schema.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 增量加工。
 *
 * 这一层验的是 P2 的验收标准:**改一个文件 → 只有对应的一页变;删一个文件 → 那一页先变成
 * 孤儿、下一轮才被回收,而且别处对它的引用被摘掉而不是整页删**。
 *
 * 最贵的一类错是"判定顺序错了":把移动当成"删了再建"会白烧一轮 token,把修改当成新文件
 * 会让同一份资料留下两页。所以顺序(同路径同内容 → 同内容换路径 → 同路径换内容 → 新增 → 删除)
 * 在这里被逐趟钉住。
 */

let directory = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-round-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const sourcePage = (pagePath: string, resource: string, hash: string, orphanedAt: string | null = null) => ({ pagePath, resource, hash, orphanedAt });
const raw = (path: string, hash: string) => ({ path, resource: rawsResource(path), hash });

describe("五趟配对:判定顺序就是语义", () => {
  it("同路径同内容 → 什么都没变(不重加工)", () => {
    const diff = diffKnowledge([sourcePage("sources/a.md", "/raws/a.pdf", "h1")], [raw("a.pdf", "h1")]);
    assert.equal(isDiffEmpty(diff), true);
    assert.equal(diffNeedsProcessing(diff), false);
  });

  it("同内容换路径 → 移动:纯元数据,**不烧 token**", () => {
    const diff = diffKnowledge([sourcePage("sources/a.md", "/raws/旧名.pdf", "h1")], [raw("新名.pdf", "h1")]);
    assert.deepEqual(diff.moved, [{ pagePath: "sources/a.md", from: "/raws/旧名.pdf", to: "/raws/新名.pdf" }]);
    assert.equal(diff.added.length, 0, "移动不该被判成新增");
    assert.equal(diffNeedsProcessing(diff), false, "移动不需要 agent");
  });

  it("同路径换内容 → 修改:带着旧页路径,就地更新", () => {
    const diff = diffKnowledge([sourcePage("sources/a.md", "/raws/a.pdf", "h1")], [raw("a.pdf", "h2")]);
    assert.deepEqual(diff.changed, [{ pagePath: "sources/a.md", resource: "/raws/a.pdf", oldHash: "h1", newHash: "h2" }]);
    assert.equal(diffNeedsProcessing(diff), true);
  });

  it("新文件 → 新增;消失的文件 → 标孤儿", () => {
    const diff = diffKnowledge(
      [sourcePage("sources/旧的.md", "/raws/旧的.pdf", "h1")],
      [raw("新的.pdf", "h2")],
    );
    assert.deepEqual(diff.added.map((entry) => entry.path), ["新的.pdf"]);
    assert.deepEqual(diff.deleted.map((entry) => entry.pagePath), ["sources/旧的.md"]);
  });

  it("既改名又改内容 → 新增 + 删除(不是「移动」)", () => {
    // 内容变了就没有"同一个文件"的证据了 —— 当成新文件是唯一诚实的判断。
    const diff = diffKnowledge([sourcePage("sources/a.md", "/raws/a.pdf", "h1")], [raw("b.pdf", "h2")]);
    assert.equal(diff.moved.length, 0);
    assert.deepEqual(diff.added.map((entry) => entry.path), ["b.pdf"]);
    assert.deepEqual(diff.deleted.map((entry) => entry.pagePath), ["sources/a.md"]);
  });

  it("同一份内容在两个路径 → 两页各自独立(不能互相吞掉)", () => {
    // 用户把同一份文件拷了一份做备份。按 hash 配对会把它判成"移动",于是更新一页、删掉另一页,
    // 下一轮另一条路径又变成"新增" —— 无限重加工。
    const diff = diffKnowledge(
      [sourcePage("sources/原件.md", "/raws/原件.pdf", "h1"), sourcePage("sources/备份.md", "/raws/备份.pdf", "h1")],
      [raw("原件.pdf", "h1"), raw("备份.pdf", "h1")],
    );
    assert.equal(isDiffEmpty(diff), true, "两条路径都还在、内容都没变,就不该有任何动作");
  });

  it("已标孤儿的页不参与匹配 —— 否则用户把文件放回来会变成莫名其妙的「移动」", () => {
    const diff = diffKnowledge([sourcePage("sources/a.md", "/raws/a.pdf", "h1", "2026-01-01T00:00:00Z")], [raw("a.pdf", "h1")]);
    assert.deepEqual(diff.added.map((entry) => entry.path), ["a.pdf"]);
    assert.equal(diff.moved.length, 0);
  });
});

describe("孤儿回收(n+1)", () => {
  it("只有**上一轮或更早**标的孤儿才被回收,本轮标的不动", () => {
    const prior = [
      sourcePage("sources/上轮.md", "/raws/上轮.pdf", "h1", "2026-10-10T09:00:00Z"),
      sourcePage("sources/本轮.md", "/raws/本轮.pdf", "h2", "2026-10-11T09:00:00Z"),
    ];
    const due = planOrphanReaping(prior, "2026-10-11T09:00:00Z");
    assert.deepEqual(due.map((page) => page.pagePath), ["sources/上轮.md"], "本轮刚标的还在宽限期里");
  });

  it("摘引用不删整页:一个概念页综合了五份资料,少一份不该整页消失", () => {
    const page = {
      type: "Concept" as const,
      title: "流程",
      description: "x",
      tags: [],
      sources: [{ resource: "/raws/a.pdf" }, { resource: "/raws/b.pdf" }],
    };
    const kept = withoutSourceReference(page, "/raws/a.pdf");
    assert.equal(kept.removed, true);
    assert.deepEqual(kept.page.sources, [{ resource: "/raws/b.pdf" }]);
    assert.equal(kept.empty, false);

    const last = withoutSourceReference({ ...page, sources: [{ resource: "/raws/a.pdf" }] }, "/raws/a.pdf");
    assert.equal(last.empty, true, "最后一条来源也没了 → 报出来给人看,而不是自动删页");

    const untouched = withoutSourceReference(page, "/raws/别的.pdf");
    assert.equal(untouched.removed, false);
    assert.equal(untouched.page, page);
  });
});

describe("失败隔离:止损", () => {
  const hash = (path: string, value: string) => new Map([[path, value]]);

  it("连续失败到阈值就隔离", () => {
    let failures = normalizeKnowledgeFailures(undefined);
    for (let attempt = 1; attempt <= KNOWLEDGE_MAX_ATTEMPTS; attempt += 1) {
      failures = reconcileFailures({
        failures,
        attempted: [{ path: "硬骨头.pdf", hash: "h1" }],
        present: new Map(),
        current: hash("硬骨头.pdf", "h1"),
        now: `2026-10-1${attempt}T00:00:00Z`,
      });
    }
    assert.equal(failures.entries["硬骨头.pdf"]!.attempts, KNOWLEDGE_MAX_ATTEMPTS);
    assert.equal(failures.entries["硬骨头.pdf"]!.quarantined, true);
    assert.equal(quarantinedPaths(failures, hash("硬骨头.pdf", "h1")).has("硬骨头.pdf"), true);
  });

  it("内容一变自动重试 —— 隔离不是永久判决", () => {
    const failures = normalizeKnowledgeFailures({
      entries: { "改了.pdf": { hash: "old", attempts: 3, quarantined: true, firstFailedAt: "", lastFailedAt: "" } },
    });
    assert.equal(quarantinedPaths(failures, hash("改了.pdf", "old")).has("改了.pdf"), true);
    assert.equal(quarantinedPaths(failures, hash("改了.pdf", "new")).has("改了.pdf"), false, "内容变了就该重新试");
  });

  it("写出页就清记录;文件被删了也不再记账", () => {
    const failures = normalizeKnowledgeFailures({
      entries: { "a.pdf": { hash: "h1", attempts: 2, quarantined: false, firstFailedAt: "", lastFailedAt: "" } },
    });
    const cleared = reconcileFailures({
      failures,
      attempted: [{ path: "a.pdf", hash: "h1" }],
      present: new Map([["a.pdf", "h1"]]),
      current: hash("a.pdf", "h1"),
      now: "2026-10-11T00:00:00Z",
    });
    assert.equal(cleared.entries["a.pdf"], undefined);

    const deleted = reconcileFailures({
      failures,
      attempted: [{ path: "a.pdf", hash: "h1" }],
      present: new Map(),
      current: new Map(),
      now: "2026-10-11T00:00:00Z",
    });
    assert.equal(deleted.entries["a.pdf"], undefined);
  });

  it("隔离的文件从待办里剔掉,但要如实报出来", () => {
    const diff = diffKnowledge([], [raw("坏.pdf", "h1"), raw("好.pdf", "h2")]);
    const gated = applyQuarantine(diff, new Set(["坏.pdf"]));
    assert.deepEqual(gated.diff.added.map((entry) => entry.path), ["好.pdf"]);
    assert.deepEqual(gated.skipped.map((entry) => entry.path), ["坏.pdf"]);
  });
});

describe("一轮真跑:改一个文件,只有对应的一页变", () => {
  let counter = 0;
  const service = () => new KnowledgeService(join(directory, `round-${(counter += 1)}`), { stateDirectory: join(directory, "state") });

  /** 走一遍"投递文件 → 写源页"的正常路径。 */
  async function ingest(kb: KnowledgeService, rawName: string, content: string, pagePath: string, now: string): Promise<void> {
    await writeFile(join(kb.bundleRoot, "raws", rawName), content, "utf-8");
    await kb.writePage({
      path: pagePath,
      type: "Source",
      title: rawName,
      description: `${rawName} 的页。`,
      tags: [],
      sources: [{ resource: rawsResource(rawName) }],
      body: content,
      by: "test",
      now,
      sourceHash: await kb.hashRawFile(rawName),
    });
  }

  it("**最后一条**来源被摘掉时要真的摘掉(省略的语义是「保留」,会把它装回去)", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "甲", "utf-8");
    // 先有一个源页(只有源页代表原始文件,所以只有它会被标孤儿 —— 回收也由它触发)。
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
    // 再有一个概念页,它**只有这一条**来源。
    await kb.writePage({
      path: "concepts/唯一.md",
      type: "Concept",
      title: "唯一",
      description: "只综合了一份。",
      tags: [],
      sources: [{ resource: rawsResource("a.pdf") }],
      body: "正文。",
      by: "test",
      now: "2026-10-10T09:00:00Z",
    });
    await rm(join(kb.bundleRoot, "raws/a.pdf"));
    await kb.prepareRound("2026-10-11T09:00:00Z"); // 标孤儿
    await kb.prepareRound("2026-10-12T09:00:00Z"); // 回收 + 摘引用

    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/唯一.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    // 页还在(摘引用不删整页),但它确实没有来源了。
    assert.equal(parsed.page.sources, undefined);
  });

  it("没动过 → 空轮(不起会话)", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.equal(plan.empty, true);
    assert.equal(plan.needsProcessing, false);
  });

  it("改内容 → 只有那一页要更新", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");
    await ingest(kb, "b.pdf", "另一份", "sources/b.md", "2026-10-10T09:00:00Z");

    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "改过了", "utf-8");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.deepEqual(plan.diff.changed.map((change) => change.pagePath), ["sources/a.md"]);
    assert.equal(plan.diff.added.length, 0);
    assert.deepEqual(plan.attempted.map((file) => file.path), ["a.pdf"]);
  });

  it("轮末对账说出**实际**写成了什么 —— 没写成就是没写成", async () => {
    const kb = service();
    await kb.ensureBundle();
    // 两个新文件,但只给其中一个写出页。
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "甲", "utf-8");
    await writeFile(join(kb.bundleRoot, "raws/b.pdf"), "乙", "utf-8");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.deepEqual(plan.attempted.map((file) => file.path).sort(), ["a.pdf", "b.pdf"]);

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

    const result = await kb.finishRound(plan, "2026-10-11T09:00:00Z");
    // 这就是"计划 2 页、实际 1 页"的答案 —— 以前没有任何地方算得出来,日志只报计划。
    assert.deepEqual(result.written, ["a.pdf"]);
    assert.deepEqual(result.failed, ["b.pdf"]);
    assert.deepEqual(result.gone, []);
    // 与失败账本同源:没写成的那个确实被记了一笔。
    assert.deepEqual(Object.keys((await kb.readFailures()).entries), ["b.pdf"]);
  });

  it("原文已被删除的不算失败 —— 它走孤儿回收", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "甲", "utf-8");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    await rm(join(kb.bundleRoot, "raws/a.pdf"));

    const result = await kb.finishRound(plan, "2026-10-11T09:00:00Z");
    assert.deepEqual(result.written, []);
    assert.deepEqual(result.failed, [], "文件没了不是「写不出来」");
    assert.deepEqual(result.gone, ["a.pdf"]);
    assert.deepEqual(Object.keys((await kb.readFailures()).entries), [], "也不该占着失败账本");
  });

  it("移动文件 → 只改元数据,页面还在原处、不需要 agent", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");

    await rename(join(kb.bundleRoot, "raws/a.pdf"), join(kb.bundleRoot, "raws/改名了.pdf"));
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");

    assert.deepEqual(plan.diff.moved.map((move) => move.to), ["/raws/改名了.pdf"]);
    assert.equal(plan.needsProcessing, false, "移动不该烧 token");
    // 页面就地更新:路径没变,来源变了。
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "sources/a.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.page.sources, [{ resource: "/raws/改名了.pdf" }]);
    // 下一轮就是空轮了。
    assert.equal((await kb.prepareRound("2026-10-11T10:00:00Z")).empty, true);
  });

  it("删文件 → 先标孤儿(宽限期),下一轮才回收", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");

    await rm(join(kb.bundleRoot, "raws/a.pdf"));
    const first = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.deepEqual(first.diff.deleted.map((entry) => entry.pagePath), ["sources/a.md"]);
    assert.equal(first.reaped.length, 0, "本轮刚标的还在宽限期里");

    // 页还在,只是被标成了孤儿。
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "sources/a.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.page.status, "deprecated");
    assert.equal(parsed.page.private?.orphaned_at, "2026-10-11T09:00:00Z");

    // 下一轮:回收它。
    const second = await kb.prepareRound("2026-10-12T09:00:00Z");
    assert.deepEqual(second.reaped.map((entry) => entry.pagePath), ["sources/a.md"]);
    await assert.rejects(() => readFile(join(kb.bundleRoot, "sources/a.md"), "utf-8"));
  });

  it("回收孤儿时,概念页只被摘掉那一条来源,不整页消失", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "甲", "sources/a.md", "2026-10-10T09:00:00Z");
    await ingest(kb, "b.pdf", "乙", "sources/b.md", "2026-10-10T09:00:00Z");
    await kb.writePage({
      path: "concepts/综合.md",
      type: "Concept",
      title: "综合",
      description: "综合两份资料。",
      tags: [],
      sources: [{ resource: "/raws/a.pdf" }, { resource: "/raws/b.pdf" }],
      body: "正文。",
      by: "test",
      now: "2026-10-10T09:00:00Z",
    });

    await rm(join(kb.bundleRoot, "raws/a.pdf"));
    await kb.prepareRound("2026-10-11T09:00:00Z"); // 标孤儿
    await kb.prepareRound("2026-10-12T09:00:00Z"); // 回收 + 摘引用

    const concept = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/综合.md"), "utf-8"));
    assert.equal(concept.ok, true, "概念页不该被删掉");
    if (!concept.ok) return;
    assert.deepEqual(concept.page.sources, [{ resource: "/raws/b.pdf" }]);
    assert.equal(concept.body, "正文。", "正文不该被动");
  });

  it("失败的账本落在 bundle 之外 —— 知识库保持是能带走的纯内容", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");
    // 故意制造一次失败:文件在,但页没写出来。
    await kb.writeFailures(normalizeKnowledgeFailures({ entries: {} }));
    const raws = await kb.listRawFiles();
    assert.deepEqual(raws, ["a.pdf"]);
    // bundle 里除了内容什么都没有 —— 特别是**没有失败账本**。
    // (`index.md` / `log.md` 要等重建/追加才出现,所以这里只断言目录与"没有多余的文件"。)
    const entries = await readdir(kb.bundleRoot);
    assert.deepEqual(entries.filter((name) => name.endsWith(".json")), [], "bundle 里不该有机器文件");
    assert.deepEqual(entries.sort(), ["concepts", "entities", "raws", "sources"]);
  });
});

describe("每轮预算:卡在能算准的那个量上", () => {
  let counter = 0;
  const budgeted = (files: number) =>
    new KnowledgeService(join(directory, `budget-${(counter += 1)}`), { stateDirectory: join(directory, "state"), readBudget: () => files });

  /** 往投递箱里丢 N 个没加工过的文件。 */
  async function drop(kb: KnowledgeService, count: number): Promise<void> {
    for (let index = 1; index <= count; index += 1) {
      await writeFile(join(kb.bundleRoot, "raws", `f${index}.pdf`), `内容 ${index}`, "utf-8");
    }
  }

  it("超出上限的文件留给下一轮,而且**不需要游标**", async () => {
    const kb = budgeted(3);
    await kb.ensureBundle();
    await drop(kb, 5);

    const first = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.equal(first.diff.added.length, 3);
    assert.equal(first.deferred, 2);

    // agent 把交给它的那 3 个写成了页(测试里手动模拟这一步)。
    for (const raw of first.diff.added) {
      await kb.writePage({
        path: `sources/${raw.path.replace(/\.pdf$/, "")}.md`,
        type: "Source",
        title: raw.path,
        description: "x",
        tags: [],
        sources: [{ resource: raw.resource }],
        body: "正文。",
        by: "test",
        now: "2026-10-11T09:30:00Z",
        sourceHash: raw.hash,
      });
    }

    // 下一轮:剩下的仍然是"新增" —— **diff 自己就是游标**,不需要任何进度记录。
    const second = await kb.prepareRound("2026-10-11T10:00:00Z");
    assert.equal(second.diff.added.length, 2);
    assert.equal(second.deferred, 0);
  });

  it("预算在 added 与 changed 之间统一算,不是各算一份", async () => {
    const kb = budgeted(2);
    await kb.ensureBundle();
    // 一个已加工的(将被改动)+ 两个新的。
    await writeFile(join(kb.bundleRoot, "raws/old.pdf"), "旧内容", "utf-8");
    await kb.writePage({
      path: "sources/old.md", type: "Source", title: "old", description: "x", tags: [],
      sources: [{ resource: rawsResource("old.pdf") }], body: "旧内容", by: "test", now: "2026-10-10T09:00:00Z",
      sourceHash: await kb.hashRawFile("old.pdf"),
    });
    await writeFile(join(kb.bundleRoot, "raws/old.pdf"), "新内容", "utf-8");
    await drop(kb, 2);

    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.equal(plan.diff.added.length + plan.diff.changed.length, 2, "added 与 changed 合起来不超过上限");
    assert.equal(plan.deferred, 1);
  });

  it("不限(0)时全部一次交给 agent", async () => {
    const kb = budgeted(0);
    await kb.ensureBundle();
    await drop(kb, 7);
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.equal(plan.diff.added.length, 7);
    assert.equal(plan.deferred, 0);
  });
});

describe("任务清单要给对东西(来自一次真实的失败会话)", () => {
  /**
   * 2026-10-11 那轮:sources/营养与饮食健康问答.md 留下 `source_hash: ""`。
   * 根因不在 agent,在**这份清单**:它只给了 `/raws/health.md` 这个 resource 形状,
   * 既没给 hash,路径形状也不是文件工具能读的。agent 的日志是证据 ——
   *   read /raws/health.md → ENOENT;ls /raws → ENOENT;靠 find 自己找回来;
   *   "no hash was given to me this session";"the tool accepted a dummy hash without validating it"。
   */
  it("新增文件:给**可读路径**(不带前导斜杠)与**真实 hash**", async () => {
    const kb = new KnowledgeService(join(directory, "prompt-added"), { stateDirectory: join(directory, "state") });
    await kb.ensureBundle();
    await writeFile(join(kb.bundleRoot, "raws/health.md"), "原文", "utf-8");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");

    const prompt = buildKnowledgeRoundPrompt(plan);
    const hash = await kb.hashRawFile("health.md");
    // 文件工具的路径是会话根相对的:前导斜杠会被当成文件系统绝对路径。
    assert.match(prompt, /- raws\/health\.md\(source_hash=/);
    assert.doesNotMatch(prompt, /- \/raws\//, "清单里不能出现 /raws/… —— read 会拿它当绝对路径");
    assert.match(prompt, new RegExp(hash), "hash 必须给出来:agent 没有 bash,算不出 sha256");
    // 而且要说明这个值该传到哪里。
    assert.match(prompt, /sourceHash/);
  });

  it("内容变更:给**新** hash,并指出要更新哪一页", async () => {
    const kb = new KnowledgeService(join(directory, "prompt-changed"), { stateDirectory: join(directory, "state") });
    await kb.ensureBundle();
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "甲", "utf-8");
    await kb.writePage({
      path: "sources/a.md",
      type: "Source",
      title: "甲",
      description: "甲的页。",
      tags: [],
      sources: [{ resource: rawsResource("a.pdf") }],
      body: "甲",
      by: "test",
      now: "2026-10-10T09:00:00Z",
      sourceHash: await kb.hashRawFile("a.pdf"),
    });
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "改过了", "utf-8");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");

    const prompt = buildKnowledgeRoundPrompt(plan);
    assert.match(prompt, new RegExp(await kb.hashRawFile("a.pdf")));
    assert.match(prompt, /- raws\/a\.pdf\(source_hash=.*\) → sources\/a\.md/);
  });
});
