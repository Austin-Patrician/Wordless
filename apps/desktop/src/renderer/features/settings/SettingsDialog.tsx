import { Button } from "@wordless/ui-kit";
import { BarChart3, Database, Package, Palette, Settings, ShieldAlert, SlidersHorizontal, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { GeneralSettings } from "./GeneralSettings";
import { ModelSettings } from "./ModelSettings";
import { ExtensionsSettings } from "./ExtensionsSettings";
import { SecuritySettings } from "./SecuritySettings";
import { PersonalizationSettings } from "./PersonalizationSettings";
import { UsageSettings } from "./UsageSettings";
import { usePreferences } from "../../shared/preferences";

export type SettingsPage = "general" | "models" | "assistant" | "usage" | "security" | "personalization";

type SettingsDialogProps = {
  initialPage?: SettingsPage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ initialPage = "general", open, onOpenChange }: SettingsDialogProps) {
  const { t } = usePreferences();
  const [page, setPage] = useState<SettingsPage>("general");

  useEffect(() => {
    if (open) setPage(initialPage);
  }, [initialPage, open]);

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
          {page === "general" ? <GeneralSettings /> : page === "models" ? <ModelSettings /> : page === "assistant" ? <ExtensionsSettings /> : page === "usage" ? <UsageSettings /> : page === "security" ? <SecuritySettings /> : <PersonalizationSettings />}
        </div>
      </div>
    </div>
  );
}

function SettingsHeader({ page, onClose }: { page: SettingsPage; onClose: () => void }) {
  const { t } = usePreferences();
  const title = page === "models" ? t("models") : page === "assistant" ? t("assistant") : page === "usage" ? t("usage") : page === "security" ? t("securityCenter") : page === "personalization" ? t("personalization") : t("general");
  const description = page === "models" ? t("configuredModels") : page === "assistant" ? t("extensionsHelp") : page === "usage" ? t("usageHelp") : page === "security" ? t("securityCenterHelp") : page === "personalization" ? t("personalizationHelp") : t("configure");

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
  return (
    <aside className="hidden w-[238px] shrink-0 border-r border-border bg-[#f4f4f1] p-3 dark:bg-[#202219] sm:block">
      <div className="px-3 pb-5 pt-2">
        <p className="text-sm font-bold">{t("settingsTitle")}</p>
        <p className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">Wordless / v0.1</p>
      </div>
      <nav className="space-y-1">
        <SettingsNav active={page === "general"} icon={Settings} label={t("general")} onClick={() => onPageChange("general")} />
        <SettingsNav active={page === "models"} icon={Package} label={t("models")} onClick={() => onPageChange("models")} />
        <SettingsNav active={page === "assistant"} icon={SlidersHorizontal} label={t("assistant")} onClick={() => onPageChange("assistant")} />
        <SettingsNav active={page === "usage"} icon={BarChart3} label={t("usage")} onClick={() => onPageChange("usage")} />
        <SettingsNav active={page === "security"} icon={ShieldAlert} label={t("securityCenter")} onClick={() => onPageChange("security")} />
        <SettingsNav active={page === "personalization"} icon={Palette} label={t("personalization")} onClick={() => onPageChange("personalization")} />
        <SettingsNav active={false} icon={Database} label={t("dataPrivacy")} onClick={() => undefined} />
      </nav>
    </aside>
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
