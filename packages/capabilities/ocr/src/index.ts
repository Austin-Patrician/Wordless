export * from "./port.js";

import { Type, type TSchema } from "typebox";
import type { AgentTool, AgentToolResult } from "@wordless/agent";
import type { OcrPort, OcrRecognitionResult } from "./port.js";

/**
 * 文字识别工具。
 *
 * 用途很窄但很硬:**模型自己看不了图时,让它可以读图里的字**。所以描述里必须写清"什么时候
 * 不该用它" —— OCR 不是视觉的替代品,它拿不到布局、颜色、图表趋势、盖章、手写。
 *
 * 返回的文字**带来源标注**:结果会被写进会话,读的人(模型或用户)必须知道这是机器识别的
 * 文字,而不是"模型看过这张图"。少了这句话,后面所有推理都会被带偏。
 */

type ToolDetails = Record<string, unknown>;

/** 保留参数推断:每个工具的 `input` 由它的 schema 推出。 */
function tool<TParameters extends TSchema>(definition: AgentTool<TParameters, ToolDetails>): AgentTool<TParameters, ToolDetails> {
  return definition;
}

function text(value: string): AgentToolResult<ToolDetails>["content"] {
  return [{ type: "text", text: value }];
}

export const OCR_UNAVAILABLE_MESSAGE =
  "Text recognition is not available in this build, so this image cannot be read as text. Ask the user to describe the image, or to paste the text it contains.";

const DESCRIPTION = `Extract text from an image file (PNG, JPEG, WebP, BMP, GIF) with the local OCR engine.

Runs entirely on this machine — no network calls, no uploads. Built for screenshots, scanned pages, and photographs of documents.

Output
  The recognized text, followed by a metadata footer (line count, a coarse 0..1 confidence, engine, duration). The footer is metadata, NOT part of the image's content — never quote it back to the user as if it were.

When to use
  - The current model cannot view images, and the user attached a screenshot or a photo.
  - You need machine-extracted text from an image the user cannot describe (an error message, a table of numbers, a page of prose).

When NOT to use
  - A vision-capable model can look at the image: look at it instead. OCR loses layout, colour, and every visual judgement, and reading text in context is more reliable.
  - You need a VISUAL judgement: charts and trends, seals or stamps (盖章/印章), signatures, handwriting, logos, alignment, colour. OCR returns text only and cannot answer those.
  - You need the file's metadata or bytes: use the workspace tools.

Limitations
  - Printed Chinese and English text only. Handwriting, seals, and stylized fonts come out poorly.
  - Tables are flattened into lines: column structure is lost.
  - The confidence value is coarse — use it to compare runs, never as a hard threshold.`;

export function createOcrTools(port: OcrPort): AgentTool[] {
  const extractText = tool({
    name: "extract_text_from_image",
    label: "Extract text from an image",
    description: DESCRIPTION,
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      maxChars: Type.Optional(Type.Integer({ minimum: 100, maximum: 100_000 })),
      /** 省略 = 用设置里的默认粒度。`line` 会额外给每行的置信度。 */
      granularity: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("line")])),
    }),
    async execute(_id, input, signal) {
      const request = input as { path: string; maxChars?: number; granularity?: "text" | "line" };
      const status = await port.status();
      if (!status.available) {
        // 原样转述**具体原因**(目录/缺哪个文件),而不是只说"不可用":排查全靠这句。
        return { content: text(`${OCR_UNAVAILABLE_MESSAGE}\n\nReason: ${status.detail}`), details: { code: "assets-missing", reason: status.detail } };
      }
      const outcome = await port.recognize(
        [{ path: request.path, name: request.path.split(/[/\\]/).pop() ?? request.path, mimeType: guessMimeType(request.path) }],
        {
          signal: signal ?? new AbortController().signal,
          ...(request.granularity === undefined ? {} : { granularity: request.granularity }),
        },
      );
      if (!outcome.ok) {
        // **两条分支都要带上原因。** 之前"未就绪"这条把 `message` 丢了,于是工具结果里只剩
        // 一句"这个构建没有文字识别" —— 而真正有用的信息(它看的哪个目录、缺哪个文件)全没了,
        // 排查只能靠猜。
        return {
          content: text(
            outcome.code === "assets-missing"
              ? `${OCR_UNAVAILABLE_MESSAGE}\n\nReason: ${outcome.message}`
              : `Text recognition failed (${outcome.code}): ${outcome.message}`,
          ),
          details: { code: outcome.code, reason: outcome.message },
        };
      }
      return { content: text(formatRecognition(outcome.recognition, request.maxChars)), details: detailsOf(outcome.recognition) };
    },
  });

  return [extractText];
}

function guessMimeType(path: string): string {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".bmp") return "image/bmp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

export function formatRecognition(recognition: OcrRecognitionResult, maxChars?: number): string {
  const limit = maxChars ?? 8000;
  const pages = recognition.pages.map((page) => {
    const text = page.text.length > limit ? `${page.text.slice(0, limit)}\n[Text truncated: ${page.text.length} characters total]` : page.text;
    if (page.text.trim().length === 0) return `${page.name}: no text was recognized in this image.`;
    // 逐行粒度:把每行单独列出来并带上置信度 —— 模型据此知道哪几行可能读错。
    if (page.lines !== undefined && page.lines.length > 0) {
      const lines = page.lines.map((line, index) => `${index + 1}. ${line.text}  (${line.confidence.toFixed(2)})`).join("\n");
      return `${page.name} (line by line, confidence in parentheses):\n${lines}`;
    }
    return text;
  });
  const footer = recognition.pages
    .map((page) => `${page.name}: ${page.lineCount} line(s), confidence ${page.confidence.toFixed(2)}, ${page.durationMs}ms`)
    .join("\n");
  return [
    ...pages,
    "",
    "---",
    "The text above was extracted by a local OCR engine from the image's pixels — it is not a visual description of the image.",
    footer,
    `engine: ${recognition.engine}${recognition.cached ? " (cached)" : ""}`,
  ].join("\n");
}

function detailsOf(recognition: OcrRecognitionResult): ToolDetails {
  return {
    engine: recognition.engine,
    cached: recognition.cached,
    totalDurationMs: recognition.totalDurationMs,
    pages: recognition.pages.map((page) => ({
      name: page.name,
      path: page.path,
      lineCount: page.lineCount,
      ...(page.lines === undefined ? {} : { lines: page.lines }),
      characters: page.text.length,
      confidence: page.confidence,
      durationMs: page.durationMs,
    })),
  };
}
