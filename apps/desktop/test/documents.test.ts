import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createDocumentTools, formatDocumentText } from "@wordless/capability-documents";
import { DocumentService } from "../src/main/documents/document-service.ts";
import { createDocumentPort } from "../src/main/documents/document-port.ts";
import { extractHtmlText, extractHtmlTitle, isOleBytes, isPdfBytes, isZipBytes } from "../src/main/documents/document-text.ts";
import { checkPublicHttpUrl, isPrivateAddress } from "../src/main/documents/public-url.ts";

/**
 * 文档抽取:宿主实现 + 排版层的**集成**断言。
 *
 * 为什么这个文件能同时 import 能力包与宿主服务:能力包的 `port.ts` 只有类型,于是它没有
 * 运行时的相对导入,`node --test` 能直接加载(其它能力包用 `export *`,加载不了,测试只能
 * 绕开 —— 见 `ocr-tool-declaration.test.ts` 的注释)。
 *
 * 最要紧的一条钉在这里:**扫描件必须一路被说出来**。它跨两层 —— 服务要如实返回"这些页没有
 * 文本层",排版层要把它说成"这是扫描件,别当成空文档"。只测一层都会漏掉另一半。
 */

/** 现造一个合法的多页 PDF:空字符串 = 该页没有文本层(模拟扫描件的一页)。 */
function buildPdf(pages: string[]): Buffer {
  const objects: Array<string | undefined> = [];
  const set = (index: number, body: string): void => {
    objects[index] = body;
  };
  const pageIds = pages.map((_page, index) => 3 + index * 2);
  const fontId = 3 + pages.length * 2;

  set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((text, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const stream = text ? `BT /F1 24 Tf 72 700 Td (${text}) Tj ET` : "";
    set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  set(fontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 1; index <= fontId; index += 1) {
    const body = objects[index];
    if (body === undefined) throw new Error(`fixture 缺少对象 ${index}`);
    offsets[index] = out.length;
    out += `${index} 0 obj\n${body}\nendobj\n`;
  }
  const xrefStart = out.length;
  out += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= fontId; index += 1) out += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** CRC-32（ZIP 需要）。写死在测试里，免得依赖某个库或某个 Node 版本的内置实现。 */
function crc32(bytes: Buffer): number {
  let value = ~0;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return ~value >>> 0;
}

/** 最小 ZIP 写入器（stored 条目）。docx 就是一个 ZIP，所以夹具可以自造，不必进仓库当二进制。 */
function zip(entries: Array<[string, string]>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const checksum = crc32(data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    parts.push(local, data);

    const entry = Buffer.alloc(46 + nameBytes.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    nameBytes.copy(entry, 46);
    central.push(entry);
    offset += local.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** 造一个真的 .docx。`body` 是 `<w:body>` 里的内容。 */
function buildDocx(body: string): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zip([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", ROOT_RELS],
    ["word/document.xml", document],
  ]);
}

/** 一个段落。 */
const paragraph = (text: string): string => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const signal = new AbortController().signal;
let directory = "";

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "wordless-documents-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function fixture(name: string, bytes: Buffer): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

/** 只提供 DNS 解析的假实现:判定逻辑不需要真出网。 */
const resolveTo = (addresses: string[]) => async () => addresses;
const PUBLIC = resolveTo(["93.184.216.34"]);
const PRIVATE = resolveTo(["10.0.0.7"]);

describe("PDF 文本抽取(真实解析器)", () => {
  it("逐页返回文本,并如实报告没有文本层的那一页", async () => {
    const path = await fixture("mixed.pdf", buildPdf(["Page one text", "", "Page three text"]));
    const outcome = await new DocumentService().readPdf({ path }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.document.kind, "pdf");
    assert.equal(outcome.document.totalPages, 3);
    assert.deepEqual(outcome.document.pages.map((page) => page.num), [1, 2, 3]);
    assert.match(outcome.document.pages[0]!.text, /Page one text/);
    assert.equal(outcome.document.pages[1]!.text, "");
    assert.match(outcome.document.pages[2]!.text, /Page three text/);

    // 跨层:排版层要把"这一页没有文本层"点出来,而不是留白。
    const text = formatDocumentText(outcome.document);
    assert.match(text, /--- page 1 ---/);
    assert.match(text, /Page 2 has no text layer/);
    assert.doesNotMatch(text, /No text layer found/);
  });

  it("扫描件(整份没有文本层)一路被说成扫描件,而不是空文档", async () => {
    const path = await fixture("scanned.pdf", buildPdf(["", ""]));
    const outcome = await new DocumentService().readPdf({ path }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    const text = formatDocumentText(outcome.document);
    assert.match(text, /No text layer found/);
    assert.match(text, /scanned document/);
    assert.match(text, /do NOT treat it as an empty document/);
  });

  it("只读指定页范围,但仍然报告总页数", async () => {
    const path = await fixture("range.pdf", buildPdf(["One", "Two", "Three"]));
    const outcome = await new DocumentService().readPdf({ path, startPage: 3, endPage: 3 }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.document.pages.map((page) => page.num), [3]);
    assert.equal(outcome.document.totalPages, 3);
    // 读到的不是整份 —— 这一点必须在给模型看的文本里出现。
    assert.match(formatDocumentText(outcome.document), /of 3 page\(s\) shown/);
  });

  it("只给 startPage 时读到末页(不是只读前 N 页)", async () => {
    const path = await fixture("from.pdf", buildPdf(["One", "Two", "Three"]));
    const outcome = await new DocumentService().readPdf({ path, startPage: 2 }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.document.pages.map((page) => page.num), [2, 3]);
  });

  it("startPage 超出末页时明确报错,而不是静默返回空", async () => {
    const path = await fixture("short.pdf", buildPdf(["Only one"]));
    const outcome = await new DocumentService().readPdf({ path, startPage: 9 }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.match(outcome.message, /past the end/);
  });

  it("不是 PDF 的文件按 unsupported-format 拒绝", async () => {
    const path = await fixture("notes.txt", Buffer.from("plain text, not a pdf"));
    const outcome = await new DocumentService().readPdf({ path }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "unsupported-format");
  });

  it("不存在的文件是 not-found", async () => {
    const outcome = await new DocumentService().readPdf({ path: join(directory, "missing.pdf") }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "not-found");
  });

  it("工具把失败分类翻译成能换的那条路", async () => {
    const tools = createDocumentTools(
      createDocumentPort(new DocumentService(), { workspaceRoot: directory, isWithinRoot: () => true }),
    );
    const tool = tools.find((entry) => entry.name === "extract_text_from_pdf")!;
    const result = (await tool.execute("call", { path: "notes.txt" } as never)) as unknown as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = result.content.flatMap((part) => (part.text ? [part.text] : [])).join("\n");
    assert.match(text, /unsupported-format/);
  });
});

describe("扫描件回退的渲染环节", () => {
  it("把指定的页渲染成 PNG(base64),只渲染要的页", async () => {
    const path = await fixture("render.pdf", buildPdf(["One", "Two", "Three"]));
    const outcome = await new DocumentService().renderPdfPages({ path, pages: [1, 3] }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.pages.map((page) => page.num), [1, 3]);
    for (const page of outcome.pages) {
      assert.equal(page.mimeType, "image/png");
      const bytes = Buffer.from(page.base64, "base64");
      // PNG 魔数:交给文字识别之前必须是真图,而不是空串或别的格式。
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.ok(bytes.length > 1000, `渲染出的页太小,疑似空白: ${bytes.length} bytes`);
    }
  });

  it("重复与乱序的页码被归一,越界页不静默吞掉", async () => {
    const path = await fixture("order.pdf", buildPdf(["One", "Two"]));
    const outcome = await new DocumentService().renderPdfPages({ path, pages: [2, 2, 1] }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.pages.map((page) => page.num), [1, 2]);
  });

  it("空页码列表被拒绝,而不是渲染出一堆页", async () => {
    const path = await fixture("empty-list.pdf", buildPdf(["One"]));
    const outcome = await new DocumentService().renderPdfPages({ path, pages: [] }, { signal });
    assert.equal(outcome.ok, false);
  });

  it("不是 PDF 的文件拒绝渲染", async () => {
    const path = await fixture("not-a-pdf.pdf", Buffer.from("plain text"));
    const outcome = await new DocumentService().renderPdfPages({ path, pages: [1] }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "unsupported-format");
  });

  it("适配层对渲染用同一条工作区约束", async () => {
    const port = createDocumentPort(new DocumentService(), {
      workspaceRoot: directory,
      isWithinRoot: (root, candidate) => candidate.startsWith(root),
    });
    const outside = await port.renderPdfPages({ path: "/etc/hosts", pages: [1] }, { signal });
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.code, "outside-workspace");
  });
});

describe("Word 文档(.docx)", () => {
  it("抽出正文:段落分开、跨 run 接起来、实体解码", async () => {
    const path = await fixture(
      "contract.docx",
      buildDocx(paragraph("Title &amp; intro") + `<w:p><w:r><w:t xml:space="preserve">Second </w:t></w:r><w:r><w:t>paragraph</w:t></w:r></w:p>`),
    );
    const outcome = await new DocumentService().readDocx({ path }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.document.kind, "docx");
    const text = outcome.document.pages[0]!.text;
    assert.match(text, /Title & intro/);
    assert.match(text, /Second paragraph/, "跨 run 的同一段要接起来");
    // 与 PDF 不同:docx 没有页,所以不该出现页标记。
    assert.doesNotMatch(formatDocumentText(outcome.document), /--- page/);
  });

  it("追踪删除的文字不会混进来(这是手写 XML 走查最容易错的地方)", async () => {
    const path = await fixture(
      "tracked.docx",
      buildDocx(
        paragraph("kept before") +
          `<w:p><w:del><w:r><w:delText>DELETED TEXT</w:delText></w:r></w:del><w:r><w:t>kept after</w:t></w:r></w:p>`,
      ),
    );
    const outcome = await new DocumentService().readDocx({ path }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    const text = outcome.document.pages[0]!.text;
    assert.doesNotMatch(text, /DELETED TEXT/);
    assert.match(text, /kept after/);
  });

  it("表格被拍平(每一格自成一段)", async () => {
    const path = await fixture(
      "table.docx",
      buildDocx(`<w:tbl><w:tr><w:tc>${paragraph("Cell A")}</w:tc><w:tc>${paragraph("Cell B")}</w:tc></w:tr></w:tbl>`),
    );
    const outcome = await new DocumentService().readDocx({ path }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    const text = outcome.document.pages[0]!.text;
    assert.match(text, /Cell A/);
    assert.match(text, /Cell B/);
  });

  it("旧版 .doc 明确拒绝,并给出下一步(任何 OOXML 解析器都读不了它)", async () => {
    const path = await fixture("legacy.doc", buildDocx(paragraph("looks like a zip")));
    const outcome = await new DocumentService().readDocx({ path }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "unsupported-format");
    assert.match(outcome.message, /legacy \.doc/);
    assert.match(outcome.message, /save it as \.docx/);
  });

  it("加密的 docx(或被保护的 OOXML)按 encrypted 报,而不是「解析失败」", async () => {
    // 加密后的 OOXML 不再是 ZIP,而是 OLE 复合文档 —— 与旧版 .doc 同一个容器。
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
    const path = await fixture("protected.docx", ole);
    const outcome = await new DocumentService().readDocx({ path }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "encrypted");
  });

  it("扩展名说是 .docx 但内容不是容器时报 parse-failed", async () => {
    const path = await fixture("fake.docx", Buffer.from("this is not a zip at all"));
    const outcome = await new DocumentService().readDocx({ path }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "parse-failed");
  });

  it("把 PDF 路径交给 docx 工具会被拒绝,并指向另一个工具", async () => {
    const path = await fixture("report.pdf", buildPdf(["One"]));
    const outcome = await new DocumentService().readDocx({ path }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "unsupported-format");
    assert.match(outcome.message, /extract_text_from_pdf/);
  });

  it("docx 从 URL 下来时按 content-type 认出来", async () => {
    const docx = buildDocx(paragraph("From the web"));
    const service = new DocumentService({
      resolveHost: PUBLIC,
      fetchImpl: async () =>
        new Response(docx, {
          status: 200,
          headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        }),
    });
    const outcome = await service.fetchUrl({ url: "https://example.com/contract.docx" }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.document.kind, "docx");
    assert.match(outcome.document.pages[0]!.text, /From the web/);
  });

  it("适配层对 docx 用同一条工作区约束", async () => {
    const port = createDocumentPort(new DocumentService(), {
      workspaceRoot: directory,
      isWithinRoot: (root, candidate) => candidate.startsWith(root),
    });
    const outside = await port.readDocx({ path: "/etc/hosts" }, { signal });
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.code, "outside-workspace");
  });
});

describe("URL 抓取", () => {
  const htmlResponse = () =>
    new Response("<html><head><title>Release notes</title></head><body><h1>Highlights</h1><p>Shipped.</p><script>var x=1</script></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  it("HTML 抓成正文与标题", async () => {
    const service = new DocumentService({ resolveHost: PUBLIC, fetchImpl: async () => htmlResponse() });
    const outcome = await service.fetchUrl({ url: "https://example.com/notes" }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.document.kind, "html");
    assert.equal(outcome.document.title, "Release notes");
    assert.match(outcome.document.pages[0]!.text, /Highlights/);
    assert.doesNotMatch(outcome.document.pages[0]!.text, /var x=1/);
    // 单页文档不该出现页标记(那会暗示它是分页的)。
    assert.doesNotMatch(formatDocumentText(outcome.document), /--- page/);
  });

  it("响应是 PDF 时按 PDF 解析", async () => {
    const pdf = buildPdf(["From the web"]);
    const service = new DocumentService({
      resolveHost: PUBLIC,
      fetchImpl: async () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
    });
    const outcome = await service.fetchUrl({ url: "https://example.com/report.pdf" }, { signal });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.document.kind, "pdf");
    assert.match(formatDocumentText(outcome.document), /From the web/);
  });

  it("重定向到内网地址时拒绝 —— 逐跳复检,第一跳合法不算数", async () => {
    const service = new DocumentService({
      resolveHost: async (hostname) => (hostname === "public.example.com" ? ["93.184.216.34"] : ["10.0.0.7"]),
      fetchImpl: async (input) =>
        String(input).includes("public.example.com")
          ? new Response(null, { status: 302, headers: { location: "http://internal.example.com/secret" } })
          : htmlResponse(),
    });
    const outcome = await service.fetchUrl({ url: "https://public.example.com/start" }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "blocked-host");
  });

  it("私网与非 http 的 URL 直接拒绝,并且不去解析也不去抓", async () => {
    let fetched = 0;
    const service = new DocumentService({
      resolveHost: PRIVATE,
      fetchImpl: async () => {
        fetched += 1;
        return htmlResponse();
      },
    });
    const privateAddress = await service.fetchUrl({ url: "https://example.com/" }, { signal });
    assert.equal(privateAddress.ok, false);
    const nonHttp = await service.fetchUrl({ url: "file:///etc/passwd" }, { signal });
    assert.equal(nonHttp.ok, false);
    if (!nonHttp.ok) assert.equal(nonHttp.code, "blocked-host");
    assert.equal(fetched, 0);
  });

  it("HTTP 错误码如实上报", async () => {
    const service = new DocumentService({ resolveHost: PUBLIC, fetchImpl: async () => new Response("nope", { status: 404 }) });
    const outcome = await service.fetchUrl({ url: "https://example.com/gone" }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "http-error");
    assert.match(outcome.message, /404/);
  });

  it("重定向没有 Location 时报 http-error,而不是死循环", async () => {
    const service = new DocumentService({ resolveHost: PUBLIC, fetchImpl: async () => new Response(null, { status: 302 }) });
    const outcome = await service.fetchUrl({ url: "https://example.com/loop" }, { signal });
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.code, "http-error");
  });
});

describe("适配层的工作区约束", () => {
  it("工作区外的路径被拒,且不会落到服务", async () => {
    const path = await fixture("inside.pdf", buildPdf(["Inside"]));
    let calls = 0;
    const service = new DocumentService();
    const original = service.readPdf.bind(service);
    service.readPdf = async (...args: Parameters<typeof original>) => {
      calls += 1;
      return await original(...args);
    };
    const port = createDocumentPort(service, { workspaceRoot: directory, isWithinRoot: (root, candidate) => candidate.startsWith(root) });

    const outside = await port.readPdf({ path: "/etc/hosts" }, { signal });
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.code, "outside-workspace");
    assert.equal(calls, 0, "越界路径不该到达服务");

    const inside = await port.readPdf({ path: "inside.pdf" }, { signal });
    assert.equal(inside.ok, true);
    assert.equal(calls, 1);
    assert.equal(path.startsWith(directory), true);
  });
});

describe("纯函数", () => {
  it("HTML → 文本:丢掉脚本与样式,保留正文,取得到标题", () => {
    const html = `<html><head><title> Release &amp; Notes </title><style>body{color:red}</style></head>
      <body><!-- c --><script>var x = "<p>not text</p>";</script><h1>Highlights</h1><p>First&nbsp;item</p></body></html>`;
    assert.equal(extractHtmlTitle(html), "Release & Notes");
    const text = extractHtmlText(html);
    assert.match(text, /Highlights/);
    assert.match(text, /First item/);
    assert.doesNotMatch(text, /color:red|not text|<h1>/);
  });

  it("ZIP / OLE 魔数判定:docx 是 ZIP,加密 OOXML 与旧版 .doc 是 OLE", () => {
    assert.equal(isZipBytes(buildDocx(paragraph("x"))), true);
    assert.equal(isZipBytes(Buffer.from("plain")), false);
    assert.equal(isOleBytes(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])), true);
    assert.equal(isOleBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04])), false);
  });

  it("PDF 魔数按字节判定(而不是按扩展名或 Buffer 语义)", () => {
    assert.equal(isPdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
    assert.equal(isPdfBytes(Buffer.from("hello")), false);
    assert.equal(isPdfBytes(new Uint8Array([0x25, 0x50])), false);
    assert.equal(isPdfBytes(new Uint8Array(0)), false);
  });

  it("内网地址判定:该拒的拒,该放的放", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.169.254", "::1", "fd00::1", "not-an-ip"]) {
      assert.equal(isPrivateAddress(address), true, address);
    }
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) {
      assert.equal(isPrivateAddress(address), false, address);
    }
  });

  it("出网准入:协议、凭据、内网名、内网地址、解析失败各自分类", async () => {
    assert.deepEqual(await checkPublicHttpUrl("file:///etc/passwd", PUBLIC), { ok: false, code: "non-http" });
    assert.deepEqual(await checkPublicHttpUrl("https://user:pw@example.com/", PUBLIC), { ok: false, code: "credentials" });
    assert.deepEqual(await checkPublicHttpUrl("http://localhost:3000/", PUBLIC), { ok: false, code: "private-host" });
    assert.deepEqual(await checkPublicHttpUrl("http://metadata.google.internal/", PUBLIC), { ok: false, code: "private-host" });
    assert.deepEqual(await checkPublicHttpUrl("http://example.com/", PRIVATE), { ok: false, code: "private-address" });
    assert.deepEqual(await checkPublicHttpUrl("http://example.com/", resolveTo([])), { ok: false, code: "unresolved" });
    assert.deepEqual(await checkPublicHttpUrl("not a url", PUBLIC), { ok: false, code: "invalid-url" });
    // 通过时去掉 fragment:它只对浏览器有意义,留着会让同一份内容看起来像两个来源。
    assert.deepEqual(await checkPublicHttpUrl("https://example.com/a#section", PUBLIC), { ok: true, url: "https://example.com/a" });
  });
});
