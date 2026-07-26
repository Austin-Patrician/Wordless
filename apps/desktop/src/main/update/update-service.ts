import { BrowserWindow, Notification, app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import type { DesktopHostEvent } from "@wordless/protocol";

type SendHostEvent = (event: DesktopHostEvent) => void;

function versionFrom(info: UpdateInfo): string | undefined {
  return typeof info.version === "string" && info.version.length > 0 ? info.version : undefined;
}

export class DesktopUpdateService {
  private downloaded = false;
  private readonly send: SendHostEvent;

  constructor(send: SendHostEvent) {
    this.send = send;
  }

  initialize(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("update-available", (info) => {
      const version = versionFrom(info);
      this.send({ type: "update", state: "available", version });
      if (Notification.isSupported()) {
        const notification = new Notification({ title: "Wordless update available", body: version ? `Version ${version} is ready to download.` : "A new version is ready to download." });
        notification.on("click", () => {
          const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
          window?.show();
          window?.focus();
        });
        notification.show();
      }
    });
    autoUpdater.on("download-progress", (progress) => this.send({ type: "update", state: "downloading", progress: Math.round(progress.percent) }));
    autoUpdater.on("update-downloaded", (info) => {
      this.downloaded = true;
      this.send({ type: "update", state: "ready", version: versionFrom(info), progress: 100 });
    });
    autoUpdater.on("error", (error) => this.send({ type: "update", state: "error", message: error instanceof Error ? error.message : String(error) }));
  }

  async check(): Promise<void> {
    if (!app.isPackaged) return;
    await autoUpdater.checkForUpdates();
  }

  async download(): Promise<void> {
    if (!app.isPackaged) return;
    await autoUpdater.downloadUpdate();
  }

  install(): void {
    if (!this.downloaded) throw new Error("No downloaded Wordless update is ready to install");
    autoUpdater.quitAndInstall(false, true);
  }
}
