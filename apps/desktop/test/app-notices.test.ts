import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APP_NOTICE_SOURCES,
  cloudSyncNoticeSource,
  collectAppNotices,
  environmentNoticeSource,
  noticeFingerprint,
  visibleNotices,
  type AppNotice,
  type AppNoticeSource,
} from "../src/renderer/features/workbench/app-notices.ts";
import { messages, type MessageKey } from "../src/renderer/shared/i18n.ts";
import type { HostEnvironmentFacts } from "@wordless/protocol";

/**
 * 铃铛里显示什么。
 *
 * 这里决定的是"什么时候打扰用户",所以两边都要钉住:**该说的要说**(环境缺件、云同步要你动手),
 * **不该说的一个字都不说**(一切正常、可选能力缺失、正常同步过程、以及**已经有别的家**的更新)。
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

/** 云同步快照的最小形状。 */
const sync = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  status: "synced",
  lastSyncAt: null,
  lastError: null,
  pendingCount: 0,
  conflicts: [],
  accountEmail: "a@b.c",
  ...overrides,
});

/** 一个"正常"的云同步快照(不产生任何通知)。 */
const healthySync = sync();

const notice = (overrides: Partial<AppNotice> & Pick<AppNotice, "id" | "source">): AppNotice => ({
  tone: "info",
  title: "t",
  body: "b",
  ...overrides,
});

describe("云同步来源", () => {
  const ids = (overrides: Record<string, unknown>) =>
    cloudSyncNoticeSource.read({ environment: null, cloudSync: sync(overrides) as never }, t).map((item) => item.id);

  it("只有需要你动手的三个状态才说", () => {
    assert.deepEqual(ids({ status: "error" }), ["cloud-sync:error"]);
    assert.deepEqual(ids({ status: "conflict", conflicts: ["a.md"] }), ["cloud-sync:conflict"]);
    assert.deepEqual(ids({ status: "needs-reconnect" }), ["cloud-sync:reconnect"]);
  });

  it("正常过程与用户自己的选择都不进铃铛", () => {
    for (const overrides of [{ status: "disabled" }, { enabled: false }, { status: "idle" }, { status: "syncing" }, { status: "synced" }, { status: "offline" }]) {
      assert.deepEqual(ids(overrides), [], JSON.stringify(overrides));
    }
    assert.deepEqual(cloudSyncNoticeSource.read({ environment: null, cloudSync: null }, t), []);
  });

  it("把宿主的错误原文带上 —— 放在 detail 而不是正文", () => {
    const [only] = cloudSyncNoticeSource.read({ environment: null, cloudSync: sync({ status: "error", lastError: "quota exceeded" }) as never }, t);
    // 原文是机器文本:界面用等宽块渲染它(只显示首行,悬停看全文),所以它不该混进给人读的那句话里。
    assert.equal(only?.detail, "quota exceeded");
    assert.doesNotMatch(only?.body ?? "", /quota exceeded/);
    assert.deepEqual(only?.action, { kind: "settings", page: "dataPrivacy" });
  });

  it("冲突即使状态没来得及更新,只要列表非空也要说", () => {
    const [only] = cloudSyncNoticeSource.read({ environment: null, cloudSync: sync({ status: "synced", conflicts: ["a.md", "b.md"] }) as never }, t);
    assert.equal(only?.id, "cloud-sync:conflict");
    assert.match(only?.title ?? "", /2/);
    // 冲突文件名同样进 detail(最多列 5 个,逗号分隔 —— 面板只显示首行)。
    assert.equal(only?.detail, "a.md, b.md");
  });
});

describe("收集器与来源模型", () => {
  it("注册表里是环境与云同步 —— **更新不在**这里(它有自己的家,见下)", () => {
    assert.deepEqual(APP_NOTICE_SOURCES.map((source) => source.id), ["environment", "cloud-sync"]);
  });

  it("更新刻意不进铃铛:它已经有一个更强的家(DesktopChrome 的横幅,能原地下载/重启、带进度)", () => {
    // 这条是**规则**的守卫:哪天有人想把更新塞回铃铛,会先看到这条测试。
    assert.equal(APP_NOTICE_SOURCES.some((source) => source.id === "update"), false);
  });

  it("警告排在信息前面,与注册顺序无关", () => {
    const info: AppNoticeSource = { id: "info", read: () => [notice({ id: "info:1", source: "info", tone: "info" })] };
    const warning: AppNoticeSource = { id: "warning", read: () => [notice({ id: "warning:1", source: "warning", tone: "warning" })] };
    // 故意把"信息"排在前面:结果仍应是警告在前。
    assert.deepEqual(collectAppNotices({ environment: null, cloudSync: null }, t, [info, warning]).map((item) => item.id), ["warning:1", "info:1"]);
  });

  it("按 id 去重:两个来源给出同一个 id 时只留一条(角标才不会算重)", () => {
    const first: AppNoticeSource = { id: "a", read: () => [notice({ id: "same", source: "a" })] };
    const second: AppNoticeSource = { id: "b", read: () => [notice({ id: "same", source: "b" })] };
    assert.equal(collectAppNotices({ environment: null, cloudSync: null }, t, [first, second]).length, 1);
  });

  it("某个来源抛错时,其余来源照常显示 —— 铃铛不该被一个坏来源带崩", () => {
    const broken: AppNoticeSource = {
      id: "broken",
      read: () => {
        throw new Error("boom");
      },
    };
    const good: AppNoticeSource = { id: "good", read: () => [notice({ id: "good:1", source: "good" })] };
    assert.deepEqual(collectAppNotices({ environment: null, cloudSync: null }, t, [broken, good]).map((item) => item.id), ["good:1"]);
  });

  it("权重只在同一语气内起作用", () => {
    const low: AppNoticeSource = { id: "low", read: () => [notice({ id: "low", source: "low", priority: 1 })] };
    const high: AppNoticeSource = { id: "high", read: () => [notice({ id: "high", source: "high", priority: 9 })] };
    assert.deepEqual(collectAppNotices({ environment: null, cloudSync: null }, t, [low, high]).map((item) => item.id), ["high", "low"]);
  });

  it("**接入一个新类型**:写一个纯函数来源 + 注册即可,收集器与界面都不用改", () => {
    const thirdPartySource: AppNoticeSource = {
      id: "third-party",
      read: (_context, translate) => [
        notice({
          id: "third-party:needs-consent",
          source: "third-party",
          tone: "warning",
          title: translate("noticeEnvironmentTitle"),
          action: { kind: "settings", page: "dataPrivacy" },
        }),
      ],
    };
    const notices = collectAppNotices({ environment: null, cloudSync: null }, t, [...APP_NOTICE_SOURCES, thirdPartySource]);
    assert.deepEqual(notices.map((item) => item.source), ["third-party"]);
    assert.deepEqual(notices[0]?.action, { kind: "settings", page: "dataPrivacy" });
  });

  it("来源可以不写 action:有些提醒只是告诉你一声", () => {
    const passive: AppNoticeSource = { id: "passive", read: () => [notice({ id: "passive:1", source: "passive" })] };
    assert.equal(collectAppNotices({ environment: null, cloudSync: null }, t, [passive])[0]?.action, undefined);
  });
});

describe("环境来源", () => {
  const appNotices = (environment: HostEnvironmentFacts | null) => collectAppNotices({ environment, cloudSync: null }, t);

  it("一切正常时一个字都不说", () => {
    assert.deepEqual(appNotices(ENVIRONMENT), []);
  });

  it("还没探测出结果时也不说(不能因为不知道就报警)", () => {
    assert.deepEqual(appNotices(null), []);
  });

  it("命令行或 Node 缺失:警告 + 指向设置 → 环境", () => {
    const [only] = environmentNoticeSource.read({ environment: { ...ENVIRONMENT, shell: null }, cloudSync: null }, t);
    assert.equal(only?.id, "environment:incomplete");
    assert.equal(only?.tone, "warning");
    assert.equal(only?.source, environmentNoticeSource.id);
    assert.deepEqual(only?.action, { kind: "settings", page: "environment" });
    // 说清是**哪一项**没就绪,而不是一句"环境有问题"。
    assert.match(only?.body ?? "", /命令行/);
  });

  it("可选能力缺失不进铃铛:数据组件与文字识别缺了不算", () => {
    assert.deepEqual(appNotices({ ...ENVIRONMENT, python: { found: false, source: "none", packages: { openpyxl: false, pyarrow: false, pandas: false } } }), []);
    assert.deepEqual(appNotices({ ...ENVIRONMENT, ocr: { available: false, modelSet: null, detail: "not bundled" } }), []);
  });

  it("两件事都有时两条都给(角标才会是 2)", () => {
    const notices = collectAppNotices(
      { environment: { ...ENVIRONMENT, node: { found: false, source: "none" } }, cloudSync: sync({ status: "error", lastError: "quota exceeded" }) as never },
      t,
    );
    assert.deepEqual(notices.map((item) => item.id), ["environment:incomplete", "cloud-sync:error"]);
  });
});

describe("已读(知道了):按内容指纹记住", () => {
  const one = (detail?: string) =>
    notice({ id: "cloud-sync:error", source: "cloud-sync", tone: "warning", title: "同步失败", body: "没完成", ...(detail === undefined ? {} : { detail }) });

  it("同一条(内容没变)被忽略后就不再出现", () => {
    const target = one("quota exceeded");
    assert.deepEqual(visibleNotices([target], { [target.id]: noticeFingerprint(target) }), []);
  });

  it("**内容变了就重新出现**:否则忽略过一次旧错误,之后所有新错误都会被吞掉", () => {
    const stale = one("quota exceeded");
    const dismissed = { [stale.id]: noticeFingerprint(stale) };
    assert.deepEqual(visibleNotices([one("network unreachable")], dismissed).map((item) => item.detail), ["network unreachable"]);
  });

  it("没有 detail 时用标题+正文当指纹", () => {
    const bare = one();
    assert.deepEqual(visibleNotices([bare], { [bare.id]: noticeFingerprint(bare) }), []);
    assert.notEqual(noticeFingerprint(bare), noticeFingerprint({ ...bare, body: "别的" }));
  });

  it("正常的那条不受别的 id 的忽略影响", () => {
    const target = one("quota exceeded");
    assert.equal(visibleNotices([target], { "cloud-sync:reconnect": "whatever" }).length, 1);
    assert.equal(healthySync.status, "synced");
  });
});
