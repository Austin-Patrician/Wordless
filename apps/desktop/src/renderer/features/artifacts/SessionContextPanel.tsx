import { ChevronDown, Maximize2, Menu, Minimize2, PanelRightClose } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBrowserOcclusion } from "../browser/use-occlusion";
import type { ReactNode } from "react";
import type { ContextPanelTab, ContextPanelView } from "../workbench/context-panel-types";
import { mainWidthFromPointer, panelWidthFromPointer } from "./context-panel-layout";

type SessionContextPanelProps = {
  collapsed: boolean;
  fullscreen: boolean;
  leftSidebarWidth: number;
  minimumMainWidth: number;
  onFullscreen: () => void;
  onToggle: () => void;
  onViewChange: (view: ContextPanelView) => void;
  renderContent: (view: ContextPanelView) => ReactNode;
  contentClassName?: string;
  showFooter?: boolean;
  showMenu?: boolean;
  /** 是否渲染页签那一行。铺满型工作台只有一行标题可读时,把它让给内容。 */
  showTabStrip?: boolean;
  tabs: ContextPanelTab[];
  view: ContextPanelView;
  /**
   * `fixed`(默认)= 面板自己定宽,拖拽手柄调整**自己**。
   * `fill` = 面板吃掉剩余宽度,而拖拽手柄调整的是**相邻的主区**(对话)。
   *
   * 为什么需要它:设计画布是无限画布,它要的是整个窗口的宽度,而"对话 + 300px 面板"的默认
   * 布局把画布锁在了一个手机帧都放不下的宽度里(见 `design/budgets.ts` 的活体规则)。
   * 手柄仍然在**同一条边界**上,只是拖动时变的是另一侧 —— 用户的动作没有变。
   */
  layout?: "fixed" | "fill";
  /** 仅 `fill`:相邻主区(对话)当前宽度。 */
  mainWidth?: number;
  /** 仅 `fill`:相邻主区被拖动后的新宽度。 */
  onMainWidthChange?: (width: number) => void;
};

/** `fill` 下面板自己至少要这么宽:再窄,一个 390 宽的手机帧在 1:1 下就放不下了。 */
const FILL_MIN_WIDTH = 480;
/** `fill` 下对话列的上限:它不该宽过画布 —— 这一屏的主体是画布。 */
const MAIN_MAX_WIDTH = 720;

export function SessionContextPanel({ collapsed, fullscreen, leftSidebarWidth, minimumMainWidth, onFullscreen, onToggle, onViewChange, renderContent, contentClassName, showFooter = true, showMenu = true, showTabStrip = true, tabs, view, layout = "fixed", onMainWidthChange }: SessionContextPanelProps) {
  const [width, setWidth] = useState(() => tabs[0]?.id === "preview" ? 420 : 300);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // This dropdown is hand-rolled and absolute-positioned inside the panel
  // header, so it is neither portalled nor reliably caught by sampling. It
  // overlaps the page whenever it is open, which would leave the native view
  // painted on top of it.
  useBrowserOcclusion(dropdownOpen, "dropdown");
  const fill = layout === "fill";
  const dragging = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const availableWidth = Math.max(0, viewportWidth - leftSidebarWidth - minimumMainWidth);
  const renderedWidth = Math.min(width, 760, availableWidth);
  const singleTab = tabs.length === 1;

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!dragging.current) return;
      if (fill) {
        onMainWidthChange?.(
          mainWidthFromPointer({
            clientX: event.clientX,
            leftSidebarWidth,
            max: MAIN_MAX_WIDTH,
            min: minimumMainWidth,
          }),
        );
        return;
      }
      setWidth(
        panelWidthFromPointer({ clientX: event.clientX, max: 760, min: 240, viewportWidth: window.innerWidth }),
      );
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [fill, leftSidebarWidth, minimumMainWidth, onMainWidthChange]);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    setWidth((current) => tabs[0]?.id === "preview" && current < 360 ? 420 : current);
  }, [tabs]);

  useEffect(() => {
    // The translation panel shows the original next to its translation, so it
    // opens wider than the 300px default, while never shrinking a manual resize.
    setWidth((current) => view === "translation" && current < 400 ? 400 : current);
  }, [view]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (collapsed) return null;
  return <aside className={`relative flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden bg-[var(--wordless-shell-context)] ${fullscreen || fill ? "h-full flex-1" : "hidden shrink-0 border-l border-[#e4e4df] lg:flex dark:border-border"}`} style={fullscreen ? undefined : fill ? { minWidth: FILL_MIN_WIDTH } : { width: renderedWidth }}>
    {!fullscreen ? <button aria-label="Resize context panel" className="absolute -left-1.5 inset-y-0 z-10 w-3 cursor-col-resize" onMouseDown={() => { dragging.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; }} type="button" /> : null}
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#e4e4df] px-3 dark:border-border">{showMenu ? <button aria-label="Context menu" className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" type="button"><Menu className="h-4 w-4" /></button> : <span className="h-7 w-7 shrink-0" /> }<div className="flex shrink-0 items-center gap-0.5"><button aria-label={fullscreen ? "退出全屏" : "全屏"} className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={onFullscreen} type="button">{fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button><button aria-label="收起右栏" className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={onToggle} type="button"><PanelRightClose className="h-3.5 w-3.5" /></button></div></header>
    {showTabStrip ? <div className="relative border-b border-[#e4e4df] px-3 py-2.5 dark:border-border" ref={dropdownRef}>{singleTab ? <div className="flex items-center gap-2 px-2 py-1 text-[12px] font-semibold text-[#20201f] dark:text-foreground">{(() => { const Icon = tabs[0]!.icon; return <Icon className="h-3.5 w-3.5 text-[#718052]" />; })()}<span>{tabs[0]!.label}</span></div> : <><button className="flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] font-semibold text-[#20201f] hover:bg-[#ebebe6] dark:text-foreground dark:hover:bg-muted" onClick={() => setDropdownOpen((value) => !value)} type="button">{tabs.find((item) => item.id === view)?.label ?? "Context"}<ChevronDown className={`h-3 w-3 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} /></button>{dropdownOpen ? <div className="absolute left-3 top-full z-30 mt-1 w-[168px] rounded-[8px] border border-[#e4e4df] bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.10)] dark:border-border dark:bg-card">{tabs.map((item) => { const Icon = item.icon; return <button className={`flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[11px] font-medium ${item.id === view ? "bg-[#f1f1ef] text-[#252522] dark:bg-muted dark:text-foreground" : "text-[#454540] hover:bg-[#f5f5f2] dark:text-foreground dark:hover:bg-muted"}`} key={item.id} onClick={() => { onViewChange(item.id); setDropdownOpen(false); }} type="button"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.id === view ? <span className="text-[14px] font-medium text-[#1dbb9e]">✓</span> : null}</button>; })}</div> : null}</>}</div> : null}
    <div className={`flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-x-hidden [&>*]:min-w-0 [&>*]:max-w-full ${contentClassName ?? "overflow-y-auto"}`}>{renderContent(view)}</div>
    {showFooter ? <footer className="shrink-0 border-t border-[#e4e4df] px-4 py-2 font-mono text-[9px] text-[#a8a8a2] dark:border-border">{tabs.find((item) => item.id === view)?.label ?? "Context"}</footer> : null}
  </aside>;
}
