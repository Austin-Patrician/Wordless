import { isAbsolute, relative, resolve } from "node:path";
import { matchFileSecurityRules } from "@wordless/capability-filesystem";
import { matchCommandSecurityRules } from "@wordless/capability-shell";
import type {
  AgentDriverSessionContext,
  OperationApprovalDefinition,
  OperationPreflightDecision,
  SessionFileBaseline,
} from "@wordless/agent-driver-sdk";

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
  const next = index === -1
    ? normalizedSource
    : `${normalizedSource.slice(0, index)}${normalizedNewText}${normalizedSource.slice(index + normalizedOldText.length)}`;
  return bom + (lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next);
}

function isWithinWorkspace(rootPath: string, candidatePath: string): boolean {
  const path = relative(rootPath, candidatePath);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

const PATH_INPUT_KEYS = new Set(["path", "paths", "sourcePath", "outputPath", "filePath", "directoryPath", "cwd"]);

const TRUSTED_SKILL_READ_TOOLS = new Set(["read", "ls", "find", "grep"]);

async function isTrustedSkillReadPath(context: AgentDriverSessionContext, candidatePath: string): Promise<boolean> {
  if (!context.trustedSkillReadRoots || context.trustedSkillReadRoots.size === 0) return false;
  if (typeof context.env.canonicalPath !== "function") return false;
  const candidate = await context.env.canonicalPath(candidatePath);
  if (!candidate.ok) return false;
  for (const rootPath of context.trustedSkillReadRoots) {
    const root = await context.env.canonicalPath(rootPath);
    if (root.ok && isWithinWorkspace(root.value, candidate.value)) return true;
  }
  return false;
}

async function externalPaths(
  context: AgentDriverSessionContext,
  input: Record<string, unknown>,
  trustedRead: boolean,
): Promise<string[]> {
  const paths = new Set<string>();
  const visit = async (value: unknown, key?: string): Promise<void> => {
    if (typeof value === "string" && key && PATH_INPUT_KEYS.has(key) && value.trim()) {
      const absolute = isAbsolute(value) ? resolve(value) : resolve(context.record.runtimeRootPath, value);
      if (!isWithinWorkspace(context.record.runtimeRootPath, absolute) && !(trustedRead && await isTrustedSkillReadPath(context, absolute))) {
        paths.add(absolute);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (key === "paths") {
        for (const entry of value) await visit(entry, "path");
      } else {
        for (const entry of value) await visit(entry);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) await visit(child, childKey);
  };
  await visit(input);
  return [...paths];
}

function externalOperation(toolName: string): "read" | "write" | "list" | "execute" {
  if (toolName === "write" || toolName === "edit" || /(?:create|write|edit|apply|publish|materialize)/i.test(toolName)) return "write";
  if (toolName === "ls" || toolName === "find" || toolName === "grep" || /(?:list|search|scan)/i.test(toolName)) return "list";
  if (toolName === "bash") return "execute";
  return "read";
}

function externalAccessApproval(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
  paths: string[],
): OperationPreflightDecision {
  return {
    type: "approval",
    approval: {
      risk: "workspace-access",
      severity: "high",
      matchedRules: [],
      requiresElevation: true,
      summary: "This operation needs one-time access to files outside the current workspace.",
      preview: {
        type: "external-access",
        paths,
        workspaceRoot: context.record.runtimeRootPath,
        operation: externalOperation(request.toolName),
      },
    },
  };
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
      summary: matchedRules.length > 0
        ? "This command matches a security rule and requires confirmation."
        : "This command will run in the current workspace.",
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
  const writeRoot = context.workspaceWriteRoot ?? context.record.runtimeRootPath;
  if (context.record.accessLevel === "default" && !isWithinWorkspace(writeRoot, absolutePath)) {
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
        : request.toolName === "write"
          ? "This operation will create or replace a local file."
          : "This operation will modify a local file.",
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

export async function preflightWorkspaceOperation(
  context: AgentDriverSessionContext,
  request: { toolName: string; input: Record<string, unknown> },
): Promise<OperationPreflightDecision> {
  if (request.toolName === "bash") return commandApproval(context, request);
  if (context.record.accessLevel === "default") {
    const paths = await externalPaths(context, request.input, TRUSTED_SKILL_READ_TOOLS.has(request.toolName));
    if (paths.length > 0) return externalAccessApproval(context, request, paths);
  }
  if (request.toolName === "data_materialize" || request.toolName === "data_publish") {
    if (context.record.accessLevel === "full") return { type: "allow" };
    const analysisId = stringInput(request.input, "analysisId") ?? "unknown";
    const action = request.toolName === "data_materialize"
      ? `Materialize ${stringInput(request.input, "sourcePath") ?? "data"} into analysis ${analysisId}`
      : `Publish analysis ${analysisId}`;
    return {
      type: "approval",
      approval: {
        risk: "file-write",
        severity: "normal",
        matchedRules: [],
        summary: request.toolName === "data_materialize"
          ? "This operation creates an intermediate dataset inside analysis-output."
          : "This operation validates and writes the final report inside analysis-output.",
        preview: { type: "command", command: action, cwd: context.record.runtimeRootPath, timeoutSeconds: undefined },
      },
    };
  }
  if (request.toolName !== "write" && request.toolName !== "edit") return { type: "allow" };
  const result = await fileOperation(context, request);
  if ("block" in result) return { type: "block", reason: result.block };
  if (context.record.accessLevel === "full" && result.approval.matchedRules.length === 0) {
    return { type: "allow", sessionFileBaseline: result.baseline };
  }
  return { type: "approval", approval: result.approval };
}
