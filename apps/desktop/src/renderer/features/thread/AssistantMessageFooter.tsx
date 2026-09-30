import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { usePreferences } from "../../shared/preferences";
import { assistantFooterVisibility } from "./assistant-message-footer";

/**
 * 助手回复底部的操作行:**复制、用量详情、时间戳**每条回复都有;重做由调用方只在最新一轮传入。
 *
 * 单独成一个组件是为了能被直接渲染测试 —— 之前这段 JSX 埋在 `ThreadView` 里,唯一能判断它
 * 有没有出现的方式是看整棵树的测试,而它恰好就在那里退化成"只有最新一条才有"。
 */
export function AssistantMessageFooter({
  copyText,
  hasPendingInteraction,
  isStreaming,
  isTurnRunning,
  messageCount,
  retry,
  timestamp,
  usage,
}: {
  copyText: string;
  hasPendingInteraction: boolean;
  isStreaming: boolean;
  /** 这一行就是正在生成的那一轮 —— 回复没答完,不摆操作行。 */
  isTurnRunning: boolean;
  messageCount: number;
  /** 重做 / 版本切换。**只有最新一轮**才传,中间的回复传 undefined。 */
  retry?: ReactNode;
  timestamp: number;
  usage?: ReactNode;
}) {
  const { t } = usePreferences();
  const { showActions } = assistantFooterVisibility({
    hasPendingInteraction,
    isStreaming,
    isTurnRunning,
    messageCount,
  });
  if (!showActions) return null;
  return (
    <div className="mt-4 flex items-center gap-2 text-[#898981]">
      <button
        aria-label={t("threadCopyResponse")}
        className="grid h-6 w-6 place-items-center rounded-[5px] hover:bg-[#efefeb] hover:text-[#454540]"
        onClick={() => void navigator.clipboard.writeText(copyText)}
        type="button"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      {usage}
      {retry}
      <span className="ml-auto font-mono text-[11px] text-[#aaa9a1]">
        {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
    </div>
  );
}
