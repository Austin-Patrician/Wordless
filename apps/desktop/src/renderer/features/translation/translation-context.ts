import { createContext, useContext } from "react";
import type { SelectionRect } from "../thread/selection-snapshot";

export type TranslationPresentation = "bubble" | "panel";
export type TranslationStatus = "running" | "done" | "error" | "aborted";

export type TranslationEntry = {
  id: string;
  /** The selected text, kept so the panel can show it beside the translation. */
  source: string;
  /** Streaming translation; grows while the request is running. */
  text: string;
  language: string;
  status: TranslationStatus;
  error?: string;
  presentation: TranslationPresentation;
  /** When the request started, used to order the session history. */
  startedAt: number;
};

export type TranslationStartInput = {
  source: string;
  /** One-off language override; omitted values follow the stored preference. */
  language?: string;
  presentation: TranslationPresentation;
  anchorRect?: SelectionRect;
};

export type TranslationContextValue = {
  entries: TranslationEntry[];
  /** Entry the panel should present. */
  activeId: string | null;
  /** Entry currently presented in the bubble, if any. */
  bubble: (TranslationEntry & { anchorRect: SelectionRect }) | null;
  /** Language used when a caller does not pass an override. */
  defaultLanguage: string;
  /** Selection length above which a translation opens in the panel. */
  bubbleMaxChars: number;
  /** True when a chat model is enabled, so translation can actually run. */
  hasModel: boolean;
  /** Opens the translation preferences so the panel can link to them. */
  openSettings(): void;
  translate(input: TranslationStartInput): void;
  retranslate(entryId: string, language: string): void;
  selectEntry(entryId: string): void;
  stop(entryId?: string): void;
  showInPanel(entryId: string): void;
  closeBubble(): void;
  clear(): void;
};

/**
 * Kept apart from the provider so that consumers which only need the current
 * translation state (the message selection menu) do not pull the provider's
 * runtime and bridge dependencies into their module graph.
 */
export const TranslationContext = createContext<TranslationContextValue | null>(null);

/** Returns null outside the workbench so standalone markdown stays untouched. */
export function useTranslation(): TranslationContextValue | null {
  return useContext(TranslationContext);
}
