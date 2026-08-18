import { Button } from "@wordless/ui-kit";
import { AlertTriangle, Check, Database, ExternalLink, KeyRound, LoaderCircle, Network, ShieldCheck, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import type { CloudSyncInitialStrategy, CloudSyncSnapshot } from "@wordless/protocol";
import { Switch } from "@wordless/ui-kit";
import { useDesktopUpdate } from "../../platform/desktop-update";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import { useDesktopAccount } from "../../shared/account";
import githubIcon from "../../../icons/common-icons/github.svg";
import syncIcon from "../../../icons/common-icons/立即同步.svg";
import deleteCloudIcon from "../../../icons/common-icons/删除云端数据.svg";
import googleCloudIcon from "../../../icons/common-icons/google_cloud-icon.svg";

type InfoSectionProps = {
  description: string;
  icon: typeof Database;
  items?: string[];
  title: string;
};

function InfoSection({ description, icon: Icon, items, title }: InfoSectionProps) {
  return (
    <section className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-border bg-muted/40 text-muted-foreground dark:text-[#c8df89]">
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</p>
          {items?.length ? <ul className="mt-3 space-y-1.5 text-[11px] leading-5 text-muted-foreground">{items.map((item) => <li className="flex gap-2" key={item}><span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#93a66a]" />{item}</li>)}</ul> : null}
        </div>
      </div>
    </section>
  );
}

export function DataPrivacySettings() {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  const { appInfo, openReleasePage } = useDesktopUpdate();
  const { account } = useDesktopAccount();
  const [sync, setSync] = useState<CloudSyncSnapshot | null>(null);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void client.getCloudSyncSnapshot().then((value) => { if (active) setSync(value); }).catch(() => undefined);
    const unsubscribe = client.subscribeHost((event) => { if (event.type === "cloud-sync.changed") setSync(event.snapshot); });
    return () => { active = false; unsubscribe(); };
  }, [client]);

  const run = async (operation: () => Promise<CloudSyncSnapshot>) => {
    setBusy(true); setNotice(null);
    try { setSync(await operation()); } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const statusLabel = sync ? ({ disabled: t("cloudSyncDisabled"), idle: t("cloudSyncIdle"), syncing: t("cloudSyncSyncing"), synced: t("cloudSyncSynced"), offline: t("cloudSyncOffline"), error: t("cloudSyncError"), "needs-reconnect": t("cloudSyncReconnect"), conflict: t("cloudSyncConflict") }[sync.status]) : t("cloudSyncDisabled");
  const enable = (strategy: CloudSyncInitialStrategy) => { setStrategyOpen(false); void run(() => client.enableCloudSync(strategy)); };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
      <div className="mx-auto max-w-[780px] space-y-4">
        <section className="border-b border-border pb-5">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-[#cfd9b8] bg-[#f5f8eb] text-[#60753a] dark:border-[#53663a] dark:bg-[#303b1d] dark:text-[#d7efa5]"><ShieldCheck aria-hidden="true" className="h-4 w-4" /></span>
            <div><h2 className="text-[14px] font-semibold">{t("dataPrivacySummaryTitle")}</h2><p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("dataPrivacySummaryBody")}</p><p className="mt-2 text-[10px] leading-4 text-muted-foreground">{t("dataPrivacyCurrentArchitecture")}</p></div>
          </div>
        </section>

        <div className="divide-y divide-border border-b border-border">
          <InfoSection description={t("dataPrivacyLocalBody")} icon={Database} items={[t("dataPrivacyLocalSessions"), t("dataPrivacyLocalSettings"), t("dataPrivacyLocalArtifacts")]} title={t("dataPrivacyLocalTitle")} />
          <InfoSection description={t("dataPrivacyProviderBody")} icon={Network} items={[t("dataPrivacyProviderPrompt"), t("dataPrivacyProviderFiles"), t("dataPrivacyProviderPolicy")]} title={t("dataPrivacyProviderTitle")} />
          <InfoSection description={t("dataPrivacyCredentialsBody")} icon={KeyRound} items={[t("dataPrivacyCredentialsEncrypted"), t("dataPrivacyCredentialsExcluded"), t("dataPrivacyCredentialsOs")]} title={t("dataPrivacyCredentialsTitle")} />
          <InfoSection description={t("dataPrivacyNetworkBody")} icon={Wifi} items={[t("dataPrivacyNetworkModels"), t("dataPrivacyNetworkUpdates"), t("dataPrivacyNetworkExternal")]} title={t("dataPrivacyNetworkTitle")} />
        </div>

        <section className="border-b border-border py-5">
          <div className="flex items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-[#d8e3f4] bg-[#f4f8ff] dark:border-[#3b4b63] dark:bg-[#202b3b]"><img alt="" aria-hidden="true" className="h-5 w-5 object-contain" src={googleCloudIcon} /></span>
              <div className="min-w-0"><h2 className="text-[13px] font-semibold">{t("cloudSyncTitle")}</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("cloudSyncDescription")}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{t("cloudSyncPermission")}</p></div>
            </div>
            <Switch aria-label={t("cloudSyncTitle")} checked={sync?.enabled ?? false} disabled={busy || account?.status !== "signed-in"} onCheckedChange={(checked) => { if (checked) setStrategyOpen(true); else void run(() => client.disableCloudSync()); }} />
          </div>
          <div className="mt-4 grid gap-2 border-y border-border/70 py-3 text-[10px] leading-4 sm:grid-cols-2 sm:gap-4"><p className="border-l-2 border-[#8ca3c7] pl-2.5 text-muted-foreground"><span className="font-medium text-foreground">{t("cloudSyncIncluded")}</span></p><p className="border-l-2 border-[#c8c8c0] pl-2.5 text-muted-foreground"><span className="font-medium text-foreground">{t("cloudSyncExcluded")}</span></p></div>
          {account?.status !== "signed-in" ? <p className="mt-3 rounded-[7px] border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">{t("cloudSyncSignedOut")}</p> : null}
          {sync ? <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1"><span className={`h-1.5 w-1.5 rounded-full ${sync.status === "synced" ? "bg-emerald-500" : sync.status === "error" || sync.status === "conflict" ? "bg-amber-500" : "bg-muted-foreground/50"}`} />{statusLabel}</span>{sync.accountEmail ? <span>{sync.accountEmail}</span> : null}{sync.pendingCount > 0 ? <span>{sync.pendingCount} {t("cloudSyncPending")}</span> : null}{sync.lastSyncAt ? <span>{t("cloudSyncLastSync")} {new Date(sync.lastSyncAt).toLocaleString()}</span> : <span>{t("cloudSyncNever")}</span>}</div> : null}
          {sync?.lastError ? <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{sync.lastError}</p> : null}
          {sync?.conflicts.length ? <div className="mt-3 rounded-[7px] border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-700/60 dark:bg-amber-950/20"><p className="text-[11px] font-medium">{t("cloudSyncConflictHelp")}</p><p className="mt-1 text-[10px] text-muted-foreground">{sync.conflicts.slice(0, 3).join(", ")}{sync.conflicts.length > 3 ? "…" : ""}</p><div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run(() => client.resolveCloudSyncConflict("local"))} size="sm" type="button" variant="outline">{t("cloudSyncKeepLocal")}</Button><Button disabled={busy} onClick={() => void run(() => client.resolveCloudSyncConflict("remote"))} size="sm" type="button" variant="outline">{t("cloudSyncKeepRemote")}</Button></div></div> : null}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/70 pt-3"><Button className="gap-1.5" disabled={busy || !sync?.enabled} onClick={() => void run(() => client.syncCloudNow())} size="sm" type="button" variant="outline">{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <img alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain" src={syncIcon} />}{t("cloudSyncSyncNow")}</Button><Button className="gap-1.5 text-destructive hover:text-destructive" disabled={busy || !sync?.enabled} onClick={() => { if (window.confirm(t("cloudSyncDeleteConfirm"))) void run(() => client.deleteCloudSyncRemote()); }} size="sm" type="button" variant="ghost"><span className="grid h-5 w-5 place-items-center rounded-[4px] bg-destructive"><img alt="" aria-hidden="true" className="h-3 w-3 object-contain" src={deleteCloudIcon} /></span>{t("cloudSyncDeleteRemote")}</Button></div>
          {notice ? <p className="mt-2 text-[11px] text-destructive">{notice}</p> : null}
          {strategyOpen ? <div className="mt-4 rounded-[8px] border border-border bg-muted/20 p-3"><p className="text-[11px] font-medium">{t("cloudSyncChooseStrategy")}</p><div className="mt-2 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => enable("merge")} size="sm" type="button"><Check className="h-3.5 w-3.5" />{t("cloudSyncMerge")}</Button><Button disabled={busy} onClick={() => enable("local")} size="sm" type="button" variant="outline">{t("cloudSyncLocal")}</Button><Button disabled={busy} onClick={() => enable("remote")} size="sm" type="button" variant="outline">{t("cloudSyncRemote")}</Button><Button disabled={busy} onClick={() => setStrategyOpen(false)} size="sm" type="button" variant="ghost">{t("cloudSyncCancel")}</Button></div></div> : null}
        </section>

        <section className="flex flex-col gap-3 border-b border-border py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h2 className="text-[13px] font-semibold">{t("dataPrivacyGithubTitle")}</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("dataPrivacyGithubBody")}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><Button disabled={!appInfo?.repositoryUrl} onClick={() => { if (appInfo?.repositoryUrl) void client.openExternalUrl(appInfo.repositoryUrl); }} size="sm" type="button" variant="outline"><img alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain dark:invert" src={githubIcon} />{t("dataPrivacyGithubRepo")}</Button><Button onClick={() => void openReleasePage()} size="sm" type="button" variant="outline"><ExternalLink className="h-3.5 w-3.5" />{t("dataPrivacyGithubReleases")}</Button></div>
        </section>
      </div>
    </div>
  );
}
