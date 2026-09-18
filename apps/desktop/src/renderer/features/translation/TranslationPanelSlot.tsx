import { TranslationProvider } from "./TranslationProvider";
import { TranslationsPanel } from "./TranslationsPanel";
import { useTranslation } from "./translation-context";

/**
 * Panel content slot. The panel is rendered by the workbench shell, but its
 * state belongs to the translation provider, so the shell only has to mount
 * this slot instead of threading translation state through its own props.
 */
export function TranslationPanelSlot() {
  const translation = useTranslation();
  if (!translation) return null;
  return (
    <TranslationsPanel
      activeId={translation.activeId}
      entries={translation.entries}
      onClear={translation.clear}
      onOpenSettings={translation.openSettings}
      onRetranslate={translation.retranslate}
      onSelect={translation.selectEntry}
      onStop={translation.stop}
    />
  );
}

export { TranslationProvider };
