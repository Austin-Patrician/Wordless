import { HoverCard, HoverCardContent, HoverCardTrigger, cn } from "@wordless/ui-kit";
import { useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { SessionTurnSummary } from "@wordless/protocol";

type ConversationDensityRailProps = {
  activeTurnId: string | null;
  fallbackExcerpt: string;
  navigationLabel: string;
  onNavigate: (turnId: string) => void;
  summaries: SessionTurnSummary[];
};

function densityThickness(tokens: number): number {
  return Math.min(2.5, Math.max(1.3, 1.15 + Math.log2(Math.max(1, tokens) + 1) * 0.12));
}

export function ConversationDensityRail({ activeTurnId, fallbackExcerpt, navigationLabel, onNavigate, summaries }: ConversationDensityRailProps) {
  const [open, setOpen] = useState(false);
  const listHeight = Math.min(244, Math.max(48, summaries.length * 40));
  if (summaries.length < 2) return null;

  return (
    <HoverCard closeDelay={140} onOpenChange={setOpen} open={open} openDelay={120}>
      <HoverCardTrigger asChild>
        <button aria-label={navigationLabel} className="absolute left-2 top-1/2 z-20 grid h-[clamp(96px,16vh,132px)] w-9 -translate-y-1/2 place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setOpen((current) => !current)} onFocus={() => setOpen(true)} type="button">
          <span aria-hidden className="relative h-full w-6">
            {summaries.map((item, index) => {
              const active = item.turnId === activeTurnId;
              const position = summaries.length === 1 ? 0.5 : index / (summaries.length - 1);
              return <span
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 -translate-y-1/2 transition-[width,height,background-color,opacity] duration-150",
                  "rounded-[1px] bg-[#a4a49d] dark:bg-[#8b9081]",
                  active && "z-10 bg-[#252624] opacity-100 dark:bg-[#e8efcf]",
                )}
                key={item.turnId}
                style={{ height: `${active ? Math.max(2, densityThickness(item.tokens)) : densityThickness(item.tokens)}px`, top: `${Math.min(1, Math.max(0, position)) * 100}%`, width: `${active ? 24 : 22}px` }}
              />;
            })}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="center" className="w-[280px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[8px] border-[#bcbdb7] p-0 shadow-[0_10px_24px_rgba(0,0,0,0.12)] dark:border-border" side="right">
        <Virtuoso
          data={summaries}
          style={{ height: listHeight }}
          itemContent={(_index, item) => {
              const active = item.turnId === activeTurnId;
              const excerpt = item.excerpt || fallbackExcerpt;
              const displayExcerpt = truncateExcerpt(excerpt, 15);
              return <div className="px-1.5 py-1" key={item.turnId}>
                <button
                  aria-current={active ? "location" : undefined}
                  className={cn("flex h-8 w-full items-center rounded-[5px] px-2 text-left text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-[#efefed] text-[#3f3f3a] dark:bg-muted dark:text-foreground" : "text-[#555550] hover:bg-[#f1f1ef] dark:text-muted-foreground dark:hover:bg-muted/60")}
                  onClick={() => { onNavigate(item.turnId); setOpen(false); }}
                  title={excerpt}
                  type="button"
                ><span className="min-w-0 truncate">{displayExcerpt}</span></button>
              </div>;
          }}
        />
      </HoverCardContent>
    </HoverCard>
  );
}

function truncateExcerpt(value: string, limit: number): string {
  const characters = Array.from(value);
  return characters.length > limit ? `${characters.slice(0, limit).join("")}...` : value;
}
