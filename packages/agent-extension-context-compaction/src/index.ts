import type { AgentExtension, AgentExtensionDefinition, AgentExtensionContext } from "@wordless/agent-extension-sdk";

const BASE_INSTRUCTIONS =
  "Produce a concise structured memory for the next Agent turn. Preserve user intent, decisions, completed work, unresolved blockers, relevant files or artifacts, and the next concrete action. Do not include conversational filler.";

export const contextCompactionExtension: AgentExtensionDefinition = {
  descriptor: {
    id: "wordless.context-compaction",
    version: "1",
    name: "Context compaction",
    description: "Automatically summarize long sessions before their context window is exhausted.",
    category: "workflow",
    builtin: true,
    defaultEnabled: false,
    supportedDriverIds: ["generic", "coding"],
  },
  create(context: AgentExtensionContext): AgentExtension {
    return {
      activate() {
        context.harness.on("session_before_compact", (event) => ({
          customInstructions: [BASE_INSTRUCTIONS, context.contextCompactionInstructions, event.customInstructions]
            .filter((instruction): instruction is string => typeof instruction === "string" && instruction.trim().length > 0)
            .join("\n\n"),
        }));
      },
      dispose() {},
    };
  },
};
