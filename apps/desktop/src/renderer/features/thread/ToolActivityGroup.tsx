import { Check, ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import type { ToolActivityGroup } from "./tool-activity-groups";

/**
 * A burst stays expanded for its whole live activity chain. Tool state updates
 * are deliberately not used as collapse triggers: between agent rounds a tool
 * can finish before the next reasoning/tool event arrives.
 */
export function useToolActivityGroupCollapseState(
  _groups: readonly ToolActivityGroup[],
): {
  isExpanded: (group: ToolActivityGroup) => boolean;
  toggle: (group: ToolActivityGroup) => void;
} {
  const [overrides, setOverrides] = useState(() => new Map<string, boolean>());

  const isExpanded = useCallback(
    (group: ToolActivityGroup) => {
      // Awaiting groups are always expanded: the pending approval must stay
      // visible, and toggle() is disabled while awaiting anyway.
      if (group.hasAwaiting) return true;
      const override = overrides.get(group.id);
      if (override !== undefined) return override;
      // Only a user-visible text response seals the preceding burst by
      // default. A tool that is still executing always remains expanded.
      return group.phase !== "sealed-by-text" || group.hasActiveTool;
    },
    [overrides],
  );

  const toggle = useCallback((group: ToolActivityGroup) => {
    if (group.hasAwaiting) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      const currentlyExpanded = prev.has(group.id)
        ? prev.get(group.id)!
        : group.phase !== "sealed-by-text" || group.hasActiveTool;
      next.set(group.id, !currentlyExpanded);
      return next;
    });
  }, []);

  return { isExpanded, toggle };
}

export function ToolActivityGroupHeader({
  expanded,
  group,
  onToggle,
}: {
  expanded: boolean;
  group: ToolActivityGroup;
  onToggle: (group: ToolActivityGroup) => void;
}) {
  const { t } = usePreferences();
  const label = (
    group.hasAwaiting
      ? t("threadGroupAwaiting")
      : group.processing
        ? t("threadGroupProcessing")
        : t("threadGroupProcessed")
  )
    .replaceAll("{count}", String(group.toolCount))
    .replaceAll("{rounds}", String(group.roundCount));
  return (
    <button
      aria-expanded={expanded}
      className="flex min-h-7 w-full cursor-pointer items-center gap-2 text-left select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-thread-search-exclude
      disabled={group.hasAwaiting}
      onClick={() => onToggle(group)}
      type="button"
    >
      {group.processing ? (
        <LoaderCircle
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 animate-spin text-[#89957a] dark:text-[#9aa88a]"
        />
      ) : group.hasAwaiting ? (
        <CircleAlert
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-[#ad7956] dark:text-[#d6a16d]"
        />
      ) : (
        <Check
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-[#6c8542] dark:text-[#93a878]"
        />
      )}
      <span
        className={`min-w-0 truncate text-[12px] font-medium ${
          group.processing
            ? "assistant-run-status-shimmer"
            : "text-[#777770] dark:text-muted-foreground"
        }`}
      >
        {label}
        {group.errorCount > 0 ? (
          <span className="text-[#ad7956] dark:text-[#d6a16d]">
            {" · "}
            {t("threadGroupErrors").replaceAll(
              "{count}",
              String(group.errorCount),
            )}
          </span>
        ) : null}
      </span>
      {group.hasAwaiting ? null : (
        <ChevronDown
          aria-hidden
          className={`h-3.5 w-3.5 shrink-0 text-[#89957a] transition-transform duration-150 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      )}
    </button>
  );
}
