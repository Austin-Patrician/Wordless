import { expect, it } from "vitest";
import { OCR_UNAVAILABLE_MESSAGE, createOcrTools, formatRecognition } from "../src/index.ts";
import type { OcrOutcome, OcrPort } from "../src/port.ts";

/**
 * 文字识别工具。
 *
 * 三件事必须钉住:模型看不了图时**不假装看过**、结果里**带来源标注**、不可用时**如实说**
 * 而不是报一个内部错误。第一条尤其重要 —— 少了它,后面所有推理都会被带偏。
 */

type Tool = ReturnType<typeof createOcrTools>[number];
type ToolResult = { content: Array<{ type: string; text?: string }>; details: Record<string, unknown> };

const RECOGNITION = {
  engine: "wordless-ocr/ppocrv5+ort-web-1.25.1+wasm2",
  cached: false,
  totalDurationMs: 340,
  pages: [
    {
      name: "shot.png",
      path: "/workspace/.attachments/shot.png",
      text: "TypeError: cannot read property 'id' of undefined",
      lineCount: 2,
      width: 800,
      height: 200,
      confidence: 0.93,
      durationMs: 300,
    },
  ],
};

let lastGranularity: string | undefined;

function port(outcome: OcrOutcome, available = true): OcrPort {
  return {
    status: async () => ({ available, detail: "Ready (ppocrv5)." }),
    recognize: async (_images, options) => {
      lastGranularity = options.granularity;
      return outcome;
    },
  };
}

function textOf(result: ToolResult): string {
  return result.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

async function run(tools: Tool[], path: string, maxChars?: number, granularity?: "text" | "line"): Promise<ToolResult> {
  const tool = tools.find((entry) => entry.name === "extract_text_from_image");
  if (!tool) throw new Error("extract_text_from_image is not registered");
  return (await tool.execute("call", {
    path,
    ...(maxChars === undefined ? {} : { maxChars }),
    ...(granularity === undefined ? {} : { granularity }),
  } as never)) as unknown as ToolResult;
}

it("注册了唯一一个工具,且名字与描述都写清了边界", () => {
  const tools = createOcrTools(port({ ok: true, recognition: RECOGNITION }));
  expect(tools.map((tool) => tool.name)).toEqual(["extract_text_from_image"]);
  const description = tools[0]?.description ?? "";
  // 描述必须同时说清"什么时候用"和"什么时候别用" —— OCR 不是视觉的替代品。
  expect(description).toContain("When to use");
  expect(description).toContain("When NOT to use");
  expect(description).toContain("seals or stamps");
  expect(description).toContain("no network calls");
});

it("识别成功:返回文字,并明确标注这是机器识别的结果", async () => {
  const result = await run(createOcrTools(port({ ok: true, recognition: RECOGNITION })), "/workspace/.attachments/shot.png");
  const text = textOf(result);
  expect(text).toContain("TypeError: cannot read property");
  // 没有这句,读的人会以为模型"看过这张图"。
  expect(text).toContain("not a visual description of the image");
  expect(text).toContain("wordless-ocr/ppocrv5");
  expect(result.details["engine"]).toBe(RECOGNITION.engine);
});

it("资产缺失时说清这台机器没有文字识别,并把具体原因一起给出来", async () => {
  const result = await run(createOcrTools(port({ ok: false, code: "assets-missing", message: "not bundled" }, false)), "shot.png");
  const text = textOf(result);
  expect(text).toContain(OCR_UNAVAILABLE_MESSAGE);
  // 只有"不可用"这句话对排查毫无帮助:必须带上"看的哪个目录/缺什么"。
  expect(text).toContain("Reason:");
  expect(result.details["code"]).toBe("assets-missing");
});

it("可用性为假时直接返回同一句话,不调用识别", async () => {
  let called = 0;
  const tools = createOcrTools({
    status: async () => ({ available: false, detail: "assets are not bundled in this build" }),
    recognize: async () => {
      called += 1;
      return { ok: false, code: "assets-missing", message: "unused" };
    },
  });
  const result = await run(tools, "shot.png");
  expect(textOf(result)).toContain(OCR_UNAVAILABLE_MESSAGE);
  expect(textOf(result)).toContain("assets are not bundled in this build");
  expect(called).toBe(0);
});

it("识别失败时带上失败分类", async () => {
  const result = await run(createOcrTools(port({ ok: false, code: "timeout", message: "took too long" })), "shot.png");
  expect(textOf(result)).toContain("timeout");
  expect(result.details["code"]).toBe("timeout");
});

it("识别阶段报 assets-missing 时也要带上原因(这条曾经把原因丢了)", async () => {
  const result = await run(
    createOcrTools(port({ ok: false, code: "assets-missing", message: "assets are incomplete under /tmp/ocr" })),
    "shot.png",
  );
  const text = textOf(result);
  expect(text).toContain(OCR_UNAVAILABLE_MESSAGE);
  expect(text).toContain("Reason: assets are incomplete under /tmp/ocr");
  expect(result.details["reason"]).toBe("assets are incomplete under /tmp/ocr");
});

it("超长文本被截断,并说明原文有多长", async () => {
  const long = { ...RECOGNITION, pages: [{ ...RECOGNITION.pages[0]!, text: "x".repeat(500) }] };
  const result = await run(createOcrTools(port({ ok: true, recognition: long })), "shot.png", 100);
  const text = textOf(result);
  expect(text).toContain("[Text truncated: 500 characters total]");
  expect(text.length).toBeLessThan(600);
});

it("图里没有文字时如实说没有,而不是给一段空白", () => {
  const empty = { ...RECOGNITION, pages: [{ ...RECOGNITION.pages[0]!, text: "", lineCount: 0 }] };
  expect(formatRecognition(empty)).toContain("no text was recognized");
});

it("granularity=line:逐行列出并带置信度,同时把粒度传给端口", async () => {
  const withLines = {
    ...RECOGNITION,
    pages: [{ ...RECOGNITION.pages[0]!, lines: [{ text: "TypeError: x", confidence: 0.91 }, { text: "at foo.ts:12", confidence: 0.62 }] }],
  };
  const result = await run(createOcrTools(port({ ok: true, recognition: withLines })), "shot.png", undefined, "line");
  const text = textOf(result);
  expect(lastGranularity).toBe("line");
  expect(text).toContain("line by line");
  expect(text).toContain("1. TypeError: x  (0.91)");
  expect(text).toContain("2. at foo.ts:12  (0.62)");
});

it("不给粒度时不传(用设置里的默认值),也不摆逐行清单", async () => {
  const result = await run(createOcrTools(port({ ok: true, recognition: RECOGNITION })), "shot.png");
  expect(lastGranularity).toBeUndefined();
  expect(textOf(result)).not.toContain("line by line");
});
