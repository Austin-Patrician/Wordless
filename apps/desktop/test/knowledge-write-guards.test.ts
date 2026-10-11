import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildKnowledgeRoundPrompt } from "../src/main/knowledge/knowledge-round-prompt.ts";
import { parseKnowledgePage } from "../src/main/knowledge/knowledge-schema.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 写入路径的两条底线。
 *
 * 它们来自一次**真实的失败会话**(2026-10-11):一轮加工在 `sources/营养与饮食健康问答.md`
 * 上留下 `x-wordless.source_hash: ""`,界面上显示成坏页、原文永远显示"没加工过"。
 * 而写入那一刻**没有任何信号** —— 这才是要修的东西。
 *
 * 那轮 agent 的表现其实很好:它发现没人给它 hash(见 prompt 的缺陷)、于是**拿 64 个 0 去试探**
 * 工具会不会校验、发现不校验之后**拒绝编造**,最后传了空字符串。所以这里的底线是:
 *   1. 写出来的东西必须读得回来(写入按读侧规则自检);
 *   2. Source 页的 hash 必须是**真的**(与原文当前内容一致),而且报错要给出正确值
 *      —— agent 没有 bash,算不出 sha256。
 */

let directory = "";
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-guards-"));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

let counter = 0;
const service = () => new KnowledgeService(join(directory, `guards-${(counter += 1)}`), { stateDirectory: join(directory, "state") });

/** 一份原文 + 一个准备写页的服务。 */
async function bundleWithRaw(content = "原文"): Promise<{ kb: KnowledgeService; hash: string }> {
  const kb = service();
  await kb.ensureBundle();
  await writeFile(join(kb.bundleRoot, "raws/health.md"), content, "utf-8");
  return { kb, hash: await kb.hashRawFile("health.md") };
}

const sourcePage = (hash: string | undefined, resource = "/raws/health.md") => ({
  path: "sources/health.md",
  type: "Source" as const,
  title: "健康问答",
  description: "一份问答。",
  tags: ["健康"],
  sources: [{ resource }],
  body: "正文。",
  by: "test",
  now: "2026-10-11T10:00:00Z",
  ...(hash === undefined ? {} : { sourceHash: hash }),
});

describe("Source 页的 hash 必须是真的", () => {
  it("空字符串被拒,而且把正确值给出来", async () => {
    const { kb, hash } = await bundleWithRaw();
    // 现场:agent 传的就是空字符串。
    await assert.rejects(() => kb.writePage(sourcePage("")), (error: Error) => {
      assert.match(error.message, /必须带 sourceHash/);
      assert.match(error.message, new RegExp(hash), "agent 算不出 sha256,所以报错必须带上正确值");
      return true;
    });
  });

  it("根本不传也被拒 —— 少了它这一页对 diff 就不存在", async () => {
    const { kb, hash } = await bundleWithRaw();
    await assert.rejects(() => kb.writePage(sourcePage(undefined)), (error: Error) => {
      assert.match(error.message, new RegExp(hash));
      return true;
    });
  });

  it("编一个 hash 被拒 —— 现场里 agent 正是拿 64 个 0 试探出来的", async () => {
    const { kb, hash } = await bundleWithRaw();
    await assert.rejects(() => kb.writePage(sourcePage("0".repeat(64))), (error: Error) => {
      assert.match(error.message, /不一致/);
      assert.match(error.message, new RegExp(hash));
      return true;
    });
  });

  it("真 hash 通过,而且那一页之后读得回来", async () => {
    const { kb, hash } = await bundleWithRaw();
    await kb.writePage(sourcePage(hash));
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "sources/health.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    // 快照里那份原文不再是"没加工过"。
    assert.deepEqual((await kb.snapshot()).rawFiles.map((file) => file.processed), [true]);
  });

  it("原文不存在时不校验(导入一份缺 raws/ 的库是合法的)", async () => {
    const kb = service();
    await kb.ensureBundle();
    await kb.writePage(sourcePage("来自另一台机器的 hash"));
    assert.equal((await kb.snapshot()).pages.length, 1);
  });
});

describe("写出来的东西必须读得回来", () => {
  it("写入前按**读侧同一套规则**自检 —— 报的是读侧的原话", async () => {
    const { kb, hash } = await bundleWithRaw();
    // 空 title:读侧会拒(`title 必须是非空字符串`),而写入路径自己**不查**这一项 ——
    // 拦住它的正是这次自检。没有自检的话,这一页会带着空标题落盘、界面上显示成坏页。
    await assert.rejects(
      () => kb.writePage({ ...sourcePage(hash), title: "" }),
      /title/,
    );
  });

  it("来源路径被归一成 bundle 相对形状(否则原文永远显示未加工)", async () => {
    const { kb, hash } = await bundleWithRaw();
    // 现场:agent 写的是 `raws/health.md`(没有前导斜杠)。
    await kb.writePage(sourcePage(hash, "raws/health.md"));
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "sources/health.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.page.sources?.map((source) => source.resource), ["/raws/health.md"]);
    // 归一之后 diff 才认得出这一页 —— 现场里没归一,于是 health.md 一直显示"未加工"。
    assert.deepEqual((await kb.snapshot()).rawFiles.map((file) => file.processed), [true]);
  });

  it("URL 来源原样保留 —— 只归一 raws 那一种", async () => {
    const kb = service();
    await kb.ensureBundle();
    await kb.writePage({
      path: "concepts/网页.md",
      type: "Concept",
      title: "网页",
      description: "来自网页的一页。",
      tags: [],
      sources: [{ resource: "https://example.com/a" }],
      body: "正文。",
      by: "test",
      now: "2026-10-11T10:00:00Z",
    });
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "concepts/网页.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.page.sources?.map((source) => source.resource), ["https://example.com/a"]);
  });
});

describe("已经坏掉的页能被下一轮修回来", () => {
  it("坏页在 diff 里算「没加工过」,下一轮用清单给的 hash 写一次就修好了", async () => {
    const { kb, hash } = await bundleWithRaw("原文");
    // 现场复刻:一份**生下来就是坏的**页(空 hash + 没有前导斜杠的来源)。
    await writeFile(
      join(kb.bundleRoot, "sources/health.md"),
      [
        "---",
        "type: Source",
        "title: 健康问答",
        "description: 一份问答。",
        "tags: []",
        "sources:",
        "  - resource: raws/health.md",
        "generated:",
        "  by: wordless-agent/knowledge",
        "  at: 2026-10-11T10:00:00Z",
        'x-wordless:',
        '  source_hash: ""',
        "  orphaned_at: null",
        "---",
        "",
        "正文。",
        "",
      ].join("\n"),
      "utf-8",
    );

    // 1) 那一页读不回来 → 原文仍然算"没加工过"。
    assert.deepEqual((await kb.snapshot()).rawFiles.map((file) => file.processed), [false]);
    const plan = await kb.prepareRound("2026-10-11T11:00:00Z");
    assert.deepEqual(plan.diff.added.map((raw) => raw.path), ["health.md"], "坏页不算已加工");
    // 而且清单把**正确**的 hash 给了 agent。
    assert.match(buildKnowledgeRoundPrompt(plan), new RegExp(hash));

    // 2) agent 照清单写一次 → 覆盖那一页(按路径 upsert),原文随即变成已加工。
    await kb.writePage({ ...sourcePage(hash), description: "一份问答。" });
    assert.deepEqual((await kb.snapshot()).rawFiles.map((file) => file.processed), [true]);
    // 下一轮不再有待办。
    assert.equal((await kb.prepareRound("2026-10-11T12:00:00Z")).needsProcessing, false);
  });
});
