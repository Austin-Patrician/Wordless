import { projectUserMessageContent } from "@wordless/agent-driver-sdk";

export function sessionTitleFromPrompt(prompt: string): string {
  const visibleContent = projectUserMessageContent(prompt).flatMap((block) => {
    if (block.type === "text") return [block.text];
    if (block.type === "skill-reference" || block.type === "workspace-reference" || block.type === "attachment" || block.type === "artifact") return [block.name];
    return [];
  }).join(" ").replace(/\s+/g, " ").trim();
  return visibleContent.length > 54 ? `${visibleContent.slice(0, 53)}...` : visibleContent || "New task";
}
