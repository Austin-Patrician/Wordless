import { Button, Popover, PopoverContent, PopoverTrigger } from "@wordless/ui-kit";
import { AlertTriangle, Bell, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useOptionalUpdateSnapshot } from "../../platform/desktop-update";
import { useRuntimeClient } from "../../shared/runtime";
import type { SettingsPage } from "../settings/SettingsDialog";
import { appNotices, type AppNotice } from "./app-notices";
import type { HostEnvironmentFacts } from "@wordless/protocol";

/**
 * 侧边栏底部那颗铃铛。
 *
 * 之前它是个**死按钮**:有图标、有 aria-label,点了什么都不发生。现在它是"应用对你说的话"的入口 ——
 * 只放**关于应用本身**的事(见 `app-notices.ts` 的划分规则);会话级事件仍旧走系统通知与线程内提示。
 *
 * 几处刻意的选择:
 * - **角标是数字,不是红点**:状态不能只靠颜色,而且"有几件事"比"有事"更有用。
 * - **不做已读/未读**:这里的内容是**从状态推出来的**(环境缺件、更新待重启),不是事件流。事情解决了
 *   它自己就消失 —— 记一个"已读"反而会出现"标记已读但问题还在"的怪状态。
 * - **空的时候也说一句话**:点开一片空白会让人以为坏了。
 */
export function NotificationCenter({ onOpenSettings }: { onOpenSettings: (page?: SettingsPage) => void }) {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  const update = useOptionalUpdateSnapshot();
  const [environment, setEnvironment] = useState<HostEnvironmentFacts | null>(null);
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

  const notices = appNotices({ environment, update }, t);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-3" side="top" sideOffset={8}>
        <p className="px-1 text-[12px] font-semibold">{t("notifications")}</p>
        {notices.length === 0 ? (
          <p className="mt-2 px-1 text-[11px] leading-5 text-[#8a8a83] dark:text-muted-foreground">{t("noticeEmpty")}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {notices.map((notice) => (
              <NoticeItem
                key={notice.id}
                notice={notice}
                onAct={(action) => {
                  setOpen(false);
                  if (action.kind === "settings") onOpenSettings(action.page);
                  else void client.openExternalUrl(action.url);
                }}
              />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NoticeItem({ notice, onAct }: { notice: AppNotice; onAct: (action: AppNotice["action"]) => void }) {
  const warning = notice.tone === "warning";
  return (
    <li className="rounded-xl bg-[#f7f7f5] p-2.5 dark:bg-[#22241c]">
      <div className="flex gap-2">
        <span
          aria-hidden
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-[6px] ${warning ? "bg-[#faf0e6] text-[#9a6a2f] dark:bg-[#2f2620] dark:text-[#e0b98a]" : "bg-[#eef1f5] text-[#4a5b7a] dark:bg-[#22252c] dark:text-[#b8c8e0]"}`}
        >
          {warning ? <AlertTriangle className="h-3 w-3" /> : <Info className="h-3 w-3" />}
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-medium leading-5">{notice.title}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-[#73736d] dark:text-muted-foreground">{notice.body}</p>
          <Button className="mt-1.5 h-7 px-2 text-[11px]" onClick={() => onAct(notice.action)} size="sm" type="button" variant="outline">
            {notice.actionLabel}
          </Button>
        </div>
      </div>
    </li>
  );
}
