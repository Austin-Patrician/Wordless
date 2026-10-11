import {
  KNOWLEDGE_CONCEPTS_DIR,
  KNOWLEDGE_ENTITIES_DIR,
  KNOWLEDGE_INDEX_FILE,
  KNOWLEDGE_LOG_FILE,
  KNOWLEDGE_SOURCES_DIR,
  KNOWLEDGE_TYPE_DIRECTORIES,
  directoryOf,
} from "./knowledge-layout.ts";
import type { KnowledgePage, KnowledgePageType } from "./knowledge-schema.ts";

/**
 * 派生产物:`index.md` 与 `log.md`,以及 bundle 的一致性检查。
 *
 * 这两个文件由**工程**生成,agent 不许写。理由与 open-vetta 把目录改成自动生成是同一条:
 * 让 LLM 每轮手写目录,迟早会漂 —— 而"目录与实际内容不一致"是最难发现的一类坏,因为它看起来
 * 一切正常,只是检索找不到东西。
 *
 * 派生意味着**可重建**:删掉这两个文件,下一次重建就回来了。它们是 frontmatter 的函数。
 */

export interface KnowledgePageEntry {
  /** 相对 bundle 根的 posix 路径。 */
  path: string;
  page: KnowledgePage;
  /** 正文(不含 frontmatter)。体检要从中抽链接,所以它跟着页面一起返回。 */
  body: string;
}

const isLive = (page: KnowledgePage): boolean => page.private?.orphaned_at == null;

/** index.md 的抬头。写明"自动生成、请勿手改",免得有人(或模型)去改它。 */
const INDEX_HEADER = `# Knowledge base

> Generated from page frontmatter — do not edit by hand. Rebuilt on every processing round.
`;

const SECTION_TITLES: Record<string, string> = {
  [KNOWLEDGE_SOURCES_DIR]: "Sources",
  [KNOWLEDGE_CONCEPTS_DIR]: "Concepts",
  [KNOWLEDGE_ENTITIES_DIR]: "Entities",
};

/**
 * 生成 `index.md`(OKF §8:分节的链接 + 一句话描述)。
 *
 * 它是**渐进披露的入口**:先看目录(便宜),再下钻读页(贵)。所以每条只给标题、描述与链接 ——
 * 正文不进目录,否则目录自己就变成了一个读不完的文件。
 *
 * 最后一段列出**还没有页的原始文件**。它回答的是"这一轮还剩什么没做",而不是"库里有什么";
 * 少了它,agent 只能靠数目录来猜。
 */
export function buildKnowledgeIndex(entries: KnowledgePageEntry[], pendingRawPaths: string[] = []): string {
  const live = entries.filter((entry) => isLive(entry.page));
  const sections: string[] = [];

  for (const [directory, title] of Object.entries(SECTION_TITLES)) {
    const pages = live
      .filter((entry) => directoryOf(entry.path) === directory)
      .sort((a, b) => a.page.title.localeCompare(b.page.title) || a.path.localeCompare(b.path));
    if (pages.length === 0) continue;
    const lines = pages.map((entry) => {
      const description = entry.page.description.trim();
      const link = `[${entry.page.title}](/${entry.path})`;
      return `* ${link}${description === "" ? "" : ` - ${description}`}`;
    });
    sections.push(`## ${title}\n\n${lines.join("\n")}`);
  }

  const pending = [...new Set(pendingRawPaths)].sort((a, b) => a.localeCompare(b));
  if (pending.length > 0) {
    sections.push(`## Not processed yet\n\n${pending.map((path) => `* ${path}`).join("\n")}`);
  }

  const body = sections.length > 0 ? sections.join("\n\n") : "_The knowledge base has no pages yet._";
  return `${INDEX_HEADER}\n${body}\n`;
}

const LOG_HEADER = `# Knowledge base log

> Append-only history, newest first — written by the processing round, not by hand.
`;

/** 日志条目的种类。OKF §9 只约定"开头加粗的那个词",这几个是我们用的。 */
export type KnowledgeLogKind = "Creation" | "Update" | "Ingest" | "Deprecation";

/**
 * 一轮的日志事实。
 *
 * **计划与产出分开写**:以前日志只记计划(diff 的 added/changed),于是"计划 +1、实际 0 页"
 * 会写成 `加工:+1` —— 系统报告成功,用户以为成功了。产出必须来自轮末对账。
 */
export interface RoundLogFacts {
  /** 计划里的工程动作。 */
  added: number;
  changed: number;
  moved: number;
  deleted: number;
  reaped: number;
  /** 真跑过 agent 时的产出;没跑(只有工程动作)就是 null。 */
  result: { written: number; failed: number; gone: number } | null;
}

export function roundLogKind(facts: RoundLogFacts): KnowledgeLogKind {
  // 写成过页才算 Creation;否则只是工程侧的增删改。
  return facts.result !== null && facts.result.written > 0 ? "Creation" : "Update";
}

/**
 * 时间线那一行。
 *
 * 跑过 agent 的轮次,**产出在前**(那是"成没成"的答案),计划在后当细节;
 * 只有工程动作的轮次就说那些动作 —— 说"写成 0 页"会让一件正常的事看起来像失败。
 */
export function formatRoundLogLine(facts: RoundLogFacts): string {
  const plan = `计划 +${facts.added} ~${facts.changed}`;
  const engineering = `移动 ${facts.moved},删除 ${facts.deleted},回收 ${facts.reaped}`;
  if (facts.result === null) return `${engineering}(${plan})`;
  const gone = facts.result.gone > 0 ? `,${facts.result.gone} 个原文已删除` : "";
  return `写成 ${facts.result.written} 页,未成 ${facts.result.failed} 页${gone}(${plan},${engineering})`;
}

export interface KnowledgeLogEntry {
  /** ISO 时间戳。日期部分作为分组标题。 */
  at: string;
  kind: KnowledgeLogKind;
  text: string;
}

/**
 * 往 `log.md` 追加一条(OKF §9:按日期分组、最新在上)。
 *
 * 存在的意义是**让下一次加工知道上一次做了什么** —— 尤其是"哪些页是刚建的""哪些被标成孤儿",
 * 这些跨轮次的事实不在 frontmatter 里。
 */
export function appendKnowledgeLog(existing: string, entry: KnowledgeLogEntry): string {
  const date = entry.at.slice(0, 10);
  const line = `* **${entry.kind}**: ${entry.text.trim()}`;
  const content = existing.trim() === "" ? LOG_HEADER.trim() : existing.trim();
  const lines = content.split("\n");

  // 找到第一个日期标题(形如 `## 2026-10-10`)。
  const headingIndex = lines.findIndex((line) => /^## \d{4}-\d{2}-\d{2}$/.test(line.trim()));
  if (headingIndex === -1) {
    // 还没有任何日期分组:抬头之后就是今天的。
    return `${content}\n\n## ${date}\n\n${line}\n`;
  }

  if (lines[headingIndex]!.trim() === `## ${date}`) {
    // 同一天:插到这一天已有条目的最前面(最新在上)。
    let insertAt = headingIndex + 1;
    while (insertAt < lines.length && lines[insertAt]!.trim() === "") insertAt += 1;
    lines.splice(insertAt, 0, line);
    return `${lines.join("\n").trim()}\n`;
  }

  // 新的日期:插到第一个日期分组之前。
  const head = lines.slice(0, headingIndex).join("\n").trimEnd();
  const tail = lines.slice(headingIndex).join("\n").trim();
  return `${head}\n\n## ${date}\n\n${line}\n\n${tail}\n`;
}

export interface KnowledgeConformanceInput {
  /** 非保留的 `.md` 文件:相对路径 + 解析结果。 */
  pages: Array<{ path: string; ok: boolean; issue?: string; type?: KnowledgePageType }>;
  index: string | undefined;
  log: string | undefined;
  /** 应当出现在 index.md 里的活页(相对路径)。 */
  livePagePaths: string[];
}

/**
 * bundle 的一致性检查(OKF §11 + 我们自己的两条不变量)。
 *
 * OKF §11 的三条:每个非保留 `.md` 有可解析的 frontmatter、有非空 `type`、保留文件符合
 * §8/§9 的结构。我们另加两条:
 *   - **类型与目录一致**(`sources/` 下必须是 `type: Source`)—— 人靠目录认东西,目录骗人就白搭;
 *   - **index.md 覆盖所有活页** —— 目录漂了是最难发现的一类坏。
 *
 * 返回问题清单(空 = 一致)。这是 CI 里的那条守卫,也是"我们没写成四不像"的机械证据。
 */
export function checkKnowledgeConformance(input: KnowledgeConformanceInput): string[] {
  const issues: string[] = [];

  const typeOfDirectory = new Map<string, KnowledgePageType>(
    Object.entries(KNOWLEDGE_TYPE_DIRECTORIES).map(([type, directory]) => [directory, type as KnowledgePageType]),
  );

  for (const page of input.pages) {
    if (!page.ok) {
      issues.push(`${page.path}: ${page.issue ?? "frontmatter 无法解析"}`);
      continue;
    }
    // 只约束落在已知页面目录下的文件;用户自己在 bundle 里放的东西不在此列。
    const expected = typeOfDirectory.get(directoryOf(page.path));
    if (expected !== undefined && page.type !== expected) {
      issues.push(`${page.path}: 在 ${directoryOf(page.path)}/ 下,type 必须是 ${expected},收到 ${page.type ?? "(缺失)"}`);
    }
  }

  if (input.index === undefined) {
    issues.push(`缺少 ${KNOWLEDGE_INDEX_FILE}(它应由工程重建)`);
  } else {
    for (const path of input.livePagePaths) {
      if (!input.index.includes(`(/${path})`)) issues.push(`${KNOWLEDGE_INDEX_FILE} 里没有 ${path}`);
    }
  }

  if (input.log === undefined) {
    issues.push(`缺少 ${KNOWLEDGE_LOG_FILE}(它应由工程追加)`);
  } else if (!/^## \d{4}-\d{2}-\d{2}$/m.test(input.log)) {
    issues.push(`${KNOWLEDGE_LOG_FILE} 里没有任何日期分组(OKF §9 要求按日期分组)`);
  }

  return issues;
}
