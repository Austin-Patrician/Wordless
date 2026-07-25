import { ChevronDown, File, Globe2, LayoutDashboard, Maximize2, Menu, Minimize2, PanelRightClose, SquarePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ContextPanelView } from "./CodingContextPanel";
import { usePreferences } from "../../shared/preferences";

type SessionContextPanelProps = {
  collapsed: boolean;
  fullscreen: boolean;
  onFullscreen: () => void;
  onToggle: () => void;
  onViewChange: (view: ContextPanelView) => void;
  renderContent: (view: ContextPanelView) => ReactNode;
  view: ContextPanelView;
};

const views: Array<{ id: ContextPanelView | "browser"; key: "contextOverview" | "workspaceFiles" | "browser" | "changes"; icon: typeof LayoutDashboard }> = [
  { id: "overview", key: "contextOverview", icon: LayoutDashboard },
  { id: "files", key: "workspaceFiles", icon: File },
  { id: "browser", key: "browser", icon: Globe2 },
  { id: "changes", key: "changes", icon: SquarePlus },
];

export function SessionContextPanel({ collapsed, fullscreen, onFullscreen, onToggle, onViewChange, renderContent, view }: SessionContextPanelProps) {
  const { t } = usePreferences();
  const [width, setWidth] = useState(300);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dragging = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (dragging.current) setWidth(Math.min(600, Math.max(200, window.innerWidth - event.clientX)));
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (collapsed) return null;
  return <aside className={`relative flex min-h-0 shrink-0 flex-col bg-[var(--wordless-shell-context)] ${fullscreen ? "h-full flex-1" : "hidden border-l border-[#e4e4df] lg:flex dark:border-border"}`} style={fullscreen ? undefined : { width }}>
    {!fullscreen ? <button aria-label="Resize context panel" className="absolute -left-1.5 inset-y-0 z-10 w-3 cursor-col-resize" onMouseDown={() => { dragging.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; }} type="button" /> : null}
    <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#e4e4df] px-3 dark:border-border"><button aria-label="Context menu" className="grid h-7 w-7 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" type="button"><Menu className="h-4 w-4" /></button><div className="flex items-center gap-0.5"><button aria-label={fullscreen ? "退出全屏" : "全屏"} className="grid h-7 w-7 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={onFullscreen} type="button">{fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button><button aria-label="收起右栏" className="grid h-7 w-7 place-items-center rounded-[6px] text-[#65655f] hover:bg-[#f0f0ec] dark:text-muted-foreground dark:hover:bg-muted" onClick={onToggle} type="button"><PanelRightClose className="h-3.5 w-3.5" /></button></div></header>
    <div className="relative border-b border-[#e4e4df] px-3 py-2.5 dark:border-border" ref={dropdownRef}><button className="flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px] font-semibold text-[#20201f] hover:bg-[#ebebe6] dark:text-foreground dark:hover:bg-muted" onClick={() => setDropdownOpen((value) => !value)} type="button">{t(views.find((item) => item.id === view)?.key ?? "contextOverview")}<ChevronDown className={`h-3 w-3 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} /></button>{dropdownOpen ? <div className="absolute left-3 top-full z-30 mt-1 w-[144px] rounded-[8px] border border-[#e4e4df] bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.10)] dark:border-border dark:bg-card">{views.map((item) => { const Icon = item.icon; return <button className={`flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[11px] font-medium ${item.id === view ? "bg-[#f1f1ef] text-[#252522] dark:bg-muted dark:text-foreground" : item.id === "browser" ? "cursor-not-allowed text-[#85857f]" : "text-[#454540] hover:bg-[#f5f5f2] dark:text-foreground dark:hover:bg-muted"}`} disabled={item.id === "browser"} key={item.id} onClick={() => { if (item.id !== "browser") onViewChange(item.id); setDropdownOpen(false); }} type="button"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{t(item.key)}</span>{item.id === view ? <span className="text-[14px] font-medium text-[#1dbb9e]">✓</span> : null}</button>; })}</div> : null}</div>
    <div className="min-h-0 flex-1 overflow-y-auto">{renderContent(view)}</div>
    <footer className="shrink-0 border-t border-[#e4e4df] px-4 py-2 font-mono text-[10px] text-[#a8a8a2] dark:border-border">{t(views.find((item) => item.id === view)?.key ?? "contextOverview")}</footer>
  </aside>;
}
