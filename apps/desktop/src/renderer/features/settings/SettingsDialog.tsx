import { Button } from "@wordless/ui-kit";
import { ArchiveX, BarChart3, BellRing, CircleHelp, Database, Keyboard, Package, Palette, Settings, ShieldAlert, SlidersHorizontal, Smartphone, Terminal, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { EnvironmentSettings } from "./EnvironmentSettings";
import { RemoteAccessSettings } from "./RemoteAccessSettings";
import { GeneralSettings } from "./GeneralSettings";
import { SessionHistorySettings } from "./SessionHistorySettings";
import { useOnboarding } from "../onboarding/OnboardingFlow";
import { ModelSettings } from "./ModelSettings";
import { ExtensionsSettings } from "./ExtensionsSettings";
import { TranslationSettings } from "./TranslationSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { SecuritySettings } from "./SecuritySettings";
import { PersonalizationSettings } from "./PersonalizationSettings";
import { UsageSettings } from "./UsageSettings";
import { usePreferences } from "../../shared/preferences";
import { useDesktopUpdate } from "../../platform/desktop-update";
import { AboutUpdatesSettings } from "./AboutUpdatesSettings";
import { DataPrivacySettings } from "./DataPrivacySettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { useShortcutScope } from "../../shared/shortcuts/use-shortcut-scope";
import { useBrowserOcclusion } from "../browser/use-occlusion";

export type SettingsPage = "general" | "models" | "assistant" | "shortcuts" | "usage" | "sessionHistory" | "security" | "personalization" | "dataPrivacy" | "notifications" | "environment" | "remoteAccess" | "about";

type SettingsDialogProps = {
  /** Opens a session from the history page and leaves Settings. */
  onOpenSession?: (sessionId: string) => void;
  initialPage?: SettingsPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ initialPage = "general", onOpenSession, open, onOpenChange }: SettingsDialogProps) {
  const { t } = usePreferences();
  const onboarding = useOnboarding();
  const [page, setPage] = useState<SettingsPage>("general");

  useEffect(() => {
    if (open) setPage(initialPage);
  }, [initialPage, open]);

  /**
   * Esc 关掉设置。
   *
   * 这是**每个模态都该有的那一条出路**:鼠标点不到关闭按钮时(见下面那条遮挡说明),
   * 用户至少还有一条确定能用的路。仓库里手写的模态(侧栏的删除确认、绕过审批确认、
   * 卸载确认)都各自处理了 Esc,设置这一层反而漏了。
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  // Settings is modal, so the global shortcuts must not run behind it: pressing
  // the key for "new task" while reading a preference should not start one.
  useShortcutScope({ active: open, claim: () => false, exclusive: true, id: "settings-dialog", kind: "modal" });

  /**
   * **声明遮挡**:内嵌浏览器那张原生视图永远画在所有 DOM 之上,和 `z-index` 无关。
   *
   * 不声明的话,设置弹窗右侧那一条会被它压住 —— 右上角的**关闭按钮正好在那条里**,
   * 于是"看得见、点不到"(真实反馈)。这里原来是靠采样兜底的:而采样是**概率性的**
   * (网格点落在被压住的那一小块之外就发现不了),所以设置这种"盖住一大片"的弹窗必须自己说。
   */
  useBrowserOcclusion(open, "dialog");

  if (!open) return null;

  return (
    <div
      aria-label={t("settingsTitle")}
      aria-modal="true"
      className="fixed inset-x-0 bottom-0 top-[30px] z-50 grid place-items-center bg-[#21211f]/45 p-4 backdrop-blur-[2px]"
      role="dialog"
    >
      <div className="relative flex h-[min(760px,calc(100vh-62px))] w-[min(1120px,100%)] overflow-hidden rounded-[22px] border border-white/50 bg-white text-foreground shadow-[0_28px_80px_rgba(0,0,0,0.25)] dark:border-border dark:bg-[#181912]">
        <SettingsSidebar page={page} onPageChange={setPage} />
        <div className="flex min-w-0 flex-1 flex-col">
          <SettingsHeader page={page} onClose={() => onOpenChange(false)} />
          {page === "general" ? <GeneralSettings onReplayOnboarding={() => { onOpenChange(false); onboarding?.replay(); }} /> : page === "sessionHistory" ? <SessionHistorySettings onOpenSession={onOpenSession} /> : page === "models" ? <ModelSettings /> : page === "assistant" ? <AssistantSettings /> : page === "shortcuts" ? <ShortcutSettings /> : page === "usage" ? <UsageSettings /> : page === "security" ? <SecuritySettings /> : page === "personalization" ? <PersonalizationSettings /> : page === "dataPrivacy" ? <DataPrivacySettings /> : page === "notifications" ? <NotificationsSettings /> : page === "environment" ? <EnvironmentSettings /> : page === "remoteAccess" ? <RemoteAccessSettings /> : <AboutUpdatesSettings />}
        </div>
      </div>
    </div>
  );
}

function SettingsHeader({ page, onClose }: { page: SettingsPage; onClose: () => void }) {
  const { t } = usePreferences();
  const title = page === "shortcuts" ? t("shortcutSettings") : page === "about" ? "About & Updates" : page === "sessionHistory" ? t("historyTitle") : page === "dataPrivacy" ? t("dataPrivacy") : page === "models" ? t("models") : page === "assistant" ? t("assistant") : page === "usage" ? t("usage") : page === "security" ? t("securityCenter") : page === "personalization" ? t("personalization") : page === "notifications" ? t("webhookSettings") : page === "environment" ? t("environmentTitle") : page === "remoteAccess" ? t("remoteAccessTitle") : t("general");
  const description = page === "shortcuts" ? t("shortcutSettingsHelp") : page === "about" ? "Version information, updates, and release history" : page === "sessionHistory" ? t("historyPageDescription") : page === "dataPrivacy" ? t("dataPrivacyDescription") : page === "models" ? t("configuredModels") : page === "assistant" ? t("assistantHelp") : page === "usage" ? t("usageHelp") : page === "security" ? t("securityCenterHelp") : page === "personalization" ? t("personalizationHelp") : page === "notifications" ? t("webhookSettingsHelp") : page === "environment" ? t("environmentDescription") : page === "remoteAccess" ? t("remoteAccessDescription") : t("configure");

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-5 sm:px-9">
      <div>
        <p className="text-[21px] font-semibold">{title}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
      </div>
      <Button aria-label={t("closeSettings")} className="text-muted-foreground" onClick={onClose} size="icon" type="button" variant="ghost">
        <X className="h-5 w-5" />
      </Button>
    </header>
  );
}

function SettingsSidebar({ page, onPageChange }: { page: SettingsPage; onPageChange: (page: SettingsPage) => void }) {
  const { t } = usePreferences();
  const { appInfo } = useDesktopUpdate();
  return (
    <aside className="hidden w-[238px] shrink-0 flex-col border-r border-border bg-[#f4f4f1] p-3 dark:bg-[#202219] sm:flex">
      <div className="px-3 pb-5 pt-2">
        <p className="text-sm font-bold">{t("settingsTitle")}</p>
        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">Wordless / v{appInfo?.version ?? "-"}</p>
      </div>
      <nav className="space-y-1">
        <SettingsNav active={page === "general"} icon={Settings} label={t("general")} onClick={() => onPageChange("general")} />
        <SettingsNav active={page === "models"} icon={Package} label={t("models")} onClick={() => onPageChange("models")} />
        <SettingsNav active={page === "assistant"} icon={SlidersHorizontal} label={t("assistant")} onClick={() => onPageChange("assistant")} />
        <SettingsNav active={page === "shortcuts"} icon={Keyboard} label={t("shortcutSettings")} onClick={() => onPageChange("shortcuts")} />
        <SettingsNav active={page === "usage"} icon={BarChart3} label={t("usage")} onClick={() => onPageChange("usage")} />
        <SettingsNav active={page === "sessionHistory"} icon={ArchiveX} label={t("historyTitle")} onClick={() => onPageChange("sessionHistory")} />
        <SettingsNav active={page === "security"} icon={ShieldAlert} label={t("securityCenter")} onClick={() => onPageChange("security")} />
        <SettingsNav active={page === "personalization"} icon={Palette} label={t("personalization")} onClick={() => onPageChange("personalization")} />
        <SettingsNav active={page === "dataPrivacy"} icon={Database} label={t("dataPrivacy")} onClick={() => onPageChange("dataPrivacy")} />
        <SettingsNav active={page === "notifications"} icon={BellRing} label={t("webhookSettings")} onClick={() => onPageChange("notifications")} />
        <SettingsNav active={page === "environment"} icon={Terminal} label={t("environmentTitle")} onClick={() => onPageChange("environment")} />
        <SettingsNav active={page === "remoteAccess"} icon={Smartphone} label={t("remoteAccessTitle")} onClick={() => onPageChange("remoteAccess")} />
      </nav>
      <nav className="mt-auto border-t border-border pt-3">
        <SettingsNav active={page === "about"} icon={CircleHelp} label="About & Updates" onClick={() => onPageChange("about")} />
      </nav>
    </aside>
  );
}

/**
 * The Assistant page groups what shapes assistant behaviour: how replies are
 * translated, and which extensions are active. It owns the scroll container so
 * both sections share one scrollbar instead of competing for height.
 */
function AssistantSettings() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <TranslationSettings />
      <ExtensionsSettings />
    </div>
  );
}

function SettingsNav({ active, icon: Icon, label, onClick }: { active: boolean; icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium ${active ? "bg-white text-foreground shadow-sm dark:bg-[#2a2c22]" : "text-muted-foreground hover:bg-[#e8e8e4] dark:hover:bg-[#282a21]"}`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
