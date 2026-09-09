import type { ConversationMessage } from "@wordless/protocol";
import type { MessageToolBlock } from "@wordless/domain";

/**
 * Tool-activity grouping for assistant runs.
 *
 * Consecutive tool rounds (one round per assistant message) are merged into a
 * single collapsible group, crossing message boundaries. A non-empty text or
 * artifact block breaks the chain; reasoning blocks do not. A message-level
 * response error also breaks the chain.
 */

export type ToolActivityGroupRound = {
  messageId: string;
  tools: MessageToolBlock[];
};

export type ToolActivityGroup = {
  id: string;
  /** callId of the first tool of the first round; identifies where the header renders. */
  startCallId: string;
  startMessageIndex: number;
  endMessageIndex: number;
  rounds: ToolActivityGroupRound[];
  /** Rendered step count: parallel tools count individually, research delegations merge per analysisId. */
  toolCount: number;
  running: boolean;
  hasAwaiting: boolean;
  errorCount: number;
  /** Live timing (renderer store), present only for sessions observed live. */
  startedAt?: number;
  completedAt?: number;
  /** Message timestamps; fallback for wall-clock duration on reloaded sessions. */
  firstMessageTimestamp?: number;
  lastMessageTimestamp?: number;
};

export type ToolActivityLayout = {
  groups: ToolActivityGroup[];
  /** First callId of every tool run → owning group. Runs not in this map are standalone. */
  runGroupByFirstCallId: Map<string, ToolActivityGroup>;
  groupsByMessageIndex: Map<number, ToolActivityGroup[]>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function hasResponseErrorMessage(message: ConversationMessage): boolean {
  return message.status === "error" && Boolean(message.errorMessage);
}

function isToolActive(tool: MessageToolBlock): boolean {
  return tool.state === "pending" || tool.state === "running";
}

function isToolAwaiting(tool: MessageToolBlock): boolean {
  return (
    tool.state === "awaiting-approval" || tool.state === "awaiting-user-input"
  );
}

function countRenderedUnits(tools: readonly MessageToolBlock[]): number {
  const researchAnalysisIds = new Set<string>();
  let count = 0;
  for (const tool of tools) {
    if (tool.name === "research_delegate") {
      const analysisId = asRecord(tool.details)?.analysisId;
      if (typeof analysisId === "string") {
        if (researchAnalysisIds.has(analysisId)) continue;
        researchAnalysisIds.add(analysisId);
      }
    }
    count += 1;
  }
  return count;
}

export function buildToolActivityGroups(
  messages: readonly ConversationMessage[],
): ToolActivityLayout {
  const groups: ToolActivityGroup[] = [];
  const runGroupByFirstCallId = new Map<string, ToolActivityGroup>();
  const groupsByMessageIndex = new Map<number, ToolActivityGroup[]>();
  let open: ToolActivityGroup | null = null;

  messages.forEach((message, messageIndex) => {
    if (hasResponseErrorMessage(message)) open = null;

    const messageGroups = new Set<ToolActivityGroup>();
    let currentRun: MessageToolBlock[] = [];

    const flushRun = () => {
      if (currentRun.length === 0) return;
      const firstCallId = currentRun[0]!.callId;
      let group = open;
      if (!group) {
        group = {
          id: `tool-group-${messageIndex}-${firstCallId}`,
          startCallId: firstCallId,
          startMessageIndex: messageIndex,
          endMessageIndex: messageIndex,
          rounds: [],
          toolCount: 0,
          running: false,
          hasAwaiting: false,
          errorCount: 0,
        };
        groups.push(group);
      }
      runGroupByFirstCallId.set(firstCallId, group);
      group.endMessageIndex = messageIndex;
      group.rounds.push({ messageId: message.id, tools: currentRun });
      group.toolCount += countRenderedUnits(currentRun);
      for (const tool of currentRun) {
        if (isToolActive(tool)) group.running = true;
        if (isToolAwaiting(tool)) group.hasAwaiting = true;
        if (tool.state === "error") group.errorCount += 1;
        if (
          typeof tool.startedAt === "number" &&
          (group.startedAt === undefined || tool.startedAt < group.startedAt)
        )
          group.startedAt = tool.startedAt;
        if (
          typeof tool.completedAt === "number" &&
          (group.completedAt === undefined ||
            tool.completedAt > group.completedAt)
        )
          group.completedAt = tool.completedAt;
      }
      if (group.firstMessageTimestamp === undefined)
        group.firstMessageTimestamp = message.timestamp;
      group.lastMessageTimestamp = message.timestamp;
      messageGroups.add(group);
      open = group;
      currentRun = [];
    };

    for (const block of message.blocks) {
      if (block.type === "tool") {
        currentRun.push(block);
        continue;
      }
      flushRun();
      if (block.type === "text" && block.text.trim().length > 0) open = null;
      if (block.type === "artifact") open = null;
    }
    flushRun();

    if (messageGroups.size > 0)
      groupsByMessageIndex.set(messageIndex, [...messageGroups]);
  });

  return { groups, runGroupByFirstCallId, groupsByMessageIndex };
}

/**
 * Message indexes whose rendered content is entirely owned by collapsed
 * groups (no visible text/artifact of their own). These sections collapse to
 * zero height so the collapsed group header reads as a single row.
 */
export function collapsedToolGroupMessageIndexes(
  messages: readonly ConversationMessage[],
  layout: ToolActivityLayout,
  isGroupExpanded: (group: ToolActivityGroup) => boolean,
): Set<number> {
  const hidden = new Set<number>();
  if (layout.groups.length === 0) return hidden;
  messages.forEach((message, messageIndex) => {
    const groups = layout.groupsByMessageIndex.get(messageIndex);
    if (!groups || groups.length === 0) return;
    // A group start renders the group header — never hide it.
    if (groups.some((group) => group.startMessageIndex === messageIndex))
      return;
    let hasVisibleOwnContent = false;
    for (const block of message.blocks) {
      if (block.type === "tool") continue;
      if (block.type === "text" && block.text.trim().length > 0) {
        hasVisibleOwnContent = true;
        break;
      }
      if (block.type === "artifact") {
        hasVisibleOwnContent = true;
        break;
      }
    }
    if (hasVisibleOwnContent) return;
    if (groups.every((group) => !isGroupExpanded(group)))
      hidden.add(messageIndex);
  });
  return hidden;
}
