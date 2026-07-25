import type { UserPromptPart } from "@wordless/domain";

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
    if (part.type === "skill-reference") {
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
