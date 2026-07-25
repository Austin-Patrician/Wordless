import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from "@wordless/ui-kit";
import { Bell } from "lucide-react";
import type { Locale, ThemeMode } from "../../shared/models";
import { usePreferences } from "../../shared/preferences";

export function GeneralSettings() {
  const { fontScale, locale, notifications, reduceMotion, setFontScale, setLocale, setNotifications, setReduceMotion, setTheme, t, theme } = usePreferences();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
      <div className="mx-auto max-w-[680px] space-y-2.5">
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <label className="block text-[13px] font-semibold" htmlFor="language-select">{t("displayLanguage")}</label>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("displayLanguageHelp")}</p>
            <Select onValueChange={(value) => setLocale(value as Locale)} value={locale}>
              <SelectTrigger className="min-w-[170px] rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="language-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="zh-CN">简体中文</SelectItem><SelectItem value="en-US">English</SelectItem></SelectContent>
            </Select>
          </div>
        </section>
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <label className="block text-[13px] font-semibold" htmlFor="theme-select">{t("theme")}</label>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("themeHelp")}</p>
            <Select onValueChange={(value) => setTheme(value as ThemeMode)} value={theme}>
              <SelectTrigger className="min-w-[170px] rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="theme-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="light">{t("light")}</SelectItem><SelectItem value="dark">{t("dark")}</SelectItem><SelectItem value="system">{t("system")}</SelectItem></SelectContent>
            </Select>
          </div>
        </section>
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div className="flex items-center justify-between"><label className="text-[13px] font-semibold" htmlFor="font-scale">{t("readingSize")}</label><span className="font-mono text-[10px] text-muted-foreground">{Math.round(fontScale * 100)}%</span></div>
          <Slider className="mt-4" id="font-scale" max={1.3} min={0.85} onValueChange={(value) => setFontScale(value[0] ?? 1)} step={0.05} value={[fontScale]} />
        </section>
        <section className="flex items-start justify-between gap-5 rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div><p className="text-[13px] font-semibold">{t("reduceMotion")}</p><p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("reduceMotionHelp")}</p></div>
          <Switch checked={reduceMotion} onCheckedChange={setReduceMotion} />
        </section>
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div className="flex items-start justify-between gap-5">
            <div className="flex min-w-0 gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-[#e0e0da] bg-white text-[#69794a] dark:border-border dark:bg-card dark:text-[#c8df89]"><Bell className="h-4 w-4" /></span><div><p className="text-[13px] font-semibold">{t("desktopNotifications")}</p><p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("desktopNotificationsHelp")}</p></div></div>
            <Switch aria-label={t("enableDesktopNotifications")} checked={notifications.enabled} onCheckedChange={(enabled) => setNotifications({ ...notifications, enabled })} />
          </div>
          <div className={`mt-4 divide-y divide-[#e1e1db] border-t border-[#e1e1db] dark:divide-border dark:border-border ${notifications.enabled ? "" : "opacity-45"}`}>
            <NotificationToggle checked={notifications.onActionRequired} description={t("notificationActionRequiredHelp")} disabled={!notifications.enabled} label={t("notificationActionRequired")} onCheckedChange={(onActionRequired) => setNotifications({ ...notifications, onActionRequired })} />
            <NotificationToggle checked={notifications.onRunCompleted} description={t("notificationRunCompletedHelp")} disabled={!notifications.enabled} label={t("notificationRunCompleted")} onCheckedChange={(onRunCompleted) => setNotifications({ ...notifications, onRunCompleted })} />
            <NotificationToggle checked={notifications.onRunFailed} description={t("notificationRunFailedHelp")} disabled={!notifications.enabled} label={t("notificationRunFailed")} onCheckedChange={(onRunFailed) => setNotifications({ ...notifications, onRunFailed })} />
          </div>
        </section>
      </div>
    </div>
  );
}

function NotificationToggle({
  checked,
  description,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return <div className="flex items-center justify-between gap-5 py-3"><div><p className="text-[12px] font-medium">{label}</p><p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{description}</p></div><Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></div>;
}
