import { BookPlus, Check, Copy, LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
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
  const { knowledge, t } = usePreferences();
  const client = useRuntimeClient();
  /**
   * 归档这条回答。
   *
   * **自带而不从外面传**:它只依赖"这条回答的正文"与"知识库开着没有",而两者在这里都有。
   * 从消息行穿三层 props 只为传一个回调,换来的是一处编译期不报、只在运行时静默消失的接线。
   *
   * 归档由**知识会话**做(写知识库的能力只在那个画像上,见设计文档 §6.1),所以这里只是
   * 把正文交出去;新会话会出现在侧栏里,用户能打开看那一页是怎么写的。
   */
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState(false);
  const fileToKnowledge = async () => {
    if (filing || copyText.trim() === "") return;
    setFiling(true);
    try {
      await client.fileKnowledgeAnswer(copyText);
      setFiled(true);
    } finally {
      setFiling(false);
    }
  };

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
      {/*
        归档放在**重做右边、最靠里**的位置:它是这一行里唯一"把结果留下来"的动作,
        而复制/重做都是就地重来一次。三种状态共用一颗按钮(空闲 / 进行中 / 已存),
        所以它是**图标按钮** —— 带文字的版本会在每次多出一个词,而这一行本来就窄。

        知识库关着就不给这颗按钮:归档要有一个能写的知识库,而那个开关在设置里。
      */}
      {knowledge.enabled && (
        <button
          aria-label={filed ? t("knowledgeFiled") : t("knowledgeFileAnswer")}
          className="grid h-6 w-6 place-items-center rounded-[5px] hover:bg-[#efefeb] hover:text-[#454540] disabled:opacity-50"
          disabled={filing || filed}
          onClick={() => void fileToKnowledge()}
          title={filed ? t("knowledgeFiled") : t("knowledgeFileAnswerHelp")}
          type="button"
        >
          {filing ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : filed ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <BookPlus className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      <span className="ml-auto font-mono text-[11px] text-[#aaa9a1]">
        {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </span>
    </div>
  );
}
