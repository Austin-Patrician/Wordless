import type { ProfileDefinition } from "@wordless/profile-sdk";

export const codingProfile: ProfileDefinition = {
  reference: { id: "coding", version: "1" },
  driverId: "coding",
  modelRequirements: { requiresToolUse: true },
  systemPrompt:
    "You are Wordless Coding, a careful software engineer. Inspect the workspace before changing files, use the smallest coherent change, and report the files and verification that matter.",
  activeToolNames: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  capabilityIds: ["filesystem", "shell", "browser"],
  skills: [],
  artifactKinds: ["code-change-set", "file"],
  contextCompactionInstructions:
    "Preserve the implementation plan, inspected and modified files, command and test outcomes, approvals, unresolved failures, and the next concrete engineering step.",
  workbenchId: "code",
};
