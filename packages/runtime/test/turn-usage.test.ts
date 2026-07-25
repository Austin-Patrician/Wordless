import { describe, expect, it } from "vitest";
import { calculateCurrentTurnUsage, type ConversationMessage, type ConversationUsage } from "@wordless/domain";

const firstUsage: ConversationUsage = {
  inputTokens: 120,
  outputTokens: 30,
  cacheReadTokens: 40,
  cacheWriteTokens: 10,
  totalTokens: 200,
  totalCost: 0.002,
};

const secondUsage: ConversationUsage = {
  inputTokens: 80,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 100,
  totalCost: 0.001,
};

const subagentUsage: ConversationUsage = {
  inputTokens: 220,
  outputTokens: 60,
  cacheReadTokens: 100,
  cacheWriteTokens: 20,
  totalTokens: 400,
  totalCost: 0.004,
};

function message(id: string, role: ConversationMessage["role"], usage?: ConversationUsage): ConversationMessage {
  return {
    id,
    role,
    status: "complete",
    blocks: [],
    model: role === "assistant" ? { connectionId: "provider", modelId: "model" } : null,
    timestamp: 1,
    ...(usage ? { usage } : {}),
  };
}

describe("calculateCurrentTurnUsage", () => {
  it("only totals model calls after the latest user message and includes delegated tool usage", () => {
    const delegated = message("assistant-2", "assistant", secondUsage);
    delegated.blocks.push({ type: "tool", callId: "delegate-1", name: "delegate_task", state: "complete", usage: subagentUsage });

    const usage = calculateCurrentTurnUsage([
      message("user-1", "user"),
      message("assistant-1", "assistant", firstUsage),
      message("user-2", "user"),
      delegated,
    ]);

    expect(usage).toEqual({
      inputTokens: 300,
      outputTokens: 80,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      totalTokens: 500,
      totalCost: 0.005,
      primaryCallCount: 1,
      toolCallCount: 1,
    });
  });

  it("returns no usage until the current turn has a completed model call", () => {
    expect(calculateCurrentTurnUsage([message("user-1", "user")])).toBeUndefined();
  });
});
