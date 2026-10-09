import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, newestRelease, resolveInstallMode } from "../src/main/update/update-policy.ts";

/**
 * 更新策略里那些**纯判断**。
 *
 * 为什么单独测:这些分支决定的是"用户点检查更新之后会不会得到回答"。Linux 上非 AppImage 装出来的
 * 应用如果走 electron-updater,`checkForUpdates()` 会 resolve null 且不发任何事件 —— 快照永远停在
 * "checking",而不是报错。这条路径没法在 CI 里跑真实 Electron,所以把判断抽出来钉住。
 */

test("macOS 未签名的包走手动 DMG,签名过的走原地更新", () => {
  const base = { platform: "darwin" as NodeJS.Platform, appImagePath: undefined };
  assert.equal(resolveInstallMode({ ...base, macAutoInstallSupported: true }), "restart-install");
  assert.equal(resolveInstallMode({ ...base, macAutoInstallSupported: false }), "manual-dmg");
});

test("Linux 只有 AppImage 能原地更新", () => {
  const base = { platform: "linux" as NodeJS.Platform, macAutoInstallSupported: true };
  assert.equal(resolveInstallMode({ ...base, appImagePath: "/tmp/.mount_Wordless/wordless.AppImage" }), "restart-install");
  // deb/rpm/解包目录:压根没有 APPIMAGE 环境变量。
  assert.equal(resolveInstallMode({ ...base, appImagePath: undefined }), "manual-package");
});

test("Windows 永远走原地更新(electron-updater 的 NSIS 那条路)", () => {
  assert.equal(
    resolveInstallMode({ platform: "win32", appImagePath: undefined, macAutoInstallSupported: false }),
    "restart-install",
  );
});

test("版本比较按数字段,短的那侧按 0 补齐", () => {
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
  assert.equal(compareVersions("1.3.0", "1.10.0"), -1);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
});

test("只有比当前版本新的稳定版才算更新目标", () => {
  const releases = [
    { version: "1.2.3", title: "Wordless 1.2.3", notes: "same", publishedAt: "", htmlUrl: "", prerelease: false },
    { version: "1.2.4", title: "Wordless 1.2.4", notes: "newer", publishedAt: "", htmlUrl: "", prerelease: false },
    { version: "1.1.0", title: "Wordless 1.1.0", notes: "older", publishedAt: "", htmlUrl: "", prerelease: false },
    { version: "1.3.0-beta.1", title: "Beta", notes: "beta", publishedAt: "", htmlUrl: "", prerelease: true },
    { version: "2.0.0-beta.1", title: "Beta 2", notes: "beta", publishedAt: "", htmlUrl: "", prerelease: true },
  ];
  // 两个预发布的段位都比 1.2.4 大,但都不该被选中 —— 否则测试版会被推给所有人。
  assert.equal(newestRelease(releases, "1.2.3")?.version, "1.2.4");
  assert.equal(newestRelease(releases, "1.2.4"), undefined);
  // 当前是预发布时,新的稳定版仍然是更新目标。
  assert.equal(newestRelease(releases, "1.2.3-beta.1")?.version, "1.2.4");
  assert.equal(newestRelease([], "1.2.3"), undefined);
  assert.equal(
    newestRelease(
      [{ version: "1.3.0", title: "Wordless 1.3.0", notes: "", publishedAt: "", htmlUrl: "", prerelease: false }],
      "1.10.0",
    ),
    undefined,
  );
});
