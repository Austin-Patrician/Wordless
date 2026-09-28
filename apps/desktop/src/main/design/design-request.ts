import { frameRelativePath, type DesignRequest } from "./design-url.ts";
import type { DesignFs } from "./design-fs.ts";

/**
 * 把一条 `wordless-design://` 请求解析成磁盘上的一个文件。
 *
 * 三层防护,顺序不能换:
 *
 * 1. **id 查注册表** —— URL 里没有路径,只有不透明 id。查不到就是 404,所以"构造一个
 *    逃出设计包的 URL"从一开始就不可能。
 * 2. **`realpath` 解析符号链接** —— 设计包里一个指向 `/etc/passwd` 的软链,只看字面
 *    路径是"在包内"的。解析成真实路径之后才做判定。
 * 3. **`isWithinRoot`** —— 判定复用仓库里已有的实现(注入进来),不在这里重写一遍
 *    路径比较,免得两处规则漂开。
 *
 * 渲染根固定是设计包下的 `dist/`:源与产物用同一套相对路径(`frames/index.html` 里的
 * `../theme.css` 在 `dist/frames/index.html` 下依然成立),所以渲染永远只读产物。
 *
 * 本文件不 import React、不 import Electron。
 */

/** 渲染根的目录名。 */
export const RENDER_ROOT_NAME = "dist";

export type DesignRequestResult =
  | { ok: true; path: string; contentType: string }
  | { ok: false; status: 404 };

export interface ResolveDesignRequestInput {
  request: DesignRequest;
  /** id → 设计包绝对路径。 */
  resolveDesign: (designId: string) => string | null;
  fs: DesignFs;
  /** 路径约束判定。生产传 `WorkspacePathService#isWithinRoot`。 */
  isWithinRoot: (root: string, candidate: string) => boolean;
}

export async function resolveDesignRequest(input: ResolveDesignRequestInput): Promise<DesignRequestResult> {
  const designPath = input.resolveDesign(input.request.designId);
  if (designPath === null) return notFound();

  const renderRoot = joinPath(designPath, RENDER_ROOT_NAME);
  const relative =
    input.request.kind === "frame" ? frameRelativePath(input.request.frameId) : input.request.relativePath;
  const target = joinPath(renderRoot, relative);

  let canonicalRoot: string;
  let canonicalTarget: string;
  try {
    canonicalRoot = await input.fs.realpath(renderRoot);
    canonicalTarget = await input.fs.realpath(target);
  } catch {
    // 没有 dist、或这一帧还没有产物。都是 404,不是错误。
    return notFound();
  }

  if (!input.isWithinRoot(canonicalRoot, canonicalTarget)) return notFound();

  const details = await input.fs.stat(canonicalTarget);
  if (details === null || !details.isFile) return notFound();

  return { ok: true, path: canonicalTarget, contentType: contentTypeOf(canonicalTarget) };
}

function notFound(): DesignRequestResult {
  return { ok: false, status: 404 };
}

function joinPath(root: string, relative: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const trimmed = root.replace(/[\\/]+$/, "");
  const suffix = relative.replace(/^[\\/]+/, "").split("/").join(separator);
  return `${trimmed}${separator}${suffix}`;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** 未知后缀按二进制流 —— 猜成 `text/html` 会让一张图片被当成页面解析。 */
export function contentTypeOf(filePath: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(filePath);
  if (match === null) return "application/octet-stream";
  return CONTENT_TYPES[match[0].toLowerCase()] ?? "application/octet-stream";
}
