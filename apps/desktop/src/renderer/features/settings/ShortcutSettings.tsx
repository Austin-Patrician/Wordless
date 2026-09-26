import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  findShortcutConflict,
  isBindableShortcut,
  listShortcutBindings,
  type ShortcutActionId,
} from "@wordless/domain";
import { useDesktopHost } from "../../platform/desktop-host";
import type { MessageKey } from "../../shared/i18n";
import { usePreferences } from "../../shared/preferences";
import { formatShortcut, shortcutFromEvent, shortcutModifier } from "../../shared/shortcuts/keyboard";
import { suspendGlobalShortcuts } from "../../shared/shortcuts/use-global-shortcuts";

/**
 * Names for the actions in the shared table. A Record over the action union, so
 * adding an action to the table is a compile error until it has a label here.
 */
const actionCopy: Record<ShortcutActionId, { label: MessageKey; description: MessageKey }> = {
  "new-thread": { label: "shortcutNewThreadLabel", description: "shortcutNewThreadDescription" },
  // The view actions reuse the labels the sidebar already shows, so the two
  // lists stay worded the same.
  "open-conversation": { label: "shortcutOpenConversationLabel", description: "shortcutOpenConversationDescription" },
  "open-media": { label: "imageVideoGeneration", description: "shortcutOpenMediaDescription" },
  "open-automation": { label: "automations", description: "shortcutOpenAutomationDescription" },
  "open-tasks": { label: "tasks", description: "shortcutOpenTasksDescription" },
  "open-experts": { label: "digitalEmployees", description: "shortcutOpenExpertsDescription" },
  "open-skills": { label: "skillsMcp", description: "shortcutOpenSkillsDescription" },
  "find-in-conversation": { label: "shortcutFindLabel", description: "shortcutFindDescription" },
  "toggle-sidebar": { label: "shortcutToggleSidebarLabel", description: "shortcutToggleSidebarDescription" },
  "toggle-context-panel": { label: "shortcutToggleContextPanelLabel", description: "shortcutToggleContextPanelDescription" },
  "open-settings": { label: "shortcutOpenSettingsLabel", description: "shortcutOpenSettingsDescription" },
};

/**
 * Keyboard shortcut preferences.
 *
 * Every action in the shared table is listed with the key it answers to. A key
 * is captured by recording the next chord, which is validated before it is
 * stored: a combo that would shadow ordinary typing, or a key another action
 * already holds, is refused with the reason rather than saved and discovered
 * later.
 */
export function ShortcutSettings() {
  const { setShortcutBindings, shortcuts, t } = usePreferences();
  const { hostInfo } = useDesktopHost();
  const modifier = shortcutModifier(hostInfo?.platform);
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = listShortcutBindings(shortcuts.bindings);

  // While recording, the recorder owns the keyboard; see suspendGlobalShortcuts.
  useEffect(() => {
    if (!recording) return;
    suspendGlobalShortcuts(true);
    return () => suspendGlobalShortcuts(false);
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        setError(null);
        return;
      }
      const combo = shortcutFromEvent(event, modifier);
      // A bare modifier press is not a chord yet; keep waiting for the key.
      if (!combo) return;
      if (!isBindableShortcut(combo)) {
        setError(t("shortcutNeedsModifier").replace("{combo}", formatShortcut(combo, modifier)));
        return;
      }
      const conflict = findShortcutConflict(recording, combo, shortcuts.bindings);
      if (conflict) {
        const held = actionCopy[conflict];
        setError(t("shortcutInUse").replace("{action}", t(held.label)));
        return;
      }
      void setShortcutBindings({ ...shortcuts.bindings, [recording]: combo });
      setRecording(null);
      setError(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [modifier, recording, setShortcutBindings, shortcuts.bindings, t]);

  const customized = rows.filter((row) => !row.isDefault).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The hint and the reset action sit above the list, outside the scroll
          area. The hint says what a recording accepts and how to cancel one, and
          recording can start on any row, so it has to be readable without
          scrolling to the bottom first — which is exactly what living outside
          the scroll area guarantees. */}
      <div className="shrink-0 px-6 pt-6 sm:px-9">
        <div className="mx-auto max-w-[680px] space-y-2">
          {/* An error used to render in the same muted grey as the hint, so a
              rejected combination read as ordinary help text. */}
          <p className={`text-[12px] leading-5 ${error ? "text-destructive" : "text-[#73736d] dark:text-muted-foreground"}`}>
            {error ?? t("shortcutDefaultHint")}
          </p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">{t("shortcutCustomized").replace("{count}", String(customized))}</p>
            <Button disabled={customized === 0} onClick={() => void setShortcutBindings({})} size="sm" type="button" variant="ghost">
              <RotateCcw className="h-3.5 w-3.5" />
              {t("shortcutResetAll")}
            </Button>
          </div>
        </div>
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3 sm:px-9">
        <section className="mx-auto max-w-[680px] divide-y divide-[#e9e9e4] rounded-2xl bg-[#f7f7f5] px-4 dark:divide-border dark:bg-[#22241c]">
          {rows.map((row) => {
            const copy = actionCopy[row.id];
            const isRecording = recording === row.id;
            return (
              <div className="flex items-center justify-between gap-3 py-3" key={row.id}>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{t(copy.label)}</p>
                  <p className="mt-0.5 text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{t(copy.description)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    aria-label={t("shortcutRecord").replace("{action}", t(copy.label))}
                    className={`min-w-[112px] rounded-lg border px-3 py-1.5 text-[12px] font-medium tabular-nums ${isRecording ? "border-[#90a760] bg-white text-[#5f7737] dark:border-[#5f7737] dark:bg-[#181912] dark:text-[#c5e57b]" : "border-border bg-white text-foreground hover:border-[#c3cdb2] dark:bg-[#181912]"}`}
                    data-shortcut-action={row.id}
                    onClick={() => {
                      setError(null);
                      setRecording(isRecording ? null : row.id);
                    }}
                    type="button"
                  >
                    {isRecording ? t("shortcutRecording") : formatShortcut(row.shortcut, modifier)}
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("shortcutReset").replace("{action}", t(copy.label))}
                        className="text-muted-foreground"
                        disabled={row.isDefault}
                        onClick={() => void setShortcutBindings({ ...shortcuts.bindings, [row.id]: row.defaultShortcut })}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("shortcutReset")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </section>
      </section>
    </div>
  );
}
