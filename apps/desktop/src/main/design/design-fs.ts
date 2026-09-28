import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 设计包需要的文件系统操作,收成一个端口。
 *
 * 端口化的理由与仓库里其它服务一致:能力与服务**不 import Electron**,测试注入假实现
 * 就能覆盖"产物缺失""写一半""符号链接逃逸"这些用真磁盘很难构造的情况。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface DesignFileRef {
  path: string;
  /** 相对给定根的路径,正斜杠分隔。 */
  relPath: string;
}

export interface DesignDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface DesignFileStat {
  isDirectory: boolean;
  isFile: boolean;
}

export interface DesignFs {
  readText(filePath: string): Promise<string>;
  /**
   * 显式要求 `ArrayBuffer` 背书而不是 `ArrayBufferLike`:`Response` 的 body 不接受
   * 可能是 `SharedArrayBuffer` 的视图,而这里的字节最终就是喂给 `Response` 的。
   */
  readBytes(filePath: string): Promise<Uint8Array<ArrayBuffer>>;
  writeText(filePath: string, content: string): Promise<void>;
  writeBytes(filePath: string, content: Uint8Array): Promise<void>;
  /** 递归列举文件,跳过被忽略的目录。 */
  listFiles(root: string): Promise<DesignFileRef[]>;
  listDirectory(directory: string): Promise<DesignDirectoryEntry[]>;
  stat(target: string): Promise<DesignFileStat | null>;
  ensureDirectory(directory: string): Promise<void>;
  /** 递归删除;目标不存在不算错误。 */
  remove(target: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** 解析符号链接。用于路径约束判定。 */
  realpath(target: string): Promise<string>;
}

/** 不作为设计内容扫描的目录名。 */
const IGNORED_DIRECTORY_NAMES = new Set(["node_modules", "dist", "dist.staging", "dist.previous"]);

/**
 * 一个相对路径是否应当被跳过。
 *
 * - **点开头的目录**:`.build/`(构建日志与缓存)与备份目录。它们不是设计内容,被当成
 *   帧扫到会让画布上多出莫名其妙的画板。
 * - **`dist/`**:渲染产物,由同步/构建生成,不是源。`dist.staging/` 与 `dist.previous/`
 *   是构建器的中间态,同样不是源 —— 放过它们会让一次构建的产物被当成设计内容扫一遍。
 * - **`node_modules/`**:依赖。
 */
export function isIgnoredDesignPath(relPath: string): boolean {
  return relPath
    .split("/")
    .some((segment) => segment.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(segment));
}

/**
 * 一个相对路径是否属于「要同步进 `dist/` 的可渲染子集」。
 *
 * 判定是**白名单**:只有 `theme.css`、`frames/*.html`、`assets/**` 会进产物。设计包里
 * 还可能有 `DESIGN.md`、笔记、构建配置 —— 它们对渲染没有意义,复制过去只会让 `dist/`
 * 变成设计包的第二份拷贝。
 *
 * 放在这里而不是 `design-store.ts`:构建脚本(子进程)也要用它,而那个入口不该为了一个
 * 纯函数去 import 整个 store。
 */
export function isRenderableSource(relPath: string): boolean {
  const normalized = relPath.replaceAll("\\", "/");
  if (isIgnoredDesignPath(normalized)) return false;
  if (normalized === "theme.css") return true;
  if (normalized.startsWith("frames/")) return normalized.endsWith(".html");
  return normalized.startsWith("assets/");
}

export class NodeDesignFs implements DesignFs {
  async readText(filePath: string): Promise<string> {
    return await readFile(filePath, "utf8");
  }

  async readBytes(filePath: string): Promise<Uint8Array<ArrayBuffer>> {
    return await readFile(filePath);
  }

  async writeText(filePath: string, content: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }

  async writeBytes(filePath: string, content: Uint8Array): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  async listFiles(root: string): Promise<DesignFileRef[]> {
    const found: DesignFileRef[] = [];
    await this.walk(root, "", found);
    return found;
  }

  private async walk(root: string, relative: string, found: DesignFileRef[]): Promise<void> {
    const directory = relative === "" ? root : path.join(root, relative);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // 符号链接一律不跟随:跟随会走出设计包,也会在自引用时无限递归。
      if (entry.isSymbolicLink()) continue;
      const relPath = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (isIgnoredDesignPath(relPath)) continue;
      const absolute = path.join(root, relPath);
      if (entry.isDirectory()) {
        await this.walk(root, relPath, found);
      } else if (entry.isFile()) {
        found.push({ path: absolute, relPath });
      }
    }
  }

  async listDirectory(directory: string): Promise<DesignDirectoryEntry[]> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => ({
        name: entry.name,
        path: path.join(directory, entry.name),
        isDirectory: entry.isDirectory(),
      }));
  }

  async stat(target: string): Promise<DesignFileStat | null> {
    try {
      const details = await stat(target);
      return { isDirectory: details.isDirectory(), isFile: details.isFile() };
    } catch {
      return null;
    }
  }

  async ensureDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true });
  }

  async remove(target: string): Promise<void> {
    await rm(target, { recursive: true, force: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await rename(from, to);
  }

  async realpath(target: string): Promise<string> {
    return await realpath(target);
  }
}
