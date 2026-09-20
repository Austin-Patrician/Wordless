import { Button } from "@wordless/ui-kit";
import { ArrowRight, Check } from "lucide-react";
import type { Locale, ThemeMode } from "../../shared/models";
import { usePreferences } from "../../shared/preferences";
import wordlessIcon from "../../../icons/common-icons/wordless.jpeg";

const LOCALE_OPTIONS: ReadonlyArray<{ value: Locale; label: string; hint: string }> = [
  { value: "zh-CN", label: "简体中文", hint: "Chinese" },
  { value: "en-US", label: "English", hint: "英语" },
];

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; labelKey: "light" | "dark" | "system" }> = [
  { value: "light", labelKey: "light" },
  { value: "dark", labelKey: "dark" },
  { value: "system", labelKey: "system" },
];

/**
 * Miniature window mock used as the theme swatch. Drawing the real choice is
 * faster to read than a colour name, and it keeps the picker understandable
 * before the interface has been rendered in that theme.
 */
function ThemeSwatch({ mode }: { mode: ThemeMode }) {
  const frame = "h-[30px] w-full overflow-hidden rounded-[6px] border";
  const bar = (tone: string, width: string) => (
    <span className={`block h-[3px] rounded-full ${tone}`} style={{ width }} />
  );
  if (mode === "system") {
    return (
      <span className={`${frame} flex border-[#dcdcd4] dark:border-[#3a3d33]`}>
        <span className="flex w-1/2 flex-col justify-center gap-[3px] bg-white px-1.5">
          {bar("bg-[#c9c9c2]", "70%")}
          {bar("bg-[#e2e2dc]", "45%")}
        </span>
        <span className="flex w-1/2 flex-col justify-center gap-[3px] bg-[#1b1d17] px-1.5">
          {bar("bg-[#5d6350]", "70%")}
          {bar("bg-[#3c4136]", "45%")}
        </span>
      </span>
    );
  }
  const dark = mode === "dark";
  return (
    <span className={`${frame} flex flex-col justify-center gap-[3px] px-1.5 ${dark ? "border-[#3a3d33] bg-[#1b1d17]" : "border-[#dcdcd4] bg-white"}`}>
      {bar(dark ? "bg-[#5d6350]" : "bg-[#c9c9c2]", "70%")}
      {bar(dark ? "bg-[#3c4136]" : "bg-[#e2e2dc]", "45%")}
    </span>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#8d8d86] dark:text-muted-foreground">
      {children}
    </p>
  );
}

export function OnboardingWelcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const { locale, setLocale, theme, setTheme, t } = usePreferences();

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-[var(--wordless-overlay-surface)] px-6 py-10">
      <div className="w-full max-w-[560px]">
        <div className="flex items-center gap-2.5">
          <img alt="" className="h-8 w-8 shrink-0 rounded-[9px] object-cover" draggable={false} src={wordlessIcon} />
          <span className="text-[15px] font-bold tracking-[-0.03em] text-[#232320] dark:text-foreground">wordless</span>
        </div>

        <h1 className="mt-7 text-[30px] font-bold leading-[1.2] tracking-[-0.04em] text-[#171716] dark:text-foreground">
          {t("onboardingWelcomeTitle")}
        </h1>
        <p className="mt-2.5 max-w-[440px] text-[13px] leading-6 text-[#6a6a63] dark:text-muted-foreground">
          {t("onboardingWelcomeBody")}
        </p>

        <div className="mt-8 space-y-3">
          <section className="rounded-[14px] border border-[#e6e6e1] bg-white p-4 dark:border-border dark:bg-card">
            <SectionLabel>{t("displayLanguage")}</SectionLabel>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {LOCALE_OPTIONS.map((option) => {
                const selected = locale === option.value;
                return (
                  <button
                    aria-pressed={selected}
                    className={`flex items-center justify-between gap-2 rounded-[10px] border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-[#b9ce80] bg-[#eef4dc] dark:border-[#739127] dark:bg-[#303a1c]"
                        : "border-[#e4e4e0] bg-white hover:border-[#d3d3cb] hover:bg-[#fafaf8] dark:border-border dark:bg-card dark:hover:bg-muted"
                    }`}
                    key={option.value}
                    onClick={() => setLocale(option.value)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className={`block truncate text-[12.5px] font-semibold ${selected ? "text-[#354210] dark:text-[#e8f5c6]" : "text-[#3d3d38] dark:text-foreground"}`}>{option.label}</span>
                      <span className={`mt-0.5 block truncate font-mono text-[10px] ${selected ? "text-[#5d7027] dark:text-[#a8c46a]" : "text-[#96968e] dark:text-muted-foreground"}`}>{option.hint}</span>
                    </span>
                    {selected ? <Check className="h-4 w-4 shrink-0 text-[#5d7a28] dark:text-[#c8df89]" /> : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-[14px] border border-[#e6e6e1] bg-white p-4 dark:border-border dark:bg-card">
            <SectionLabel>{t("theme")}</SectionLabel>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((option) => {
                const selected = theme === option.value;
                return (
                  <button
                    aria-pressed={selected}
                    className={`flex flex-col gap-2 rounded-[10px] border p-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-[#b9ce80] bg-[#eef4dc] dark:border-[#739127] dark:bg-[#303a1c]"
                        : "border-[#e4e4e0] bg-white hover:border-[#d3d3cb] hover:bg-[#fafaf8] dark:border-border dark:bg-card dark:hover:bg-muted"
                    }`}
                    key={option.value}
                    onClick={() => setTheme(option.value)}
                    type="button"
                  >
                    <ThemeSwatch mode={option.value} />
                    <span className={`flex items-center gap-1 text-[11.5px] font-medium ${selected ? "text-[#354210] dark:text-[#e8f5c6]" : "text-[#4b4b45] dark:text-muted-foreground"}`}>
                      {t(option.labelKey)}
                      {selected ? <Check className="h-3 w-3 shrink-0 text-[#5d7a28] dark:text-[#c8df89]" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <div className="mt-7 flex items-center justify-between gap-4">
          <Button className="text-[#6a6a63] dark:text-muted-foreground" onClick={onSkip} type="button" variant="ghost">
            {t("onboardingSkip")}
          </Button>
          <Button className="h-9 px-4" onClick={onStart} type="button">
            {t("onboardingStartTour")}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
        <p className="mt-3 text-right font-mono text-[10px] text-[#9a9a92] dark:text-muted-foreground">
          {t("onboardingWelcomeHint")}
        </p>
      </div>
    </div>
  );
}
