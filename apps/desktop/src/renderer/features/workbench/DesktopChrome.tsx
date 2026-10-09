import { useEffect, useState } from "react";
import { AlertCircle, Copy, Download, FolderOpen, Minus, RefreshCw, RotateCcw, Square, X } from "lucide-react";
import type { DesktopMenuId, DesktopWindowControl } from "@wordless/protocol";
import { useRuntime } from "../../shared/runtime";
import { useDesktopHost } from "../../platform/desktop-host";
import { useDesktopUpdate } from "../../platform/desktop-update";
import { useBrowserOcclusion } from "../browser/use-occlusion";
import type { SettingsPage } from "../settings/SettingsDialog";
import { windowControls } from "./window-controls";

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
  // 系统不画那组窗口按钮时(见 desktop-platform.ts 的 Linux 分支),由我们画 —— 否则
  // 无边框窗口在 Linux 上连关闭按钮都没有。
  const inAppWindowControls = !isMac && hostInfo?.capabilities.titleBarOverlay === false;
  const [windowMaximized, setWindowMaximized] = useState(false);

  useEffect(() => subscribeHost((event) => {
    if (event.type !== "command") return;
    if (event.command === "new-thread") onNewThread();
    if (event.command === "open-settings") onOpenSettings();
    if (event.command === "show-about") onOpenSettings("about");
  }), [onNewThread, onOpenSettings, subscribeHost]);

  /**
   * 窗口状态:挂载时**拉一次**,之后靠事件推。
   *
   * 只订阅会漏掉"窗口一开就是最大化的"(窗口状态被系统恢复)——那种情况下按钮的图标会一直错到
   * 用户手动切换为止。拉取失败就保持默认(false),因为这只是图标:`desktopBridgeError` 已经负责
   * 在版本不匹配时把话说清楚,这里不必再打扰用户。
   */
  useEffect(() => {
    if (!inAppWindowControls) return;
    let active = true;
    void client?.getWindowState()
      .then((state) => { if (active) setWindowMaximized(state.maximized); })
      .catch(() => undefined);
    const unsubscribe = subscribeHost((event) => {
      if (event.type === "window.changed") setWindowMaximized(event.state.maximized);
    });
    return () => { active = false; unsubscribe(); };
  }, [client, inAppWindowControls, subscribeHost]);

  const openMenu = (menuId: DesktopMenuId) => void client?.openApplicationMenu(menuId);
  const controlWindow = (action: DesktopWindowControl) => void client?.controlWindow(action);

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
        {inAppWindowControls ? <WindowControls maximized={windowMaximized} onControl={controlWindow} /> : null}
      </header>
      <UpdateNotice onViewDetails={() => onOpenSettings("about")} />
    </>
  );
}

/**
 * 自绘的窗口按钮。
 *
 * 图标与标签跟着窗口状态走(最大化时中间那个变"还原"),状态来自两条路:挂载时拉一次
 * `getWindowState`,之后订阅 `window.changed` —— 只做推送会漏掉"挂载时已经是最大化"的情况。
 *
 * 双击标题栏切换最大化**没有做**:标题栏那条 drag 区(`-webkit-app-region: drag`)不向页面
 * 派发指针事件(同一条原因让菜单按钮必须显式 `no-drag`),所以那里收不到 `dblclick`。
 * 想要这个约定只能再开一条真实的无 drag 区域,不值得为它把标题栏拆开。
 */
function WindowControls({ maximized, onControl }: { maximized: boolean; onControl: (action: DesktopWindowControl) => void }) {
  // 还原图标用两个错开的方块(lucide 里最接近原生"还原"的那个)。语义由 label 承担。
  const icons = { minimize: Minus, maximize: Square, restore: Copy, close: X } as const;
  return (
    <div className="flex h-full shrink-0 items-stretch [-webkit-app-region:no-drag]">
      {windowControls(maximized).map((control) => {
        const Icon = icons[control.icon];
        return (
          <button
            aria-label={control.label}
            className={`grid w-11 place-items-center text-[#575750] transition-colors hover:bg-black/5 dark:text-[#d7d8ce] dark:hover:bg-white/10 ${control.icon === "close" ? "hover:bg-[#e5484d] hover:text-white dark:hover:bg-[#e5484d] dark:hover:text-white" : ""}`}
            key={control.action}
            onClick={() => onControl(control.action)}
            title={control.label}
            type="button"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

function UpdateNotice({ onViewDetails }: { onViewDetails: () => void }) {
  const update = useDesktopUpdate();
  const snapshot = update.snapshot;
  const visible = Boolean(snapshot) && !update.dismissed && ["available", "downloading", "ready", "error"].includes(snapshot?.state ?? "");
  // 这条提示是**内联的 fixed 浮层**(不是 portal):内嵌浏览器那张原生视图会盖住它。
  useBrowserOcclusion(visible, "toast");
  if (!visible || !snapshot) return null;

  const downloading = snapshot.state === "downloading";
  const ready = snapshot.state === "ready";
  const failed = snapshot.state === "error";
  // 手动安装模式(未签名的 macOS、Linux 上的 deb/rpm)下"下载"实际是打开发布页。
  const manualInstall = snapshot.installMode === "manual-dmg" || snapshot.installMode === "manual-package";
  const title = failed ? "Update could not be completed" : ready ? "Update is ready" : downloading ? "Downloading Wordless" : `Wordless ${snapshot.availableVersion ?? "update"} is available`;
  const detail = failed ? snapshot.error ?? "Please try again or view the release on GitHub." : ready ? manualInstall ? "Open the downloaded installer to replace the current version." : "Restart Wordless when you are ready to install." : downloading ? `${Math.max(0, Math.min(100, snapshot.progress ?? 0))}% downloaded` : "Review what changed or download it when convenient.";

  return (
    <section aria-live="polite" className="wordless-update-notice" role="status">
      <div className="wordless-update-notice__mark">{failed ? <AlertCircle /> : ready ? <RotateCcw /> : <Download />}</div>
      <div className="min-w-0 flex-1"><strong>{title}</strong><span>{detail}</span>{downloading ? <div className="wordless-update-notice__progress"><i style={{ width: `${Math.max(0, Math.min(100, snapshot.progress ?? 0))}%` }} /></div> : null}</div>
      <div className="wordless-update-notice__actions">
        {!downloading && !ready ? <button onClick={onViewDetails} type="button">Details</button> : null}
        {snapshot.state === "available" ? <button className="is-primary" onClick={() => void update.download()} type="button"><Download />{manualInstall ? "Get update" : "Download"}</button> : null}
        {ready ? <button className="is-primary" onClick={() => void update.install()} type="button">{manualInstall ? <FolderOpen /> : <RotateCcw />}{snapshot.installMode === "manual-dmg" ? "Open DMG" : manualInstall ? "Get update" : "Restart & install"}</button> : null}
        {failed ? <button className="is-primary" onClick={() => void update.check()} type="button"><RefreshCw />Retry</button> : null}
        {!downloading ? <button aria-label="Remind me next launch" className="is-icon" onClick={update.dismiss} title="Later"><X /></button> : null}
      </div>
    </section>
  );
}
