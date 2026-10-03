import type { CloudSyncSnapshot, HostEnvironmentFacts } from "@wordless/protocol";
import type { SettingsPage } from "../settings/SettingsDialog";
// 显式 `.ts`:这个模块会被 `node --test` 直接加载(它的测试是纯函数测试),而 Node 的类型剥离
// 不做扩展名补全 —— 不带扩展名在 vitest/vite 下能跑,在 node:test 下会 ERR_MODULE_NOT_FOUND。
import { environmentNeedsAttention, hostEnvironmentRows } from "../settings/environment-rows.ts";
import type { MessageKey } from "../../shared/i18n";

/**
 * 铃铛里显示什么 —— 以**来源(source)**为单位的可扩展模型。
 *
 * 划分规则:**会话的事在会话里说,应用的事在铃铛里说**。
 * - 会话级事件(跑完、失败、需要审批)已经有系统通知 + 线程内提示,再进铃铛就是同一件事说三遍;
 * - 环境缺件、有新版本、云同步异常这类不属于任何一次会话,用户也没有别的地方能看到。
 *
 * ## 接入一个新类型(三步,不用碰收集器与界面)
 *
 * 1. 如果它需要新的输入,往 {@link AppNoticeContext} 里加一份状态;
 * 2. 写一个 {@link AppNoticeSource}:**纯函数**(上下文 + 文案 → 通知数组);
 * 3. 把它加进 {@link APP_NOTICE_SOURCES}。
 *
 * 几条约束是刻意的:
 * - **source 必须是纯函数**。需要联网/起子进程的取数(比如"云同步状态")由**调用方**取好放进上下文,
 *   于是收集器可以同步、可以单测,也不需要为每个来源各写一套加载/超时/取消。
 * - **单个 source 抛错不影响其它**。铃铛是"锦上添花"的东西,一个来源坏掉不该让整颗铃铛不工作
 *   (与仓库里"失败是返回值"同一条纪律)。
 * - **id 唯一**。收集器按 id 去重,所以来源之间不会互相盖掉,角标数字也不会算重。
 */

export type AppNoticeAction =
  | { kind: "settings"; page: SettingsPage }
  | { kind: "url"; url: string };

export interface AppNotice {
  /** 全局唯一。约定 `<source>:<事情>`,例如 `update:available`。 */
  id: string;
  /** 来源标识(`environment` / `update` / …)。用于分组、过滤与排查。 */
  source: string;
  /** 警告 = 影响现在能做什么;信息 = 有更好的选择。 */
  tone: "warning" | "info";
  title: string;
  body: string;
  /**
   * 细节/原文(可选):错误原文、冲突文件名这类**机器文本**。
   *
   * 与 `body` 分开是因为界面要区别对待:body 是给人读的一句话(正常字重、可换行),detail 是
   * 等宽块(长串不撑破布局,也不把正文挤成一团)。
   */
  detail?: string;
  actionLabel?: string;
  action?: AppNoticeAction;
  /**
   * 同一语气内的排序权重,大的在前。省略 = 0。
   *
   * 语气优先于权重(警告永远排在信息前面):用户先看到"不处理会坏"的事。
   */
  priority?: number;
}

/**
 * 收集器能看到的**应用状态**。
 *
 * 故意是一个"敞开"的形状:加一个新来源时,往里加一份状态即可,收集器与界面都不用改。
 */
export interface AppNoticeContext {
  environment: HostEnvironmentFacts | null;
  cloudSync: CloudSyncSnapshot | null;
  /**
   * 远程访问:有几台设备正连着这台电脑。
   *
   * 用**数量**而不是整个状态对象:铃铛只关心"现在有没有人在远程用我"这一个判断,
   * 把它缩到最小,来源就是纯函数、测试也不需要造一整份远程状态。
   */
  remoteAccessOnlineDevices?: number;
}

export type AppNoticeTranslator = (key: MessageKey) => string;

export interface AppNoticeSource {
  /** 与 {@link AppNotice.source} 一致,便于排查"这条是谁给的"。 */
  id: string;
  read(context: AppNoticeContext, t: AppNoticeTranslator): AppNotice[];
}

/**
 * 汇总所有来源。
 *
 * **同步、纯函数**:来源是纯函数(见模块头),所以这里不需要异步机制。排序规则是"警告优先,然后按
 * 权重,最后按来源顺序" —— 顺序稳定,界面不会因为一次重渲染而跳来跳去。
 */
export function collectAppNotices(
  context: AppNoticeContext,
  t: AppNoticeTranslator,
  sources: readonly AppNoticeSource[] = APP_NOTICE_SOURCES,
): AppNotice[] {
  const seen = new Set<string>();
  const collected: AppNotice[] = [];
  for (const [index, source] of sources.entries()) {
    let produced: AppNotice[];
    try {
      produced = source.read(context, t);
    } catch {
      // 一个来源坏掉不该让整颗铃铛不工作:跳过它,其余的照常显示。
      continue;
    }
    for (const notice of produced) {
      if (seen.has(notice.id)) continue;
      seen.add(notice.id);
      collected.push({ priority: 0, ...notice, source: notice.source || source.id });
    }
    void index;
  }
  return collected.sort((left, right) => {
    if (left.tone !== right.tone) return left.tone === "warning" ? -1 : 1;
    return (right.priority ?? 0) - (left.priority ?? 0);
  });
}

/**
 * 环境:只有"agent 能不能干活"的前提缺了才说。
 *
 * 数据组件、文字识别缺了不算 —— 那是可选能力(见 `EnvironmentRow.optional`)。这条曾经出现在新建页
 * 输入框底下,位置不对(那是用户准备干活的地方),现在归铃铛。
 */
export const environmentNoticeSource: AppNoticeSource = {
  id: "environment",
  read(context, t) {
    if (context.environment === null) return [];
    const rows = hostEnvironmentRows(context.environment, t);
    if (!environmentNeedsAttention(rows)) return [];
    const missing = rows.filter((row) => row.optional !== true && row.status !== "ok").map((row) => t(row.labelKey));
    return [
      {
        id: "environment:incomplete",
        source: "environment",
        tone: "warning",
        title: t("noticeEnvironmentTitle"),
        body: t("noticeEnvironmentBody").replace("{items}", missing.join("、")),
        actionLabel: t("noticeOpenEnvironment"),
        action: { kind: "settings", page: "environment" },
      },
    ];
  },
};

/**
 * **更新刻意不在这里**。
 *
 * 它已经有一个更强的家:`features/workbench/DesktopChrome.tsx` 的更新横幅 —— 自动出现、原地就能
 * 下载/重启安装、带进度条,还有「稍后」。铃铛里再放一条只能跳到「关于与更新」,是同一件事说两遍,
 * 而且更弱。
 *
 * 规则:**有专门的家就不要进铃铛**。铃铛留给"用户没有别的地方能看到"的事(环境缺件、云同步失败)。
 */

/**
 * 云同步:只有"需要你动手"的状态才说。
 *
 * 三个状态值得说:`error`(同步失败)、`conflict`(有文件冲突待选)、`needs-reconnect`(登录过期)。
 * 其余(`disabled` 用户自己关的、`idle`/`syncing`/`synced`/`offline` 正常过程)一律不说 ——
 * "正在同步"进铃铛只会变成噪声,而 `offline` 会自动重试,不需要用户做任何事。
 */
export const cloudSyncNoticeSource: AppNoticeSource = {
  id: "cloud-sync",
  read(context, t) {
    const sync = context.cloudSync;
    // 没开启就闭嘴:那是用户的选择,不是"出了问题"。
    if (sync === null || !sync.enabled) return [];
    const openSettings = { kind: "settings" as const, page: "dataPrivacy" as const };
    if (sync.status === "conflict" || sync.conflicts.length > 0) {
      return [
        {
          id: "cloud-sync:conflict",
          source: "cloud-sync",
          tone: "warning",
          title: t("noticeCloudSyncConflictTitle").replace("{count}", String(Math.max(sync.conflicts.length, 1))),
          body: t("noticeCloudSyncConflictBody"),
          ...(sync.conflicts.length === 0 ? {} : { detail: sync.conflicts.slice(0, 5).join(", ") }),
          actionLabel: t("noticeOpenCloudSync"),
          action: openSettings,
        },
      ];
    }
    if (sync.status === "error") {
      return [
        {
          id: "cloud-sync:error",
          source: "cloud-sync",
          tone: "warning",
          title: t("noticeCloudSyncErrorTitle"),
          body: t("noticeCloudSyncErrorBody"),
          // 机器文本单独放 `detail`:塞进正文会把那一行挤成一团(界面只显示首行,悬停看全文)。
          ...(sync.lastError === null ? {} : { detail: sync.lastError }),
          actionLabel: t("noticeOpenCloudSync"),
          action: openSettings,
        },
      ];
    }
    if (sync.status === "needs-reconnect") {
      return [
        {
          id: "cloud-sync:reconnect",
          source: "cloud-sync",
          tone: "warning",
          title: t("noticeCloudSyncReconnectTitle"),
          body: t("noticeCloudSyncReconnectBody"),
          actionLabel: t("noticeOpenCloudSync"),
          action: openSettings,
        },
      ];
    }
    return [];
  },
};

/**
 * 一条通知的**内容指纹**:用它判断"用户忽略的是不是同一件事"。
 *
 * 取 `detail`(机器文本,最能反映"事情变了没")优先,退回 `title + body`。内容一变,
 * 之前那条"知道了"就不再适用,通知重新出现 —— 这正是我们要的。
 */
export function noticeFingerprint(notice: AppNotice): string {
  return notice.detail ?? `${notice.title}\u0000${notice.body}`;
}

/** 过滤掉用户已经"知道了"的那些(同 id 且内容没变)。 */
export function visibleNotices(notices: readonly AppNotice[], dismissed: Readonly<Record<string, string>>): AppNotice[] {
  return notices.filter((notice) => dismissed[notice.id] !== noticeFingerprint(notice));
}

/** 注册表:新来源加在这里。顺序只影响同语气同权重时的先后。 */
/**
 * 远程访问:**有设备正连着**时说一句。
 *
 * 这一条同时承担"可见"的责任:远端能做什么是用户在设置里授权的,但"现在有人在用"必须随时看得见 ——
 * 所以它进铃铛(应用级),而且主进程那边还会弹一次系统通知(见 `remote-access-service.ts`)。
 */
export const remoteAccessNoticeSource: AppNoticeSource = {
  id: "remote-access",
  read(context, t) {
    const online = context.remoteAccessOnlineDevices ?? 0;
    if (online <= 0) return [];
    return [
      {
        id: "remote-access:in-use",
        source: "remote-access",
        tone: "info",
        title: t("noticeRemoteAccessTitle").replace("{count}", String(online)),
        body: t("noticeRemoteAccessBody"),
        actionLabel: t("noticeOpenRemoteAccess"),
        action: { kind: "settings", page: "remoteAccess" },
      },
    ];
  },
};

export const APP_NOTICE_SOURCES: readonly AppNoticeSource[] = [
  environmentNoticeSource,
  cloudSyncNoticeSource,
  remoteAccessNoticeSource,
];
