import type { ContextCompactionRecord } from "@wordless/domain";
import type { ConversationMessage } from "@wordless/protocol";

export function completeContextCompaction(
  messages: readonly ConversationMessage[],
  contextCompactions: readonly ContextCompactionRecord[],
  compaction: ContextCompactionRecord,
  recoveredFailureMessageId?: string,
): { messages: ConversationMessage[]; contextCompactions: ContextCompactionRecord[] } {
  return {
    messages: recoveredFailureMessageId
      ? messages.filter((message) => message.id !== recoveredFailureMessageId)
      : [...messages],
    contextCompactions: [...contextCompactions.filter((item) => item.id !== compaction.id), compaction]
      .sort((left, right) => left.timestamp - right.timestamp),
  };
}
