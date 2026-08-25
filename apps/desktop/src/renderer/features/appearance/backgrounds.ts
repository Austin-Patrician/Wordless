import type { CSSProperties } from "react";
import type { BackgroundFit, BackgroundSource, BuiltinBackgroundId } from "@wordless/domain";

export type BuiltinBackgroundDefinition = {
  id: BuiltinBackgroundId;
  nameKey: "backgroundPaper" | "backgroundMicroDots" | "backgroundFineGrid";
};

export const builtinBackgrounds: BuiltinBackgroundDefinition[] = [
  { id: "paper", nameKey: "backgroundPaper" },
  { id: "micro-dots", nameKey: "backgroundMicroDots" },
  { id: "fine-grid", nameKey: "backgroundFineGrid" },
];

export function backgroundAssetUrl(assetId: string): string {
  return `wordless-appearance://background/${encodeURIComponent(assetId)}`;
}

export function backgroundIsAnimated(source: BackgroundSource): boolean {
  return source.kind === "custom" && source.animated === true;
}

export function backgroundRenderSource(source: BackgroundSource, reduceMotion: boolean): BackgroundSource {
  if (source.kind !== "custom" || !source.animated || !reduceMotion || !source.posterAssetId)
    return source;
  return { kind: "custom", assetId: source.posterAssetId };
}

function customBackgroundStyle(assetId: string, fit: BackgroundFit, position: { x: number; y: number }): CSSProperties {
  return {
    backgroundImage: `url("${backgroundAssetUrl(assetId)}")`,
    backgroundPosition: `${position.x}% ${position.y}%`,
    backgroundRepeat: fit === "tile" ? "repeat" : "no-repeat",
    backgroundSize: fit === "tile" ? "auto" : fit,
  };
}

function builtinBackgroundStyle(id: BuiltinBackgroundId): CSSProperties {
  if (id === "paper") {
    return {
      backgroundImage: "radial-gradient(circle at 1px 1px, var(--wordless-background-grain) 0.65px, transparent 0.75px), linear-gradient(115deg, transparent 24%, var(--wordless-background-fiber) 25%, transparent 26%)",
      backgroundPosition: "0 0, 0 0",
      backgroundRepeat: "repeat",
      backgroundSize: "15px 15px, 37px 37px",
    };
  }
  if (id === "micro-dots") {
    return {
      backgroundImage: "radial-gradient(circle at 1px 1px, var(--wordless-background-pattern-ink) 0.75px, transparent 0.85px)",
      backgroundPosition: "0 0",
      backgroundRepeat: "repeat",
      backgroundSize: "18px 18px",
    };
  }
  return {
    backgroundImage: "linear-gradient(var(--wordless-background-pattern-ink) 1px, transparent 1px), linear-gradient(90deg, var(--wordless-background-pattern-ink) 1px, transparent 1px)",
    backgroundPosition: "0 0",
    backgroundRepeat: "repeat",
    backgroundSize: "26px 26px",
  };
}

export function backgroundPreviewStyle(source: BackgroundSource, fit: BackgroundFit, position: { x: number; y: number }): CSSProperties {
  if (source.kind === "none") return {};
  if (source.kind === "builtin") return builtinBackgroundStyle(source.id);
  return customBackgroundStyle(source.assetId, fit, position);
}
