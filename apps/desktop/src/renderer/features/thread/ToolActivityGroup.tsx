import { Check, ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePreferences } from "../../shared/preferences";
import type { ToolActivityGroup } from "./tool-activity-groups";

const AUTO_COLLAPSE_DELAY_MS = 800;

function useElapsedTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function formatDuration(ms: number, templateSeconds: string, templateMinutesSeconds: string): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1_000));
  if (totalSeconds < 60)
    return templateSeconds.replaceAll("{count}", String(totalSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return templateMinutesSeconds
    .replaceAll("{minutes}", String(minutes))
    .replaceAll("{seconds}", String(seconds));
}

function groupElapsedMs(
  group: ToolActivityGroup,
  now: number,
): number | undefined {
  if (group.running && group.startedAt !== undefined)
    return Math.max(0, now - group.startedAt);
  if (group.startedAt !== undefined && group.completedAt !== undefined)
    return Math.max(0, group.completedAt - group.startedAt);
  const { firstMessageTimestamp, lastMessageTimestamp } = group;
  if (
    firstMessageTimestamp !== undefined &&
    lastMessageTimestamp !== undefined &&
    lastMessageTimestamp > firstMessageTimestamp
  )
    return lastMessageTimestamp - firstMessageTimestamp;
  return undefined;
}

/**
 * Collapse state for tool-activity groups: auto-expanded while running or
 * awaiting user interaction, auto-collapsed shortly after finishing, with a
 * user override that wins over the automatic behaviour.
 */
export function useToolActivityGroupCollapseState(
  groups: readonly ToolActivityGroup[],
): {
  isExpanded: (group: ToolActivityGroup) => boolean;
  toggle: (group: ToolActivityGroup) => void;
} {
  const [overrides, setOverrides] = useState(() => new Map<string, boolean>());
  const [settlingIds, setSettlingIds] = useState(() => new Set<string>());

  const activeIdsKey = useMemo(
    () =>
      groups
        .filter((group) => group.running || group.hasAwaiting)
        .map((group) => group.id)
        .join("|"),
    [groups],
  );
  const previouslyActiveRef = useRef<Set<string>>(new Set());
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  useEffect(() => {
    const activeIds = new Set(
      activeIdsKey.length > 0 ? activeIdsKey.split("|") : [],
    );
    const previous = previouslyActiveRef.current;
    previouslyActiveRef.current = activeIds;

    const started = [...activeIds].filter((id) => !previous.has(id));
    const finished = [...previous].filter((id) => !activeIds.has(id));

    if (started.length > 0) {
      // A re-activated group auto-expands again: drop any stale user override.
      setOverrides((prev) => {
        if (!started.some((id) => prev.has(id))) return prev;
        const next = new Map(prev);
        started.forEach((id) => next.delete(id));
        return next;
      });
    }
    if (finished.length === 0) return;

    setSettlingIds((prev) => {
      const next = new Set(prev);
      finished.forEach((id) => next.add(id));
      return next;
    });
    const timers = finished.map((id) =>
      window.setTimeout(() => {
        setOverrides((prev) => {
          if (prev.has(id)) return prev;
          const next = new Map(prev);
          next.set(id, false);
          return next;
        });
        setSettlingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, AUTO_COLLAPSE_DELAY_MS),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeIdsKey]);

  const isExpanded = useCallback(
    (group: ToolActivityGroup) => {
      const override = overrides.get(group.id);
      if (override !== undefined) return override;
      return (
        group.running || group.hasAwaiting || settlingIds.has(group.id)
      );
    },
    [overrides, settlingIds],
  );

  const toggle = useCallback(
    (group: ToolActivityGroup) => {
      if (group.hasAwaiting) return;
      setOverrides((prev) => {
        const next = new Map(prev);
        const currentlyExpanded = prev.has(group.id)
          ? prev.get(group.id)!
          : group.running ||
            group.hasAwaiting ||
            settlingIds.has(group.id);
        next.set(group.id, !currentlyExpanded);
        return next;
      });
      setSettlingIds((prev) => {
        if (!prev.has(group.id)) return prev;
        const next = new Set(prev);
        next.delete(group.id);
        return next;
      });
    },
    [settlingIds],
  );

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
  const now = useElapsedTick(group.running);
  const elapsedMs = groupElapsedMs(group, now);
  const label = group.hasAwaiting
    ? t("threadGroupAwaiting")
    : elapsedMs !== undefined
      ? t("threadGroupProcessed")
          .replaceAll("{duration}", formatDuration(elapsedMs, t("durationSeconds"), t("durationMinutesSeconds")))
          .replaceAll("{count}", String(group.toolCount))
      : t("threadGroupSteps").replaceAll("{count}", String(group.toolCount));
  return (
    <button
      aria-expanded={expanded}
      className="flex min-h-7 w-full cursor-pointer items-center gap-2 text-left select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-thread-search-exclude
      disabled={group.hasAwaiting}
      onClick={() => onToggle(group)}
      type="button"
    >
      {group.running ? (
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
          group.running
            ? "assistant-run-status-shimmer"
            : "text-[#777770] dark:text-muted-foreground"
        }`}
      >
        {label}
        {group.errorCount > 0 ? (
          <span className="text-[#ad7956] dark:text-[#d6a16d]">
            {" · "}
            {t("threadGroupErrors").replaceAll("{count}", String(group.errorCount))}
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
