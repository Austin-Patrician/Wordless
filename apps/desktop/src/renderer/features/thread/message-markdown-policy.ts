const LANGUAGE_ALIASES: Record<string, string> = {
  cxx: "cpp",
  cs: "csharp",
  csharp: "csharp",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  mermaid: "mermaid",
  ps1: "powershell",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  mermaid: "Mermaid",
  plaintext: "Plain text",
  powershell: "PowerShell",
  python: "Python",
  rust: "Rust",
  sql: "SQL",
  typescript: "TypeScript",
  xml: "HTML / XML",
  yaml: "YAML",
};

export function normalizeCodeLanguage(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase().replace(/^language-/, "") ?? "";
  if (!normalized) return "plaintext";
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function codeLanguageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language.toUpperCase();
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeRemoteImageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function markdownUrlTransform(value: string, key: string): string | null {
  return key === "src" ? safeRemoteImageUrl(value) : safeExternalUrl(value);
}

export function hasClosedCodeFence(markdown: string, startOffset: number | undefined, endOffset: number | undefined): boolean {
  if (startOffset === undefined || endOffset === undefined) return false;
  const segment = markdown.slice(startOffset, endOffset);
  const lines = segment.split(/\r?\n/);
  const opening = lines[0]?.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!opening) return false;
  const marker = opening[1]!;
  const closingPattern = new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
  return lines.slice(1).some((line) => closingPattern.test(line));
}

export function isOversizedMermaid(source: string): boolean {
  return source.length > 20_000 || source.split(/\r?\n/).length > 300;
}
