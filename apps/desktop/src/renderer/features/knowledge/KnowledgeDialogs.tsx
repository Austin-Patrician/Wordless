import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@wordless/ui-kit";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import { safeExternalUrl } from "../thread/message-markdown-policy";
// 与对话共用同一套 markdown 排版(那个样式表由 MessageMarkdown 引入,这里显式引一次)。
import "../thread/message-markdown.css";

/**
 * 知识库自己的三个弹窗:**确认**、**要一个名字**、**预览一页**。
 *
 * 为什么不用 `window.confirm` / `window.prompt`:
 *   - `window.prompt` 在 Electron 里**根本不支持**(调了返回 null),所以"新建库"那颗按钮
 *     点了什么都不会发生;
 *   - `window.confirm` 能用,但那是**原生模态** —— 它带的是应用图标,而未打包运行时那个图标
 *     是 Electron 自己的(用户看到的就是这个);
 *   - 而且原生模态与这一页其余部分的样式、暗色主题、Esc 行为都不一致。
 *
 * 为什么用 ui-kit 的 `Dialog` 而不是自己搓 portal:**高弹窗的滚动是它已经解决的问题**
 * (`DialogContent` 自带 `max-h-[calc(100vh-2rem)]` + `overflow-hidden`)。自己搓的那版
 * 用 `max-h-full`,在 `place-items-center` 的网格里百分比约束不住内容 —— 预览一长就顶出
 * 窗口高度,而且滚不动。
 *
 * 两处偏移是刻意的:窗口顶部那条 30/34px 的标题栏在页面**之内**(macOS 是 hiddenInset),
 * 所以居中要往下让一半、最大高度要减掉整条 —— 否则弹窗的顶边压在标题栏底下。
 */
const DIALOG_POSITION =
  "top-[calc(50%+var(--wordless-chrome-height)/2)] max-h-[calc(100vh-var(--wordless-chrome-height)-2rem)]";

export function KnowledgeConfirmDialog({
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  open,
  title,
  tone = "default",
}: {
  confirmLabel?: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  /** `danger` = 不可撤销的动作(删除、移动原件)。 */
  tone?: "default" | "danger";
}) {
  const { t } = usePreferences();
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      open={open}
    >
      <DialogContent
        className={`${DIALOG_POSITION} w-[min(26rem,calc(100vw-2rem))] p-5`}
        role="alertdialog"
        showCloseButton={false}
      >
        <DialogTitle className="text-[15px] font-bold">{title}</DialogTitle>
        <DialogDescription className="mt-3 text-[12px] leading-5 text-muted-foreground">{description}</DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="outline">
            {t("cancel")}
          </Button>
          <Button
            className={tone === "danger" ? "bg-[#e25358] text-white hover:bg-[#cf4147]" : undefined}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel ?? t("confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function KnowledgePromptDialog({
  confirmLabel,
  description,
  initialValue = "",
  onCancel,
  onSubmit,
  open,
  placeholder,
  title,
}: {
  confirmLabel?: string;
  description: string;
  initialValue?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  open: boolean;
  placeholder?: string;
  title: string;
}) {
  const { t } = usePreferences();
  const [value, setValue] = useState(initialValue);
  // 每次打开都从初值开始 —— 否则上一次的输入会留在框里,而用户以为那是新的一次。
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      open={open}
    >
      <DialogContent
        className={`${DIALOG_POSITION} w-[min(26rem,calc(100vw-2rem))] p-5`}
        role="alertdialog"
        showCloseButton={false}
      >
        <DialogTitle className="text-[15px] font-bold">{title}</DialogTitle>
        <DialogDescription className="mt-3 text-[12px] leading-5 text-muted-foreground">{description}</DialogDescription>
        <input
          autoFocus
          className="mt-3 w-full rounded-lg border border-border bg-card px-3 py-2 text-[13px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim() !== "") onSubmit(value);
          }}
          placeholder={placeholder}
          value={value}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="outline">
            {t("cancel")}
          </Button>
          <Button disabled={value.trim() === ""} onClick={() => onSubmit(value)} type="button">
            {confirmLabel ?? t("confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 一页的预览。
 *
 * 列表里能看见标题与一句话描述,唯独看不见**这一页写了什么** —— 而那是判断"整理得对不对"
 * 唯一的东西。所以点标题就预览正文。
 *
 * 用**轻渲染**(react-markdown + gfm):预览不需要语法高亮、mermaid、公式 —— 那些是
 * `MessageMarkdown` 的重量级能力,把整套拖进知识库这一页不值得。
 */
export function KnowledgePreviewDialog({
  body,
  onClose,
  onOpenPage,
  open,
  page,
}: {
  /** `undefined` = 还在读;`""` = 读不出来。 */
  body: string | undefined;
  onClose: () => void;
  /**
   * 在**同一个弹窗**里打开另一页 —— 概念页正文里的 `/concepts/…`、`/sources/…` 链接就是
   * 这么跟进的。**必须有**:这些链接指向的路径在应用里不存在,不接管它们的话,点下去会把
   * 整个渲染进程跳走(没有导航守卫)。证据与结论之间的那条路,就是这个参数。
   */
  onOpenPage: (path: string) => void;
  open: boolean;
  page: { description: string; path: string; tags: string[]; title: string } | undefined;
}) {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  if (page === undefined) return null;
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={open}
    >
      {/*
        **这一行就是滚动能用的关键**:`DialogContent` 给的是"最大高度 + 不溢出",而里面
        分成"固定头部 + 可滚动正文"两段 —— 正文那段 `min-h-0 flex-1 overflow-y-auto`。
        少任何一个,长页都会顶出窗口(或者滚不动)。
      */}
      <DialogContent
        className={`${DIALOG_POSITION} flex w-[min(720px,calc(100vw-2rem))] flex-col p-0`}
        showCloseButton={false}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[15px] font-bold">{page.title}</DialogTitle>
            <DialogDescription className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {page.path}
            </DialogDescription>
          </div>
          <button
            aria-label={t("noticeClose")}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[12px] leading-5 text-muted-foreground">{page.description}</p>
          {page.tags.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground/80">{page.tags.join(" · ")}</p>}
          {/* 复用对话里那套 markdown 排版 —— 预览不该长成另一种样子。 */}
          <div className="message-markdown mt-4 text-[13px] leading-6">
            {body === undefined ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {t("knowledgeLoading")}
              </p>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // **内部链接必须在弹窗里跟进,其余一律降级。**
                  // 对话里那套 markdown 的做法(见 MessageMarkdown 的 `a:`):不认识的链接
                  // 不渲染成 `<a>` —— 否则点了会把整个渲染进程跳走(应用没有导航守卫)。
                  a: ({ children, href }) => {
                    const target = typeof href === "string" ? href.trim() : "";
                    // 库内的页(bundle 相对路径):在同一个预览里打开它。
                    // ReactMarkdown 会把 href 做 URL 编码,中文路径就成了 `%E6%A6%82…` ——
                    // 进页面前要先解码,否则读不到(带 % 的路径没人有)。
                    if (target.startsWith("/") && target.endsWith(".md")) {
                      let decoded = target;
                      try {
                        decoded = decodeURIComponent(target);
                      } catch {
                        /* 解不开就按原样试 —— 读不到时预览会把错误如实说出来 */
                      }
                      return (
                        <button
                          className="font-medium text-[#587846] underline decoration-[#a8bb91] underline-offset-2 hover:text-[#3f5c30] dark:text-[#bad47a] dark:decoration-[#5f7546]"
                          onClick={() => onOpenPage(decoded)}
                          type="button"
                        >
                          {children}
                        </button>
                      );
                    }
                    const external = safeExternalUrl(target);
                    if (external === null) {
                      // 不是链接的(锚点、相对路径、javascript:…):当文字,不给它"能点"的样子。
                      return <span className="text-muted-foreground underline decoration-dotted">{children}</span>;
                    }
                    return (
                      <button
                        className="font-medium text-[#587846] underline decoration-[#a8bb91] underline-offset-2 hover:text-[#3f5c30] dark:text-[#bad47a] dark:decoration-[#5f7546]"
                        onClick={() => void client.openExternalUrl(external)}
                        type="button"
                      >
                        {children}
                      </button>
                    );
                  },
                }}
              >
                {body}
              </ReactMarkdown>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
