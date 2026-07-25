import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { translate, type MessageKey } from "./i18n";
import type { Locale, ThemeMode } from "./models";
import { useRuntime } from "./runtime";
import type { AppearancePreferences, NotificationPreferences, SecurityPreferences } from "@wordless/domain";

const defaultAppearance: AppearancePreferences = {
  background: {
    source: { kind: "none" },
    fit: "cover",
    position: { x: 50, y: 50 },
    intensity: 40,
    blurPx: 0,
  },
};

type Preferences = {
  locale: Locale;
  theme: ThemeMode;
  fontScale: number;
  reduceMotion: boolean;
  notifications: NotificationPreferences;
  security: SecurityPreferences;
  appearance: AppearancePreferences;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
  setFontScale: (fontScale: number) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setNotifications: (notifications: NotificationPreferences) => void;
  setSecurity: (security: SecurityPreferences) => Promise<void>;
  previewAppearance: (appearance: AppearancePreferences) => void;
  setAppearance: (appearance: AppearancePreferences) => Promise<void>;
  t: (key: MessageKey) => string;
};

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { client, snapshot } = useRuntime();
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [fontScale, setFontScale] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [notifications, setNotifications] = useState<NotificationPreferences>({ enabled: false, onActionRequired: true, onRunCompleted: true, onRunFailed: true });
  const [security, setSecurityPreferences] = useState<SecurityPreferences>({ customFileRules: [], customCommandRules: [] });
  const [appearance, setAppearancePreferences] = useState<AppearancePreferences>(defaultAppearance);

  useEffect(() => {
    if (!snapshot) return;
    setLocale(snapshot.preferences.locale);
    setTheme(snapshot.preferences.theme);
    setFontScale(snapshot.preferences.fontScale);
    setReduceMotion(snapshot.preferences.reduceMotion);
    setNotifications(snapshot.preferences.notifications);
    setSecurityPreferences(snapshot.preferences.security);
    setAppearancePreferences(snapshot.preferences.appearance);
  }, [snapshot]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.style.setProperty("--wordless-font-scale", String(fontScale));
    root.dataset.reduceMotion = reduceMotion ? "true" : "false";
  }, [fontScale, locale, reduceMotion]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.appearanceBackground = appearance.background.source.kind === "none" ? "none" : "active";
  }, [appearance]);

  const value = useMemo<Preferences>(
    () => ({
      locale,
      theme,
      fontScale,
      reduceMotion,
      notifications,
      security,
      appearance,
      setLocale: (nextLocale) => {
        setLocale(nextLocale);
        if (snapshot && client) void client.setPreferences({ ...snapshot.preferences, locale: nextLocale });
      },
      setTheme: (nextTheme) => {
        setTheme(nextTheme);
        if (snapshot && client) void client.setPreferences({ ...snapshot.preferences, theme: nextTheme });
      },
      setFontScale: (nextScale) => {
        setFontScale(nextScale);
        if (snapshot && client) void client.setPreferences({ ...snapshot.preferences, fontScale: nextScale });
      },
      setReduceMotion: (nextReduceMotion) => {
        setReduceMotion(nextReduceMotion);
        if (snapshot && client) void client.setPreferences({ ...snapshot.preferences, reduceMotion: nextReduceMotion });
      },
      setNotifications: (nextNotifications) => {
        setNotifications(nextNotifications);
        if (snapshot && client) void client.setPreferences({ ...snapshot.preferences, notifications: nextNotifications });
      },
      setSecurity: async (nextSecurity) => {
        setSecurityPreferences(nextSecurity);
        if (snapshot && client) await client.setPreferences({ ...snapshot.preferences, security: nextSecurity });
      },
      previewAppearance: (nextAppearance) => {
        setAppearancePreferences(nextAppearance);
      },
      setAppearance: async (nextAppearance) => {
        setAppearancePreferences(nextAppearance);
        if (snapshot && client) await client.setPreferences({ ...snapshot.preferences, appearance: nextAppearance });
      },
      t: (key) => translate(locale, key),
    }),
    [appearance, client, fontScale, locale, notifications, reduceMotion, security, snapshot, theme],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences) {
    throw new Error("usePreferences must be used inside PreferencesProvider.");
  }
  return preferences;
}
