import type { SessionTurnUsage } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";

function formatTokenCount(value: number): string {
  if (value < 1_000) return Math.round(value).toLocaleString();
  const compact = Math.round((value / 1_000) * 10) / 10;
  return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}K`;
}

export function TurnTokenUsageRow({ usage }: { usage?: SessionTurnUsage }) {
  const { t } = usePreferences();
  if (!usage) return null;
  const metrics = [
    [t("turnTokenInput"), formatTokenCount(usage.inputTokens), "text-[#47806f] dark:text-[#9fd0bd]"],
    [t("turnTokenOutput"), formatTokenCount(usage.outputTokens), "text-[#7254ae] dark:text-[#c6b0ee]"],
    [t("turnTokenCacheRead"), formatTokenCount(usage.cacheReadTokens), "text-[#397a9d] dark:text-[#9ccce2]"],
    [t("turnTokenCacheWrite"), formatTokenCount(usage.cacheWriteTokens), "text-[#9b722c] dark:text-[#e4c17a]"],
    [t("turnTokenTotal"), formatTokenCount(usage.totalTokens), "text-[#5b5b55] dark:text-foreground"],
    [t("turnTokenCost"), `$${usage.totalCost.toFixed(4)}`, "text-[#9b6344] dark:text-[#e3b092]"],
  ] as const;
  return <div aria-label={t("turnTokenUsage")} className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden px-0.5 font-mono text-[9px] leading-4">{metrics.map(([label, value, color], index) => <span className="flex shrink-0 items-center gap-1.5" key={label}>{index > 0 ? <span aria-hidden className="text-[#c2c2bb] dark:text-[#5e6057]">·</span> : null}<span className={color}>{label} <span className={index === 4 ? "font-semibold" : "font-medium"}>{value}</span></span></span>)}</div>;
}
