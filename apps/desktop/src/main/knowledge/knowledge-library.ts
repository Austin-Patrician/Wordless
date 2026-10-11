import { join } from "node:path";
import { KNOWLEDGE_CONCEPTS_DIR, KNOWLEDGE_ENTITIES_DIR, KNOWLEDGE_INDEX_FILE, KNOWLEDGE_RAWS_DIR, KNOWLEDGE_SOURCES_DIR } from "./knowledge-layout.ts";

/**
 * **库的清单**:一个知识库就是根目录下的一个子目录。
 *
 * 清单**从文件系统推出来**,不存一份注册表。理由与"bundle 是能带走的资产"是同一条:
 * 存了注册表就有第二份真相 —— 用户在 Finder 里拷进来一份库、删掉一份库,注册表就与磁盘不一致,
 * 而"哪个是真的"没有好答案。目录就是清单。
 *
 * 代价是**认不出"随便一个子目录"**:所以要判断它像不像一个库(见 {@link looksLikeKnowledgeBundle})。
 * 一个空目录不是库;一个带 `raws/` 或 `sources/` 的目录是。
 */

/** 判断一个目录像不像知识库:有我们约定的任一标记就算。 */
export function looksLikeKnowledgeBundle(childNames: readonly string[]): boolean {
  const markers = [KNOWLEDGE_RAWS_DIR, KNOWLEDGE_SOURCES_DIR, KNOWLEDGE_CONCEPTS_DIR, KNOWLEDGE_ENTITIES_DIR, KNOWLEDGE_INDEX_FILE];
  return childNames.some((name) => markers.includes(name));
}

/** 库名 → 它的根目录。 */
export function knowledgeBundlePath(baseDirectory: string, name: string): string {
  return join(baseDirectory, name);
}

/**
 * 归一一个库名,非法就返回 null。
 *
 * 挡的是**路径逃逸**:库名直接当目录名用,所以 `..`、分隔符、绝对路径都必须挡掉 ——
 * 否则"新建一个叫 `../..` 的库"就能在任意位置建目录。
 */
export function normalizeKnowledgeBaseName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name === "" || name.length > 60) return null;
  if (name.startsWith(".")) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  if (name === "." || name === "..") return null;
  // Windows 上这些字符非法,而库名会变成目录名。
  if (/[<>:"|?*]/.test(name)) return null;
  return name;
}

/**
 * 从清单里挑出"当前这个"。
 *
 * 记的那个名字可能已经不在了(用户在 Finder 里删了/改名了),那时**退到第一个可用的** ——
 * 而不是报错、也不是偷偷重建一个同名空库(那会让人以为自己的东西丢了)。
 */
export function resolveActiveKnowledgeBase(names: readonly string[], preferred: string | null): string | null {
  if (names.length === 0) return null;
  if (preferred !== null && names.includes(preferred)) return preferred;
  return names[0] ?? null;
}
