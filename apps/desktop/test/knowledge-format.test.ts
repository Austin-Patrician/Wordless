import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { appendKnowledgeLog, buildKnowledgeIndex, checkKnowledgeConformance } from "../src/main/knowledge/knowledge-derived.ts";
import { isWritablePagePath, toBundleResource } from "../src/main/knowledge/knowledge-layout.ts";
import {
  normalizeTags,
  parseKnowledgePage,
  serializeKnowledgePage,
  toFrontmatter,
  validateKnowledgePage,
  type KnowledgePage,
} from "../src/main/knowledge/knowledge-schema.ts";
import { KnowledgeService, normalizePagePath } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 知识库的**格式层**:frontmatter 的封闭 schema、派生产物、以及 bundle 的一致性。
 *
 * 这一层是 P1 里最不可逆的部分 —— frontmatter 的形状一旦有用户的库落地,迁移成本极高。
 * 所以这里测的不是"代码能跑",而是**那几条设计规则真的被机制守住了**:
 *   - 封闭 schema:未知字段报错,而不是静默写进文件;
 *   - 私有块只有两个机器位,含义必须用 OKF 字段表达;
 *   - `raws/` 与工程生成的文件写不进去(路径校验,不是提示词约定);
 *   - 类型与目录一致;index.md 覆盖所有活页(目录不许漂)。
 */

let directory = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

/**
 * 在临时目录里放一个"用户的原件"。
 *
 * 每个夹具一个独立子目录:**路径**要唯一,但**文件名**必须干净 —— 导入按 basename 落进投递箱,
 * 前缀会跟着进去,断言就没法写真实的名字了。
 */
async function fixtureFile(name: string, content: string): Promise<string> {
  const path = join(await mkdtemp(join(directory, "src-")), name);
  await writeFile(path, content, "utf-8");
  return path;
}

const SOURCE_PAGE: KnowledgePage = {
  type: "Source",
  title: "2024 供应商合同",
  description: "与某某公司的年度采购框架,含付款条款与违约责任。",
  tags: ["合同", "采购"],
  sources: [{ id: "contract", resource: "/raws/合同/2024.pdf" }],
  generated: { by: "wordless-agent/test", at: "2026-10-10T09:00:00Z" },
  private: { source_hash: "abc123", orphaned_at: null },
};

describe("frontmatter:OKF 的形 + 私有命名空间", () => {
  it("往返一致:写出去再读回来是同一页", () => {
    const markdown = serializeKnowledgePage(SOURCE_PAGE, "正文第一段。\n\n正文第二段。");
    const parsed = parseKnowledgePage(markdown);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.page, SOURCE_PAGE);
    assert.match(parsed.body, /正文第一段/);
  });

  it("字段顺序固定 —— 同样的内容写出同样的字节(diff 才有意义)", () => {
    const first = serializeKnowledgePage(SOURCE_PAGE, "body");
    const second = serializeKnowledgePage({ ...SOURCE_PAGE, tags: ["合同", "采购"] }, "body");
    assert.equal(first, second);
    const lines = first.split("\n");
    const order = ["type:", "title:", "description:", "tags:", "sources:", "generated:", "x-wordless:"];
    let cursor = -1;
    for (const key of order) {
      const at = lines.findIndex((line) => line.startsWith(key));
      assert.ok(at > cursor, `${key} 的位置不对(期望在上一项之后)`);
      cursor = at;
    }
  });

  it("封闭 schema:未知字段报错,而不是静默写进文件", () => {
    const result = validateKnowledgePage({ ...toFrontmatter(SOURCE_PAGE), confidence: "high" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.issues[0]!.message, /不允许的字段.*confidence/);
  });

  it("私有块只放机器位:往里塞含义会被拒", () => {
    const result = validateKnowledgePage({ ...toFrontmatter(SOURCE_PAGE), "x-wordless": { source_hash: "abc", summary: "想偷偷放个摘要" } });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.issues[0]!.message, /只放机器位/);
  });

  it("type 必须是约定的三个之一,且 title 非空", () => {
    assert.equal(validateKnowledgePage({ ...toFrontmatter(SOURCE_PAGE), type: "Note" }).ok, false);
    assert.equal(validateKnowledgePage({ ...toFrontmatter(SOURCE_PAGE), title: "   " }).ok, false);
  });

  it("description 必须是一句话(不能含换行)", () => {
    const result = validateKnowledgePage({ ...toFrontmatter(SOURCE_PAGE), description: "第一行\n第二行" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.issues[0]!.message, /一句话/);
  });

  it("标签归一:大小写与空格收成一个,保序去重,并且有上限", () => {
    assert.deepEqual(normalizeTags(["  API ", "api", "计费  系统", "", "API"]), ["api", "计费 系统"]);
    const tooMany = validateKnowledgePage({ ...toFrontmatter(SOURCE_PAGE), tags: ["a", "b", "c", "d", "e", "f"] });
    assert.equal(tooMany.ok, false);
    if (tooMany.ok) return;
    assert.match(tooMany.issues[0]!.message, /最多 5 个/);
  });

  it("bundle 相对来源不许逃出 bundle —— 否则导出的库不是自包含的", () => {
    const result = validateKnowledgePage({ ...toFrontmatter(SOURCE_PAGE), sources: [{ resource: "/raws/../../etc/passwd" }] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.issues[0]!.message, /不能含 \.\. 段/);
  });

  it("损坏的页返回问题而不是抛异常(一个坏页不该让整库不可用)", () => {
    assert.equal(parseKnowledgePage("没有 frontmatter").ok, false);
    assert.equal(parseKnowledgePage("---\ntype: Source\n").ok, false);
    assert.equal(parseKnowledgePage("---\ntype: [未闭合\n---\nbody").ok, false);
  });
});

describe("派生产物:index.md 与 log.md", () => {
  const entries = [
    { path: "sources/合同.md", page: SOURCE_PAGE },
    {
      path: "concepts/发票流程.md",
      page: { ...SOURCE_PAGE, type: "Concept" as const, title: "发票流程", description: "从开票到抵扣。", private: {} },
    },
  ];

  it("index 分节列出活页,并带上描述与 bundle 相对链接(OKF §8)", () => {
    const index = buildKnowledgeIndex(entries);
    assert.match(index, /## Sources/);
    assert.match(index, /## Concepts/);
    assert.match(index, /\* \[2024 供应商合同\]\(\/sources\/合同\.md\) - 与某某公司的年度采购框架/);
    assert.match(index, /do not edit by hand/);
  });

  it("index 不含孤儿页,但列出还没加工的原始文件", () => {
    const withOrphan = [
      ...entries,
      { path: "sources/旧页.md", page: { ...SOURCE_PAGE, private: { orphaned_at: "2026-10-01T00:00:00Z" } } },
    ];
    const index = buildKnowledgeIndex(withOrphan, ["新资料.pdf"]);
    assert.doesNotMatch(index, /旧页/);
    assert.match(index, /## Not processed yet/);
    assert.match(index, /新资料\.pdf/);
  });

  it("log 按日期分组、最新在上,同一天插到最前(OKF §9)", () => {
    const first = appendKnowledgeLog("", { at: "2026-10-10T09:00:00Z", kind: "Creation", text: "建了第一页" });
    assert.match(first, /## 2026-10-10/);
    const sameDay = appendKnowledgeLog(first, { at: "2026-10-10T18:00:00Z", kind: "Update", text: "改了第二页" });
    const order = sameDay.split("\n").filter((line) => line.startsWith("* "));
    assert.match(order[0]!, /改了第二页/);
    const nextDay = appendKnowledgeLog(sameDay, { at: "2026-10-11T08:00:00Z", kind: "Ingest", text: "新的一天" });
    const headings = nextDay.split("\n").filter((line) => line.startsWith("## "));
    assert.deepEqual(headings, ["## 2026-10-11", "## 2026-10-10"]);
  });
});

describe("路径规则:哪些地方 agent 写不了", () => {
  it("raws/ 与工程生成的文件不可写", () => {
    assert.equal(isWritablePagePath("raws/合同.pdf"), false);
    assert.equal(isWritablePagePath("raws"), false);
    assert.equal(isWritablePagePath("index.md"), false);
    assert.equal(isWritablePagePath("log.md"), false);
    assert.equal(isWritablePagePath("sources/../raws/x.md"), false);
  });

  it("页面目录可写", () => {
    assert.equal(isWritablePagePath("sources/x.md"), true);
    assert.equal(isWritablePagePath("concepts/子目录/x.md"), true);
    assert.equal(isWritablePagePath("entities/公司.md"), true);
  });

  it("路径归一:补 .md、去前导斜杠", () => {
    assert.equal(normalizePagePath("/concepts/发票流程"), "concepts/发票流程.md");
    assert.equal(normalizePagePath("sources\\x.md"), "sources/x.md");
    assert.equal(toBundleResource("raws/合同.pdf"), "/raws/合同.pdf");
  });
});

describe("服务:真写文件", () => {
  const service = (name: string) => new KnowledgeService(join(directory, name));

  it("ensureBundle 建出骨架,且幂等", async () => {
    const kb = service("basic");
    await kb.ensureBundle();
    await kb.ensureBundle();
    const stats = await kb.stats();
    assert.deepEqual({ rawFiles: stats.rawFiles, pages: stats.pages }, { rawFiles: 0, pages: 0 });
  });

  it("写页 → 扫回来 → 重建 index,活页被目录覆盖", async () => {
    const kb = service("write");
    await kb.ensureBundle();
    const written = await kb.writePage({
      path: "sources/合同.md",
      type: "Source",
      title: "合同",
      description: "一份合同。",
      tags: ["合同"],
      body: "正文。",
      by: "wordless-agent/test",
      now: "2026-10-10T09:00:00Z",
      sourceHash: "hash-1",
    });
    assert.deepEqual(written, { path: "sources/合同.md", action: "create" });

    const scan = await kb.scanPages();
    assert.equal(scan.entries.length, 1);
    assert.equal(scan.damaged.length, 0);
    assert.equal(scan.entries[0]!.page.private?.source_hash, "hash-1");

    await kb.rebuildIndex();
    const index = await readFile(join(kb.bundleRoot, "index.md"), "utf-8");
    assert.match(index, /sources\/合同\.md/);
    assert.equal(checkKnowledgeConformance({
      pages: [{ path: "sources/合同.md", ok: true, type: "Source" }],
      index,
      log: "## 2026-10-10\n\n* **Creation**: x",
      livePagePaths: ["sources/合同.md"],
    }).length, 0);
  });

  it("同一个路径再写就是更新,且保留人审过的 status", async () => {
    const kb = service("update");
    await kb.ensureBundle();
    const base = { path: "concepts/流程.md", type: "Concept" as const, title: "流程", description: "一版。", tags: [], body: "v1", by: "wordless-agent/test", now: "2026-10-10T09:00:00Z" };
    assert.equal((await kb.writePage(base)).action, "create");

    // 人把它标成 stable,下一次自动写入不该把它降级回 draft。
    const path = join(kb.bundleRoot, "concepts/流程.md");
    const markdown = await readFile(path, "utf-8");
    await writeFile(path, markdown.replace("type: Concept", "type: Concept\nstatus: stable"), "utf-8");

    const again = await kb.writePage({ ...base, description: "二版。", body: "v2", now: "2026-10-11T09:00:00Z" });
    assert.equal(again.action, "update");
    const parsed = parseKnowledgePage(await readFile(path, "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.page.status, "stable");
    assert.equal(parsed.page.description, "二版。");
    assert.equal(parsed.body, "v2");
  });

  it("类型与目录必须一致 —— 写错目录直接拒绝", async () => {
    const kb = service("mismatch");
    await kb.ensureBundle();
    await assert.rejects(
      () => kb.writePage({ path: "sources/错.md", type: "Concept", title: "x", description: "x", tags: [], body: "x", by: "test", now: "2026-10-10T09:00:00Z" }),
      /类型必须与目录一致/,
    );
  });

  it("raws/ 与 index.md 在服务层也写不进去(不只靠工具层拦)", async () => {
    const kb = service("guard");
    await kb.ensureBundle();
    for (const path of ["raws/x.md", "index.md", "log.md"]) {
      await assert.rejects(
        () => kb.writePage({ path, type: "Source", title: "x", description: "x", tags: [], body: "x", by: "test", now: "2026-10-10T09:00:00Z" }),
        /不是可写的页面路径/,
        path,
      );
    }
  });

  it("坏页被上报而不是让扫描挂掉", async () => {
    const kb = service("damaged");
    await kb.ensureBundle();
    await mkdir(join(kb.bundleRoot, "concepts"), { recursive: true });
    await writeFile(join(kb.bundleRoot, "concepts/坏页.md"), "手改坏了,没有 frontmatter", "utf-8");
    const scan = await kb.scanPages();
    assert.equal(scan.entries.length, 0);
    assert.equal(scan.damaged.length, 1);
    assert.match(scan.damaged[0]!.issue, /缺少 frontmatter/);
  });

  it("index 的 Not processed yet 反映真实进度", async () => {
    const kb = service("pending");
    await kb.ensureBundle();
    await mkdir(join(kb.bundleRoot, "raws/资料"), { recursive: true });
    await writeFile(join(kb.bundleRoot, "raws/资料/a.pdf"), "pdf-bytes", "utf-8");
    await writeFile(join(kb.bundleRoot, "raws/b.docx"), "docx-bytes", "utf-8");

    await kb.rebuildIndex();
    let index = await readFile(join(kb.bundleRoot, "index.md"), "utf-8");
    assert.match(index, /资料\/a\.pdf/);
    assert.match(index, /b\.docx/);

    // 加工了 a 之后,它从待办里消失,只剩 b。
    await kb.writePage({
      path: "sources/a.md",
      type: "Source",
      title: "A",
      description: "a",
      tags: [],
      sources: [{ resource: "/raws/资料/a.pdf" }],
      body: "x",
      by: "test",
      now: "2026-10-10T09:00:00Z",
      sourceHash: await kb.hashRawFile("资料/a.pdf"),
    });
    await kb.rebuildIndex();
    index = await readFile(join(kb.bundleRoot, "index.md"), "utf-8");
    assert.doesNotMatch(index, /资料\/a\.pdf/);
    assert.match(index, /b\.docx/);
  });
});

describe("一致性检查(CI 里的那条守卫)", () => {
  it("一致时无问题", () => {
    assert.deepEqual(
      checkKnowledgeConformance({
        pages: [{ path: "sources/a.md", ok: true, type: "Source" }],
        index: "* [A](/sources/a.md) - a",
        log: "## 2026-10-10\n\n* **Creation**: a",
        livePagePaths: ["sources/a.md"],
      }),
      [],
    );
  });

  it("类型与目录不一致会被指出", () => {
    const issues = checkKnowledgeConformance({
      pages: [{ path: "sources/a.md", ok: true, type: "Concept" }],
      index: "* [A](/sources/a.md) - a",
      log: "## 2026-10-10\n\n* **Creation**: a",
      livePagePaths: ["sources/a.md"],
    });
    assert.equal(issues.length, 1);
    assert.match(issues[0]!, /type 必须是 Source/);
  });

  it("index 漏了活页、log 没有日期分组都会被指出", () => {
    const issues = checkKnowledgeConformance({
      pages: [{ path: "sources/a.md", ok: true, type: "Source" }],
      index: "空的目录",
      log: "# 没有日期",
      livePagePaths: ["sources/a.md"],
    });
    assert.equal(issues.length, 2);
    assert.ok(issues.some((issue) => /index\.md 里没有/.test(issue)));
    assert.ok(issues.some((issue) => /没有任何日期分组/.test(issue)));
  });
});

describe("导入:投递箱的门", () => {
  const kb = () => new KnowledgeService(join(directory, `import-${Math.random().toString(36).slice(2)}`));

  it("复制进来,并如实报告导入了几个", async () => {
    const service = kb();
    await service.ensureBundle();
    const source = await fixtureFile("原件.pdf", "pdf-bytes");
    const result = await service.importFiles([source], "copy");
    assert.deepEqual(result, { imported: 1, skipped: [] });
    // 复制:原件还在。
    assert.equal(await readFile(source, "utf-8"), "pdf-bytes");
    assert.deepEqual(await service.listRawFiles(), ["原件.pdf"]);
  });

  it("移动进来:原件消失,库里留下", async () => {
    const service = kb();
    await service.ensureBundle();
    const source = await fixtureFile("要移动.pdf", "bytes");
    assert.deepEqual(await service.importFiles([source], "move"), { imported: 1, skipped: [] });
    await assert.rejects(() => readFile(source, "utf-8"));
    assert.deepEqual(await service.listRawFiles(), ["要移动.pdf"]);
  });

  it("同名**绝不覆盖** —— 改成一个带序号的新名字", async () => {
    const service = kb();
    await service.ensureBundle();
    const first = await fixtureFile("报告.pdf", "第一份");
    const second = await fixtureFile("报告.pdf", "第二份");
    await service.importFiles([first], "copy");
    await service.importFiles([second], "copy");

    const raws = await service.listRawFiles();
    assert.deepEqual(raws.sort(), ["报告 (2).pdf", "报告.pdf"]);
    // 两份内容都在 —— 覆盖意味着某个页面的来源悄悄换了内容,而它的 source_hash 还指着旧内容。
    assert.equal(await readFile(join(service.bundleRoot, "raws/报告.pdf"), "utf-8"), "第一份");
    assert.equal(await readFile(join(service.bundleRoot, "raws/报告 (2).pdf"), "utf-8"), "第二份");
  });

  it("不是文件的路径被跳过,而且说出来", async () => {
    const service = kb();
    await service.ensureBundle();
    const result = await service.importFiles([join(service.bundleRoot, "raws")], "copy");
    assert.equal(result.imported, 0);
    assert.equal(result.skipped.length, 1);
  });

  it("快照把「哪些还没加工」说清楚", async () => {
    const service = kb();
    await service.ensureBundle();
    const source = await fixtureFile("资料.pdf", "bytes");
    await service.importFiles([source], "copy");
    let snapshot = await service.snapshot();
    assert.deepEqual(snapshot.rawFiles.map((file) => file.processed), [false]);

    await service.writePage({
      path: "sources/资料.md",
      type: "Source",
      title: "资料",
      description: "一份资料。",
      tags: [],
      sources: [{ resource: "/raws/资料.pdf" }],
      body: "正文。",
      by: "test",
      now: "2026-10-10T09:00:00Z",
      // **真 hash**:Source 页的身份就是"对应哪份原文的哪一版",而写入路径现在会核对它
      // (编一个的后果是静默的:原文永远显示"没加工过",下一轮再写一遍)。
      sourceHash: await service.hashRawFile("资料.pdf"),
    });
    snapshot = await service.snapshot();
    assert.deepEqual(snapshot.rawFiles.map((file) => file.processed), [true]);
    assert.equal(snapshot.pages.length, 1);
    assert.equal(snapshot.pages[0]!.kind, "Source");
  });

  it("写入与导入都会通知界面(否则视图停在打开那一刻)", async () => {
    let changes = 0;
    const service = new KnowledgeService(join(directory, `notify-${Math.random().toString(36).slice(2)}`), { onChange: () => { changes += 1; } });
    await service.ensureBundle();
    const source = await fixtureFile("通知.pdf", "bytes");
    await service.importFiles([source], "copy");
    assert.equal(changes, 1);
    await service.writePage({
      path: "sources/通知.md",
      type: "Source",
      title: "通知",
      description: "x",
      tags: [],
      body: "x",
      by: "test",
      now: "2026-10-10T09:00:00Z",
    });
    assert.equal(changes, 2);
  });
});
