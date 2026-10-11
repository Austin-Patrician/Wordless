import { describe, expect, it } from "vitest";
import type { OcrPort } from "@wordless/capability-ocr";
import {
  createDocumentTools,
  formatDocumentText,
  type DocumentOutcome,
  type DocumentPort,
  type DocumentRenderOutcome,
  type DocumentText,
} from "../src/index.ts";

/**
 * 文档抽取工具。
 *
 * 最要紧的一条钉在这里:**扫描件必须被说出来**。真实用户资料里扫描件占比很高,而"没有文本层"
 * 如果只表现为一段空文本,模型会读成"文档是空的"然后基于它继续推理 —— 比报错糟得多。
 * 另外两条:读到的 ≠ 整份(页范围要交代清楚)、失败分类要能换路(密码 PDF 要能问用户要副本)。
 */

type Tool = ReturnType<typeof createDocumentTools>[number];
type ToolResult = { content: Array<{ type: string; text?: string }>; details: Record<string, unknown> };

const TEXT_DOCUMENT: DocumentText = {
  source: "handbook.pdf",
  location: "/workspace/handbook.pdf",
  kind: "pdf",
  title: null,
  pages: [
    { num: 1, text: "Chapter one\nExpenses are reimbursed within 30 days." },
    { num: 2, text: "Chapter two\nTravel requires prior approval." },
  ],
  totalPages: 2,
  byteLength: 4096,
  durationMs: 120,
};

function port(
  outcome: DocumentOutcome,
  render: DocumentRenderOutcome = { ok: true, pages: [] },
): { port: DocumentPort; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    port: {
      readPdf: async (request) => {
        calls.push(request);
        return outcome;
      },
      readDocx: async (request) => {
        calls.push(request);
        return outcome;
      },
      renderPdfPages: async (request) => {
        calls.push(request);
        return render;
      },
      fetchUrl: async (request) => {
        calls.push(request);
        return outcome;
      },
    },
  };
}

/** 假的文字识别端口:把"页面图像"的名字当成识别结果返回,方便断言。 */
function ocrPort(textFor: (name: string) => string, ok = true): { calls: { name: string; base64: string }[]; port: OcrPort } {
  const calls: { name: string; base64: string }[] = [];
  return {
    calls,
    port: {
      status: async () => ({ available: ok, detail: ok ? "Ready (ppocrv5)." : "OCR assets are missing." }),
      recognize: async () => ({ ok: false, code: "pipeline-error" as const, message: "not used" }),
      recognizeInline: async (images: { name: string; base64: string }[]) => {
        calls.push(...images.map((image) => ({ name: image.name, base64: image.base64 })));
        if (!ok) return { ok: false as const, code: "assets-missing" as const, message: "OCR assets are missing." };
        return {
          ok: true as const,
          recognition: {
            engine: "wordless-ocr/ppocrv5",
            cached: false,
            totalDurationMs: 10,
            pages: images.map((image) => ({
              name: image.name,
              path: image.name,
              text: textFor(image.name),
              lineCount: 1,
              width: 100,
              height: 100,
              confidence: 0.9,
              durationMs: 5,
            })),
          },
        };
      },
    },
  };
}

/** 一个两页都是扫描件的 PDF(两页都没有文本层)。 */
const SCANNED: DocumentText = {
  source: "scan.pdf",
  location: "/workspace/scan.pdf",
  kind: "pdf",
  title: null,
  pages: [
    { num: 1, text: "" },
    { num: 2, text: "" },
  ],
  totalPages: 2,
  byteLength: 500_000,
  durationMs: 400,
};

function textOf(result: ToolResult): string {
  return result.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

async function run(tools: Tool[], name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return (await tool.execute("call", input as never)) as unknown as ToolResult;
}

it("注册两个工具,且名字就是模型看到的那个", () => {
  const { port: documentPort } = port({ ok: true, document: TEXT_DOCUMENT });
  expect(createDocumentTools(documentPort).map((tool) => tool.name)).toEqual([
    "extract_text_from_pdf",
    "extract_text_from_docx",
    "fetch_url",
  ]);
});

it("PDF 逐页渲染,并交代读的是哪几页", async () => {
  const { port: documentPort } = port({ ok: true, document: TEXT_DOCUMENT });
  const result = await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "handbook.pdf" });
  const text = textOf(result);
  expect(text).toContain("--- page 1 ---");
  expect(text).toContain("--- page 2 ---");
  expect(text).toContain("Chapter two");
  expect(text).toContain("2 of 2 page(s) shown");
  // 来源性质必须写明:否则模型会把结果当成"我看过这一页了"。
  expect(text).toContain("own text layer");
});

it("只读到一部分时,说清总数与漏掉的页", async () => {
  const partial: DocumentText = {
    ...TEXT_DOCUMENT,
    pages: [
      { num: 4, text: "Only the fourth page was read." },
      { num: 5, text: "" },
    ],
    totalPages: 12,
  };
  const { port: documentPort } = port({ ok: true, document: partial });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "handbook.pdf", startPage: 4, endPage: 5 }));
  expect(text).toContain("of 12 page(s) shown");
  expect(text).toContain("Page 5");
  // 没有文本层的页要单独点出来,而不是留白。
  expect(text).toContain("no text layer");
});

it("扫描件(整份没有文本层)必须明确说出来,而不是回一段空文本", async () => {
  const scanned: DocumentText = {
    source: "scan.pdf",
    location: "/workspace/scan.pdf",
    kind: "pdf",
    title: null,
    pages: [
      { num: 1, text: "" },
      { num: 2, text: "   " },
      { num: 3, text: "" },
    ],
    totalPages: 3,
    byteLength: 900_000,
    durationMs: 640,
  };
  const { port: documentPort } = port({ ok: true, document: scanned });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "scan.pdf" }));
  expect(text).toContain("No text layer found");
  expect(text).toContain("scanned document");
  // 这一句是给模型的**行为指令**:不许把它当成空文档。
  expect(text).toContain("do NOT treat it as an empty document");
  // 也必须说清**为什么**读不到(这台机器没有文字识别),而不是暗示有别的工具能读。
  expect(text).toContain("no local text recognition");
});

it("超出输出预算时,列出漏掉的页并说明怎么读回来", async () => {
  const pages = Array.from({ length: 6 }, (_value, index) => ({ num: index + 1, text: "x".repeat(400) }));
  const { port: documentPort } = port({ ok: true, document: { ...TEXT_DOCUMENT, pages, totalPages: 6 } });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "big.pdf", maxChars: 900 }));
  expect(text).toContain("Truncated at the output budget");
  expect(text).toContain("startPage/endPage");
});

it("单页就超预算时给出截断的那一页,而不是一句「预算不够」", async () => {
  const onePage: DocumentText = { ...TEXT_DOCUMENT, pages: [{ num: 1, text: "y".repeat(3000) }], totalPages: 1 };
  const { port: documentPort } = port({ ok: true, document: onePage });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "one.pdf", maxChars: 600 }));
  expect(text).toContain("--- page 1 ---");
  expect(text).toContain("Truncated at the output budget");
});

it("把页范围原样交给端口(不在工具层偷偷改写)", async () => {
  const { port: documentPort, calls } = port({ ok: true, document: TEXT_DOCUMENT });
  await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "handbook.pdf", startPage: 3, endPage: 7 });
  expect(calls[0]).toEqual({ path: "handbook.pdf", startPage: 3, endPage: 7 });
});

it("失败时带上分类,以及这一类能换的那条路", async () => {
  const { port: documentPort } = port({ ok: false, code: "encrypted", message: "secret.pdf is password-protected." });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "secret.pdf" }));
  expect(text).toContain("encrypted");
  expect(text).toContain("without a password");

  const blocked = port({ ok: false, code: "blocked-host", message: "http://127.0.0.1/ is private." });
  const blockedText = textOf(await run(createDocumentTools(blocked.port), "fetch_url", { url: "http://127.0.0.1/" }));
  expect(blockedText).toContain("blocked-host");
  expect(blockedText).toContain("public HTTP(S)");
});

it("网页结果带上标题与形态,并且不假装是 PDF", async () => {
  const page: DocumentText = {
    source: "https://example.com/pricing",
    location: "https://example.com/pricing",
    kind: "html",
    title: "Pricing — Example",
    pages: [{ num: 1, text: "Plans start at $9." }],
    totalPages: 1,
    byteLength: 2048,
    durationMs: 300,
  };
  const { port: documentPort } = port({ ok: true, document: page });
  const text = textOf(await run(createDocumentTools(documentPort), "fetch_url", { url: "https://example.com/pricing" }));
  expect(text).toContain("Pricing — Example");
  expect(text).toContain("Kind: web page");
  expect(text).not.toContain("--- page");
});

it("两个工具的描述都写清了「不该用它」的场合", () => {
  const { port: documentPort } = port({ ok: true, document: TEXT_DOCUMENT });
  for (const tool of createDocumentTools(documentPort)) {
    expect(tool.description).toContain("When NOT to use");
    expect(tool.description.length).toBeGreaterThan(300);
  }
});

it("formatDocumentText 对非 PDF 的空结果也说清楚为什么空", () => {
  const empty: DocumentText = {
    source: "https://example.com/app",
    location: "https://example.com/app",
    kind: "html",
    title: null,
    pages: [{ num: 1, text: "" }],
    totalPages: 1,
    byteLength: 512,
    durationMs: 90,
  };
  const text = formatDocumentText(empty);
  expect(text).toContain("No readable text");
  expect(text).toContain("JavaScript");
});

const DOCX_DOCUMENT: DocumentText = {
  source: "contract.docx",
  location: "/workspace/contract.docx",
  kind: "docx",
  title: null,
  pages: [{ num: 1, text: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph." }],
  totalPages: 1,
  byteLength: 2048,
  durationMs: 60,
};

it("docx 不带页标记 —— 它没有页的概念", async () => {
  const { port: documentPort } = port({ ok: true, document: DOCX_DOCUMENT });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_docx", { path: "contract.docx" }));
  expect(text).toContain("Kind: plain text.");
  expect(text).not.toContain("--- page");
  expect(text).toContain("Third paragraph.");
});

it("超长 docx 用字符偏移续读,并每次都说清读到哪了", async () => {
  const long: DocumentText = { ...DOCX_DOCUMENT, pages: [{ num: 1, text: "x".repeat(3000) + "TAIL" }] };
  const { port: documentPort } = port({ ok: true, document: long });
  const tools = createDocumentTools(documentPort);

  const first = textOf(await run(tools, "extract_text_from_docx", { path: "contract.docx", maxChars: 1000 }));
  expect(first).toContain("Showing characters 0-1000 of 3004");
  expect(first).toContain("Continue with offset=1000");
  expect(first).not.toContain("TAIL");

  const second = textOf(await run(tools, "extract_text_from_docx", { path: "contract.docx", offset: 3000, maxChars: 1000 }));
  expect(second).toContain("Showing characters 3000-3004 of 3004");
  expect(second).toContain("This is the end of the document.");
  expect(second).toContain("TAIL");
});

it("偏移越界时说明文档有多长,而不是让模型盲试", async () => {
  const { port: documentPort } = port({ ok: true, document: DOCX_DOCUMENT });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_docx", { path: "contract.docx", offset: 9999 }));
  expect(text).toContain("offset-out-of-range");
  // 长度从夹具算,不写死数字 —— 否则改了夹具这条断言会以"过时"的方式失败。
  expect(text).toContain(`${DOCX_DOCUMENT.pages[0]!.text.length} character(s) long`);
});

it("空 docx 说清「没有可抽取的文字」,而且不编造 JavaScript 这种理由", async () => {
  const empty: DocumentText = { ...DOCX_DOCUMENT, pages: [{ num: 1, text: "" }] };
  const { port: documentPort } = port({ ok: true, document: empty });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_docx", { path: "scan.docx" }));
  expect(text).toContain("contains no text");
  expect(text).toContain("made of images");
  expect(text).not.toContain("JavaScript");
});

it("两个抽取工具互相指路 —— 猜错格式是最常见的失败", async () => {
  const { port: documentPort } = port({ ok: false, code: "unsupported-format", message: "report.docx is not a PDF." });
  const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "report.docx" }));
  expect(text).toContain("extract_text_from_docx");
});

describe("扫描件回退(渲染 → 文字识别)", () => {
  const rendered = {
    ok: true as const,
    pages: [
      { num: 1, mimeType: "image/png", base64: "AAAA" },
      { num: 2, mimeType: "image/png", base64: "BBBB" },
    ],
  };

  it("没有文本层的页被渲染并识别,且逐页标注 (OCR)", async () => {
    const { port: documentPort, calls } = port({ ok: true, document: SCANNED }, rendered);
    const ocr = ocrPort((name) => (name === "page-1.png" ? "Scanned page one" : "Scanned page two"));
    const tools = createDocumentTools(documentPort, { ocr: ocr.port });

    const text = textOf(await run(tools, "extract_text_from_pdf", { path: "scan.pdf" }));
    expect(text).toContain("--- page 1 (OCR) ---");
    expect(text).toContain("Scanned page one");
    expect(text).toContain("--- page 2 (OCR) ---");
    // 来源必须写明:识别读的是像素,会读错字、丢表格与版式。
    expect(text).toContain("read from page images by a local text-recognition engine");
    expect(text).not.toContain("No text layer found");

    // 渲染只渲染缺文本的页,识别按页码命名的图 —— 契约里没有页码字段,只能靠名字认回去。
    expect(calls[1]).toEqual({ path: "scan.pdf", pages: [1, 2] });
    expect(ocr.calls.map((call) => call.name)).toEqual(["page-1.png", "page-2.png"]);
  });

  it("有文本层的页不送去识别(扫描件里通常只有一部分页是图)", async () => {
    const mixed: DocumentText = {
      ...SCANNED,
      pages: [
        { num: 1, text: "Real text layer" },
        { num: 2, text: "" },
      ],
    };
    const { port: documentPort } = port({ ok: true, document: mixed }, { ok: true, pages: [{ num: 2, mimeType: "image/png", base64: "BBBB" }] });
    const ocr = ocrPort(() => "Recognized page two");
    const text = textOf(await run(createDocumentTools(documentPort, { ocr: ocr.port }), "extract_text_from_pdf", { path: "mixed.pdf" }));
    expect(ocr.calls.map((call) => call.name)).toEqual(["page-2.png"]);
    expect(text).toContain("Real text layer");
    expect(text).toContain("--- page 2 (OCR) ---");
    expect(text).not.toContain("--- page 1 (OCR) ---");
  });

  it("超过单次上限的页如实报出来,并说明怎么接着读", async () => {
    const many: DocumentText = { ...SCANNED, totalPages: 8, pages: Array.from({ length: 8 }, (_v, i) => ({ num: i + 1, text: "" })) };
    const { port: documentPort } = port(
      { ok: true, document: many },
      { ok: true, pages: [1, 2].map((num) => ({ num, mimeType: "image/png", base64: "AAAA" })) },
    );
    const ocr = ocrPort(() => "text");
    const text = textOf(
      await run(createDocumentTools(documentPort, { ocr: ocr.port, maxOcrPages: 2 }), "extract_text_from_pdf", { path: "big-scan.pdf" }),
    );
    expect(ocr.calls).toHaveLength(2);
    expect(text).toContain("Pages 3, 4, 5, 6, 7, 8 have no text layer and were not recognized");
    expect(text).toContain("startPage=3");
  });

  it("识别引擎不可用时说实话,而不是留一片空白", async () => {
    const { port: documentPort } = port({ ok: true, document: SCANNED }, rendered);
    const ocr = ocrPort(() => "", false);
    const text = textOf(await run(createDocumentTools(documentPort, { ocr: ocr.port }), "extract_text_from_pdf", { path: "scan.pdf" }));
    expect(text).toContain("No text layer found");
    expect(text).toContain("could not be used: OCR assets are missing");
    expect(text).toContain("do NOT treat it as an empty document");
  });

  it("识别过了但这些页确实没有文字:说清是空白/纯图页,不让人反复重试", async () => {
    const { port: documentPort } = port({ ok: true, document: SCANNED }, rendered);
    const ocr = ocrPort(() => "   ");
    const text = textOf(await run(createDocumentTools(documentPort, { ocr: ocr.port }), "extract_text_from_pdf", { path: "scan.pdf" }));
    expect(text).toContain("found no readable text on the 2 page(s) it read");
    expect(text).toContain("Do NOT treat the document as empty");
  });

  it("没有接识别能力时,保持原来的说法(不留空白也不假装读过)", async () => {
    const { port: documentPort } = port({ ok: true, document: SCANNED }, rendered);
    const text = textOf(await run(createDocumentTools(documentPort), "extract_text_from_pdf", { path: "scan.pdf" }));
    expect(text).toContain("no local text recognition");
    expect(text).toContain("do NOT treat it as an empty document");
  });

  it("渲染失败时说明原因,而不是当成「文档没内容」", async () => {
    const { port: documentPort } = port({ ok: true, document: SCANNED }, { ok: false, code: "parse-failed", message: "boom" });
    const ocr = ocrPort(() => "text");
    const text = textOf(await run(createDocumentTools(documentPort, { ocr: ocr.port }), "extract_text_from_pdf", { path: "scan.pdf" }));
    expect(text).toContain("could not be used: boom");
  });

  it("有文本层的文档完全不碰渲染与识别", async () => {
    const { port: documentPort, calls } = port({ ok: true, document: TEXT_DOCUMENT });
    const ocr = ocrPort(() => "should not be called");
    await run(createDocumentTools(documentPort, { ocr: ocr.port }), "extract_text_from_pdf", { path: "handbook.pdf" });
    expect(calls).toHaveLength(1);
    expect(ocr.calls).toHaveLength(0);
  });
});
