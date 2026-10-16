import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationMessage } from "@wordless/domain";
import { messages } from "../src/renderer/shared/i18n.ts";
import {
  buildExportFileName,
  buildTurnMarkdown,
  bytesToBase64,
  hasExportableText,
} from "../src/renderer/features/thread/turn-export.ts";

/**
 * 导出的数据侧。锁的是三件"错了没有别处能发现"的事:
 *
 * 1. **正文与现场同源** —— 导出的就是消息里 text 块的原文,拼接不改写一个字;
 * 2. **失败要说出来** —— 出错的那把工具在 Markdown 里单独标注,不混在成功清单里装没事;
 * 3. **文件名能落地** —— 正文里什么字符都有,名字必须活过 Windows 的文件名规则。
 */

const zh = (key: string): string => (messages["zh-CN"] as Record<string, string>)[key] ?? key;

function message(id: string, blocks: ConversationMessage["blocks"]): ConversationMessage {
  return {
    id,
    role: "assistant",
    timestamp: 0,
    blocks,
    model: null,
  } as ConversationMessage;
}

function toolBlock(
  name: string,
  state: "complete" | "error" = "complete",
  input?: Record<string, unknown>,
  details?: Record<string, unknown>,
): ConversationMessage["blocks"][number] {
  return {
    type: "tool",
    callId: `call-${name}-${Object.values(input ?? {}).join("-")}`,
    name,
    state,
    ...(input ? { input } : {}),
    ...(details ? { details } : {}),
  } as ConversationMessage["blocks"][number];
}

function textBlock(text: string): ConversationMessage["blocks"][number] {
  return { type: "text", text } as ConversationMessage["blocks"][number];
}

test("Markdown 正文 = text 块原文,顺序拼接、一字不改", () => {
  const md = buildTurnMarkdown(
    [
      message("m1", [toolBlock("read_file"), textBlock("第一段回答。")]),
      message("m2", [toolBlock("edit_file"), textBlock("第二段回答。")]),
    ],
    { includeTools: false, t: zh },
  );
  assert.equal(md, "第一段回答。\n\n第二段回答。");
});

test("工具组按它在本轮里的位置出现,形式是纯 Markdown(不塞原始 HTML)", () => {
  const md = buildTurnMarkdown(
    [
      message("m1", [toolBlock("read"), toolBlock("grep"), textBlock("回答。")]),
      message("m2", [toolBlock("bash"), textBlock("补充。")]),
    ],
    { includeTools: true, t: zh },
  );
  // 顺序 = 本轮真实顺序:第一组 → 正文 → 第二组 → 正文。
  assert.equal(
    md,
    [
      "🛠 **已处理 · 读取 2**",
      "",
      "- `read`",
      "- `grep`",
      "",
      "回答。",
      "",
      "🛠 **已处理 · 命令 1**",
      "",
      "- `bash`",
      "",
      "补充。",
    ].join("\n"),
  );
  // 原始 HTML 不进导出物:我们自己的渲染器默认不渲染它(预览里会变成字面文本)。
  assert.doesNotMatch(md, /<details>|<summary>/);
});

test("导出语境的组永远自称「已处理」—— 处理中是现场的活状态", () => {
  // 没有收尾事件(后面没有文字/产物)的组,在现场构建器里 phase=open:预览与
  // Markdown 都不许把它说成「处理中」。
  const md = buildTurnMarkdown([message("m1", [toolBlock("bash")])], { includeTools: true, t: zh });
  assert.doesNotMatch(md, /处理中/);
  assert.match(md, /已处理 · 命令 1/);
});

test("工具行与页面上的工具行同一份话术:名称 — 命令/路径 · 结果", () => {
  const md = buildTurnMarkdown(
    [
      message("m1", [
        toolBlock("bash", "complete", { command: "pnpm test" }),
        toolBlock("read", "complete", { path: "src/a.ts" }, { lineCount: 42 }),
        toolBlock("grep", "complete", { pattern: "TODO", path: "src" }, { count: 3 }),
      ]),
      message("m2", [textBlock("回答。")]),
    ],
    { includeTools: true, t: zh },
  );
  assert.match(md, /- `bash` — pnpm test/);
  assert.match(md, /- `read` — src\/a\.ts · 已读取 42 行/);
  assert.match(md, /- `grep` — "TODO" 在 src 中 · 3 个匹配/);
});

test("拿不到操作对象就只有名字 —— 不编一个看起来像路径的字符串", () => {
  const md = buildTurnMarkdown(
    [message("m1", [toolBlock("read")]), message("m2", [textBlock("回答。")])],
    { includeTools: true, t: zh },
  );
  assert.match(md, /- `read`\n/);
  assert.doesNotMatch(md, /- `read` — /);
});

test("失败与退出码非零都说出来,用线程同一个词", () => {
  const md = buildTurnMarkdown(
    [
      message("m1", [
        toolBlock("read", "error", { path: "src/a.ts" }),
        // 状态是 complete,但命令退出码非零 —— 页面上给告警,导出物里也不能装作一切正常。
        toolBlock("bash", "complete", { command: "exit 1" }, { exitCode: 1 }),
        toolBlock("edit", "complete", { path: "src/b.ts" }),
      ]),
      message("m2", [textBlock("回答。")]),
    ],
    { includeTools: true, t: zh },
  );
  assert.match(md, /- `read` — src\/a\.ts · 失败/);
  assert.match(md, /- `bash` — exit 1 · 退出码 1/);
  assert.match(md, /- `edit` — src\/b\.ts\n/);
  assert.doesNotMatch(md, /- `edit`[^\n]*失败/);
});

test("纯工具轮(没有正文)仍导出工具清单 —— hasExportableText 才是入口闸", () => {
  const onlyTools = [message("m1", [toolBlock("read")])];
  assert.equal(hasExportableText(onlyTools), false);
  const md = buildTurnMarkdown(onlyTools, { includeTools: true, t: zh });
  assert.match(md, /🛠 \*\*已处理/);
  assert.equal(hasExportableText([message("m1", [textBlock("有正文。")])]), true);
});

test("文件名:正文进名字但不破坏文件名规则,时间戳精确", () => {
  const name = buildExportFileName(
    [message("m1", [textBlock('路径/研究: "C:\\下载" 的结论 <test> 之后的说明文字还有很长一段')])],
    new Date(2026, 1, 10, 15, 30).getTime(),
    "md",
  );
  assert.match(name, /^wordless-.+-20260210-1530\.md$/);
  // 名字里不许出现 Windows/POSIX 的非法字符;正文再长也进不了无限的名字。
  assert.doesNotMatch(name, /[\\/:*?"<>|]/);
  const slug = name.slice("wordless-".length, name.lastIndexOf("-20260210"));
  assert.ok(slug.length > 0 && slug.length <= 24);
});

test("文件名在正文奇怪时仍能落地(空正文、全非法字符)", () => {
  assert.match(buildExportFileName([], 0, "png"), /^wordless-turn-\d{8}-\d{4}\.png$/);
  assert.match(
    buildExportFileName([message("m1", [textBlock("\\/:*?\"<>|")])], 0, "png"),
    /^wordless-turn-\d{8}-\d{4}\.png$/,
  );
});

test("base64 编码跨块正确(超过 0x8000 的载荷)", () => {
  const bytes = new Uint8Array(0x8000 + 3).map((_, index) => index % 251);
  const encoded = bytesToBase64(bytes);
  assert.equal(
    Buffer.from(encoded, "base64").subarray(0, bytes.length).toString("hex"),
    Buffer.from(bytes).toString("hex"),
  );
});
