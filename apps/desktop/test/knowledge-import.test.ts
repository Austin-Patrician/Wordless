import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { freeImportPath, planImport, readImportedBundle } from "../src/main/knowledge/knowledge-import.ts";
import { isHumanVerified, parseKnowledgePage } from "../src/main/knowledge/knowledge-schema.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 导入别人的 OKF bundle。
 *
 * 这是"OKF 的形"那个决策唯一兑现的收益,而它同时撞上设计里那条**刻意的冲突**:
 * 我们的 frontmatter 是封闭的(生产者侧),OKF 是开放的(消费者侧不得因未知字段拒绝)。
 * 所以导入这一侧必须宽容 —— 读得懂的映射,读不懂的**如实报出来**,绝**不静默丢**。
 *
 * 三件事要能证明:未知字段被列出来而不是让整页失败、撞车不覆盖、来源缺 raws 时提前警告。
 */

let directory = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-import-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

const page = (frontmatter: string, body = "正文。"): string => `---\n${frontmatter}\n---\n\n${body}\n`;

describe("读一份别人的库:宽容,但不静默", () => {
  it("读得懂的字段映射过来", () => {
    const bundle = readImportedBundle(
      [
        {
          path: "concepts/流程.md",
          markdown: page(
            [
              "type: Concept",
              "title: 流程",
              "description: 一句话。",
              "tags: [API, 计费]",
              "status: stable",
              "sources:",
              "  - { id: a, resource: raws/a.pdf }",
              'generated: { by: other-agent/1.0, at: "2026-01-01T00:00:00Z" }',
            ].join("\n"),
          ),
        },
      ],
      ["a.pdf"],
    );
    assert.equal(bundle.pages.length, 1);
    const imported = bundle.pages[0]!;
    assert.equal(imported.page.type, "Concept");
    assert.equal(imported.page.title, "流程");
    assert.deepEqual(imported.page.tags, ["api", "计费"], "标签归一:API → api");
    assert.equal(imported.page.status, "stable");
    // 来源的 `raws/a.pdf` 补上前导斜杠 —— 别的工具常这么写。
    assert.deepEqual(imported.page.sources, [{ id: "a", resource: "/raws/a.pdf" }]);
    // `generated` 保留来源的写法:改写它就等于伪造出处。
    assert.equal(imported.page.generated?.by, "other-agent/1.0");
  });

  it("不认识的字段**聚合成一份清单**,而不是让整页失败", () => {
    const bundle = readImportedBundle(
      [
        { path: "concepts/a.md", markdown: page("type: Metric\ntitle: a\ndescription: x\ntags: []\nresource: https://x\ngenerated: { by: h, at: \"t\" }\nstale_after: \"2027-01-01T00:00:00Z\"") },
        { path: "concepts/b.md", markdown: page("type: Playbook\ntitle: b\ndescription: x\ntags: []\nresource: https://y\ngenerated: { by: h, at: \"t\" }") },
      ],
      [],
    );
    assert.equal(bundle.pages.length, 2, "两页都读进来了");
    assert.deepEqual(bundle.droppedFields, { resource: 2, stale_after: 1 });
    // 类型不在我们那三个里 → 按目录映射到 Concept,并记下原类型。
    assert.deepEqual(bundle.pages.map((entry) => entry.page.type), ["Concept", "Concept"]);
    assert.deepEqual(bundle.mappedTypes, { Metric: 1, Playbook: 1 });
  });

  it("type 是陌生值、目录也没有线索时落到 Concept", () => {
    const bundle = readImportedBundle([{ path: "笔记/随手.md", markdown: page("type: BigQuery Table\ntitle: x\ndescription: y\ntags: []") }], []);
    assert.equal(bundle.pages[0]!.page.type, "Concept");
  });

  it("标签超上限被截断并报出来", () => {
    const bundle = readImportedBundle([{ path: "concepts/a.md", markdown: page("type: Concept\ntitle: a\ndescription: x\ntags: [2024, 财务, 合同, 采购, 税务, 发票, 流程]") }], []);
    assert.equal(bundle.pages[0]!.page.tags.length, 5);
    assert.equal(bundle.truncatedTags, 1);
  });

  it("没有 title 就用文件名(空标题在目录里比丑标题更糟)", () => {
    const bundle = readImportedBundle([{ path: "concepts/没标题.md", markdown: page("type: Concept\ndescription: x\ntags: []") }], []);
    assert.equal(bundle.pages[0]!.page.title, "没标题");
  });

  it("读不出来的文件被列出来,不静默少几页", () => {
    const bundle = readImportedBundle(
      [
        { path: "concepts/坏.md", markdown: "没有 frontmatter" },
        { path: "concepts/好.md", markdown: page("type: Concept\ntitle: 好\ndescription: x\ntags: []") },
      ],
      [],
    );
    assert.equal(bundle.pages.length, 1);
    assert.deepEqual(bundle.damaged.map((entry) => entry.path), ["concepts/坏.md"]);
  });

  it("人工复核记录也带过来(它是一条承诺,不该在导入时蒸发)", () => {
    const bundle = readImportedBundle(
      [{ path: "concepts/a.md", markdown: page("type: Concept\ntitle: a\ndescription: x\ntags: []\nverified: { by: \"human:someone\", at: \"2026-01-01T00:00:00Z\" }") }],
      [],
    );
    assert.equal(isHumanVerified(bundle.pages[0]!.page), true);
  });

  it("OKF 的列表形式 verified 也读得懂(取第一条)", () => {
    const markdown = `---\ntype: Concept\ntitle: a\ndescription: x\ntags: []\nverified:\n  - { by: human:x, at: "t" }\n  - { by: process:y, at: "t2" }\n---\n\n正文。\n`;
    const bundle = readImportedBundle([{ path: "concepts/a.md", markdown }], []);
    assert.equal(bundle.pages[0]!.page.verified?.by, "human:x");
  });
});

describe("导入计划:先看再导", () => {
  it("撞车的页单列出来,不混进「会新建」里", () => {
    const bundle = readImportedBundle(
      [
        { path: "concepts/已有.md", markdown: page("type: Concept\ntitle: 别人的\ndescription: x\ntags: []") },
        { path: "concepts/新的.md", markdown: page("type: Concept\ntitle: 新的\ndescription: x\ntags: []") },
      ],
      ["a.pdf"],
    );
    const plan = planImport(bundle, new Set(["concepts/已有.md"]));
    assert.deepEqual(plan.added.map((entry) => entry.path), ["concepts/新的.md"]);
    assert.deepEqual(plan.conflicts, [{ path: "concepts/已有.md", title: "别人的" }]);
  });

  it("来源只有页面、没有 raws 时提前警告", () => {
    const withSource = readImportedBundle([{ path: "sources/a.md", markdown: page("type: Source\ntitle: a\ndescription: x\ntags: []") }], []);
    // 少了原始文件,那一页下一轮会被判成孤儿并回收 —— 用户必须事先知道。
    assert.equal(planImport(withSource, new Set()).sourceFilesMissing, true);

    const withRaw = readImportedBundle([{ path: "sources/a.md", markdown: page("type: Source\ntitle: a\ndescription: x\ntags: []") }], ["a.pdf"]);
    assert.equal(planImport(withRaw, new Set()).sourceFilesMissing, false);
  });

  it("撞车时的落点加序号,永不覆盖", () => {
    assert.equal(freeImportPath("concepts/a.md", new Set()), "concepts/a.md");
    assert.equal(freeImportPath("concepts/a.md", new Set(["concepts/a.md"])), "concepts/a (2).md");
    assert.equal(freeImportPath("concepts/a.md", new Set(["concepts/a.md", "concepts/a (2).md"])), "concepts/a (3).md");
  });
});

describe("真导入:写进库里", () => {
  let counter = 0;
  const service = () => new KnowledgeService(join(directory, `target-${(counter += 1)}`), { stateDirectory: join(directory, "state") });

  /** 造一份"别人的库"在磁盘上。 */
  async function sourceBundle(name: string, files: Record<string, string>): Promise<string> {
    const root = join(directory, `source-${name}`);
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content, "utf-8");
    }
    return root;
  }

  it("导入页面与原始文件,并且来源可解析", async () => {
    const source = await sourceBundle("a", {
      "concepts/流程.md": page("type: Concept\ntitle: 流程\ndescription: 别人的一页。\ntags: [流程]"),
      "raws/资料.pdf": "别人的原始文件",
    });
    const kb = service();
    await kb.ensureBundle();

    const plan = await kb.planImport(source);
    assert.deepEqual(plan.added.map((entry) => entry.path), ["concepts/流程.md"]);
    assert.equal(plan.raws, 1);

    const result = await kb.applyImport(source, "skip", "2026-10-11T09:00:00Z");
    assert.deepEqual(result, { imported: 1, skipped: 0, raws: 1 });

    const imported = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/流程.md"), "utf-8"));
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    assert.equal(imported.page.title, "流程");
    assert.equal(await readFile(join(kb.bundleRoot, "raws/资料.pdf"), "utf-8"), "别人的原始文件");
  });

  it("撞车默认跳过 —— 覆盖会毁掉本库那一页", async () => {
    const source = await sourceBundle("b", { "concepts/撞车.md": page("type: Concept\ntitle: 别人的\ndescription: 别人的。\ntags: []") });
    const kb = service();
    await kb.ensureBundle();
    await kb.writePage({ path: "concepts/撞车.md", type: "Concept", title: "我的", description: "我的。", tags: [], body: "我的正文。", by: "human:local", now: "2026-10-10T09:00:00Z" });

    assert.deepEqual(await kb.applyImport(source, "skip", "2026-10-11T09:00:00Z"), { imported: 0, skipped: 1, raws: 0 });
    const mine = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/撞车.md"), "utf-8"));
    assert.equal(mine.ok, true);
    if (!mine.ok) return;
    assert.equal(mine.page.title, "我的", "我那一页一个字都没动");
  });

  it("选择改名时两页都在,而且**路径不同**", async () => {
    const source = await sourceBundle("c", { "concepts/撞车.md": page("type: Concept\ntitle: 别人的\ndescription: 别人的。\ntags: []") });
    const kb = service();
    await kb.ensureBundle();
    await kb.writePage({ path: "concepts/撞车.md", type: "Concept", title: "我的", description: "我的。", tags: [], body: "我的正文。", by: "human:local", now: "2026-10-10T09:00:00Z" });

    assert.deepEqual(await kb.applyImport(source, "rename", "2026-10-11T09:00:00Z"), { imported: 1, skipped: 0, raws: 0 });
    const mine = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/撞车.md"), "utf-8"));
    const theirs = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/撞车 (2).md"), "utf-8"));
    assert.equal(mine.ok && mine.page.title, "我的");
    assert.equal(theirs.ok && theirs.page.title, "别人的");
  });

  it("导入后目录里能看到它们(重建索引)", async () => {
    const source = await sourceBundle("d", { "entities/某某公司.md": page("type: Entity\ntitle: 某某公司\ndescription: 供应商。\ntags: [供应商]") });
    const kb = service();
    await kb.ensureBundle();
    await kb.applyImport(source, "skip", "2026-10-11T09:00:00Z");
    await kb.rebuildIndex();
    const index = await readFile(join(kb.bundleRoot, "index.md"), "utf-8");
    assert.match(index, /某某公司/);
  });
});
