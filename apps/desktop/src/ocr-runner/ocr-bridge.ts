/**
 * OCR 运行器的**桥协议**:主进程 ↔ 隐藏渲染器。
 *
 * 单独一个文件是因为三方都要用它:页面(`src/ocr-runner/main.ts`)、preload
 * (`src/preload/ocr-runner.ts`)、宿主(`src/main/ocr/ocr-runner.ts`)。通道名写成常量而不是
 * 各处手抄字符串 —— 抄错一个字符的后果是"运行器永远收不到任务",而且不报错。
 *
 * 这个文件**不能 import Electron,也不能 import React**:页面要能直接引用它。
 */

/**
 * 输出粒度。
 *
 * 类型**从领域包借**(`type` 导入,编译后不剩任何运行时代码):偏好里存的是同一套取值,
 * 两处各写一遍迟早会漂移。
 */
export type OcrGranularity = "text" | "line";

export const OCR_CHANNELS = {
  /** 页面说"我加载好了,可以发任务"。 */
  ready: "wordless:ocr:ready",
  /** 主进程 → 页面:一次识别任务。 */
  start: "wordless:ocr:start",
  progress: "wordless:ocr:progress",
  done: "wordless:ocr:done",
  error: "wordless:ocr:error",
} as const;

/**
 * 失败分类。
 *
 * `assets-missing` 单独一类,是因为它**不是**缺陷:没有内置资产时(例如构建时
 * `WORDLESS_SKIP_OCR=1`),应用应当如实说"文字识别未就绪",而不是报一个内部错误。
 */
export type OcrFailureCode =
  | "assets-missing"
  | "engine-init-failed"
  | "decode-failed"
  | "timeout"
  | "cancelled"
  | "pipeline-error";

export interface OcrRunnerImage {
  /** 只用于日志与错误信息;识别本身不关心文件名。 */
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface OcrRunnerRequest {
  sessionId: string;
  images: OcrRunnerImage[];
  /** `text` 只回整段;`line` 额外回每行的文字与置信度。 */
  granularity: OcrGranularity;
}

export interface OcrProgressEvent {
  page: number;
  total: number;
  /** `load` = 首次加载引擎/模型(冷启动),`ocr` = 正在识别。 */
  phase: "load" | "ocr" | "done";
}

export interface OcrRunnerLine {
  text: string;
  confidence: number;
}

export interface OcrRunnerPage {
  name: string;
  text: string;
  /** 只有 `granularity: "line"` 时非空。 */
  lines: OcrRunnerLine[];
  lineCount: number;
  width: number;
  height: number;
  /**
   * 0..1,**粗信号**。
   *
   * 底层给的是 CTC 的平均 logit(可能为负),这里做的是线性映射 —— 只适合**相对比较**
   * (同一张图换个引擎谁更好),不适合卡阈值。别拿它决定"要不要相信这段文字"。
   */
  confidence: number;
  durationMs: number;
}

export interface OcrRunnerResult {
  /** 形如 `wordless-ocr/ppocrv5+ort-web-1.25.1+wasm1`(wasm1 = 单线程)。 */
  engine: string;
  pages: OcrRunnerPage[];
  totalDurationMs: number;
  /** 首次加载引擎花的时间(冷启动代价),热态为 0。 */
  loadMs: number;
}

/** preload 通过 `contextBridge` 暴露给页面的东西(`window.wordlessOcr`)。 */
export interface WordlessOcrBridge {
  notifyReady(sessionId: string): void;
  onStart(handler: (request: OcrRunnerRequest) => void): void;
  reportProgress(sessionId: string, event: OcrProgressEvent): void;
  reportDone(sessionId: string, result: OcrRunnerResult): void;
  reportError(sessionId: string, code: OcrFailureCode, message: string): void;
}

export const OCR_BRIDGE_KEY = "wordlessOcr";
