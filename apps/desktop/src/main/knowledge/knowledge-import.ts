import { parse as parseYaml } from "yaml";
import {
  KNOWLEDGE_MAX_TAGS,
  KNOWLEDGE_PAGE_STATUSES,
  KNOWLEDGE_PAGE_TYPES,
  normalizeTags,
  type KnowledgePage,
  type KnowledgePageStatus,
  type KnowledgePageType,
  type KnowledgeSourceRef,
} from "./knowledge-schema.ts";
import { KNOWLEDGE_TYPE_DIRECTORIES, directoryOf } from "./knowledge-layout.ts";

/**
 * 导入别人的 OKF bundle(**纯逻辑**)。
 *
 * 这是"OKF 的形"那个决策唯一兑现的收益:别人(或别的工具)按 OKF 写出来的库,我们能读进来。
 * 而它同时也撞上了本设计里那条刻意的冲突 ——
 *
 * > 我们的 frontmatter 是**封闭**的(生产者侧:我们自己不写未知字段),而 OKF 是**开放**的
 * > (消费者侧:不得因未知字段拒绝)。
 *
 * 所以导入这一侧必须**宽容**:读得懂的映射过来,读不懂的**如实报出来**,而不是让整页失败、
 * 也不是静默丢掉。丢掉是这里最坏的选项 —— 用户会以为"导进来了",而其实少了一部分。
 *
 * 三件事要处理:
 *   1. **未知字段**:聚合成一份清单(字段名 → 出现次数),不是逐页刷屏;
 *   2. **type 不在我们那三个里**:OKF 的 type 不集中注册,别人的库里有 `Metric`、`Playbook`
 *      之类。按目录映射(在 `concepts/` 下就是 Concept),没有目录线索才落到 Concept;
 *   3. **标签超上限**:截断并报出来(我们的上限是 5)。
 */

export interface ImportedPage {
  /** 在**来源** bundle 里的相对路径。 */
  path: string;
  /** 映射成我们 schema 的一页。 */
  page: KnowledgePage;
  body: string;
}

export interface ImportedBundle {
  pages: ImportedPage[];
  /** 来源里带的原始文件(相对 `raws/` 的路径)。 */
  raws: string[];
  /** 读不出来的文件 —— 要上报,不能静默少几页。 */
  damaged: Array<{ path: string; issue: string }>;
  /** 读得懂但不属于我们的字段:字段名 → 出现次数。 */
  droppedFields: Record<string, number>;
  /** 类型被映射过的页:原类型 → 次数。 */
  mappedTypes: Record<string, number>;
  /** 标签被截断的页数。 */
  truncatedTags: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 我们认识的字段。**其余的一律记进 `droppedFields`** —— 不静默丢,也不让整页失败。 */
const KNOWN_FIELDS = new Set(["type", "title", "description", "tags", "status", "sources", "generated", "verified", "x-wordless"]);

function parseFrontmatter(markdown: string): { raw: Record<string, unknown>; body: string } | { issue: string } {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) return { issue: "缺少 frontmatter(文件没有以 --- 开头)" };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { issue: "frontmatter 未闭合" };
  try {
    const raw = parseYaml(normalized.slice(4, end)) as unknown;
    if (!isRecord(raw)) return { issue: "frontmatter 不是对象" };
    return { raw, body: normalized.slice(end + 4).trim() };
  } catch (error) {
    return { issue: `frontmatter 不是合法 YAML:${error instanceof Error ? error.message : String(error)}` };
  }
}

/** 把来源的 `type` 映射到我们那三个之一。目录是线索,没有线索才落到 Concept。 */
function mapType(value: unknown, path: string): { type: KnowledgePageType; mappedFrom?: string } {
  const text = typeof value === "string" ? value.trim() : "";
  if ((KNOWLEDGE_PAGE_TYPES as readonly string[]).includes(text)) return { type: text as KnowledgePageType };
  // 目录线索优先:`concepts/` 下的就是 Concept —— 别人的 type 词汇表与我们不同,但目录结构
  // 是通用的(OKF §3 说目录由生产者自由组织,而"按类型分目录"是最常见的组织方式)。
  const byDirectory = Object.entries(KNOWLEDGE_TYPE_DIRECTORIES).find(([, directory]) => directory === directoryOf(path));
  if (byDirectory !== undefined) return { type: byDirectory[0] as KnowledgePageType, ...(text === "" ? {} : { mappedFrom: text }) };
  return { type: "Concept", ...(text === "" ? {} : { mappedFrom: text }) };
}

/** 来源的 `sources[].resource` 归一:`raws/x.pdf` 与 `/raws/x.pdf` 是同一条。 */
function mapSources(value: unknown): KnowledgeSourceRef[] {
  if (!Array.isArray(value)) return [];
  const sources: KnowledgeSourceRef[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.resource !== "string" || entry.resource.trim() === "") continue;
    const resource = entry.resource.trim();
    // 以 `/` 开头的保持原样(bundle 相对);其余当相对路径补上 `/` —— 别的工具常写成 `raws/x.pdf`。
    const normalized = resource.startsWith("/") || /^[a-z]+:\/\//i.test(resource) ? resource : `/${resource.replace(/^\/+/, "")}`;
    sources.push({ ...(typeof entry.id === "string" && entry.id !== "" ? { id: entry.id } : {}), resource: normalized });
  }
  return sources;
}

/** 来源的 `verified` 可以是单条映射,也可以是列表(OKF §5.2)。取第一条。 */
function mapVerified(value: unknown): KnowledgePage["verified"] {
  const single = Array.isArray(value) ? value[0] : value;
  if (!isRecord(single) || typeof single.by !== "string" || typeof single.at !== "string") return undefined;
  return { by: single.by, at: single.at };
}

/** 没有 title 就用文件名 —— 一页没有标题比一个丑标题更糟(目录里会显示空)。 */
function titleFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/, "");
}

export function readImportedBundle(files: Array<{ path: string; markdown: string }>, rawPaths: string[]): ImportedBundle {
  const pages: ImportedPage[] = [];
  const damaged: Array<{ path: string; issue: string }> = [];
  const droppedFields: Record<string, number> = {};
  const mappedTypes: Record<string, number> = {};
  let truncatedTags = 0;

  for (const file of files) {
    const parsed = parseFrontmatter(file.markdown);
    if ("issue" in parsed) {
      damaged.push({ path: file.path, issue: parsed.issue });
      continue;
    }
    const { raw, body } = parsed;

    for (const key of Object.keys(raw)) {
      if (KNOWN_FIELDS.has(key)) continue;
      droppedFields[key] = (droppedFields[key] ?? 0) + 1;
    }

    const { type, mappedFrom } = mapType(raw.type, file.path);
    if (mappedFrom !== undefined) mappedTypes[mappedFrom] = (mappedTypes[mappedFrom] ?? 0) + 1;

    // **数字也收**:YAML 会把 `tags: [2024, 财务]` 里的年份解析成 number,而那是个人话里的标签。
    // 丢掉它比"转成字符串"更糟 —— 用户看到的是标签少了一个,却不知道为什么。
    const tags = Array.isArray(raw.tags)
      ? normalizeTags(
          raw.tags
            .filter((tag): tag is string | number => typeof tag === "string" || typeof tag === "number")
            .map((tag) => String(tag)),
        )
      : [];
    if (tags.length > KNOWLEDGE_MAX_TAGS) truncatedTags += 1;

    const status =
      typeof raw.status === "string" && (KNOWLEDGE_PAGE_STATUSES as readonly string[]).includes(raw.status)
        ? (raw.status as KnowledgePageStatus)
        : undefined;
    const sources = mapSources(raw.sources);
    const verified = mapVerified(raw.verified);

    const privateFields = isRecord(raw["x-wordless"]) ? raw["x-wordless"] : undefined;
    const sourceHash = typeof privateFields?.source_hash === "string" ? privateFields.source_hash : undefined;
    const orphanedAt = typeof privateFields?.orphaned_at === "string" ? privateFields.orphaned_at : null;

    pages.push({
      path: file.path,
      body,
      page: {
        type,
        title: typeof raw.title === "string" && raw.title.trim() !== "" ? raw.title.trim() : titleFromPath(file.path),
        description: typeof raw.description === "string" ? raw.description.replace(/\n/g, " ").trim() : "",
        tags: tags.slice(0, KNOWLEDGE_MAX_TAGS),
        ...(status === undefined ? {} : { status }),
        ...(sources.length === 0 ? {} : { sources }),
        ...(verified === undefined ? {} : { verified }),
        // `generated` 保留来源的写法 —— 它记录的是"谁写的",改写它就等于伪造出处。
        ...(isRecord(raw.generated) && typeof raw.generated.by === "string" && typeof raw.generated.at === "string"
          ? { generated: { by: raw.generated.by, at: raw.generated.at } }
          : {}),
        ...(sourceHash === undefined && orphanedAt === null
          ? {}
          : { private: { ...(sourceHash === undefined ? {} : { source_hash: sourceHash }), orphaned_at: orphanedAt } }),
      },
    });
  }

  return { pages, raws: [...rawPaths], damaged, droppedFields, mappedTypes, truncatedTags };
}

export interface ImportPlan {
  /** 会新建的页。 */
  added: ImportedPage[];
  /** 路径撞车的页(默认跳过,不覆盖 —— 覆盖会毁掉本库里那一页)。 */
  conflicts: Array<{ path: string; title: string }>;
  damaged: Array<{ path: string; issue: string }>;
  /** 来源里带的原始文件数。 */
  raws: number;
  /**
   * 来源里**没有** `raws/` 时的提醒。
   *
   * 少了原始文件,那些源页下一轮会被判成"原始文件没了" → 标成孤儿 → 回收。
   * 这不是错误(它们确实没有依据了),但用户必须事先知道 —— 否则他会以为导入的东西会一直在。
   */
  sourceFilesMissing: boolean;
  droppedFields: Record<string, number>;
  mappedTypes: Record<string, number>;
  truncatedTags: number;
}

export function planImport(bundle: ImportedBundle, existingPaths: ReadonlySet<string>): ImportPlan {
  const added: ImportedPage[] = [];
  const conflicts: ImportPlan["conflicts"] = [];
  for (const page of bundle.pages) {
    if (existingPaths.has(page.path)) conflicts.push({ path: page.path, title: page.page.title });
    else added.push(page);
  }
  return {
    added,
    conflicts,
    damaged: bundle.damaged,
    raws: bundle.raws.length,
    // 有源页却没有任何原始文件 —— 那份库只带了页面,没带证据。
    sourceFilesMissing: bundle.raws.length === 0 && bundle.pages.some((page) => page.page.type === "Source"),
    droppedFields: bundle.droppedFields,
    mappedTypes: bundle.mappedTypes,
    truncatedTags: bundle.truncatedTags,
  };
}

/**
 * 撞车时的落点:给一个不冲突的路径(加序号,永不覆盖)。
 *
 * 与导入原始文件同一条规则:覆盖意味着用户那一页**悄悄**被别人的版本替换了,
 * 而他还以为自己的东西还在。
 */
export function freeImportPath(path: string, taken: ReadonlySet<string>): string {
  if (!taken.has(path)) return path;
  const stem = path.endsWith(".md") ? path.slice(0, -3) : path;
  for (let index = 2; ; index += 1) {
    const candidate = `${stem} (${index}).md`;
    if (!taken.has(candidate)) return candidate;
  }
}
