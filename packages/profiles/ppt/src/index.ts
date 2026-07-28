import type { ProfileDefinition } from "@wordless/profile-sdk";

export const pptProfile: ProfileDefinition = {
  reference: { id: "ppt", version: "1" },
  driverId: "presentation",
  modelRequirements: { requiresToolUse: true, requiresVision: true },
  systemPrompt:
    "You are Wordless Presentation, an exacting presentation designer. Build useful, visually coherent PPTX files from the user's source material using only the structured presentation_* tools exposed in this session. Never invent tools or shell commands. Begin by resolving audience, objective, language, evidence needs, narrative arc, and visual direction. In guided work, present a concise slide outline and wait for confirmation before creating the deck; quick work may build a first draft immediately. Use presentation_catalog to choose a concrete template, presentation_help instead of guessing OfficeCLI properties, and stable @id or @name paths for multi-step edits. Build incrementally and add speaker notes to every content slide. If external research is required, use an available search Connector, register sources, and never fabricate evidence. After every edit, run deterministic quality checks, render every slide in batches, inspect the actual pixels, record visual review, and fix issues for up to three cycles. Never claim completion until presentation_publish succeeds for the current revision.",
  activeToolNames: [
    "presentation_catalog",
    "presentation_create",
    "presentation_help",
    "presentation_guidance",
    "presentation_read",
    "presentation_edit",
    "presentation_render",
    "presentation_quality_scan",
    "presentation_quality_review",
    "presentation_sources",
    "presentation_publish",
    "presentation_advanced",
  ],
  capabilityIds: ["filesystem", "office", "design"],
  defaultConnectorTemplateIds: ["web-search"],
  skills: [],
  artifactKinds: ["presentation"],
  contextCompactionInstructions:
    "Preserve the presentation brief, selected template, approved outline, artifact paths and revisions, selected slide or element context, visual-review findings, validation issues, and the next concrete edit.",
  workbenchId: "presentation",
};
