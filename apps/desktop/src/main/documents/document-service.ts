import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type {
  DocumentFailureCode,
  DocumentOutcome,
  DocumentPageText,
  DocumentRenderOutcome,
  DocumentText,
  FetchUrlRequest,
  ReadDocxRequest,
  ReadPdfRequest,
  RenderPdfPagesRequest,
} from "@wordless/capability-documents";
import { extractHtmlText, extractHtmlTitle, isOleBytes, isPdfBytes, isZipBytes } from "./document-text.ts";
import { checkPublicHttpUrl, type HostResolver } from "./public-url.ts";

/**
 * 文档抽取的宿主实现:本地 PDF 与 URL → 文本。
 *
 * 三件事只在这里做,能力包不知道它们的存在:
 *   1. **网络策略** —— SSRF 判定、重定向上限、体积上限、超时。这些是宿主的安全边界,
 *      不是文档格式知识,所以判定函数在能力包里共享,策略在这里。
 *   2. **解析器** —— `pdf-parse`(它自带 pdfjs-dist 与 worker,解析在主线程之外)。
 *   3. **文件系统** —— 读字节、看大小。
 *
 * 为什么上限分成两套:本地文件没有网络风险,只有内存风险;URL 抓取是"把远端内容读进内存",
 * 两端都要小得多。混成一个数会让其中一边明显过紧或过松。
 */

/** 本地文档(PDF / docx)的体积上限。解析在 worker 或纯 JS 里做,这里防的是"一次读进内存"。 */
const MAX_LOCAL_DOCUMENT_BYTES = 64 * 1024 * 1024;
/** URL 响应的体积上限。 */
const MAX_URL_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 30_000;
const PARSE_TIMEOUT_MS = 60_000;

/** 渲染页面图像的放大倍数:约 150dpi,够文字识别看清正文。 */
const RENDER_SCALE = 2;

/** 解析超时。用类而不是字符串标记,免得"消息里恰好含 timeout"被误判。 */
class DocumentTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentTimeoutError";
  }
}

export interface DocumentServiceOptions {
  /**
   * 主机名解析。注入而不是直接调 `lookup` —— 判定逻辑在能力包里,
   * 这里只提供"域名 → 地址"这一步,测试可以给一个假的。
   */
  resolveHost?: HostResolver;
  fetchImpl?: typeof fetch;
}

const defaultResolveHost: HostResolver = async (hostname) =>
  await lookup(hostname, { all: true, verbatim: true })
    .then((addresses) => addresses.map((entry) => entry.address))
    .catch(() => []);

export class DocumentService {
  private readonly resolveHost: HostResolver;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DocumentServiceOptions = {}) {
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** 读本地 PDF 的文本层。 */
  async readPdf(request: ReadPdfRequest, options: { signal: AbortSignal }): Promise<DocumentOutcome> {
    if (options.signal.aborted) return { ok: false, code: "cancelled", message: "The request was cancelled." };

    let size: number;
    try {
      const details = await stat(request.path);
      if (!details.isFile()) return { ok: false, code: "unsupported-format", message: `${request.path} is not a regular file.` };
      size = details.size;
    } catch {
      return { ok: false, code: "not-found", message: `${request.path} does not exist.` };
    }
    if (size > MAX_LOCAL_DOCUMENT_BYTES) {
      return { ok: false, code: "too-large", message: `${request.path} is ${size} bytes; the limit is ${MAX_LOCAL_DOCUMENT_BYTES}.` };
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(request.path);
    } catch (error) {
      return { ok: false, code: "parse-failed", message: `${request.path} could not be read: ${messageOf(error)}` };
    }
    if (!isPdfBytes(bytes)) {
      return { ok: false, code: "unsupported-format", message: `${request.path} is not a PDF (its content does not start with %PDF-).` };
    }

    return await this.parsePdf(bytes, {
      source: basename(request.path),
      location: request.path,
      started: Date.now(),
      ...(request.startPage === undefined ? {} : { startPage: request.startPage }),
      ...(request.endPage === undefined ? {} : { endPage: request.endPage }),
    });
  }

  /**
   * 把 PDF 的若干页渲染成 PNG —— 扫描件走文字识别的第一步。
   *
   * 渲染**快**(实测约 50ms/页),所以这里没有页数上限:上限在工具层,因为真正慢的是识别,
   * 而且识别引擎是串行的。渲染与识别分开,调用方才能分别设边界。
   */
  async renderPdfPages(request: RenderPdfPagesRequest, options: { signal: AbortSignal }): Promise<DocumentRenderOutcome> {
    if (options.signal.aborted) return { ok: false, code: "cancelled", message: "The request was cancelled." };
    const pages = [...new Set(request.pages)].filter((num) => Number.isInteger(num) && num >= 1).sort((a, b) => a - b);
    if (pages.length === 0) return { ok: false, code: "parse-failed", message: "No page was given to render." };

    let bytes: Buffer;
    try {
      const details = await stat(request.path);
      if (!details.isFile()) return { ok: false, code: "unsupported-format", message: `${request.path} is not a regular file.` };
      if (details.size > MAX_LOCAL_DOCUMENT_BYTES) {
        return { ok: false, code: "too-large", message: `${request.path} is ${details.size} bytes; the limit is ${MAX_LOCAL_DOCUMENT_BYTES}.` };
      }
      bytes = await readFile(request.path);
    } catch {
      return { ok: false, code: "not-found", message: `${request.path} does not exist.` };
    }
    if (!isPdfBytes(bytes)) {
      return { ok: false, code: "unsupported-format", message: `${request.path} is not a PDF (its content does not start with %PDF-).` };
    }

    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      // 逐页指定而不是给范围:扫描件里通常只有一部分页没有文本层,渲染整段是白烧。
      const shots = await withTimeout(
        parser.getScreenshot({ partial: pages, scale: RENDER_SCALE, imageBuffer: true, imageDataUrl: false }),
        PARSE_TIMEOUT_MS,
        request.path,
      );
      return {
        ok: true,
        pages: shots.pages.flatMap((shot) =>
          shot.data === undefined ? [] : [{ num: shot.pageNumber, mimeType: "image/png", base64: Buffer.from(shot.data).toString("base64") }],
        ),
      };
    } catch (error) {
      return { ok: false, ...pdfFailure(error, request.path) };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  /**
   * 读 .docx 的正文。
   *
   * 解析用 `mammoth`(纯 JS,BSD-2):它按 OOXML 的语义抽文本 —— 跨 run 的同一段会接起来,
   * **被追踪删除的 `<w:delText>` 不会混进来**,实体正确解码。手写一个 XML 走查在这些地方
   * 都会静默出错,而"静默出错的文本"正是一个知识库最不能接受的失败方式。
   *
   * 为什么不用按需安装的 Python(markitdown 那条路):`docs/architecture/ocr.md` 已经就
   * 同一类能力定过调子 —— **可用性不该挂在 pip 上**。读用户手上的文档必须"点了就能读"。
   */
  async readDocx(request: ReadDocxRequest, options: { signal: AbortSignal }): Promise<DocumentOutcome> {
    if (options.signal.aborted) return { ok: false, code: "cancelled", message: "The request was cancelled." };

    const started = Date.now();
    const extension = extname(request.path).toLowerCase();
    if (extension === ".doc") {
      // 旧版 .doc 是另一种二进制格式,任何 OOXML 解析器都读不了它 —— 说清楚,并给出下一步。
      return {
        ok: false,
        code: "unsupported-format",
        message: `${request.path} is a legacy .doc file (binary Word format), which cannot be read. Ask the user to save it as .docx.`,
      };
    }
    if (extension !== ".docx") {
      return {
        ok: false,
        code: "unsupported-format",
        message: `${request.path} is not a .docx. For a PDF use extract_text_from_pdf.`,
      };
    }

    let size: number;
    try {
      const details = await stat(request.path);
      if (!details.isFile()) return { ok: false, code: "unsupported-format", message: `${request.path} is not a regular file.` };
      size = details.size;
    } catch {
      return { ok: false, code: "not-found", message: `${request.path} does not exist.` };
    }
    if (size > MAX_LOCAL_DOCUMENT_BYTES) {
      return { ok: false, code: "too-large", message: `${request.path} is ${size} bytes; the limit is ${MAX_LOCAL_DOCUMENT_BYTES}.` };
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(request.path);
    } catch (error) {
      return { ok: false, code: "parse-failed", message: `${request.path} could not be read: ${messageOf(error)}` };
    }
    if (isOleBytes(bytes)) {
      // 加密过的 OOXML 与旧版 .doc 是同一个容器 —— 两种情况都要给出各自的下一步。
      return {
        ok: false,
        code: "encrypted",
        message: `${request.path} is an OLE document: either a password-protected .docx or a legacy .doc. Ask the user for a password-free .docx.`,
      };
    }
    if (!isZipBytes(bytes)) {
      return { ok: false, code: "parse-failed", message: `${request.path} is not a .docx: its content is neither a ZIP nor an OLE document.` };
    }

    return await this.parseDocxBytes(bytes, { source: basename(request.path), location: request.path, started });
  }

  /** 抓一个 URL 并抽出正文。HTML / 纯文本 / JSON / PDF 都走这一条。 */
  async fetchUrl(request: FetchUrlRequest, options: { signal: AbortSignal }): Promise<DocumentOutcome> {
    const started = Date.now();
    const checked = await checkPublicHttpUrl(request.url, this.resolveHost);
    if (!checked.ok) return { ok: false, code: "blocked-host", message: blockedMessage(checked.code, request.url) };

    const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

    let current = checked.url;
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
      if (signal.aborted) return { ok: false, code: "cancelled", message: "The request was cancelled." };

      let response: Response;
      try {
        response = await this.fetchImpl(current, {
          redirect: "manual",
          signal,
          headers: { accept: "text/html, text/plain, application/json, application/pdf;q=0.5" },
        });
      } catch (error) {
        return { ok: false, code: "http-error", message: `${current} could not be fetched: ${messageOf(error)}` };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, code: "http-error", message: `${current} redirected (${response.status}) without a Location header.` };
        // **逐跳复检**:重定向目标是攻击面的一部分,第一跳合法不代表后面几跳合法。
        const next = await checkPublicHttpUrl(new URL(location, current).toString(), this.resolveHost);
        if (!next.ok) return { ok: false, code: "blocked-host", message: blockedMessage(next.code, location) };
        current = next.url;
        continue;
      }
      if (!response.ok) return { ok: false, code: "http-error", message: `${current} returned HTTP ${response.status}.` };

      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_URL_BYTES) return { ok: false, code: "too-large", message: `${current} is ${declared} bytes; the limit is ${MAX_URL_BYTES}.` };

      const body = await readCapped(response, MAX_URL_BYTES);
      if (!body.ok) return { ok: false, code: "too-large", message: `${current} is larger than ${MAX_URL_BYTES} bytes.` };

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("wordprocessingml")) {
        // docx 从 URL 下来时,只有 content-type 能区分它和 xlsx/pptx —— 三者的 ZIP 魔数完全一样。
        return await this.parseDocxBytes(body.bytes, { source: current, location: current, started });
      }
      if (isPdfBytes(body.bytes) || contentType.includes("application/pdf")) {
        return await this.parsePdf(body.bytes, { source: current, location: current, started });
      }
      const raw = body.bytes.toString("utf8");
      if (contentType.includes("html")) {
        return {
          ok: true,
          document: {
            source: current,
            location: current,
            kind: "html",
            title: extractHtmlTitle(raw),
            pages: [{ num: 1, text: extractHtmlText(raw) }],
            totalPages: 1,
            byteLength: body.bytes.byteLength,
            durationMs: Date.now() - started,
          },
        };
      }
      return {
        ok: true,
        document: {
          source: current,
          location: current,
          kind: "text",
          title: null,
          pages: [{ num: 1, text: raw.replace(/\u0000/g, "").trim() }],
          totalPages: 1,
          byteLength: body.bytes.byteLength,
          durationMs: Date.now() - started,
        },
      };
    }
    return { ok: false, code: "http-error", message: `${request.url} exceeded the redirect limit (${MAX_REDIRECTS}).` };
  }

  /** 解析 docx 字节(本地与 URL 共用)。 */
  private async parseDocxBytes(
    // mammoth 的 `buffer` 选项要的是 Buffer(不是任意 Uint8Array),所以这里比 PDF 那条窄。
    bytes: Buffer,
    options: { source: string; location: string; started: number },
  ): Promise<DocumentOutcome> {
    const byteLength = bytes.byteLength;
    if (isOleBytes(bytes)) {
      return { ok: false, code: "encrypted", message: `${options.source} is an OLE document (password-protected or legacy .doc).` };
    }
    if (!isZipBytes(bytes)) {
      return { ok: false, code: "parse-failed", message: `${options.source} is not a Word document: its content is not a ZIP container.` };
    }
    try {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      const text = value.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
      return {
        ok: true,
        document: {
          source: options.source,
          location: options.location,
          kind: "docx",
          title: null,
          pages: [{ num: 1, text }],
          totalPages: 1,
          byteLength,
          durationMs: Date.now() - options.started,
        },
      };
    } catch (error) {
      return { ok: false, code: "parse-failed", message: `${options.source} could not be parsed: ${messageOf(error)}` };
    }
  }

  /**
   * 解析 PDF 字节。
   *
   * 页数**先问 `getInfo()`**再按范围取文本:只给了 `startPage` 时,需要总页数才能表达
   * "从第 N 页到末页"(`pdf-parse` 的 `{first: N}` 意思是"前 N 页",不是"从 N 页起")。
   * `getInfo()` 是一次元数据遍历,不抽文本,比"先全量解析再切片"便宜得多。
   */
  private async parsePdf(
    bytes: Uint8Array,
    options: { source: string; location: string; started: number; startPage?: number; endPage?: number },
  ): Promise<DocumentOutcome> {
    // **必须在构造解析器之前取字节数**:TypedArray 会被转移进 worker,转移后长度归零。
    const byteLength = bytes.byteLength;
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const info = await withTimeout(parser.getInfo(), PARSE_TIMEOUT_MS, options.source);
      const totalPages = info.total;

      const first = options.startPage ?? 1;
      if (first > totalPages) {
        return { ok: false, code: "parse-failed", message: `${options.source} has ${totalPages} page(s); startPage ${first} is past the end.` };
      }
      const last = Math.min(options.endPage ?? totalPages, totalPages);
      if (last < first) {
        return { ok: false, code: "parse-failed", message: `endPage ${last} is before startPage ${first}.` };
      }

      const extracted = await withTimeout(parser.getText({ first, last }), PARSE_TIMEOUT_MS, options.source);
      const pages: DocumentPageText[] = extracted.pages.map((page) => ({ num: page.num, text: page.text.replace(/\u0000/g, "").trim() }));
      return {
        ok: true,
        document: {
          source: options.source,
          location: options.location,
          kind: "pdf",
          title: null,
          pages,
          totalPages,
          byteLength,
          durationMs: Date.now() - options.started,
        },
      };
    } catch (error) {
      return { ok: false, ...pdfFailure(error, options.source) };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }
}

/** 读响应体并卡上限。超限时**取消读取**,而不是把已经收到的字节丢掉。 */
async function readCapped(response: Response, limit: number): Promise<{ ok: true; bytes: Buffer } | { ok: false }> {
  if (!response.body) return { ok: true, bytes: Buffer.alloc(0) };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(next.value);
  }
  return { ok: true, bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) };
}

async function withTimeout<T>(work: Promise<T>, ms: number, source: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DocumentTimeoutError(`Parsing ${source} took longer than ${ms}ms.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * PDF 失败分类。
 *
 * `encrypted` 单独分出来,因为它是**唯一能换路**的一类:让用户给一份没有密码的副本即可。
 * 其余都塌进 `parse-failed` —— 损坏、截断、不是真 PDF,对调用方是同一件事。
 */
function pdfFailure(error: unknown, source: string): { code: DocumentFailureCode; message: string } {
  const name = error instanceof Error ? error.name : "";
  const message = messageOf(error);
  if (name === "PasswordException" || /password/i.test(message)) {
    return { code: "encrypted", message: `${source} is password-protected.` };
  }
  if (error instanceof DocumentTimeoutError) return { code: "parse-failed", message: message };
  return { code: "parse-failed", message: `${source} could not be parsed: ${message}` };
}

function blockedMessage(code: string, url: string): string {
  switch (code) {
    case "invalid-url":
      return `${url} is not a valid URL.`;
    case "non-http":
      return `${url} is not HTTP(S); only public web URLs can be fetched.`;
    case "credentials":
      return `${url} carries credentials; those are not sent.`;
    case "private-host":
      return `${url} points at a local or metadata host; those are refused.`;
    case "unresolved":
      return `${url} could not be resolved to an address.`;
    default:
      return `${url} resolves to a private address; those are refused.`;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
