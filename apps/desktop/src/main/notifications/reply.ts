import type { ConversationMessage } from "@wordless/domain";

/**
 * The agent's final answer for a session, for the `{{reply}}` variable.
 *
 * Only the last assistant message, and only its text blocks: reasoning and tool
 * traffic are not something a group chat wants, and a reply assembled from every
 * turn would be an unbounded concatenation of the whole conversation.
 *
 * Pure so the shape rules are testable; the caller supplies the messages.
 */
export function lastAssistantText(messages: readonly ConversationMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const joined = message.blocks
      .filter((block) => block.type === "text")
      .map((block) => ("text" in block ? block.text : ""))
      .join("")
      .trim();
    // An assistant turn that only called tools has nothing to say; stop at it rather
    // than reaching further back and reporting an earlier turn as the answer.
    return joined === "" ? undefined : joined;
  }
  return undefined;
}
