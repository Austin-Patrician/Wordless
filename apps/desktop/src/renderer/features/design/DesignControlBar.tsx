import { Panel, useReactFlow, useStore } from "@xyflow/react";
import {
  AlignCenterHorizontal,
  FolderDown,
  ImageDown,
  RefreshCw,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Frame as FrameIcon,
  Hand,
  Maximize2,
  Minus,
  MousePointer2,
  Palette,
  Plus,
  Space,
  StickyNote,
  StretchHorizontal,
  StretchVertical,
} from "lucide-react";
import { usePreferences } from "../../shared/preferences";
import type { ArrangeMode } from "./arrange.ts";

/**
 * 画布底部的工作栏。
 *
 * 参考实现把它做成一个**底部居中的 dock**(`absolute bottom-3 left-1/2`),而不是散在四角的
 * 小按钮 —— 一条带子上同时说清三件事:现在拿的是什么工具、能新建什么、画布缩放到多少。
 * 我们的缩放条原来孤零零挂在左下角,现在并进来。
 *
 * 工具栏的条目对应 §用户要的那几项:选择 / 拖手 / 新建 frame / 备注 / 设计体系 / 缩放。
 */

export type DesignTool = "select" | "hand" | "frame";

export function DesignControlBar({
  onOpenStyles,
  stylesOpen,
  tool,
  onToolChange,
}: {
  tool: DesignTool;
  onToolChange: (tool: DesignTool) => void;
  /** 打开设计体系对话框。 */
  onOpenStyles: () => void;
  /** 对话框开着时按钮高亮。 */
  stylesOpen: boolean;
}) {
  const { t } = usePreferences();

  return (
    <Panel position="bottom-center">
      {/* 外层不吃指针:放大溢出的留白区不该挡住画布手势。 */}
      <div className="pointer-events-none flex items-center gap-1 rounded-xl border border-[#e2e4e6] bg-white/95 p-1 text-[#55575b] shadow-sm backdrop-blur dark:border-[#3b3e41] dark:bg-[#202225]/95 dark:text-[#d2d5d8]">
        <DockButton
          active={tool === "select"}
          icon={<MousePointer2 className="size-4" />}
          label={t("designToolSelect")}
          onClick={() => onToolChange("select")}
        />
        <DockButton
          active={tool === "hand"}
          icon={<Hand className="size-4" />}
          label={t("designToolHand")}
          onClick={() => onToolChange("hand")}
        />
        {/*
          还没做的三项**照实禁用**,而不是藏起来:用户要的是这条带子上能看到它们,而禁用 +
          标题说明"待做",比一个点了没反应的按钮诚实(§14.5:声明了却跑不起来的,比没有更糟)。
        */}
        {/*
          画框工具:按下它之后去画布上拖出一个矩形。工具态而不是"按一下建一个"——用户的意图
          是决定新画面多大、放哪,而那只有他画得出来。
        */}
        <DockButton
          active={tool === "frame"}
          icon={<FrameIcon className="size-4" />}
          label={t("designToolNewFrame")}
          onClick={() => onToolChange(tool === "frame" ? "select" : "frame")}
        />
        {/*
          「备注」仍照实禁用:它是一整条通道(存储 + 图层 + 抽屉 + 锚点保鲜 + 工具 + handoff),
          而这一轮不做它。禁用 + 标题写明原因,比一个点了没反应的按钮诚实
          (§14.5:声明了却跑不起来的,比没有更糟)。
        */}
        <DockButton
          disabled
          icon={<StickyNote className="size-4" />}
          label={`${t("designToolNotes")} · ${t("designToolComingSoon")}`}
        />
        <DockButton
          active={stylesOpen}
          icon={<Palette className="size-4" />}
          label={t("designToolDesignSystem")}
          onClick={onOpenStyles}
        />
        <Divider />
        <ZoomControls />
      </div>
    </Panel>
  );
}

/**
 * 画布右上角的动作:把东西拿走。
 *
 * 参考实现的右上角就是这一组(导出渲染图 / 下载素材),而它们与底部 dock 分开是有道理的:
 * dock 是"在画布上做什么",这里是"把结果拿出来" —— 一个动作改画布,一个动作离开画布。
 */
export function DesignCanvasActions({
  busy,
  onExport,
  onRefresh,
  refreshing,
}: {
  /** 导出中:两个按钮都禁用,避免连点出两批文件。 */
  busy: boolean;
  onExport: (what: "frames" | "assets") => void;
  /**
   * 手动刷新:让画布跟上磁盘。
   *
   * 画布的心跳**只在 agent 在跑的时候**开(跑完磁盘不会再自己变)。可用户自己也会改文件 ——
   * 在编辑器里调一帧、把某处改回去 —— 那时画布不会动。这个按钮就是那件事的出口。
   */
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = usePreferences();
  return (
    <Panel position="top-right">
      <div className="pointer-events-none flex items-center gap-1 rounded-xl border border-[#e2e4e6] bg-white/95 p-1 text-[#55575b] shadow-sm backdrop-blur dark:border-[#3b3e41] dark:bg-[#202225]/95 dark:text-[#d2d5d8]">
        <DockButton
          disabled={refreshing}
          icon={<RefreshCw className={`size-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />}
          label={t("designRefresh")}
          onClick={onRefresh}
        />
        <Divider />
        <DockButton
          disabled={busy}
          icon={<ImageDown className="size-4" />}
          label={busy ? t("designExportBusy") : t("designExportFrames")}
          onClick={() => onExport("frames")}
        />
        <DockButton
          disabled={busy}
          icon={<FolderDown className="size-4" />}
          label={t("designExportAssets")}
          onClick={() => onExport("assets")}
        />
      </div>
    </Panel>
  );
}

/** 对齐与分布。只在多选时出现 —— 一帧没有"互相对齐"可言。 */
export function DesignArrangeToolbar({
  onArrange,
  selectedCount,
}: {
  onArrange: (mode: ArrangeMode) => void;
  selectedCount: number;
}) {
  const { t } = usePreferences();
  if (selectedCount < 2) return null;

  const align: { icon: React.ReactNode; label: string; mode: ArrangeMode }[] = [
    { icon: <AlignStartVertical className="size-3.5" />, label: t("designArrangeLeft"), mode: "left" },
    { icon: <AlignCenterVertical className="size-3.5" />, label: t("designArrangeCenterH"), mode: "center-h" },
    { icon: <AlignEndVertical className="size-3.5" />, label: t("designArrangeRight"), mode: "right" },
    { icon: <AlignStartHorizontal className="size-3.5" />, label: t("designArrangeTop"), mode: "top" },
    { icon: <AlignCenterHorizontal className="size-3.5" />, label: t("designArrangeMiddle"), mode: "middle" },
    { icon: <AlignEndHorizontal className="size-3.5" />, label: t("designArrangeBottom"), mode: "bottom" },
  ];
  const distribute: { icon: React.ReactNode; label: string; mode: ArrangeMode }[] = [
    { icon: <StretchHorizontal className="size-3.5" />, label: t("designDistributeH"), mode: "distribute-h" },
    { icon: <StretchVertical className="size-3.5" />, label: t("designDistributeV"), mode: "distribute-v" },
  ];

  return (
    <Panel position="top-center">
      <div className="pointer-events-none flex items-center gap-1 rounded-xl border border-[#e2e4e6] bg-white/95 p-1 text-[#55575b] shadow-sm backdrop-blur dark:border-[#3b3e41] dark:bg-[#202225]/95 dark:text-[#d2d5d8]">
        {align.map((item) => (
          <DockButton icon={item.icon} key={item.mode} label={item.label} onClick={() => onArrange(item.mode)} />
        ))}
        <Divider />
        {distribute.map((item) => (
          // 分布要三帧:两帧之间没有"间距"可言。少于三帧时禁用而不是点了没反应。
          <DockButton
            disabled={selectedCount < 3}
            icon={item.icon}
            key={item.mode}
            label={item.label}
            onClick={() => onArrange(item.mode)}
          />
        ))}
      </div>
    </Panel>
  );
}

function ZoomControls() {
  const { fitView, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const { t } = usePreferences();

  return (
    <>
      <DockButton icon={<Minus className="size-4" />} label={t("designZoomOut")} onClick={() => void zoomOut()} />
      <button
        className="pointer-events-auto h-8 min-w-[54px] rounded-[6px] px-2 text-[12px] tabular-nums hover:bg-[#f2f3f2] dark:hover:bg-[#2a2c2f]"
        onClick={() => void zoomTo(1, { duration: 180 })}
        title={t("designZoomReset")}
        type="button"
      >
        {Math.round(zoom * 100)}%
      </button>
      <DockButton icon={<Plus className="size-4" />} label={t("designZoomIn")} onClick={() => void zoomIn()} />
      <Divider />
      <DockButton
        icon={<Maximize2 className="size-4" />}
        label={t("designZoomFit")}
        onClick={() => void fitView({ maxZoom: 1, padding: 0.12, duration: 240 })}
      />
    </>
  );
}

function DockButton({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-disabled={disabled}
      aria-label={label}
      className={`grid h-8 w-8 place-items-center rounded-[6px] ${
        disabled
          ? "cursor-not-allowed opacity-35"
          : active
            ? "bg-[#eef1f6] text-[#3f6bd6] dark:bg-[#2a2f38] dark:text-[#8fb0f0]"
            : "pointer-events-auto hover:bg-[#f2f3f2] dark:hover:bg-[#2a2c2f]"
      }`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-[#e6e7e3] dark:bg-[#3b3e41]" />;
}

/** 用不到但保留:工具栏上下文的间距图标(间距手柄那一轮会用)。 */
export const ARRANGE_GAP_ICON = Space;
