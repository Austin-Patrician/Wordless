import { Check, Copy, LoaderCircle, RefreshCw, Settings2, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from "@wordless/ui-kit";
import { usePreferences } from "../../shared/preferences";
import type { TranslationEntry } from "./translation-context";
import { TRANSLATION_LANGUAGES, translationLanguageLabel } from "./translation-language";

const COPY_FEEDBACK_MS = 1_200;

/** Shared icon-button styling for the panel header. */
const ACTION_CLASS = "grid h-7 w-7 place-items-center rounded-[6px] text-[#74746d] transition-colors hover:bg-[#ecece8] hover:text-[#343430] disabled:cursor-not-allowed disabled:opacity-40 dark:text-muted-foreground dark:hover:bg-[#34362f] dark:hover:text-foreground";
/** The stop control reads as destructive while a request is streaming. */
const STOP_CLASS = "grid h-7 w-7 place-items-center rounded-[6px] text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300";

function PanelAction({ disabled, label, onClick, className = ACTION_CLASS, children }: { disabled?: boolean; label: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button aria-label={label} className={className} disabled={disabled} onClick={onClick} type="button">
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function statusLabel(entry: TranslationEntry, t: (key: "translationRunning" | "translationStopped" | "translationFailed") => string): string | null {
  if (entry.status === "running") return t("translationRunning");
  if (entry.status === "aborted") return t("translationStopped");
  if (entry.status === "error") return t("translationFailed");
  return null;
}

/**
 * Panel presentation of selection translations.
 *
 * Longer selections cannot be read comfortably in a floating bubble, so they
 * land here instead. The language options sit above the text so the active
 * language is obvious before the original and its translation are read, and the
 * session list at the bottom doubles as history: it shows the language, the
 * time, and the state of every translation made in this session.
 */
export function TranslationsPanel({ activeId, entries, onClear, onOpenSettings, onRetranslate, onSelect, onStop }: {
  activeId: string | null;
  entries: TranslationEntry[];
  onClear: () => void;
  onOpenSettings: () => void;
  onRetranslate: (entryId: string, language: string) => void;
  onSelect: (entryId: string) => void;
  onStop: (entryId: string) => void;
}) {
  const { locale, t } = usePreferences();
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const active = entries.find((entry) => entry.id === activeId) ?? entries[0];

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
  }, []);

  if (!active) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-[11px] leading-5 text-muted-foreground">
        <div>
          <p>{t("translationEmpty")}</p>
          <Button className="mt-3" onClick={onOpenSettings} size="sm" type="button" variant="outline">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            {t("translationOpenSettings")}
          </Button>
        </div>
      </div>
    );
  }

  const running = active.status === "running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-9 shrink-0 items-center justify-end gap-0.5 border-b border-border px-2">
        {running ? (
          <PanelAction className={STOP_CLASS} label={t("translationStop")} onClick={() => onStop(active.id)}>
            <Square className="h-3 w-3" />
          </PanelAction>
        ) : (
          <PanelAction label={t("translationRetry")} onClick={() => onRetranslate(active.id, active.language)}>
            <RefreshCw className="h-3 w-3" />
          </PanelAction>
        )}
        <PanelAction
          disabled={!active.text}
          label={t("translationCopy")}
          onClick={() => {
            void navigator.clipboard.writeText(active.text);
            setCopied(active.id);
            if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
            copiedTimer.current = window.setTimeout(() => setCopied(null), COPY_FEEDBACK_MS);
          }}
        >
          {copied === active.id ? <Check className="h-3 w-3 text-[#66833d]" /> : <Copy className="h-3 w-3" />}
        </PanelAction>
        <PanelAction label={t("translationClear")} onClick={onClear}>
          <Trash2 className="h-3 w-3" />
        </PanelAction>
        <PanelAction label={t("translationOpenSettings")} onClick={onOpenSettings}>
          <Settings2 className="h-3 w-3" />
        </PanelAction>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div aria-label={t("translationTargetLanguage")} className="flex flex-wrap gap-1" role="group">
          {TRANSLATION_LANGUAGES.map((language) => (
            <button
              aria-pressed={language.id === active.language}
              className={cn(
                "h-6 rounded-[5px] border px-1.5 text-[10px] transition-colors",
                language.id === active.language
                  ? "border-[#aebd87] bg-[#eef3e2] font-semibold text-[#4e6238] dark:border-[#5d6f43] dark:bg-[#2f3a22] dark:text-[#cbe49e]"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
              key={language.id}
              onClick={() => onRetranslate(active.id, language.id)}
              type="button"
            >
              {language.label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("translationOriginal")}</p>
        <p className="mt-1 whitespace-pre-wrap break-words rounded-[6px] bg-muted/40 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">{active.source}</p>

        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("translationResult")}</p>
        <div aria-live="polite" className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-6 text-foreground">
          {active.text ? active.text : active.status === "error" ? <span className="text-destructive">{active.error ?? t("translationFailed")}</span> : active.status === "aborted" ? <span className="text-muted-foreground">{t("translationStopped")}</span> : <span className="flex items-center gap-2 text-[11px] text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{`${t("translationRunning")}${translationLanguageLabel(active.language)}`}</span>}
        </div>
      </div>

      {entries.length > 0 ? (
        <div className="max-h-44 shrink-0 overflow-y-auto border-t border-border">
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("translationHistory")}</p>
          <ul className="pb-1.5">
            {entries.map((entry) => {
              const status = statusLabel(entry, t);
              const current = entry.id === active.id;
              return (
                <li key={entry.id}>
                  <button
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-l-2 py-1.5 pl-2.5 pr-3 text-left transition-colors",
                      current ? "border-l-[#8aa05e] bg-muted" : "border-l-transparent hover:bg-muted/60",
                    )}
                    onClick={() => onSelect(entry.id)}
                    type="button"
                  >
                    <span className="flex items-center gap-1.5 text-[10px] leading-4 text-muted-foreground">
                      <span className={cn("font-medium", current ? "text-[#4e6238] dark:text-[#cbe49e]" : undefined)}>{translationLanguageLabel(entry.language)}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{new Date(entry.startedAt).toLocaleTimeString(locale)}</span>
                      {entry.status === "running" ? <LoaderCircle aria-label={status ?? undefined} className="h-2.5 w-2.5 animate-spin" /> : null}
                      {entry.status === "error" ? <span className="text-red-600 dark:text-red-300">{status}</span> : null}
                      {entry.status === "aborted" ? <span>{status}</span> : null}
                    </span>
                    <span className={cn("line-clamp-2 text-[11px] leading-4", current ? "text-foreground" : "text-foreground/75")}>{entry.source}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
