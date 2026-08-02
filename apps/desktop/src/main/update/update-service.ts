import { BrowserWindow, Notification, app, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import type { DesktopAppInfo, DesktopHostEvent, DesktopRelease, DesktopUpdateSnapshot } from "@wordless/protocol";
import { DesktopReleaseService } from "./release-service";

const REPOSITORY_URL = "https://github.com/Austin-Patrician/Wordless";

type SendHostEvent = (event: DesktopHostEvent) => void;

function versionFrom(info: UpdateInfo): string | undefined {
  return typeof info.version === "string" && info.version.length > 0 ? info.version : undefined;
}

function notesFrom(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === "string") return info.releaseNotes;
  if (Array.isArray(info.releaseNotes)) return info.releaseNotes.map((note) => note.note).filter(Boolean).join("\n\n") || undefined;
  return undefined;
}

export class DesktopUpdateService {
  private snapshot: DesktopUpdateSnapshot = { state: "idle", currentVersion: app.getVersion() };
  private readonly releases: DesktopReleaseService;
  private readonly send: SendHostEvent;

  constructor(send: SendHostEvent, userDataPath = app.getPath("userData")) {
    this.send = send;
    this.releases = new DesktopReleaseService(userDataPath);
  }

  initialize(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("checking-for-update", () => this.update({ state: "checking", error: undefined }));
    autoUpdater.on("update-not-available", () => this.update({ state: "up-to-date", checkedAt: Date.now(), availableVersion: undefined, releaseNotes: undefined, progress: undefined, error: undefined }));
    autoUpdater.on("update-available", (info) => {
      const availableVersion = versionFrom(info);
      this.update({
        state: "available",
        availableVersion,
        releaseNotes: notesFrom(info),
        checkedAt: Date.now(),
        progress: undefined,
        error: undefined,
        installMode: "restart-install",
      });
      if (Notification.isSupported()) {
        const notification = new Notification({ title: "Wordless update available", body: availableVersion ? `Version ${availableVersion} is ready to download.` : "A new version is ready to download." });
        notification.on("click", () => {
          const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
          window?.show();
          window?.focus();
        });
        notification.show();
      }
    });
    autoUpdater.on("download-progress", (progress) => this.update({ state: "downloading", progress: Math.round(progress.percent), error: undefined }));
    autoUpdater.on("update-downloaded", (info) => this.update({ state: "ready", availableVersion: versionFrom(info) ?? this.snapshot.availableVersion, releaseNotes: notesFrom(info) ?? this.snapshot.releaseNotes, progress: 100, installMode: "restart-install", error: undefined }));
    autoUpdater.on("error", (error) => this.fail(error));
  }

  getAppInfo(): DesktopAppInfo {
    return { name: app.getName(), version: app.getVersion(), repositoryUrl: REPOSITORY_URL, packaged: app.isPackaged, platform: process.platform as DesktopAppInfo["platform"], arch: process.arch };
  }

  getSnapshot(): DesktopUpdateSnapshot {
    return { ...this.snapshot };
  }

  listReleases(refresh = false): Promise<DesktopRelease[]> {
    return this.releases.list(refresh);
  }

  async check(): Promise<DesktopUpdateSnapshot> {
    if (!app.isPackaged) return this.getSnapshot();
    this.update({ state: "checking", error: undefined });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.fail(error);
    }
    return this.getSnapshot();
  }

  async download(): Promise<DesktopUpdateSnapshot> {
    if (!app.isPackaged) return this.getSnapshot();
    if (!this.snapshot.availableVersion) throw new Error("No Wordless update is available to download");
    this.update({ state: "downloading", progress: 0, error: undefined });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.fail(error);
    }
    return this.getSnapshot();
  }

  async install(): Promise<DesktopUpdateSnapshot> {
    if (this.snapshot.state !== "ready") throw new Error("No downloaded Wordless update is ready to install");
    autoUpdater.quitAndInstall(false, true);
    return this.getSnapshot();
  }

  async openReleasePage(version?: string): Promise<void> {
    const normalized = version?.replace(/^v/, "");
    await shell.openExternal(normalized ? `${REPOSITORY_URL}/releases/tag/v${encodeURIComponent(normalized)}` : `${REPOSITORY_URL}/releases`);
  }

  private update(change: Partial<DesktopUpdateSnapshot> & Pick<DesktopUpdateSnapshot, "state">): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.send({ type: "update", snapshot: this.getSnapshot() });
  }

  private fail(error: unknown): void {
    this.update({ state: "error", error: error instanceof Error ? error.message : String(error), progress: undefined });
  }
}
