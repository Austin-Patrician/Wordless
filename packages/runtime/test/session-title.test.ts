import { describe, expect, it } from "vitest";
import { formatPromptWithSkillReferences } from "@wordless/agent-driver-sdk";
import { sessionTitleFromPrompt } from "../src/session-title.ts";

describe("sessionTitleFromPrompt", () => {
  it("uses visible text and workspace reference names instead of internal markers", () => {
    const prompt = formatPromptWithSkillReferences([
      { type: "workspace-reference", path: "reports/sales.xlsx", name: "sales.xlsx", kind: "file" },
      { type: "text", text: " Analyze the quarterly trend" },
    ]);

    expect(sessionTitleFromPrompt(prompt)).toBe("sales.xlsx Analyze the quarterly trend");
    expect(sessionTitleFromPrompt(prompt)).not.toContain("wordless-workspace-reference");
  });

  it("uses the referenced file name when the prompt has no visible text", () => {
    const prompt = formatPromptWithSkillReferences([
      { type: "workspace-reference", path: "reports/sales.xlsx", name: "sales.xlsx", kind: "file" },
    ]);

    expect(sessionTitleFromPrompt(prompt)).toBe("sales.xlsx");
  });
});
