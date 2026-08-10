export type JsonSyntaxIssue = {
  line: number;
  column: number;
  message: string;
};

export function jsonSyntaxIssue(value: string): JsonSyntaxIssue | null {
  if (!value.trim()) return null;
  try {
    JSON.parse(value);
    return null;
  } catch (cause) {
    const rawMessage = cause instanceof Error ? cause.message : String(cause);
    const explicitLocation = rawMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    const positionMatch = rawMessage.match(/position\s+(\d+)/i);
    const position = positionMatch ? Math.max(0, Math.min(value.length, Number(positionMatch[1]))) : value.length;
    const prefix = value.slice(0, position);
    const line = explicitLocation ? Number(explicitLocation[1]) : prefix.split("\n").length;
    const lastBreak = prefix.lastIndexOf("\n");
    const column = explicitLocation ? Number(explicitLocation[2]) : position - lastBreak;
    const message = rawMessage
      .replace(/\s+in JSON at position\s+\d+(?:\s+\(line\s+\d+\s+column\s+\d+\))?\.?$/i, "")
      .replace(/\s+at line\s+\d+\s+column\s+\d+\.?$/i, "")
      .trim();
    return { line: Math.max(1, line), column: Math.max(1, column), message };
  }
}
