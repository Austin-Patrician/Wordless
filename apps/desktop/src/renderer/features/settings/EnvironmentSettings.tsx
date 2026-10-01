import { Button } from "@wordless/ui-kit";
import type { HostEnvironmentFacts } from "@wordless/protocol";
import { AlertTriangle, Check, Download, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import { hostEnvironmentRows, type EnvironmentRow } from "./environment-rows";

const PYTHON_DOWNLOAD_URL = "https://www.python.org/downloads/";

/**
 * 设置 → 环境。
 *
 * **只读**:这个面板只回答"这台机器上有什么",一个字节都不写、也不替你装任何东西。装与不装是用户的
 * 决定,面板只给出路,而且说清"装到哪、多大、要不要网"。
 *
 * 界面上的几条取舍(按 UI/UX 规则的优先级挑的):
 * - **状态不只靠颜色**(color-not-only):每一行都有图标 + 文字芯片,"绿/黄/红"只是辅助。
 * - **探测期间给骨架屏**(progressive-loading):探测要起几个子进程,一秒左右的空窗比一行"检测中"
 *   更不像卡住;并且 `motion-reduce:animate-none` 尊重"减少动效"。
 * - **一屏一个主按钮**(primary-action):缺组件时"安装"是主按钮,"重新探测"退成描边;平时反过来。
 * - **错误要能被读出来**(aria-live):成功/失败都在 `role="status"` 区域里播报,并且给出恢复动作
 *   (失败时那句话本身就说"检查网络后重试")。
 */
export function EnvironmentSettings() {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  const [facts, setFacts] = useState<HostEnvironmentFacts | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (redetect: boolean) => {
      setBusy(true);
      try {
        const next = redetect ? await client.redetectHostEnvironment() : await client.getHostEnvironmentFacts();
        setFacts(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  /**
   * 按需装包。**只有用户点了才会联网**;装完就地重探,状态立刻反映出来(不需要重启)。
   */
  const installPackages = useCallback(async () => {
    setInstalling(true);
    setNotice(null);
    setError(null);
    try {
      const result = await client.installHostPythonPackages();
      if (!result.ok) setError(result.message ?? t("environmentPythonInstallFailed"));
      else setNotice(result.installed.length > 0 ? t("environmentPythonInstalled") : t("environmentPythonAlreadyInstalled"));
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
    }
  }, [client, load, t]);

  const rows = facts ? hostEnvironmentRows(facts, t) : [];
  const needsInstall = rows.some((row) => row.action === "install-python-packages");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
      <div className="mx-auto max-w-[680px] space-y-2.5">
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold">{t("environmentTitle")}</h2>
              {/* 这一句是整页的总述(提供什么、缺什么会写在这、这一页只读),所以放顶部 —— 页脚那句
                  属于"开场就该知道"的信息,压在底下没人看。 */}
              <p className="mt-1 text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{t("environmentLead")}</p>
            </div>
            {/* 有更要紧的动作时,重新探测退成描边 —— 一屏只有一个主按钮。 */}
            <Button
              disabled={busy}
              onClick={() => void load(true)}
              size="sm"
              type="button"
              variant={needsInstall ? "ghost" : "outline"}
            >
              <RefreshCw className={busy ? "h-3.5 w-3.5 animate-spin motion-reduce:animate-none" : "h-3.5 w-3.5"} />
              {t("environmentRecheck")}
            </Button>
          </div>
        </section>

        {/* 成功与失败都播报出来:视觉之外还有一条给读屏的通道。 */}
        <div aria-live="polite" className="space-y-2.5" role="status">
          {notice ? (
            <section className="rounded-2xl border border-[#dfe6cf] bg-[#f5f8ec] p-4 text-[12px] text-[#4a5b22] dark:border-[#3d4a24] dark:bg-[#232a18] dark:text-[#c8df89]">
              {notice}
            </section>
          ) : null}
          {error ? (
            <section className="rounded-2xl border border-[#e6d5c8] bg-[#fdf6f0] p-4 text-[12px] text-[#8a4b1f] dark:border-[#4a3a2a] dark:bg-[#2a2318] dark:text-[#e0b98a]">
              {error}
            </section>
          ) : null}
        </div>

        {!facts ? (
          <ul className="space-y-2.5">
            {[0, 1, 2].map((index) => (
              <li className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]" key={index}>
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 shrink-0 animate-pulse rounded-[8px] bg-[#ecece7] motion-reduce:animate-none dark:bg-[#2c2e25]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3 w-24 animate-pulse rounded-full bg-[#ecece7] motion-reduce:animate-none dark:bg-[#2c2e25]" />
                    <span className="block h-2.5 w-40 animate-pulse rounded-full bg-[#f1f1ec] motion-reduce:animate-none dark:bg-[#262820]" />
                  </div>
                </div>
                <span className="sr-only">{t("environmentProbing")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((row) => (
              <EnvironmentRowItem installing={installing} key={row.id} onInstall={() => void installPackages()} row={row} />
            ))}
          </ul>
        )}

      </div>
    </div>
  );
}

function EnvironmentRowItem({
  installing,
  onInstall,
  row,
}: {
  installing: boolean;
  onInstall: () => void;
  row: EnvironmentRow;
}) {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  const tone =
    row.status === "ok"
      ? {
          badge: "border-[#dfe6cf] text-[#5c7a2a] dark:border-[#3d4a24] dark:text-[#c8df89]",
          chip: "bg-[#eef4dc] text-[#4a5b22] dark:bg-[#2a3320] dark:text-[#c8df89]",
        }
      : {
          badge: "border-[#e6d5c8] text-[#9a6a2f] dark:border-[#4a3a2a] dark:text-[#e0b98a]",
          chip: "bg-[#faf0e6] text-[#8a4b1f] dark:bg-[#2f2620] dark:text-[#e0b98a]",
        };

  return (
    <li className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
      <div className="flex min-w-0 gap-3">
        <span
          aria-hidden
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border bg-white dark:bg-[#1c1d18] ${tone.badge}`}
        >
          {row.status === "ok" ? <Check className="h-4 w-4" /> : row.status === "partial" ? <AlertTriangle className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-semibold">{t(row.labelKey)}</p>
            {/* 芯片带文字:状态不能只靠颜色(色盲、灰度屏、读屏都要能分辨)。 */}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone.chip}`}>
              {row.status === "ok" ? t("environmentStatusOk") : row.status === "partial" ? t("environmentStatusPartial") : t("environmentMissing")}
            </span>
            {row.version ? (
              <span className="font-mono text-[11px] tabular-nums text-[#64645e] dark:text-muted-foreground">{row.version}</span>
            ) : null}
            {row.detail ? <span className="text-[11px] text-[#8a8a83] dark:text-muted-foreground">{row.detail}</span> : null}
          </div>
          {row.location ? (
            <p className="mt-1 truncate font-mono text-[10px] text-[#8a8a83] dark:text-muted-foreground" title={row.location}>
              {row.location}
            </p>
          ) : null}
          {row.hint ? <p className="mt-1 text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{row.hint}</p> : null}

          {row.action === "install-python-packages" ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button disabled={installing} onClick={onInstall} size="sm" type="button">
                <Download className={installing ? "h-3.5 w-3.5 animate-pulse motion-reduce:animate-none" : "h-3.5 w-3.5"} />
                {installing ? t("environmentPythonInstalling") : t("environmentPythonInstall")}
              </Button>
              <span className="text-[11px] text-[#8a8a83] dark:text-muted-foreground">{t("environmentPythonInstallHelp")}</span>
            </div>
          ) : null}

          {row.action === "python-download" ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button onClick={() => void client.openExternalUrl(PYTHON_DOWNLOAD_URL)} size="sm" type="button" variant="outline">
                {t("environmentPythonDownload")}
              </Button>
              {/* 环境与 PATH 是启动时读一次的:不说清这一步,用户会以为按钮没生效。 */}
              <span className="text-[11px] text-[#8a8a83] dark:text-muted-foreground">{t("environmentPythonRestart")}</span>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
