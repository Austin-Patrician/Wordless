import { describe, expect, it } from "vitest";
import {
  createKnowledgeReadTools,
  createKnowledgeWriteTools,
  filterByTags,
  type KnowledgePageView,
  type KnowledgePort,
} from "../src/index.ts";

/** 全部三个工具(读两个 + 写一个),测试里当作一个面来断言。 */
const createKnowledgeTools = (port: KnowledgePort) => [...createKnowledgeReadTools(port), ...createKnowledgeWriteTools(port)];

/**
 * 知识库工具。
 *
 * 三件必须钉住的事:
 *   1. **写页失败要说清哪一条不对** —— 封闭 schema 的价值就在这里,吞掉它就白设了;
 *   2. **查不到时不许下结论** —— 标签只是捷径,空结果必须给出继续探索的路;
 *   3. **空查询 = 全部活页**,而孤儿页永不出现(它等着被回收)。
 */

type Tool = ReturnType<typeof createKnowledgeReadTools>[number];
type ToolResult = { content: Array<{ type: string; text?: string }>; details: Record<string, unknown> };

const PAGES: KnowledgePageView[] = [
  { path: "sources/合同.md", kind: "Source", title: "2024 合同", description: "采购框架。", tags: ["合同", "采购"], sources: ["/raws/合同.pdf"], orphaned: false },
  { path: "concepts/发票流程.md", kind: "Concept", title: "发票流程", description: "开票到抵扣。", tags: ["税务", "发票"], sources: ["/raws/合同.pdf"], orphaned: false },
  { path: "entities/某某公司.md", kind: "Entity", title: "某某公司", description: "供应商。", tags: ["供应商"], sources: [], orphaned: false },
  { path: "sources/旧页.md", kind: "Source", title: "旧页", description: "已删源的页。", tags: ["合同"], sources: [], orphaned: true },
];

function port(options: { writeError?: string } = {}): { port: KnowledgePort; written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    port: {
      listPages: async () => PAGES,
      retirePage: async (path) => {
        if (options.writeError) throw new Error(options.writeError);
        written.push({ retire: path });
      },
      writePage: async (input) => {
        if (options.writeError) throw new Error(options.writeError);
        written.push(input);
        return { path: input.path, action: "create" };
      },
    },
  };
}

function textOf(result: ToolResult): string {
  return result.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

async function run(tools: Tool[], name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return (await tool.execute("call", input as never)) as unknown as ToolResult;
}

describe("工具面", () => {
  it("读两个、写两个,分组本身就是约定的一部分", () => {
    const { port: knowledgePort } = port();
    // 分成两组不是组织方式问题:读工具进每个画像,写工具只在加载了约定的画像上装配。
    expect(createKnowledgeReadTools(knowledgePort).map((tool) => tool.name)).toEqual(["kb_query", "kb_list_tags"]);
    // 退役算"写":它会改变库(标成孤儿 → 下一轮回收)。没有它,Lint 判出重复页之后什么都做不了。
    expect(createKnowledgeWriteTools(knowledgePort).map((tool) => tool.name)).toEqual(["kb_write_page", "kb_retire_page"]);
  });

  it("描述里钉住了各自的边界(比长度更重要的那几句)", () => {
    const descriptions = new Map(createKnowledgeTools(port().port).map((tool) => [tool.name, tool.description]));
    // 唯一写入口:必须说清"只有这一条路"以及"什么写不了"。
    expect(descriptions.get("kb_write_page")).toContain("ONLY way to write");
    expect(descriptions.get("kb_write_page")).toContain("What you cannot write");
    // 查询口:必须说清它只是捷径,否则模型会把"没查到"当成"库里没有"。
    expect(descriptions.get("kb_query")).toContain("NOT the only way");
    // 词表口:必须说清"打标签前先看它",否则词表会发散。
    expect(descriptions.get("kb_list_tags")).toContain("before tagging");
  });
});

describe("kb_write_page", () => {
  it("把模型的意图原样交给端口(路径、类型、来源、hash)", async () => {
    const { port: knowledgePort, written } = port();
    await run(createKnowledgeTools(knowledgePort), "kb_write_page", {
      path: "sources/合同.md",
      kind: "Source",
      title: "2024 合同",
      description: "采购框架。",
      tags: ["合同"],
      sources: [{ id: "contract", resource: "/raws/合同.pdf" }],
      body: "正文。",
      sourceHash: "abc",
    });
    expect(written[0]).toMatchObject({ path: "sources/合同.md", kind: "Source", sourceHash: "abc", tags: ["合同"] });
  });

  it("校验失败时把原因带给模型,而不是一句「失败了」", async () => {
    const { port: knowledgePort } = port({ writeError: "标签最多 5 个,收到 6 个" });
    const text = textOf(await run(createKnowledgeTools(knowledgePort), "kb_write_page", { path: "sources/x.md", kind: "Source", title: "x", description: "x", tags: [], body: "x" }));
    expect(text).toContain("Could not write the page");
    expect(text).toContain("标签最多 5 个");
  });
});

describe("kb_query", () => {
  it("空查询返回全部活页,孤儿页永不出现", async () => {
    const text = textOf(await run(createKnowledgeTools(port().port), "kb_query"));
    expect(text).toContain("3 page(s) matched");
    expect(text).not.toContain("旧页");
  });

  it("all / any / none 的集合语义", () => {
    const live = PAGES.filter((page) => !page.orphaned);
    expect(filterByTags(live, { all: ["合同", "采购"], any: [], none: [] }).map((p) => p.path)).toEqual(["sources/合同.md"]);
    expect(filterByTags(live, { all: [], any: ["税务", "供应商"], none: [] }).map((p) => p.path)).toEqual(["concepts/发票流程.md", "entities/某某公司.md"]);
    expect(filterByTags(live, { all: [], any: [], none: ["合同"] }).map((p) => p.path)).toEqual(["concepts/发票流程.md", "entities/某某公司.md"]);
    // 三者取交集
    expect(filterByTags(live, { all: [], any: ["合同", "税务"], none: ["合同"] }).map((p) => p.path)).toEqual(["concepts/发票流程.md"]);
    // 大小写与空白归一
    expect(filterByTags(live, { all: [" 合同 "], any: [], none: [] }).length).toBe(1);
  });

  it("查不到时给出继续探索的路,而不是让人以为库里没有", async () => {
    const text = textOf(await run(createKnowledgeTools(port().port), "kb_query", { all: ["不存在的标签"] }));
    expect(text).toContain("No page matched");
    expect(text).toContain("do NOT conclude the knowledge base lacks the answer");
    expect(text).toContain("kb_list_tags");
    expect(text).toContain("index.md");
  });

  it("命中时提示这是捷径,并指向读页", async () => {
    const text = textOf(await run(createKnowledgeTools(port().port), "kb_query", { any: ["税务"] }));
    expect(text).toContain("concepts/发票流程.md");
    expect(text).toContain("read tool");
  });
});

describe("kb_list_tags", () => {
  it("按使用频次列出词表,并提醒复用", async () => {
    const text = textOf(await run(createKnowledgeTools(port().port), "kb_list_tags"));
    expect(text).toContain("- 合同 (1)");
    expect(text).toContain("Reuse these where they fit");
    // 孤儿页的标签不该进词表:它等着被回收。
    expect(text).toContain("5 tag(s)");
  });

  it("还没有标签时说清该怎么办", async () => {
    const empty: KnowledgePort = {
    listPages: async () => [],
    retirePage: async () => undefined,
    writePage: async () => ({ path: "", action: "create" }),
  };
    const text = textOf(await run(createKnowledgeTools(empty), "kb_list_tags"));
    expect(text).toContain("no tags yet");
  });
});

describe("kb_retire_page", () => {
  it("把退役交给端口,并说清它不立刻删", async () => {
    const { port: knowledgePort, written } = port();
    const text = textOf(await run(createKnowledgeTools(knowledgePort), "kb_retire_page", { path: "concepts/重复.md", reason: "已并入 concepts/流程.md" }));
    expect(written[0]).toEqual({ retire: "concepts/重复.md" });
    expect(text).toContain("Retired concepts/重复.md");
    // 说清它不是删除 —— 否则模型会以为那一页已经没了。
    expect(text).toContain("removed after the next round");
  });

  it("被拒绝时把原因带给模型(人工复核过的页不能退役)", async () => {
    const { port: knowledgePort } = port({ writeError: "concepts/x.md 是人工复核过的页,不能退役。" });
    const text = textOf(await run(createKnowledgeTools(knowledgePort), "kb_retire_page", { path: "concepts/x.md", reason: "重复" }));
    expect(text).toContain("Could not retire the page");
    expect(text).toContain("人工复核过");
  });
});
