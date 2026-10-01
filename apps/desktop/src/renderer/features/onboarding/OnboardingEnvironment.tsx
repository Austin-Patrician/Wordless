import { Button } from "@wordless/ui-kit";
import type { HostEnvironmentFacts } from "@wordless/protocol";
import { AlertTriangle, ArrowRight, Check, ChevronLeft, Download, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import { hostEnvironmentRows } from "../settings/environment-rows";

/**
 * 首次导览里的**环境一页**。
 *
 * 为什么单独一页而不是又一站高亮:这一页要**做事**(看状态、必要时点一次安装),而高亮卡片只能说明。
 * 它排在欢迎页之后、导览之前 —— 先把环境弄对,再看界面怎么用。
 *
 * 三条纪律:
 * - **可以跳过**:"跳过,稍后再说"永远在,而且不做任何事就往下走(不联网、不写盘)。
 * - **不吓人**:全好时只有一句"这台机器已经准备好了",不摆清单让人焦虑。
 * - **装不装由用户定**:页面只给一颗按钮和"装到哪、多大、要不要网",没有自动安装。
 */
export function OnboardingEnvironment({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  const [facts, setFacts] = useState<HostEnvironmentFacts | null>(null);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFacts(await client.getHostEnvironmentFacts());
    } catch {
      // 读不到就当"未知":这一页不是必经之路,不该因为它卡住整个导览。
      setFacts(null);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = useCallback(async () => {
    setInstalling(true);
    setNotice(null);
    setError(null);
    try {
      const result = await client.installHostPythonPackages();
      if (!result.ok) setError(result.message ?? t("environmentPythonInstallFailed"));
      else setNotice(result.installed.length > 0 ? t("environmentPythonInstalled") : t("environmentPythonAlreadyInstalled"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
    }
  }, [client, load, t]);

  const rows = facts ? hostEnvironmentRows(facts, t) : [];
  // 只有"agent 跑不跑得起来"那两行算数:Python 的组件只影响数据功能,不该在这一页拦住用户。
  const blocking = rows.filter((row) => row.id !== "python" && row.status !== "ok");
  const needsInstall = rows.some((row) => row.action === "install-python-packages");
  const ready = facts !== null && blocking.length === 0;

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-[var(--wordless-overlay-surface)] px-6 py-10">
      {/* 和欢迎页一样**不要卡片外壳**:这一页是同一个流程里的一步,不是浮在上面的对话框 ——
          边框 + 白底 + 投影会让它显得是"另一件事",而它其实就长在这张背景上。 */}
      <div
        aria-labelledby="onboarding-environment-title"
        aria-modal="true"
        className="w-full max-w-[520px]"
        role="dialog"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef4dc] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4a5b22] dark:bg-[#2a3320] dark:text-[#c8df89]">
          <Terminal className="h-3 w-3" aria-hidden />
          {t("onboardingEnvironmentBadge")}
        </span>
        <h2 className="mt-3 text-[17px] font-semibold text-[#232320] dark:text-foreground" id="onboarding-environment-title">
          {t("onboardingEnvironmentTitle")}
        </h2>
        <p className="mt-1.5 text-[12px] leading-5 text-[#63635c] dark:text-muted-foreground">{t("onboardingEnvironmentBody")}</p>

        <div className="mt-4 rounded-[14px] bg-[#f1f1ee] p-3.5 dark:bg-[#22241c]">
          {!facts ? (
            <p className="text-[12px] text-[#73736d] dark:text-muted-foreground">{t("environmentProbing")}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li className="flex items-start gap-2.5" key={row.id}>
                  <span aria-hidden className="mt-0.5 shrink-0">
                    {row.status === "ok" ? (
                      <Check className="h-3.5 w-3.5 text-[#5c7a2a] dark:text-[#c8df89]" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-[#9a6a2f] dark:text-[#e0b98a]" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] leading-5">
                    <span className="font-medium text-[#232320] dark:text-foreground">{t(row.labelKey)}</span>
                    {row.version ? (
                      <span className="ml-1.5 font-mono text-[11px] tabular-nums text-[#64645e] dark:text-muted-foreground">{row.version}</span>
                    ) : null}
                    <span className="ml-1.5 text-[11px] text-[#8a8a83] dark:text-muted-foreground">
                      {row.status !== "ok" ? (row.status === "partial" ? t("environmentStatusPartial") : t("environmentMissing")) : (row.detail ?? "")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {ready ? <p className="mt-3 text-[12px] leading-5 text-[#4a5b22] dark:text-[#c8df89]">{t("onboardingEnvironmentReady")}</p> : null}

          {needsInstall ? (
            <div className="mt-3 border-t border-[#e6e6e2] pt-3 dark:border-border">
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={installing} onClick={() => void install()} size="sm" type="button">
                  <Download className={installing ? "h-3.5 w-3.5 animate-pulse motion-reduce:animate-none" : "h-3.5 w-3.5"} />
                  {installing ? t("environmentPythonInstalling") : t("environmentPythonInstall")}
                </Button>
                <span className="text-[11px] text-[#8a8a83] dark:text-muted-foreground">{t("environmentPythonInstallHelp")}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div aria-live="polite" role="status">
          {notice ? <p className="mt-2.5 text-[12px] text-[#4a5b22] dark:text-[#c8df89]">{notice}</p> : null}
          {error ? <p className="mt-2.5 text-[12px] text-[#8a4b1f] dark:text-[#e0b98a]">{error}</p> : null}
        </div>

        <p className="mt-3 text-[11px] leading-5 text-[#8a8a83] dark:text-muted-foreground">{t("onboardingEnvironmentSettingsHint")}</p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          {/* 多步流程要给回退的路(上一步 → 欢迎页),而且它永远在最左边。 */}
          <Button onClick={onBack} size="sm" type="button" variant="ghost">
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            {t("onboardingBack")}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {/* 跳过永远在:不做任何事就往下走。 */}
            <Button onClick={onContinue} size="sm" type="button" variant="ghost">
              <X className="mr-1 h-3.5 w-3.5" />
              {t("onboardingEnvironmentLater")}
            </Button>
            {/* 有更该做的事时,"开始导览"退成描边 —— 一屏一个主按钮。 */}
            <Button onClick={onContinue} size="sm" type="button" variant={needsInstall ? "outline" : "default"}>
              {t("onboardingEnvironmentStart")}
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
