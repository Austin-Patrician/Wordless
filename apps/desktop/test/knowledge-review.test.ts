import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { applyVerificationGate, diffKnowledge, rawsResource } from "../src/main/knowledge/knowledge-diff.ts";
import { isHumanVerified, parseKnowledgePage, serializeKnowledgePage } from "../src/main/knowledge/knowledge-schema.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 人工复核流。
 *
 * 设计里承诺过「带 `human:` 的 `verified` 即停止自动重写」—— 这一层就是那条承诺的落地,
 * 而且是**机制**不是提示词:两道防线各守一半。
 *   - 第一道在**待办**上(`applyVerificationGate`):复核过的页不进 agent 的活,免得它拿到一个
 *     注定被拒的指令;
 *   - 第二道在**写路径**上(`writePage`):就算 agent 自己找到了那一页,也改不动。
 *
 * 只做其中一道都不够:只做第二道,agent 会白烧一次调用,而且它看到的失败原因
 * ("不自动改写")与它被要求做的事("更新这一页")互相矛盾。
 */

let directory = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-review-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

let counter = 0;
const service = () => new KnowledgeService(join(directory, `review-${(counter += 1)}`), { stateDirectory: join(directory, "state") });

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

describe("只认 human: 前缀", () => {
  it("机器写的复核不算数 —— 否则一次自动 Lint 就能把整库锁死", () => {
    const base = { type: "Concept" as const, title: "x", description: "x", tags: [] };
    assert.equal(isHumanVerified({ ...base, verified: { by: "human:local", at: "t" } }), true);
    assert.equal(isHumanVerified({ ...base, verified: { by: "process:lint", at: "t" } }), false);
    assert.equal(isHumanVerified({ ...base, verified: { by: "wordless-agent/x", at: "t" } }), false);
    assert.equal(isHumanVerified(base), false);
  });

  it("写进 frontmatter 再读回来,verified 还在(封闭 schema 认它)", () => {
    const page = { type: "Concept" as const, title: "x", description: "x", tags: [], verified: { by: "human:local", at: "2026-10-10T00:00:00Z" } };
    const parsed = parseKnowledgePage(serializeKnowledgePage(page, "正文。"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.page.verified, { by: "human:local", at: "2026-10-10T00:00:00Z" });
  });

  it("读得懂别人的列表形式(OKF 允许 verified 是数组)", () => {
    const markdown = `---\ntype: Concept\ntitle: x\ndescription: x\ntags: []\nverified:\n  - { by: human:someone, at: "2026-10-10T00:00:00Z" }\n---\n\n正文。\n`;
    const parsed = parseKnowledgePage(markdown);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.page.verified?.by, "human:someone");
  });
});

describe("第一道:复核过的页不进待办", () => {
  it("来源变了也不给 agent —— 转成「需要复核」", () => {
    const diff = diffKnowledge(
      [{ pagePath: "sources/a.md", resource: "/raws/a.pdf", hash: "h1", orphanedAt: null, verified: true }],
      [{ path: "a.pdf", resource: "/raws/a.pdf", hash: "h2" }],
    );
    const gated = applyVerificationGate(diff, new Set(["sources/a.md"]));
    assert.equal(gated.diff.changed.length, 0, "复核过的页不该出现在 agent 的待办里");
    assert.deepEqual(gated.needsReview, [{ pagePath: "sources/a.md", resource: "/raws/a.pdf" }]);
  });

  it("没复核的页照常进待办", () => {
    const diff = diffKnowledge(
      [{ pagePath: "sources/a.md", resource: "/raws/a.pdf", hash: "h1", orphanedAt: null, verified: false }],
      [{ path: "a.pdf", resource: "/raws/a.pdf", hash: "h2" }],
    );
    const gated = applyVerificationGate(diff, new Set());
    assert.equal(gated.diff.changed.length, 1);
    assert.equal(gated.needsReview.length, 0);
  });
});

describe("第二道:写路径改不动复核过的页", () => {
  it("agent 直接写也会被拒,而且说清为什么、下一步怎么做", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");
    await kb.setPageVerification("sources/a.md", true, "2026-10-10T10:00:00Z");

    await assert.rejects(
      () =>
        kb.writePage({
          path: "sources/a.md",
          type: "Source",
          title: "a.pdf",
          description: "改过的。",
          tags: [],
          body: "改过的正文",
          by: "wordless-agent/knowledge",
          now: "2026-10-11T09:00:00Z",
        }),
      /人工复核过的页.*报给用户/s,
    );
    // 页面一个字都没动。
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "sources/a.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.body, "内容");
  });

  it("取消复核之后就能写了(用户说了算)", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");
    await kb.setPageVerification("sources/a.md", true, "2026-10-10T10:00:00Z");
    await kb.setPageVerification("sources/a.md", false, "2026-10-10T11:00:00Z");

    const written = await kb.writePage({
      path: "sources/a.md",
      type: "Source",
      title: "a.pdf",
      description: "改过的。",
      tags: [],
      body: "改过的正文",
      by: "wordless-agent/knowledge",
      now: "2026-10-11T09:00:00Z",
    });
    assert.equal(written.action, "update");
  });

  it("标记复核只动 frontmatter,正文一个字不改", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "正文别动我", "sources/a.md", "2026-10-10T09:00:00Z");
    await kb.setPageVerification("sources/a.md", true, "2026-10-10T10:00:00Z");
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "sources/a.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.body, "正文别动我");
    assert.equal(isHumanVerified(parsed.page), true);
  });
});

describe("一轮真跑:复核过的页不会被自动改写", () => {
  it("来源变了 → 进 needsReview,不进待办;页面的内容保持人工那一版", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "第一版", "sources/a.md", "2026-10-10T09:00:00Z");
    // 人改了这一页并复核。
    await kb.writePage({
      path: "sources/a.md",
      type: "Source",
      title: "a.pdf",
      description: "人工整理过的。",
      tags: ["人工"],
      body: "人工整理过的正文",
      by: "human:local",
      now: "2026-10-10T10:00:00Z",
    });
    await kb.setPageVerification("sources/a.md", true, "2026-10-10T10:00:00Z");

    // 原始文件变了。
    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "第二版", "utf-8");
    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");

    assert.equal(plan.needsProcessing, false, "复核过的页不该让 agent 起会话");
    assert.deepEqual(plan.needsReview, [{ pagePath: "sources/a.md", resource: "/raws/a.pdf" }]);
    const parsed = parseKnowledgePage(await readFile(join(kb.bundleRoot, "sources/a.md"), "utf-8"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.body, "人工整理过的正文", "人工那一版必须原样保留");
  });

  it("**先被标孤儿、之后**才复核的页:回收跳过它,并报出来", async () => {
    // 这是复核页**唯一**还会走到回收那一步的路径:标记先发生(原文被删),
    // 用户在宽限期里为它背书。
    //
    // 反过来的顺序(先复核、后删原文)现在**根本不会被标孤儿** —— 见下面那条,
    // 那是"保留"这条后路能顶住下一轮的机制。
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");
    await rm(join(kb.bundleRoot, "raws/a.pdf"));
    await kb.prepareRound("2026-10-11T09:00:00Z"); // 标孤儿
    await kb.setPageVerification("sources/a.md", true, "2026-10-11T10:00:00Z"); // 宽限期里背书
    const plan = await kb.prepareRound("2026-10-12T09:00:00Z"); // 该回收了,但复核过

    assert.deepEqual(plan.reaped, [], "一个人为它背书过的页不该被定时器删掉");
    assert.deepEqual(plan.needsReview, [{ pagePath: "sources/a.md", resource: "/raws/a.pdf" }]);
    // 页还在。
    assert.equal((await readFile(join(kb.bundleRoot, "sources/a.md"), "utf-8")).length > 0, true);
  });

  it("复核过之后原文才被删的页:根本不会再被标孤儿", async () => {
    // 用户已经说了"留着它",所以连标记都不该打上去 —— 每轮再报一次"要不要处理"
    // 是把已经做过的决定重新问一遍。
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "内容", "sources/a.md", "2026-10-10T09:00:00Z");
    await kb.setPageVerification("sources/a.md", true, "2026-10-10T10:00:00Z");
    await rm(join(kb.bundleRoot, "raws/a.pdf"));

    const plan = await kb.prepareRound("2026-10-11T09:00:00Z");
    assert.deepEqual(plan.diff.deleted, [], "不再催 agent 去合并/重指");
    assert.deepEqual(plan.needsReview, []);
    assert.equal((await kb.snapshot()).pages[0]!.orphaned, false, "不再是待回收的");
  });

  it("快照把「复核过期」算出来给界面", async () => {
    const kb = service();
    await kb.ensureBundle();
    await ingest(kb, "a.pdf", "第一版", "sources/a.md", "2026-10-10T09:00:00Z");
    await kb.setPageVerification("sources/a.md", true, "2026-10-10T10:00:00Z");

    let snapshot = await kb.snapshot();
    assert.deepEqual({ verified: snapshot.pages[0]!.verified, stale: snapshot.pages[0]!.reviewStale }, { verified: true, stale: false });

    await writeFile(join(kb.bundleRoot, "raws/a.pdf"), "第二版", "utf-8");
    snapshot = await kb.snapshot();
    assert.equal(snapshot.pages[0]!.reviewStale, true, "来源变了,复核就过期了");
  });
});
