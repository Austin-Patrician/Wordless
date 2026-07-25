import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@wordless/ui-kit";
import type { MediaAsset, MediaOperation } from "@wordless/domain";
import { ArrowUpDown, BookOpen, ChevronDown, GalleryHorizontalEnd, Image as ImageIcon, LayoutGrid, LoaderCircle, Search, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

type AssetFilter = "all" | "generated" | "uploaded";
type AssetTab = "canvas" | "assets";

export function MediaAssetDock({ assets, locale, onSelect, operations, selectedAssetId }: {
  assets: MediaAsset[];
  locale: "zh-CN" | "en-US";
  onSelect: (assetId: string) => void;
  operations: MediaOperation[];
  selectedAssetId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<AssetTab>("canvas");
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [newestFirst, setNewestFirst] = useState(true);
  const operationById = useMemo(() => new Map(operations.map((operation) => [operation.id, operation])), [operations]);
  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return assets
      .filter((asset) => filter === "all" || asset.origin === filter)
      .filter((asset) => {
        if (!normalizedQuery) return true;
        const operation = operationById.get(asset.operationId);
        return `${asset.name} ${operation?.prompt ?? ""}`.toLocaleLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => newestFirst ? right.updatedAt - left.updatedAt : left.updatedAt - right.updatedAt);
  }, [assets, filter, newestFirst, operationById, query]);
  const filterLabel = filter === "all"
    ? (locale === "zh-CN" ? "全部元素" : "All elements")
    : filter === "generated"
      ? (locale === "zh-CN" ? "生成内容" : "Generated")
      : (locale === "zh-CN" ? "上传内容" : "Uploads");

  return <>
    {open ? <button aria-label={locale === "zh-CN" ? "关闭资产面板" : "Close assets"} className="absolute inset-0 z-[31] cursor-default" onClick={() => setOpen(false)} type="button" /> : null}
    {open ? <aside className="absolute bottom-[58px] right-4 z-[32] flex h-[min(70vh,560px)] w-[min(350px,calc(100%-2rem))] flex-col overflow-hidden rounded-[12px] border border-border bg-card/98 text-card-foreground shadow-[0_22px_56px_rgba(0,0,0,.22)] backdrop-blur-md">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <nav className="flex items-center gap-1 rounded-[8px] bg-muted/55 p-1">
          <DockTab active={tab === "canvas"} icon={LayoutGrid} label={locale === "zh-CN" ? "画布" : "Canvas"} onClick={() => setTab("canvas")} />
          <DockTab active={tab === "assets"} icon={GalleryHorizontalEnd} label={locale === "zh-CN" ? "资产" : "Assets"} onClick={() => setTab("assets")} />
        </nav>
        <div className="flex items-center gap-0.5 text-muted-foreground"><BookOpen className="h-4 w-4" /><button aria-label={locale === "zh-CN" ? "关闭" : "Close"} className="ml-1 grid h-7 w-7 place-items-center rounded-[5px] hover:bg-muted hover:text-foreground" onClick={() => setOpen(false)} type="button"><X className="h-3.5 w-3.5" /></button></div>
      </header>
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-3 pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button className="flex h-7 items-center gap-1 text-[11px] font-semibold text-foreground" type="button">{filterLabel}<ChevronDown className="h-3 w-3" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">{(["all", "generated", "uploaded"] as const).map((value) => <DropdownMenuItem key={value} onClick={() => setFilter(value)}>{value === "all" ? (locale === "zh-CN" ? "全部元素" : "All elements") : value === "generated" ? (locale === "zh-CN" ? "生成内容" : "Generated") : (locale === "zh-CN" ? "上传内容" : "Uploads")}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-0.5"><button aria-label={locale === "zh-CN" ? "切换排序" : "Change sort order"} className={`grid h-7 w-7 place-items-center rounded-[5px] ${newestFirst ? "text-muted-foreground" : "bg-muted text-foreground"}`} onClick={() => setNewestFirst((current) => !current)} title={newestFirst ? (locale === "zh-CN" ? "最新优先" : "Newest first") : (locale === "zh-CN" ? "最早优先" : "Oldest first")} type="button"><ArrowUpDown className="h-3.5 w-3.5" /></button><button aria-label={locale === "zh-CN" ? "搜索资产" : "Search assets"} className={`grid h-7 w-7 place-items-center rounded-[5px] ${searchOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} onClick={() => setSearchOpen((current) => !current)} type="button"><Search className="h-3.5 w-3.5" /></button></div>
      </div>
      {searchOpen ? <label className="mx-5 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-[6px] border border-border bg-background px-2.5 focus-within:border-[#93a960]"><Search className="h-3.5 w-3.5 text-muted-foreground" /><input autoFocus className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground" onChange={(event) => setQuery(event.target.value)} placeholder={locale === "zh-CN" ? "搜索名称或提示词" : "Search names or prompts"} value={query} /></label> : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {tab === "canvas" ? <div className="mb-1 flex h-16 items-center gap-3 rounded-[10px] px-2 text-muted-foreground"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-[8px] bg-muted"><ImageIcon className="h-4 w-4" /></span><span className="truncate text-[11px] font-semibold">{locale === "zh-CN" ? "空画板" : "Blank canvas"}</span></div> : null}
        <div className="space-y-1">{visibleAssets.map((asset) => {
          const operation = operationById.get(asset.operationId);
          const name = asset.origin === "uploaded" ? asset.name : operation?.prompt?.trim().split("\n")[0] || asset.name;
          return <button className={`flex h-[66px] w-full items-center gap-3 rounded-[12px] px-2 text-left transition-colors ${selectedAssetId === asset.id ? "bg-muted text-foreground" : "hover:bg-muted/65"}`} key={asset.id} onClick={() => { onSelect(asset.id); setOpen(false); }} type="button">
            <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[8px] border border-border bg-muted">{asset.url ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={asset.url} /> : asset.status === "rendering" ? <LoaderCircle className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" /> : <ImageIcon className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground" />}{asset.origin === "uploaded" ? <span className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-[3px] bg-black/70 text-white"><Upload className="h-2.5 w-2.5" /></span> : null}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={name}>{name}</span>
          </button>;
        })}</div>
        {visibleAssets.length === 0 ? <p className="px-2 py-8 text-center text-[10px] text-muted-foreground">{locale === "zh-CN" ? "没有匹配的资产" : "No matching assets"}</p> : null}
      </div>
    </aside> : null}
    <button aria-label={locale === "zh-CN" ? "资产" : "Assets"} className={`absolute bottom-4 right-4 z-[33] grid h-9 w-9 place-items-center rounded-[8px] border shadow-[0_8px_22px_rgba(0,0,0,.14)] transition-colors ${open ? "border-[#9caf64] bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:border-muted-foreground/55 hover:text-foreground"}`} onClick={() => setOpen((current) => !current)} title={locale === "zh-CN" ? "资产" : "Assets"} type="button"><GalleryHorizontalEnd className="h-4 w-4" />{assets.length > 0 ? <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-foreground px-1 font-mono text-[8px] leading-4 text-background">{assets.length}</span> : null}</button>
  </>;
}

function DockTab({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof LayoutGrid; label: string; onClick: () => void }) {
  return <button className={`flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-semibold transition-colors ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={onClick} type="button"><Icon className="h-3.5 w-3.5" />{label}</button>;
}
