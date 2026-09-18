import { TRANSLATION_LANGUAGE_IDS, type TranslationLanguageId } from "@wordless/domain";

/**
 * Languages are labelled in their own language, which is how language pickers
 * are conventionally written, and which avoids translating proper names.
 */
const LANGUAGE_LABELS: Record<TranslationLanguageId, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "en-US": "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  ru: "Русский",
  it: "Italiano",
  ar: "العربية",
};

export function translationLanguageLabel(language: string): string {
  return LANGUAGE_LABELS[language as TranslationLanguageId] ?? language;
}

export const TRANSLATION_LANGUAGES: { id: TranslationLanguageId; label: string }[] =
  TRANSLATION_LANGUAGE_IDS.map((id) => ({ id, label: LANGUAGE_LABELS[id] }));
