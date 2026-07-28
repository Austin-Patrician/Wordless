import type { ContextCompactionRecord } from "@wordless/domain";
import type { ConversationMessage, SessionHistoryPage } from "@wordless/protocol";
import type { AssistantRunPresentation } from "./thread-run-state";

export type ThreadTimelineItem =
  | { type: "messages"; timestamp: number; messages: ConversationMessage[]; turnId: string }
  | { type: "assistant-run"; timestamp: number; presentation: AssistantRunPresentation; turnId: string }
  | { type: "compaction"; timestamp: number; compaction: ContextCompactionRecord };

function groupMessages(messages: readonly ConversationMessage[]): Array<{ messages: ConversationMessage[]; turnId: string }> {
  const groups: Array<{ messages: ConversationMessage[]; turnId: string }> = [];
  let turnId: string | null = null;
  for (const message of messages) {
    const previous = groups.at(-1);
    if (message.role === "user") turnId = `turn:${message.id}`;
    const messageTurnId = turnId ?? `turn:${message.id}`;
    if (message.role === "assistant" && previous?.messages[0]?.role === "assistant" && previous.turnId === messageTurnId) previous.messages.push(message);
    else groups.push({ messages: [message], turnId: messageTurnId });
  }
  return groups;
}

export function createThreadTimeline(
  messages: readonly ConversationMessage[],
  compactions: readonly ContextCompactionRecord[],
  runPresentation?: AssistantRunPresentation | null,
): ThreadTimelineItem[] {
  const items: ThreadTimelineItem[] = [
    ...groupMessages(messages).map((group) => ({ type: "messages" as const, timestamp: group.messages[0]!.timestamp, messages: group.messages, turnId: group.turnId })),
    ...compactions.map((compaction) => ({ type: "compaction" as const, timestamp: compaction.timestamp, compaction })),
  ];
  if (runPresentation?.userMessageId) {
    const turnId = `turn:${runPresentation.userMessageId}`;
    const hasAssistant = items.some((item) => item.type === "messages" && item.turnId === turnId && item.messages[0]?.role === "assistant");
    if (!hasAssistant) {
      const latestRunCompaction = compactions.reduce(
        (latest, compaction) => compaction.timestamp >= runPresentation.startedAt ? Math.max(latest, compaction.timestamp) : latest,
        runPresentation.startedAt - 1,
      );
      items.push({
        type: "assistant-run",
        timestamp: latestRunCompaction >= runPresentation.startedAt ? latestRunCompaction + 1 : runPresentation.startedAt,
        presentation: runPresentation,
        turnId,
      });
    }
  }
  return items.sort((left, right) => left.timestamp - right.timestamp);
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
