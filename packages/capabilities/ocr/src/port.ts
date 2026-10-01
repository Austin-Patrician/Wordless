/**
 * 文字识别(OCR)能力的契约。
 *
 * 与仓库里其它能力同一套做法:**能力包只声明它消费的端口,实现留在宿主**(桌面端)。
 * 于是这些工具不 import Electron、不 import 任何渲染器状态,将来换一个宿主也能原样复用。
 */

export interface OcrImageRequest {
  /** 要识别的图片路径(宿主负责解析成绝对路径并做工作区约束)。 */
  path: string;
  /** 给模型看的名字,通常是文件名。 */
  name: string;
  /** 例如 `image/png`。 */
  mimeType: string;
}

/** 输出粒度,与偏好里的取值同源。 */
export type OcrGranularity = "text" | "line";

export interface OcrLineResult {
  text: string;
  /** 0..1 的粗信号(每行)。 */
  confidence: number;
}

export interface OcrPageResult {
  name: string;
  path: string;
  /** 识别出的文字。**可能是空字符串**(图里没有可识别的文字,或者只有图形)。 */
  text: string;
  /** 只有粒度是 `line` 时非空。 */
  lines?: OcrLineResult[];
  lineCount: number;
  width: number;
  height: number;
  /** 0..1 的**粗**信号:只适合相对比较,别拿它卡阈值。 */
  confidence: number;
  durationMs: number;
}

export interface OcrRecognitionResult {
  /** 形如 `wordless-ocr/ppocrv5+ort-web-1.25.1+wasm2`。 */
  engine: string;
  pages: OcrPageResult[];
  totalDurationMs: number;
  /** 是否命中了缓存(附件每轮都会重新水合,没有缓存就会反复识别同一张图)。 */
  cached: boolean;
}

/**
 * 失败分类。
 *
 * `assets-missing` 是**正常状态**而不是缺陷:构建时可以不带 OCR 资产
 * (`WORDLESS_SKIP_OCR=1`),这时工具要如实说"这台机器没有文字识别",而不是报内部错误。
 */
export type OcrFailureCode = "assets-missing" | "engine-init-failed" | "decode-failed" | "timeout" | "cancelled" | "pipeline-error";

export type OcrOutcome =
  | { ok: true; recognition: OcrRecognitionResult }
  | { ok: false; code: OcrFailureCode; message: string };

export interface OcrInlineImage {
  name: string;
  mimeType: string;
  /** base64(不带 data: 前缀)。截图这类"本来就在内存里"的图走这条。 */
  base64: string;
}

export interface OcrAvailability {
  available: boolean;
  /**
   * 一句话说明,直接给模型看。
   *
   * **不可用时必须说清为什么**(哪台目录、缺哪个文件):"没有文字识别"这句话本身不解决任何问题,
   * 而它出现的场合(开发包 vs 正式包、资产没准备)恰恰要靠这句才能分辨。
   */
  detail: string;
}

export interface OcrPort {
  /** 这台机器上文字识别是否可用,以及为什么不可用。 */
  status(): Promise<OcrAvailability>;
  /**
   * 解析并识别一批图片。路径由宿主按工作区约束解析。
   *
   * `granularity` 省略 = 用设置里的默认值(所以工具不必知道用户选了什么)。
   */
  recognize(images: OcrImageRequest[], options: { signal: AbortSignal; granularity?: OcrGranularity }): Promise<OcrOutcome>;
  /**
   * 识别内存里的字节(浏览器截图走这条)。
   *
   * 可选:宿主可以只支持按路径识别。调用方拿到 `undefined` 就退回"读不了"的说法。
   * 刻意**不落盘** —— 为了 OCR 往用户工作区写文件是没必要的副作用。
   */
  recognizeInline?(images: OcrInlineImage[], options: { signal: AbortSignal }): Promise<OcrOutcome>;
}
