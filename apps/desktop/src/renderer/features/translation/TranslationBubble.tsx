import { Check, Copy, LoaderCircle, PanelRight, RefreshCw, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent, Tooltip, TooltipContent, TooltipTrigger, cn } from "@wordless/ui-kit";
import type { SelectionRect } from "../thread/selection-snapshot";
import { usePreferences } from "../../shared/preferences";
import type { TranslationEntry } from "./translation-context";
import { TRANSLATION_LANGUAGES, translationLanguageLabel } from "./translation-language";

type BubbleEntry = TranslationEntry & { anchorRect: SelectionRect };

const COPY_FEEDBACK_MS = 1_200;
/** Ignore scroll dismissals while the interface settles after the menu closes. */
const SETTLE_MS = 250;

/**
 * Floating translation next to the selection, in the spirit of a browser
 * translate extension.
 *
 * Positioning is delegated to the popover primitive: the anchor is an invisible
 * box that reproduces the selection rectangle, so the bubble sits below the
 * selected text and flips above it when the viewport runs out of room. Escape
 * and outside clicks close it and stop the request; scrolling dismisses it
 * because the selection it points at no longer exists.
 */
export function TranslationBubble({ entry, onClose, onCopy, onOpenPanel, onRetranslate, onStop }: {
  entry: BubbleEntry;
  onClose: () => void;
  onCopy: (text: string) => void;
  onOpenPanel: () => void;
  onRetranslate: (language: string) => void;
  onStop: () => void;
}) {
  const { t } = usePreferences();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const [languageOpen, setLanguageOpen] = useState(false);
  const running = entry.status === "running";

  useEffect(() => () => {
    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
  }, []);

  // Scroll and resize invalidate the anchor box, so the bubble dismisses
  // instead of floating over text it no longer points at. Dismissal always
  // stops the request: a translation nobody can see should not keep using the
  // provider, and the panel keeps whatever was already produced.
  //
  // The listener is armed after a short settle window: closing the context menu
  // moves focus back to the message, and a focus-driven scroll would otherwise
  // dismiss the bubble in the same frame it appears.
  useEffect(() => {
    const dismiss = () => onClose();
    let armed = false;
    const timer = window.setTimeout(() => {
      armed = true;
    }, SETTLE_MS);
    const onScroll = () => {
      if (armed) dismiss();
    };
    const onResize = () => dismiss();
    document.addEventListener("scroll", onScroll, { capture: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  const rect = entry.anchorRect;

  return (
    <Popover open onOpenChange={(next) => { if (!next) onClose(); }}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed"
          style={{ top: rect.top, left: rect.left, width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="center"
        aria-label={t("translationBubbleLabel")}
        className="w-[min(420px,calc(100vw-32px))] p-0"
        onEscapeKeyDown={(event) => { event.preventDefault(); onClose(); }}
        onFocusOutside={(event) => {
          // A non-modal Radix popover dismisses on any outside focus, and closing
          // the context menu returns focus to the message. Only explicit pointer
          // interaction or Escape should close a translation being read.
          event.preventDefault();
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="bottom"
        sideOffset={8}
      >
        <header className="flex h-9 items-center gap-1 border-b border-[#ececE7] px-2 dark:border-border">
          <button
            aria-expanded={languageOpen}
            aria-label={t("translationTargetLanguage")}
            className="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium text-[#5b5b55] transition-colors hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted"
            onClick={() => setLanguageOpen((value) => !value)}
            type="button"
          >
            {translationLanguageLabel(entry.language)}
          </button>
          <span className="ml-auto flex items-center gap-0.5">
            {running ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button aria-label={t("translationStop")} className="grid h-6 w-6 place-items-center rounded-[5px] text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-300" onClick={onStop} type="button">
                    <Square className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("translationStop")}</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button aria-label={t("translationRetry")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] transition-colors hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={() => onRetranslate(entry.language)} type="button">
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("translationRetry")}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={t("translationCopy")}
                  className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] disabled:cursor-not-allowed disabled:opacity-40 dark:text-muted-foreground dark:hover:bg-muted"
                  disabled={!entry.text}
                  onClick={() => {
                    onCopy(entry.text);
                    setCopied(true);
                    if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
                    copiedTimer.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
                  }}
                  type="button"
                >
                  {copied ? <Check className="h-3 w-3 text-[#66833d]" /> : <Copy className="h-3 w-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? t("selectionCopied") : t("translationCopy")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button aria-label={t("translationOpenPanel")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={onOpenPanel} type="button">
                  <PanelRight className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("translationOpenPanel")}</TooltipContent>
            </Tooltip>
            <button aria-label={t("translationClose")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={onClose} type="button">
              <X className="h-3 w-3" />
            </button>
          </span>
        </header>
        {languageOpen ? (
          <div className="max-h-56 overflow-y-auto border-b border-[#ececE7] py-1 dark:border-border">
            {TRANSLATION_LANGUAGES.map((language) => (
              <button
                className={cn("flex h-7 w-full items-center px-3 text-left text-[11px] hover:bg-[#f0f0ec] dark:hover:bg-muted", language.id === entry.language ? "font-semibold text-[#4e6238] dark:text-[#cbe49e]" : "text-[#5b5b55] dark:text-muted-foreground")}
                key={language.id}
                onClick={() => { setLanguageOpen(false); onRetranslate(language.id); }}
                type="button"
              >
                {language.label}
              </button>
            ))}
          </div>
        ) : null}
        <div aria-live="polite" className="max-h-[min(320px,50vh)] overflow-y-auto px-3 py-2.5 text-[13px] leading-6">
          {entry.text ? (
            <p className="whitespace-pre-wrap break-words text-[#45453f] dark:text-foreground">{entry.text}</p>
          ) : entry.status === "error" ? (
            <p className="text-[12px] text-destructive">{entry.error ?? t("translationFailed")}</p>
          ) : entry.status === "aborted" ? (
            <p className="text-[12px] text-muted-foreground">{t("translationStopped")}</p>
          ) : (
            <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {`${t("translationRunning")}${translationLanguageLabel(entry.language)}`}
            </span>
          )}
          {entry.status === "aborted" && entry.text ? <p className="mt-1.5 text-[10px] text-muted-foreground">{t("translationStopped")}</p> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
