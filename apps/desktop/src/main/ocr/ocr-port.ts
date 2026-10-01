import { isAbsolute, join, resolve } from "node:path";
import type { OcrGranularity, OcrImageRequest, OcrInlineImage, OcrOutcome, OcrPort } from "@wordless/capability-ocr";
import type { OcrRecognition } from "./ocr-service";
import type { OcrService } from "./ocr-service";
import type { OcrRecognitionResult } from "@wordless/capability-ocr";

/**
 * 把桌面端的 OCR 服务适配成能力包声明的端口。
 *
 * 适配发生在这一层的原因与浏览器能力相同:能力包不该知道工作区、会话或 Electron。这里多做
 * 的一件事是**路径约束** —— 模型给的路径可能是相对的(甚至是 `../../` 开头的),必须先落回
 * 会话工作区内才允许读。与设计画布同一套纪律:路径不进 URL、只进注册表,于是"构造一个逃出
 * 工作区的路径"在结构上不可能。
 */
export interface OcrPortOptions {
  workspaceRoot: string;
  /** 生产传 `WorkspacePathService#isWithinRoot`。 */
  isWithinRoot: (root: string, candidate: string) => boolean;
}

export function createOcrPort(service: OcrService, options: OcrPortOptions): OcrPort {
  const { workspaceRoot, isWithinRoot } = options;
  return {
    async status() {
      // 服务那边已经带上了"为什么不可用"(含它看的目录),直接透传。
      return await service.status();
    },

    async recognizeInline(images: OcrInlineImage[], requestOptions: { signal: AbortSignal }): Promise<OcrOutcome> {
      // 字节是宿主自己给的(截图),不经过工作区路径 —— 没有路径要约束。
      const outcome = await service.recognizeBuffers(
        images.map((image) => ({ image: { path: image.name, name: image.name, mimeType: image.mimeType }, bytes: Buffer.from(image.base64, "base64") })),
        { signal: requestOptions.signal },
      );
      return outcome.ok ? { ok: true, recognition: toRecognition(outcome.recognition) } : outcome;
    },

    async recognize(images: OcrImageRequest[], requestOptions: { signal: AbortSignal; granularity?: OcrGranularity }): Promise<OcrOutcome> {
      const resolved: OcrImageRequest[] = [];
      for (const image of images) {
        const absolute = isAbsolute(image.path) ? resolve(image.path) : resolve(join(workspaceRoot, image.path));
        if (!isWithinRoot(workspaceRoot, absolute)) {
          return { ok: false, code: "pipeline-error", message: `${image.path} is outside this session's workspace` };
        }
        resolved.push({ ...image, path: absolute });
      }
      const outcome = await service.recognize(resolved, {
        signal: requestOptions.signal,
        ...(requestOptions.granularity === undefined ? {} : { granularity: requestOptions.granularity }),
      });
      return outcome.ok ? { ok: true, recognition: toRecognition(outcome.recognition) } : outcome;
    },
  };
}

/** 服务的结果与能力包的结果是同一个形状,这里只是显式列一遍(两边各自演化时不会静默错位)。 */
function toRecognition(recognition: OcrRecognition): OcrRecognitionResult {
  return {
    engine: recognition.engine,
    cached: recognition.cached,
    totalDurationMs: recognition.totalDurationMs,
    pages: recognition.pages.map((page) => ({
      name: page.name,
      path: page.path,
      text: page.text,
      ...(page.lines === undefined ? {} : { lines: page.lines }),
      lineCount: page.lineCount,
      width: page.width,
      height: page.height,
      confidence: page.confidence,
      durationMs: page.durationMs,
    })),
  };
}
