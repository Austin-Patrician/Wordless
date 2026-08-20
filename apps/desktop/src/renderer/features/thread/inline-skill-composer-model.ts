import type { UserPromptPart } from "@wordless/domain";

const MENTION_QUERY = String.raw`[^\s@$!\uFF01]*`;
export const WORKSPACE_MENTION_RE = new RegExp(`(?:^|\\s)@(${MENTION_QUERY})$`);
export const SKILL_MENTION_RE = new RegExp(`(?:^|\\s)\\$(${MENTION_QUERY})$`);
export const TASK_MENTION_RE = new RegExp(
  `(?:^|\\s)[!\\uFF01](${MENTION_QUERY})$`,
);
export const WORKSPACE_MENTION_STRIP_RE = new RegExp(
  `(?:^|\\s)@${MENTION_QUERY}$`,
);
export const SKILL_MENTION_STRIP_RE = new RegExp(
  `(?:^|\\s)\\$${MENTION_QUERY}$`,
);
export const TASK_MENTION_STRIP_RE = new RegExp(
  `(?:^|\\s)[!\\uFF01]${MENTION_QUERY}$`,
);

export type ComposerMentionKind = "skill" | "task" | "workspace";

export function mentionQueryAtEnd(
  text: string,
  kind: ComposerMentionKind,
): string | null {
  const match =
    kind === "workspace"
      ? WORKSPACE_MENTION_RE.exec(text)
      : kind === "skill"
        ? SKILL_MENTION_RE.exec(text)
        : TASK_MENTION_RE.exec(text);
  return match ? (match[1] ?? "") : null;
}

export function stripTrailingMentionStart(
  prefix: string,
  kind: ComposerMentionKind,
): number | null {
  const match =
    kind === "workspace"
      ? WORKSPACE_MENTION_STRIP_RE.exec(prefix)
      : kind === "skill"
        ? SKILL_MENTION_STRIP_RE.exec(prefix)
        : TASK_MENTION_STRIP_RE.exec(prefix);
  if (!match) return null;
  return (
    prefix.length - match[0].length + (match[0].startsWith(" ") ? 1 : 0)
  );
}

export function filterComposerInsertableTasks<
  T extends { status: string; title: string; updatedAt: number },
>(tasks: readonly T[], titleQuery: string): T[] {
  const query = titleQuery.trim().toLocaleLowerCase();
  return tasks
    .filter(
      (task) =>
        (task.status === "todo" || task.status === "in-progress") &&
        (query.length === 0 ||
          task.title.toLocaleLowerCase().includes(query)),
    )
    .sort((left, right) => {
      if (left.status !== right.status)
        return left.status === "in-progress" ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    });
}

function flattenPromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function inlineTaskDetailParts(
  parts: readonly UserPromptPart[],
): UserPromptPart[] {
  const inline: UserPromptPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      const text = flattenPromptText(part.text);
      if (text) inline.push({ type: "text", text });
      continue;
    }
    inline.push(part);
  }
  return inline.flatMap((part, index) =>
    index === 0 ? [part] : [{ type: "text", text: " " }, part],
  );
}

export function composerTaskPromptParts(
  task: {
    title: string;
    detailParts: readonly UserPromptPart[];
    expectedResult?: string;
  },
  labels: { title: string; details: string; expectedResult: string },
): UserPromptPart[] {
  const expected = task.expectedResult
    ? flattenPromptText(task.expectedResult)
    : "";
  return normalizeUserPromptParts([
    {
      type: "text",
      text: `${labels.title}: ${flattenPromptText(task.title)}. ${labels.details}: `,
    },
    ...inlineTaskDetailParts(task.detailParts),
    {
      type: "text",
      text: expected
        ? `. ${labels.expectedResult}: ${expected}.`
        : ".",
    },
  ]);
}

export function uniqueSkillIdsInDocumentOrder(skillIds: readonly string[]): string[] {
  const seen = new Set<string>();
  return skillIds.filter((skillId) => {
    if (seen.has(skillId)) return false;
    seen.add(skillId);
    return true;
  });
}

export function countSkillTokenOccurrences(skillIds: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const skillId of skillIds) counts[skillId] = (counts[skillId] ?? 0) + 1;
  return counts;
}

export function normalizeUserPromptParts(parts: readonly UserPromptPart[]): UserPromptPart[] {
  const normalized: UserPromptPart[] = [];
  for (const part of parts) {
    if (part.type === "skill-reference" || part.type === "workspace-reference" || part.type === "artifact-reference") {
      normalized.push(part);
      continue;
    }
    if (!part.text) continue;
    const previous = normalized.at(-1);
    if (previous?.type === "text") previous.text += part.text;
    else normalized.push({ type: "text", text: part.text });
  }
  return normalized;
}
