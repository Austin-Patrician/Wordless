import type {
  ConversationMessage,
  MessageToolBlock,
} from "@wordless/domain";
import type { MessageKey } from "../../shared/i18n";
import { buildToolActivityGroups, formatToolGroupLabel, type ToolActivityGroup } from "./tool-activity-groups.ts";
import { toolDisplayName, toolRowDetail, toolRowSummary } from "../workbench/tool-row-presentation.ts";

/**
 * 本轮导出(Markdown 与长图共用的数据侧)。
 *
 * **与现场同源**:文本就是消息里的 text 块原文(与操作行的「复制」同一个来源),不经过
 * DOM 反序列化,也不重新拼 markdown —— 界面渲染的与导出的是同一份,不存在两套转换互相
 * 对不上的问题。工具组不进这条同源约束:它不是 markdown 文本,由 `buildToolActivityGroups`
 * (与现场同一个分组器)现算。
 */

/** 本轮可导出的正文:各 text 块原文。空白的跳过 —— 那是工具循环里的占位,不是内容。 */
export function exportableTextBlocks(messages: readonly ConversationMessage[]): string[] {
  return messages.flatMap((message) =>
    message.blocks.flatMap((block) =>
      block.type === "text" && block.text.trim().length > 0 ? [block.text] : [],
    ),
  );
}

/** 纯工具轮没有可导出的正文 —— 入口按钮按这个禁用,title 说明原因。 */
export function hasExportableText(messages: readonly ConversationMessage[]): boolean {
  return exportableTextBlocks(messages).length > 0;
}

const EXPORT_FILENAME_MAX_SLUG = 24;
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 导出文件名:`wordless-<首行文本>-<日期>-<时分>.<扩展名>`。
 *
 * 文件名是导出物给别人的第一印象,所以带正文;但正文里什么都有(路径、引号、emoji),
 * 只取第一行、剔掉文件系统不允许的字符、再截断。前缀 `wordless-` 顺带解决了 Windows
 * 保留名(CON、PRN、COM1……)—— 首行再巧也撞不上以它开头的名字。
 */
export function buildExportFileName(
  messages: readonly ConversationMessage[],
  timestamp: number,
  extension: "png" | "md",
): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
  const firstLine = exportableTextBlocks(messages)[0] ?? "";
  const slug = firstLine
    .replace(ILLEGAL_FILENAME_CHARS, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, EXPORT_FILENAME_MAX_SLUG)
    .replace(/[-.\s]+$/, "")
    .trim();
  return `wordless-${slug || "turn"}-${stamp}.${extension}`;
}

/**
 * 一个工具组在 Markdown 里的一节:摘要行 + 工具清单。
 *
 * **纯 Markdown,不用原始 HTML**。曾经用 `<details>` 折叠块,两个理由推翻它:
 * ①我们自己的渲染器默认不渲染原始 HTML(react-markdown 没挂 rehype-raw),`<details>` 在
 * 应用内预览里只会显示成字面文本;②长图里工具组是**按位置**出现在正文之间的,而折叠块被堆在
 * 末尾 —— 同一轮内容,两种顺序,读起来就是两份东西。
 *
 * 所以:位置与长图一致(组出现在它的开头块处),形式是每个查看器都认的纯 Markdown。
 */
export interface MarkdownToolSection {
  label: string;
  lines: readonly string[];
}

/** 工具行:名字 + 操作对象 + 结果话术 —— 全部来自 `tool-row-presentation.ts`,与页面上那行同一份实现。 */
function toolMarkdownLine(tool: MessageToolBlock, t: (key: MessageKey) => string): string {
  const name = `\`${toolDisplayName(tool)}\``;
  const detail = toolRowDetail(tool, t);
  const summary = toolRowSummary(tool, t);
  const tail = [detail, summary]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ");
  return tail ? `- ${name} — ${tail}` : `- ${name}`;
}

export function toolSectionFor(
  group: ToolActivityGroup,
  t: (key: MessageKey) => string,
): MarkdownToolSection {
  /*
   * 导出只发生在轮结束之后,所以快照里的组永远不该自称「处理中」—— 组构建器是给现场的活
   * 状态用的,`open` 的组在导出语境里只是"没有收尾事件",不是"还在跑"。
   * 「N 个失败」接在现场头组件同样的位置 —— 一处说法,两边同形。
   */
  const label = formatToolGroupLabel({ ...group, processing: false }, t);
  return {
    label:
      group.errorCount > 0
        ? `${label} · ${t("threadGroupErrors").replaceAll("{count}", String(group.errorCount))}`
        : label,
    lines: group.tools.map((tool) => toolMarkdownLine(tool, t)),
  };
}

export function turnToolSections(
  messages: readonly ConversationMessage[],
  t: (key: MessageKey) => string,
): MarkdownToolSection[] {
  return buildToolActivityGroups(messages).groups.map((group) => toolSectionFor(group, t));
}

/** 一节工具组的文本:`🛠` 当图标用,摘要行加粗,下面跟清单。 */
function toolSectionMarkdown(section: MarkdownToolSection): string {
  return [`🛠 **${section.label}**`, "", ...section.lines].join("\n");
}

/**
 * 本轮的 Markdown:text 块与工具组**按它们在本轮里的真实顺序**依次出现 —— 与长图同一个顺序。
 * 关掉「包含工具调用」就只剩正文(工具组整节不进导出物)。
 */
export function buildTurnMarkdown(
  messages: readonly ConversationMessage[],
  options: { includeTools: boolean; t: (key: MessageKey) => string },
): string {
  const { groupsByBlock } = buildToolActivityGroups(messages);
  const parts: string[] = [];
  for (const message of messages) {
    message.blocks.forEach((block, blockIndex) => {
      if (block.type === "text") {
        if (block.text.trim().length > 0) parts.push(block.text);
        return;
      }
      if (block.type !== "tool" || !options.includeTools) return;
      // 一个组只在它的开头块出现一次:后续消息里属于同一组的工具块不再重复。
      const group = groupsByBlock.get(`${message.id}:${blockIndex}`);
      if (!group || group.startMessageId !== message.id || group.startBlockIndex !== blockIndex) return;
      parts.push(toolSectionMarkdown(toolSectionFor(group, options.t)));
    });
  }
  return parts.join("\n\n");
}

/** 渲染层自己的 base64:导出不该为了一个十行的函数牵进整个设计模块。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // `String.fromCharCode(...spread)` 有栈上限,按块来 —— 与 preload 里附件的做法一致。
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}
