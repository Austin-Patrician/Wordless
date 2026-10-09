import type { MessageToolBlock } from "@wordless/domain";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * bash 命令成功后,那一行 `View output` 入口要不要出现。
 *
 * 为什么需要这条规则:命令成功但**什么都没打印**时,工具结果的正文只有一句兜底文案
 * ("Command finished with exit code 0"),再给它一个可展开的输出入口纯属啰嗦。
 *
 * 判断依据必须是**工具显式给的信号**(`details.hasOutput`),不能在界面里猜 —— 这里能看到的文本
 * 已经加过兜底,想分辨"兜底句 vs 真输出"就只剩"字符串匹配那句英文"这一条路,文案一改就失效。
 *
 * 这条规则以前是拿 `details.stdout` / `details.stderr` 判断的,而 bash 工具**从来不设这两个字段**
 * (它只给 `command` / `elapsedMs` / `exitCode` / `timeoutSeconds`),于是规则退化成
 * "所有成功的 bash 都隐藏" —— 真输出、以及被截断的那份,全都连入口一起消失(2026-10 修)。
 *
 * 三条否定条件各挡一种"必须保留入口"的情况:
 * - `exitCode !== 0`:失败 / 超时 / 还在跑。失败时正文里可能带着 failureHint("这台机器上没有它"
 *   之类的指路),那是要给人读的;运行中更是本来就该能看实时输出。
 * - `truncated === true`:输出被截断过(只留了尾部 50KB),入口是唯一能读到那份的地方。
 * - `hasOutput` 不是 `false`:改动前写入的老记录没有这个字段(`undefined`),一律按"有输出"处理 ——
 *   否则这次修改会把历史会话的输出入口一起吃掉。
 */
export function hidesEmptySuccessfulBashOutput(block: MessageToolBlock): boolean {
  if (block.name !== "bash") return false;
  const details = asRecord(block.details);
  if (!details) return false;
  if (details.exitCode !== 0) return false;
  if (details.truncated === true) return false;
  return details.hasOutput === false;
}
