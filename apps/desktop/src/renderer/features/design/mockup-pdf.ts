/**
 * 极简 PDF 写入器:一页一张全出血 JPEG,别的什么都没有。
 *
 * **手写而不是引库**:整份文档就是几个字典包着**已经编码好的 JPEG 字节** —— PDF 用
 * `DCTDecode` 把它原样嵌进去,所以一个依赖只会白增重量。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface MockupPdfPage {
  /** JPEG 字节,原样嵌入。 */
  jpeg: Uint8Array;
  /** 像素尺寸,用于算页面长宽比。 */
  width: number;
  height: number;
  /**
   * 这一页自己的宽度(点)。覆盖文档级的 `pageWidth`。
   *
   * 用在「不同尺寸的画框混排」上:390 宽的手机帧和 1440 宽的桌面帧要保持彼此的**真实**
   * 比例,而不是各自被归一化成一个宽度。
   */
  pageWidth?: number;
}

/**
 * @param pageWidth 没有自带宽度的页统一用这个点数宽度;每页保持自己的长宽比,所以高度
 *   可以不同,但整叠读起来还是一份文档。
 */
export function buildMockupPdf(pages: readonly MockupPdfPage[], pageWidth: number): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (chunk: Uint8Array | string): void => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (id: number): void => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  // 1 目录,2 页树,之后每页三个对象:图 / 内容流 / 页。
  const objectId = (index: number, kind: 0 | 1 | 2): number => 3 + index * 3 + kind;
  const total = 2 + pages.length * 3;

  // 二进制注释:告诉阅读器这不是纯 ASCII 文件。
  push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");

  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  const kids = pages.map((_, index) => `${objectId(index, 2)} 0 R`).join(" ");
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`);

  pages.forEach((page, index) => {
    const width = page.pageWidth ?? pageWidth;
    const height = page.width > 0 ? (width * page.height) / page.width : width;
    const w = width.toFixed(2);
    const h = height.toFixed(2);

    startObject(objectId(index, 0));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
    startObject(objectId(index, 1));
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

    startObject(objectId(index, 2));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im0 ${objectId(index, 0)} 0 R >> >> ` +
        `/Contents ${objectId(index, 1)} 0 R >>\nendobj\n`,
    );
  });

  const xrefOffset = length;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= total; id += 1) {
    push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  // 显式要求 `ArrayBuffer` 背书:这份字节要过 IPC 交给主进程去写文件。
  const out = new Uint8Array(length) as Uint8Array<ArrayBuffer>;
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
