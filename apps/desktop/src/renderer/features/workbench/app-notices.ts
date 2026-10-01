import type { HostEnvironmentFacts, DesktopUpdateSnapshot } from "@wordless/protocol";
import type { SettingsPage } from "../settings/SettingsDialog";
// 显式 `.ts`:这个模块会被 `node --test` 直接加载(它的测试是纯函数测试),而 Node 的类型剥离
// 不做扩展名补全 —— 不带扩展名在 vitest/vite 下能跑,在 node:test 下会 ERR_MODULE_NOT_FOUND。
import { environmentNeedsAttention, hostEnvironmentRows } from "../settings/environment-rows.ts";
import type { MessageKey } from "../../shared/i18n";

/**
 * 铃铛里显示什么 —— **只放"关于应用本身"的事**。
 *
 * 划分规则:**会话的事在会话里说,应用的事在铃铛里说**。
 * - 会话级事件(跑完、失败、需要审批)已经有系统通知 + 线程内的提示,再进铃铛就是同一件事说三遍;
 * - 环境缺件、有新版本、更新已下载待重启 —— 这些不属于任何一次会话,用户也没有别的地方能看到。
 *
 * 抽成纯函数的原因和 `hostEnvironmentRows` 一样:这里决定的是"什么时候打扰用户",必须有测试守着
 * (尤其"一切正常时一个字都不说")。
 */

export type AppNoticeAction =
  | { kind: "settings"; page: SettingsPage }
  | { kind: "url"; url: string };

export interface AppNotice {
  id: "environment" | "update-available" | "update-ready";
  /** 警告 = 影响现在能做什么;信息 = 有更好的选择。 */
  tone: "warning" | "info";
  title: string;
  body: string;
  actionLabel: string;
  action: AppNoticeAction;
}

export interface AppNoticeInput {
  environment: HostEnvironmentFacts | null;
  update: DesktopUpdateSnapshot | null;
}

export function appNotices(input: AppNoticeInput, t: (key: MessageKey) => string): AppNotice[] {
  const notices: AppNotice[] = [];

  // 环境:只有"agent 能不能干活"的前提缺了才说(数据组件、文字识别缺了不算 —— 那是可选能力)。
  // 位置从输入框底下挪到这里:那里是用户准备开始干活的地方,不适合放一句应用自身的状态。
  if (input.environment !== null) {
    const rows = hostEnvironmentRows(input.environment, t);
    if (environmentNeedsAttention(rows)) {
      const missing = rows.filter((row) => row.optional !== true && row.status !== "ok").map((row) => t(row.labelKey));
      notices.push({
        id: "environment",
        tone: "warning",
        title: t("noticeEnvironmentTitle"),
        body: t("noticeEnvironmentBody").replace("{items}", missing.join("、")),
        actionLabel: t("noticeOpenEnvironment"),
        action: { kind: "settings", page: "environment" },
      });
    }
  }

  const update = input.update;
  if (update !== null && update.state === "available") {
    notices.push({
      id: "update-available",
      tone: "info",
      title: t("noticeUpdateAvailableTitle").replace("{version}", update.availableVersion ?? ""),
      body: t("noticeUpdateAvailableBody"),
      actionLabel: t("noticeOpenUpdate"),
      action: { kind: "settings", page: "about" },
    });
  } else if (update !== null && update.state === "ready") {
    // 已经下好了、只等重启:这时不说,用户会一直停在旧版本上。
    notices.push({
      id: "update-ready",
      tone: "info",
      title: t("noticeUpdateReadyTitle").replace("{version}", update.availableVersion ?? ""),
      body: t("noticeUpdateReadyBody"),
      actionLabel: t("noticeOpenUpdate"),
      action: { kind: "settings", page: "about" },
    });
  }

  return notices;
}
