import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from "@wordless/ui-kit";
import { Languages } from "lucide-react";
import type { ModelReference } from "@wordless/domain";
import { usePreferences } from "../../shared/preferences";
import { useRuntime } from "../../shared/runtime";
import { TRANSLATION_LANGUAGES } from "../translation/translation-language";

/** Select value that maps to "follow the interface language" (`targetLanguage: null`). */
const FOLLOW_INTERFACE_LANGUAGE = "auto";
/** Radix select items reject empty values, so "no pinned model" needs a sentinel too. */
const FOLLOW_SESSION_MODEL = "auto";

function modelOptionValue(model: { providerId: string; modelId: string }): string {
  return `${model.providerId}/${model.modelId}`;
}

function modelReferenceFromValue(value: string): ModelReference | null {
  if (!value || value === FOLLOW_SESSION_MODEL) return null;
  const [connectionId, ...rest] = value.split("/");
  return { connectionId, modelId: rest.join("/") };
}

/**
 * Translation preferences, shown on the Assistant settings page.
 *
 * Both the language and the model default to "follow what the session is
 * already doing" so the feature works without configuration; the explicit
 * choices exist for users who translate into a fixed language or want a cheaper
 * model to handle it.
 */
export function TranslationSettings() {
  const { setTranslation, t, translation } = usePreferences();
  const { snapshot } = useRuntime();
  const enabledModels = snapshot?.modelConfiguration.models.filter((model) => model.kind === "chat" && model.enabled) ?? [];
  const selectedModelValue = translation.model ? modelOptionValue({ providerId: translation.model.connectionId, modelId: translation.model.modelId }) : FOLLOW_SESSION_MODEL;

  return (
    <section className="px-6 py-6 sm:px-9">
      <div className="max-w-[680px] space-y-2.5">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[#e0e0da] bg-white text-[#69794a] dark:border-border dark:bg-card dark:text-[#c8df89]">
            <Languages className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold">{t("translationSettings")}</h2>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("translationSettingsHelp")}</p>
          </div>
        </div>

        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <label className="block text-[13px] font-semibold" htmlFor="translation-language">
            {t("translationTargetLanguage")}
          </label>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("translationTargetLanguageHelp")}</p>
            <Select
              onValueChange={(value) => void setTranslation({ ...translation, targetLanguage: value === FOLLOW_INTERFACE_LANGUAGE ? null : value })}
              value={translation.targetLanguage ?? FOLLOW_INTERFACE_LANGUAGE}
            >
              <SelectTrigger className="min-w-[170px] rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="translation-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_INTERFACE_LANGUAGE}>{t("translationFollowInterface")}</SelectItem>
                {TRANSLATION_LANGUAGES.map((language) => (
                  <SelectItem key={language.id} value={language.id}>{language.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <label className="block text-[13px] font-semibold" htmlFor="translation-model">
            {t("translationModel")}
          </label>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">
              {enabledModels.length === 0 ? t("translationNeedsModel") : t("translationModelHelp")}
            </p>
            <Select
              disabled={enabledModels.length === 0}
              onValueChange={(value) => void setTranslation({ ...translation, model: modelReferenceFromValue(value) })}
              value={selectedModelValue}
            >
              <SelectTrigger className="min-w-[170px] rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="translation-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FOLLOW_SESSION_MODEL}>{t("translationFollowSessionModel")}</SelectItem>
                {enabledModels.map((model) => (
                  <SelectItem key={modelOptionValue(model)} value={modelOptionValue(model)}>{model.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div className="flex items-center justify-between">
            <label className="text-[13px] font-semibold" htmlFor="translation-bubble-limit">{t("translationBubbleLimit")}</label>
            <span className="font-mono text-[10px] text-muted-foreground">{translation.bubbleMaxChars}</span>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("translationBubbleLimitHelp")}</p>
          <Slider
            className="mt-4"
            id="translation-bubble-limit"
            max={2_000}
            min={200}
            onValueChange={(value) => void setTranslation({ ...translation, bubbleMaxChars: value[0] ?? translation.bubbleMaxChars })}
            step={100}
            value={[translation.bubbleMaxChars]}
          />
        </section>

        <p className="px-1 text-[11px] leading-5 text-muted-foreground">{t("translationPrivacyNote")}</p>
      </div>
    </section>
  );
}
