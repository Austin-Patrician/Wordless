import type { ContextCompactionRecord, ConversationMessage, MessageBlock, MessageToolBlock } from "@wordless/domain";
import type { SessionHistoryPage, SessionHistoryPageRequest, SessionHistoryTimelineItem, SessionHistoryTurn, SessionTurnSummary } from "@wordless/protocol";

const DEFAULT_HISTORY_TURN_LIMIT = 24;
const TOOL_OUTPUT_PREVIEW_CHARS = 4_096;

export type SessionHistoryProjection = {
  timeline: SessionHistoryTimelineItem[];
  toolOutputs: Map<string, string>;
  turnSummaries: SessionTurnSummary[];
};

function textFromBlocks(blocks: readonly MessageBlock[]): string {
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

function previewOutput(output: string): { output: string; outputTruncated?: boolean } {
  if (output.length <= TOOL_OUTPUT_PREVIEW_CHARS) return { output };
  const half = Math.floor(TOOL_OUTPUT_PREVIEW_CHARS / 2);
  return {
    output: `${output.slice(0, half)}\n... output preview truncated ...\n${output.slice(-half)}`,
    outputTruncated: true,
  };
}

function previewMessage(message: ConversationMessage): ConversationMessage {
  const blocks = message.blocks.map((block): MessageBlock => {
    if (block.type !== "tool" || !block.output) return block;
    const preview = previewOutput(block.output);
    return { ...block, ...preview } satisfies MessageToolBlock;
  });
  return blocks.some((block, index) => block !== message.blocks[index]) ? { ...message, blocks } : message;
}

function selectedTimelineRange(timeline: readonly SessionHistoryTimelineItem[], request: SessionHistoryPageRequest): { end: number; start: number } {
  const limit = Math.min(48, Math.max(1, request.limit ?? DEFAULT_HISTORY_TURN_LIMIT));
  if (request.aroundTurnId) {
    const turnPositions = timeline.flatMap((item, index) => item.type === "turn" ? [{ index, id: item.turn.id }] : []);
    const target = turnPositions.findIndex((item) => item.id === request.aroundTurnId);
    if (target !== -1) {
      const firstTurn = Math.max(0, target - Math.floor(limit / 2));
      const lastTurn = Math.min(turnPositions.length - 1, firstTurn + limit - 1);
      const start = turnPositions[firstTurn]!.index;
      const nextTurn = turnPositions[lastTurn + 1];
      return { start, end: nextTurn?.index ?? timeline.length };
    }
  }

  if (request.after) {
    const requestedStart = Number.parseInt(request.after, 10);
    const start = Number.isFinite(requestedStart) ? Math.min(timeline.length, Math.max(0, requestedStart)) : 0;
    let end = start;
    let turns = 0;
    while (end < timeline.length && turns < limit) {
      if (timeline[end]?.type === "turn") turns += 1;
      end += 1;
    }
    return { start, end };
  }
  const requestedEnd = request.before ? Number.parseInt(request.before, 10) : timeline.length;
  const end = Number.isFinite(requestedEnd) ? Math.min(timeline.length, Math.max(0, requestedEnd)) : timeline.length;
  let start = end;
  let turns = 0;
  while (start > 0 && turns < limit) {
    start -= 1;
    if (timeline[start]?.type === "turn") turns += 1;
  }
  return { start, end };
}

export function createSessionHistoryProjection(messages: readonly ConversationMessage[], compactions: readonly ContextCompactionRecord[]): SessionHistoryProjection {
  const turns: SessionHistoryTurn[] = [];
  let current: SessionHistoryTurn | undefined;
  for (const message of messages) {
    if (message.role === "user" || !current) {
      current = {
        id: `turn:${message.id}`,
        anchorMessageId: message.id,
        messages: [message],
        timestamp: message.timestamp,
      };
      turns.push(current);
    } else {
      current.messages.push(message);
    }
  }

  const timeline: SessionHistoryTimelineItem[] = [
    ...turns.map((turn) => ({ type: "turn" as const, turn })),
    ...compactions.map((compaction) => ({ type: "compaction" as const, compaction })),
  ].sort((left, right) => (left.type === "turn" ? left.turn.timestamp : left.compaction.timestamp) - (right.type === "turn" ? right.turn.timestamp : right.compaction.timestamp));
  const turnSummaries = turns.map((turn, ordinal) => {
    const userMessage = turn.messages.find((message) => message.role === "user") ?? turn.messages[0]!;
    return {
      excerpt: textFromBlocks(userMessage.blocks).replace(/\s+/g, " ").trim().slice(0, 160),
      messageId: turn.anchorMessageId,
      ordinal,
      timestamp: turn.timestamp,
      tokens: turn.messages.reduce((total, message) => total + estimateMessageTokens(message), 0),
      turnId: turn.id,
    } satisfies SessionTurnSummary;
  });
  const toolOutputs = new Map<string, string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool" && block.output) toolOutputs.set(block.callId, block.output);
    }
  }
  return { timeline, toolOutputs, turnSummaries };
}

export function createSessionHistoryPage(projection: SessionHistoryProjection, revision: string, request: SessionHistoryPageRequest = {}): SessionHistoryPage {
  const { start, end } = selectedTimelineRange(projection.timeline, request);
  return {
    hasMoreAfter: end < projection.timeline.length,
    hasMoreBefore: start > 0,
    items: projection.timeline.slice(start, end).map((item) => item.type === "turn"
      ? { type: "turn" as const, turn: { ...item.turn, messages: item.turn.messages.map(previewMessage) } }
      : item),
    ...(start > 0 ? { nextBeforeCursor: String(start) } : {}),
    ...(end < projection.timeline.length ? { nextAfterCursor: String(end) } : {}),
    revision,
  };
}
