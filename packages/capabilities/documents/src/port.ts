/**
 * 文档抽取能力的契约。
 *
 * 与仓库里其它能力同一套做法:**能力包只声明它消费的端口,实现留在宿主**(桌面端)。
 * 于是这些工具不 import Electron、不 import PDF 解析库,将来换一个宿主也能原样复用。
 */

/** 一页文本。非分页文档(HTML / 纯文本)只有一页,`num` 恒为 1。 */
export interface DocumentPageText {
  /** 1 起的页码。 */
  num: number;
  text: string;
  /**
   * 这段文字从哪来。省略 = 文档自带的文本层。
   *
   * `ocr` 必须能被**看见**:文字识别读的是像素,会读错字、丢掉表格与版式。把它和文本层混在
   * 一起返回,读的人(模型或用户)就分不清"原文如此"和"机器认出来的"。
   */
  source?: "text-layer" | "ocr";
}

/**
 * 抽取结果。
 *
 * `pages` 与 `totalPages` **必须分开**:只读了第 5-10 页时 `pages.length === 6` 而
 * `totalPages === 40` —— 模型据此知道"还剩多少没读、下一步怎么读"。少了它,模型会把
 * "我读到的这些"当成"整份文档"。
 */
export interface DocumentText {
  /** 给模型看的来源名(文件名或 URL)。 */
  source: string;
  /** 解析后的绝对路径(本地文件)或重定向后的最终 URL(网络)。 */
  location: string;
  /**
   * 内容形态。`pdf` 是**唯一分页**的一种 —— 排版层据此决定要不要打页标记,以及页范围有没有意义。
   */
  kind: "pdf" | "docx" | "html" | "text";
  /** HTML 的 `<title>`,其它形态为 null。 */
  title: string | null;
  pages: DocumentPageText[];
  totalPages: number;
  byteLength: number;
  durationMs: number;
}

/**
 * 失败分类。
 *
 * 分类存在的理由是**模型要据此换路**:`encrypted` 要问用户密码,`too-large` 要改读页范围,
 * `blocked-host` 是策略拒绝而不是网络故障。全部塌成一句"失败了"就都换不了路。
 */
export type DocumentFailureCode =
  | "not-found"
  | "outside-workspace"
  | "unsupported-format"
  | "too-large"
  /** 加密 / 受保护,需要密码才能读。 */
  | "encrypted"
  | "blocked-host"
  | "http-error"
  | "parse-failed"
  | "cancelled";

export type DocumentOutcome =
  | { ok: true; document: DocumentText }
  | { ok: false; code: DocumentFailureCode; message: string };

export interface ReadPdfRequest {
  /** 要读的 PDF 路径(宿主负责解析成绝对路径并做工作区约束)。 */
  path: string;
  /** 起始页,1 起、含。省略 = 第一页。 */
  startPage?: number;
  /** 结束页,含。省略 = 末页。 */
  endPage?: number;
}

export interface ReadDocxRequest {
  /** 要读的 .docx 路径(宿主负责解析成绝对路径并做工作区约束)。 */
  path: string;
}

export interface RenderPdfPagesRequest {
  /** 要渲染的 PDF 路径(宿主负责解析成绝对路径并做工作区约束)。 */
  path: string;
  /** 要渲染的页码(1 起)。**逐页指定而不是范围** —— 扫描件里通常只有一部分页没有文本层。 */
  pages: number[];
}

/** 渲染出来的一页:PNG 的 base64(不带 `data:` 前缀)。 */
export interface RenderedPdfPage {
  num: number;
  mimeType: string;
  base64: string;
}

export interface FetchUrlRequest {
  url: string;
}

export interface DocumentPort {
  /**
   * 读本地 PDF 的**文本层**。
   *
   * 返回的是文本层而不是渲染结果:扫描件(没有文本层的 PDF)由格式化层**明确说出来**,
   * 不能回一段空文本让模型以为文档是空的。
   */
  readPdf(request: ReadPdfRequest, options: { signal: AbortSignal }): Promise<DocumentOutcome>;
  /**
   * 读 .docx 的正文。
   *
   * 返回的是**一整段文本**而不是分页结果:docx 没有页的概念。所以超长文档的续读靠字符偏移
   * (`offset`)而不是页范围 —— 与工作区 `read` 工具的 offset/limit 同一套心智。
   */
  readDocx(request: ReadDocxRequest, options: { signal: AbortSignal }): Promise<DocumentOutcome>;
  /**
   * 抓一个 URL 并抽出正文(HTML / 纯文本 / JSON / PDF)。
   *
   * SSRF 防护、重定向上限与体积上限都由宿主负责 —— 这些是宿主的网络策略,
   * 不该由能力包各自实现一份。
   */
  /**
   * 把 PDF 的若干页渲染成 PNG。
   *
   * 存在的理由是**扫描件**:没有文本层的 PDF 只能读像素,而读像素的第一步是把它变成图。
   * 这一步与"读文本层"分开,是因为它们各自可能失败、各自有各自的成本(渲染快、识别慢),
   * 调用方要能分别对待。
   */
  renderPdfPages(request: RenderPdfPagesRequest, options: { signal: AbortSignal }): Promise<DocumentRenderOutcome>;
  fetchUrl(request: FetchUrlRequest, options: { signal: AbortSignal }): Promise<DocumentOutcome>;
}

export type DocumentRenderOutcome =
  | { ok: true; pages: RenderedPdfPage[] }
  | { ok: false; code: DocumentFailureCode; message: string };
