import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildHealthReport, extractBundleLinks, isHealthReportClean, type LintPage } from "../src/main/knowledge/knowledge-lint.ts";
import { parseKnowledgePage } from "../src/main/knowledge/knowledge-schema.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 体检。
 *
 * 分工是这一层的重点:**算得出来的问题由工程算**(死链、孤立页、无来源、标题撞车)——
 * 让模型去数链接,它会漏、会编,而且每次结果不一样。**要判断的**(矛盾、过期论断、缺页的概念)
 * 交给模型,由 prompt 说清楚。
 */

const page = (overrides: Partial<LintPage> & Pick<LintPage, "path">): LintPage => ({
  kind: "Concept",
  title: overrides.path,
  body: "",
  orphaned: false,
  verified: false,
  sources: ["/raws/a.pdf"],
  ...overrides,
});

describe("链接抽取", () => {
  it("只认 bundle 相对的 markdown 链接 —— 认多了会把外链当页内链接", () => {
    const body = [
      "见 [流程](/concepts/流程.md) 与 [外链](https://example.com/a.md)。",
      "还有相对路径 [邻居](./邻居.md) 和 [锚点](/concepts/x.md#段)。",
    ].join("\n");
    assert.deepEqual(extractBundleLinks(body), ["/concepts/流程.md", "/concepts/x.md"]);
  });
});

describe("体检算得出来的四件事", () => {
  it("死链:指向不存在的页", () => {
    const report = buildHealthReport([
      page({ path: "concepts/a.md", body: "见 [不存在](/concepts/没有.md)" }),
      page({ path: "concepts/b.md" }),
    ]);
    assert.deepEqual(report.deadLinks, [{ pagePath: "concepts/a.md", link: "/concepts/没有.md" }]);
  });

  it("孤立页:没有任何活页指向它(检索走不到它)", () => {
    const report = buildHealthReport([
      page({ path: "concepts/a.md", body: "见 [b](/concepts/b.md)" }),
      page({ path: "concepts/b.md" }),
      page({ path: "concepts/c.md" }),
    ]);
    assert.deepEqual(report.orphans.map((entry) => entry.pagePath), ["concepts/a.md", "concepts/c.md"]);
  });

  it("孤儿页既不算死链的目标,也不自己算孤立", () => {
    const report = buildHealthReport([
      page({ path: "concepts/a.md", body: "见 [b](/concepts/b.md) 与 [已退役](/concepts/gone.md)" }),
      page({ path: "concepts/b.md", body: "见 [a](/concepts/a.md)" }),
      page({ path: "concepts/gone.md", orphaned: true }),
    ]);
    // gone.md 还在库里(等回收),所以指向它的链接不是死链 —— 它只是不再算"活页"。
    assert.deepEqual(report.deadLinks, []);
    // 它自己也不进孤立页(它已经不是活页了),而 a/b 互相链着,谁也不孤立。
    assert.deepEqual(report.orphans, []);
  });

  it("一页的库不算孤立 —— 边需要两个点", () => {
    // 否则一个刚建好、只有一页的库每次体检都报"孤立页",然后每次白起一个会话。
    assert.deepEqual(buildHealthReport([page({ path: "sources/a.md", kind: "Source" })]).orphans, []);
  });

  it("无来源的页:概念页/实体页却没写 sources", () => {
    const report = buildHealthReport([
      page({ path: "concepts/a.md", sources: [] }),
      page({ path: "entities/b.md", kind: "Entity", sources: [] }),
      page({ path: "sources/c.md", kind: "Source", sources: ["/raws/c.pdf"] }),
    ]);
    assert.deepEqual(report.unsourced.map((entry) => entry.pagePath), ["concepts/a.md", "entities/b.md"]);
  });

  it("标题撞车:归一后相同(这是重复页最可靠的信号)", () => {
    const report = buildHealthReport([
      page({ path: "concepts/a.md", title: "发票流程" }),
      page({ path: "concepts/b.md", title: " 发票流程 " }),
      page({ path: "concepts/c.md", title: "别的" }),
    ]);
    assert.deepEqual(report.duplicateTitles, [{ title: "发票流程", pagePaths: ["concepts/a.md", "concepts/b.md"] }]);
  });

  it("干净的报告不触发会话", () => {
    assert.equal(isHealthReportClean(buildHealthReport([page({ path: "sources/a.md", kind: "Source" })])), true);
  });
});

describe("退役与回收(体检唯一的破坏性动作)", () => {
  let directory = "";
  let counter = 0;
  const service = () => new KnowledgeService(join(directory, `lint-${(counter += 1)}`), { stateDirectory: join(directory, "state") });

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-lint-"));
  });
  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function writeConcept(kb: KnowledgeService, path: string, title: string, now: string, sources: string[] = []): Promise<void> {
    await kb.writePage({ path, type: "Concept", title, description: `${title}。`, tags: [], sources: sources.map((resource) => ({ resource })), body: "正文。", by: "test", now });
  }

  it("退役不立刻删:先标孤儿,下一轮才回收(中间那一轮能救回来)", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeConcept(kb, "concepts/重复.md", "重复", "2026-10-10T09:00:00Z");

    await kb.retirePage("concepts/重复.md", "2026-10-11T09:00:00Z");
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/重复.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.page.status, "deprecated");
    assert.equal(parsed.page.private?.orphaned_at, "2026-10-11T09:00:00Z");

    // 下一轮:回收(概念页也走这条路 —— 不再只回收源页)。
    const plan = await kb.prepareRound("2026-10-12T09:00:00Z");
    assert.deepEqual(plan.reaped.map((entry) => entry.pagePath), ["concepts/重复.md"]);
    await assert.rejects(() => readFile(join(kb.bundleRoot, "concepts/重复.md"), "utf-8"));
  });

  it("宽限期里写一次就救回来了(写入即复活)", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeConcept(kb, "concepts/救回来.md", "救回来", "2026-10-10T09:00:00Z");
    await kb.retirePage("concepts/救回来.md", "2026-10-11T09:00:00Z");

    // 有人(或 agent)在宽限期里写了它一次。
    await writeConcept(kb, "concepts/救回来.md", "救回来", "2026-10-11T10:00:00Z");

    const plan = await kb.prepareRound("2026-10-12T09:00:00Z");
    assert.deepEqual(plan.reaped, [], "被救回来的页不该被删");
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/救回来.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.page.private?.orphaned_at, null, "写入即复活");
  });

  it("人工复核过的页拒绝退役 —— 一个人为它背书过", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeConcept(kb, "concepts/人审过.md", "人审过", "2026-10-10T09:00:00Z");
    await kb.setPageVerification("concepts/人审过.md", true, "2026-10-10T10:00:00Z");

    await assert.rejects(() => kb.retirePage("concepts/人审过.md", "2026-10-11T09:00:00Z"), /人工复核过.*不能退役/s);
  });

  it("回收被退役的页时,别处的来源引用被摘掉而不是留死引用", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeConcept(kb, "concepts/留下.md", "留下", "2026-10-10T09:00:00Z");
    await writeConcept(kb, "concepts/并进去.md", "并进去", "2026-10-10T09:00:00Z", ["/raws/资料.pdf"]);
    await writeConcept(kb, "concepts/汇总.md", "汇总", "2026-10-10T09:00:00Z", ["/raws/资料.pdf", "/concepts/并进去.md"]);

    await kb.retirePage("concepts/并进去.md", "2026-10-11T09:00:00Z");
    await kb.prepareRound("2026-10-12T09:00:00Z");

    const summary = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/汇总.md"), "utf-8"));
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.deepEqual(summary.page.sources, [{ resource: "/raws/资料.pdf" }]);
  });

  it("healthReport 读的是真文件", async () => {
    const kb = service();
    await kb.ensureBundle();
    await writeConcept(kb, "concepts/a.md", "甲", "2026-10-10T09:00:00Z", ["/raws/a.pdf"]);
    await writeConcept(kb, "concepts/b.md", "甲", "2026-10-10T09:00:00Z", ["/raws/b.pdf"]);
    await kb.writePage({ path: "concepts/c.md", type: "Concept", title: "丙", description: "丙。", tags: [], body: "见 [没有](/concepts/没有.md)", by: "test", now: "2026-10-10T09:00:00Z" });

    const report = await kb.healthReport();
    assert.equal(report.deadLinks.length, 1);
    assert.equal(report.duplicateTitles.length, 1);
    assert.equal(report.orphans.length, 3, "三页互不链接,都是孤立页");
  });
});

describe("归档:从回答里抽出它引用的页", () => {
  it("抽 bundle 相对链接、去重、保持出现顺序", async () => {
    const { citedPagesOf } = await import("../src/main/knowledge/knowledge-round-prompt.ts");
    const answer = "见 [流程](/concepts/流程.md),以及 [合同](/sources/合同.md)。\n再提一次 [流程](/concepts/流程.md),外链不算:[x](https://a/b.md)";
    assert.deepEqual(citedPagesOf(answer), ["concepts/流程.md", "sources/合同.md"]);
  });

  it("归档 prompt 带上了引用页,并要求保留实质内容", async () => {
    const { buildKnowledgeFilingPrompt } = await import("../src/main/knowledge/knowledge-round-prompt.ts");
    const prompt = buildKnowledgeFilingPrompt({ text: "对比结论:甲优于乙。", citedPages: ["concepts/甲.md"] });
    // 引用页要进 prompt —— sources 是这一页能不能被核对的依据。
    assert.match(prompt, /concepts\/甲\.md/);
    // 必须说清这不是加工原始文件,否则模型会去找 raws。
    assert.match(prompt, /不要去找 raws/);
    // 也必须说清"保留实质内容" —— 归档不是摘要。
    assert.match(prompt, /不是摘要/);
    // 正文要原样带上。
    assert.match(prompt, /对比结论:甲优于乙。/);
  });

  it("没有引用页时也把话说清,而不是留个空档", async () => {
    const { buildKnowledgeFilingPrompt } = await import("../src/main/knowledge/knowledge-round-prompt.ts");
    const prompt = buildKnowledgeFilingPrompt({ text: "新知识。", citedPages: [] });
    assert.match(prompt, /没有引用库里已有的页/);
  });
});
