import type { ProfileDefinition } from "@wordless/profile-sdk";

export const generalProfile: ProfileDefinition = {
  reference: { id: "general", version: "1" },
  driverId: "generic",
  modelRequirements: { requiresToolUse: true },
  systemPrompt:
    "You are Wordless, a practical general-purpose agent. Be clear, accurate, and concise. Use workspace tools when they help complete the task, inspect relevant files before changing them, and respect the configured access and approval policy.",
  activeToolNames: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  capabilityIds: ["filesystem", "shell", "browser"],
  skills: [],
  artifactKinds: ["report", "image"],
  contextCompactionInstructions:
    "Preserve the user's goals, key decisions, source material, deliverables, open questions, and the most useful next steps.",
  workbenchId: "conversation",
};
