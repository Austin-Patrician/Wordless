import type { ConversationMessage } from "@wordless/protocol";

type RenderedBoundaryKind = "tool" | "other" | undefined;

function renderedBoundaryKind(message: ConversationMessage, fromStart: boolean): RenderedBoundaryKind {
  const { blocks } = message;
  for (let offset = 0; offset < blocks.length; offset += 1) {
    const index = fromStart ? offset : blocks.length - offset - 1;
    const block = blocks[index]!;
    if (block.type === "tool") return "tool";
    if (block.type === "text") {
      if (block.text.trim().length > 0) return "other";
      continue;
    }
    if (block.type === "reasoning" || block.type === "artifact") return "other";
  }
  return undefined;
}

function hasResponseError(message: ConversationMessage): boolean {
  return message.status === "error" && Boolean(message.errorMessage);
}

/** Marks assistant messages whose leading tools visually continue the preceding message's tools. */
export function assistantToolSequenceContinuations(messages: readonly ConversationMessage[]): boolean[] {
  const continuations = new Array<boolean>(messages.length).fill(false);
  let previousEndsWithTool = false;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const startsWithTool = renderedBoundaryKind(message, true) === "tool";
    continuations[index] = index > 0 && previousEndsWithTool && startsWithTool;
    previousEndsWithTool = renderedBoundaryKind(message, false) === "tool" && !hasResponseError(message);
  }

  return continuations;
}
