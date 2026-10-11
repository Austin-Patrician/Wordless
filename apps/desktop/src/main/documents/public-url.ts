/**
 * 出网 URL 的准入判定(SSRF 防护)。
 *
 * 放在宿主里而不是能力包里,理由与 `document-text.ts` 相同 —— 更硬的一条是:它是**安全
 * 相关**的,而它有两处宿主消费方(通用 URL 抓取与数据深度研究的抓取)。各留一份的话,
 * 哪天补了一个内网段,很可能只补在一边。
 *
 * 分工刻意如此:**本模块只做判定,不做措辞**。判定结果是一个原因码,由调用方翻译成
 * 自己的说法(深度研究那边说的是"Research source ...",通用抓取说的是"URL ...")。
 * 判定与文案分开之后,这里的逻辑可以完全离线测,而两边的历史文案都不用动。
 */

import { isIP } from "node:net";

/**
 * 解析主机名到地址列表。宿主用 `node:dns/promises` 的
 * `lookup(hostname, { all: true, verbatim: true })` 实现。
 *
 * 注入而不是直接 import:这样判定逻辑可以离线测(给一个假的解析器),也不会因为
 * 测试环境没有 DNS 而变得不可测。
 */
export type HostResolver = (hostname: string) => Promise<string[]>;

export type PublicUrlFailure =
  /** 不是一个合法 URL。 */
  | "invalid-url"
  /** 协议不是 http/https(file:、data: 之类一律拒绝)。 */
  | "non-http"
  /** URL 里带了用户名/密码。 */
  | "credentials"
  /** 主机名本身就是内网名(localhost、*.localhost、云元数据端点)。 */
  | "private-host"
  /** 主机名解析不出任何地址。 */
  | "unresolved"
  /** 解析出的地址里有内网/保留地址。 */
  | "private-address";

export type PublicUrlCheck = { ok: true; url: string } | { ok: false; code: PublicUrlFailure };

/**
 * 内网/保留地址判定。
 *
 * 认不出来的一律当内网(函数末尾返回 `true`):这个方向错了的后果是"少抓一个公网地址",
 * 反方向错了的后果是"让模型读到用户内网里的东西"。
 */
export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (isIP(normalized) === 6) {
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

/**
 * 判定一个 URL 是否允许出网抓取。通过时返回**归一化后的 URL**(去掉 fragment)。
 *
 * fragment 必须去掉:它只对浏览器有意义,留着会让"同一份内容、不同的 URL"看起来像两个来源
 * (抓取结果的指纹是按内容算的,但引用链接会因此分叉)。
 */
export async function checkPublicHttpUrl(value: string, resolveHost: HostResolver): Promise<PublicUrlCheck> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "invalid-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, code: "non-http" };
  if (url.username || url.password) return { ok: false, code: "credentials" };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") {
    return { ok: false, code: "private-host" };
  }

  const addresses = await resolveHost(hostname);
  if (addresses.length === 0) return { ok: false, code: "unresolved" };
  if (addresses.some((address) => isPrivateAddress(address))) return { ok: false, code: "private-address" };

  url.hash = "";
  return { ok: true, url: url.toString() };
}
