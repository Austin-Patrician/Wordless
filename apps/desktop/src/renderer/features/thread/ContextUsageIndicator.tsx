import { HoverCard, HoverCardContent, HoverCardTrigger } from "@wordless/ui-kit";
import { X } from "lucide-react";
import { useState } from "react";
import type { SessionContextUsage, SessionContextUsageCategories } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";

type ContextUsageIndicatorProps = {
  contextUsage?: SessionContextUsage;
  draftMessage: string;
  draftSkillTokens: number;
};

type ContextCategory = {
  color: string;
  id: keyof SessionContextUsageCategories;
  label: string;
  tokens: number;
};

function estimateDraftTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return Math.round(tokens).toLocaleString();
  const compact = Math.round((tokens / 1_000) * 10) / 10;
  return `${Number.isInteger(compact) ? compact.toFixed(0) : compact.toFixed(1)}K`;
}

export function ContextUsageIndicator({ contextUsage, draftMessage, draftSkillTokens }: ContextUsageIndicatorProps) {
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  if (!contextUsage || contextUsage.contextWindow <= 0) return null;

  const draftMessageTokens = estimateDraftTokens(draftMessage);
  const categories: ContextCategory[] = [
    { id: "systemPrompt", label: t("contextSystemPrompt"), color: "#20b896", tokens: contextUsage.categories.systemPrompt },
    { id: "toolsAndSubagents", label: t("contextToolsAndSubagents"), color: "#e8b45d", tokens: contextUsage.categories.toolsAndSubagents },
    { id: "conversation", label: t("contextConversationMessages"), color: "#8a5cf4", tokens: contextUsage.categories.conversation + draftMessageTokens },
    { id: "connectors", label: t("contextConnectors"), color: "#36bdd0", tokens: contextUsage.categories.connectors },
    { id: "skills", label: t("contextSkills"), color: "#547ee8", tokens: contextUsage.categories.skills + draftSkillTokens },
  ];
  const usedTokens = contextUsage.usedTokens + draftMessageTokens + draftSkillTokens;
  const percentage = Math.min(100, (usedTokens / contextUsage.contextWindow) * 100);
  const remainder = Math.max(0, contextUsage.contextWindow - usedTokens);
  const ringStyle = { background: `conic-gradient(#7d94b2 ${percentage * 3.6}deg, #e5e6e2 0deg)` };

  return (
    <HoverCard closeDelay={140} onOpenChange={setOpen} open={open} openDelay={100}>
      <HoverCardTrigger asChild>
        <button aria-label={t("contextUsage")} className="grid h-7 w-7 place-items-center rounded-full outline-none transition-colors hover:bg-[#f0f0ed] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-muted" onClick={() => setOpen((current) => !current)} onFocus={() => setOpen(true)} type="button">
          <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full p-[2px]" style={ringStyle}><span className="h-full w-full rounded-full bg-[#fbfbfa] dark:bg-[#1c1d18]" /></span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-[300px] max-w-[calc(100vw-2rem)] rounded-[14px] border-[#deded9] p-0 shadow-[0_10px_26px_rgba(0,0,0,0.11)] dark:border-border" side="top">
        <section className="p-3">
          <header className="flex items-center justify-between gap-3"><h2 className="text-[12px] font-semibold text-[#353532] dark:text-foreground">{t("contextUsage")}</h2><button aria-label={t("closeContextUsage")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#595954] hover:bg-[#f0f0ed] dark:text-muted-foreground dark:hover:bg-muted" onClick={() => setOpen(false)} type="button"><X className="h-3.5 w-3.5" /></button></header>
          <div className="mt-2 flex items-baseline gap-1.5"><span className="font-mono text-[20px] font-semibold text-[#1d1e1b] dark:text-foreground">{percentage.toFixed(1)}%</span><span className="text-[10px] text-[#7c7c75] dark:text-muted-foreground">{t("contextUsed")} {formatTokens(usedTokens)} / {formatTokens(contextUsage.contextWindow)}</span></div>
          <div aria-hidden className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[#e7e7e3] dark:bg-muted">
            {categories.filter((category) => category.tokens > 0).map((category) => <span key={category.id} style={{ backgroundColor: category.color, flexGrow: category.tokens }} />)}
            {remainder > 0 ? <span className="bg-[#e7e7e3] dark:bg-muted" style={{ flexGrow: remainder }} /> : null}
          </div>
          <div className="mt-3 space-y-1.5">
            {categories.map((category) => <div className="flex items-center gap-1.5 text-[11px]" key={category.id}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} /><span className="min-w-0 flex-1 text-[#454540] dark:text-foreground">{category.label}</span><span className="font-mono text-[10px] text-[#7d7d76] dark:text-muted-foreground">~{formatTokens(category.tokens)}</span></div>)}
          </div>
        </section>
      </HoverCardContent>
    </HoverCard>
  );
}
