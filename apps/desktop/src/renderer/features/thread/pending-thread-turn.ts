import type { ConversationMessage, MessageBlock, UserMessageSubmission, UserPromptPart } from "@wordless/domain";

export type PendingThreadTurn = {
  message: ConversationMessage;
  submission: UserMessageSubmission;
};

export function createUserMessageSubmission(now = Date.now()): UserMessageSubmission {
  return { messageId: crypto.randomUUID(), submittedAt: now };
}

export function createPendingThreadTurn(
  parts: readonly UserPromptPart[],
  submission: UserMessageSubmission,
  attachments: readonly Pick<File, "name" | "type" | "size">[] = [],
): PendingThreadTurn {
  const blocks: MessageBlock[] = parts.map((part, index): MessageBlock => {
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "skill-reference") {
      return { type: "skill-reference", id: `${submission.messageId}:skill:${index}`, skillId: part.skillId, name: part.name, source: part.source };
    }
    if (part.type === "workspace-reference") {
      return { type: "workspace-reference", id: `${submission.messageId}:workspace:${index}`, path: part.path, name: part.name, kind: part.kind };
    }
    return { type: "artifact", artifactId: part.artifactId, kind: part.kind, name: part.name, revision: part.revision, surfaceId: part.surfaceId, locator: part.locator };
  });
  blocks.push(...attachments.map((attachment, index) => ({
    type: "attachment" as const,
    id: `${submission.messageId}:attachment:${index}`,
    name: attachment.name,
    mediaType: attachment.type || "application/octet-stream",
    size: attachment.size,
  })));
  return {
    submission,
    message: {
      id: submission.messageId,
      role: "user",
      status: "complete",
      blocks,
      model: null,
      timestamp: submission.submittedAt,
    },
  };
}
