import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appNotices } from "../src/renderer/features/workbench/app-notices.ts";
import { messages, type MessageKey } from "../src/renderer/shared/i18n.ts";
import type { HostEnvironmentFacts } from "@wordless/protocol";

/**
 * 铃铛里显示什么。
 *
 * 这里决定的是"什么时候打扰用户",所以两边都要钉住:**该说的要说**(环境缺件、有新版本、更新待重启),
 * **不该说的一个字都不说**(一切正常时、可选能力缺失时、会话级事件)。
 */

const t = (key: MessageKey) => messages["zh-CN"][key];

const ENVIRONMENT: HostEnvironmentFacts = {
  platform: "darwin",
  shell: { kind: "bash", executable: "/bin/bash" },
  node: { found: true, version: "22.20.0", source: "wordless" },
  python: { found: true, version: "3.12.4", executable: "python3", source: "system", packages: { openpyxl: true, pyarrow: true, pandas: true } },
  ocr: { available: true, modelSet: "ppocrv5", detail: "Ready (ppocrv5)." },
  probedAt: 1,
};

const update = (state: "idle" | "available" | "ready" | "up-to-date", availableVersion?: string) =>
  ({ state, currentVersion: "0.1.0", ...(availableVersion === undefined ? {} : { availableVersion }) }) as never;

describe("appNotices", () => {
  it("一切正常时一个字都不说", () => {
    assert.deepEqual(appNotices({ environment: ENVIRONMENT, update: update("idle") }, t), []);
    assert.deepEqual(appNotices({ environment: ENVIRONMENT, update: update("up-to-date") }, t), []);
  });

  it("还没探测出结果时也不说(不能因为不知道就报警)", () => {
    assert.deepEqual(appNotices({ environment: null, update: null }, t), []);
  });

  it("命令行或 Node 缺失:警告 + 指向设置 → 环境", () => {
    const notices = appNotices({ environment: { ...ENVIRONMENT, shell: null }, update: null }, t);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]?.id, "environment");
    assert.equal(notices[0]?.tone, "warning");
    assert.deepEqual(notices[0]?.action, { kind: "settings", page: "environment" });
    // 说清是**哪一项**没就绪,而不是一句"环境有问题"。
    assert.match(notices[0]?.body ?? "", /命令行/);
  });

  it("可选能力缺失不进铃铛:数据组件与文字识别缺了不算", () => {
    const noPython = appNotices({ environment: { ...ENVIRONMENT, python: { found: false, source: "none", packages: { openpyxl: false, pyarrow: false, pandas: false } } }, update: null }, t);
    assert.deepEqual(noPython, []);
    const noOcr = appNotices({ environment: { ...ENVIRONMENT, ocr: { available: false, modelSet: null, detail: "not bundled" } }, update: null }, t);
    assert.deepEqual(noOcr, []);
  });

  it("有新版本:信息 + 指向「关于与更新」,标题带版本号", () => {
    const notices = appNotices({ environment: ENVIRONMENT, update: update("available", "0.2.0") }, t);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]?.id, "update-available");
    assert.equal(notices[0]?.tone, "info");
    assert.match(notices[0]?.title ?? "", /0\.2\.0/);
    assert.deepEqual(notices[0]?.action, { kind: "settings", page: "about" });
  });

  it("更新已下载待重启:这条最容易被漏掉 —— 不说用户会一直停在旧版本", () => {
    const notices = appNotices({ environment: ENVIRONMENT, update: update("ready", "0.2.0") }, t);
    assert.equal(notices[0]?.id, "update-ready");
    assert.match(notices[0]?.title ?? "", /0\.2\.0/);
  });

  it("两件事都有时两条都给(角标才会是 2)", () => {
    const notices = appNotices({ environment: { ...ENVIRONMENT, node: { found: false, source: "none" } }, update: update("available", "0.2.0") }, t);
    assert.deepEqual(notices.map((notice) => notice.id), ["environment", "update-available"]);
  });

  it("已经下载好时不再重复报「有新版本」", () => {
    const notices = appNotices({ environment: ENVIRONMENT, update: update("ready", "0.2.0") }, t);
    assert.equal(notices.some((notice) => notice.id === "update-available"), false);
  });
});
