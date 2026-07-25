import type { ConversationMessage } from "@wordless/protocol";

export type ConversationTurn = {
  id: string;
  messageIds: string[];
  userMessageId: string | null;
};

export type ConversationDensityItem = {
  anchorMessageId: string;
  messageIds: string[];
  thickness: number;
  tokens: number;
  turnId: string;
};

export type ConversationNavigatorItem = {
  excerpt: string;
  messageId: string;
  turnId: string;
};

export type ConversationDensityModel = {
  items: ConversationDensityItem[];
  navigatorItems: ConversationNavigatorItem[];
  turns: ConversationTurn[];
};

function blockText(message: ConversationMessage): string {
  return message.blocks.flatMap((block) => {
    if (block.type === "text" || block.type === "reasoning") return [block.text];
    if (block.type === "tool") return block.output ? [block.output] : [];
    if (block.type === "attachment" || block.type === "artifact") return [block.name];
    return [];
  }).join("\n");
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).length / 3));
}

export function estimateMessageTokens(message: ConversationMessage): number {
  const outputTokens = message.usage?.outputTokens;
  if (message.role === "assistant" && outputTokens !== undefined && outputTokens > 0) return outputTokens;
  return estimateTextTokens(blockText(message));
}

export function densityThickness(tokens: number): number {
  return Math.min(2.5, Math.max(1.3, 1.15 + Math.log2(Math.max(1, tokens) + 1) * 0.12));
}

export function buildConversationTurns(messages: ConversationMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | undefined;

  for (const message of messages) {
    if (message.role === "user") {
      current = { id: `turn:${message.id}`, messageIds: [message.id], userMessageId: message.id };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { id: `turn:${message.id}`, messageIds: [message.id], userMessageId: null };
      turns.push(current);
      continue;
    }
    current.messageIds.push(message.id);
  }

  return turns;
}

export function buildConversationDensity(messages: ConversationMessage[]): ConversationDensityModel {
  const turns = buildConversationTurns(messages);
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const items = turns.map((turn) => {
    const turnMessages = turn.messageIds.flatMap((messageId) => {
      const message = messagesById.get(messageId);
      return message ? [message] : [];
    });
    const tokens = turnMessages.reduce((total, message) => total + estimateMessageTokens(message), 0);
    return {
      anchorMessageId: turn.userMessageId ?? turn.messageIds[0]!,
      messageIds: turn.messageIds,
      thickness: densityThickness(tokens),
      tokens,
      turnId: turn.id,
    };
  });
  const navigatorItems: ConversationNavigatorItem[] = [];
  for (const turn of turns) {
    if (!turn.userMessageId) continue;
    const message = messagesById.get(turn.userMessageId);
    if (!message) continue;
    navigatorItems.push({
      excerpt: blockText(message).replace(/\s+/g, " ").trim(),
      messageId: message.id,
      turnId: turn.id,
    });
  }

  return { items, navigatorItems, turns };
}
