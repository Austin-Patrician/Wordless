import { Code2, Copy, Languages } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuRadioGroup, ContextMenuRadioItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@wordless/ui-kit";
import { usePreferences } from "../../shared/preferences";
import { useTranslation } from "../translation/translation-context";
import { TRANSLATION_LANGUAGES, translationLanguageLabel } from "../translation/translation-language";
import { captureMessageSelection, messageSelectionFromRange, rangeBlockElement, type MessageSelectionSnapshot } from "./selection-snapshot";

type CopyKind = "text" | "markdown";
type CopyFeedback = { kind: CopyKind; status: "copied" | "failed" };

const COPY_FEEDBACK_MS = 1_200;
/** Matches the protocol's `text` limit; longer selections cannot be translated. */
const MAX_TRANSLATION_CHARS = 20_000;
/** Above this many rendered lines a bubble stops being readable. */
const MAX_BUBBLE_LINES = 8;

/**
 * Wraps rendered message markdown in a selection-scoped context menu.
 *
 * The menu only opens when the current DOM selection is non-collapsed and lives
 * inside this message, so a right-click elsewhere in the row keeps the platform
 * default (no menu at all in Electron) instead of offering actions that cannot
 * apply. The selection is snapshotted on open because the thread list is
 * virtualized and streaming markdown re-renders, both of which invalidate a live
 * DOM selection before the user picks a menu item.
 */
export function MessageSelectionMenu({ children, className, streaming = false, style }: { children: ReactNode; className?: string; streaming?: boolean; style?: CSSProperties }) {
  const { t } = usePreferences();
  const translation = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // Chromium drops the selection when the right button is pressed away from it,
  // which is the common case after a double click: one word is selected and the
  // right click lands a few pixels off. Keeping the last left-click range lets a
  // right click inside the same block still act on that selection.
  const rememberedRangeRef = useRef<Range | null>(null);
  // Target of the right click that is currently opening the menu. Read through a
  // native capture listener because Radix owns the trigger's own handler.
  const contextTargetRef = useRef<EventTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [snapshotSelection, setSnapshotSelection] = useState<MessageSelectionSnapshot | null>(null);
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const remember = (event: MouseEvent) => {
      // A right click must not overwrite the memory: it is the very interaction
      // that cleared the selection.
      if (event.button === 2) return;
      // Read after the browser applied this click's default selection behaviour,
      // otherwise a click that collapses the selection still reports the old one.
      window.setTimeout(() => {
        const selection = window.getSelection();
        const anchor = selection?.anchorNode ?? null;
        rememberedRangeRef.current = selection && selection.rangeCount > 0 && !selection.isCollapsed && anchor !== null && root.contains(anchor)
          ? selection.getRangeAt(0).cloneRange()
          : null;
      }, 0);
    };
    root.addEventListener("mouseup", remember, true);
    const trackTarget = (event: MouseEvent) => {
      contextTargetRef.current = event.target;
    };
    root.addEventListener("contextmenu", trackTarget, true);
    return () => {
      root.removeEventListener("mouseup", remember, true);
      root.removeEventListener("contextmenu", trackTarget, true);
    };
  }, []);

  /** Snapshot of the remembered selection, when the current right click still refers to it. */
  const rememberedSelection = useCallback((root: HTMLElement | null): MessageSelectionSnapshot | null => {
    const range = rememberedRangeRef.current;
    const target = contextTargetRef.current;
    if (!root || !range || !range.commonAncestorContainer.isConnected) return null;
    if (!root.contains(range.commonAncestorContainer)) return null;
    // The right click has to stay inside the block that held the selection:
    // a right click in another paragraph is not about the selected word.
    const block = rangeBlockElement(range);
    if (!block || !(target instanceof Node) || !block.contains(target)) return null;
    return messageSelectionFromRange(range, root);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      clearTimer();
      setOpen(false);
      setFeedback(null);
      setSnapshotSelection(null);
      return;
    }
    const root = rootRef.current;
    const captured = captureMessageSelection(root) ?? rememberedSelection(root);
    if (!captured) {
      setOpen(false);
      return;
    }
    setSnapshotSelection(captured);
    setFeedback(null);
    setOpen(true);
  }, [clearTimer, rememberedSelection]);

  const copy = useCallback(async (kind: CopyKind, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ kind, status: "copied" });
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        setOpen(false);
        setFeedback(null);
        setSnapshotSelection(null);
      }, COPY_FEEDBACK_MS);
    } catch {
      setFeedback({ kind, status: "failed" });
    }
  }, [clearTimer]);

  const labelFor = (kind: CopyKind, idle: string) => {
    if (feedback?.kind !== kind) return idle;
    return feedback.status === "copied" ? t("selectionCopied") : t("selectionCopyFailed");
  };

  const items: { kind: CopyKind; icon: ReactNode; idle: string; value: string }[] = [
    { kind: "text", icon: <Copy className="h-3.5 w-3.5" />, idle: t("selectionCopy"), value: snapshotSelection?.text ?? "" },
    { kind: "markdown", icon: <Code2 className="h-3.5 w-3.5" />, idle: t("selectionCopyMarkdown"), value: snapshotSelection?.markdown ?? "" },
  ];

  const defaultLanguage = translation?.defaultLanguage ?? "en-US";
  const source = snapshotSelection?.text ?? "";
  const translationUnavailable = !translation
    ? t("translationUnavailable")
    : streaming
      ? t("translationUnavailableWhileStreaming")
      : !translation.hasModel
        ? t("translationNeedsModel")
        : source.length > MAX_TRANSLATION_CHARS
          ? t("translationTooLong")
          : null;
  // Code is copied as source: translating a fragment of it would produce text
  // that no longer matches the program.
  const offersTranslation = Boolean(translation) && snapshotSelection !== null && !snapshotSelection.insideCodeBlock;

  const startTranslation = (language?: string) => {
    if (!translation || !snapshotSelection) return;
    const useBubble = snapshotSelection.text.length <= translation.bubbleMaxChars && snapshotSelection.lineCount <= MAX_BUBBLE_LINES;
    translation.translate({
      source: snapshotSelection.text,
      ...(language ? { language } : {}),
      presentation: useBubble ? "bubble" : "panel",
      ...(useBubble ? { anchorRect: snapshotSelection.rect } : {}),
    });
    setOpen(false);
  };

  const translateItem = (
    <ContextMenuItem
      data-wordless-action="translate"
      disabled={translationUnavailable !== null}
      onSelect={(event) => {
        event.preventDefault();
        startTranslation();
      }}
    >
      <Languages className="h-3.5 w-3.5" />
      {/* Disabled menu items cannot receive hover, so the reason replaces the
          label instead of living in a tooltip that could never be shown. */}
      {translationUnavailable ?? `${t("translationMenuLabel")}${translationLanguageLabel(defaultLanguage)}`}
    </ContextMenuItem>
  );

  return (
    <ContextMenu onOpenChange={handleOpenChange} open={open}>
      <ContextMenuTrigger asChild>
        <div className={className} data-wordless-selection-surface="" ref={rootRef} style={style}>
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={t("selectionMenuLabel")}>
        {offersTranslation ? (
          <>
            {translateItem}
            {translationUnavailable === null ? (
              <ContextMenuSub>
                <ContextMenuSubTrigger>{t("translationOtherLanguages")}</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  <ContextMenuRadioGroup value={defaultLanguage} onValueChange={(value) => startTranslation(value)}>
                    {TRANSLATION_LANGUAGES.map((language) => (
                      <ContextMenuRadioItem key={language.id} value={language.id}>
                        {language.label}
                      </ContextMenuRadioItem>
                    ))}
                  </ContextMenuRadioGroup>
                </ContextMenuSubContent>
              </ContextMenuSub>
            ) : null}
            <ContextMenuSeparator />
          </>
        ) : null}
        {items.map((item) => (
          <ContextMenuItem
            key={item.kind}
            onSelect={(event) => {
              // Keep the menu mounted so the copy result stays visible.
              event.preventDefault();
              if (snapshotSelection) void copy(item.kind, item.value);
            }}
          >
            {item.icon}
            {labelFor(item.kind, item.idle)}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
