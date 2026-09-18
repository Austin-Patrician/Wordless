import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { resolveTranslationTargetLanguage } from "@wordless/domain";
import type { SelectionRect } from "../thread/selection-snapshot";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import type { RuntimeClient } from "../../bridge/runtime-client";
import { TranslationBubble } from "./TranslationBubble";
import { TranslationContext, type TranslationContextValue, type TranslationEntry, type TranslationStartInput } from "./translation-context";


/**
 * Translation state for the workbench.
 *
 * A translation is presentation-agnostic while it streams: the same entry can be
 * shown in a bubble next to the selection or in the right panel, and switching
 * between them must not restart the model request. The provider therefore owns
 * both the stream subscription and the bubble, and only routes at start time.
 */
export function TranslationProvider({ children, onOpenSettings, onRevealPanel, sessionId }: { children: ReactNode; onOpenSettings: () => void; onRevealPanel: () => void; sessionId: string | undefined }) {
  const { client } = useRuntime();
  // Without a bridge there is nothing to translate with. The provider stays
  // mounted so consumers simply see "unavailable" instead of the shell crashing
  // the way it would if `useRuntimeClient` threw.
  if (!client) return <TranslationContext.Provider value={null}>{children}</TranslationContext.Provider>;
  return (
    <TranslationHost client={client} onOpenSettings={onOpenSettings} onRevealPanel={onRevealPanel} sessionId={sessionId}>
      {children}
    </TranslationHost>
  );
}

function TranslationHost({ children, client, onOpenSettings, onRevealPanel, sessionId }: { children: ReactNode; client: RuntimeClient; onOpenSettings: () => void; onRevealPanel: () => void; sessionId: string | undefined }) {
  const { snapshot } = useRuntime();
  const { t } = usePreferences();
  const ownedRef = useRef(new Set<string>());
  const runningRef = useRef(new Set<string>());
  const [entries, setEntries] = useState<TranslationEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bubble, setBubble] = useState<{ id: string; anchorRect: SelectionRect } | null>(null);

  const defaultLanguage = snapshot ? resolveTranslationTargetLanguage(snapshot.preferences) : "en-US";
  const bubbleMaxChars = snapshot?.preferences.translation?.bubbleMaxChars ?? 600;
  const hasModel = snapshot?.modelConfiguration.models.some((model) => model.kind === "chat" && model.enabled) ?? false;

  const update = useCallback((id: string, change: (entry: TranslationEntry) => TranslationEntry) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? change(entry) : entry)));
  }, []);

  // Session changes invalidate the entries: a translation belongs to the
  // conversation it was made in, and an in-flight request must not keep running.
  useEffect(() => {
    ownedRef.current.clear();
    runningRef.current.clear();
    setEntries([]);
    setActiveId(null);
    setBubble(null);
  }, [sessionId]);

  useEffect(() => client.subscribeHost((event) => {
    if (event.type !== "translation") return;
    const { requestId, phase, text, error } = event.event;
    if (!ownedRef.current.has(requestId)) return;
    if (phase === "start") {
      update(requestId, (entry) => ({ ...entry, language: event.event.targetLanguage ?? entry.language }));
      return;
    }
    if (phase === "delta") {
      update(requestId, (entry) => ({ ...entry, text: entry.text + text }));
      return;
    }
    runningRef.current.delete(requestId);
    if (phase === "done") {
      update(requestId, (entry) => ({ ...entry, text, status: "done", language: event.event.targetLanguage ?? entry.language }));
      return;
    }
    if (phase === "aborted") {
      // The service reports what was already produced so the partial
      // translation stays readable after a stop.
      update(requestId, (entry) => ({ ...entry, text: text || entry.text, status: "aborted" }));
      return;
    }
    update(requestId, (entry) => ({ ...entry, status: "error", error: error ?? t("translationFailed") }));
  }), [client, t, update]);

  const run = useCallback((input: TranslationStartInput) => {
    if (!sessionId) return;
    // Only one stream at a time: a new request supersedes the previous one
    // instead of multiplying provider usage.
    for (const id of runningRef.current) void client.abortTranslation(id);
    runningRef.current.clear();
    const id = crypto.randomUUID();
    ownedRef.current.add(id);
    runningRef.current.add(id);
    setEntries((current) => [
      { id, source: input.source, startedAt: Date.now(), text: "", language: input.language ?? defaultLanguage, status: "running", presentation: input.presentation },
      ...current,
    ]);
    setActiveId(id);
    if (input.presentation === "bubble" && input.anchorRect) setBubble({ id, anchorRect: input.anchorRect });
    else if (input.presentation === "panel") { setBubble(null); onRevealPanel(); }
    void client
      .translateSelection({ requestId: id, sessionId, text: input.source, ...(input.language ? { targetLanguage: input.language } : {}) })
      .catch((error: unknown) => {
        runningRef.current.delete(id);
        update(id, (entry) => ({ ...entry, status: "error", error: error instanceof Error ? error.message : String(error) }));
      });
  }, [client, defaultLanguage, onRevealPanel, sessionId, update]);

  const stop = useCallback((entryId?: string) => {
    const ids = entryId ? [entryId] : [...runningRef.current];
    for (const id of ids) {
      if (!runningRef.current.has(id)) continue;
      runningRef.current.delete(id);
      // Reflecting the stop immediately keeps the interface responsive; the
      // service confirms with an authoritative `aborted` event.
      update(id, (entry) => ({ ...entry, status: "aborted" }));
      void client.abortTranslation(id);
    }
  }, [client, update]);

  const value = useMemo<TranslationContextValue>(() => ({
    entries,
    activeId,
    bubbleMaxChars,
    defaultLanguage,
    hasModel,
    openSettings: onOpenSettings,
    bubble: bubble ? (() => {
      const entry = entries.find((candidate) => candidate.id === bubble.id);
      return entry ? { ...entry, anchorRect: bubble.anchorRect } : null;
    })() : null,
    translate: run,
    retranslate: (entryId, language) => {
      const entry = entries.find((candidate) => candidate.id === entryId);
      if (!entry) return;
      run({
        source: entry.source,
        language,
        presentation: entry.presentation,
        ...(bubble?.anchorRect ? { anchorRect: bubble.anchorRect } : {}),
      });
    },
    selectEntry: setActiveId,
    stop,
    showInPanel: (entryId) => {
      update(entryId, (entry) => ({ ...entry, presentation: "panel" }));
      setActiveId(entryId);
      setBubble(null);
      onRevealPanel();
    },
    closeBubble: () => {
      if (bubble) stop(bubble.id);
      setBubble(null);
    },
    clear: () => {
      for (const id of runningRef.current) void client.abortTranslation(id);
      runningRef.current.clear();
      ownedRef.current.clear();
      setEntries([]);
      setActiveId(null);
      setBubble(null);
    },
  }), [activeId, bubble, bubbleMaxChars, client, defaultLanguage, entries, hasModel, onOpenSettings, onRevealPanel, run, stop, update]);

  return (
    <TranslationContext.Provider value={value}>
      {children}
      {value.bubble ? <TranslationBubble entry={value.bubble} key={value.bubble.id} onClose={value.closeBubble} onCopy={(text) => void navigator.clipboard.writeText(text)} onOpenPanel={() => value.showInPanel(value.bubble!.id)} onRetranslate={(language) => value.retranslate(value.bubble!.id, language)} onStop={() => value.stop(value.bubble!.id)} /> : null}
    </TranslationContext.Provider>
  );
}

