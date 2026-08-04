import type { ProfileDefinition } from "@wordless/profile-sdk";

export const dataProfile: ProfileDefinition = {
  reference: { id: "data", version: "1" },
  driverId: "generic",
  modelRequirements: { requiresToolUse: true },
  systemPrompt: "You are Wordless Data Analysis, a general-purpose workspace agent specialized in evidence-backed analysis of local structured data and source-grounded follow-up research. Treat source datasets as read-only. First establish what the local data proves. When the user's decision also requires explaining why, what may happen next, or what action to take, load the data-deep-research skill, propose one complete research plan, and wait for confirmation before using external sources. Never substitute model memory for missing web evidence. Use structured research tools for source snapshots and claims, then publish one unified validated report.",
  activeToolNames: ["read", "bash", "edit", "write", "grep", "find", "ls", "data_catalog", "data_inspect", "data_materialize", "data_validate", "data_publish", "research_prepare", "research_start", "research_snapshot", "research_submit_dimension", "research_review_dimension", "research_validate", "research_delegate"],
  capabilityIds: ["filesystem", "shell", "browser", "data"],
  defaultConnectorTemplateIds: ["web-search"],
  skills: [{ id: "data-analysis", source: "built-in" }, { id: "data-deep-research", source: "built-in" }],
  artifactKinds: ["report", "dataset", "chart"],
  contextCompactionInstructions: "Preserve the analysis objective, source paths and fingerprints, analysis ID and output directory, grain, measures, dimensions, joins, methods, assumptions, validation results, findings, chart paths, report status, research mode and status, confirmed research questions and dimensions, source ids and snapshot paths, claim-to-source mappings, reviews, unresolved conflicts, limitations, and the next reproducible action.",
  workbenchId: "analysis",
};
