import { usePreferences } from "../../shared/preferences";
import { suppressNativeDragImage } from "./drag-image.ts";
import { MOCKUP_RAIL_FRAME_MIME } from "./mockup-attach.ts";

/**
 * 左栏:还没进渲染区的画框。
 *
 * **这个列表是"已加入"的补集**(见 `mockup-attach.ts`),不各自维护一份 —— 否则「加入后
 * 缩略图要消失」这条规则会立刻分叉。
 *
 * 缩略图用画布已经缓存过的位图(`thumbnail`)。没有就出一块占位,而**不为了一张缩略图再去
 * 截一次图**:打开这个弹窗时每帧本来就要按导出倍率重新抓一次,那才是真正需要像素的地方。
 *
 * **点击和拖拽都能加入**,而且两条路都留着:点击是"我就要这一帧"最短的动作,拖拽是"我要它,
 * 而且我想看着它落在预览里"。只留点击的话用户会去试拖,拖不动就像坏了。
 */
export interface MockupRailFrame {
  id: string;
  title: string;
  width: number;
  height: number;
  thumbnail: string | null;
}

export function MockupFrameRail({
  frames,
  total,
  onAttach,
  onAttachAll,
}: {
  frames: readonly MockupRailFrame[];
  /** 设计稿里一共几帧 —— 用来区分「没有画框」和「都加进去了」。 */
  total: number;
  onAttach: (frameId: string) => void;
  onAttachAll: () => void;
}) {
  const { t } = usePreferences();

  return (
    <div className="flex w-32 shrink-0 flex-col border-r border-border bg-card/60">
      <div className="flex items-center justify-between gap-1 px-2 py-2">
        <span className="text-[11px] font-medium text-muted-foreground">{t("mockupRailTitle")}</span>
        {frames.length > 0 ? (
          <button
            className="rounded-md px-1.5 py-0.5 text-[11px] text-[#6f8250] hover:bg-muted"
            onClick={onAttachAll}
            type="button"
          >
            {t("mockupRailAddAll")}
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
        {frames.length === 0 ? (
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            {total === 0 ? t("mockupRailNoFrames") : t("mockupRailAllAdded")}
          </p>
        ) : null}
        {frames.map((frame) => (
          <button
            className="flex cursor-grab flex-col gap-1 rounded-lg border border-border bg-background p-1 text-left transition-colors hover:border-[#879b65] active:cursor-grabbing"
            draggable
            key={frame.id}
            onClick={() => onAttach(frame.id)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(MOCKUP_RAIL_FRAME_MIME, frame.id);
              // 系统画的拖影不受窗口裁剪,会飘到 app 外面;落点自己会高亮。
              suppressNativeDragImage(event.dataTransfer);
            }}
            title={frame.title}
            type="button"
          >
            <span
              className="flex w-full items-center justify-center overflow-hidden rounded-md bg-muted"
              style={{ aspectRatio: `${Math.max(1, frame.width)} / ${Math.max(1, frame.height)}` }}
            >
              {frame.thumbnail === null ? (
                <span className="text-[10px] text-muted-foreground">{t("mockupRailNoPreview")}</span>
              ) : (
                <img alt="" className="h-full w-full object-cover" draggable={false} src={frame.thumbnail} />
              )}
            </span>
            <span className="truncate text-[11px] text-foreground">{frame.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
