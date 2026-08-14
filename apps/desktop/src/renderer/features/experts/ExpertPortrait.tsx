import researchAnalyst from "../../../icons/experts/research-analyst.svg";
import productStrategist from "../../../icons/experts/product-strategist.svg";
import contentStudio from "../../../icons/experts/content-studio.svg";
import type { ExpertPortrait as ExpertPortraitValue } from "@wordless/domain";
import { useMemo } from "react";
import { avataaarsDataUri } from "./avataaars-portrait";

const portraits: Record<string, string> = { "research-analyst": researchAnalyst, "product-strategist": productStrategist, "content-studio": contentStudio };

export function ExpertPortrait({ className = "h-9 w-9", name, portrait }: { className?: string; name: string; portrait: ExpertPortraitValue }) {
  const generatedSource = useMemo(
    () => {
      if (portrait.kind !== "avataaars") return undefined;
      try { return avataaarsDataUri(portrait.options); } catch { return undefined; }
    },
    [portrait],
  );
  const source = portrait.kind === "builtin" ? portraits[portrait.key] : generatedSource;
  return source ? <img alt={`${name} portrait`} className={`${className} shrink-0 rounded-full object-cover`} draggable={false} src={source} /> : <span aria-label={`${name} portrait`} className={`${className} grid shrink-0 place-items-center rounded-full bg-[#dfe9c5] text-[10px] font-bold text-[#52642e]`}>{name.slice(0, 1)}</span>;
}
