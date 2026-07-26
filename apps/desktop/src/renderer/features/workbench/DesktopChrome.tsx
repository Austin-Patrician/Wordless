import { useEffect, useState } from "react";
import { Settings2, SquarePen } from "lucide-react";
import type { DesktopMenuId } from "@wordless/protocol";
import { useRuntime } from "../../shared/runtime";
import { useDesktopHost } from "../../platform/desktop-host";

type DesktopChromeProps = {
  onNewThread: () => void;
  onOpenSettings: () => void;
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
  const [update, setUpdate] = useState<{ state: "available" | "downloading" | "ready"; version?: string; progress?: number } | null>(null);
  const isMac = hostInfo?.platform === "darwin";

  useEffect(() => subscribeHost((event) => {
    if (event.type === "update") {
      if (event.state === "error") return;
      setUpdate({ state: event.state, version: event.version, progress: event.progress });
      if (event.state === "ready") void client?.installUpdate();
      return;
    }
    if (event.type === "command") {
      if (event.command === "new-thread") onNewThread();
      if (event.command === "open-settings") onOpenSettings();
    }
  }), [onNewThread, onOpenSettings, subscribeHost]);

  const openMenu = (menuId: DesktopMenuId) => void client?.openApplicationMenu(menuId);

  return (
    <header className={`wordless-chrome flex shrink-0 items-center border-b border-black/[0.055] bg-[var(--wordless-shell-titlebar)] text-[11px] text-[#30302e] dark:border-white/[0.07] dark:text-foreground ${isMac ? "wordless-chrome--mac" : "wordless-chrome--overlay"}`}>
      <div className="wordless-chrome__drag flex min-w-0 flex-1 items-center [-webkit-app-region:drag]">
        {isMac ? (
          <>
            <div aria-hidden="true" className="wordless-chrome__traffic-lights" />
            <span className="min-w-0 truncate font-medium text-[#575750] dark:text-[#d7d8ce]">Wordless</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 pl-3 font-semibold"><span className="size-1.5 rounded-full bg-[#1f2933] dark:bg-[#eef4dc]" />Wordless</span>
            <nav aria-label="Application menu" className="ml-2 flex h-full items-center gap-0.5 [-webkit-app-region:no-drag]">
              {menus.map((menu) => <button className="h-full px-1.5 text-left transition-colors hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10" key={menu.id} onClick={() => openMenu(menu.id)} type="button">{menu.label}</button>)}
            </nav>
          </>
        )}
      </div>
      {isMac ? <div className="mr-2 flex items-center gap-0.5 [-webkit-app-region:no-drag]"><button aria-label="New thread" className="wordless-chrome__action" onClick={onNewThread} title="New thread"><SquarePen className="h-3.5 w-3.5" /></button><button aria-label="Open settings" className="wordless-chrome__action" onClick={onOpenSettings} title="Settings"><Settings2 className="h-3.5 w-3.5" /></button></div> : null}
      {update?.state === "available" ? <div className="wordless-update-popover" role="status"><div><strong>Wordless update available</strong><span>{update.version ? `Version ${update.version}` : "A new version is ready."}</span></div><button onClick={() => { setUpdate((current) => current ? { ...current, state: "downloading", progress: 0 } : current); void client?.downloadUpdate(); }} type="button">Download</button></div> : null}
      {update?.state === "downloading" ? <div className="wordless-update-popover" role="status"><div><strong>Downloading update</strong><span>{Math.max(0, Math.min(100, update.progress ?? 0))}%</span></div></div> : null}
    </header>
  );
}
