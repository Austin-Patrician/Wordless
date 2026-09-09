import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@wordless/protocol";
import type { MessageToolBlock } from "@wordless/domain";
import {
  buildToolActivityGroups,
  collapsedToolGroupMessageIndexes,
} from "./tool-activity-groups";

let callSeq = 0;
function tool(
  overrides: Partial<MessageToolBlock> = {},
): MessageToolBlock {
  callSeq += 1;
  return {
    type: "tool",
    callId: `call-${callSeq}`,
    name: "bash",
    state: "complete",
    ...overrides,
  };
}

function assistantMessage(
  blocks: ConversationMessage["blocks"],
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    status: "complete",
    blocks,
    model: null,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function bashRounds(count: number): ConversationMessage[] {
  return Array.from({ length: count }, () => assistantMessage([tool()]));
}

describe("buildToolActivityGroups", () => {
  it("merges consecutive tool rounds across message boundaries into one group", () => {
    const layout = buildToolActivityGroups(bashRounds(3));
    expect(layout.groups).toHaveLength(1);
    const group = layout.groups[0]!;
    expect(group.rounds).toHaveLength(3);
    expect(group.toolCount).toBe(3);
    // every run maps to the same group
    expect(layout.runGroupByFirstCallId.size).toBe(3);
    for (const round of group.rounds)
      expect(layout.runGroupByFirstCallId.get(round.tools[0]!.callId)).toBe(
        group,
      );
    // the group starts in the first message
    expect(group.startMessageIndex).toBe(0);
    expect(group.startCallId).toBe(group.rounds[0]!.tools[0]!.callId);
  });

  it("breaks the group on non-empty text blocks but not on reasoning", () => {
    const messages = [
      assistantMessage([tool()]),
      assistantMessage([tool({ name: "read" })]),
      // text before the tool: breaks the chain, next tool opens a new group
      assistantMessage([
        { type: "text", text: "我发现问题了，接下来修复。" },
        tool(),
      ]),
      assistantMessage([{ type: "reasoning", text: "thinking..." }, tool()]),
      // empty text does not break
      assistantMessage([
        { type: "text", text: "   " },
        tool(),
      ]),
    ];
    const layout = buildToolActivityGroups(messages);
    expect(layout.groups).toHaveLength(2);
    const [first, second] = layout.groups;
    expect(first!.rounds).toHaveLength(2);
    expect(first!.endMessageIndex).toBe(1);
    expect(second!.startMessageIndex).toBe(2);
    expect(second!.rounds).toHaveLength(3);
    // message 3's reasoning-only round did not break the group
    expect(second!.rounds[1]!.messageId).toBe(messages[3]!.id);
    expect(second!.toolCount).toBe(3);
  });

  it("marks running, awaiting and error states on the group", () => {
    const layout = buildToolActivityGroups([
      assistantMessage([tool({ state: "complete" })]),
      assistantMessage([
        tool({ state: "error" }),
        tool({ state: "awaiting-approval" }),
      ]),
    ]);
    const group = layout.groups[0]!;
    expect(group.running).toBe(false);
    expect(group.hasAwaiting).toBe(true);
    expect(group.errorCount).toBe(1);
    expect(group.toolCount).toBe(3);

    const runningLayout = buildToolActivityGroups([
      assistantMessage([tool({ state: "running" })]),
    ]);
    expect(runningLayout.groups[0]!.running).toBe(true);
  });

  it("aggregates live timing and message timestamps", () => {
    const layout = buildToolActivityGroups([
      assistantMessage([tool({ startedAt: 1_000, completedAt: 1_500 })], {
        timestamp: 1_400,
      }),
      assistantMessage([tool({ startedAt: 2_000, completedAt: 3_000 })], {
        timestamp: 2_600,
      }),
    ]);
    const group = layout.groups[0]!;
    expect(group.startedAt).toBe(1_000);
    expect(group.completedAt).toBe(3_000);
    expect(group.firstMessageTimestamp).toBe(1_400);
    expect(group.lastMessageTimestamp).toBe(2_600);
  });

  it("counts merged research delegations as a single step", () => {
    const details = {
      analysisId: "analysis-1",
      tasks: [{ taskId: "t1", title: "a" }],
    };
    const layout = buildToolActivityGroups([
      assistantMessage([
        tool({ name: "research_delegate", details }),
        tool({ name: "research_delegate", details }),
        tool({ name: "read" }),
      ]),
    ]);
    expect(layout.groups[0]!.toolCount).toBe(2);
  });

  it("breaks the group on a message-level response error", () => {
    const layout = buildToolActivityGroups([
      assistantMessage([tool()]),
      assistantMessage([tool()], { status: "error", errorMessage: "boom" }),
      assistantMessage([tool()]),
    ]);
    expect(layout.groups).toHaveLength(2);
  });
});

describe("collapsedToolGroupMessageIndexes", () => {
  it("hides continuation messages of a collapsed group but never the group start", () => {
    const messages = bashRounds(3);
    const layout = buildToolActivityGroups(messages);
    const expanded = () => false;
    const hidden = collapsedToolGroupMessageIndexes(
      messages,
      layout,
      expanded,
    );
    expect(hidden.has(0)).toBe(false);
    expect(hidden.has(1)).toBe(true);
    expect(hidden.has(2)).toBe(true);
    const expandedAll = () => true;
    expect(
      collapsedToolGroupMessageIndexes(messages, layout, expandedAll).size,
    ).toBe(0);
  });

  it("keeps messages with their own text visible", () => {
    const messages = [
      assistantMessage([tool()]),
      assistantMessage([{ type: "text", text: "结论" }, tool()]),
    ];
    const layout = buildToolActivityGroups(messages);
    const hidden = collapsedToolGroupMessageIndexes(
      messages,
      layout,
      () => false,
    );
    expect(hidden.has(1)).toBe(false);
  });

  it("returns empty when there are no groups", () => {
    const messages = [
      assistantMessage([{ type: "text", text: "纯文本回复" }]),
    ];
    expect(
      collapsedToolGroupMessageIndexes(
        messages,
        buildToolActivityGroups(messages),
        () => false,
      ).size,
    ).toBe(0);
  });
});
