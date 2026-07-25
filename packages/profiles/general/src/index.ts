import type { ProfileDefinition } from "@wordless/profile-sdk";

export const generalProfile: ProfileDefinition = {
  reference: { id: "general", version: "1" },
  driverId: "generic",
  modelRequirements: { requiresToolUse: false },
  systemPrompt:
    "You are Wordless, a practical general-purpose assistant. Be clear, accurate, and concise. Use the local workspace only when it is relevant to the task.",
  activeToolNames: [],
  capabilityIds: ["filesystem", "browser"],
  skills: [],
  artifactKinds: ["report", "image"],
  contextCompactionInstructions:
    "Preserve the user's goals, key decisions, source material, deliverables, open questions, and the most useful next steps.",
  workbenchId: "conversation",
};
