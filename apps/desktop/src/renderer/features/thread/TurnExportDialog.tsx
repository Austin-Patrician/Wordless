import { Check, CircleAlert, Copy, Download, FileDown, FoldVertical, ImageDown, LoaderCircle, Share2, UnfoldVertical, Wrench, X } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { ConversationMessage, MessageToolBlock } from "@wordless/domain";
import { Dialog, DialogClose, DialogContent, DialogTitle, Tooltip, TooltipContent, TooltipTrigger, cn } from "@wordless/ui-kit";
import wordlessIcon from "../../../icons/common-icons/wordless-brand.svg";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import { useRuntimeClient } from "../../shared/runtime";
import { usePreferences } from "../../shared/preferences";
import { MessageMarkdown } from "./MessageMarkdown";
import { ToolActivityGroupHeader } from "./ToolActivityGroup";
import { ToolActivityRow, standardToolIcon } from "../workbench/renderer-registry";
import {
  toolCompletedWarning,
  toolRowDetail,
  toolRowSummary,
} from "../workbench/tool-row-presentation";
import {
  buildToolActivityGroups,
  type ToolActivityGroup,
  type ToolActivityLayout,
} from "./tool-activity-groups";
import { captureTurnPreview, type CaptureTurnPreview } from "./turn-export-screenshot";
import { buildTurnMarkdown, buildExportFileName, bytesToBase64, hasExportableText } from "./turn-export";
import "./turn-export.css";

/**
 * 导出这一轮的助手回复。
 *
 * 数据流是单向的:
 *
 * ```
 *   操作行图标 → modal(顶部工具条 + 预览) ─→ .md 文本 ─┬→ 复制
 *                                                     └→ 保存
 *                                └→ 预览节点 ─→ PNG 字节 ─┬→ 复制(系统剪贴板)
 *                                                        └→ 保存(经保存对话框)
 * ```
 *
 * **没有左右分栏**:所有动作都是图标,摆在 header 的工具条里。分栏的宽度是从预览区借的
 * (弹层越窄、纸越窄、导出的长图也越窄),而这一栏原本大部分是空白。搬到 header 之后弹层
 * 从 64rem 收到 56rem,纸仍拿得到完整的 820px。保存路径这类**文字**结果放在底部一条状态栏,
 * 那里本来就是它该待的地方(路径很长,塞进侧栏只会折成三行)。
 */

type ExportFormat = "image" | "markdown";

export function TurnExportButton({
  capture,
  messages,
  timestamp,
}: {
  /** 只有测试注入:生产走 snapdom(见 `turn-export-screenshot.ts`)。 */
  capture?: CaptureTurnPreview;
  messages: readonly ConversationMessage[];
  timestamp: number;
}) {
  const bridge = useRuntimeClient();
  const { t } = usePreferences();
  const [open, setOpen] = useState(false);
  const exportable = hasExportableText(messages);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={t("threadExportTurn")}
            className="grid h-6 w-6 place-items-center rounded-[5px] hover:bg-[#efefeb] hover:text-[#454540] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!exportable}
            onClick={() => setOpen(true)}
            type="button"
          >
            {/*
              `Share2` 而不是 `FileDown`:这颗按钮**不直接存文件**(它开一个面板,里面还有
              复制与两种格式),"文件+下箭头"读起来像"下载这个文件",与真实行为不符。
              "带出去"才是它的意思 —— 而且这一行左边就是「复制回复」,分享语义不会撞车。
            */}
            <Share2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-56">
          {t("threadExportTurn")}
          <span className="block text-[11px] text-[#aaa9a1]">
            {exportable ? t("threadExportTurnHelp") : t("threadExportTurnEmptyHelp")}
          </span>
        </TooltipContent>
      </Tooltip>
      {open && (
        <TurnExportDialog
          bridge={bridge}
          capture={capture}
          messages={messages}
          onClose={() => setOpen(false)}
          timestamp={timestamp}
        />
      )}
    </>
  );
}

function TurnExportDialog({
  bridge,
  messages,
  onClose,
  timestamp,
  capture = captureTurnPreview,
}: {
  bridge: DesktopBridge;
  messages: readonly ConversationMessage[];
  onClose: () => void;
  timestamp: number;
  /** 只有测试注入:生产走 snapdom(见 `turn-export-screenshot.ts`)。 */
  capture?: CaptureTurnPreview;
}) {
  const { t } = usePreferences();
  const [format, setFormat] = useState<ExportFormat>("image");
  const [includeTools, setIncludeTools] = useState(true);
  /**
   * 工具组的展开状态:**默认全折叠**。单个组在预览里照常可点——哪个组里有值得带走的
   * 输出,展开那一个导出;工具条上的两个图标负责"整轮默认态"。
   */
  const [groupOverrides, setGroupOverrides] = useState(() => new Map<string, boolean>());
  const toolGroupLayout = useMemo(() => buildToolActivityGroups(messages), [messages]);
  const previewRef = useRef<HTMLDivElement | null>(null);
  /**
   * **哪个动作在忙**,而不是"忙"。共用一个布尔值时两颗按钮会一起转圈、一起显示「正在生成…」——
   * 用户按的是保存,复制却在转,看上去像两个动作都在跑。现在只有被按的那颗转,其余只禁用
   * (禁用的理由是防止并发抓图,不是"它也在跑")。
   */
  const [busyAction, setBusyAction] = useState<"save" | "copy" | null>(null);
  const busy = busyAction !== null;
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isGroupExpanded = (group: ToolActivityGroup): boolean => groupOverrides.get(group.id) ?? false;
  const toggleGroup = (group: ToolActivityGroup): void =>
    setGroupOverrides((previous) => {
      const next = new Map(previous);
      next.set(group.id, !(previous.get(group.id) ?? false));
      return next;
    });
  const setAllGroups = (expanded: boolean): void =>
    setGroupOverrides(new Map(toolGroupLayout.groups.map((group) => [group.id, expanded])));

  /**
   * 捕获一次,执行动作,把"结果"与"退化"说全。
   *
   * 动作自己返回它的成功话术(如保存路径),截图的退化计数(外链图没嵌上)由这里追加 ——
   * 两条信息并存,不能让后者覆盖前者:用户得同时知道"存到了哪"和"图里少了什么"。
   */
  const withCapture = async (
    action: (bytes: Uint8Array) => Promise<string | void>,
    actor: "save" | "copy",
  ): Promise<void> => {
    setError(null);
    setNotice(null);
    setBusyAction(actor);
    try {
      const preview = previewRef.current;
      if (!preview) return;
      const { bytes, blockedImages } = await capture(preview);
      const result = await action(bytes);
      const blocked =
        blockedImages > 0
          ? t("threadExportImagesBlocked").replaceAll("{count}", String(blockedImages))
          : null;
      const parts = [result ?? null, blocked].filter((part): part is string => part !== null);
      if (parts.length > 0) setNotice(parts.join("\n"));
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(t("threadExportFailed").replaceAll("{detail}", detail));
    } finally {
      setBusyAction(null);
    }
  };

  const saveImage = (): void =>
    void withCapture(async (bytes) => {
      const result = await bridge.saveExportFile({
        data: bytesToBase64(bytes),
        extension: "png",
        fileName: buildExportFileName(messages, timestamp, "png"),
      });
      if (result.ok) return t("threadExportSaved").replaceAll("{path}", result.path);
      if (result.reason !== "cancelled")
        setError(t("threadExportFailed").replaceAll("{detail}", result.reason));
      return undefined;
    }, "save");

  const copyImage = (): void =>
    void withCapture(async (bytes) => {
      const copied = await bridge.copyExportImage({ data: bytesToBase64(bytes) });
      if (copied) return t("threadExportCopied");
      setError(t("threadExportFailed").replaceAll("{detail}", t("threadExportCopyFailed")));
      return undefined;
    }, "copy");

  const md = useMemo(() => buildTurnMarkdown(messages, { includeTools, t }), [includeTools, messages, t]);

  const saveMarkdown = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setBusyAction("save");
    try {
      const bytes = new TextEncoder().encode(md);
      const result = await bridge.saveExportFile({
        data: bytesToBase64(bytes),
        extension: "md",
        fileName: buildExportFileName(messages, timestamp, "md"),
      });
      if (result.ok) setNotice(t("threadExportSaved").replaceAll("{path}", result.path));
      else if (result.reason !== "cancelled")
        setError(t("threadExportFailed").replaceAll("{detail}", result.reason));
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(t("threadExportFailed").replaceAll("{detail}", detail));
    } finally {
      setBusyAction(null);
    }
  };

  const copyMarkdown = (): void => {
    setError(null);
    setNotice(null);
    setBusyAction("copy");
    void navigator.clipboard.writeText(md).then(
      () => {
        setNotice(t("threadExportCopied"));
        setBusyAction(null);
      },
      () => {
        setError(t("threadExportFailed").replaceAll("{detail}", t("threadExportCopyFailed")));
        setBusyAction(null);
      },
    );
  };

  /*
   * 工具组只有一个开关按钮:**点击切换**整轮的展开/折叠,而不是摆两颗(展开一颗、折叠一颗)。
   * 图标与 tooltip 说的是"点下去会发生什么",当前状态由预览本身回答(行就在眼前)。
   */
  const allGroupsExpanded =
    toolGroupLayout.groups.length > 0 && toolGroupLayout.groups.every(isGroupExpanded);

  const isImage = format === "image";
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="flex h-[min(88vh,56rem)] w-[min(56rem,calc(100vw-2rem))] flex-col p-0"
        showCloseButton={false}
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-2.5">
          <DialogTitle className="shrink-0 text-[15px] font-semibold">{t("threadExportTurn")}</DialogTitle>
          <span className="truncate text-[12px] text-muted-foreground">
            {t("threadExportScope").replaceAll("{count}", String(messages.length))}
          </span>
          {/*
            动作全在工具条里。格式与「工具组/包含工具调用」是**成对的开关**,保存与复制是动作;
            中间那条竖线把两组分开。说法一律进 tooltip 与 aria-label —— 图标按钮没有可见文字,
            这两样是它唯一的说明(键盘与读屏只能拿到 aria-label,tooltip 只解决鼠标)。

            **关闭按钮也在这条工具条里**(所以 DialogContent 关掉了自带的绝对定位那颗):
            绝对定位的关闭按钮与这一行的高度、内边距各算各的,垂直方向永远差几个像素,横向也
            只能靠猜的 padding 让开 —— 放进同一行就没有"对齐"这件事要处理了。
          */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <IconToggle
              action="format-image"
              active={isImage}
              label={t("threadExportFormatImage")}
              onClick={() => setFormat("image")}
            >
              <ImageDown className="h-4 w-4" />
            </IconToggle>
            <IconToggle
              action="format-markdown"
              active={!isImage}
              label={t("threadExportFormatMarkdown")}
              onClick={() => setFormat("markdown")}
            >
              {/*
                与 `ImageDown` 成对:图 + 下箭头 / 文件 + 下箭头 = "导出为图片 / 导出为文件"。
                `ImageDown` 已经是应用里"导出图片"的既定图标(设计工具条),顺着它选对应物,
                而不是把两个格式配上一对不相干的图标。
              */}
              <FileDown className="h-4 w-4" />
            </IconToggle>
            {isImage && toolGroupLayout.groups.length > 0 && (
              <>
                <ToolbarDivider />
                <IconToggle
                  action="toggle-groups"
                  busy={false}
                  disabled={busy}
                  label={allGroupsExpanded ? t("threadExportCollapseAll") : t("threadExportExpandAll")}
                  onClick={() => setAllGroups(!allGroupsExpanded)}
                >
                  {allGroupsExpanded ? (
                    <FoldVertical className="h-4 w-4" />
                  ) : (
                    <UnfoldVertical className="h-4 w-4" />
                  )}
                </IconToggle>
              </>
            )}
            {!isImage && (
              <>
                <ToolbarDivider />
                <IconToggle
                  action="include-tools"
                  active={includeTools}
                  label={t("threadExportIncludeTools")}
                  onClick={() => setIncludeTools((value) => !value)}
                >
                  <Wrench className="h-4 w-4" />
                </IconToggle>
              </>
            )}
            <ToolbarDivider />
            <IconToggle
              action="save"
              busy={busyAction === "save"}
              disabled={busy}
              label={isImage ? t("threadExportSaveImage") : t("threadExportSaveMarkdown")}
              onClick={isImage ? saveImage : () => void saveMarkdown()}
            >
              <Download className="h-4 w-4" />
            </IconToggle>
            <IconToggle
              action="copy"
              busy={busyAction === "copy"}
              disabled={busy}
              label={isImage ? t("threadExportCopyImage") : t("threadExportCopyMarkdown")}
              onClick={isImage ? copyImage : copyMarkdown}
            >
              <Copy className="h-4 w-4" />
            </IconToggle>
            <DialogClose asChild>
              <button
                aria-label={t("threadExportClose")}
                className="grid h-8 w-8 place-items-center rounded-md border border-transparent text-muted-foreground hover:bg-[#efefeb] hover:text-foreground dark:hover:bg-[#262822]"
                data-turn-export-action="close"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
        </header>
        <main
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#f4f4f0] dark:bg-background/60"
          data-turn-export-pane
        >
          <div
            className="mx-auto min-h-full w-full px-6 py-5"
            data-turn-export-preview
            ref={previewRef}
            style={{
              backgroundColor: "var(--card)",
              maxWidth: "var(--thread-content-max-width, 820px)",
            }}
          >
            {isImage ? (
              <>
                <div className="flex items-center gap-2 px-5 pb-2 pt-4">
                  {/*
                    卡片头是长图专属的"出处":品牌标 + 名字 + 时间。图标沿用应用里同一套处理
                    (`rounded-[20%]` + ring,见助手身份行与侧栏),不另做一套。

                    **显式给 width/height**:这个 SVG 自身是 512×512,只靠样式定尺寸的话,
                    样式一旦没生效它就会把整张纸撑宽(长图宽度不许被任何一张图决定)。
                  */}
                  <img
                    alt=""
                    className="shrink-0 rounded-[20%] object-cover ring-1 ring-black/10 dark:ring-white/15"
                    data-turn-export-brand
                    draggable={false}
                    height={20}
                    src={wordlessIcon}
                    width={20}
                  />
                  <span className="text-[13px] font-bold tracking-wide">Wordless</span>
                  <time className="ml-auto font-mono text-[11px] text-[#aaa9a1]">
                    {new Date(timestamp).toLocaleString([], {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <div className="space-y-4 px-5 pb-5">
                  <ExportContent
                    isGroupExpanded={isGroupExpanded}
                    messages={messages}
                    onToggleGroup={toggleGroup}
                    toolGroupLayout={toolGroupLayout}
                  />
                </div>
              </>
            ) : (
              /*
               * Markdown 预览 = **把导出的那份 md 渲染出来**(与长图同一个渲染器、同一张纸),
               * 所以它和长图结构一致:正文顺序一样、工具组各自出现在自己的位置。
               * 与长图的差别正是文件与图的差别:没有卡片头,工具组是文字行而不是可折叠的现场控件。
               */
              <div className="px-6 py-1" data-turn-export-source>
                <MessageMarkdown text={md} />
              </div>
            )}
          </div>
        </main>
        {(notice || error) && (
          <footer className="flex flex-col gap-1 border-t border-border px-5 py-2">
            {notice && (
              <p
                className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-[#6d7a58] dark:text-[#a4b98b]"
                role="status"
              >
                {notice}
              </p>
            )}
            {error && (
              <p className="text-[11px] leading-5 text-destructive" role="alert">
                {error}
              </p>
            )}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 预览正文:文本走与现场同一个 `MessageMarkdown`;工具组只摆在本轮里的**分组位置**
 * (组的开头块的),后续消息里属于同一组的工具块不再重复出现——谁属于哪一组,现场与
 * 预览是同一个分组器说了算。
 */
function ExportContent({
  isGroupExpanded,
  messages,
  onToggleGroup,
  toolGroupLayout,
}: {
  isGroupExpanded: (group: ToolActivityGroup) => boolean;
  messages: readonly ConversationMessage[];
  onToggleGroup: (group: ToolActivityGroup) => void;
  toolGroupLayout: ToolActivityLayout;
}) {
  const nodes: ReactNode[] = [];
  messages.forEach((message, messageIndex) => {
    let hadContent = false;
    message.blocks.forEach((block, blockIndex) => {
      if (block.type === "text" && block.text.trim().length > 0) {
        hadContent = true;
        nodes.push(<MessageMarkdown key={`text-${message.id}-${blockIndex}`} text={block.text} />);
      }
      if (block.type === "tool") {
        const group = toolGroupLayout.groupsByBlock.get(`${message.id}:${blockIndex}`);
        if (!group || group.startMessageId !== message.id || group.startBlockIndex !== blockIndex) return;
        hadContent = true;
        nodes.push(
          <ExportToolGroup
            expanded={isGroupExpanded(group)}
            group={group}
            key={`tool-group-${group.id}`}
            onToggle={() => onToggleGroup(group)}
          />,
        );
      }
    });
    if (hadContent && messageIndex < messages.length - 1)
      // 一轮里的多条消息之间用一条分隔线,和视觉上的层级一致。
      nodes.push(<hr key={`separator-${message.id}`} className="border-t border-border" />);
  });
  return <>{nodes}</>;
}

function ExportToolGroup({
  expanded,
  group,
  onToggle,
}: {
  expanded: boolean;
  group: ToolActivityGroup;
  onToggle: () => void;
}) {
  /*
   * 导出是结束后的快照:构建器给现场用的「处理中」在导出语境里没有意义 —— 组没被收尾
   * 事件封闭只说明"这轮没有文字接在它后面",不说明工具还在跑。预览与 Markdown 的
   * `toolSectionFor` 做同一件事,两边说法才不会分叉。
   */
  const groupSnapshot: ToolActivityGroup = { ...group, processing: false };
  return (
    <div className="min-w-0">
      <ToolActivityGroupHeader expanded={expanded} group={groupSnapshot} onToggle={() => onToggle()} />
      {expanded && <ExportToolGroupTools group={group} />}
    </div>
  );
}

function ExportToolGroupTools({ group }: { group: ToolActivityGroup }) {
  const { t } = usePreferences();
  return (
    /*
     * **直接用线程里那个行组件**(`ToolActivityRow`),不是自己画一套:
     * 图标是工具自己的图标(`standardToolIcon`)、中间那格是命令/路径、右侧是结果话术、
     * 行尾是状态图标 —— 与页面上的工具行逐格一致。话术来自 `tool-row-presentation.ts`,
     * 现场与导出同一份实现。
     *
     * 刻意不摆现场那些**交互**:展开输出、审批按钮、打开文件变更 —— 图里点不动,
     * 摆进去只会让人以为可以点。
     */
    <ul className="mb-2 ml-8 mt-2 space-y-1.5" data-turn-export-tools>
      {group.tools.map((tool) => (
        <li key={tool.callId}>
          <ToolActivityRow
            block={tool}
            completedWarning={toolCompletedWarning(tool)}
            detail={toolRowDetail(tool, t)}
            icon={standardToolIcon(tool.name) ?? <Wrench className="h-3.5 w-3.5" />}
            summary={toolRowSummary(tool, t)}
          />
        </li>
      ))}
    </ul>
  );
}

function toolStateIcon(state: MessageToolBlock["state"]): ReactNode {
  switch (state) {
    case "complete":
      return <Check aria-hidden className="h-3 w-3 shrink-0 text-[#6c8542] dark:text-[#93a878]" />;
    case "error":
    case "awaiting-approval":
    case "awaiting-user-input":
      return <CircleAlert aria-hidden className="h-3 w-3 shrink-0 text-[#ad7956] dark:text-[#d6a16d]" />;
    default:
      return <LoaderCircle aria-hidden className="h-3 w-3 shrink-0 animate-spin text-[#89957a] dark:text-[#9aa88a]" />;
  }
}

function ToolbarDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />;
}

/**
 * 工具条上的图标按钮。
 *
 * **tooltip 与 aria-label 都要有**:图标按钮没有可见文字,而 tooltip 只对鼠标生效 ——
 * 键盘与读屏只能拿到 `aria-label`。两样用同一个说法,不出现"鼠标看到的是 A、读屏听到的是 B"。
 */
function IconToggle({
  action,
  active = false,
  busy = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  action: string;
  active?: boolean;
  busy?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  const { t } = usePreferences();
  const text = busy ? t("threadExportSaving") : label;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={text}
          aria-pressed={active}
          className={cn(
            "grid h-8 w-8 place-items-center rounded-md border",
            active
              ? "border-[#b7c98b] bg-white text-[#53652d] dark:border-[#718b43] dark:bg-[#202719] dark:text-[#d7ec9a]"
              : "border-transparent text-muted-foreground hover:bg-[#efefeb] hover:text-foreground dark:hover:bg-[#262822]",
          )}
          data-turn-export-action={action}
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          {busy ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
