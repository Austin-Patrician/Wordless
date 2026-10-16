import type { MessageToolBlock } from "@wordless/domain";
import type { MessageKey } from "../../shared/i18n";

/**
 * 工具行**显示什么**(名称以外的那几格)。
 *
 * 这里的每一句都同时被两处调用:线程里真实的工具行(`renderer-registry.tsx`)和导出预览/
 * Markdown(`TurnExportDialog` / `turn-export.ts`)。分叉出第二份实现,导出的行迟早和用户
 * 在页面上看到的那行长成两个样子 —— 而"导出"的全部意义就是"把我看到的带走"。
 *
 * 住在纯模块里(不 import React),所以 Markdown 那侧也能用,并且能直接在 `node --test` 里
 * 断言话术。
 */

/** `usePreferences()` 的 `t`。 */
export type Translate = (key: MessageKey) => string;

/** `{name}` 占位替换。 */
export function formatMessage(
  t: Translate,
  key: MessageKey,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    t(key),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 只认字符串,空串等于没有 —— 与线程工具行同一套取值。 */
function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * 工具行的显示名:MCP 工具显示**连接器名**(用户认的是连接器,不是工具内部名),其余显示工具名。
 */
export function toolDisplayName(block: MessageToolBlock): string {
  return block.source?.kind === "mcp" ? block.source.connectorName : block.name;
}

/**
 * 状态词:等待审批 / 等待输入 / 运行中 / 等待执行 / 失败。
 *
 * **完成不在这里** —— 它由行尾那颗状态图标表达(界面上是勾,文本里不需要再写一遍"已完成")。
 */
export function activityState(block: MessageToolBlock, t: Translate): string | undefined {
  if (block.state === "awaiting-approval") return t("toolAwaitingApproval");
  if (block.state === "awaiting-user-input") return t("toolAwaitingInput");
  if (block.state === "running") return t("toolRunning");
  if (block.state === "pending") return t("toolQueued");
  if (block.state === "error") return t("toolFailed");
  return undefined;
}

/** 命令的退出码,拿不到就是 undefined(不是 0 —— 0 是"拿到了,而且是成功")。 */
export function toolExitCode(block: MessageToolBlock): number | undefined {
  const exitCode = asRecord(block.details)?.exitCode;
  return typeof exitCode === "number" ? exitCode : undefined;
}

/**
 * 状态是 complete、但命令退出码非零 —— 界面上要给告警,导出物里也不能装作一切正常。
 */
export function toolCompletedWarning(block: MessageToolBlock): boolean {
  const exitCode = toolExitCode(block);
  return exitCode !== undefined && exitCode !== 0;
}

/**
 * 行中间那格:**这把工具在做什么** —— 命令、路径,或"「模式」在 路径 中"。
 * 都拿不到就返回 undefined,那一行只显示名称(不编一个看起来像路径的字符串)。
 */
export function toolRowDetail(block: MessageToolBlock, t: Translate): string | undefined {
  const input = asRecord(block.input);
  const details = asRecord(block.details);
  const command = textValue(input?.command);
  if (command) return command;
  const path = textValue(input?.path) ?? textValue(details?.path);
  const pattern = textValue(input?.pattern) ?? textValue(details?.pattern);
  if (pattern) {
    // 与线程里那段 JSX 同一个说法(`"pattern"` + `在 {path} 中`)。
    const where = path ? ` ${formatMessage(t, "toolSearchIn", { path })}` : "";
    return `"${pattern}"${where}`;
  }
  return path;
}

/**
 * 行右侧那格:**结果**。退出码 / 已读取行数 / 匹配数 / 命中文件数,其余落到状态词。
 * 与线程里的表达式逐条一致(顺序也一样:退出码优先,因为那是"完成但失败"的唯一线索)。
 */
export function toolRowSummary(block: MessageToolBlock, t: Translate): string | undefined {
  const details = asRecord(block.details);
  const exitCode = toolExitCode(block);
  if (exitCode !== undefined && exitCode !== 0)
    return formatMessage(t, "toolExitCode", { code: exitCode });
  if (block.name === "read" && typeof details?.lineCount === "number")
    return formatMessage(t, "toolLinesRead", { count: details.lineCount });
  if (block.name === "grep" && typeof details?.count === "number") {
    const hasMore = textValue(details?.nextCursor) !== undefined;
    return `${formatMessage(t, "toolSearchMatches", { count: details.count })}${hasMore ? "+" : ""}`;
  }
  if (block.name === "find" && typeof details?.count === "number")
    return formatMessage(t, "toolFilesFound", { count: details.count });
  return activityState(block, t);
}
