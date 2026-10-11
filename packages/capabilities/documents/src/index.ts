// **类型**导出,不是值导出:`port.ts` 里只有接口(契约),而把这一点写明有个实际好处 ——
// 本包因此没有任何运行时的相对导入(`.js` 说明符),于是普通的 `node --test` 也能加载它
// (`apps/desktop/test/documents.test.ts` 直接 import 本包做"真实 PDF → 排版"的集成断言;
// 其它能力包用的是 `export *`,它们加载不了,测试只能绕开)。
export type * from "./port.js";

import { Type, type TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@wordless/agent";
import type { OcrPort } from "@wordless/capability-ocr";
import type { DocumentFailureCode, DocumentOutcome, DocumentPort, DocumentPageText, DocumentText } from "./port.js";

/**
 * 文档抽取工具。
 *
 * 这两个工具解决的是同一件事:**把用户手上的文件变成 agent 能读的文本**。之前只有
 * 工作区工具(`read` 是 UTF-8 文本读取器)和图片 OCR,于是 PDF、网页这类东西在 agent 眼里
 * 是死重 —— 它会说"我看过了",然后编。
 *
 * 三条纪律写在描述与输出里,缺一条都会让后面的推理被带偏:
 *   1. **扫件必须说出来**:没有文本层的 PDF 要明确回报"这是扫描件",绝不能回一段空文本
 *      让模型以为文档是空的(OCR 那边踩过同一个坑)。
 *   2. **读到的 ≠ 整份**:页范围与截断都要交代清楚,并说明**怎么继续读**。
 *   3. **来源标注**:结果里说清这是"本机从文本层抽出来的字",不是摘要、也不是对版面的描述。
 */

type ToolDetails = Record<string, unknown>;

/** 保留参数推断:每个工具的 `input` 由它的 schema 推出。 */
function tool<TParameters extends TSchema>(definition: AgentTool<TParameters, ToolDetails>): AgentTool<TParameters, ToolDetails> {
  return definition;
}

function text(value: string): AgentToolResult<ToolDetails>["content"] {
  return [{ type: "text", text: value }];
}

/** 输出预算的默认值与上限。上限存在是因为工具结果会进会话,而会话有上下文窗口。 */
export const DEFAULT_MAX_CHARS = 60_000;
const MAX_MAX_CHARS = 400_000;

/**
 * 单次调用最多识别多少页扫描件。
 *
 * 上限存在是因为文字识别是**串行**的(宿主只有一个识别引擎,一次一个任务),单页还有超时。
 * 一本几百页的扫描件不能在一次工具调用里吞完 —— 超出的页如实报出来,让调用方接着读。
 * 5 是个保守值:宁可多几轮,也不要把一次工具调用拖成几分钟。
 */
export const DEFAULT_MAX_OCR_PAGES = 5;

/** 没有文字识别时给模型的解释(与"引擎说它自己不可用"区分开,但都走同一条 unavailable 通道)。 */
const OCR_ABSENT = "this build has no local text recognition";

/** 渲染页面图像时的放大倍数:约 150dpi,够文字识别看清正文,又不会让单页图大到离谱。 */
const RENDER_SCALE = 2;

/** 页面图像的名字里带上页码 —— 识别结果**没有页码字段**,只能靠名字认回去。 */
const pageImageName = (num: number): string => `page-${num}.png`;

const PDF_DESCRIPTION = `Extract the text layer of a PDF file, page by page.

Output
  One block per page ("--- page N ---"), then a metadata footer. The text is the document's own text layer, read on this machine — it is NOT a summary, and NOT a description of how the page looks.

When to use
  - The user attached or pointed at a PDF and you need what it says.
  - You only need part of a large file: pass startPage/endPage instead of reading all of it.

When NOT to use
  - A vision-capable model looking at a rendered page: layout, charts, seals, handwriting and colour are not in the text layer.
  - You need the file's bytes, size or timestamps: use the workspace tools.

Scanned PDFs
  A PDF made of page images has no text layer. Those pages are rendered and read with a local text-recognition engine, and the result is marked "(OCR)" — recognized text, not the document's own text, so characters may be misread and tables and layout are lost.
  Each call recognizes a limited number of pages; when pages are left over the footer says which ones and how to continue reading them. If recognition is unavailable, the tool says so explicitly rather than returning empty text.

Limitations
  - Page numbers are 1-based and inclusive.
  - The text layer is whatever the producing application embedded. Multi-column layouts can interleave, and tables are flattened into lines.
  - Large files take seconds (parsing happens off the main thread). Prefer a page range over the whole file.`;

const DOCX_DESCRIPTION = `Extract the text of a Word document (.docx), paragraph by paragraph.

Output
  The document's own text, read on this machine — not a summary, and not a description of how the page looks. Paragraphs are separated by blank lines.

When to use
  - The user attached or pointed at a .docx and you need what it says.

When NOT to use
  - A legacy .doc file: that is a different, binary format this tool cannot read. It says so explicitly — ask the user to save it as .docx.
  - A vision-capable model looking at a rendered page: layout, images, charts and colours are not in the text.
  - You need the file's bytes, size or timestamps: use the workspace tools.

Limitations
  - Tables are flattened: each cell becomes its own paragraph, so the grid is lost.
  - Text deleted by tracked changes is not included; inserted text is.
  - Long documents are returned in character windows: the footer says where you are and gives the offset to continue from.`;

const URL_DESCRIPTION = `Fetch a URL and return its readable text.

Handles web pages (text with script/style/comments removed, plus the page title), plain text, JSON, and PDFs (page by page, like extract_text_from_pdf).

When to use
  - The user gave you a link, or the task needs the current content of a page.
  - The file you need lives at a URL rather than on disk.

When NOT to use
  - A page that needs the user's session: this fetch has no cookies, so logins and paywalls return the logged-out page.
  - A page whose meaning is in its layout or images: you get text only.
  - A browser tab the user has already shared with you: prefer browser_snapshot, which sees the rendered page.

Limitations
  - Public HTTP(S) only. localhost, private-network addresses and URLs carrying credentials are refused.
  - Follows at most 5 redirects; the response body is capped.
  - JavaScript is not executed, so a page that renders entirely client-side returns little or no text.`;

export interface DocumentToolOptions {
  /**
   * 扫描件回退:把没有文本层的页渲染成图,交给本地文字识别。
   *
   * 不给它就退回"如实说读不了" —— 与 `browser_screenshot` 同一个取舍:像素递不过去时,
   * 能读成文字总比什么都不做强。
   */
  ocr?: OcrPort;
  /** 单次调用最多识别多少页。默认 {@link DEFAULT_MAX_OCR_PAGES}。 */
  maxOcrPages?: number;
}

export function createDocumentTools(port: DocumentPort, options: DocumentToolOptions = {}): AgentTool[] {
  const readPdf = tool({
    name: "extract_text_from_pdf",
    label: "Extract text from a PDF",
    description: PDF_DESCRIPTION,
    parameters: Type.Object({
      path: Type.String({ minLength: 1, description: "Path to the PDF, relative to the workspace or absolute inside it." }),
      startPage: Type.Optional(Type.Integer({ minimum: 1, description: "First page to read (1-based, inclusive). Defaults to the first page." })),
      endPage: Type.Optional(Type.Integer({ minimum: 1, description: "Last page to read (inclusive). Defaults to the last page." })),
      maxChars: Type.Optional(Type.Integer({ minimum: 500, maximum: MAX_MAX_CHARS, description: `Output budget in characters. Defaults to ${DEFAULT_MAX_CHARS}.` })),
    }),
    async execute(_id, input, signal) {
      const abort = signal ?? new AbortController().signal;
      const outcome = await port.readPdf(
        {
          path: input.path,
          ...(input.startPage === undefined ? {} : { startPage: input.startPage }),
          ...(input.endPage === undefined ? {} : { endPage: input.endPage }),
        },
        { signal: abort },
      );
      if (!outcome.ok) return documentResult(outcome, input.maxChars);
      const read = await recognizeMissingPages(port, options, { path: input.path }, outcome.document, abort);
      return documentResult({ ok: true, document: read.document }, input.maxChars, { ocr: read.ocr });
    },
  });

  const fetchUrl = tool({
    name: "fetch_url",
    label: "Fetch a URL",
    description: URL_DESCRIPTION,
    parameters: Type.Object({
      url: Type.String({ minLength: 1, description: "Absolute http(s) URL." }),
      maxChars: Type.Optional(Type.Integer({ minimum: 500, maximum: MAX_MAX_CHARS, description: `Output budget in characters. Defaults to ${DEFAULT_MAX_CHARS}.` })),
    }),
    async execute(_id, input, signal) {
      const outcome = await port.fetchUrl({ url: input.url }, { signal: signal ?? new AbortController().signal });
      return documentResult(outcome, input.maxChars);
    },
  });

  const readDocx = tool({
    name: "extract_text_from_docx",
    label: "Extract text from a Word document",
    description: DOCX_DESCRIPTION,
    parameters: Type.Object({
      path: Type.String({ minLength: 1, description: "Path to the .docx, relative to the workspace or absolute inside it." }),
      offset: Type.Optional(
        Type.Integer({ minimum: 0, description: "Character offset to start from. Use the value the footer reports to continue a long document." }),
      ),
      maxChars: Type.Optional(Type.Integer({ minimum: 500, maximum: MAX_MAX_CHARS, description: `Output budget in characters. Defaults to ${DEFAULT_MAX_CHARS}.` })),
    }),
    async execute(_id, input, signal) {
      const outcome = await port.readDocx({ path: input.path }, { signal: signal ?? new AbortController().signal });
      if (!outcome.ok) return { content: text(failureText(outcome.code, outcome.message)), details: { code: outcome.code, reason: outcome.message } };
      const full = outcome.document.pages[0]?.text ?? "";
      const offset = input.offset ?? 0;
      // 越界要说清楚**文档有多长**,否则模型只能盲试下一个偏移量。
      if (offset > full.length) {
        return {
          content: text(
            `Could not read the document (offset-out-of-range): offset ${offset} is past the end of ${outcome.document.source}, which is ${full.length} character(s) long.`,
          ),
          details: { code: "offset-out-of-range", totalCharacters: full.length },
        };
      }
      const windowed: DocumentText = { ...outcome.document, pages: [{ num: 1, text: full.slice(offset) }] };
      return documentResult({ ok: true, document: windowed }, input.maxChars, {
        window: { offset, totalCharacters: full.length },
      });
    },
  });

  return [readPdf, readDocx, fetchUrl];
}

function documentResult(
  outcome: DocumentOutcome,
  maxChars: number | undefined,
  context?: DocumentFormatContext,
): AgentToolResult<ToolDetails> {
  if (!outcome.ok) return { content: text(failureText(outcome.code, outcome.message)), details: { code: outcome.code, reason: outcome.message } };
  return { content: text(formatDocumentText(outcome.document, maxChars, context)), details: detailsOf(outcome.document) };
}

/**
 * 扫描件回退:把**没有文本层的页**渲染成图,交给本地文字识别。
 *
 * 三条边界,每条都是"不这样做就会骗人"的地方:
 *   1. **单次上限** —— 识别是串行的,一次调用不能吞下整本扫描件;超出的页如实报出来并说明怎么接着读。
 *   2. **标注来源** —— 识别出来的页标 `source: "ocr"`,排版层会逐页写 `(OCR)`。混进文本层里,
 *      读的人就分不清"原文如此"和"机器认出来的"。
 *   3. **不可用就说实话** —— 没有识别能力、渲染失败、引擎报错,都走 `unavailable`,不留空白。
 */
async function recognizeMissingPages(
  port: DocumentPort,
  options: DocumentToolOptions,
  request: { path: string },
  document: DocumentText,
  signal: AbortSignal,
): Promise<{ document: DocumentText; ocr: NonNullable<DocumentFormatContext["ocr"]> }> {
  const missing = document.pages.filter((page) => page.text.trim().length === 0).map((page) => page.num);
  if (missing.length === 0) return { document, ocr: {} };
  if (!options.ocr?.recognizeInline) return { document, ocr: { unavailable: OCR_ABSENT } };

  const budget = Math.max(1, options.maxOcrPages ?? DEFAULT_MAX_OCR_PAGES);
  const wanted = missing.slice(0, budget);
  const skipped = missing.slice(budget);

  const rendered = await port.renderPdfPages({ path: request.path, pages: wanted }, { signal });
  if (!rendered.ok) return { document, ocr: { unavailable: rendered.message, skipped } };

  const outcome = await options.ocr.recognizeInline(
    rendered.pages.map((page) => ({ name: pageImageName(page.num), mimeType: page.mimeType, base64: page.base64 })),
    { signal },
  );
  if (!outcome.ok) return { document, ocr: { unavailable: outcome.message, skipped } };

  // 按**名字**认回页码:识别结果的契约里没有页码字段,只有调用方给的名字。
  const byName = new Map(outcome.recognition.pages.map((page) => [page.name, page.text.trim()]));
  const recognized = new Map<number, string>();
  for (const num of wanted) {
    const text = byName.get(pageImageName(num)) ?? "";
    if (text.length > 0) recognized.set(num, text);
  }
  const pages: DocumentPageText[] = document.pages.map((page) => {
    const text = recognized.get(page.num);
    return text === undefined ? page : { ...page, text, source: "ocr" as const };
  });
  return {
    document: { ...document, pages },
    ocr: {
      recognized: [...recognized.keys()],
      // 送去了但没读出文字的页:要单独说,否则调用方会以为"没送"。
      blank: wanted.filter((num) => !recognized.has(num)),
      skipped,
    },
  };
}

/**
 * 本次返回的文本在整份文档里的位置。
 *
 * 只有**没有页概念**的格式(docx)需要它:PDF 靠页范围续读,docx 靠字符偏移。所以窗口是
 * 一个显式入参,而不是塞进 `DocumentText` —— 后者是端口契约,不该长出格式专属的字段。
 */
export interface TextWindow {
  offset: number;
  totalCharacters: number;
}

/** 排版层需要知道、但从 `DocumentText` 里看不出来的事。 */
export interface DocumentFormatContext {
  /** 字符窗口(docx 的长文档续读)。 */
  window?: TextWindow;
  /**
   * 扫描件回退的结果。
   *
   * 页码之外的两种"没读到"必须在这里说:引擎不可用(整批没读成),以及被单次上限挡下的页。
   * 它们都不体现在 `pages` 里 —— 那些页只是"文字为空",看不出原因。
   */
  ocr?: {
    /** 真的送去了、也读出了文字的页。 */
    recognized?: number[];
    /** 送去了但没读出文字的页(空白页、纯图页)。 */
    blank?: number[];
    /** 因为单次上限没送去的页。 */
    skipped?: number[];
    /** 回退不可用的原因。 */
    unavailable?: string;
  };
}

/**
 * 失败文案。
 *
 * 每个**能换路**的分类都给出下一步:分类存在就是为了让模型换路,只说"失败了"等于白分类。
 */
function failureText(code: DocumentFailureCode, message: string): string {
  const nextStep: Partial<Record<DocumentFailureCode, string>> = {
    "not-found": "Check the path with the workspace tools (find/ls) before retrying.",
    "outside-workspace": "Only files inside this session's workspace can be read.",
    "unsupported-format": "This tool reads PDFs, web pages and plain text only. For a .docx use extract_text_from_docx.",
    "too-large": "Read a page range (startPage/endPage) instead of the whole document.",
    encrypted: "The file is password-protected. Ask the user for a copy without a password.",
    "blocked-host": "Only public HTTP(S) URLs can be fetched — localhost and private addresses are refused by policy.",
    "http-error": "The server did not return the document. Check the URL, or ask the user for the file itself.",
    "parse-failed": "The file could not be parsed. It may be corrupt, or not the format its name suggests.",
    cancelled: "The request was cancelled.",
  };
  const suffix = nextStep[code];
  return `Could not read the document (${code}): ${message}${suffix ? `\n\n${suffix}` : ""}`;
}

/**
 * 把抽取结果渲染成给模型看的文本。
 *
 * 三条必须做到的事:
 *   - **没有文本层时明确说出来**,并说清这意味着什么(扫描件),而不是回空文本;
 *   - 截断时列出**漏掉了哪些页**,并说明怎么把它们读回来;
 *   - 末尾标注来源性质(本机抽的文本层),否则模型会把它当成"我看过这一页了"。
 */
export function formatDocumentText(document: DocumentText, maxChars?: number, context: DocumentFormatContext = {}): string {
  const { window, ocr } = context;
  const limit = Math.max(500, Math.min(maxChars ?? DEFAULT_MAX_CHARS, MAX_MAX_CHARS));
  // 只有 PDF 是分页的。给网页加 `--- page 1 ---` 会暗示它是分页文档,而它只是一页。
  const paginated = document.kind === "pdf";
  const emptyPages = document.pages.filter((page) => page.text.trim().length === 0).map((page) => page.num);
  const readable = document.pages.filter((page) => page.text.trim().length > 0);

  const head = [document.title ? `${document.source} — ${document.title}` : document.source, kindLine(document)];
  if (readable.length === 0) return [...head, "", noTextBody(document, emptyPages, context)].join("\n");

  const blocks: string[] = [];
  const omitted: number[] = [];
  let used = 0;
  for (const page of document.pages) {
    const body = page.text.trim();
    if (body.length === 0) continue;
    const label = page.source === "ocr" ? `--- page ${page.num} (OCR) ---` : `--- page ${page.num} ---`;
    const block = paginated ? `${label}\n${body}` : body;
    if (blocks.length === 0 && block.length > limit) {
      // 单页就超预算:宁可把这一页截断也要给出内容 —— 回一段"预算不够"对模型毫无用处。
      blocks.push(`${block.slice(0, limit)}\n[Truncated at the output budget: ${body.length} characters total]`);
      used = limit;
      continue;
    }
    if (used + block.length > limit) {
      omitted.push(page.num);
      continue;
    }
    blocks.push(block);
    used += block.length;
  }

  const notes: string[] = [];
  if (window) {
    // 续读信息必须在**每一次**返回里出现,包括"到这里就结束了"的那种 ——
    // 否则模型分不清"读完了"和"被截断了"。
    const shownEnd = Math.min(window.offset + used, window.totalCharacters);
    if (window.offset > 0 || shownEnd < window.totalCharacters) {
      notes.push(
        `Showing characters ${window.offset}-${shownEnd} of ${window.totalCharacters}.` +
          (shownEnd < window.totalCharacters ? ` Continue with offset=${shownEnd}.` : " This is the end of the document."),
      );
    }
  } else if (omitted.length > 0) {
    const list = formatPageList(omitted);
    notes.push(
      omitted.length === 1
        ? `Truncated at the output budget: page ${list} of ${document.totalPages} was not included. Read it with startPage/endPage, or raise maxChars.`
        : `Truncated at the output budget: pages ${list} of ${document.totalPages} were not included. Read them with startPage/endPage, or raise maxChars.`,
    );
  }
  const recognizedPages = document.pages.filter((page) => page.source === "ocr").map((page) => page.num);
  if (recognizedPages.length > 0) {
    // 来源标注:OCR 读的是像素,会读错字、丢表格与版式 —— 必须让读的人知道这不是原文。
    notes.push(
      `Pages ${formatPageList(recognizedPages)} marked (OCR) were read from page images by a local text-recognition engine, not from the document's own text layer: characters may be misread, and tables, layout and anything graphical are lost.`,
    );
  }
  if (ocr?.skipped !== undefined && ocr.skipped.length > 0) {
    notes.push(
      `Pages ${formatPageList(ocr.skipped)} have no text layer and were not recognized: each call recognizes a limited number of pages. Read them with startPage=${Math.min(...ocr.skipped)}.`,
    );
  }
  if (ocr?.unavailable !== undefined) {
    notes.push(`The pages with no text layer could not be recognized: ${ocr.unavailable}.`);
  }
  if (paginated && emptyPages.length > 0) {
    const list = formatPageList(emptyPages);
    notes.push(
      emptyPages.length === 1
        ? `Page ${list} has no text layer — most likely a scanned insert or a blank page, not text this tool failed to find.`
        : `Pages ${list} have no text layer — most likely scanned inserts or blank pages, not text this tool failed to find.`,
    );
  }
  notes.push("The text above is the document's own text layer, extracted locally — not a summary, and not a description of how the page looks.");
  notes.push(footerStats(document, blocks.length, used, paginated));

  return [...head, "", ...blocks, "", "---", ...notes].join("\n");
}

function kindLine(document: DocumentText): string {
  if (document.kind === "pdf") return `Kind: PDF, ${document.totalPages} page(s).`;
  if (document.kind === "html") return "Kind: web page (text extracted from the HTML).";
  return "Kind: plain text.";
}

/**
 * 整份都没有文本层时的正文。
 *
 * 这一段是**这个工具最重要的输出**:扫描件在真实用户资料里占比很高,而"空文本"会被模型
 * 读成"文档是空的",然后基于"文档没有内容"继续推理 —— 比报错糟得多。
 */
function noTextBody(document: DocumentText, emptyPages: number[], context: DocumentFormatContext): string {
  if (document.kind === "docx") {
    return [
      "This document contains no text.",
      "",
      "A .docx has no extractable text when it is made of images (a scan pasted into Word, screenshots, a diagram), or when its text sits in parts this tool does not read (text boxes, headers and footers, footnotes).",
      "Tell the user the document has no extractable text rather than treating it as an empty document.",
      footerStats(document, 0, 0, false),
    ].join("\n");
  }
  if (document.kind !== "pdf") {
    return [
      `No readable text was found in this ${document.kind === "html" ? "page" : "file"}.`,
      "",
      "The content may be rendered by JavaScript (which this tool does not execute), or it may be a binary format rather than text.",
      footerStats(document, 0, 0, false),
    ].join("\n");
  }
  const scanned = emptyPages.length >= document.totalPages;
  const ocr = context.ocr;
  // 三种"读不到"必须分开说 —— 它们的下一步动作完全不同:
  //   引擎不可用 → 让用户知道这台机器读不了扫描件;
  //   识别过了但没读出字 → 这是空白页/纯图页,再试也没用;
  //   根本没试 → 说清试过什么。
  const why =
    ocr?.unavailable !== undefined
      ? [
          "What this means",
          `  This is a scanned document (images of pages, not text), and text recognition could not be used: ${ocr.unavailable}.`,
          "  Tell the user this document needs OCR — do NOT treat it as an empty document.",
        ]
      : (ocr?.blank?.length ?? 0) > 0
        ? [
            "What this means",
            `  This is a scanned document, and text recognition found no readable text on the ${ocr?.blank?.length} page(s) it read. They are most likely blank or purely graphical.`,
            "  Do NOT treat the document as empty: say what was found instead.",
          ]
        : [
            "What this means",
            "  Text extraction cannot read this file, and no text recognition was attempted.",
            "  Tell the user this document needs OCR, or ask them for a text version — do NOT treat it as an empty document.",
          ];
  return [
    scanned
      ? `No text layer found: all ${document.totalPages} page(s) contain no selectable text, which means this is a scanned document (images of pages, not text).`
      : `No readable text was found on the page(s) that were read (${formatPageList(emptyPages)} of ${document.totalPages}).`,
    "",
    ...why,
    "",
    footerStats(document, 0, 0, true),
  ].join("\n");
}

function formatPageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const shown = sorted.slice(0, 20).join(", ");
  return sorted.length > 20 ? `${shown}, … (${sorted.length} pages)` : shown;
}

function footerStats(document: DocumentText, shownPages: number, characters: number, paginated: boolean): string {
  const pages = paginated ? `${shownPages} of ${document.totalPages} page(s) shown, ` : "";
  return `${pages}${characters} character(s), ${document.byteLength} byte(s), ${document.durationMs}ms`;
}

function detailsOf(document: DocumentText): ToolDetails {
  return {
    kind: document.kind,
    location: document.location,
    title: document.title,
    totalPages: document.totalPages,
    pages: document.pages.map((page) => ({ num: page.num, characters: page.text.length })),
    byteLength: document.byteLength,
    durationMs: document.durationMs,
  };
}
