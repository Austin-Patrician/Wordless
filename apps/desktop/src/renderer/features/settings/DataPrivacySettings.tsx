import { Button } from "@wordless/ui-kit";
import { ArrowRight, Database, ExternalLink, KeyRound, Network, ShieldCheck, Wifi } from "lucide-react";
import { useDesktopUpdate } from "../../platform/desktop-update";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import githubIcon from "../../../icons/common-icons/github.svg";

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

type FlowStepProps = {
  detail: string;
  icon: typeof Database;
  label: string;
};

function FlowStep({ detail, icon: Icon, label }: FlowStepProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:block" role="listitem">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] border border-border bg-muted/30 px-3 py-2.5 sm:block sm:min-h-[112px]">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-[#cfd9b8] bg-[#f5f8eb] text-[#60753a] dark:border-[#53663a] dark:bg-[#303b1d] dark:text-[#c8df89]"><Icon aria-hidden="true" className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 sm:mt-3"><p className="text-[11px] font-semibold text-foreground">{label}</p><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{detail}</p></div>
      </div>
      <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rotate-90 text-muted-foreground/60 sm:mx-auto sm:mt-3 sm:block sm:rotate-0" />
    </div>
  );
}

export function DataPrivacySettings() {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  const { appInfo, openReleasePage } = useDesktopUpdate();

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
          <div><h2 className="text-[13px] font-semibold">{t("dataPrivacyFlowTitle")}</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("dataPrivacyFlowBody")}</p></div>
          <div className="mt-4 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-0" aria-label={t("dataPrivacyFlowTitle")} role="list">
            <FlowStep detail={t("dataPrivacyFlowLocalDetail")} icon={Database} label={t("dataPrivacyFlowLocal")} />
            <FlowStep detail={t("dataPrivacyFlowAgentDetail")} icon={ShieldCheck} label={t("dataPrivacyFlowAgent")} />
            <FlowStep detail={t("dataPrivacyFlowProviderDetail")} icon={Network} label={t("dataPrivacyFlowProvider")} />
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:block" role="listitem"><div className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] border border-border bg-muted/30 px-3 py-2.5 sm:block sm:min-h-[112px]"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-[#d4d8e4] bg-[#f5f6fa] text-[#66728c] dark:border-[#4b5268] dark:bg-[#2d3140] dark:text-[#bbc5e1]"><img alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain dark:invert" src={githubIcon} /></span><div className="min-w-0 sm:mt-3"><p className="text-[11px] font-semibold text-foreground">{t("dataPrivacyFlowGithub")}</p><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{t("dataPrivacyFlowGithubDetail")}</p></div></div></div>
          </div>
        </section>

        <section className="flex flex-col gap-3 border-b border-border py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><h2 className="text-[13px] font-semibold">{t("dataPrivacyGithubTitle")}</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("dataPrivacyGithubBody")}</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><Button disabled={!appInfo?.repositoryUrl} onClick={() => { if (appInfo?.repositoryUrl) void client.openExternalUrl(appInfo.repositoryUrl); }} size="sm" type="button" variant="outline"><img alt="" aria-hidden="true" className="h-3.5 w-3.5 object-contain dark:invert" src={githubIcon} />{t("dataPrivacyGithubRepo")}</Button><Button onClick={() => void openReleasePage()} size="sm" type="button" variant="outline"><ExternalLink className="h-3.5 w-3.5" />{t("dataPrivacyGithubReleases")}</Button></div>
        </section>
      </div>
    </div>
  );
}
