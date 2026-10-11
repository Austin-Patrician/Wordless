import type { KnowledgePageType } from "./knowledge-schema.ts";

/**
 * 知识库体检(**纯逻辑**,不做 IO)。
 *
 * Karpathy 的第三个操作是"定期让 LLM 给 wiki 做体检"。它列的问题里,**有一半是能算的**:
 * 死链、孤立页、没有来源的页、标题撞车的页 —— 这些不需要模型,而且模型算它们**不可靠**
 * (它得把整库读进上下文才数得清链接)。
 *
 * 所以这里的分工是:
 *   - **算得出来的,工程算**(本模块),结果作为**事实**交给模型;
 *   - **要判断的,交给模型**(矛盾、过期论断、缺页的概念、缺的交叉引用)—— 见轮次 prompt。
 *
 * 这条分工很重要:让模型去数死链,它会漏、会编,而且每次结果不一样;而算出来的清单它一眼就能用。
 */

/** 体检需要的一页:路径、类型、标题、正文、状态。 */
export interface LintPage {
  /** 相对 bundle 根的路径(如 `concepts/流程.md`)。 */
  path: string;
  kind: KnowledgePageType;
  title: string;
  body: string;
  orphaned: boolean;
  verified: boolean;
  /** 这一页声明的来源(bundle 相对路径)。 */
  sources: string[];
}

export interface KnowledgeHealthReport {
  /** 指向**不存在的页**的链接。模型据此修链接或删掉它。 */
  deadLinks: Array<{ pagePath: string; link: string }>;
  /** 没有任何**活页**指向它的活页。孤立的知识等于不存在 —— 检索走不到它。 */
  orphans: Array<{ pagePath: string }>;
  /** 概念页/实体页却**没写来源**。综合出来的结论却不说从哪来,无法核。 */
  unsourced: Array<{ pagePath: string }>;
  /** 标题撞车的页(归一后相同)。**这是重复概念页最可靠的信号** —— 不做模糊匹配,免得误导。 */
  duplicateTitles: Array<{ title: string; pagePaths: string[] }>;
}

/**
 * 从正文里抽出**bundle 相对链接**。
 *
 * 只认 `](/path.md)` 这一种形态:它是我们在加工约定里要求 agent 用的形式(OKF §6)。
 * 不认 `[[id]]`、不认相对路径、不认外链 —— 认多了会把外部 URL 当成页内链接,然后报一堆假死链。
 */
export function extractBundleLinks(body: string): string[] {
  const links: string[] = [];
  // 允许带锚点(`/concepts/x.md#段`):它指向的**是**那一页,只是定位到某一段。
  for (const match of body.matchAll(/\]\((\/[^)\s]+\.md)(?:#[^)\s]*)?\)/g)) {
    const link = match[1];
    if (link !== undefined) links.push(link);
  }
  return links;
}

/** 归一标题:去空白、转小写。用于找"标题撞车"的页。 */
const normalizeTitle = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, "");

export function buildHealthReport(pages: LintPage[]): KnowledgeHealthReport {
  const live = pages.filter((page) => !page.orphaned);
  // 链接是 bundle 相对(`/concepts/x.md`),页路径是相对 bundle 根(`concepts/x.md`):
  // 两边都归一到"相对路径"再比,免得因为一个前导斜杠整库都算死链。
  const knownPaths = new Set(pages.map((page) => page.path));
  const linkedPaths = new Set<string>();

  const deadLinks: KnowledgeHealthReport["deadLinks"] = [];
  for (const page of live) {
    for (const link of extractBundleLinks(page.body)) {
      const target = link.replace(/^\/+/, "");
      if (!knownPaths.has(target)) deadLinks.push({ pagePath: page.path, link });
      else linkedPaths.add(target);
    }
  }

  // 孤立页 = 没有任何**活页**指向它。
  //
  // 但库只有一页时不算:**边需要两个点**,一个点的图里"没有入边"是句空话。否则一个刚建好、
  // 只有一页的库每次体检都会报"孤立页",然后每次都白起一个会话。
  const orphans =
    live.length < 2 ? [] : live.filter((page) => !linkedPaths.has(page.path)).map((page) => ({ pagePath: page.path }));
  const unsourced = live
    .filter((page) => page.kind !== "Source" && page.sources.length === 0)
    .map((page) => ({ pagePath: page.path }));

  const byTitle = new Map<string, string[]>();
  for (const page of live) {
    const key = normalizeTitle(page.title);
    if (key === "") continue;
    byTitle.set(key, [...(byTitle.get(key) ?? []), page.path]);
  }
  const duplicateTitles = [...byTitle.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([title, pagePaths]) => ({ title, pagePaths: [...pagePaths].sort() }));

  return { deadLinks, orphans, unsourced, duplicateTitles };
}

/** 体检报告是不是"干净"的。干净 = 不需要起会话去处理。 */
export function isHealthReportClean(report: KnowledgeHealthReport): boolean {
  return (
    report.deadLinks.length === 0 &&
    report.orphans.length === 0 &&
    report.unsourced.length === 0 &&
    report.duplicateTitles.length === 0
  );
}
