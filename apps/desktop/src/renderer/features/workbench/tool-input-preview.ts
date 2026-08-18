const SENSITIVE_KEY =
  /(?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|session|token)/i;

const SUMMARY_KEYS = [
  "path",
  "pattern",
  "query",
  "command",
  "url",
  "name",
  "task",
] as const;

const MAX_DEPTH = 5;
const MAX_ENTRIES = 30;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 2_000;
const MAX_SUMMARY_LENGTH = 140;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}... [${value.length - limit} more characters]`;
}

function sanitize(
  value: unknown,
  key: string | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") return truncate(value, MAX_STRING_LENGTH);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[nested value omitted]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitize(item, undefined, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS)
      result.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
    return result;
  }
  const entries = Object.entries(value);
  const result = Object.fromEntries(
    entries
      .slice(0, MAX_ENTRIES)
      .map(([entryKey, entryValue]) => [
        entryKey,
        sanitize(entryValue, entryKey, depth + 1, seen),
      ]),
  );
  if (entries.length > MAX_ENTRIES)
    result["..."] = `[${entries.length - MAX_ENTRIES} more fields]`;
  return result;
}

export function safeToolInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return sanitize(input, undefined, 0, new WeakSet()) as Record<
    string,
    unknown
  >;
}

export function formatToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(safeToolInput(input), null, 2);
}

export function summarizeToolInput(
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;
  const key =
    SUMMARY_KEYS.find((candidate) => candidate in input) ??
    Object.keys(input).find((candidate) => {
      const value = input[candidate];
      return (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      );
    });
  if (!key) return undefined;
  const value = SENSITIVE_KEY.test(key) ? "[redacted]" : input[key];
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )
    return undefined;
  const text = truncate(String(value).replace(/\s+/g, " ").trim(), MAX_SUMMARY_LENGTH);
  return text ? `${key}: ${text}` : undefined;
}
