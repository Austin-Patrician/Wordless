/**
 * 设计帧/资源的 URL。
 *
 * **关键设计:URL 里没有路径,只有不透明的 id。**
 *
 * 参考做法是把设计包路径编码进 URL,然后靠路径校验挡住逃逸。这里换一条:主进程维护
 * `id → 设计包路径` 的注册表,URL 只带 id。于是"从 URL 构造一个逃出设计包的路径"在
 * **结构上不可能** —— 不是校验得更严,而是根本没有可注入的路径。
 *
 * 剩下的校验只针对 id 与帧 id 本身(字符集、长度),那些是格式约束而不是安全边界。
 *
 * 本文件不 import React、不 import Electron。
 */

export const DESIGN_SCHEME = "wordless-design";

/** 设计 id 的形态:sha256 的前 16 位十六进制。 */
const DESIGN_ID = /^[a-f0-9]{16}$/;
/** 控制字符。文件名里出现它们没有正当用途。 */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export type DesignRequest =
  | { kind: "frame"; designId: string; frameId: string }
  | { kind: "asset"; designId: string; relativePath: string };

/** `wordless-design://frame/<designId>/<frameId>` */
export function designFrameUrl(designId: string, frameId: string): string {
  return `${DESIGN_SCHEME}://frame/${designId}/${encodeURIComponent(frameId)}`;
}

/** `wordless-design://asset/<designId>/<seg>/<seg>…` */
export function designAssetUrl(designId: string, relativePath: string): string {
  const segments = relativePath
    .split(/[\\/]+/)
    .filter((segment) => segment !== "")
    .map((segment) => encodeURIComponent(segment));
  return `${DESIGN_SCHEME}://asset/${designId}/${segments.join("/")}`;
}

/**
 * 解析请求。任何不合法都返回 null,由调用方统一回 404 —— 不区分"格式不对"和"没找到",
 * 免得给探测者反馈。
 */
export function parseDesignUrl(rawUrl: string): DesignRequest | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${DESIGN_SCHEME}:`) return null;

  const segments = url.pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return null;
      }
    });
  if (segments.some((segment) => segment === null)) return null;
  const parts = segments as string[];

  const designId = parts[0];
  if (designId === undefined || !DESIGN_ID.test(designId)) return null;

  if (url.hostname === "frame") {
    const frameId = parts[1];
    if (parts.length !== 2 || frameId === undefined || !isSafeSegment(frameId)) return null;
    return { kind: "frame", designId, frameId };
  }

  if (url.hostname === "asset") {
    const rest = parts.slice(1);
    if (rest.length === 0 || !rest.every(isSafeSegment)) return null;
    return { kind: "asset", designId, relativePath: rest.join("/") };
  }

  return null;
}

/**
 * 一个路径段是否安全。
 *
 * 用**黑名单而不是白名单**:安全边界是后面的 `realpath` + `isWithinRoot`,这里只挡
 * "会让这一段不再是单独一段"的字符。白名单会把空格、中文、括号这些完全无害的文件名
 * 一起拒掉,而它们并不构成任何逃逸。
 *
 * 关于 `.` / `..`:`new URL` **在构造时就已经归一化**了它们,所以从 URL 进来的路径
 * 永远不含这两种段 —— 这个判断对 URL 输入是不可达的。保留它是因为 `parseDesignUrl`
 * 是一个公开的解析入口,不值得为了少写一行而假设调用方一定先经过 `new URL`。
 *
 * 真正**可达且必要**的是分隔符判断:百分号编码可以绕过 URL 层的分段,
 * `a%2Fb` 解码后是 `a/b`,`a%5Cb` 解码后是 `a\b` —— 那才是能让一段变成两段的字符。
 */
function isSafeSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false;
  if (segment.includes("/") || segment.includes("\\")) return false;
  return !CONTROL_CHARACTER.test(segment);
}

/** 帧 id → 它在渲染根里的相对路径。 */
export function frameRelativePath(frameId: string): string {
  return `frames/${frameId}.html`;
}
