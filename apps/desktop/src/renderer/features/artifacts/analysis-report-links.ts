export type AnalysisReportLink =
  | { kind: "anchor" }
  | { kind: "external"; url: string }
  | { kind: "output"; path: string }
  | { kind: "workspace"; path: string };

function normalizePath(initial: string[], value: string): string[] | null {
  const segments = [...initial];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments;
}

export function resolveAnalysisReportLink(href: string | undefined, outputRoot: string): AnalysisReportLink | null {
  const value = href?.trim();
  if (!value) return null;
  if (value.startsWith("#")) return { kind: "anchor" };
  if (/^(?:https?:|mailto:)/i.test(value)) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? { kind: "external", url: url.toString() } : null;
    } catch {
      return null;
    }
  }
  if (value.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;

  const rawPath = value.split(/[?#]/, 1)[0] ?? "";
  if (!rawPath || rawPath.startsWith("/") || rawPath.startsWith("\\")) return null;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const outputSegments = normalizePath([], outputRoot);
  if (!outputSegments) return null;
  const targetSegments = normalizePath(outputSegments, decodedPath);
  if (!targetSegments) return null;
  const workspacePath = targetSegments.join("/");
  const insideOutput = outputSegments.every((segment, index) => targetSegments[index] === segment);
  if (!insideOutput) return { kind: "workspace", path: workspacePath };
  return { kind: "output", path: targetSegments.slice(outputSegments.length).join("/") };
}
