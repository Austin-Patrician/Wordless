import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "@wordless/protocol";
import type { MessageToolBlock } from "@wordless/domain";
import {
  buildToolActivityGroups,
  countRenderedUnits,
} from "./tool-activity-groups";

let callSeq = 0;
function tool(overrides: Partial<MessageToolBlock> = {}): MessageToolBlock {
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
    id: `msg-${++callSeq}`,
    role: "assistant",
    status: "complete",
    blocks,
    model: null,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe("buildToolActivityGroups", () => {
  it("merges adjacent assistant rounds into one activity burst", () => {
    const messages = [
      assistantMessage([{ type: "reasoning", text: "inspect" }, tool()]),
      assistantMessage([
        { type: "reasoning", text: "adjust" },
        tool({ name: "read" }),
      ]),
      assistantMessage([tool({ name: "write" })]),
    ];
    const layout = buildToolActivityGroups(messages);
    const group = layout.groups[0]!;

    expect(layout.groups).toHaveLength(1);
    expect(group.id).toBe(
      `tool-burst-${messages[0]?.id}-${group.tools[0]?.callId}`,
    );
    expect(group.startMessageId).toBe(messages[0]?.id);
    expect(group.startBlockIndex).toBe(0);
    expect(group.toolCount).toBe(3);
    expect(group.roundCount).toBe(3);
    expect(group.phase).toBe("open");
    expect(group.processing).toBe(true);
    expect(group.messageIds).toEqual(messages.map((message) => message.id));
    expect(layout.groupsByBlock.get(`${messages[1]?.id}:0`)).toBe(group);
    expect(layout.groupsByBlock.get(`${messages[2]?.id}:0`)).toBe(group);
  });

  it("includes reasoning-only rounds inside an open burst", () => {
    const messages = [
      assistantMessage([tool()]),
      assistantMessage([{ type: "reasoning", text: "checking result" }]),
      assistantMessage([tool({ name: "read" })]),
    ];
    const layout = buildToolActivityGroups(messages);
    const group = layout.groups[0]!;

    expect(layout.groups).toHaveLength(1);
    expect(group.roundCount).toBe(3);
    expect(layout.groupsByBlock.get(`${messages[1]?.id}:0`)).toBe(group);
    expect(
      buildToolActivityGroups([
        assistantMessage([{ type: "reasoning", text: "standalone" }]),
      ]).groups,
    ).toHaveLength(0);
  });

  it("splits bursts at non-empty text and records both bursts for one message", () => {
    const message = assistantMessage([
      { type: "reasoning", text: "first" },
      tool(),
      { type: "text", text: "First pass is done." },
      { type: "reasoning", text: "second" },
      tool({ name: "read" }),
    ]);
    const layout = buildToolActivityGroups([message]);

    expect(layout.groups).toHaveLength(2);
    expect(layout.groups.map((group) => group.toolCount)).toEqual([1, 1]);
    expect(layout.groups.map((group) => group.phase)).toEqual([
      "sealed-by-text",
      "open",
    ]);
    expect(layout.groups.map((group) => group.processing)).toEqual([
      false,
      true,
    ]);
    expect(layout.groupsByMessageId.get(message.id)).toEqual(layout.groups);
    expect(layout.groupsByBlock.get(`${message.id}:0`)).toBe(layout.groups[0]);
    expect(layout.groupsByBlock.get(`${message.id}:3`)).toBe(layout.groups[1]);
  });

  it("splits bursts at artifacts and response errors", () => {
    const messages = [
      assistantMessage([
        tool(),
        { type: "artifact", artifactId: "a", name: "report", kind: "report" },
        tool({ name: "read" }),
      ]),
      assistantMessage([tool({ name: "write" })], {
        status: "error",
        errorMessage: "failed",
      }),
      assistantMessage([tool({ name: "bash" })]),
    ];
    const layout = buildToolActivityGroups(messages);

    expect(layout.groups).toHaveLength(4);
    expect(layout.groups.map((group) => group.toolCount)).toEqual([1, 1, 1, 1]);
    expect(layout.groups.map((group) => group.phase)).toEqual([
      "sealed-by-artifact",
      "sealed-by-error",
      "sealed-by-error",
      "open",
    ]);
  });

  it("aggregates processing, awaiting and errors across the burst", () => {
    const group = buildToolActivityGroups([
      assistantMessage([tool({ state: "complete" })], { status: "streaming" }),
      assistantMessage([
        tool({ state: "awaiting-approval" }),
        tool({ state: "error" }),
      ]),
    ]).groups[0]!;

    expect(group.processing).toBe(true);
    expect(group.hasAwaiting).toBe(true);
    expect(group.errorCount).toBe(1);
    expect(group.roundCount).toBe(2);
  });

  it("marks a completed burst as processed on the first non-empty text delta", () => {
    const message = assistantMessage(
      [tool({ state: "complete" }), { type: "text", text: "Done." }],
      { status: "streaming" },
    );
    const group = buildToolActivityGroups([message]).groups[0]!;

    expect(group.phase).toBe("sealed-by-text");
    expect(group.hasActiveTool).toBe(false);
    expect(group.processing).toBe(false);
  });

  it("keeps a text-sealed burst processing while one of its tools runs", () => {
    const group = buildToolActivityGroups([
      assistantMessage([
        tool({ state: "running" }),
        { type: "text", text: "Partial result." },
      ]),
    ]).groups[0]!;

    expect(group.phase).toBe("sealed-by-text");
    expect(group.hasActiveTool).toBe(true);
    expect(group.processing).toBe(true);
  });

  it("deduplicates research delegations by analysis id", () => {
    const details = {
      analysisId: "analysis-1",
      tasks: [{ taskId: "task-1", status: "completed" }],
    };
    const messages = [
      assistantMessage([tool({ name: "research_delegate", details })]),
      assistantMessage([
        { type: "reasoning", text: "waiting for researchers" },
        tool({ name: "research_delegate", details }),
        tool({ name: "read" }),
      ]),
    ];
    const group = buildToolActivityGroups(messages).groups[0]!;

    expect(group.researchGroups).toHaveLength(1);
    expect(group.researchGroups[0]?.block.callId).toBe(group.tools[0]?.callId);
    expect(countRenderedUnits(group.tools)).toBe(2);
  });

  it("keeps a stable group id when earlier reasoning arrives during streaming", () => {
    const call = tool({ state: "running" });
    const initial = assistantMessage([call], {
      id: "streaming-message",
      status: "streaming",
    });
    const updated = {
      ...initial,
      blocks: [{ type: "reasoning" as const, text: "inspect" }, call],
    };

    expect(buildToolActivityGroups([updated]).groups[0]?.id).toBe(
      buildToolActivityGroups([initial]).groups[0]?.id,
    );
  });
});
