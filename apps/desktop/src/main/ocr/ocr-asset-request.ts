/**
 * `wordless-ocr://` 的 URL 解析与响应头。
 *
 * 纯模块、不 import Electron:路径约束是这一层里**唯一真的会被用错**的东西(一次目录穿越
 * 就等于把用户磁盘交给一个隐藏窗口),所以它必须能被 `node --test` 直接测。
 *
 * URL 形状:
 * - `wordless-ocr://runner/index.html` —— 运行器页面与它的 JS
 * - `wordless-ocr://assets/ort/<file>` —— onnxruntime-web 的 wasm 与胶水
 * - `wordless-ocr://assets/models/<file>` —— PP-OCRv5 的 onnx 与字典
 *
 * host 决定根目录,path 决定文件;`assets` 下再按第一段分 `ort` / `models`。
 */

export const OCR_SCHEME = "wordless-ocr";

export type OcrAssetRoot = "runner" | "ort" | "models";

export interface OcrAssetRoute {
  root: OcrAssetRoot;
  /** 根目录内的相对路径,已确认不含 `..`、绝对路径与反斜杠。 */
  relative: string;
}

/** 只允许这些字符组成一段路径:足以覆盖 html/js/wasm/onnx/txt,同时把穿越与编码花样挡在门外。 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function safeRelative(pathname: string): string | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  for (const segment of segments) {
    // `.` / `..` 被 SAFE_SEGMENT 放行(它们由点组成),必须单独拒掉。
    if (segment === "." || segment === "..") return null;
    if (!SAFE_SEGMENT.test(segment)) return null;
  }
  return segments.join("/");
}

export function parseOcrUrl(url: string): OcrAssetRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${OCR_SCHEME}:`) return null;

  const host = parsed.hostname;
  const relative = safeRelative(decodeURIComponent(parsed.pathname));
  if (relative === null) return null;

  if (host === "runner") return { root: "runner", relative };
  if (host === "assets") {
    const [head, ...rest] = relative.split("/");
    if (head !== "ort" && head !== "models") return null;
    if (rest.length === 0) return null;
    return { root: head, relative: rest.join("/") };
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function contentTypeFor(relative: string): string {
  const dot = relative.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return CONTENT_TYPES[relative.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 每个响应都要带的头。
 *
 * **COOP + COEP 是这里的重点**:它们让页面进入跨源隔离状态,于是 `SharedArrayBuffer` 可用,
 * onnxruntime-web 才能开多线程 WASM。open-vetta 的 runner 因为从 `file://` 加载,拿不到隔离,
 * 只能写死 `numThreads: 1`(而且为此关掉了 `webSecurity`)—— 我们走自己的协议,不必付这个代价。
 *
 * `CORP: same-origin` 是给子资源(wasm/onnx)的:COEP 生效后,子资源也必须声明自己可以被谁用。
 */
export const OCR_ASSET_HEADERS: Readonly<Record<string, string>> = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
};
