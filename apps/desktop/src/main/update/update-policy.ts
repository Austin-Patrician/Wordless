import type { DesktopRelease, DesktopUpdateSnapshot } from "@wordless/protocol";

export type DesktopInstallMode = NonNullable<DesktopUpdateSnapshot["installMode"]>;

/**
 * 这份安装包**能不能原地更新**,以及不能的话该走哪条手动路。
 *
 * 决策与真机验收项见 `docs/architecture/linux-release.md` §3 D1。
 *
 * Linux 上这件事没有中间地带:electron-updater 只有 `AppImageUpdater` 一个实现,而它在
 * `APPIMAGE` 环境变量缺席时直接 `isUpdaterActive() === false` —— 于是 `checkForUpdates()`
 * **resolve null 且不发任何事件**。deb/rpm/解包目录装出来的应用如果照走那条路,更新面板会永远停在
 * "checking"(没事件就没有状态推进),用户看到的是一个转不完的圈。所以这里先分流:
 * 只有 AppImage 才交给 electron-updater,其余走"手动"(见 update-service 的 check 分支)。
 *
 * macOS 那条分支不动:签名过的包走 electron-updater,没签名的包回到"下载 DMG 自己装"。
 */
export function resolveInstallMode(options: {
  platform: NodeJS.Platform;
  /** `process.env.APPIMAGE` —— 只有以 AppImage 方式启动时才有值。 */
  appImagePath: string | undefined;
  /** 打包版且带 Developer ID 签名才是 true(见 update-service 的 supportsMacAutoInstall)。 */
  macAutoInstallSupported: boolean;
}): DesktopInstallMode {
  // 每个平台自己判:别让"macOS 的检查结果"溢出到别的平台上(Windows 传什么值都该是原地更新)。
  if (options.platform === "darwin") return options.macAutoInstallSupported ? "restart-install" : "manual-dmg";
  if (options.platform === "linux") return options.appImagePath ? "restart-install" : "manual-package";
  return "restart-install";
}

/** 数字段,短的那侧缺位按 0 算(`1.2` 等价于 `1.2.0`)。 */
function numericParts(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((value) => (Number.isFinite(value) ? value : 0));
}

/** 逐段比数字:`< 0` / `0` / `> 0`,语义同 `Array.prototype.sort` 的比较器。 */
export function compareVersions(left: string, right: string): number {
  const leftParts = numericParts(left);
  const rightParts = numericParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * 比当前版本新的那一个稳定版本(没有就 `undefined`)。
 *
 * 预发布**永远不是更新目标**:发布清单里本来就有 beta,让它们参与比较等于把测试版塞给所有人
 * (而且 `1.3.0-beta.1` 的第四个数字段还比 `1.3.0` 大)。
 */
export function newestRelease(releases: readonly DesktopRelease[], currentVersion: string): DesktopRelease | undefined {
  return releases
    .filter((release) => !release.prerelease && compareVersions(release.version, currentVersion) > 0)
    .sort((left, right) => compareVersions(right.version, left.version))
    .at(0);
}
