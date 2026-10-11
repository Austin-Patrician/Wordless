import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createKnowledgeReadTools, createKnowledgeWriteTools } from "@wordless/capability-knowledge";

/** 端到端测试要覆盖全部三个工具,所以两组都装。 */
const createKnowledgeTools = (port: Parameters<typeof createKnowledgeReadTools>[0]) => [
  ...createKnowledgeReadTools(port),
  ...createKnowledgeWriteTools(port),
];
import { createKnowledgePort } from "../src/main/knowledge/knowledge-port.ts";
import { KnowledgeService } from "../src/main/knowledge/knowledge-service.ts";

/**
 * 知识库的端到端链路:**真 bundle → 服务 → 适配层 → 工具**。
 *
 * 为什么这个文件能同时 import 能力包与宿主:知识库能力包的 `port.ts` 只有类型,于是它没有
 * 运行时的相对导入,`node --test` 能直接加载它(与 `capability-documents` 同一个做法)。
 *
 * 这里测的是**模型实际看到的东西**:写进去的页能不能被查回来、目录会不会漂、以及路径规则
 * 在真文件上是否成立。单测各自覆盖了一半,这个文件覆盖"接起来还对"。
 */

let directory = "";
/** 每个用例一个独立的库:共享一个 bundle 会让"库里现在有几页"随执行顺序变化。 */
let bundles = 0;
const service = () => new KnowledgeService(join(directory, `kb-${(bundles += 1)}`));

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-knowledge-tools-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

type Tool = ReturnType<typeof createKnowledgeTools>[number];
type ToolResult = { content: Array<{ type: string; text?: string }>; details: Record<string, unknown> };

const textOf = (result: ToolResult): string =>
  result.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");

async function run(tools: Tool[], name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return (await tool.execute("call", input as never)) as unknown as ToolResult;
}

describe("知识库端到端:写页 → 目录 → 查回", () => {
  it("agent 用工具建页,目录自动覆盖,查询能查回来", async () => {
    const kb = service();
    await kb.ensureBundle();
    const tools = createKnowledgeTools(createKnowledgePort(async () => kb));

    // 投递箱里放一个原始文件(用户拖进去的),加工时它要被读出来。
    await writeFile(join(kb.bundleRoot, "raws/2024合同.pdf"), "raw-bytes", "utf-8");
    const hash = await kb.hashRawFile("2024合同.pdf");

    const created = await run(tools, "kb_write_page", {
      path: "sources/2024合同.md",
      kind: "Source",
      title: "2024 供应商合同",
      description: "年度采购框架,含付款条款。",
      tags: ["合同", "采购"],
      sources: [{ id: "contract", resource: "/raws/2024合同.pdf" }],
      body: "## 付款条款\n\n月结 30 天。",
      sourceHash: hash,
    });
    assert.match(textOf(created), /Created sources\/2024合同\.md/);

    // 目录由工程重建:活页被列出,已加工的原始文件从"待办"里消失。
    await kb.rebuildIndex();
    const index = await readFile(join(kb.bundleRoot, "index.md"), "utf-8");
    assert.match(index, /\* \[2024 供应商合同\]\(\/sources\/2024合同\.md\) - 年度采购框架/);
    assert.doesNotMatch(index, /## Not processed yet/);

    // 查得回来,且能顺路径去读正文。
    const queried = await run(tools, "kb_query", { all: ["合同"] });
    assert.match(textOf(queried), /sources\/2024合同\.md/);
    assert.match(await readFile(join(kb.bundleRoot, "sources/2024合同.md"), "utf-8"), /月结 30 天/);

    // 词表收得回来。
    const tags = await run(tools, "kb_list_tags");
    assert.match(textOf(tags), /- 合同 \(1\)/);
  });

  it("原始文件与派生物在真文件上写不进去(路径规则不是提示词约定)", async () => {
    const kb = service();
    await kb.ensureBundle();
    const tools = createKnowledgeTools(createKnowledgePort(async () => kb));

    for (const path of ["raws/偷写.md", "index.md", "log.md"]) {
      const result = await run(tools, "kb_write_page", {
        path,
        kind: "Source",
        title: "x",
        description: "x",
        tags: [],
        body: "x",
      });
      assert.match(textOf(result), /Could not write the page/, path);
    }
    // 确认真的没写进去。
    await assert.rejects(() => readFile(join(kb.bundleRoot, "raws/偷写.md"), "utf-8"));
  });

  it("类型与目录不一致时被拒,并说清该放哪", async () => {
    const kb = service();
    await kb.ensureBundle();
    const tools = createKnowledgeTools(createKnowledgePort(async () => kb));
    const result = await run(tools, "kb_write_page", {
      path: "sources/概念页.md",
      kind: "Concept",
      title: "x",
      description: "x",
      tags: [],
      body: "x",
    });
    assert.match(textOf(result), /类型必须与目录一致/);
  });

  it("手改坏的页只影响它自己:其余页照常可用,且坏页被如实报出", async () => {
    const kb = service();
    await kb.ensureBundle();
    const tools = createKnowledgeTools(createKnowledgePort(async () => kb));
    await run(tools, "kb_write_page", { path: "concepts/好页.md", kind: "Concept", title: "好页", description: "好的。", tags: ["测试"], body: "正文。" });
    await writeFile(join(kb.bundleRoot, "concepts/坏页.md"), "手改坏了", "utf-8");

    const stats = await kb.stats();
    assert.deepEqual({ pages: stats.pages, damaged: stats.damaged }, { pages: 1, damaged: 1 });

    const queried = await run(tools, "kb_query");
    assert.match(textOf(queried), /1 page\(s\) matched/);
    assert.match(textOf(queried), /concepts\/好页\.md/);
  });
});
