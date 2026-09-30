import { summarizeUsageMessages, type ConversationMessage } from "@wordless/domain";
import type { SessionUsageSnapshot } from "@wordless/protocol";
import { useMemo } from "react";
import { TurnTokenUsageRow } from "./TurnTokenUsageRow";

/**
 * 一条助手回复(一轮)底下的用量入口。
 *
 * 只接收**这一轮的消息**:轮次边界由渲染它的地方(助手行)决定,而"哪些用量算一条记录"由
 * `summarizeUsageMessages` 决定 —— 与"当前轮"那条路径共用同一个实现,所以两处不会算出两个数。
 */
export function TurnUsageFooter({
  messages,
  loadSessionUsage,
}: {
  messages: readonly ConversationMessage[];
  /** 会话总计的读取器(由上层注入:这一层不该知道 runtime 的存在,不然没法单独渲染)。 */
  loadSessionUsage?: () => Promise<SessionUsageSnapshot | null>;
}) {
  // 依赖消息数组本身:上层每次渲染都会新建数组,所以这里的缓存是为了同一次渲染内不重复算。
  const usage = useMemo(() => summarizeUsageMessages(messages)?.usage, [messages]);
  return <TurnTokenUsageRow loadSessionUsage={loadSessionUsage} usage={usage} />;
}
