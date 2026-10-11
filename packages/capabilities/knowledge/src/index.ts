// **类型**导出,不是值导出:`port.ts` 里只有接口,于是本包没有任何运行时的相对导入,
// 普通的 `node --test` 也能加载它(与 `capability-documents` 同一个理由)。
export type * from "./port.js";

import { Type, type TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@wordless/agent";
import type { KnowledgePageKind, KnowledgePageView, KnowledgePort } from "./port.js";

/**
 * 知识库工具。
 *
 * 三个,封顶。设计上的取舍与 open-vetta 一致:**能用提示词约束的就不加工具**。
 * 目录(`index.md`)、时间线(`log.md`)由宿主自动生成,不暴露成工具 —— 让模型维护它们,
 * 迟早会漂,而"目录与实际内容不一致"是最难发现的一类坏。
 *
 * 剩下的三个各有一件不可替代的事:
 *   - `kb_write_page` 是**唯一**的写入口:它守封闭 frontmatter schema、拒绝写原始文件与派生物;
 *   - `kb_query` 是标签集合运算的捷径(不是必经路);
 *   - `kb_list_tags` 给现有词表 —— 打标签前先看一眼,词表才不会发散。
 */

type ToolDetails = Record<string, unknown>;

/** 保留参数推断:每个工具的 `input` 由它的 schema 推出。 */
function tool<TParameters extends TSchema>(definition: AgentTool<TParameters, ToolDetails>): AgentTool<TParameters, ToolDetails> {
  return definition;
}

function text(value: string): AgentToolResult<ToolDetails>["content"] {
  return [{ type: "text", text: value }];
}

export const KNOWLEDGE_PAGE_KINDS: readonly KnowledgePageKind[] = ["Source", "Concept", "Entity"];

const WRITE_DESCRIPTION = `Write one page of the user's knowledge base (create or update).

This is the ONLY way to write pages. It enforces the page format, refuses to touch the raw source files, and refreshes the catalogue for you. Do not write knowledge-base files with the generic write tool.

Page kinds — the directory follows from the kind, so pick the kind first:
  - Source: one raw file turned into a page, 1:1. The raw file stays the source of truth; this page is its readable form. Always pass sourceHash (the hash of the raw file you were given) and a single sources entry.
  - Concept: a topic synthesised across several sources. Before creating one, read the catalogue (index.md) and reuse an existing page when the topic is already there — a knowledge base fragments when every source grows its own near-duplicate pages.
  - Entity: a person, organisation, product or project, also synthesised across sources.

Frontmatter is fixed: type, title, description, tags, sources. Extra fields are rejected, so put anything else in the body.
  - description: one sentence, no newlines. It is what the catalogue shows, so it decides whether anyone finds this page.
  - tags: at most 5, and they are a controlled vocabulary — call kb_list_tags first and reuse what is there. Coarse dimensions only (domain, topic, document type). No version numbers, no function names, no one-off proper nouns, nothing already in the title. Chinese for concepts; keep only proper nouns and tech names in their original form.
  - sources: the raw files (or URLs) this page derives from, as bundle-relative paths such as /raws/合同/2024.pdf.

Cross-page links go in the body as ordinary markdown links to bundle-relative paths: [标题](/concepts/流程.md). Never put them in frontmatter.

What you cannot write: anything under raws/ (the user's originals are read-only), and index.md or log.md (both are generated).`;

const QUERY_DESCRIPTION = `Find knowledge-base pages by their tags, using set algebra.

- all: intersection — the page must carry ALL of these tags
- any: union — the page must carry AT LEAST ONE of them
- none: complement — the page must carry NONE of them

The three combine with AND; an omitted or empty clause adds no constraint, and an empty query returns every live page. Orphaned pages are excluded. Returns each match's path, title and description so you can open the ones that matter with the read tool.

This is a shortcut, NOT the only way to find things. If it comes back empty, do not conclude the knowledge base lacks the answer: read index.md (the catalogue) first, retry with other tags from kb_list_tags, or search the text of the pages with grep.`;

const LIST_TAGS_DESCRIPTION = `List the tags currently used in the knowledge base, with how many pages carry each one.

Call this before tagging anything: the vocabulary is meant to stay small and converge, so reusing an existing tag beats inventing a near-synonym.`;

/**
 * **只读**工具:查页与词表。
 *
 * 与写工具分开导出,是因为它们该去的地方不同:读到处都安全(只读、不产生累积损伤,
 * 而"关于 X 我们知道什么"对所有工作类型都有用);写只在加载了约定的地方安全
 * (没有纪律的写入会让知识库碎片化,而碎片化累积且难回滚)。
 */
export function createKnowledgeReadTools(port: KnowledgePort): AgentTool[] {
  return [queryTool(port), listTagsTool(port)];
}

/**
 * **写**工具:唯一写入口 + 退役。只在整理场景装配。
 *
 * 退役是**第四个工具**,加它的理由很硬:没有它,Lint 判出重复页之后**什么都做不了** ——
 * 而"概念页碎片化"是这个设计里排第一的风险(见 §10)。它不叫 delete 是因为它不删:
 * 标成孤儿、宽限一轮、回收时顺手摘掉别处的引用。
 */
export function createKnowledgeWriteTools(port: KnowledgePort): AgentTool[] {
  return [writePageTool(port), retirePageTool(port)];
}

function retirePageTool(port: KnowledgePort): AgentTool {
  return tool({
    name: "kb_retire_page",
    label: "Retire a knowledge base page",
    description: `Retire one page: mark it as an orphan so it is removed after a grace period.

Use this when a page is genuinely superseded — a duplicate concept page whose content you have already merged elsewhere, or a page whose subject no longer exists. It is NOT a general delete:
  - The page is only marked now. It is physically removed a round later, and anyone writing to it in between rescues it.
  - References to it are cleaned up at that point (removed from other pages' sources, not left dangling).
  - A human-reviewed page is refused: a person vouched for it, so removing it is their call.

Merging is the usual reason to call this. If you merged a duplicate into another page, say so in your report — a retirement nobody explained is indistinguishable from a mistake.`,
    parameters: Type.Object({
      path: Type.String({ minLength: 1, description: 'Page path relative to the knowledge base root, e.g. "concepts/重复的流程.md".' }),
      reason: Type.String({
        minLength: 1,
        description: "Why it is being retired, and where its content went. Recorded in the log.",
      }),
    }),
    async execute(_id, input) {
      try {
        await port.retirePage(input.path, input.reason);
        return {
          content: text(`Retired ${input.path}. It will be removed after the next round unless something writes to it first.`),
          details: { path: input.path, reason: input.reason },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: text(`Could not retire the page: ${message}`), details: { error: message } };
      }
    },
  });
}

function writePageTool(port: KnowledgePort): AgentTool {
  return tool({
    name: "kb_write_page",
    label: "Write a knowledge base page",
    description: WRITE_DESCRIPTION,
    parameters: Type.Object({
      path: Type.String({
        minLength: 1,
        description:
          'Page path relative to the knowledge base root, e.g. "sources/2024合同.md" or "concepts/发票流程.md". The directory must match the kind.',
      }),
      kind: Type.Union(KNOWLEDGE_PAGE_KINDS.map((kind) => Type.Literal(kind)), {
        description: "Source (1:1 from a raw file), Concept (synthesised topic) or Entity (person/org/product).",
      }),
      title: Type.String({ minLength: 1 }),
      description: Type.String({ minLength: 1, description: "One sentence, no newlines. Shown in the catalogue." }),
      tags: Type.Array(Type.String(), { maxItems: 5, description: "At most 5, reused from kb_list_tags where possible." }),
      sources: Type.Optional(
        Type.Array(
          Type.Object({ id: Type.Optional(Type.String()), resource: Type.String() }),
          { description: "Provenance: bundle-relative paths such as /raws/合同/2024.pdf." },
        ),
      ),
      body: Type.String({ description: "Page body markdown, without frontmatter." }),
      sourceHash: Type.Optional(
        Type.String({ description: "Required for Source pages: the content hash of the raw file this page was made from." }),
      ),
    }),
    async execute(_id, input) {
      try {
        const outcome = await port.writePage({
          path: input.path,
          kind: input.kind as KnowledgePageKind,
          title: input.title,
          description: input.description,
          tags: input.tags,
          ...(input.sources === undefined ? {} : { sources: input.sources }),
          body: input.body,
          ...(input.sourceHash === undefined ? {} : { sourceHash: input.sourceHash }),
        });
        return {
          content: text(`${outcome.action === "create" ? "Created" : "Updated"} ${outcome.path}.`),
          details: { path: outcome.path, action: outcome.action },
        };
      } catch (error) {
        // 校验失败要说清**哪一条不对**:封闭 schema 的价值就在这里,吞掉它就白设了。
        const message = error instanceof Error ? error.message : String(error);
        return { content: text(`Could not write the page: ${message}`), details: { error: message } };
      }
    },
  });

}

function queryTool(port: KnowledgePort): AgentTool {
  return tool({
    name: "kb_query",
    label: "Query knowledge base pages by tags",
    description: QUERY_DESCRIPTION,
    parameters: Type.Object({
      all: Type.Optional(Type.Array(Type.String(), { description: "Pages must carry ALL of these tags." })),
      any: Type.Optional(Type.Array(Type.String(), { description: "Pages must carry AT LEAST ONE of these tags." })),
      none: Type.Optional(Type.Array(Type.String(), { description: "Pages must carry NONE of these tags." })),
    }),
    async execute(_id, input) {
      const pages = (await port.listPages()).filter((page) => !page.orphaned);
      const matched = filterByTags(pages, { all: input.all ?? [], any: input.any ?? [], none: input.none ?? [] });
      const details = { count: matched.length, paths: matched.map((page) => page.path) };
      if (matched.length === 0) {
        return {
          content: text(
            "No page matched those tags.\n\nTags are only a shortcut — do NOT conclude the knowledge base lacks the answer. Keep exploring: read index.md (the catalogue) to see what is actually there, call kb_list_tags for the real vocabulary and retry, or grep the text of the pages under sources/, concepts/ and entities/.",
          ),
          details,
        };
      }
      const listing = matched
        .map((page) => `- ${page.path} — ${page.title}: ${page.description}`)
        .join("\n");
      return {
        content: text(
          `${matched.length} page(s) matched:\n${listing}\n\nRead the ones that look relevant with the read tool. If none of them actually answers the question, keep exploring rather than settling: the catalogue (index.md) and a text search are both legitimate routes.`,
        ),
        details,
      };
    },
  });

}

function listTagsTool(port: KnowledgePort): AgentTool {
  return tool({
    name: "kb_list_tags",
    label: "List knowledge base tags",
    description: LIST_TAGS_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const counts = new Map<string, number>();
      for (const page of await port.listPages()) {
        if (page.orphaned) continue;
        for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (sorted.length === 0) {
        return { content: text("The knowledge base has no tags yet. Pick coarse, reusable ones."), details: { count: 0 } };
      }
      const listing = sorted.map(([tag, count]) => `- ${tag} (${count})`).join("\n");
      return {
        content: text(`${sorted.length} tag(s) in use, most used first:\n${listing}\n\nReuse these where they fit; invent a new tag only when none of them does.`),
        details: { count: sorted.length },
      };
    },
  });
}

export interface KnowledgeTagQuery {
  all: readonly string[];
  any: readonly string[];
  none: readonly string[];
}

/**
 * 标签集合运算:三者取交集(OKF 无关,纯集合代数)。
 *
 * 空子句不加约束 —— 于是"什么都不传"等于"列出全部活页",这正是调用方要的语义。
 */
export function filterByTags(pages: KnowledgePageView[], query: KnowledgeTagQuery): KnowledgePageView[] {
  const all = query.all.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const any = query.any.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  const none = query.none.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  return pages.filter((page) => {
    const tags = new Set(page.tags.map((tag) => tag.toLowerCase()));
    if (all.length > 0 && !all.every((tag) => tags.has(tag))) return false;
    if (any.length > 0 && !any.some((tag) => tags.has(tag))) return false;
    if (none.length > 0 && none.some((tag) => tags.has(tag))) return false;
    return true;
  });
}
