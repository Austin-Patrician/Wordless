import { isAbsolute, relative, resolve } from "node:path";
import { createHeadlessCodingTools } from "@wordless/coding-agent";
import { matchFileSecurityRules } from "@wordless/capability-filesystem";
import { matchCommandSecurityRules } from "@wordless/capability-shell";
import { createAgentHarnessDriver } from "@wordless/agent-driver-generic";
import type { AgentExtensionHostFactory } from "@wordless/agent-extension-sdk";
import type { AgentDriver, AgentDriverSessionContext, OperationApprovalDefinition, OperationPreflightDecision, SessionFileBaseline } from "@wordless/agent-driver-sdk";

function stringInput(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function truncatePreview(value: string): { value: string; truncated: boolean } {
  const maximum = 16_000;
  if (value.length <= maximum) return { value, truncated: false };
  return { value: `${value.slice(0, maximum)}\n... preview truncated ...`, truncated: true };
}

function updatePreview(before: string, oldText: string, newText: string): string {
  const bom = before.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? before.slice(1) : before;
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const normalizedSource = source.replace(/\r\n|\r/g, "\n");
  const normalizedOldText = oldText.replace(/\r\n|\r/g, "\n");
  const normalizedNewText = newText.replace(/\r\n|\r/g, "\n");
  const index = normalizedSource.indexOf(normalizedOldText);
  const next = index === -1 ? normalizedSource : `${normalizedSource.slice(0, index)}${normalizedNewText}${normalizedSource.slice(index + normalizedOldText.length)}`;
  return bom + (lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next);
}

function isWithinWorkspace(rootPath: string, candidatePath: string): boolean {
  const path = relative(rootPath, candidatePath);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function commandApproval(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
): OperationPreflightDecision {
  const command = stringInput(request.input, "command") ?? "";
  const matchedRules = matchCommandSecurityRules(command, context.security.commandRules);
  if (context.record.accessLevel === "full" && matchedRules.length === 0) return { type: "allow" };
  const timeout = request.input.timeout;
  return {
    type: "approval",
    approval: {
      risk: "command",
      severity: matchedRules.length > 0 ? "high" : "normal",
      matchedRules,
      summary: matchedRules.length > 0 ? "This command matches a security rule and requires confirmation." : "This command will run in the current workspace.",
      preview: {
        type: "command",
        command,
        cwd: context.record.runtimeRootPath,
        timeoutSeconds: typeof timeout === "number" ? timeout : undefined,
      },
    },
  };
}

async function fileOperation(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
): Promise<{ approval: OperationApprovalDefinition; baseline: SessionFileBaseline } | { block: string }> {
  const path = stringInput(request.input, "path") ?? "";
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(context.record.runtimeRootPath, path);
  if (context.record.accessLevel === "default" && !isWithinWorkspace(context.record.runtimeRootPath, absolutePath)) {
    return { block: "Default access only permits files inside the workspace" };
  }
  const current = await context.env.readTextFile(path);
  const before = current.ok ? current.value : "";
  let after: string;
  if (request.toolName === "write") {
    after = stringInput(request.input, "content") ?? "";
  } else {
    const oldText = stringInput(request.input, "oldText") ?? "";
    const newText = stringInput(request.input, "newText") ?? "";
    after = updatePreview(before, oldText, newText);
  }
  const beforePreview = truncatePreview(before);
  const afterPreview = truncatePreview(after);
  const matchedRules = matchFileSecurityRules(absolutePath, context.security.fileRules);
  const baseline: SessionFileBaseline = {
    path,
    existed: current.ok,
    content: current.ok || current.error.message.includes("not found") ? before : null,
  };
  return {
    approval: {
      risk: "file-write",
      severity: matchedRules.length > 0 ? "high" : "normal",
      matchedRules,
      summary: matchedRules.length > 0
        ? "This operation modifies a protected path and requires confirmation."
        : request.toolName === "write" ? "This operation will create or replace a local file." : "This operation will modify a local file.",
      preview: {
        type: "diff",
        path,
        before: beforePreview.value,
        after: afterPreview.value,
        truncated: beforePreview.truncated || afterPreview.truncated,
      },
      sessionFileBaseline: baseline,
    },
    baseline,
  };
}

async function preflightCodingOperation(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
): Promise<OperationPreflightDecision> {
  if (request.toolName === "bash") return commandApproval(context, request);
  if (request.toolName !== "write" && request.toolName !== "edit") return { type: "allow" };
  const result = await fileOperation(context, request);
  if ("block" in result) return { type: "block", reason: result.block };
  if (context.record.accessLevel === "full" && result.approval.matchedRules.length === 0) {
    return { type: "allow", sessionFileBaseline: result.baseline };
  }
  return { type: "approval", approval: result.approval };
}

export function createCodingAgentDriver(options: { createExtensionHost?: AgentExtensionHostFactory } = {}): AgentDriver {
  return createAgentHarnessDriver({
    id: "coding",
    features: ["steer", "follow-up", "thinking", "compact", "branch", "commands", "artifacts", "approval", "user-request"],
    createTools(context) {
      return createHeadlessCodingTools(context.env);
    },
    preflightOperation: preflightCodingOperation,
    createExtensionHost: options.createExtensionHost,
  });
}
