import { Button, Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@wordless/ui-kit";
import { AlertTriangle, Bell, Check, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import type { SettingsPage } from "../settings/SettingsDialog";
import { collectAppNotices, noticeFingerprint, visibleNotices, type AppNotice, type AppNoticeAction } from "./app-notices";
import type { CloudSyncSnapshot, HostEnvironmentFacts } from "@wordless/protocol";

/**
 * 侧边栏底部那颗铃铛。
 *
 * 之前它是个**死按钮**:有图标、有 aria-label,点了什么都不发生。现在它是"应用对你说的话"的入口 ——
 * 只放**关于应用本身、而且没有别的家**的事(见 `app-notices.ts` 的划分规则):环境缺件、云同步失败。
 * 会话级事件走系统通知与线程内提示;**更新走 `DesktopChrome` 的横幅**(它更强)。
 *
 * 几处刻意的选择:
 * - **角标是数字,不是红点**:状态不能只靠颜色,而且"有几件事"比"有事"更有用。
 * - **不做已读/未读**:这里的内容是**从状态推出来的**(环境缺件、更新待重启),不是事件流。事情解决了
 *   它自己就消失 —— 记一个"已读"反而会出现"标记已读但问题还在"的怪状态。
 * - **空的时候也说一句话**:点开一片空白会让人以为坏了。
 */
export function NotificationCenter({ onOpenSettings }: { onOpenSettings: (page?: SettingsPage) => void }) {
  const { dismissedNotices, dismissNotice, t } = usePreferences();
  const client = useRuntimeClient();
  const [environment, setEnvironment] = useState<HostEnvironmentFacts | null>(null);
  const [cloudSync, setCloudSync] = useState<CloudSyncSnapshot | null>(null);
  const [remoteOnlineDevices, setRemoteOnlineDevices] = useState(0);
  const [open, setOpen] = useState(false);

  // 环境事实取一次(与设置页同一来源;宿主那边有节流缓存,代价很小)。取不到就当作"还不知道",
  // **不报警** —— `client` 是一个大接口,只实现了一部分的宿主(测试里的桩)不该让铃铛崩掉。
  useEffect(() => {
    let cancelled = false;
    const read = client.getHostEnvironmentFacts;
    if (typeof read !== "function") return;
    void read
      .call(client)
      .then((facts) => {
        if (!cancelled) setEnvironment(facts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);

  // 收集器是纯函数、来源可扩展(见 `app-notices.ts` 的"接入一个新类型"):这里不需要知道有哪些类型。
  // 云同步是**推**过来的(宿主在状态变化时发 `cloud-sync.changed`),所以这里订阅而不是轮询。
  useEffect(() => {
    let cancelled = false;
    const read = client.getCloudSyncSnapshot;
    if (typeof read !== "function") return;
    void read
      .call(client)
      .then((snapshot) => {
        if (!cancelled) setCloudSync(snapshot);
      })
      .catch(() => undefined);
    const unsubscribe = client.subscribeHost?.((event) => {
      if (event.type === "cloud-sync.changed") setCloudSync(event.snapshot);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client]);

  // 用户"知道了"的那些先摘掉(内容变了会自动回来,见 `visibleNotices`)。
  // 远程访问:只关心"有几台在线",所以拉一次状态就够(设备上下线时主进程会弹系统通知)。
  useEffect(() => {
    const read = client.getRemoteAccessState;
    if (typeof read !== "function") return;
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const state = await read();
        if (active) setRemoteOnlineDevices(state.devices.filter((device) => device.online).length);
      } catch {
        // 读不到就当没有 —— 铃铛不该因为一个来源失败而多出一条假消息。
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client]);

  const notices = visibleNotices(
    collectAppNotices({ environment, cloudSync, remoteAccessOnlineDevices: remoteOnlineDevices }, t),
    dismissedNotices,
  );

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button aria-label={t("notifications")} className="relative" size="icon" type="button" variant="ghost">
          <Bell className="h-4 w-4" />
          {notices.length > 0 ? (
            <span
              aria-label={t("noticeCount").replace("{count}", String(notices.length))}
              className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[#9a6a2f] px-1 text-[9px] font-semibold text-white dark:bg-[#e0b98a] dark:text-[#2a2318]"
            >
              {notices.length}
            </span>
          ) : null}
        </Button>
      </DialogTrigger>
      {/*
        **右上角的消息中心**,不是挂在图标上的浮层。
        触发器在侧边栏底部,面板却在右上角 —— 这是刻意的(与 open-vetta 同一套):消息中心是"全局的
        东西",而 320px 的浮层贴在底部图标上,一有长文本就挤成一团。
        面板本身:`w-[420px]`、`max-h` 卡在 560px(视口更小时跟着缩)、列表区独立滚动 —— 条数再多也
        不会把面板撑到屏幕外。
      */}
      <DialogContent
        aria-describedby={undefined}
        // 背景用 `bg-card`:**`bg-popover` 在 Wordless 的令牌表里不存在**(`packages/ui-kit/src/styles/tokens.css`
        // 只有 background/card/muted/secondary),所以那一版面板是**透明的**,和背景分不开。
        // `bg-card` 就是这里的"浮起表面"(ui-kit 的 DialogContent 用的也是它)。
        className="left-auto right-3 top-12 flex max-h-[min(460px,calc(100vh-5rem))] w-[360px] max-w-[calc(100vw-1.5rem)] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-xl border border-border bg-card p-0 shadow-lg"
        overlayClassName="bg-foreground/10 backdrop-blur-[1px]"
        // 自带那个关闭按钮是绝对定位在右上角的,会和紧凑的头部/第一条压在一起 —— 关掉它,
        // 改在头部这一行里放一个(位置由布局决定,不会重叠)。
        showCloseButton={false}
      >
        <div className="flex items-center gap-1.5 px-3.5 py-2.5">
          <Bell aria-hidden className="h-3.5 w-3.5 text-[#8a8a83] dark:text-muted-foreground" />
          <DialogTitle className="text-[12.5px] font-semibold">{t("notifications")}</DialogTitle>
          <DialogClose asChild>
            <Button aria-label={t("noticeClose")} className="ml-auto h-6 w-6" size="icon" type="button" variant="ghost">
              <X className="h-3.5 w-3.5" />
            </Button>
          </DialogClose>
        </div>
        {notices.length === 0 ? (
          <p className="px-3.5 pb-3.5 text-[11px] leading-5 text-[#8a8a83] dark:text-muted-foreground">{t("noticeEmpty")}</p>
        ) : (
          <ul className="flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-2.5 pt-0.5">
            {notices.map((notice) => (
              <NoticeItem
                key={notice.id}
                notice={notice}
                onDismiss={() => void dismissNotice(notice.id, noticeFingerprint(notice))}
                onAct={(action) => {
                  setOpen(false);
                  if (action.kind === "settings") onOpenSettings(action.page);
                  else void client.openExternalUrl(action.url);
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoticeItem({ notice, onAct, onDismiss }: { notice: AppNotice; onAct: (action: AppNoticeAction) => void; onDismiss: () => void }) {
  const warning = notice.tone === "warning";
  const { t } = usePreferences();
  return (
    // 卡片用 `bg-muted`:面板是 `bg-card`(白),两者在浅色与深色下都能分开 —— 之前整块是透明的,
    // 卡片和面板糊在一起。
    <li className="rounded-lg bg-muted px-2.5 py-2">
      <div className="flex gap-2">
        <span
          aria-hidden
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ${warning ? "bg-[#faf0e6] text-[#9a6a2f] dark:bg-[#2f2620] dark:text-[#e0b98a]" : "bg-[#eef1f5] text-[#4a5b7a] dark:bg-[#22252c] dark:text-[#b8c8e0]"}`}
        >
          {warning ? <AlertTriangle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <p className="min-w-0 flex-1 text-[12px] font-medium leading-[18px]">{notice.title}</p>
            {/* 「知道了」:icon-only,常驻在标题右侧。忽略的是**这一次的内容**,变了下一次还会出现。 */}
            <Button
              aria-label={t("noticeDismiss")}
              className="-mr-0.5 -mt-0.5 h-5 w-5 shrink-0 text-[#8a8a83] dark:text-muted-foreground"
              onClick={onDismiss}
              size="icon"
              title={t("noticeDismiss")}
              type="button"
              variant="ghost"
            >
              <Check className="h-3 w-3" />
            </Button>
          </div>
          <p className="mt-0.5 text-[11px] leading-[18px] text-[#73736d] dark:text-muted-foreground">{notice.body}</p>
          {/* 机器文本单独成块:`break-words` 让长串(路径、错误原文)自己折行,不去挤正文。 */}
          {notice.detail ? (
            // **只显示首行**:错误原文常常是一整段(堆栈、HTTP 响应),全铺开就会把面板挤满 ——
            // 需要全文时鼠标悬停即可(`title`)。
            <p
              className="mt-1 truncate rounded-md bg-black/[0.04] px-1.5 py-1 font-mono text-[10px] leading-[15px] text-[#64645e] dark:bg-white/[0.05] dark:text-muted-foreground"
              title={notice.detail}
            >
              {notice.detail.split("\n")[0]}
            </p>
          ) : null}
          {/* 动作是**可选**的:有些提醒只是"告诉你一声",这时不摆按钮,而不是摆一个点了没反应的。 */}
          {notice.action && notice.actionLabel ? (
            <Button className="mt-1.5 h-6.5 px-2 text-[10.5px]" onClick={() => onAct(notice.action!)} size="sm" type="button" variant="outline">
              {notice.actionLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
