import type { ConversationMessage } from "@wordless/protocol";
import type { MessageToolBlock } from "@wordless/domain";
import {
  groupResearchDelegationBlocks,
  type ResearchDelegationGroup,
} from "../workbench/research-delegation";

export type ToolActivityGroupPhase =
  "open" | "sealed-by-text" | "sealed-by-artifact" | "sealed-by-error";

export type ToolActivityGroup = {
  id: string;
  messageIds: string[];
  messageIndexes: number[];
  startMessageId: string;
  startMessageIndex: number;
  startBlockIndex: number;
  tools: MessageToolBlock[];
  toolCount: number;
  roundCount: number;
  /** A live activity chain stays expanded until a structural boundary seals it. */
  phase: ToolActivityGroupPhase;
  /** Real tool execution state, independent of the enclosing message stream. */
  hasActiveTool: boolean;
  processing: boolean;
  hasAwaiting: boolean;
  errorCount: number;
  researchGroups: ResearchDelegationGroup[];
};

export type ToolActivityLayout = {
  groups: ToolActivityGroup[];
  groupsByMessageId: Map<string, ToolActivityGroup[]>;
  groupsByBlock: Map<string, ToolActivityGroup>;
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
export function countRenderedUnits(tools: readonly MessageToolBlock[]): number {
  const researchGroups = groupResearchDelegationBlocks(
    tools.filter((tool) => tool.name === "research_delegate"),
  );
  const researchIds = new Set(
    researchGroups.map((group) => group.details.analysisId),
  );
  const renderedResearchIds = new Set<string>();
  let count = researchGroups.length;
  for (const tool of tools) {
    if (tool.name !== "research_delegate") {
      count += 1;
      continue;
    }
    const analysisId = asRecord(tool.details)?.analysisId;
    if (typeof analysisId !== "string" || !researchIds.has(analysisId)) {
      count += 1;
      continue;
    }
    if (!renderedResearchIds.has(analysisId))
      renderedResearchIds.add(analysisId);
  }
  return count;
}
function blockKey(messageId: string, blockIndex: number): string {
  return `${messageId}:${blockIndex}`;
}

/** Build adjacent activity bursts within one TURN. A non-empty text block seals a burst. */
export function buildToolActivityGroups(
  messages: readonly ConversationMessage[],
): ToolActivityLayout {
  const groups: ToolActivityGroup[] = [];
  const groupsByMessageId = new Map<string, ToolActivityGroup[]>();
  const groupsByBlock = new Map<string, ToolActivityGroup>();
  let current: ToolActivityGroup | undefined;
  const pendingReasoning: Array<{
    message: ConversationMessage;
    messageIndex: number;
    blockIndex: number;
  }> = [];
  const close = (phase: Exclude<ToolActivityGroupPhase, "open">) => {
    if (current) current.phase = phase;
    current = undefined;
    pendingReasoning.length = 0;
  };
  const addMessage = (
    group: ToolActivityGroup,
    message: ConversationMessage,
    messageIndex: number,
  ) => {
    if (group.messageIds.at(-1) !== message.id) {
      group.messageIds.push(message.id);
      group.messageIndexes.push(messageIndex);
    }
    const messageGroups = groupsByMessageId.get(message.id) ?? [];
    if (messageGroups.at(-1) !== group) messageGroups.push(group);
    groupsByMessageId.set(message.id, messageGroups);
  };
  const addBlock = (
    group: ToolActivityGroup,
    message: ConversationMessage,
    messageIndex: number,
    blockIndex: number,
  ) => {
    groupsByBlock.set(blockKey(message.id, blockIndex), group);
    addMessage(group, message, messageIndex);
  };
  messages.forEach((message, messageIndex) => {
    if (hasResponseErrorMessage(message)) close("sealed-by-error");
    for (
      let blockIndex = 0;
      blockIndex < message.blocks.length;
      blockIndex += 1
    ) {
      const block = message.blocks[blockIndex]!;
      if (block.type === "text") {
        if (block.text.trim().length > 0) close("sealed-by-text");
        continue;
      }
      if (block.type === "artifact") {
        close("sealed-by-artifact");
        continue;
      }
      if (block.type === "reasoning") {
        if (current) {
          addBlock(current, message, messageIndex, blockIndex);
          if (message.status === "streaming") current.processing = true;
        } else {
          pendingReasoning.push({ message, messageIndex, blockIndex });
        }
        continue;
      }
      if (block.type !== "tool") continue;
      if (!current) {
        current = {
          id: `tool-burst-${message.id}-${block.callId}`,
          messageIds: [],
          messageIndexes: [],
          startMessageId: message.id,
          startMessageIndex: messageIndex,
          startBlockIndex: blockIndex,
          tools: [],
          toolCount: 0,
          roundCount: 0,
          phase: "open",
          hasActiveTool: false,
          processing: false,
          hasAwaiting: false,
          errorCount: 0,
          researchGroups: [],
        };
        groups.push(current);
        for (const pending of pendingReasoning) {
          addBlock(
            current,
            pending.message,
            pending.messageIndex,
            pending.blockIndex,
          );
        }
        const firstPending = pendingReasoning[0];
        if (firstPending) {
          current.startMessageId = firstPending.message.id;
          current.startMessageIndex = firstPending.messageIndex;
          current.startBlockIndex = firstPending.blockIndex;
        }
        pendingReasoning.length = 0;
      }
      const activityGroup = current;
      activityGroup.tools.push(block);
      addBlock(activityGroup, message, messageIndex, blockIndex);
      if (isToolActive(block)) activityGroup.hasActiveTool = true;
      if (isToolAwaiting(block)) activityGroup.hasAwaiting = true;
      if (block.state === "error") activityGroup.errorCount += 1;
    }
    if (hasResponseErrorMessage(message)) close("sealed-by-error");
  });
  for (const group of groups) {
    group.roundCount = group.messageIndexes.length;
    // A live burst is still in progress even during the gap between adjacent
    // tool rounds. Once a text block seals it, only a genuinely active tool
    // can keep the processing state alive.
    group.processing = group.phase === "open" || group.hasActiveTool;
    group.researchGroups = groupResearchDelegationBlocks(
      group.tools.filter((tool) => tool.name === "research_delegate"),
    );
    group.toolCount = countRenderedUnits(group.tools);
  }
  return { groups, groupsByMessageId, groupsByBlock };
}
