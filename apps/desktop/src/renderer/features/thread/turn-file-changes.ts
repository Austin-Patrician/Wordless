import type { ConversationMessage, MessageToolBlock } from "@wordless/domain";

export const VISIBLE_TURN_FILE_CHANGE_LIMIT = 4;

export type TurnFileChangeKind = "created" | "modified";

export type TurnFileChange = {
  path: string;
  name: string;
  kind: TurnFileChangeKind;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function fileName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? path : normalized.slice(index + 1) || path;
}

function completedWrite(block: ConversationMessage["blocks"][number]): MessageToolBlock | undefined {
  if (block.type !== "tool") return undefined;
  if (block.name !== "write" && block.name !== "edit") return undefined;
  if (block.state !== "complete") return undefined;
  return block;
}

function changeFromTool(block: MessageToolBlock): TurnFileChange | undefined {
  const details = asRecord(block.details);
  if (!details) return undefined;
  const path = typeof details.path === "string" ? details.path.trim() : "";
  if (!path) return undefined;
  const change = asRecord(details.change);
  const kind: TurnFileChangeKind =
    change?.kind === "created" || change?.kind === "modified" ? change.kind : "modified";
  return { path, name: fileName(path), kind };
}

export function turnFileChanges(messages: readonly ConversationMessage[]): TurnFileChange[] {
  const changes = new Map<string, TurnFileChange>();
  for (const message of messages) {
    for (const block of message.blocks) {
      const tool = completedWrite(block);
      if (!tool) continue;
      const change = changeFromTool(tool);
      if (!change) continue;
      const existing = changes.get(change.path);
      changes.set(change.path, {
        ...change,
        kind: existing?.kind === "created" || change.kind === "created" ? "created" : "modified",
      });
    }
  }
  return [...changes.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function visibleTurnFileChanges(changes: readonly TurnFileChange[]): {
  hiddenCount: number;
  visible: TurnFileChange[];
} {
  if (changes.length <= VISIBLE_TURN_FILE_CHANGE_LIMIT) {
    return { hiddenCount: 0, visible: [...changes] };
  }
  return {
    hiddenCount: changes.length - VISIBLE_TURN_FILE_CHANGE_LIMIT,
    visible: changes.slice(0, VISIBLE_TURN_FILE_CHANGE_LIMIT),
  };
}
