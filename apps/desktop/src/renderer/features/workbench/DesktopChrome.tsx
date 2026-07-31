import { useEffect } from "react";
import { AlertCircle, Download, ExternalLink, RefreshCw, RotateCcw, Settings2, SquarePen, X } from "lucide-react";
import type { DesktopMenuId } from "@wordless/protocol";
import { useRuntime } from "../../shared/runtime";
import { useDesktopHost } from "../../platform/desktop-host";
import { useDesktopUpdate } from "../../platform/desktop-update";
import type { SettingsPage } from "../settings/SettingsDialog";

type DesktopChromeProps = {
  onNewThread: () => void;
  onOpenSettings: (page?: SettingsPage) => void;
};

const menus: Array<{ id: DesktopMenuId; label: string }> = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

export function DesktopChrome({ onNewThread, onOpenSettings }: DesktopChromeProps) {
  const { client } = useRuntime();
  const { hostInfo, subscribeHost } = useDesktopHost();
  const isMac = hostInfo?.platform === "darwin";

  useEffect(() => subscribeHost((event) => {
    if (event.type !== "command") return;
    if (event.command === "new-thread") onNewThread();
    if (event.command === "open-settings") onOpenSettings();
    if (event.command === "show-about") onOpenSettings("about");
  }), [onNewThread, onOpenSettings, subscribeHost]);

  const openMenu = (menuId: DesktopMenuId) => void client?.openApplicationMenu(menuId);

  return (
    <>
      <header className={`wordless-chrome flex shrink-0 items-center border-b border-black/[0.055] bg-[var(--wordless-shell-titlebar)] text-[11px] text-[#30302e] dark:border-white/[0.07] dark:text-foreground ${isMac ? "wordless-chrome--mac" : "wordless-chrome--overlay"}`}>
        <div className="wordless-chrome__drag flex min-w-0 flex-1 items-center [-webkit-app-region:drag]">
          {isMac ? (
            <><div aria-hidden="true" className="wordless-chrome__traffic-lights" /><span className="min-w-0 truncate font-medium text-[#575750] dark:text-[#d7d8ce]">Wordless</span></>
          ) : (
            <><span className="flex items-center gap-1.5 pl-3 font-semibold"><span className="size-1.5 rounded-full bg-[#1f2933] dark:bg-[#eef4dc]" />Wordless</span><nav aria-label="Application menu" className="ml-2 flex h-full items-center gap-0.5 [-webkit-app-region:no-drag]">{menus.map((menu) => <button className="h-full px-1.5 text-left transition-colors hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10" key={menu.id} onClick={() => openMenu(menu.id)} type="button">{menu.label}</button>)}</nav></>
          )}
        </div>
        {isMac ? <div className="mr-2 flex items-center gap-0.5 [-webkit-app-region:no-drag]"><button aria-label="New thread" className="wordless-chrome__action" onClick={onNewThread} title="New thread"><SquarePen className="h-3.5 w-3.5" /></button><button aria-label="Open settings" className="wordless-chrome__action" onClick={() => onOpenSettings()} title="Settings"><Settings2 className="h-3.5 w-3.5" /></button></div> : null}
      </header>
      <UpdateNotice onViewDetails={() => onOpenSettings("about")} />
    </>
  );
}

function UpdateNotice({ onViewDetails }: { onViewDetails: () => void }) {
  const update = useDesktopUpdate();
  const snapshot = update.snapshot;
  if (!snapshot || update.dismissed || !["available", "downloading", "ready", "error"].includes(snapshot.state)) return null;

  const downloading = snapshot.state === "downloading";
  const ready = snapshot.state === "ready";
  const failed = snapshot.state === "error";
  const title = failed ? "Update could not be completed" : ready ? "Update is ready" : downloading ? "Downloading Wordless" : `Wordless ${snapshot.availableVersion ?? "update"} is available`;
  const detail = failed ? snapshot.error ?? "Please try again or view the release on GitHub." : ready ? snapshot.installMode === "open-installer" ? "Open the verified DMG, then move Wordless to Applications." : "Restart Wordless when you are ready to install." : downloading ? `${Math.max(0, Math.min(100, snapshot.progress ?? 0))}% downloaded` : "Review what changed or download it when convenient.";

  return (
    <section aria-live="polite" className="wordless-update-notice" role="status">
      <div className="wordless-update-notice__mark">{failed ? <AlertCircle /> : ready ? <RotateCcw /> : <Download />}</div>
      <div className="min-w-0 flex-1"><strong>{title}</strong><span>{detail}</span>{downloading ? <div className="wordless-update-notice__progress"><i style={{ width: `${Math.max(0, Math.min(100, snapshot.progress ?? 0))}%` }} /></div> : null}</div>
      <div className="wordless-update-notice__actions">
        {!downloading && !ready ? <button onClick={onViewDetails} type="button">Details</button> : null}
        {snapshot.state === "available" ? <button className="is-primary" onClick={() => void update.download()} type="button"><Download />Download</button> : null}
        {ready ? <button className="is-primary" onClick={() => void update.install()} type="button">{snapshot.installMode === "open-installer" ? <ExternalLink /> : <RotateCcw />}{snapshot.installMode === "open-installer" ? "Open DMG" : "Restart & install"}</button> : null}
        {failed ? <button className="is-primary" onClick={() => void update.check()} type="button"><RefreshCw />Retry</button> : null}
        {!downloading ? <button aria-label="Remind me next launch" className="is-icon" onClick={update.dismiss} title="Later"><X /></button> : null}
      </div>
    </section>
  );
}
