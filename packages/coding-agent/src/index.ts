import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  executeShellWithCapture,
  truncateHead,
  truncateTail,
  type AgentTool,
  type AgentToolResult,
  type ExecutionEnv,
} from "@wordless/agent";
import type { WorkspaceSearchProvider } from "@wordless/workspace-search";
import { Type, type TSchema } from "typebox";

type ToolDetails = Record<string, unknown>;

const DEFAULT_BASH_TIMEOUT_SECONDS = 30;
const MAX_BASH_TIMEOUT_SECONDS = 600;

function textResult(text: string, details: ToolDetails = {}): AgentToolResult<ToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function defineTool<TParameters extends TSchema>(tool: AgentTool<TParameters, ToolDetails>): AgentTool<TParameters, ToolDetails> {
  // Keep the model-facing tool contract concise while retaining the full description for schema/UI consumers.
  const promptSnippet = tool.promptSnippet ?? tool.description.split(/(?<=[.!?])\s+/u, 1)[0]?.slice(0, 240);
  return promptSnippet ? { ...tool, promptSnippet } : tool;
}

function requireSuccess<T>(result: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function relativePath(path: string | undefined): string {
  return path && path.trim() ? path : ".";
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}

type LineEnding = "\r\n" | "\n";

function stripBom(value: string): { bom: string; text: string } {
  return value.startsWith("\uFEFF") ? { bom: "\uFEFF", text: value.slice(1) } : { bom: "", text: value };
}

function detectLineEnding(value: string): LineEnding {
  const crlfIndex = value.indexOf("\r\n");
  const lfIndex = value.indexOf("\n");
  return crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex) ? "\r\n" : "\n";
}

function normalizeToLf(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

function restoreLineEndings(value: string, lineEnding: LineEnding): string {
  return lineEnding === "\r\n" ? value.replace(/\n/g, "\r\n") : value;
}

function countOccurrences(value: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let index = value.indexOf(search);
  while (index !== -1) {
    count += 1;
    index = value.indexOf(search, index + search.length);
  }
  return count;
}

function boundedTextResult(text: string, details: ToolDetails = {}, direction: "head" | "tail" = "head"): AgentToolResult<ToolDetails> {
  const truncation = direction === "tail"
    ? truncateTail(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES })
    : truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const output = truncation.truncated
    ? `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines shown (${DEFAULT_MAX_BYTES / 1024}KB limit). Re-run with a narrower query or pagination.]`
    : truncation.content;
  return textResult(output, {
    ...details,
    ...(truncation.truncated ? { truncated: true, truncation: { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES, totalBytes: truncation.totalBytes, totalLines: truncation.totalLines, outputBytes: truncation.outputBytes, outputLines: truncation.outputLines } } : {}),
  });
}

export function createHeadlessCodingTools(env: ExecutionEnv, search?: WorkspaceSearchProvider) {
  const read = defineTool({
    name: "read",
    label: "Read file",
    description: "Read a UTF-8 text file from the workspace.",
    parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async execute(_id, input, signal) {
      const lines = requireSuccess(await env.readTextLines(input.path, { maxLines: input.limit === undefined ? undefined : input.offset === undefined ? input.limit : input.offset + input.limit, abortSignal: signal }));
      const selected = input.offset === undefined ? lines : lines.slice(input.offset, input.limit === undefined ? undefined : input.offset + input.limit);
      return boundedTextResult(selected.join("\n"), { path: input.path, lineCount: selected.length });
    },
  });
  const write = defineTool({
    name: "write",
    label: "Write file",
    description: "Create or replace a UTF-8 text file in the workspace.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    async execute(_id, input, signal) {
      const current = await env.readTextFile(input.path, signal);
      requireSuccess(await env.writeFile(input.path, input.content, signal));
      return textResult(`Wrote ${input.path}`, {
        path: input.path,
        bytes: new TextEncoder().encode(input.content).byteLength,
        change: {
          kind: current.ok ? "modified" : "created",
          additions: lineCount(input.content),
          deletions: current.ok ? lineCount(current.value) : 0,
        },
      });
    },
  });
  const edit = defineTool({
    name: "edit",
    label: "Edit file",
    description: "Replace one unique exact text occurrence in a workspace file. Matching normalizes line endings and preserves the source file's BOM and line-ending style.",
    parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String() }),
    async execute(_id, input, signal) {
      const rawContent = requireSuccess(await env.readTextFile(input.path, signal));
      const { bom, text: sourceContent } = stripBom(rawContent);
      const sourceLineEnding = detectLineEnding(sourceContent);
      const current = normalizeToLf(sourceContent);
      const oldText = normalizeToLf(input.oldText);
      const newText = normalizeToLf(input.newText);
      const occurrences = countOccurrences(current, oldText);
      if (occurrences === 0) throw new Error(`The requested text was not found in ${input.path}`);
      if (occurrences > 1) throw new Error(`The requested text occurs ${occurrences} times in ${input.path}. Provide a unique text block to edit.`);
      const index = current.indexOf(oldText);
      const next = `${current.slice(0, index)}${newText}${current.slice(index + oldText.length)}`;
      requireSuccess(await env.writeFile(input.path, `${bom}${restoreLineEndings(next, sourceLineEnding)}`, signal));
      return textResult(`Updated ${input.path}`, {
        path: input.path,
        diff: { oldText: input.oldText, newText: input.newText },
        change: { kind: "modified", additions: lineCount(input.newText), deletions: lineCount(input.oldText) },
      });
    },
  });
  const bash = defineTool({
    name: "bash",
    label: "Run command",
    description: `Run a shell command within the current workspace. Commands time out after ${DEFAULT_BASH_TIMEOUT_SECONDS} seconds by default. For an expected long-running command, set timeout explicitly up to ${MAX_BASH_TIMEOUT_SECONDS} seconds. If a command times out, narrow its scope first or retry it with a larger timeout.`,
    parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_BASH_TIMEOUT_SECONDS })) }),
    async execute(_id, input, signal, onUpdate) {
      const timeoutSeconds = input.timeout ?? DEFAULT_BASH_TIMEOUT_SECONDS;
      const startedAt = Date.now();
      const result = await executeShellWithCapture(env, input.command, {
        abortSignal: signal,
        timeout: timeoutSeconds,
        onChunk: (chunk) => onUpdate?.(textResult(chunk, { command: input.command, timeoutSeconds })),
      });
      if (!result.ok) {
        if (!("code" in result.error) || result.error.code !== "timeout") throw result.error;
        throw new Error(
          `Command timed out after ${timeoutSeconds} seconds.\n\nThis timeout is retryable. Narrow the command scope first, or call bash again with a larger explicit timeout (maximum ${MAX_BASH_TIMEOUT_SECONDS} seconds).`,
        );
      }
      const output = result.value.output;
      return textResult(output || `Command finished with exit code ${result.value.exitCode}`, {
        command: input.command,
        elapsedMs: Date.now() - startedAt,
        exitCode: result.value.exitCode,
        ...(result.value.truncated ? { truncated: true, fullOutputPath: result.value.fullOutputPath } : {}),
        timeoutSeconds,
      });
    },
  });
  const workspaceChanges = defineTool({
    name: "workspace_changes",
    label: "Inspect workspace changes",
    description: "Read the current Git working tree status and diff without modifying the workspace.",
    parameters: Type.Object({}),
    async execute(_id, _input, signal) {
      const result = requireSuccess(await env.exec("git status --short && git diff --no-ext-diff", { abortSignal: signal, timeout: 30 }));
      const output = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : "");
      return boundedTextResult(output || "No working tree changes", { command: "git status --short && git diff --no-ext-diff", exitCode: result.exitCode }, "tail");
    },
  });
  const ls = defineTool({
    name: "ls",
    label: "List files",
    description: "List files and directories in a workspace directory.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, input, signal) {
      const path = relativePath(input.path);
      const entries = requireSuccess(await env.listDir(path, signal));
      const output = entries.map((entry) => `${entry.kind === "directory" ? "d" : "f"} ${entry.name}`).join("\n");
      return boundedTextResult(output, { path, entries: entries.map((entry) => ({ name: entry.name, kind: entry.kind, path: entry.path })) });
    },
  });
  const find = defineTool({
    name: "find",
    label: "Find files",
    description: "Fuzzy-find files in the indexed workspace. Use cursor to continue a previous result page.",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String()),
      exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_id, input) {
      if (!search) throw new Error("Indexed workspace search is unavailable");
      if (input.path) requireSuccess(await env.listDir(input.path));
      const page = await search.find(input);
      const files = page.items.map((item) => item.path);
      return boundedTextResult(files.join("\n"), { path: relativePath(input.path), count: files.length, total: page.total, nextCursor: page.nextCursor });
    },
  });
  const grep = defineTool({
    name: "grep",
    label: "Search file contents",
    description: "Search indexed workspace file contents. Literal matching is the default; set literal to false for regular expressions.",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String()),
      exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
      ignoreCase: Type.Optional(Type.Boolean()),
      literal: Type.Optional(Type.Boolean()),
      context: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_id, input) {
      if (!search) throw new Error("Indexed workspace search is unavailable");
      if (input.path) requireSuccess(await env.listDir(input.path));
      const page = await search.grep(input);
      const matches = page.items.map((item) => {
        const before = item.contextBefore.map((line, index) => `${item.path}:${item.line - item.contextBefore.length + index}- ${line}`);
        const match = `${item.path}:${item.line}:${item.column}: ${item.text}`;
        const after = item.contextAfter.map((line, index) => `${item.path}:${item.line + index + 1}+ ${line}`);
        return [...before, match, ...after].join("\n");
      });
      return boundedTextResult(matches.join("\n--\n"), { path: relativePath(input.path), count: page.items.length, total: page.total, pattern: input.pattern, nextCursor: page.nextCursor });
    },
  });
  return [read, bash, edit, write, grep, find, ls, workspaceChanges];
}

export function createHeadlessReadOnlyTools(env: ExecutionEnv, search?: WorkspaceSearchProvider) {
  const allowed = new Set(["read", "grep", "find", "ls", "workspace_changes"]);
  return createHeadlessCodingTools(env, search).filter((tool) => allowed.has(tool.name));
}
