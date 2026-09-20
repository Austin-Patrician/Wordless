import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { translate, type MessageKey } from "./i18n";
import type { Locale, ThemeMode } from "./models";
import { useRuntime } from "./runtime";
import {
  normalizeShortcutBindings,
  normalizeSidebarPreferences,
  SIDEBAR_PINNED_LIMIT_DEFAULT,
  type AppearancePreferences,
  type NotificationPreferences,
  type SecurityPreferences,
  type ShortcutBindings,
  type ShortcutPreferences,
  type SidebarPreferences,
  type TranslationPreferences,
} from "@wordless/domain";

const defaultAppearance: AppearancePreferences = {
  background: {
    source: { kind: "none" },
    fit: "cover",
    position: { x: 50, y: 50 },
    intensity: 40,
    blurPx: 0,
  },
};

/** Mirrors the runtime defaults so the interface works before the first snapshot arrives. */
const defaultTranslation: TranslationPreferences = {
  targetLanguage: null,
  model: null,
  bubbleMaxChars: 600,
};

/** Every action keeps its default until the user rebinds it. */
const defaultShortcuts: ShortcutPreferences = { bindings: {} };

/** Nothing arranged yet: the sidebar falls back to its built-in split. */
const defaultSidebar: SidebarPreferences = { layout: { pinned: [], more: [] }, pinnedLimit: SIDEBAR_PINNED_LIMIT_DEFAULT };

type Preferences = {
  locale: Locale;
  theme: ThemeMode;
  fontScale: number;
  reduceMotion: boolean;
  notifications: NotificationPreferences;
  security: SecurityPreferences;
  appearance: AppearancePreferences;
  translation: TranslationPreferences;
  shortcuts: ShortcutPreferences;
  sidebar: SidebarPreferences;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
  setFontScale: (fontScale: number) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setNotifications: (notifications: NotificationPreferences) => void;
  setSecurity: (security: SecurityPreferences) => Promise<void>;
  previewAppearance: (appearance: AppearancePreferences) => void;
  setAppearance: (appearance: AppearancePreferences) => Promise<void>;
  setTranslation: (translation: TranslationPreferences) => Promise<void>;
  /** Replaces the whole binding set; unknown actions and malformed combos are dropped. */
  setShortcutBindings: (bindings: ShortcutBindings) => Promise<void>;
  /** Replaces the sidebar arrangement; malformed keys and a limit out of range are repaired. */
  setSidebar: (sidebar: SidebarPreferences) => Promise<void>;
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
  const [translation, setTranslationPreferences] = useState<TranslationPreferences>(defaultTranslation);
  const [shortcuts, setShortcutPreferences] = useState<ShortcutPreferences>(defaultShortcuts);
  const [sidebar, setSidebarPreferences] = useState<SidebarPreferences>(defaultSidebar);

  useEffect(() => {
    if (!snapshot) return;
    setLocale(snapshot.preferences.locale);
    setTheme(snapshot.preferences.theme);
    setFontScale(snapshot.preferences.fontScale);
    setReduceMotion(snapshot.preferences.reduceMotion);
    setNotifications(snapshot.preferences.notifications);
    setSecurityPreferences(snapshot.preferences.security);
    setAppearancePreferences(snapshot.preferences.appearance);
    setTranslationPreferences(snapshot.preferences.translation ?? defaultTranslation);
    setShortcutPreferences(snapshot.preferences.shortcuts ?? defaultShortcuts);
    setSidebarPreferences(snapshot.preferences.sidebar ?? defaultSidebar);
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
      translation,
      shortcuts,
      sidebar,
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
      setTranslation: async (nextTranslation) => {
        setTranslationPreferences(nextTranslation);
        if (snapshot && client) await client.setPreferences({ ...snapshot.preferences, translation: nextTranslation });
      },
      setShortcutBindings: async (nextBindings) => {
        // Normalize before storing: the dispatcher and the stored row then agree
        // on what a binding looks like.
        const nextShortcuts: ShortcutPreferences = { bindings: normalizeShortcutBindings(nextBindings) };
        setShortcutPreferences(nextShortcuts);
        if (snapshot && client) await client.setPreferences({ ...snapshot.preferences, shortcuts: nextShortcuts });
      },
      setSidebar: async (nextSidebar) => {
        // Normalize before storing so the arrangement the sidebar renders and
        // the arrangement on disk are the same shape.
        const next = normalizeSidebarPreferences(nextSidebar);
        setSidebarPreferences(next);
        if (snapshot && client) await client.setPreferences({ ...snapshot.preferences, sidebar: next });
      },
      t: (key) => translate(locale, key),
    }),
    [appearance, client, fontScale, locale, notifications, reduceMotion, security, shortcuts, sidebar, snapshot, theme, translation],
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
