import { spawnSync } from "node:child_process";
import path from "node:path";
import { BrowserWindow, Notification, app, shell } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import type { DesktopAppInfo, DesktopHostEvent, DesktopRelease, DesktopUpdateSnapshot } from "@wordless/protocol";
import { DesktopReleaseService } from "./release-service";
import { newestRelease, resolveInstallMode } from "./update-policy";

const REPOSITORY_URL = "https://github.com/Austin-Patrician/Wordless";
const R2_UPDATE_URL = "https://download.wordless.20250230.xyz/releases";

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
  private readonly installMode = resolveInstallMode({
    platform: process.platform,
    appImagePath: process.env.APPIMAGE,
    macAutoInstallSupported: supportsMacAutoInstall(),
  });
  private readonly downloadsDirectory: string;
  private manualInstallerPath: string | undefined;
  private snapshot: DesktopUpdateSnapshot = {
    state: "idle",
    currentVersion: app.getVersion(),
    installMode: this.installMode,
  };
  private readonly releases: DesktopReleaseService;
  private readonly send: SendHostEvent;
  private suppressUpdaterErrors = false;

  constructor(send: SendHostEvent, userDataPath = app.getPath("userData"), downloadsPath = app.getPath("downloads")) {
    this.send = send;
    this.releases = new DesktopReleaseService(userDataPath);
    this.downloadsDirectory = downloadsPath;
  }

  initialize(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    this.useR2Feed();
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
        installMode: this.snapshot.installMode,
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
    autoUpdater.on("update-downloaded", (info) => this.update({ state: "ready", availableVersion: versionFrom(info) ?? this.snapshot.availableVersion, releaseNotes: notesFrom(info) ?? this.snapshot.releaseNotes, progress: 100, installMode: this.snapshot.installMode, error: undefined }));
    autoUpdater.on("error", (error) => {
      if (!this.suppressUpdaterErrors) this.fail(error);
    });
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
    if (this.installMode === "manual-package") return await this.checkWithoutUpdater();
    this.update({ state: "checking", error: undefined });
    this.suppressUpdaterErrors = true;
    try {
      this.useR2Feed();
      await autoUpdater.checkForUpdates();
    } catch {
      try {
        this.useGithubFeed();
        await autoUpdater.checkForUpdates();
      } catch (error) {
        this.fail(error);
      }
    } finally {
      this.suppressUpdaterErrors = false;
    }
    return this.getSnapshot();
  }

  async download(): Promise<DesktopUpdateSnapshot> {
    if (!app.isPackaged) return this.getSnapshot();
    // 手动安装模式没有"下载到本地再打开"这一步:这个动作本身就是"去发布页拿新包",
    // 所以不需要先有 availableVersion(用户也可能直接从关于页点进去)。
    if (this.installMode === "manual-package") return await this.openManualPackagePage();
    if (!this.snapshot.availableVersion) throw new Error("No Wordless update is available to download");
    this.update({ state: "downloading", progress: 0, error: undefined });

    if (this.installMode === "manual-dmg") {
      try {
        this.manualInstallerPath = await this.releases.downloadMacInstaller(
          this.snapshot.availableVersion,
          process.arch,
          this.downloadsDirectory,
          (progress) => this.update({ state: "downloading", progress, error: undefined }),
        );
        this.update({ state: "ready", progress: 100, installMode: "manual-dmg", error: undefined });
      } catch (error) {
        this.fail(error);
      }
      return this.getSnapshot();
    }

    this.suppressUpdaterErrors = true;
    try {
      await autoUpdater.downloadUpdate();
    } catch {
      try {
        this.useGithubFeed();
        await autoUpdater.checkForUpdates();
        await autoUpdater.downloadUpdate();
      } catch (error) {
        this.fail(error);
      }
    } finally {
      this.suppressUpdaterErrors = false;
    }
    return this.getSnapshot();
  }

  async install(): Promise<DesktopUpdateSnapshot> {
    if (this.installMode === "manual-package") return await this.openManualPackagePage();
    if (this.snapshot.state !== "ready") throw new Error("No downloaded Wordless update is ready to install");

    if (this.snapshot.installMode === "manual-dmg") {
      if (!this.manualInstallerPath) throw new Error("The macOS DMG has not been downloaded yet");
      const error = await shell.openPath(this.manualInstallerPath);
      if (error) throw new Error(`Unable to open the downloaded macOS installer: ${error}`);
      return this.getSnapshot();
    }

    autoUpdater.quitAndInstall(false, true);
    return this.getSnapshot();
  }

  async openReleasePage(version?: string): Promise<void> {
    const normalized = version?.replace(/^v/, "");
    await shell.openExternal(normalized ? `${REPOSITORY_URL}/releases/tag/v${encodeURIComponent(normalized)}` : `${REPOSITORY_URL}/releases`);
  }

  /**
   * 手动安装模式的"下载/安装"动作:打开这个版本的发布页。
   *
   * deb/rpm/解包目录装出来的 Linux 应用**没有原地安装的路径** —— electron-updater 只有 AppImage
   * 实现,而替换 /opt 下的包需要 root。所以这里不假装能装,而是把人送到发布页自己拿新包,
   * 与 macOS 未签名包的"打开 DMG"属于同一类动作(那个至少还能让用户拖进去)。
   */
  private async openManualPackagePage(): Promise<DesktopUpdateSnapshot> {
    await this.openReleasePage(this.snapshot.availableVersion);
    return this.getSnapshot();
  }

  /**
   * 不走 electron-updater 的检查(见 `resolveInstallMode`)。
   *
   * Linux 上非 AppImage 的安装形式里,`checkForUpdates()` 既不发事件也不抛错(它直接
   * `isUpdaterActive() === false` 返回 null),照走上面那条路会让快照永远停在 "checking" ——
   * 用户看到一个转不完的圈。这里改成拿发布清单自己比版本。
   */
  private async checkWithoutUpdater(): Promise<DesktopUpdateSnapshot> {
    this.update({ state: "checking", error: undefined });
    try {
      const newest = newestRelease(await this.releases.list(true), app.getVersion());
      this.update({
        state: newest ? "available" : "up-to-date",
        availableVersion: newest?.version,
        releaseNotes: newest?.notes || undefined,
        checkedAt: Date.now(),
        progress: undefined,
        error: undefined,
      });
    } catch (error) {
      this.fail(error);
    }
    return this.getSnapshot();
  }

  private update(change: Partial<DesktopUpdateSnapshot> & Pick<DesktopUpdateSnapshot, "state">): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.send({ type: "update", snapshot: this.getSnapshot() });
  }

  private fail(error: unknown): void {
    this.update({ state: "error", error: error instanceof Error ? error.message : String(error), progress: undefined });
  }

  private useR2Feed(): void {
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.WORDLESS_UPDATE_BASE_URL?.trim() || R2_UPDATE_URL });
  }

  private useGithubFeed(): void {
    autoUpdater.setFeedURL({ provider: "github", owner: "Austin-Patrician", repo: "Wordless" });
  }
}

function supportsMacAutoInstall(): boolean {
  if (process.platform !== "darwin" || !app.isPackaged) return true;

  const executablePath = app.getPath("exe");
  const appBundlePath = path.dirname(path.dirname(path.dirname(executablePath)));
  if (!appBundlePath.endsWith(".app")) return false;

  const result = spawnSync("codesign", ["-dv", "--verbose=4", appBundlePath], { encoding: "utf8" });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return result.status === 0 && !/Signature=adhoc/i.test(output) && /Authority=Developer ID Application:/i.test(output);
}
