/**
 * 文档正文的纯函数:HTML → 文本、PDF 魔数判定。
 *
 * 放在宿主里而不是能力包里,有两个原因:
 *   1. **能力包不碰实现。** 它只声明端口与工具(照 `capability-ocr` 的做法),而"怎么把 HTML
 *      变成文本"是实现细节 —— 能力包里的工具甚至不会调用它,它们只是把端口给的结果排版。
 *   2. **它有两处宿主消费方**(通用文档工具与数据深度研究的抓取),而两边必须用同一份实现;
 *      各留一份的话,正文抽取迟早会给出不同结果。
 *
 * 选"宿主里的普通模块"而不是"能力包"还有一个具体理由:能力包内部用的是 `.js` 相对导入,
 * `node --test` 加载不了(`apps/desktop/test/ocr-tool-declaration.test.ts` 里记着这个坑),
 * 而这里要能被 `node --test` 直接测。
 */

/** HTML 实体解码。只覆盖正文里真正会出现的那些;数字实体走通用分支。 */
export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

/**
 * 取 `<title>`。取不到返回 null(调用方要区分"没有标题"和"标题是空串")。
 */
export function extractHtmlTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = decodeHtml(match[1]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 500);
  return title || null;
}

/**
 * HTML → 可读文本。
 *
 * 先删掉**整体无用**的块(注释、script/style/noscript/svg/canvas/template),再把块级标签的
 * 结束当成换行,最后才剥掉剩余标签 —— 顺序反了会把 `<style>` 里的 CSS 当成正文留下。
 */
export function extractHtmlText(html: string): string {
  const blockAware = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|article|section|main|header|footer|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtml(blockAware).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/**
 * 是不是 PDF。
 *
 * 看魔数而不是看扩展名:HTTP 响应常给 `application/octet-stream`,而用户把 `.pdf` 改名成
 * 别的扩展名也很常见。反之,扩展名说是 PDF 但内容不是时,按内容为准。
 */
export function isPdfBytes(bytes: Uint8Array): boolean {
  // 按字节比较而不是 `toString("latin1")`:后者只对 Buffer 有效(`Uint8Array#toString`
  // 不收编码参数,会静默返回 "37,80,68,70,45" 这种逗号分隔的十进制串 —— 判定永远为假)。
  return bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

/** `%PDF-` 的字节值。 */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** ZIP 本地文件头(`PK\x03\x04`)。docx/xlsx/pptx 都是 ZIP。 */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/**
 * OLE 复合文档头(`D0 CF 11 E0`)。**这一个判定覆盖两种东西**:旧版二进制的 `.doc`,
 * 以及**被密码保护的 OOXML**(加密后的 docx 不再是 ZIP,而是这种容器)。
 *
 * 分开认它很有价值:否则这两种情况都只会落进"不是 ZIP → 解析失败",而用户看到的
 * 应该是"这是加密文档"或"这是旧版 .doc",两者的下一步动作完全不同。
 */
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

export function isZipBytes(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

export function isOleBytes(bytes: Uint8Array): boolean {
  return OLE_MAGIC.every((byte, index) => bytes[index] === byte);
}
