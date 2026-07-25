import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@wordless/ui-kit";
import type { ConfiguredModelSummary, MediaAsset, MediaOperationKind } from "@wordless/domain";
import { GripHorizontal, ImagePlus, LoaderCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "../settings/provider-icons";
import { mediaOperationDefinition } from "./media-operations";

type ComposerValue = { prompt: string; modelKey: string; ratio: string; outputCount: number };

export function MediaComposer({ action, busy, error, initialValue, locale, models, onAddReferences, onCancel, onOpenModels, onRemoveReference, onSubmit, references, variant = "node" }: {
  action: Exclude<MediaOperationKind, "upload" | "crop">;
  busy?: boolean;
  error?: string | null;
  initialValue: ComposerValue;
  locale: "zh-CN" | "en-US";
  models: ConfiguredModelSummary[];
  onAddReferences?: () => void;
  onCancel?: () => void;
  onOpenModels: () => void;
  onRemoveReference: (assetId: string) => void;
  onSubmit: (value: ComposerValue) => void;
  references: MediaAsset[];
  variant?: "node" | "root";
}) {
  const [value, setValue] = useState(initialValue);
  const composing = useRef(false);
  useEffect(() => {
    if (initialValue.modelKey) setValue((current) => current.modelKey ? current : { ...current, modelKey: initialValue.modelKey });
  }, [initialValue.modelKey]);
  const selectedModel = models.find((model) => `${model.providerId}:${model.modelId}` === value.modelKey) ?? models[0];
  const canSubmit = value.prompt.trim().length > 0 && selectedModel !== undefined && !busy;
  const definition = mediaOperationDefinition(action);
  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ ...value, prompt: value.prompt.trim(), modelKey: selectedModel ? `${selectedModel.providerId}:${selectedModel.modelId}` : value.modelKey });
    if (variant === "root") setValue((current) => ({ ...current, prompt: "" }));
  };
  return (
    <section className={`nopan nowheel overflow-hidden border bg-card text-card-foreground shadow-[0_16px_42px_rgba(0,0,0,.16)] ${variant === "root" ? "w-[min(680px,calc(100vw-5rem))] rounded-[10px] border-border" : "w-[390px] rounded-[8px] border-[#575b51] dark:border-[#54584e]"}`} onClick={(event) => event.stopPropagation()}>
      {variant === "node" ? <header className="flex h-7 items-center justify-between border-b border-border/75 px-1.5"><span aria-label={locale === "zh-CN" ? "拖拽草稿节点" : "Drag draft node"} className="flex h-full flex-1 cursor-grab items-center text-muted-foreground active:cursor-grabbing"><GripHorizontal className="h-3.5 w-3.5" /></span>{onAddReferences ? <button aria-label={locale === "zh-CN" ? "添加参考图片" : "Add reference images"} className="nodrag grid h-5 w-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onAddReferences} title={locale === "zh-CN" ? "添加参考图片" : "Add reference images"} type="button"><ImagePlus className="h-3.5 w-3.5" /></button> : null}</header> : null}
      {references.length > 0 ? <div className="nodrag flex gap-2 overflow-x-auto border-b border-border px-3 py-2.5">{references.map((asset) => <div className="group/reference relative h-12 w-12 shrink-0 overflow-hidden rounded-[5px] border border-border bg-muted" key={asset.id}>{asset.url ? <img alt={asset.name} className="h-full w-full object-cover" src={asset.url} /> : null}<button aria-label={locale === "zh-CN" ? "移除参考图片" : "Remove reference image"} className="absolute right-0.5 top-0.5 hidden h-4 w-4 place-items-center rounded-full bg-black/75 text-white group-hover/reference:grid" onClick={() => onRemoveReference(asset.id)} type="button"><X className="h-2.5 w-2.5" /></button></div>)}</div> : null}
      <textarea
        aria-label={locale === "zh-CN" ? "图片提示词" : "Image prompt"}
        className={`nodrag block w-full resize-none bg-transparent px-4 text-[13px] leading-6 outline-none placeholder:text-muted-foreground ${variant === "root" ? "min-h-[116px] py-4" : "min-h-[88px] py-3"}`}
        onChange={(event) => setValue((current) => ({ ...current, prompt: event.target.value }))}
        onCompositionEnd={() => { composing.current = false; }}
        onCompositionStart={() => { composing.current = true; }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !composing.current) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={definition.defaultPrompt[locale] || (locale === "zh-CN" ? "描述你想生成的图片…" : "Describe the image you want to create…")}
        value={value.prompt}
      />
      {error ? <p className="nodrag border-t border-red-500/20 bg-red-500/5 px-3 py-2 text-[10px] leading-4 text-red-600 dark:text-red-300">{error}</p> : null}
      <footer className="nodrag flex min-w-0 items-center justify-between gap-2 border-t border-border bg-muted/25 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {models.length ? <Select onValueChange={(modelKey) => setValue((current) => ({ ...current, modelKey }))} value={selectedModel ? `${selectedModel.providerId}:${selectedModel.modelId}` : value.modelKey}><SelectTrigger className="h-7 min-w-0 max-w-[150px] flex-1 overflow-hidden border-0 bg-transparent px-0 shadow-none focus:ring-0"><span className="flex min-w-0 items-center gap-1.5 overflow-hidden"><ProviderMark avatarId={selectedModel?.providerAvatarId} providerId={selectedModel?.providerId} /><span className="min-w-0 truncate" title={selectedModel?.displayName}>{selectedModel?.displayName}</span></span><SelectValue className="sr-only" /></SelectTrigger><SelectContent className="max-h-64" style={{ width: "min(360px, calc(100vw - 4rem))" }}>{models.map((model) => <SelectItem className="py-2" key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}><span className="flex min-w-0 items-start gap-2"><ProviderMark avatarId={model.providerAvatarId} providerId={model.providerId} /><span className="min-w-0 whitespace-normal break-words leading-4">{model.displayName}</span></span></SelectItem>)}</SelectContent></Select> : <button className="flex items-center gap-1.5 text-[#74883b] hover:underline dark:text-[#c8e976]" onClick={onOpenModels} type="button"><ImagePlus className="h-3.5 w-3.5" />{locale === "zh-CN" ? "配置模型" : "Configure model"}</button>}
          <Select onValueChange={(ratio) => setValue((current) => ({ ...current, ratio }))} value={value.ratio}><SelectTrigger className="h-7 w-[50px] border-0 bg-transparent px-0 shadow-none focus:ring-0"><SelectValue /></SelectTrigger><SelectContent>{["16:9", "4:3", "1:1", "9:16"].map((ratio) => <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>)}</SelectContent></Select>
          <Select onValueChange={(outputCount) => setValue((current) => ({ ...current, outputCount: Number(outputCount) }))} value={String(value.outputCount)}><SelectTrigger className="h-7 w-[48px] border-0 bg-transparent px-0 shadow-none focus:ring-0"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 4].map((count) => <SelectItem key={count} value={String(count)}>{count}×</SelectItem>)}</SelectContent></Select>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{onCancel ? <button aria-label={locale === "zh-CN" ? "取消" : "Cancel"} className="grid h-7 w-7 place-items-center rounded-[5px] text-muted-foreground hover:bg-muted" onClick={onCancel} type="button"><X className="h-3.5 w-3.5" /></button> : null}<button aria-label={definition.label[locale]} className="grid h-8 w-8 place-items-center rounded-[6px] bg-accent text-accent-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-40" disabled={!canSubmit} onClick={submit} title={`${definition.label[locale]} (Ctrl+Enter)`} type="button">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button></div>
      </footer>
    </section>
  );
}

function ProviderMark({ avatarId, providerId }: { avatarId: ConfiguredModelSummary["providerAvatarId"] | undefined; providerId: string | undefined }) {
  return <ProviderIcon avatarId={avatarId} className="h-3.5 w-3.5 shrink-0 object-contain" providerId={providerId} />;
}

export type { ComposerValue };
