import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/**
 * 知识库页面的 frontmatter:**OKF 的形 + 一个私有命名空间**。
 *
 * ## 为什么是 OKF 的形
 *
 * 用户的知识库应该是一个**能带走的资产**,而不是某个产品的私有格式。OKF(Google 的 Open
 * Knowledge Format,它把 Karpathy 的 LLM Wiki 模式规范化的产物)给了一套现成的形状:
 * `type` 必填、`title`/`description`/`tags` 推荐、`sources` 记来源、保留文件名 `index.md`/
 * `log.md`。照它写,用户的库能被任何 OKF 消费者读,也能导入别人的库。
 *
 * ## 为什么还要私有命名空间
 *
 * 有几样东西 OKF 语义里没有,而增量加工必须有:原始文件的内容 hash(判断"变了没有")、
 * 孤儿标记(删除的宽限期)。它们放进 `x-wordless` —— OKF 明确允许扩展字段,并要求消费者
 * 不得因未知字段拒绝。**只有两个字段**,这是刻意的:私有块越大,越像四不像。
 *
 * ## 三条硬规则(防四不像靠它们,不靠自觉)
 *
 * 1. 每个键要么是 OKF 定义的,要么在 `x-wordless` 下 —— 不许出现第三种词汇表。
 * 2. 私有块只放"OKF 消费者可以安全忽略的机器位";**含义**要么用 OKF 字段表达,要么换 `type`。
 * 3. 封闭 schema:出现未知字段直接报错,而不是静默写进文件。
 *
 * 第 3 条与 OKF 的宽松一致性**不矛盾**:OKF 要求的是"消费者不得拒绝带未知字段的文档",
 * 而这里约束的是**生产者**(我们自己)不许写出未知字段。前者保证我们读得懂别人的库,
 * 后者保证我们自己写出来的库永远是固定形状 —— 缓存、检索、迁移都能依赖它。
 */

/** 页面类型。OKF 的 `type` 不集中注册,但生产者要挑自解释的值。 */
export const KNOWLEDGE_PAGE_TYPES = ["Source", "Concept", "Entity"] as const;
export type KnowledgePageType = (typeof KNOWLEDGE_PAGE_TYPES)[number];

/** 保留文件名:它们在任何层级都有既定含义,不能当概念文档用(OKF §3.1)。 */
export const KNOWLEDGE_RESERVED_FILES = ["index.md", "log.md"] as const;

/** 我们使用的 OKF 字段,按**固定写出顺序**排列 —— 顺序稳定,diff 才稳定。 */
export const KNOWLEDGE_OKF_FIELDS = ["type", "title", "description", "tags", "status", "sources", "generated", "verified"] as const;

/** 私有命名空间。 */
export const KNOWLEDGE_PRIVATE_FIELD = "x-wordless";
export const KNOWLEDGE_PRIVATE_KEYS = ["source_hash", "orphaned_at"] as const;

/** 每页标签上限。词表越收敛越好用,所以宁缺毋滥。 */
export const KNOWLEDGE_MAX_TAGS = 5;

export const KNOWLEDGE_PAGE_STATUSES = ["draft", "stable", "deprecated"] as const;
export type KnowledgePageStatus = (typeof KNOWLEDGE_PAGE_STATUSES)[number];

export interface KnowledgeSourceRef {
  /** 稳定键,用于正文脚注归因(OKF §5.1)。 */
  id?: string;
  /** bundle 相对路径(以 `/` 开头)或绝对 URL。 */
  resource: string;
}

export interface KnowledgeGenerated {
  /** actor 约定:agent 写 `<producer>/<version>`,人写 `human:<id>`(OKF §7)。 */
  by: string;
  /** ISO 8601 时间戳。 */
  at: string;
}

/**
 * 一次人工复核(OKF §5.2 的 `verified`)。
 *
 * **它是一条承诺,不是装饰**:带 `human:` 前缀的页,加工轮**不再自动改写它** —— 而是把
 * "这一页需要复核"报给用户。同类实现(OpenKB)明说过它们的 `recompile` 会覆盖手工编辑,
 * 我们把那条路堵掉。
 */
export interface KnowledgeVerification {
  /** actor 约定:人写 `human:<id>`(OKF §7)。只有带这个前缀的才算人工复核。 */
  by: string;
  at: string;
}

export interface KnowledgePrivateFields {
  /** 原始文件的内容 hash —— 增量 diff 的内容身份。 */
  source_hash?: string;
  /** 孤儿标记的 ISO 时间戳,正常为 null。 */
  orphaned_at?: string | null;
}

export interface KnowledgePage {
  type: KnowledgePageType;
  title: string;
  description: string;
  tags: string[];
  status?: KnowledgePageStatus;
  sources?: KnowledgeSourceRef[];
  generated?: KnowledgeGenerated;
  /** 人工复核记录。有它 = 加工轮不自动改写这一页。 */
  verified?: KnowledgeVerification;
  private?: KnowledgePrivateFields;
}

export interface KnowledgePageIssue {
  /** 面向模型/人的一句话。 */
  message: string;
}

export type KnowledgePageValidation =
  | { ok: true; page: KnowledgePage }
  | { ok: false; issues: KnowledgePageIssue[] };

/**
 * 标签归一:去空白 → 转小写 → 折叠内部空格 → 去空 → 保序去重。
 *
 * 中文没有大小写,所以这一步只对拉丁专有名词生效(把 `API` 与 `api` 收成一个);
 * 它干掉的都是**纯格式重复**,不改变语义。
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * 校验并归一化一份 frontmatter。
 *
 * 入参是**磁盘形状**(即 YAML 解析出来的对象,私有块在 `x-wordless` 下),返回**内部形状**。
 * 两种形状的映射只有一处:`toFrontmatter`。

 *
 * 报错而不是静默丢弃:**封闭 schema 的价值就在于"写错了会立刻知道"**。
 * 一旦允许静默吞掉未知字段,缓存/检索/迁移依赖的"固定形状"就没了。
 */
export function validateKnowledgePage(input: unknown): KnowledgePageValidation {
  const issues: KnowledgePageIssue[] = [];
  if (!isRecord(input)) return { ok: false, issues: [{ message: "frontmatter 必须是一个对象" }] };

  const known = new Set<string>([...KNOWLEDGE_OKF_FIELDS, KNOWLEDGE_PRIVATE_FIELD]);
  const unknown = Object.keys(input).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    issues.push({
      message: `不允许的字段:${unknown.join(", ")}。含义请用 OKF 字段表达,机器位请放进 ${KNOWLEDGE_PRIVATE_FIELD}`,
    });
  }

  const type = input.type;
  if (!KNOWLEDGE_PAGE_TYPES.includes(type as KnowledgePageType)) {
    issues.push({ message: `type 必须是 ${KNOWLEDGE_PAGE_TYPES.join(" / ")} 之一,收到 ${JSON.stringify(type)}` });
  }

  const title = input.title;
  if (!isNonEmptyString(title)) issues.push({ message: "title 必须是非空字符串" });

  const description = input.description;
  if (typeof description !== "string") issues.push({ message: "description 必须是字符串" });
  else if (description.includes("\n")) issues.push({ message: "description 必须是一句话(不能含换行)" });

  let tags: string[] = [];
  if (input.tags === undefined) {
    issues.push({ message: "tags 必须给出(可以是空数组)" });
  } else if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string")) {
    issues.push({ message: "tags 必须是字符串数组" });
  } else {
    tags = normalizeTags(input.tags as string[]);
    if (tags.length > KNOWLEDGE_MAX_TAGS) {
      issues.push({ message: `标签最多 ${KNOWLEDGE_MAX_TAGS} 个,收到 ${tags.length} 个(去重后 ${tags.length})` });
    }
  }

  let status: KnowledgePageStatus | undefined;
  if (input.status !== undefined) {
    if (!KNOWLEDGE_PAGE_STATUSES.includes(input.status as KnowledgePageStatus)) {
      issues.push({ message: `status 必须是 ${KNOWLEDGE_PAGE_STATUSES.join(" / ")} 之一` });
    } else {
      status = input.status as KnowledgePageStatus;
    }
  }

  let sources: KnowledgeSourceRef[] | undefined;
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources)) {
      issues.push({ message: "sources 必须是数组" });
    } else {
      sources = [];
      for (const [index, entry] of (input.sources as unknown[]).entries()) {
        if (!isRecord(entry) || !isNonEmptyString(entry.resource)) {
          issues.push({ message: `sources[${index}].resource 必须是非空字符串` });
          continue;
        }
        const resource = entry.resource;
        // bundle 相对路径以 `/` 开头(OKF §6.2)。不许逃出 bundle:否则一条 sources 就能指向
        // 用户的任意文件,而导出这份库的人会以为它是自包含的。
        if (resource.startsWith("/") && resource.split("/").includes("..")) {
          issues.push({ message: `sources[${index}].resource 不能含 .. 段:${resource}` });
          continue;
        }
        const extra = Object.keys(entry).filter((key) => key !== "id" && key !== "resource");
        if (extra.length > 0) issues.push({ message: `sources[${index}] 不允许的字段:${extra.join(", ")}` });
        if (entry.id !== undefined && !isNonEmptyString(entry.id)) issues.push({ message: `sources[${index}].id 必须是非空字符串` });
        sources.push({ ...(entry.id === undefined ? {} : { id: entry.id as string }), resource });
      }
    }
  }

  let generated: KnowledgeGenerated | undefined;
  if (input.generated !== undefined) {
    if (!isRecord(input.generated) || !isNonEmptyString(input.generated.by) || !isNonEmptyString(input.generated.at)) {
      issues.push({ message: "generated 必须是 { by, at } 且两者都非空" });
    } else {
      generated = { by: input.generated.by, at: input.generated.at };
    }
  }

  let verified: KnowledgeVerification | undefined;
  if (input.verified !== undefined) {
    // OKF 允许 `verified` 是列表(多次独立复核)。我们只写单条,但**读**要能容忍列表 ——
    // 别人的 OKF bundle 导入进来时,那一栏可能是数组。
    const single = Array.isArray(input.verified) ? input.verified[0] : input.verified;
    if (!isRecord(single) || !isNonEmptyString(single.by) || !isNonEmptyString(single.at)) {
      issues.push({ message: "verified 必须是 { by, at } 且两者都非空(或它的数组形式)" });
    } else {
      verified = { by: single.by, at: single.at };
    }
  }

  let privateFields: KnowledgePrivateFields | undefined;
  const raw = input[KNOWLEDGE_PRIVATE_FIELD];
  if (raw !== undefined) {
    if (!isRecord(raw)) {
      issues.push({ message: `${KNOWLEDGE_PRIVATE_FIELD} 必须是对象` });
    } else {
      const extra = Object.keys(raw).filter((key) => !KNOWLEDGE_PRIVATE_KEYS.includes(key as (typeof KNOWLEDGE_PRIVATE_KEYS)[number]));
      if (extra.length > 0) {
        issues.push({
          message: `${KNOWLEDGE_PRIVATE_FIELD} 只放机器位(${KNOWLEDGE_PRIVATE_KEYS.join(", ")}),不允许:${extra.join(", ")}`,
        });
      }
      const hash = raw.source_hash;
      if (hash !== undefined && !isNonEmptyString(hash)) issues.push({ message: `${KNOWLEDGE_PRIVATE_FIELD}.source_hash 必须是非空字符串` });
      const orphaned = raw.orphaned_at;
      if (orphaned !== undefined && orphaned !== null && !isNonEmptyString(orphaned)) {
        issues.push({ message: `${KNOWLEDGE_PRIVATE_FIELD}.orphaned_at 必须是 ISO 字符串或 null` });
      }
      privateFields = {
        ...(hash === undefined ? {} : { source_hash: hash as string }),
        ...(orphaned === undefined ? {} : { orphaned_at: orphaned as string | null }),
      };
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    page: {
      type: type as KnowledgePageType,
      title: title as string,
      description: description as string,
      tags,
      ...(status === undefined ? {} : { status }),
      ...(sources === undefined ? {} : { sources }),
      ...(generated === undefined ? {} : { generated }),
      ...(verified === undefined ? {} : { verified }),
      ...(privateFields === undefined ? {} : { private: privateFields }),
    },
  };
}

/**
 * 内部形状 → 磁盘形状(即 frontmatter 对象)。
 *
 * 存在两种形状是刻意的:磁盘上必须是 OKF 的键名(`x-wordless`),而代码里用起来舒服的是
 * `page.private`。这个函数是**唯一的**映射点 —— 序列化与测试都走它,免得两边各写一份映射
 * 然后慢慢漂开(测试里手写 frontmatter 对象正是最容易漂的地方)。
 */
export function toFrontmatter(page: KnowledgePage): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {
    type: page.type,
    title: page.title,
    description: page.description,
    tags: page.tags,
  };
  if (page.status !== undefined) frontmatter.status = page.status;
  if (page.sources !== undefined && page.sources.length > 0) frontmatter.sources = page.sources;
  if (page.generated !== undefined) frontmatter.generated = page.generated;
  if (page.verified !== undefined) frontmatter.verified = page.verified;
  if (page.private !== undefined && Object.keys(page.private).length > 0) {
    frontmatter[KNOWLEDGE_PRIVATE_FIELD] = page.private;
  }
  return frontmatter;
}

/**
 * 按**固定顺序**把页面拼成 markdown。
 *
 * 顺序固定是为了 diff 稳定:同样的内容永远写出同样的字节,`git diff` 与"这页变了吗"才有意义。
 * 空数组、undefined 一律不写出来 —— 文件里只留有意义的东西。
 */
export function serializeKnowledgePage(page: KnowledgePage, body: string): string {
  const yaml = stringifyYaml(toFrontmatter(page), { lineWidth: 0 });
  const normalizedBody = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  return `---\n${yaml}---\n\n${normalizedBody}\n`;
}

/**
 * 这一页是不是**人工复核过**。
 *
 * 只认 `human:` 前缀(OKF §7 的 actor 约定):`process:` 与 `<producer>/<version>` 都是机器
 * 写的,机器写的复核不该拦住机器改写 —— 否则一次自动 Lint 就能把整库锁死。
 */
export function isHumanVerified(page: KnowledgePage): boolean {
  return page.verified !== undefined && page.verified.by.startsWith("human:");
}

export type KnowledgePageParse =
  | { ok: true; page: KnowledgePage; body: string }
  | { ok: false; issues: KnowledgePageIssue[] };

/**
 * 解析一个 wiki 页。
 *
 * 失败**返回问题而不是抛异常**:扫描时遇到损坏的页(手改坏了、写到一半崩了)要能如实上报,
 * 而不是让整次扫描挂掉 —— 一个坏页不该让整个知识库不可用。
 */
export function parseKnowledgePage(markdown: string): KnowledgePageParse {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) return { ok: false, issues: [{ message: "缺少 frontmatter(文件没有以 --- 开头)" }] };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { ok: false, issues: [{ message: "frontmatter 未闭合(找不到结束的 ---)" }] };

  let raw: unknown;
  try {
    raw = parseYaml(normalized.slice(4, end));
  } catch (error) {
    return { ok: false, issues: [{ message: `frontmatter 不是合法 YAML:${error instanceof Error ? error.message : String(error)}` }] };
  }

  const validated = validateKnowledgePage(raw);
  if (!validated.ok) return validated;
  const body = normalized.slice(end + 4).trim();
  return { ok: true, page: validated.page, body };
}
