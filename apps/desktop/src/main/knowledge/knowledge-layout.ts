import type { KnowledgePageType } from "./knowledge-schema.ts";

/**
 * 一个知识库 = 一个 bundle 的目录约定。
 *
 * ```text
 * <bundle>/
 *   index.md      工程重建(渐进披露目录,OKF §8)
 *   log.md        工程追加(时间线,OKF §9)
 *   raws/         投递箱:原始文件,不可变(agent 只读)
 *   sources/      源页(1:1,一个 raw → 一页)
 *   concepts/     概念页(N:M,跨源综合)
 *   entities/     实体页(N:M,人/组织/产品)
 * ```
 *
 * `raws/` 放在 bundle **里面**,是为了让 bundle 自带证据链:`sources[].resource` 因此可以是
 * bundle 相对路径,导出这份库就是完整的(含原始文件)。OKF 不禁止 bundle 内有非 markdown 文件,
 * 它的一致性检查只看 `.md`。
 */

export const KNOWLEDGE_RAWS_DIR = "raws";
export const KNOWLEDGE_SOURCES_DIR = "sources";
export const KNOWLEDGE_CONCEPTS_DIR = "concepts";
export const KNOWLEDGE_ENTITIES_DIR = "entities";
export const KNOWLEDGE_INDEX_FILE = "index.md";
export const KNOWLEDGE_LOG_FILE = "log.md";

/** 页面类型 → 它所在的目录。**类型与目录必须一致**(一致性检查会盯着这条)。 */
export const KNOWLEDGE_TYPE_DIRECTORIES: Record<KnowledgePageType, string> = {
  Source: KNOWLEDGE_SOURCES_DIR,
  Concept: KNOWLEDGE_CONCEPTS_DIR,
  Entity: KNOWLEDGE_ENTITIES_DIR,
};

/** bundle 里由**工程**维护、agent 不许写的路径。 */
export const KNOWLEDGE_GENERATED_FILES: readonly string[] = [KNOWLEDGE_INDEX_FILE, KNOWLEDGE_LOG_FILE];

/**
 * 页面路径是不是落在允许写的区域。
 *
 * `raws/**` 必须挡住:那是用户的原始文件,agent 只能读。这条规则在**工具层**执行(而不是靠
 * 提示词里写"请不要写") —— 提示词是约定,路径校验是机制。
 */
export function isWritablePagePath(relativePath: string): boolean {
  const path = relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (path === "" || path.includes("..")) return false;
  if (KNOWLEDGE_GENERATED_FILES.includes(path)) return false;
  if (path === KNOWLEDGE_RAWS_DIR || path.startsWith(`${KNOWLEDGE_RAWS_DIR}/`)) return false;
  const top = path.split("/")[0];
  return Object.values(KNOWLEDGE_TYPE_DIRECTORIES).includes(top ?? "");
}

/** 把页面路径归一成 bundle 相对路径(带前导 `/`,供 OKF 的链接与 sources 用)。 */
export function toBundleResource(relativePath: string): string {
  return `/${relativePath.replace(/^\/+/, "").replace(/\\/g, "/")}`;
}

/** 页面路径的目录部分,用于判断它的类型是否与目录一致。 */
export function directoryOf(relativePath: string): string {
  return relativePath.replace(/^\/+/, "").replace(/\\/g, "/").split("/")[0] ?? "";
}
