import type { ConversationMessage, SessionTurnSummary } from "@wordless/protocol";

function textFromBlocks(blocks: ConversationMessage["blocks"]): string {
  return blocks.flatMap((block) => {
    if (block.type === "text" || block.type === "reasoning") return [block.text];
    if (block.type === "skill-reference" || block.type === "attachment" || block.type === "artifact") return [block.name];
    return [];
  }).join(" ");
}

function estimateMessageTokens(message: ConversationMessage): number {
  if (message.role === "assistant" && (message.usage?.outputTokens ?? 0) > 0) return message.usage!.outputTokens;
  return Math.max(1, Math.ceil(new TextEncoder().encode(textFromBlocks(message.blocks)).byteLength / 3));
}

export function sessionTurnSummaryEquals(left: SessionTurnSummary, right: SessionTurnSummary): boolean {
  return left.excerpt === right.excerpt
    && left.messageId === right.messageId
    && left.ordinal === right.ordinal
    && left.timestamp === right.timestamp
    && left.tokens === right.tokens
    && left.turnId === right.turnId;
}

export function buildSessionTurnSummary(input: {
  messageId: string;
  messages: readonly ConversationMessage[];
  ordinal: number;
  timestamp: number;
  turnId: string;
}): SessionTurnSummary {
  const anchor = input.messages.find((message) => message.id === input.messageId) ?? input.messages[0];
  return {
    excerpt: textFromBlocks(anchor?.blocks ?? []).replace(/\s+/g, " ").trim().slice(0, 160),
    messageId: input.messageId,
    ordinal: input.ordinal,
    timestamp: input.timestamp,
    tokens: input.messages.reduce((total, message) => total + estimateMessageTokens(message), 0),
    turnId: input.turnId,
  };
}
