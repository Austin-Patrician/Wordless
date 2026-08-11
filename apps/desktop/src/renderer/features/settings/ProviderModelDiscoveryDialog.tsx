import type { ProviderModelCandidate } from "@wordless/domain";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Tooltip, TooltipContent, TooltipTrigger } from "@wordless/ui-kit";
import { Check, ChevronDown, ChevronRight, ListPlus, LoaderCircle, Minus, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { ProviderIcon } from "./provider-icons";
import { groupProviderModels } from "./provider-model-presentation";

type ProviderModelDiscoveryDialogProps = {
  error: string | null;
  loading: boolean;
  models: ProviderModelCandidate[];
  onApply: (presentIds: ReadonlySet<string>) => void;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  open: boolean;
  presentModelIds: string[];
  providerName: string;
};

export function ProviderModelDiscoveryDialog({ error, loading, models, onApply, onOpenChange, onRetry, open, presentModelIds, providerName }: ProviderModelDiscoveryDialogProps) {
  const { t } = usePreferences();
  const [query, setQuery] = useState("");
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPresentIds(new Set(presentModelIds));
    setCollapsedGroups(new Set());
  }, [open, presentModelIds.join("\u0000")]);

  const visibleModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return models;
    return models.filter((model) => `${model.name} ${model.id} ${model.ownedBy ?? ""}`.toLowerCase().includes(normalized));
  }, [models, query]);
  const groups = useMemo(() => groupProviderModels(visibleModels), [visibleModels]);
  const initialIds = useMemo(() => new Set(presentModelIds), [presentModelIds.join("\u0000")]);
  const changedCount = models.reduce((count, model) => count + (initialIds.has(model.id) !== presentIds.has(model.id) ? 1 : 0), 0);
  const allModelsPresent = models.length > 0 && models.every((model) => presentIds.has(model.id));

  const toggleModel = (modelId: string) => setPresentIds((current) => {
    const next = new Set(current);
    if (next.has(modelId)) next.delete(modelId);
    else next.add(modelId);
    return next;
  });
  const addAllModels = () => setPresentIds((current) => new Set([...current, ...models.map((model) => model.id)]));

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent aria-describedby="provider-model-discovery-description" className="left-auto flex h-[min(480px,calc(100vh-96px))] w-[min(680px,calc(100vw-40px))] translate-x-0 flex-col rounded-[20px] bg-[#fbfbfa] p-0 dark:bg-card" overlayClassName="top-[30px]" showCloseButton={false} style={{ right: "max(20px, calc((100vw - 1120px) / 2 + 20px))" }}>
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 text-[17px] font-semibold"><span className="truncate">{providerName}</span><span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">{models.length}</span></DialogTitle>
            <DialogDescription className="sr-only" id="provider-model-discovery-description">{t("modelDiscoveryDescription")}</DialogDescription>
          </div>
          <Button className="text-muted-foreground hover:text-foreground" disabled={loading || models.length === 0 || allModelsPresent} onClick={addAllModels} size="sm" type="button" variant="ghost"><ListPlus className="size-4" />{t("addAllModels")}</Button>
          {error ? <Tooltip><TooltipTrigger asChild><Button aria-label={t("retryModelDiscovery")} disabled={loading} onClick={onRetry} size="icon" type="button" variant="ghost"><RefreshCw className="size-4" /></Button></TooltipTrigger><TooltipContent>{error}</TooltipContent></Tooltip> : null}
          <Button aria-label={t("cancel")} onClick={() => onOpenChange(false)} size="icon" type="button" variant="ghost"><X className="size-4" /></Button>
        </header>

        <div className="shrink-0 border-b border-border bg-background/70 px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input aria-label={t("searchModels")} className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-8 text-[12px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" disabled={loading} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchModels")} value={query} />
            {query ? <button aria-label={t("clearSearch")} className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded hover:bg-muted" onClick={() => setQuery("")} type="button"><X className="size-3" /></button> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <div aria-busy="true" className="grid h-full place-items-center text-muted-foreground"><div className="flex items-center gap-2 text-[12px]"><LoaderCircle className="size-4 animate-spin" />{t("fetchingModels")}</div></div> : error && models.length === 0 ? <div className="grid h-full place-items-center px-8 text-center"><div><p className="text-[13px] font-medium">{t("modelDiscoveryFailed")}</p><p className="mt-2 max-w-[420px] text-[11px] leading-5 text-muted-foreground">{error}</p><Button className="mt-4" onClick={onRetry} size="sm" type="button" variant="outline"><RefreshCw className="size-3.5" />{t("retryModelDiscovery")}</Button></div></div> : visibleModels.length === 0 ? <div className="grid h-full place-items-center text-[12px] text-muted-foreground">{query ? t("noMatchingModels") : t("noRemoteModels")}</div> : <div>
            {groups.map((group) => <section className="border-b border-border last:border-b-0" key={group.id}>
              <button className="sticky top-0 z-10 flex h-10 w-full items-center gap-2 border-b border-border bg-[#f3f4f1]/95 px-5 text-left backdrop-blur dark:bg-[#242721]/95" onClick={() => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })} type="button">
                {collapsedGroups.has(group.id) ? <ChevronRight className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                <span className="text-[12px] font-semibold">{group.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{group.models.length}</span>
              </button>
              {!collapsedGroups.has(group.id) ? <div className="divide-y divide-border">
            {group.models.map((model) => {
              const present = presentIds.has(model.id);
              const changed = initialIds.has(model.id) !== present;
              return <button aria-pressed={present} className={`flex min-h-14 w-full items-center gap-3 px-5 py-2.5 text-left transition-colors ${present ? "bg-[#f3f8e7] dark:bg-[#20291a]" : "hover:bg-muted/55"}`} key={model.id} onClick={() => toggleModel(model.id)} type="button">
                <span className={`grid size-7 shrink-0 place-items-center rounded-md border bg-background ${present ? "border-[#afcb54]" : "border-border"}`}><ProviderIcon avatarId={group.avatarId} className="size-4.5 object-contain" providerId={group.id} /></span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{model.name}</span>
                {changed ? <span className="rounded bg-[#edf2dc] px-1.5 py-0.5 text-[9px] text-[#65752f] dark:bg-[#354021] dark:text-[#d2e69a]">{present ? t("pendingAdd") : t("pendingRemove")}</span> : null}
                <Tooltip><TooltipTrigger asChild><span aria-label={present ? t("removeModel") : t("addModel")} className={`grid size-8 shrink-0 place-items-center rounded-md ${present ? "text-[#8b5c50] hover:bg-[#f5e8e4] dark:hover:bg-[#442822]" : "text-[#627b32] hover:bg-[#edf3df] dark:hover:bg-[#2e391f]"}`} role="img">{present ? <Minus className="size-4" /> : <Plus className="size-4" />}</span></TooltipTrigger><TooltipContent>{present ? t("removeModel") : t("addModel")}</TooltipContent></Tooltip>
              </button>;
            })}
              </div> : null}
            </section>)}
          </div>}
        </div>

        <footer className="flex shrink-0 items-center justify-between border-t border-border bg-background px-5 py-2.5">
          <span className="text-[11px] text-muted-foreground">{changedCount > 0 ? t("pendingModelChanges").replace("{count}", String(changedCount)) : t("noPendingModelChanges")}</span>
          <div className="flex gap-2"><Button onClick={() => onOpenChange(false)} type="button" variant="outline">{t("cancel")}</Button><Button disabled={loading || changedCount === 0} onClick={() => onApply(presentIds)} type="button">{t("applyModelChanges")}</Button></div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
