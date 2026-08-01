import { Button } from "@wordless/ui-kit";
import { AlertCircle, Check, Download, ExternalLink, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDesktopUpdate } from "../../platform/desktop-update";
import { useRuntime } from "../../shared/runtime";
import wordlessIcon from "../../../icons/common-icons/wordless.png";
import githubIcon from "../../../icons/common-icons/github.svg";

function releaseDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function AboutUpdatesSettings() {
  const update = useDesktopUpdate();
  const { client } = useRuntime();
  const { appInfo, snapshot } = update;

  useEffect(() => {
    void update.loadReleases();
  }, [update.loadReleases]);

  const checking = snapshot?.state === "checking";
  const downloading = snapshot?.state === "downloading";
  const ready = snapshot?.state === "ready";
  const available = snapshot?.state === "available";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[780px] px-6 pb-14 pt-8 sm:px-9">
        <section className="about-product-band">
          <img alt="Wordless" className="h-16 w-16 shrink-0 rounded-[8px] object-cover shadow-sm" draggable={false} src={wordlessIcon} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[24px] font-semibold leading-tight">{appInfo?.name ?? "Wordless"}</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">Local-first desktop agent workspace</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase text-muted-foreground">
              <span>Version {appInfo?.version ?? "-"}</span><span aria-hidden="true">/</span><span>{appInfo ? `${appInfo.platform} ${appInfo.arch}` : "Loading platform"}</span>
            </div>
          </div>
          <Button onClick={() => void update.openReleasePage()} type="button" variant="outline"><img alt="" aria-hidden="true" className="h-4 w-4 object-contain dark:invert" src={githubIcon} />github.com/Austin-Patrician/Wordless</Button>
        </section>

        <section className="about-update-row" aria-label="Update status">
          <div className={`about-update-status ${snapshot?.state === "error" ? "is-error" : ready || snapshot?.state === "up-to-date" ? "is-ready" : ""}`}>
            {checking || downloading ? <LoaderCircle className="animate-spin" /> : snapshot?.state === "error" ? <AlertCircle /> : ready || snapshot?.state === "up-to-date" ? <Check /> : <RefreshCw />}
          </div>
          <div className="min-w-0 flex-1">
            <h3>{snapshot?.state === "error" ? "Update check failed" : ready ? "Update ready" : downloading ? "Downloading update" : available ? `Version ${snapshot.availableVersion} is available` : snapshot?.state === "up-to-date" ? "Wordless is up to date" : checking ? "Checking for updates" : "Updates"}</h3>
            <p>{snapshot?.state === "error" ? snapshot.error : ready ? snapshot.installMode === "open-installer" ? "The installer is verified. Open the DMG and move Wordless to Applications." : "Restart Wordless to finish installing the update." : downloading ? `${snapshot.progress ?? 0}% downloaded` : available ? "Installation is optional. You can continue using the current version." : appInfo?.packaged === false ? "Update checks are available in packaged builds." : snapshot?.checkedAt ? `Last checked ${new Date(snapshot.checkedAt).toLocaleString()}` : "Check GitHub for the latest stable release."}</p>
            {downloading ? <div className="about-update-progress"><i style={{ width: `${Math.max(0, Math.min(100, snapshot?.progress ?? 0))}%` }} /></div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {available ? <Button disabled={downloading} onClick={() => void update.download()} type="button"><Download className="h-4 w-4" />Download</Button> : ready ? <Button onClick={() => void update.install()} type="button">{snapshot.installMode === "open-installer" ? <ExternalLink className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}{snapshot.installMode === "open-installer" ? "Open DMG" : "Restart & install"}</Button> : <Button disabled={checking || downloading || appInfo?.packaged === false} onClick={() => void update.check()} type="button" variant="outline"><RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />Check now</Button>}
          </div>
        </section>
        {appInfo?.platform === "darwin" ? <p className="border-b border-border py-3 text-[10px] leading-4 text-muted-foreground">This macOS build is not notarized. macOS may require approval under System Settings, Privacy & Security after you replace the application.</p> : null}

        <section className="mt-10">
          <div className="flex items-end justify-between border-b border-border pb-3">
            <div><h3 className="text-[14px] font-semibold">Release history</h3><p className="mt-1 text-[11px] text-muted-foreground">Stable releases published on GitHub</p></div>
            <button className="text-[11px] font-medium text-muted-foreground hover:text-foreground" disabled={update.releasesLoading} onClick={() => void update.loadReleases(true)} type="button">Refresh</button>
          </div>
          {update.releasesLoading && update.releases.length === 0 ? <div className="flex items-center gap-2 py-8 text-[12px] text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading releases</div> : null}
          {update.releasesError ? <div className="flex items-start gap-2 border-b border-border py-5 text-[12px] text-[#a75845]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{update.releasesError}</span></div> : null}
          <div className="about-release-list">
            {update.releases.map((release, index) => (
              <article className="about-release" key={release.version}>
                <div className="about-release__meta"><strong>v{release.version}</strong><time>{releaseDate(release.publishedAt)}</time>{index === 0 ? <span>Latest</span> : null}</div>
                <div className="min-w-0 flex-1"><button className="about-release__title" onClick={() => void update.openReleasePage(release.version)} type="button">{release.title}<ExternalLink /></button>{release.notes ? <details className="about-release__notes"><summary>View release notes</summary><ReactMarkdown components={{ a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href?.startsWith("https://") || href?.startsWith("http://")) void client?.openExternalUrl(href); else void update.openReleasePage(release.version); }}>{children}</a>, img: () => null }} remarkPlugins={[remarkGfm]}>{release.notes}</ReactMarkdown></details> : <p className="mt-2 text-[11px] text-muted-foreground">No release notes were provided.</p>}</div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
