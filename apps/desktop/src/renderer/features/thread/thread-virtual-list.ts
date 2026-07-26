import type { ContextCompactionRecord } from "@wordless/domain";
import type { ConversationMessage, SessionHistoryPage } from "@wordless/protocol";

export type ThreadTimelineItem =
  | { type: "messages"; timestamp: number; messages: ConversationMessage[] }
  | { type: "compaction"; timestamp: number; compaction: ContextCompactionRecord };

function groupMessages(messages: readonly ConversationMessage[]): ConversationMessage[][] {
  const groups: ConversationMessage[][] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    if (message.role === "assistant" && previous?.[0]?.role === "assistant") previous.push(message);
    else groups.push([message]);
  }
  return groups;
}

export function createThreadTimeline(
  messages: readonly ConversationMessage[],
  compactions: readonly ContextCompactionRecord[],
): ThreadTimelineItem[] {
  return [
    ...groupMessages(messages).map((group) => ({ type: "messages" as const, timestamp: group[0]!.timestamp, messages: group })),
    ...compactions.map((compaction) => ({ type: "compaction" as const, timestamp: compaction.timestamp, compaction })),
  ].sort((left, right) => left.timestamp - right.timestamp);
}

export function threadTimelineItemCount(page: SessionHistoryPage): number {
  const messages = page.items.flatMap((item) => item.type === "turn" ? item.turn.messages : []);
  const compactions = page.items.flatMap((item) => item.type === "compaction" ? [item.compaction] : []);
  return createThreadTimeline(messages, compactions).length;
}

// Virtuoso reports rendered indexes with firstItemIndex applied, while its
// imperative methods address the zero-based data array.
export function dataIndexFromReportedIndex(reportedIndex: number, firstItemIndex: number): number {
  return reportedIndex - firstItemIndex;
}

export function firstItemIndexAfterPrepend(firstItemIndex: number, prependedItemCount: number): number {
  return firstItemIndex - prependedItemCount;
}
