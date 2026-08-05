import type { ConversationMessage, RuntimeEventEnvelope } from "@wordless/protocol";
import type { MessageToolBlock } from "@wordless/domain";

export const MODEL_RESPONSE_WAIT_DELAY_MS = 1_000;
export const COMMAND_PREPARATION_DELAY_MS = 600;

export type AssistantToolActivity =
  | "read"
  | "search"
  | "edit"
  | "write"
  | "command"
  | "delegate"
  | "skill"
  | "connector"
  | "tool";

export type AssistantRunActivity =
  | { type: "thinking"; since: number }
  | { type: "waiting"; since: number }
  | { type: "generating"; since: number }
  | { type: "tool"; tool: AssistantToolActivity; phase: "preparing" | "running"; since: number }
  | { type: "tool-result"; tool: AssistantToolActivity; outcome: "success" | "failure"; since: number }
  | { type: "awaiting-approval"; since: number }
  | { type: "awaiting-user-input"; since: number }
  | { type: "compacting-context"; since: number };

export type AssistantRunPresentation = {
  assistantMessageId: string | null;
  activity: AssistantRunActivity;
  runId: string | null;
  startedAt: number;
  userMessageId: string | null;
};

export type RunEventCursor = {
  runId: string | undefined;
  sequence: number;
};

export function createAssistantRunPresentation(userMessageId: string, startedAt: number): AssistantRunPresentation {
  return { assistantMessageId: null, activity: { type: "thinking", since: startedAt }, runId: null, startedAt, userMessageId };
}

function currentToolActivity(activity: AssistantRunActivity): AssistantToolActivity {
  return activity.type === "tool" || activity.type === "tool-result" ? activity.tool : "tool";
}

export function advanceAssistantRunPresentation(current: AssistantRunPresentation | null, event: RuntimeEventEnvelope): AssistantRunPresentation | null {
  if (!current) return null;
  if (event.turnId && current.userMessageId && event.turnId !== `turn:${current.userMessageId}`) return current;
  if (current.runId !== null && event.runId !== current.runId) return current;

  const at = event.timestamp;

  if (event.event.type === "run.started") {
    return current.runId === null ? { ...current, activity: { type: "thinking", since: at }, runId: event.runId ?? null } : current;
  }

  if (event.event.type === "message.started" && event.event.message.role === "assistant") {
    return { ...current, activity: { type: "thinking", since: at }, assistantMessageId: event.event.message.id, runId: event.runId ?? null };
  }

  if (event.event.type === "context.compaction.started") return { ...current, activity: { type: "compacting-context", since: at } };
  if (event.event.type === "context.compaction.completed" || event.event.type === "context.compaction.failed") return { ...current, activity: { type: "thinking", since: at } };
  if (event.event.type === "message.text.delta" && event.event.messageId === current.assistantMessageId) return { ...current, activity: { type: "generating", since: at } };
  if (event.event.type === "message.reasoning.delta" && event.event.messageId === current.assistantMessageId) return { ...current, activity: { type: "thinking", since: at } };
  if (event.event.type === "tool.started" && event.event.messageId === current.assistantMessageId) {
    const tool = assistantToolActivity(event.event.name);
    return { ...current, activity: { type: "tool", tool, phase: tool === "command" ? "preparing" : "running", since: at } };
  }
  if (event.event.type === "tool.updated" && event.event.messageId === current.assistantMessageId) {
    const currentTool = currentToolActivity(current.activity);
    return { ...current, activity: { type: "tool", tool: currentTool, phase: "running", since: at } };
  }
  if (event.event.type === "tool.completed" && event.event.messageId === current.assistantMessageId) {
    return {
      ...current,
      activity: {
        type: "tool-result",
        tool: currentToolActivity(current.activity),
        outcome: event.event.isError ? "failure" : "success",
        since: at,
      },
    };
  }
  if (event.event.type === "approval.requested" && event.event.messageId === current.assistantMessageId) return { ...current, activity: { type: "awaiting-approval", since: at } };
  if (event.event.type === "approval.resolved" && event.event.messageId === current.assistantMessageId) return { ...current, activity: { type: "thinking", since: at } };
  if (event.event.type === "user-request.requested" && event.event.messageId === current.assistantMessageId) return { ...current, activity: { type: "awaiting-user-input", since: at } };
  if (event.event.type === "user-request.resolved" && event.event.messageId === current.assistantMessageId) return { ...current, activity: { type: "thinking", since: at } };

  return current;
}

export function assistantRunActivityAt(activity: AssistantRunActivity, now: number): AssistantRunActivity {
  if (activity.type === "thinking" && now - activity.since >= MODEL_RESPONSE_WAIT_DELAY_MS) return { type: "waiting", since: activity.since };
  if (activity.type === "tool" && activity.tool === "command" && activity.phase === "preparing" && now - activity.since >= COMMAND_PREPARATION_DELAY_MS) {
    return { ...activity, phase: "running" };
  }
  return activity;
}

export function nextAssistantRunActivityUpdateAt(activity: AssistantRunActivity): number | undefined {
  if (activity.type === "thinking") return activity.since + MODEL_RESPONSE_WAIT_DELAY_MS;
  if (activity.type === "tool" && activity.tool === "command" && activity.phase === "preparing") return activity.since + COMMAND_PREPARATION_DELAY_MS;
  return undefined;
}

export function assistantToolActivity(toolName: string): AssistantToolActivity {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("delegate_task")) return "delegate";
  if (normalized.includes("load_skill")) return "skill";
  if (normalized.includes("connector")) return "connector";
  if (/(bash|shell|powershell|command|exec)/.test(normalized)) return "command";
  if (/(edit|replace|apply_patch|patch)/.test(normalized)) return "edit";
  if (/(write|create|save)/.test(normalized)) return "write";
  if (/(grep|search|find|glob)/.test(normalized)) return "search";
  if (/(read|list|directory|tree)/.test(normalized)) return "read";
  return "tool";
}

export function assistantRunPresentationFromMessages(messages: ConversationMessage[], startedAt: number): AssistantRunPresentation {
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    userIndex = index;
    break;
  }
  const user = userIndex === -1 ? undefined : messages[userIndex];
  const assistant = [...messages.slice(userIndex + 1)].reverse().find((message) => message.role === "assistant");
  const activeTool = assistant ? [...assistant.blocks].reverse().find((block): block is MessageToolBlock => block.type === "tool" && (block.state === "running" || block.state === "awaiting-approval" || block.state === "awaiting-user-input")) : undefined;
  const latestBlock = assistant?.blocks.at(-1);
  const completedTool = latestBlock?.type === "tool" && (latestBlock.state === "complete" || latestBlock.state === "error") ? latestBlock : undefined;
  const activity = activeTool?.state === "awaiting-approval"
    ? { type: "awaiting-approval" as const, since: startedAt }
    : activeTool?.state === "awaiting-user-input"
      ? { type: "awaiting-user-input" as const, since: startedAt }
      : activeTool ? { type: "tool" as const, tool: assistantToolActivity(activeTool.name), phase: "running" as const, since: startedAt }
        : completedTool
          ? { type: "tool-result" as const, tool: assistantToolActivity(completedTool.name), outcome: completedTool.state === "error" ? "failure" as const : "success" as const, since: startedAt }
          : { type: "thinking" as const, since: startedAt };
  return {
    assistantMessageId: assistant?.id ?? null,
    activity,
    runId: null,
    startedAt,
    userMessageId: user?.id ?? null,
  };
}

export function hasAssistantRunActivity(messages: ConversationMessage[], assistantMessageId: string | null): boolean {
  if (assistantMessageId === null) return false;
  return messages.find((message) => message.id === assistantMessageId)?.blocks.length !== 0;
}

export function mergeCompletedAssistantMessage(previous: ConversationMessage, completed: ConversationMessage): ConversationMessage {
  const previousTools = new Map(previous.blocks
    .filter((block): block is MessageToolBlock => block.type === "tool")
    .map((block) => [block.callId, block]));

  return {
    ...completed,
    blocks: completed.blocks.map((block) => {
      if (block.type !== "tool") return block;
      const prior = previousTools.get(block.callId);
      if (!prior) return block;
      return {
        ...block,
        input: block.input ?? prior.input,
        output: block.output ?? prior.output,
        details: block.details ?? prior.details,
        usage: block.usage ?? prior.usage,
        approval: block.approval ?? prior.approval,
        userRequest: block.userRequest ?? prior.userRequest,
      };
    }),
  };
}

export function isNewerRunEvent(event: RuntimeEventEnvelope, previous: RunEventCursor | undefined): boolean {
  if (previous === undefined) return true;
  if (event.runId === previous.runId) return event.sequence > previous.sequence;
  return event.event.type === "run.started" || event.event.type === "context.compaction.started";
}

export function runEventCursor(event: RuntimeEventEnvelope): RunEventCursor {
  return { runId: event.runId, sequence: event.sequence };
}

export function shouldRefreshSnapshotAfterEvent(event: RuntimeEventEnvelope): boolean {
  return event.event.type === "session.idle";
}
